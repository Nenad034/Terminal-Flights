import type { Offer } from "@terminal-flights/shared-types";
import type { SearchParams, SupplierAdapter } from "./adapter.js";

/**
 * Travelport adapter — NIJE implementiran.
 *
 * "Galileo" nije posebna API — to je legacy GDS brend (uz Apollo/Worldspan)
 * koji se danas pristupa kroz jedinstveni Travelport API (Travelport+ JSON
 * Suite). Zahteva potpisan ugovor + PCC provisioning (depozit ~$2000) +
 * najmanje 15 radnih dana najave za sertifikaciju, ali ima 30-dnevni
 * besplatan sandbox trial bez ugovora za evaluaciju. search() vraća praznu
 * listu dok pristup ne bude obezbeđen. Kad bude implementiran: OAuth2
 * (POST auth.travelport.net/oauth/token) + shopping (POST
 * catalog/search/catalogproductofferings) + pricing (POST
 * price/offers/buildfromcatalogproductofferings) + booking preko stateful
 * "reservation workbench" toka (search → price → book/session →
 * book/reservation) — drugačija orkestracija od Duffel-ovog jednog poziva,
 * jer Travelport drži sesijsko stanje kroz workbenchID.
 */
export class TravelportAdapter implements SupplierAdapter {
  readonly code = "travelport";

  async search(_params: SearchParams): Promise<Offer[]> {
    return [];
  }
}
