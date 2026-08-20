import type { Offer } from "@terminal-flights/shared-types";
import type { SearchParams, SupplierAdapter } from "./adapter.js";

/**
 * Sabre adapter — NIJE implementiran.
 *
 * Zahteva potpisan komercijalni ugovor, PCC (Pseudo City Code) i EPR
 * (Employee Profile Record) pre nego što Dev Studio dokumentacija/sandbox
 * uopšte postanu dostupni. Sertifikacija traje 4–8 nedelja (ukupno "meseci
 * do godinu dana" po iskustvima integratora). search() vraća praznu listu
 * dok ovaj pristup ne bude obezbeđen. Kad bude: OAuth2 (POST /v2/auth/token)
 * + Bargain Finder Max v5 (POST /v5/offers/shop) za search, Create Passenger
 * Name Record (v230) za booking u jednom pozivu, Booking Management API za
 * cancel/void. Napomena: deo servisiranja (starije post-booking operacije)
 * i dalje ide preko SOAP/XML (OTA_* poruke), ne samo REST/JSON.
 */
export class SabreAdapter implements SupplierAdapter {
  readonly code = "sabre";

  async search(_params: SearchParams): Promise<Offer[]> {
    return [];
  }
}
