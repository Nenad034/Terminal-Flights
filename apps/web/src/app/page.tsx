import { OrderLookup } from "@/components/OrderLookup";
import { SearchForm } from "@/components/SearchForm";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-10 px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-widest text-blue-400">
          Terminal Flights
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Pretraga i rezervacija letova
        </h1>
        <p className="mt-2 max-w-xl text-sm text-slate-400">
          F0 — temelj: web klijent govori sa search-fanout servisom preko API
          gateway-a (§02), koji dalje pita supplier-layer (§03).
        </p>
      </div>
      <SearchForm />
      <OrderLookup />
    </main>
  );
}
