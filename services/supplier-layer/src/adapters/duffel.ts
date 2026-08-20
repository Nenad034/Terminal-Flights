import type { FareRules, FlightSegment, Offer } from "@terminal-flights/shared-types";
import type { SearchParams, SupplierAdapter } from "./adapter.js";
import type { DuffelOffer, DuffelOfferRequestResponse, DuffelSegment } from "./duffel-types.js";

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
}
