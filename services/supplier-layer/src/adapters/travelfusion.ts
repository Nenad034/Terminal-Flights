import type { Offer } from "@terminal-flights/shared-types";
import type { SearchParams, SupplierAdapter } from "./adapter.js";

/**
 * Travelfusion adapter — NIJE implementiran.
 *
 * LCC agregator (Direct Connect XML API, plus noviji tfFlight/NDC API).
 * Puna dokumentacija je iza login-a (xmldocs.travelfusion.com) — dostupna
 * tek nakon potpisane licence (sales@travelfusion.com). Auth model je
 * XmlLoginId/LoginId po zahtevu (ne OAuth token). search() vraća praznu
 * listu dok se ugovor ne obezbedi i dok se ne potvrdi koji od tri API
 * generacije (classic XML / tfFlight / NDC) će biti provisioned — struktura
 * se razlikuje dovoljno da nema smisla nagađati mapiranje unapred.
 *
 * Napomena: atlaslovestravel.com (Atlas / ATRIP platforma) je alternativa u
 * istoj niši — moderniji REST/JSON tok (search.do → getOffers.do →
 * getOfferPrice.do → order.do → pay.do), ali bez nezavisne potvrde
 * ozbiljnosti platforme. Ako se odluči za Atlas umesto Travelfusion-a, ovaj
 * fajl bi trebalo preimenovati/zameniti, ne dupliraju se supplierCode sloti.
 */
export class TravelfusionAdapter implements SupplierAdapter {
  readonly code = "travelfusion";

  async search(_params: SearchParams): Promise<Offer[]> {
    return [];
  }
}
