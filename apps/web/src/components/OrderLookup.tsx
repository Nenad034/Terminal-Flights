"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Manage booking (§12 self-service): korisnik koji nema sačuvan link i dalje
// može da pronađe rezervaciju ako zna orderId (npr. iz email potvrde, kad
// ta funkcionalnost bude postojala).
export function OrderLookup() {
  const [orderId, setOrderId] = useState("");
  const router = useRouter();

  return (
    <form
      className="mx-auto flex max-w-md gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (orderId.trim()) router.push(`/booking/${orderId.trim()}`);
      }}
    >
      <input
        placeholder="Broj rezervacije (order ID)"
        className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
      />
      <button
        type="submit"
        className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500"
      >
        Pronađi rezervaciju
      </button>
    </form>
  );
}
