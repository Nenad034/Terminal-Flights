import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("./db.js", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

let startBookingSaga: typeof import("./saga.js").startBookingSaga;
beforeAll(async () => {
  ({ startBookingSaga } = await import("./saga.js"));
});

const baseReq = {
  offerId: "off_1",
  supplierCode: "duffel",
  supplierOfferRef: "off_1",
  currency: "EUR",
  totalAmount: 100,
  passengers: [
    {
      givenName: "Test",
      familyName: "User",
      bornOn: "1990-01-01",
      gender: "m" as const,
      email: "test@example.com",
      phoneNumber: "+381600000000",
    },
  ],
};

function insertRow() {
  return { order_id: "order-1", trip_id: null, created_at: "t0", updated_at: "t0" };
}

beforeEach(() => {
  queryMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("startBookingSaga", () => {
  it("rejects an already-expired offer and marks the order failed, without calling the supplier", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [] }); // UPDATE compensation

    await expect(
      startBookingSaga({ ...baseReq, expiresAt: "2020-01-01T00:00:00Z" })
    ).rejects.toThrow(/expired/);

    expect(fetch).not.toHaveBeenCalled();

    const compensationCall = queryMock.mock.calls[1];
    expect(compensationCall[0]).toContain("UPDATE orders");
    expect(compensationCall[1]).toEqual(["failed", null, "order-1"]);
  });

  it("reserves, pays, and writes a balanced ledger entry on success", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ order: { orderId: "duf_1", supplierOrderRef: "ord_ref_1", status: "pending" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          order: {
            orderId: "duf_1",
            supplierOrderRef: "ord_ref_1",
            status: "ticketed",
            price: { currency: "EUR", base: 0, taxes: 0, total: 100 },
          },
        }),
      });

    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [{ updated_at: "t1" }] }) // UPDATE status/supplier_order_ref
      .mockResolvedValueOnce({ rows: [] }); // INSERT ledger_entries

    const order = await startBookingSaga({ ...baseReq, expiresAt: future });

    expect(order.status).toBe("ticketed");
    expect(order.supplierOrderRef).toBe("ord_ref_1");

    const ledgerCall = queryMock.mock.calls[2];
    expect(ledgerCall[0]).toContain("ledger_entries");
    expect(ledgerCall[1]).toEqual(["order-1", 100, "EUR"]);
  });

  it("keeps the order as pending/held for manual review if payment fails after a successful reservation", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ order: { orderId: "duf_1", supplierOrderRef: "ord_ref_1", status: "pending" } }),
      })
      .mockResolvedValueOnce({ ok: false, status: 402, text: async () => "insufficient balance" });

    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [] }); // UPDATE compensation

    await expect(startBookingSaga({ ...baseReq, expiresAt: future })).rejects.toThrow(/payment failed/);

    const compensationCall = queryMock.mock.calls[1];
    expect(compensationCall[1]).toEqual(["pending", "ord_ref_1", "order-1"]);
  });

  it("skips the separate payment step when the order was already paid via card at creation", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        order: {
          orderId: "duf_1",
          supplierOrderRef: "ord_ref_1",
          status: "ticketed",
          price: { currency: "EUR", base: 0, taxes: 0, total: 100 },
        },
      }),
    });

    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [{ updated_at: "t1" }] }) // UPDATE status/supplier_order_ref
      .mockResolvedValueOnce({ rows: [] }); // INSERT ledger_entries

    const order = await startBookingSaga({
      ...baseReq,
      expiresAt: future,
      cardPayment: { threeDSecureSessionId: "3ds_1" },
    });

    expect(order.status).toBe("ticketed");
    expect(fetch).toHaveBeenCalledTimes(1); // only reserveWithSupplier, no separate /pay call

    const [, requestInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.cardPayment).toEqual({ threeDSecureSessionId: "3ds_1", amount: 100, currency: "EUR" });
  });

  it("preserves the already-paid status on compensation if a later step fails after card payment succeeded", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        order: {
          orderId: "duf_1",
          supplierOrderRef: "ord_ref_1",
          status: "ticketed",
          price: { currency: "EUR", base: 0, taxes: 0, total: 100 },
        },
      }),
    });

    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [{ updated_at: "t1" }] }) // UPDATE status/supplier_order_ref
      .mockRejectedValueOnce(new Error("ledger db unavailable")) // INSERT ledger_entries fails
      .mockResolvedValueOnce({ rows: [] }); // UPDATE compensation

    await expect(
      startBookingSaga({ ...baseReq, expiresAt: future, cardPayment: { threeDSecureSessionId: "3ds_1" } })
    ).rejects.toThrow(/ledger db unavailable/);

    const compensationCall = queryMock.mock.calls[3];
    // Bug this guards against: without tracking `paid` separately, this would
    // wrongly downgrade an already-ticketed, already-paid order to "pending".
    expect(compensationCall[1]).toEqual(["ticketed", "ord_ref_1", "order-1"]);
  });

  it("marks the order failed if the supplier reservation itself never succeeds", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "supplier unavailable",
    });

    queryMock
      .mockResolvedValueOnce({ rows: [insertRow()] }) // INSERT pending
      .mockResolvedValueOnce({ rows: [] }); // UPDATE compensation

    await expect(startBookingSaga({ ...baseReq, expiresAt: future })).rejects.toThrow(/order creation failed/);

    const compensationCall = queryMock.mock.calls[1];
    expect(compensationCall[1]).toEqual(["failed", null, "order-1"]);
  });

  it("returns the existing order for a known idempotencyKey without touching the supplier or inserting a new row", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          order_id: "order-1",
          trip_id: null,
          supplier_code: "duffel",
          supplier_order_ref: "ord_ref_1",
          status: "ticketed",
          currency: "EUR",
          total_amount: "100.00",
          created_at: "t0",
          updated_at: "t1",
        },
      ],
    });

    const order = await startBookingSaga({
      ...baseReq,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "idem-1",
    });

    expect(order.orderId).toBe("order-1");
    expect(order.status).toBe("ticketed");
    expect(fetch).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("returns the existing order when a concurrent duplicate insert hits the idempotency_key unique constraint", async () => {
    const uniqueViolation = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });

    queryMock
      .mockResolvedValueOnce({ rows: [] }) // idempotency check: nothing yet
      .mockRejectedValueOnce(uniqueViolation) // INSERT loses the race
      .mockResolvedValueOnce({
        rows: [
          {
            order_id: "order-1",
            trip_id: null,
            supplier_code: "duffel",
            supplier_order_ref: "ord_ref_1",
            status: "ticketed",
            currency: "EUR",
            total_amount: "100.00",
            created_at: "t0",
            updated_at: "t1",
          },
        ],
      }); // idempotency re-check finds the winner's row

    const order = await startBookingSaga({
      ...baseReq,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey: "idem-1",
    });

    expect(order.orderId).toBe("order-1");
    expect(fetch).not.toHaveBeenCalled();
  });
});
