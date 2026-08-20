import type { Offer } from "@terminal-flights/shared-types";

export interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: { adults: number; children?: number; infants?: number };
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

/**
 * Zajednički ugovor koji svaki supplier adapter mora da implementira (§03).
 * Domenski servisi iznad ovog sloja (Search & Shopping, §04) pozivaju samo ovaj
 * interfejs i nikad ne znaju odakle je let stigao.
 */
export interface SupplierAdapter {
  readonly code: string;
  search(params: SearchParams): Promise<Offer[]>;
}
