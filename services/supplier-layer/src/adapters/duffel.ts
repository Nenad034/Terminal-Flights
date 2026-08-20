import type { FareRules, FlightSegment, Offer, Order } from "@terminal-flights/shared-types";
import type { CancelQuote, CreateOrderParams, SearchParams, SupplierAdapter } from "./adapter.js";
import type {
  DuffelOffer,
  DuffelOfferRequestResponse,
  DuffelOrderCancellationResponse,
  DuffelOrderResponse,
  DuffelPaymentResponse,
  DuffelSegment,
} from "./duffel-types.js";

/**
 * Duffel adapter — izabran za MVP sadržaj letova (§01, §19): moderan REST/JSON API,
 * NDC-native Order model, nije potrebna sopstvena IATA akreditacija.
 *
 * F1: search() poziva Duffel Offer Requests API i mapira odgovor u interni Offer
 * model (§03), tako da domenski servisi iznad ovog sloja nikad ne vide Duffel oblik.
 */
export class DuffelAdapter implements SupplierAdapter {
  readonly code = "duffel";

  constructor(
    private readonly apiKey: string,
    private readonly apiBase: string = "https://api.duffel.com"
  ) {}

  async search(params: SearchParams): Promise<Offer[]> {
    if (!this.apiKey) {
      // Bez API ključa vraćamo praznu listu umesto da pucamo — omogućava da
      // ostatak sistema (search fan-out, ranking) radi bez pravog dobavljača.
      return [];
    }

    const body = {
      data: {
        slices: this.buildSlices(params),
        passengers: this.buildPassengers(params),
        cabin_class: params.cabinClass ?? "economy",
      },
    };

    const res = await fetch(`${this.apiBase}/air/offer_requests?return_offers=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Duffel-Version": "v2",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Ne bacamo grešku dalje — jedan neispravan dobavljač ne sme da obori
      // ceo search fan-out (§03 cost governance / pouzdanost).
      console.error(`[duffel] offer_requests failed: ${res.status} ${await res.text()}`);
      return [];
    }

    const json = (await res.json()) as DuffelOfferRequestResponse;
    return json.data.offers.map((offer) => this.toOffer(offer));
  }

  private buildSlices(params: SearchParams) {
    const slices = [
      { origin: params.origin, destination: params.destination, departure_date: params.departureDate },
    ];
    if (params.returnDate) {
      slices.push({
        origin: params.destination,
        destination: params.origin,
        departure_date: params.returnDate,
      });
    }
    return slices;
  }

  private buildPassengers(params: SearchParams) {
    const passengers: Array<{ type: "adult" | "child" | "infant_without_seat" }> = [];
    for (let i = 0; i < (params.passengers.adults ?? 1); i++) passengers.push({ type: "adult" });
    for (let i = 0; i < (params.passengers.children ?? 0); i++) passengers.push({ type: "child" });
    for (let i = 0; i < (params.passengers.infants ?? 0); i++) passengers.push({ type: "infant_without_seat" });
    return passengers;
  }

  private toOffer(offer: DuffelOffer): Offer {
    const segments: FlightSegment[] = offer.slices.flatMap((slice) =>
      slice.segments.map((segment) => this.toSegment(segment))
    );

    const fareRules: FareRules = {
      refundable: offer.conditions?.refund_before_departure?.allowed ?? false,
      changeable: offer.conditions?.change_before_departure?.allowed ?? false,
      checkedBagsIncluded: this.countBaggage(offer, "checked"),
      cabinBagsIncluded: this.countBaggage(offer, "carry_on"),
    };

    return {
      offerId: `duffel:${offer.id}`,
      supplierCode: "duffel",
      supplierOfferRef: offer.id,
      segments,
      price: {
        currency: offer.total_currency,
        base: Number(offer.base_amount),
        taxes: Number(offer.tax_amount),
        total: Number(offer.total_amount),
      },
      fareRules,
      expiresAt: offer.expires_at,
    };
  }

  private toSegment(segment: DuffelSegment): FlightSegment {
    return {
      origin: segment.origin.iata_code,
      destination: segment.destination.iata_code,
      departureAt: segment.departing_at,
      arrivalAt: segment.arriving_at,
      marketingCarrier: segment.marketing_carrier.iata_code,
      operatingCarrier: segment.operating_carrier.iata_code,
      flightNumber: segment.marketing_carrier_flight_number,
      cabinClass: (segment.passengers?.[0]?.cabin_class as FlightSegment["cabinClass"]) ?? "economy",
    };
  }

  private countBaggage(offer: DuffelOffer, type: "checked" | "carry_on"): number {
    for (const slice of offer.slices) {
      for (const segment of slice.segments) {
        const bag = segment.passengers?.[0]?.baggages?.find((b) => b.type === type);
        if (bag) return bag.quantity;
      }
    }
    return 0;
  }

  /**
   * Kreira order kao "hold" (bez odmah izvršenog plaćanja) — plaćanje ide kroz
   * poseban payments korak u booking sagi (§05), koji poziva
   * POST /air/payments nakon što ovaj order postoji. To booking sagi daje
   * mesto da uradi QC/validacioni korak (cena/dostupnost/pravila i dalje važe)
   * pre nego što se novac stvarno pokrene.
   */
  async createOrder(params: CreateOrderParams): Promise<Order> {
    const body = {
      data: {
        type: "hold",
        selected_offers: [params.supplierOfferRef],
        passengers: params.passengers.map((p) => ({
          given_name: p.givenName,
          family_name: p.familyName,
          born_on: p.bornOn,
          gender: p.gender,
          email: p.email,
          phone_number: p.phoneNumber,
        })),
      },
    };

    const res = await fetch(`${this.apiBase}/air/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Duffel-Version": "v2",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`[duffel] order creation failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as DuffelOrderResponse;
    return this.toOrder(json.data, params.offerId);
  }

  /**
   * Plaća "hold" order preko Duffel-ovog balance-a (§07 — Duffel je merchant
   * of record, ne prolazi kroz sopstveni PSP). arc_bsp_cash je alternativa za
   * agencije sa sopstvenim IATA/ARC odnosom — nije relevantno dok mi nemamo
   * takav odnos, pa se ne izlaže kroz ovaj adapter.
   */
  async payOrder(supplierOrderRef: string, amount: number, currency: string): Promise<Order> {
    const res = await fetch(`${this.apiBase}/air/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Duffel-Version": "v2",
      },
      body: JSON.stringify({
        data: { order_id: supplierOrderRef, payment: { type: "balance", currency, amount: amount.toFixed(2) } },
      }),
    });

    if (!res.ok) {
      throw new Error(`[duffel] payment failed: ${res.status} ${await res.text()}`);
    }
    (await res.json()) as DuffelPaymentResponse; // odgovor nosi samo order_id; puno stanje se čita posebno

    const orderRes = await fetch(`${this.apiBase}/air/orders/${supplierOrderRef}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Duffel-Version": "v2" },
    });
    if (!orderRes.ok) {
      throw new Error(`[duffel] order refetch after payment failed: ${orderRes.status} ${await orderRes.text()}`);
    }
    const json = (await orderRes.json()) as DuffelOrderResponse;
    return this.toOrder(json.data, "");
  }

  private toOrder(order: DuffelOrderResponse["data"], offerId: string): Order {
    const now = new Date().toISOString();
    return {
      orderId: order.id,
      supplierCode: "duffel",
      supplierOrderRef: order.booking_reference,
      offerId,
      status: order.documents.length > 0 ? "ticketed" : order.payment_status.awaiting_payment ? "pending" : "booked",
      price: { currency: order.total_currency, base: 0, taxes: 0, total: Number(order.total_amount) },
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Otkazivanje je dvofazno kod Duffel-a: prvo se traži kotacija (koliko će se
   * refundirati), pa se ta kotacija posebno potvrđuje. Ovo namerno ne vraća
   * novac odmah — booking saga (§05) treba da prikaže iznos refunda korisniku
   * pre potvrde, ili da ima svoju politiku za auto-potvrdu.
   */
  async quoteCancellation(_orderId: string, supplierOrderRef: string): Promise<CancelQuote> {
    const res = await fetch(`${this.apiBase}/air/order_cancellations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Duffel-Version": "v2",
      },
      body: JSON.stringify({ data: { order_id: supplierOrderRef } }),
    });

    if (!res.ok) {
      throw new Error(`[duffel] cancellation quote failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as DuffelOrderCancellationResponse;
    return {
      supplierCancellationRef: json.data.id,
      refundAmount: Number(json.data.refund_amount ?? 0),
      refundCurrency: json.data.refund_currency ?? "EUR",
      expiresAt: json.data.expires_at,
    };
  }

  async confirmCancellation(supplierCancellationRef: string): Promise<void> {
    const res = await fetch(
      `${this.apiBase}/air/order_cancellations/${supplierCancellationRef}/actions/confirm`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Duffel-Version": "v2",
        },
      }
    );

    if (!res.ok) {
      throw new Error(`[duffel] cancellation confirm failed: ${res.status} ${await res.text()}`);
    }
  }
}
