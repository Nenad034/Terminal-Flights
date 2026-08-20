"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

interface SearchOffer {
  offerId: string;
  supplierCode: string;
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

// Minimalna search forma (§04 Search & Shopping) — puni ranking/price-freeze UX
// dolazi kad search-fanout servis vraća stvarne Offer podatke iz supplier-layer-a.
export function SearchForm() {
  const [origin, setOrigin] = useState("BEG");
  const [destination, setDestination] = useState("JFK");
  const [departureDate, setDepartureDate] = useState("");

  const mutation = useMutation({
    mutationFn: searchFlights,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({ origin, destination, departureDate });
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
          disabled={mutation.isPending}
        >
          {mutation.isPending ? "Tražim..." : "Pretraži letove"}
        </button>
      </form>

      {mutation.isError && (
        <p className="text-sm text-red-400">
          Greška pri pretrazi — proveri da li su servisi (supplier-layer, search-fanout) pokrenuti.
        </p>
      )}

      {mutation.isSuccess && (
        <div className="text-sm text-slate-300">
          {mutation.data.offers.length === 0 ? (
            <p>Nema ponuda (F0 skeleton — Duffel adapter još nije povezan na pravi API ključ).</p>
          ) : (
            <ul className="space-y-2">
              {mutation.data.offers.map((offer) => (
                <li key={offer.offerId} className="rounded-md border border-slate-800 p-3">
                  {offer.supplierCode} · {offer.offerId}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
