import type { FareRules, FlightSegment, Offer, Order } from "@terminal-flights/shared-types";
import type { AncillaryOption, CancelQuote, CreateOrderParams, SearchParams, SupplierAdapter } from "./adapter.js";
import type {
  DuffelComponentClientKeyResponse,
  DuffelOffer,
  DuffelOfferRequestResponse,
  DuffelOfferWithAvailableServicesResponse,
  DuffelOrderCancellationResponse,
  DuffelOrderResponse,
  DuffelPaymentResponse,
  DuffelSeatMapResponse,
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
      passengerIds: offer.passengers?.map((p) => p.id),
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
   * Dodatne plaćene usluge za ponudu (§07 Ancillaries): sedišta + prtljag.
   * Dva nezavisna Duffel API poziva jer žive na različitim endpoint-ima
   * (seat maps vs. ponuda sa `return_available_services=true`) — jedan koji
   * padne ne sme da obori drugi, pa se svaki gracioznо svodi na [] na grešku.
   */
  async getAncillaries(supplierOfferRef: string): Promise<AncillaryOption[]> {
    if (!this.apiKey) {
      // Isti obrazac kao search() — bez ključa, prazna lista umesto pucanja.
      return [];
    }

    const [seats, baggage] = await Promise.all([
      this.getSeatOptions(supplierOfferRef),
      this.getBaggageOptions(supplierOfferRef),
    ]);
    return [...seats, ...baggage];
  }

  /**
   * Sedišta dostupna za ponudu. Spljoštava Duffel-ovu ugnježdenu strukturu
   * (cabins → rows → sections → elements) u ravnu listu — dovoljno za
   * jednostavan UI izbor sedišta, ne za vizuelni seat-map.
   */
  private async getSeatOptions(supplierOfferRef: string): Promise<AncillaryOption[]> {
    const res = await fetch(`${this.apiBase}/air/seat_maps?offer_id=${supplierOfferRef}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Duffel-Version": "v2" },
    });

    if (!res.ok) {
      console.error(`[duffel] seat map fetch failed: ${res.status} ${await res.text()}`);
      return [];
    }

    const json = (await res.json()) as DuffelSeatMapResponse;
    const options: AncillaryOption[] = [];

    for (const seatMap of json.data) {
      for (const cabin of seatMap.cabins) {
        for (const row of cabin.rows) {
          for (const section of row.sections) {
            for (const element of section.elements) {
              if (element.type !== "seat" || !element.designator) continue;
              for (const service of element.available_services ?? []) {
                options.push({
                  serviceId: service.id,
                  type: "seat",
                  label: element.designator,
                  price: { currency: service.total_currency, total: Number(service.total_amount) },
                  passengerIds: [service.passenger_id],
                });
              }
            }
          }
        }
      }
    }

    return options;
  }

  /**
   * Dodatni prtljag — Duffel ga ne izlaže preko seat_maps, nego kao
   * `available_services` na samoj ponudi, dostupno samo kad se ponuda ponovo
   * pročita sa `return_available_services=true` (potvrđeno iz "Adding Extra
   * Bags" vodiča i Offers šeme; `metadata` sa težinom/dimenzijama nije
   * dokumentovan pa se ne koristi — vidi napomenu u duffel-types.ts).
   */
  private async getBaggageOptions(supplierOfferRef: string): Promise<AncillaryOption[]> {
    const res = await fetch(`${this.apiBase}/air/offers/${supplierOfferRef}?return_available_services=true`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Duffel-Version": "v2" },
    });

    if (!res.ok) {
      console.error(`[duffel] offer available_services fetch failed: ${res.status} ${await res.text()}`);
      return [];
    }

    const json = (await res.json()) as DuffelOfferWithAvailableServicesResponse;
    return (json.data.available_services ?? [])
      .filter((service) => service.type === "baggage")
      .map((service) => ({
        serviceId: service.id,
        type: "baggage" as const,
        label: "Dodatni prtljag",
        price: { currency: service.total_currency, total: Number(service.total_amount) },
        maxQuantity: service.maximum_quantity,
        passengerIds: service.passenger_ids,
      }));
  }

  /**
   * Generiše "component client key" (§07) — server-side korak koji ovlašćuje
   * Duffel-ovu client-side komponentu za kartice (npr. DuffelCardForm iz
   * @duffel/components, još neintegrisano na frontendu — videti README) da
   * sigurno tokenizuje karticu. Bez tela zahteva; potvrđeno iz zvanične
   * dokumentacije (POST /identity/component_client_keys → data.component_client_key).
   */
  async createCardPaymentSession(): Promise<string> {
    const res = await fetch(`${this.apiBase}/identity/component_client_keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Duffel-Version": "v2",
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      throw new Error(`[duffel] component client key creation failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as DuffelComponentClientKeyResponse;
    return json.data.component_client_key;
  }

  /**
   * Kreira order. Dva moda:
   * - `cardPayment` prisutno: order je "instant" i plaća se odmah karticom
   *   korisnika preko `three_d_secure_session_id` (§07, Duffel MoR) — nema
   *   posebnog payOrder() koraka posle ovoga, saga to prepoznaje po statusu.
   * - `cardPayment` odsutno: order je "hold" (nenaplaćen), plaćanje ide kroz
   *   poseban payOrder() poziv (balance tok, §07) — koristan bez korisničke
   *   kartice.
   */
  async createOrder(params: CreateOrderParams): Promise<Order> {
    const body = {
      data: {
        type: params.cardPayment ? "instant" : "hold",
        selected_offers: [params.supplierOfferRef],
        passengers: params.passengers.map((p) => ({
          given_name: p.givenName,
          family_name: p.familyName,
          born_on: p.bornOn,
          gender: p.gender,
          email: p.email,
          phone_number: p.phoneNumber,
        })),
        // { id, quantity } oblik potvrđen iz zvanične dokumentacije ("Adding
        // Extra Bags" vodič). serviceIds je ravna lista (isti ID ponovljen
        // onoliko puta koliki je quantity — npr. dve iste torbe → ID dvaput)
        // da bi ostatak sistema (booking saga, frontend) mogao jednostavno
        // da sabira cene bez posebnog quantity polja; ovde se grupiše nazad.
        ...(params.serviceIds && params.serviceIds.length > 0
          ? { services: this.groupServiceIds(params.serviceIds) }
          : {}),
        ...(params.cardPayment
          ? {
              payments: [
                {
                  type: "card",
                  currency: params.cardPayment.currency,
                  amount: params.cardPayment.amount.toFixed(2),
                  three_d_secure_session_id: params.cardPayment.threeDSecureSessionId,
                },
              ],
            }
          : {}),
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

  private groupServiceIds(serviceIds: string[]): Array<{ id: string; quantity: number }> {
    const quantities = new Map<string, number>();
    for (const id of serviceIds) quantities.set(id, (quantities.get(id) ?? 0) + 1);
    return Array.from(quantities.entries()).map(([id, quantity]) => ({ id, quantity }));
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
