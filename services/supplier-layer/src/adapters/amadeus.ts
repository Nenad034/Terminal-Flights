import type { Offer } from "@terminal-flights/shared-types";
import type { SearchParams, SupplierAdapter } from "./adapter.js";

/**
 * Amadeus adapter — NIJE implementiran.
 *
 * Amadeus Self-Service API portal je ugašen (potpuna dekomisija 17.7.2026).
 * Jedini preostali put je Amadeus Quick Connect (AQC) ili Enterprise ugovor —
 * oba zahtevaju prodajni razgovor pre nego što postoji bilo šta za testiranje.
 * search() vraća praznu listu (isti obrazac kao DuffelAdapter bez ključa) tako
 * da ostatak sistema (search fan-out, ranking) radi normalno dok ovaj
 * dobavljač nije aktivan. Kad se obezbedi AQC/Enterprise pristup, implementira
 * se OAuth2 (POST /v1/security/oauth2/token) + Flight Offers Search
 * (GET /v2/shopping/flight-offers) + Flight Offers Price (potvrda cene pre
 * booking-a) + Flight Create Orders (POST /v1/booking/flight-orders).
 */
export class AmadeusAdapter implements SupplierAdapter {
  readonly code = "amadeus";

  async search(_params: SearchParams): Promise<Offer[]> {
    return [];
  }
}
