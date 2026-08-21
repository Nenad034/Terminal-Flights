// Terminal Flights — deljeni interni modeli
// Poglavlje §03 (Supplier Abstraction Layer): zajednički Offer/Order model, bez obzira odakle je let stigao.
// Poglavlje §06 (Trip Composition): Trip je samo deljeni identifikator, ne agregat tuđih podataka.

export type SupplierCode =
  | "amadeus"
  | "sabre"
  | "travelport"
  | "travelfusion"
  | "duffel"
  | "ndc-direct";

export interface FareRules {
  refundable: boolean;
  changeable: boolean;
  checkedBagsIncluded: number;
  cabinBagsIncluded: number;
}

export interface PriceBreakdown {
  currency: string;
  base: number;
  taxes: number;
  total: number;
}

export interface FlightSegment {
  origin: string; // IATA code
  destination: string; // IATA code
  departureAt: string; // ISO 8601
  arrivalAt: string; // ISO 8601
  marketingCarrier: string; // IATA airline code
  operatingCarrier: string;
  flightNumber: string;
  cabinClass: "economy" | "premium_economy" | "business" | "first";
}

/**
 * Zajednički interni model ponude — svaki supplier adapter mapira svoj odgovor u ovo,
 * tako da domenski servisi (Search, Booking) nikad ne znaju odakle je let stigao. (§03)
 */
export interface Offer {
  offerId: string;
  supplierCode: SupplierCode;
  supplierOfferRef: string;
  segments: FlightSegment[];
  price: PriceBreakdown;
  fareRules: FareRules;
  expiresAt: string; // price-freeze TTL, §04
  /**
   * Dobavljačevi interni ID-jevi putnika, istim redosledom kojim su poslati
   * u search zahtevu (§07 Ancillaries) — koristi se da se sedište/prtljag iz
   * getAncillaries() ispravno pripiše tačnom putniku iz našeg booking
   * zahteva (passengers[i] ↔ passengerIds[i]).
   */
  passengerIds?: string[];
}

export type OrderStatus =
  | "pending"
  | "booked"
  | "ticketed"
  | "cancelled"
  | "failed";

/**
 * Zajednički interni model rezervacije. (§03, §05)
 */
export interface Order {
  orderId: string;
  tripId?: string;
  supplierCode: SupplierCode;
  supplierOrderRef?: string;
  offerId: string;
  status: OrderStatus;
  price: PriceBreakdown;
  createdAt: string;
  updatedAt: string;
}

/**
 * Trip Composition ugovor (§06) — deljeni identifikator koji izdaje Flights modul.
 * Drugi moduli (hotel/transfer) se referenciraju na isti trip_id, ali ostaju vlasnici
 * svog Order-a. Flights ne zna kako ti moduli rade iznutra.
 */
export interface Trip {
  tripId: string;
  createdAt: string;
}

export type TripCompositionEvent =
  | { type: "trip.item.requested"; tripId: string; module: string }
  | { type: "trip.item.confirmed"; tripId: string; module: string }
  | { type: "trip.item.failed"; tripId: string; module: string; reason: string };
