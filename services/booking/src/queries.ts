import type { Order } from "@terminal-flights/shared-types";
import { pool } from "./db.js";

interface OrderRow {
  order_id: string;
  trip_id: string | null;
  supplier_code: string;
  supplier_order_ref: string | null;
  status: Order["status"];
  currency: string;
  total_amount: string;
  created_at: string;
  updated_at: string;
}

const ORDER_COLUMNS =
  "order_id, trip_id, supplier_code, supplier_order_ref, status, currency, total_amount, created_at, updated_at";

function mapOrderRow(row: OrderRow): Order {
  return {
    orderId: row.order_id,
    tripId: row.trip_id ?? undefined,
    supplierCode: row.supplier_code as Order["supplierCode"],
    supplierOrderRef: row.supplier_order_ref ?? undefined,
    // `orders` tabela ne čuva offer_id (isti F0 šema gap kao u cancel.ts).
    offerId: "",
    status: row.status,
    price: { currency: row.currency, base: 0, taxes: 0, total: Number(row.total_amount) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Čisto čitanje iz baze — ne pita dobavljača za sveže stanje (npr. da li je
 * u međuvremenu doletela IRROPS izmena). Za F1 je dovoljno da korisnik vidi
 * poslednje stanje koje mi znamo; polling/webhook sinhronizacija sa
 * dobavljačem je §08 Post-sale tema za kasnije.
 */
export async function getOrder(orderId: string): Promise<Order> {
  const { rows } = await pool.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE order_id = $1`, [orderId]);
  if (rows.length === 0) throw new Error(`order ${orderId} not found`);
  return mapOrderRow(rows[0]);
}

/**
 * Idempotency lookup (§05) — booking saga poziva ovo pre nego što napravi
 * novi order, da mrežni retry ili duplo kliknuto dugme na frontendu ne
 * naprave drugu rezervaciju (i, gore, drugu naplatu karticom kod
 * dobavljača koji su MoR).
 */
export async function getOrderByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
  const { rows } = await pool.query<OrderRow>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE idempotency_key = $1`, [
    idempotencyKey,
  ]);
  return rows.length === 0 ? null : mapOrderRow(rows[0]);
}
