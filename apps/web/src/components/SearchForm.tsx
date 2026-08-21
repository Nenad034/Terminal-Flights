"use client";

import { DuffelCardForm, createThreeDSecureSession, useDuffelCardFormActions } from "@duffel/components";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

interface FlightSegment {
  marketingCarrier: string;
  flightNumber: string;
  departureAt: string;
}

interface PriceBreakdown {
  currency: string;
  total: number;
}

interface SearchOffer {
  offerId: string;
  supplierCode: string;
  supplierOfferRef: string;
  segments: FlightSegment[];
  price: PriceBreakdown;
  expiresAt: string;
}

interface Passenger {
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: "m" | "f";
  email: string;
  phoneNumber: string;
}

interface BookedOrder {
  orderId: string;
  status: string;
  supplierOrderRef?: string;
}

interface CancellationQuote {
  supplierCancellationRef: string;
  refundAmount: number;
  refundCurrency: string;
  expiresAt: string;
}

interface AncillaryOption {
  serviceId: string;
  type: "seat" | "baggage";
  label: string;
  price: { currency: string; total: number };
  maxQuantity?: number;
}

interface AncillarySelection {
  serviceId: string;
  quantity: number;
  amount: number;
}

async function searchFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
  passengers: { adults: number };
}) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Search failed");
  return (await res.json()) as { offers: SearchOffer[] };
}

async function fetchAncillaries(offer: SearchOffer) {
  const res = await fetch("/api/ancillaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCode: offer.supplierCode, supplierOfferRef: offer.supplierOfferRef }),
  });
  // 501 (dobavljač ne podržava ancillaries) tretiramo kao "nema opcija", ne kao grešku.
  if (res.status === 501) return [];
  const data = (await res.json()) as { options?: AncillaryOption[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Ancillaries fetch failed");
  return data.options!;
}

// Pretvara izabrane ancillary-je (sedište + prtljag sa količinama) u ravnu
// listu serviceId-jeva — isti ID ponovljen onoliko puta koliki je quantity
// (npr. dve iste torbe → ID dvaput). Supplier-layer grupiše nazad po
// dobavljaču (§07, videti komentar u duffel.ts createOrder).
function flattenAncillaryIds(selections: AncillarySelection[]): string[] {
  return selections.flatMap((s) => Array(s.quantity).fill(s.serviceId));
}

function ancillariesAmount(selections: AncillarySelection[]): number {
  return selections.reduce((sum, s) => sum + s.amount, 0);
}

async function bookOffer(
  offer: SearchOffer,
  passengers: Passenger[],
  ancillarySelections: AncillarySelection[],
  cardPayment: { threeDSecureSessionId: string } | null
) {
  // Duffel naplaćuje po ponudi, ne po putniku — offer.price.total već
  // pokriva sve putnike iz search zahteva. Ancillary-ji su trenutno
  // ograničeni na 1 putnika (vidi komentar u UI-ju) pa ovde nema potrebe za
  // sumiranjem po putniku.
  const totalAmount = offer.price.total + ancillariesAmount(ancillarySelections);
  const serviceIds = flattenAncillaryIds(ancillarySelections);

  const res = await fetch("/api/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: offer.offerId,
      supplierCode: offer.supplierCode,
      supplierOfferRef: offer.supplierOfferRef,
      expiresAt: offer.expiresAt,
      currency: offer.price.currency,
      totalAmount,
      passengers,
      serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      cardPayment: cardPayment
        ? { threeDSecureSessionId: cardPayment.threeDSecureSessionId, amount: totalAmount, currency: offer.price.currency }
        : undefined,
    }),
  });
  const data = (await res.json()) as { order?: BookedOrder; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Booking failed");
  return data.order!;
}

async function fetchPaymentSession(supplierCode: string) {
  const res = await fetch("/api/payment-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCode }),
  });
  // 501 (dobavljač ne podržava kartično plaćanje preko sebe) tretiramo kao
  // "nema kartičnog plaćanja", ne kao grešku — pada se na "hold" tok.
  if (res.status === 501) return null;
  const data = (await res.json()) as { componentClientKey?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Payment session fetch failed");
  return data.componentClientKey!;
}

// Vodi klijent kroz Duffel-ov 3DS tok (§07): kartica je već tokenizovana
// (cardId, iz DuffelCardForm-a), ovde se traži 3DS sesija za tačan iznos i
// tek onda šalje order sa payments:[{type:"card", three_d_secure_session_id}].
async function payWithCard(
  offer: SearchOffer,
  clientKey: string,
  cardId: string,
  ancillarySelections: AncillarySelection[],
  passengers: Passenger[]
) {
  const services = ancillarySelections.map((s) => ({ id: s.serviceId, quantity: s.quantity }));
  const session = await createThreeDSecureSession(clientKey, cardId, offer.supplierOfferRef, services, true);
  if (session.status !== "ready_for_payment") {
    throw new Error(`3D Secure autentikacija nije uspela (status: ${session.status})`);
  }
  return bookOffer(offer, passengers, ancillarySelections, { threeDSecureSessionId: session.id });
}

async function quoteCancellation(orderId: string) {
  const res = await fetch(`/api/booking/${orderId}/cancellation-quote`, { method: "POST" });
  const data = (await res.json()) as { quote?: CancellationQuote; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Cancellation quote failed");
  return data.quote!;
}

async function confirmCancellation(orderId: string, supplierCancellationRef: string) {
  const res = await fetch(`/api/booking/${orderId}/cancellation-confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCancellationRef }),
  });
  const data = (await res.json()) as { order?: BookedOrder; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Cancellation confirm failed");
  return data.order!;
}

const emptyPassenger: Passenger = {
  givenName: "",
  familyName: "",
  bornOn: "",
  gender: "m",
  email: "",
  phoneNumber: "",
};

// Minimalna search + booking forma (§04/§05) — puni ranking/price-freeze UX
// dolazi kasnije. Za sada: pretraži (sa brojem putnika) → izaberi ponudu →
// unesi podatke za svakog putnika → rezerviši.
export function SearchForm() {
  const [origin, setOrigin] = useState("BEG");
  const [destination, setDestination] = useState("JFK");
  const [departureDate, setDepartureDate] = useState("");
  const [adults, setAdults] = useState(1);
  const [selectedOffer, setSelectedOffer] = useState<SearchOffer | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([emptyPassenger]);
  const [selectedSeat, setSelectedSeat] = useState<AncillaryOption | null>(null);
  const [bagQuantities, setBagQuantities] = useState<Record<string, number>>({});
  const [cardFormError, setCardFormError] = useState<string | null>(null);

  const { ref: cardFormRef, createCardForTemporaryUse } = useDuffelCardFormActions();

  const searchMutation = useMutation({ mutationFn: searchFlights });
  const ancillariesQuery = useQuery({
    queryKey: ["ancillaries", selectedOffer?.offerId],
    queryFn: () => fetchAncillaries(selectedOffer!),
    enabled: selectedOffer !== null,
  });
  const seatOptions = ancillariesQuery.data?.filter((a) => a.type === "seat") ?? [];
  const baggageOptions = ancillariesQuery.data?.filter((a) => a.type === "baggage") ?? [];
  const ancillarySelections: AncillarySelection[] = [
    ...(selectedSeat ? [{ serviceId: selectedSeat.serviceId, quantity: 1, amount: selectedSeat.price.total }] : []),
    ...baggageOptions
      .filter((bag) => (bagQuantities[bag.serviceId] ?? 0) > 0)
      .map((bag) => ({
        serviceId: bag.serviceId,
        quantity: bagQuantities[bag.serviceId],
        amount: bag.price.total * bagQuantities[bag.serviceId],
      })),
  ];
  // 501 (dobavljač ne podržava kartično plaćanje preko sebe, §07) → nema
  // DuffelCardForm-a, tok pada na direktno kreiranje "hold" order-a.
  const paymentSessionQuery = useQuery({
    queryKey: ["payment-session", selectedOffer?.supplierCode],
    queryFn: () => fetchPaymentSession(selectedOffer!.supplierCode),
    enabled: selectedOffer !== null,
  });
  const bookMutation = useMutation({
    mutationFn: (p: Passenger[]) => bookOffer(selectedOffer!, p, ancillarySelections, null),
  });
  const cardBookMutation = useMutation({
    mutationFn: (cardId: string) =>
      payWithCard(selectedOffer!, paymentSessionQuery.data!, cardId, ancillarySelections, passengers),
  });
  const bookedOrder = cardBookMutation.data ?? bookMutation.data;
  const isBooking = bookMutation.isPending || cardBookMutation.isPending;
  const bookingErrorMessage =
    cardFormError ??
    (bookMutation.error as Error | null)?.message ??
    (cardBookMutation.error as Error | null)?.message ??
    null;
  const quoteMutation = useMutation({
    mutationFn: (orderId: string) => quoteCancellation(orderId),
  });
  const confirmMutation = useMutation({
    mutationFn: (ref: string) => confirmCancellation(bookedOrder!.orderId, ref),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSelectedOffer(null);
          bookMutation.reset();
          searchMutation.mutate({ origin, destination, departureDate, passengers: { adults } });
        }}
      >
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Polazak
          <input
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 uppercase text-slate-100"
            value={origin}
            onChange={(e) => setOrigin(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Odredište
          <input
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 uppercase text-slate-100"
            value={destination}
            onChange={(e) => setDestination(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Datum polaska
          <input
            type="date"
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={departureDate}
            onChange={(e) => setDepartureDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-300">
          Putnici
          <input
            type="number"
            min={1}
            max={9}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            value={adults}
            onChange={(e) => setAdults(Math.min(9, Math.max(1, Number(e.target.value) || 1)))}
          />
        </label>
        <button
          type="submit"
          className="col-span-full rounded-md bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50"
          disabled={searchMutation.isPending}
        >
          {searchMutation.isPending ? "Tražim..." : "Pretraži letove"}
        </button>
      </form>

      {searchMutation.isError && (
        <p className="text-sm text-red-400">
          Greška pri pretrazi — proveri da li su servisi (supplier-layer, search-fanout) pokrenuti.
        </p>
      )}

      {searchMutation.isSuccess && (
        <div className="text-sm text-slate-300">
          {searchMutation.data.offers.length === 0 ? (
            <p>Nema ponuda (Duffel adapter možda nema API ključ, ili ova ruta nema letove u test modu).</p>
          ) : (
            <ul className="space-y-2">
              {searchMutation.data.offers.map((offer) => (
                <li
                  key={offer.offerId}
                  className={`cursor-pointer rounded-md border p-3 transition ${
                    selectedOffer?.offerId === offer.offerId
                      ? "border-blue-500 bg-blue-950/40"
                      : "border-slate-800 hover:border-slate-600"
                  }`}
                  onClick={() => {
                    setSelectedOffer(offer);
                    setSelectedSeat(null);
                    setBagQuantities({});
                    setPassengers(Array.from({ length: adults }, () => ({ ...emptyPassenger })));
                    bookMutation.reset();
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="uppercase text-slate-400">{offer.supplierCode}</span>
                    <span className="font-semibold text-slate-100">
                      {offer.price.total} {offer.price.currency}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {offer.segments
                      .map((s) => `${s.marketingCarrier}${s.flightNumber} @ ${s.departureAt}`)
                      .join(" → ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedOffer && (
        <form
          className="space-y-3 border-t border-slate-800 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setCardFormError(null);
            bookMutation.reset();
            cardBookMutation.reset();
            if (paymentSessionQuery.data) {
              // Karta se tokenizuje u Duffel-ovom iframe-u (broj kartice
              // nikad ne prolazi kroz naš kod) — rezultat stiže preko
              // onCreateCardForTemporaryUseSuccess/-Failure ispod, koji
              // nastavljaju na 3DS + booking (payWithCard).
              createCardForTemporaryUse();
            } else {
              bookMutation.mutate(passengers);
            }
          }}
        >
          <p className="text-sm text-slate-300">
            Rezervacija za {selectedOffer.price.total + ancillariesAmount(ancillarySelections)}{" "}
            {selectedOffer.price.currency} — podaci putnika ({passengers.length})
          </p>

          {ancillariesQuery.isLoading && (
            <p className="text-xs text-slate-500">Proveravam dostupna sedišta i prtljag...</p>
          )}
          {/* Duffel-ov seat_maps/available_services odgovor vezuje sedište i
              prtljag za njihov interni passenger_id, a mi taj ID ne
              prikupljamo/pratimo za više putnika u ovoj fazi (§07 — videti
              komentar u duffel.ts) — zato je izbor ancillary-ja ograničen na
              rezervacije sa jednim putnikom dok se ne doda mapiranje po
              putniku. */}
          {passengers.length === 1 && seatOptions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Sedište (opciono)</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs transition ${
                    selectedSeat === null
                      ? "border-blue-500 text-blue-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                  onClick={() => setSelectedSeat(null)}
                >
                  Bez izbora
                </button>
                {seatOptions.map((seat) => (
                  <button
                    key={seat.serviceId}
                    type="button"
                    className={`rounded-md border px-2 py-1 text-xs transition ${
                      selectedSeat?.serviceId === seat.serviceId
                        ? "border-blue-500 text-blue-400"
                        : "border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                    onClick={() => setSelectedSeat(seat)}
                  >
                    {seat.label} · +{seat.price.total} {seat.price.currency}
                  </button>
                ))}
              </div>
            </div>
          )}

          {passengers.length === 1 && baggageOptions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Dodatni prtljag (opciono)</p>
              <div className="flex flex-wrap gap-3">
                {baggageOptions.map((bag) => {
                  const quantity = bagQuantities[bag.serviceId] ?? 0;
                  const max = bag.maxQuantity ?? 9;
                  return (
                    <div
                      key={bag.serviceId}
                      className="flex items-center gap-2 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300"
                    >
                      <span>
                        +{bag.price.total} {bag.price.currency}
                      </span>
                      <button
                        type="button"
                        aria-label={`Ukloni prtljag (${bag.label})`}
                        className="rounded border border-slate-600 px-1.5 text-slate-300 transition hover:border-slate-400 disabled:opacity-30"
                        disabled={quantity === 0}
                        onClick={() =>
                          setBagQuantities((q) => ({ ...q, [bag.serviceId]: Math.max(0, quantity - 1) }))
                        }
                      >
                        −
                      </button>
                      <span>{quantity}</span>
                      <button
                        type="button"
                        aria-label={`Dodaj prtljag (${bag.label})`}
                        className="rounded border border-slate-600 px-1.5 text-slate-300 transition hover:border-slate-400 disabled:opacity-30"
                        disabled={quantity >= max}
                        onClick={() =>
                          setBagQuantities((q) => ({ ...q, [bag.serviceId]: Math.min(max, quantity + 1) }))
                        }
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {passengers.map((passenger, i) => {
            const update = (patch: Partial<Passenger>) =>
              setPassengers(passengers.map((p, j) => (j === i ? { ...p, ...patch } : p)));

            return (
              <div key={i} className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Putnik {i + 1}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    required
                    placeholder="Ime"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.givenName}
                    onChange={(e) => update({ givenName: e.target.value })}
                  />
                  <input
                    required
                    placeholder="Prezime"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.familyName}
                    onChange={(e) => update({ familyName: e.target.value })}
                  />
                  <input
                    required
                    type="date"
                    placeholder="Datum rođenja"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.bornOn}
                    onChange={(e) => update({ bornOn: e.target.value })}
                  />
                  <select
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.gender}
                    onChange={(e) => update({ gender: e.target.value as "m" | "f" })}
                  >
                    <option value="m">Muško</option>
                    <option value="f">Žensko</option>
                  </select>
                  <input
                    required
                    type="email"
                    placeholder="Email"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.email}
                    onChange={(e) => update({ email: e.target.value })}
                  />
                  <input
                    required
                    placeholder="Telefon"
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                    value={passenger.phoneNumber}
                    onChange={(e) => update({ phoneNumber: e.target.value })}
                  />
                </div>
              </div>
            );
          })}

          {paymentSessionQuery.data && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-slate-500">Podaci kartice</p>
              <div className="rounded-md border border-slate-700 bg-slate-950 p-3">
                <DuffelCardForm
                  ref={cardFormRef}
                  clientKey={paymentSessionQuery.data}
                  intent="to-create-card-for-temporary-use"
                  onCreateCardForTemporaryUseSuccess={(card) => cardBookMutation.mutate(card.id)}
                  onCreateCardForTemporaryUseFailure={(err) => setCardFormError(err.message)}
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            disabled={isBooking}
          >
            {isBooking ? "Rezervišem..." : "Rezerviši"}
          </button>

          {bookingErrorMessage && <p className="text-sm text-red-400">{bookingErrorMessage}</p>}
          {bookedOrder && (
            <div className="space-y-2 text-sm text-emerald-400">
              <p>
                Order {bookedOrder.orderId} → status: {confirmMutation.data?.status ?? bookedOrder.status}
                {bookedOrder.supplierOrderRef && ` (PNR: ${bookedOrder.supplierOrderRef})`}
              </p>
              <Link href={`/booking/${bookedOrder.orderId}`} className="text-slate-400 underline">
                Sačuvaj link za kasniji pregled rezervacije
              </Link>

              {confirmMutation.isSuccess ? (
                <p className="text-slate-300">Rezervacija otkazana.</p>
              ) : (
                <div className="space-y-2">
                  {!quoteMutation.data && (
                    <button
                      type="button"
                      className="rounded-md border border-red-500 px-3 py-1.5 text-red-400 transition hover:bg-red-950/40 disabled:opacity-50"
                      disabled={quoteMutation.isPending}
                      onClick={() => quoteMutation.mutate(bookedOrder.orderId)}
                    >
                      {quoteMutation.isPending ? "Proveravam uslove..." : "Otkaži rezervaciju"}
                    </button>
                  )}

                  {quoteMutation.isError && (
                    <p className="text-red-400">{(quoteMutation.error as Error).message}</p>
                  )}

                  {quoteMutation.isSuccess && (
                    <div className="space-y-2 rounded-md border border-slate-800 p-3 text-slate-300">
                      <p>
                        Refund: {quoteMutation.data.refundAmount} {quoteMutation.data.refundCurrency} (kotacija
                        važi do {quoteMutation.data.expiresAt})
                      </p>
                      <button
                        type="button"
                        className="rounded-md bg-red-600 px-3 py-1.5 font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                        disabled={confirmMutation.isPending}
                        onClick={() => confirmMutation.mutate(quoteMutation.data.supplierCancellationRef)}
                      >
                        {confirmMutation.isPending ? "Otkazujem..." : "Potvrdi otkazivanje"}
                      </button>
                      {confirmMutation.isError && (
                        <p className="text-red-400">{(confirmMutation.error as Error).message}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
