import type { Order } from "@terminal-flights/shared-types";
import type { Offer } from "@terminal-flights/shared-types";

export interface SearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: { adults: number; children?: number; infants?: number };
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

export interface PassengerDetails {
  givenName: string;
  familyName: string;
  bornOn: string; // ISO date
  gender: "m" | "f";
  email: string;
  phoneNumber: string;
}

export interface CardPayment {
  threeDSecureSessionId: string;
  amount: number;
  currency: string;
}

export interface CreateOrderParams {
  offerId: string;
  supplierOfferRef: string;
  passengers: PassengerDetails[];
  /** ID-jevi ancillary usluga (npr. sedišta) iz getAncillaries(), §07. */
  serviceIds?: string[];
  /**
   * Kad je prisutno, order se plaća direktno karticom korisnika pri
   * kreiranju (§07 — Duffel je merchant of record). threeDSecureSessionId
   * dolazi sa klijenta, iz Duffel-ove komponente za kartice (PCI-compliant,
   * broj kartice nikad ne prolazi kroz naš server). Bez ovoga, order se
   * pravi kao "hold" i plaća se odvojeno preko payOrder() — §07 balance tok,
   * koristan za scenarije bez korisničke kartice (npr. buduće GDS
   * dobavljače gde smo mi merchant of record).
   */
  cardPayment?: CardPayment;
}

export interface CancelQuote {
  supplierCancellationRef: string;
  refundAmount: number;
  refundCurrency: string;
  expiresAt: string;
}

export interface AncillaryOption {
  serviceId: string;
  type: "seat";
  label: string; // npr. "12A"
  price: { currency: string; total: number };
}

/**
 * Zajednički ugovor koji svaki supplier adapter mora da implementira (§03).
 * Domenski servisi iznad ovog sloja (Search & Shopping §04, Booking & Order §05)
 * pozivaju samo ovaj interfejs i nikad ne znaju odakle je let stigao.
 *
 * createOrder/cancelOrder su opcioni jer neki dobavljači (npr. Amadeus, Sabre,
 * Travelport, Travelfusion) trenutno nisu sertifikovani/dostupni — njihovi
 * adapteri implementiraju samo search() dok se ne obezbedi produkcioni pristup.
 */
export interface SupplierAdapter {
  readonly code: string;
  search(params: SearchParams): Promise<Offer[]>;
  /**
   * Dodatne plaćene usluge dostupne za ponudu (§07 Ancillaries) — trenutno
   * samo sedišta, jer je to jedini deo Duffel Seat Maps API-ja koji je
   * potvrđen iz zvanične dokumentacije (prtljag ide kroz drugačiji,
   * neistražen deo API-ja — namerno nije uveden dok se ne proveri).
   */
  getAncillaries?(supplierOfferRef: string): Promise<AncillaryOption[]>;
  /**
   * Server-side korak pre nego što klijent prikaže formu za karticu (§07):
   * generiše kratkoročan ključ koji ovlašćuje Duffel-ovu client-side
   * komponentu za kartice da sigurno tokenizuje broj kartice, bez da on ikad
   * dođe do našeg servera. Vraća "component client key".
   */
  createCardPaymentSession?(): Promise<string>;
  createOrder?(params: CreateOrderParams): Promise<Order>;
  /**
   * Plaćanje "hold" order-a. Kod dobavljača koji su merchant of record
   * (Duffel, Travelfusion — §07) ovo skida sredstva direktno preko njihovog
   * API-ja, bez sopstvenog PSP-a. Kod GDS dobavljača (Amadeus/Sabre/Travelport)
   * mi smo MoR, pa bi payOrder tamo bio no-op — naplata ide preko sopstvenog
   * PSP-a (Stripe/Adyen) pre ovog koraka, van supplier adaptera.
   */
  payOrder?(supplierOrderRef: string, amount: number, currency: string): Promise<Order>;
  quoteCancellation?(orderId: string, supplierOrderRef: string): Promise<CancelQuote>;
  confirmCancellation?(supplierCancellationRef: string): Promise<void>;
}
