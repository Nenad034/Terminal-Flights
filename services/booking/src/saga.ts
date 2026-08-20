import type { Order } from "@terminal-flights/shared-types";
import { pool } from "./db.js";

export interface BookingRequest {
  offerId: string;
  supplierCode: string;
  tripId?: string;
  currency: string;
  totalAmount: number;
}

/**
 * Booking saga (§05): rezerviši kod dobavljača → autorizuj plaćanje → izdaj tiket →
 * upiši u ledger. Ako bilo koji korak padne, prethodni se kompenzuju (void/refund).
 *
 * F0 skeleton: implementiran je samo prvi korak (kreiranje Order zapisa u status
 * "pending"), ostatak lanca (supplier-layer poziv, payments, ticketing, ledger)
 * dolazi u F1 zajedno sa §07 Payments & Ticketing i §09 Finance & Ledger servisima.
 */
export async function startBookingSaga(req: BookingRequest): Promise<Order> {
  const { rows } = await pool.query<{
    order_id: string;
    trip_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO orders (trip_id, supplier_code, status, currency, total_amount)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING order_id, trip_id, created_at, updated_at`,
    [req.tripId ?? null, req.supplierCode, req.currency, req.totalAmount]
  );

  const row = rows[0];
  return {
    orderId: row.order_id,
    tripId: row.trip_id ?? undefined,
    supplierCode: req.supplierCode as Order["supplierCode"],
    offerId: req.offerId,
    status: "pending",
    price: { currency: req.currency, base: req.totalAmount, taxes: 0, total: req.totalAmount },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // TODO (F1): pozvati supplier-layer da rezerviše PNR/Order, zatim payments servis,
  // pa ticketing, pa upis u ledger_entries — sa kompenzacionim koracima na svaki fail.
}
