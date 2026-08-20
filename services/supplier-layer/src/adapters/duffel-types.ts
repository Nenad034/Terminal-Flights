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
