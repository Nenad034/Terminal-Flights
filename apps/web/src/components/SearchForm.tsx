"use client";

import { useMutation } from "@tanstack/react-query";
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

async function searchFlights(params: {
  origin: string;
  destination: string;
  departureDate: string;
}) {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Search failed");
  return (await res.json()) as { offers: SearchOffer[] };
}

async function bookOffer(offer: SearchOffer, passenger: Passenger) {
  const res = await fetch("/api/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: offer.offerId,
      supplierCode: offer.supplierCode,
      supplierOfferRef: offer.supplierOfferRef,
      expiresAt: offer.expiresAt,
      currency: offer.price.currency,
      totalAmount: offer.price.total,
      passengers: [passenger],
    }),
  });
  const data = (await res.json()) as { order?: BookedOrder; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Booking failed");
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
// i višeputnički checkout dolaze kasnije. Za sada: pretraži → izaberi ponudu
// → unesi jednog putnika → rezerviši.
export function SearchForm() {
  const [origin, setOrigin] = useState("BEG");
  const [destination, setDestination] = useState("JFK");
  const [departureDate, setDepartureDate] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<SearchOffer | null>(null);
  const [passenger, setPassenger] = useState<Passenger>(emptyPassenger);

  const searchMutation = useMutation({ mutationFn: searchFlights });
  const bookMutation = useMutation({
    mutationFn: (p: Passenger) => bookOffer(selectedOffer!, p),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSelectedOffer(null);
          bookMutation.reset();
          searchMutation.mutate({ origin, destination, departureDate });
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
            bookMutation.mutate(passenger);
          }}
        >
          <p className="text-sm text-slate-300">
            Rezervacija za {selectedOffer.price.total} {selectedOffer.price.currency} — podaci putnika
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              required
              placeholder="Ime"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={passenger.givenName}
              onChange={(e) => setPassenger({ ...passenger, givenName: e.target.value })}
            />
            <input
              required
              placeholder="Prezime"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={passenger.familyName}
              onChange={(e) => setPassenger({ ...passenger, familyName: e.target.value })}
            />
            <input
              required
              type="date"
              placeholder="Datum rođenja"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={passenger.bornOn}
              onChange={(e) => setPassenger({ ...passenger, bornOn: e.target.value })}
            />
            <select
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={passenger.gender}
              onChange={(e) => setPassenger({ ...passenger, gender: e.target.value as "m" | "f" })}
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
              onChange={(e) => setPassenger({ ...passenger, email: e.target.value })}
            />
            <input
              required
              placeholder="Telefon"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              value={passenger.phoneNumber}
              onChange={(e) => setPassenger({ ...passenger, phoneNumber: e.target.value })}
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            disabled={bookMutation.isPending}
          >
            {bookMutation.isPending ? "Rezervišem..." : "Rezerviši"}
          </button>

          {bookMutation.isError && (
            <p className="text-sm text-red-400">{(bookMutation.error as Error).message}</p>
          )}
          {bookMutation.isSuccess && (
            <p className="text-sm text-emerald-400">
              Order {bookMutation.data.orderId} → status: {bookMutation.data.status}
              {bookMutation.data.supplierOrderRef && ` (PNR: ${bookMutation.data.supplierOrderRef})`}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
