"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

interface OrderView {
  orderId: string;
  status: string;
  supplierCode: string;
  supplierOrderRef?: string;
  price: { currency: string; total: number };
}

interface CancellationQuote {
  supplierCancellationRef: string;
  refundAmount: number;
  refundCurrency: string;
  expiresAt: string;
}

async function fetchOrder(orderId: string) {
  const res = await fetch(`/api/booking/${orderId}`);
  const data = (await res.json()) as { order?: OrderView; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Order not found");
  return data.order!;
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
  const data = (await res.json()) as { order?: OrderView; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Cancellation confirm failed");
  return data.order!;
}

// Manage booking (§12 self-service): pregled postojeće rezervacije preko
// orderId-a, sa istim quote→confirm otkazivanjem kao odmah posle booking-a.
export function ManageBooking({ orderId }: { orderId: string }) {
  const orderQuery = useQuery({ queryKey: ["order", orderId], queryFn: () => fetchOrder(orderId) });
  const quoteMutation = useMutation({ mutationFn: () => quoteCancellation(orderId) });
  const confirmMutation = useMutation({
    mutationFn: (ref: string) => confirmCancellation(orderId, ref),
    onSuccess: () => orderQuery.refetch(),
  });

  if (orderQuery.isPending) {
    return <p className="text-sm text-slate-400">Učitavam rezervaciju...</p>;
  }

  if (orderQuery.isError) {
    return <p className="text-sm text-red-400">{(orderQuery.error as Error).message}</p>;
  }

  const order = orderQuery.data;
  const cancellable = order.status !== "cancelled" && order.status !== "failed";

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-blue-400">{order.orderId}</p>
        <p className="mt-1 text-lg text-slate-100">
          {order.supplierCode} — status: <span className="font-semibold">{order.status}</span>
        </p>
        {order.supplierOrderRef && <p className="text-sm text-slate-400">PNR: {order.supplierOrderRef}</p>}
        <p className="text-sm text-slate-400">
          {order.price.total} {order.price.currency}
        </p>
      </div>

      {cancellable && (
        <div className="space-y-2 border-t border-slate-800 pt-4">
          {!quoteMutation.data && (
            <button
              type="button"
              className="rounded-md border border-red-500 px-3 py-1.5 text-red-400 transition hover:bg-red-950/40 disabled:opacity-50"
              disabled={quoteMutation.isPending}
              onClick={() => quoteMutation.mutate()}
            >
              {quoteMutation.isPending ? "Proveravam uslove..." : "Otkaži rezervaciju"}
            </button>
          )}

          {quoteMutation.isError && <p className="text-sm text-red-400">{(quoteMutation.error as Error).message}</p>}

          {quoteMutation.isSuccess && !confirmMutation.isSuccess && (
            <div className="space-y-2 rounded-md border border-slate-800 p-3 text-sm text-slate-300">
              <p>
                Refund: {quoteMutation.data.refundAmount} {quoteMutation.data.refundCurrency} (kotacija važi do{" "}
                {quoteMutation.data.expiresAt})
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

          {confirmMutation.isSuccess && <p className="text-sm text-emerald-400">Rezervacija otkazana.</p>}
        </div>
      )}
    </div>
  );
}
