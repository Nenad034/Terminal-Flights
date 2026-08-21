import type { Order, OrderStatus } from "@terminal-flights/shared-types";
import { pool } from "./db.js";

const SUPPLIER_LAYER_URL = process.env.SUPPLIER_LAYER_URL ?? "http://localhost:4001";

export interface CancellationQuote {
  orderId: string;
  supplierCancellationRef: string;
  refundAmount: number;
  refundCurrency: string;
  expiresAt: string;
}

interface OrderRow {
  supplier_code: string;
  supplier_order_ref: string | null;
  status: OrderStatus;
  currency: string;
  total_amount: string;
  trip_id: string | null;
  created_at: string;
}

async function findCancellableOrder(orderId: string): Promise<OrderRow> {
  const { rows } = await pool.query<OrderRow>(
    `SELECT supplier_code, supplier_order_ref, status, currency, total_amount, trip_id, created_at
     FROM orders WHERE order_id = $1`,
    [orderId]
  );
  if (rows.length === 0) throw new Error(`order ${orderId} not found`);

  const row = rows[0];
  if (!row.supplier_order_ref) throw new Error(`order ${orderId} was never reserved with a supplier, nothing to cancel`);
  if (row.status === "cancelled") throw new Error(`order ${orderId} is already cancelled`);
  if (row.status === "failed") throw new Error(`order ${orderId} failed, nothing to cancel`);

  return row;
}

/**
 * Prvi korak (§08 Post-sale): traži od dobavljača koliko će se refundirati,
 * bez ikakve nepovratne akcije. Booking servis ovde namerno ne menja status
 * u bazi — order ostaje u trenutnom stanju dok korisnik ne potvrdi.
 */
export async function quoteCancellation(orderId: string): Promise<CancellationQuote> {
  const row = await findCancellableOrder(orderId);

  const res = await fetch(`${SUPPLIER_LAYER_URL}/orders/${row.supplier_order_ref}/cancellation-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCode: row.supplier_code, orderId }),
  });

  if (!res.ok) {
    throw new Error(`supplier-layer cancellation quote failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as {
    quote: { supplierCancellationRef: string; refundAmount: number; refundCurrency: string; expiresAt: string };
  };

  return { orderId, ...json.quote };
}

/**
 * Drugi korak: potvrđuje kotaciju (nepovratno kod dobavljača), upisuje
 * status "cancelled" i reverzuje originalni ledger zapis (§09). Namerno
 * pojednostavljeno kao i writeLedgerEntries u saga.ts: puno razdvajanje na
 * stvarno refundiran iznos vs. zadržanu penal-proviziju čeka pravi
 * komisioni model — ovde samo storniramo originalnu obavezu u celini.
 */
export async function confirmCancellation(orderId: string, supplierCancellationRef: string): Promise<Order> {
  const row = await findCancellableOrder(orderId);

  const res = await fetch(`${SUPPLIER_LAYER_URL}/order-cancellations/${supplierCancellationRef}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCode: row.supplier_code }),
  });

  if (!res.ok) {
    throw new Error(`supplier-layer cancellation confirm failed: ${res.status} ${await res.text()}`);
  }

  const { rows: updated } = await pool.query<{ updated_at: string }>(
    `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE order_id = $1 RETURNING updated_at`,
    [orderId]
  );

  await pool.query(
    `INSERT INTO ledger_entries (order_id, account, debit, credit, currency)
     VALUES ($1, 'accounts_receivable', 0, $2, $3),
            ($1, 'supplier_payable', $2, 0, $3)`,
    [orderId, row.total_amount, row.currency]
  );

  return {
    orderId,
    tripId: row.trip_id ?? undefined,
    supplierCode: row.supplier_code as Order["supplierCode"],
    supplierOrderRef: row.supplier_order_ref ?? undefined,
    // `orders` tabela ne čuva offer_id (postojeći F0 šema gap, ne uveden ovde) —
    // prazan string je bolji nego izmišljena vrednost dok se šema ne proširi.
    offerId: "",
    status: "cancelled",
    price: { currency: row.currency, base: 0, taxes: 0, total: Number(row.total_amount) },
    createdAt: row.created_at,
    updatedAt: updated[0].updated_at,
  };
}
