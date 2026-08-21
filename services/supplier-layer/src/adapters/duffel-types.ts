// Minimalan tip-safe presek Duffel Offer Requests API odgovora koji nam treba
// za mapiranje u interni Offer model (§03). Nije potpuna Duffel šema —
// samo polja koja koristimo. Videti: https://duffel.com/docs/api/offer-requests

export interface DuffelPlace {
  iata_code: string;
}

export interface DuffelCarrier {
  iata_code: string;
}

export interface DuffelSegment {
  origin: DuffelPlace;
  destination: DuffelPlace;
  departing_at: string;
  arriving_at: string;
  marketing_carrier: DuffelCarrier;
  operating_carrier: DuffelCarrier;
  marketing_carrier_flight_number: string;
  passengers?: Array<{
    cabin_class?: string;
    baggages?: Array<{ type: "checked" | "carry_on"; quantity: number }>;
  }>;
}

export interface DuffelSlice {
  segments: DuffelSegment[];
}

export interface DuffelConditionDetail {
  allowed: boolean;
}

export interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  base_amount: string;
  tax_amount: string;
  expires_at: string;
  slices: DuffelSlice[];
  conditions?: {
    refund_before_departure?: DuffelConditionDetail | null;
    change_before_departure?: DuffelConditionDetail | null;
  };
}

export interface DuffelOfferRequestResponse {
  data: {
    id: string;
    offers: DuffelOffer[];
  };
}

// Orders API — https://duffel.com/docs/api/orders
export interface DuffelOrder {
  id: string;
  booking_reference: string;
  total_amount: string;
  total_currency: string;
  payment_status: {
    awaiting_payment: boolean;
    payment_required_by: string | null;
    price_guarantee_expires_at: string | null;
  };
  documents: Array<{ type: string; unique_identifier: string }>;
}

export interface DuffelOrderResponse {
  data: DuffelOrder;
}

// Payments API — https://duffel.com/docs/api/payments/create-payment
export interface DuffelPaymentResponse {
  data: {
    order_id: string;
  };
}

// Order Cancellations API — https://duffel.com/docs/api/order-cancellations
export interface DuffelOrderCancellation {
  id: string;
  order_id: string;
  refund_amount: string | null;
  refund_currency: string | null;
  expires_at: string;
  confirmed_at: string | null;
}

export interface DuffelOrderCancellationResponse {
  data: DuffelOrderCancellation;
}

// Seat Maps API — https://duffel.com/docs/api/seat-maps
// Presek potvrđen iz zvanične dokumentacije: cabins → rows → sections →
// elements, gde selektabilna sedišta imaju type "seat" i available_services.
export interface DuffelSeatService {
  id: string;
  passenger_id: string;
  total_amount: string;
  total_currency: string;
}

export interface DuffelSeatMapElement {
  type: string; // "seat" za selektabilna sedišta, ostalo (npr. "bassinet_seat", "empty") preskačemo
  designator?: string;
  name?: string;
  available_services?: DuffelSeatService[];
}

export interface DuffelSeatMapSection {
  elements: DuffelSeatMapElement[];
}

export interface DuffelSeatMapRow {
  sections: DuffelSeatMapSection[];
}

export interface DuffelSeatMapCabin {
  rows: DuffelSeatMapRow[];
}

export interface DuffelSeatMap {
  id: string;
  segment_id: string;
  slice_id: string;
  cabins: DuffelSeatMapCabin[];
}

export interface DuffelSeatMapResponse {
  data: DuffelSeatMap[];
}
