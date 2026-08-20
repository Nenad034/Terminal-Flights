import type { Order } from "@terminal-flights/shared-types";
import { pool } from "./db.js";

const SUPPLIER_LAYER_URL = process.env.SUPPLIER_LAYER_URL ?? "http://localhost:4001";

export interface BookingPassenger {
  givenName: string;
  familyName: string;
  bornOn: string;
  gender: "m" | "f";
  email: string;
  phoneNumber: string;
}

export interface BookingRequest {
  offerId: string;
  supplierCode: string;
  supplierOfferRef: string;
  expiresAt: string;
  tripId?: string;
  currency: string;
  totalAmount: number;
  passengers: BookingPassenger[];
}

/**
 * Booking saga (§05): QC provera → rezerviši kod dobavljača → autorizuj
 * plaćanje → izdaj tiket → upiši u ledger. Ako bilo koji korak padne,
 * prethodni se kompenzuju (void/refund).
 *
 * F1 (delimično): implementirani su QC + supplier reservation koraci.
 * Payments/ticketing/ledger (§07, §09) ostaju TODO — order posle ovog koraka
 * je kod dobavljača "hold" (nenaplaćen), ne ticketed.
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

  assertOfferStillValid(req);

  let reserved: Order | undefined;
  try {
    reserved = await reserveWithSupplier(req);
    const paid = await payWithSupplier(req, reserved);

    const { rows: updated } = await pool.query<{ updated_at: string }>(
      `UPDATE orders SET status = $1, supplier_order_ref = $2, updated_at = now()
       WHERE order_id = $3 RETURNING updated_at`,
      [paid.status, paid.supplierOrderRef ?? reserved.supplierOrderRef ?? null, row.order_id]
    );

    return {
      orderId: row.order_id,
      tripId: row.trip_id ?? undefined,
      supplierCode: req.supplierCode as Order["supplierCode"],
      supplierOrderRef: paid.supplierOrderRef ?? reserved.supplierOrderRef,
      offerId: req.offerId,
      status: paid.status,
      price: paid.price,
      createdAt: row.created_at,
      updatedAt: updated[0].updated_at,
    };
  } catch (err) {
    // Kompenzacija: ako je rezervacija kod dobavljača uspela ali je plaćanje
    // palo, order ostaje "held" kod dobavljača (nije naš problem da ga
    // otkažemo automatski dok ne znamo zašto je palo — ostaje za manuelni
    // review). Ako rezervacija nikad nije ni uspela, nema šta da se poništi.
    await pool.query(
      `UPDATE orders SET status = $1, supplier_order_ref = $2, updated_at = now() WHERE order_id = $3`,
      [reserved ? "pending" : "failed", reserved?.supplierOrderRef ?? null, row.order_id]
    );
    throw err;
  }

  // TODO (F1 nastavak): ticketing (dokumenti/e-tiketi) i upis u ledger_entries
  // (§09) — Duffel izdaje tiket automatski nakon plaćanja, ali za dobavljače
  // gde je ticketing poseban korak (GDS-ovi) ovde treba eksplicitan poziv.
}

/**
 * QC korak (uočeno kod airQuest-a i sličnih booking sistema): ne slati
 * rezervaciju dobavljaču ako je cenovna garancija ponude već istekla — bolje
 * pući ovde, jasno, nego da dobavljač odbije order kasnije u lancu.
 */
function assertOfferStillValid(req: BookingRequest): void {
  if (new Date(req.expiresAt).getTime() < Date.now()) {
    throw new Error(`offer ${req.offerId} expired at ${req.expiresAt}, cannot proceed to booking`);
  }
}

async function reserveWithSupplier(req: BookingRequest): Promise<Order> {
  const res = await fetch(`${SUPPLIER_LAYER_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      supplierCode: req.supplierCode,
      offerId: req.offerId,
      supplierOfferRef: req.supplierOfferRef,
      passengers: req.passengers,
    }),
  });

  if (!res.ok) {
    throw new Error(`supplier-layer order creation failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { order: Order };
  return json.order;
}

async function payWithSupplier(req: BookingRequest, reserved: Order): Promise<Order> {
  if (!reserved.supplierOrderRef) {
    throw new Error(`reserved order ${reserved.orderId} has no supplierOrderRef, cannot pay`);
  }

  const res = await fetch(`${SUPPLIER_LAYER_URL}/orders/${reserved.supplierOrderRef}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierCode: req.supplierCode, amount: req.totalAmount, currency: req.currency }),
  });

  if (!res.ok) {
    throw new Error(`supplier-layer payment failed: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { order: Order };
  return json.order;
}
