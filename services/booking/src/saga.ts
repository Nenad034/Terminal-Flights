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
  totalAmount: number; // mora uključivati cenu izabranih ancillary usluga (§07) — obaveza klijenta koji šalje zahtev
  passengers: BookingPassenger[];
  serviceIds?: string[];
}

/**
 * Booking saga (§05): QC provera → rezerviši kod dobavljača → plati → upiši
 * u ledger (Duffel izdaje tiket automatski nakon plaćanja). Ako bilo koji
 * korak padne, prethodni se kompenzuju (order ostaje "held" na manuelni
 * review, ne pokušavamo automatski void/refund dok ne znamo uzrok pada).
 *
 * F1: QC, supplier reservation, payment i minimalni ledger upis su
 * implementirani. Eksplicitan ticketing korak za GDS dobavljače (gde nije
 * automatski kao kod Duffel-a) ostaje TODO dok ti adapteri nisu aktivni.
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

  let reserved: Order | undefined;
  try {
    assertOfferStillValid(req);
    reserved = await reserveWithSupplier(req);
    const paid = await payWithSupplier(req, reserved);

    const { rows: updated } = await pool.query<{ updated_at: string }>(
      `UPDATE orders SET status = $1, supplier_order_ref = $2, updated_at = now()
       WHERE order_id = $3 RETURNING updated_at`,
      [paid.status, paid.supplierOrderRef ?? reserved.supplierOrderRef ?? null, row.order_id]
    );

    await writeLedgerEntries(row.order_id, req);

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

  // TODO (F1 nastavak): eksplicitna ticketing potvrda za dobavljače gde je to
  // poseban korak (GDS-ovi) — Duffel izdaje tiket automatski nakon plaćanja,
  // pa se to samo čita iz `paid.status` (postavljeno u DuffelAdapter.toOrder).
}

/**
 * Minimalni dvostruki upis (§09 Glavna knjiga): potraživanje od kupca naspram
 * obaveze prema dobavljaču, u istom iznosu. NAMERNO pojednostavljeno — puni
 * kontni plan (raščlanjivanje na prihod, proviziju/markup, porez, trošak
 * obrade plaćanja) dolazi tek kad postoji stvarni markup/komisioni model;
 * ovde samo garantujemo da debit == credit za svaki order od prvog dana,
 * umesto da se ledger doda naknadno kao "zakrpa" (§09, poslednji pasus).
 */
async function writeLedgerEntries(orderId: string, req: BookingRequest): Promise<void> {
  await pool.query(
    `INSERT INTO ledger_entries (order_id, account, debit, credit, currency)
     VALUES ($1, 'accounts_receivable', $2, 0, $3),
            ($1, 'supplier_payable', 0, $2, $3)`,
    [orderId, req.totalAmount, req.currency]
  );
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
      serviceIds: req.serviceIds,
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
