import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("./db.js", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

let quoteCancellation: typeof import("./cancel.js").quoteCancellation;
let confirmCancellation: typeof import("./cancel.js").confirmCancellation;
beforeAll(async () => {
  ({ quoteCancellation, confirmCancellation } = await import("./cancel.js"));
});

function orderRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    supplier_code: "duffel",
    supplier_order_ref: "ord_ref_1",
    status: "ticketed",
    currency: "EUR",
    total_amount: "100.00",
    trip_id: null,
    created_at: "t0",
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

describe("quoteCancellation", () => {
  it("throws when the order does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(quoteCancellation("missing")).rejects.toThrow(/not found/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when the order was never reserved with a supplier", async () => {
    queryMock.mockResolvedValueOnce({ rows: [orderRow({ supplier_order_ref: null })] });
    await expect(quoteCancellation("o1")).rejects.toThrow(/never reserved/);
  });

  it("throws when the order is already cancelled", async () => {
    queryMock.mockResolvedValueOnce({ rows: [orderRow({ status: "cancelled" })] });
    await expect(quoteCancellation("o1")).rejects.toThrow(/already cancelled/);
  });

  it("throws when the order failed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [orderRow({ status: "failed" })] });
    await expect(quoteCancellation("o1")).rejects.toThrow(/failed, nothing to cancel/);
  });

  it("asks supplier-layer for a quote without mutating any state", async () => {
    queryMock.mockResolvedValueOnce({ rows: [orderRow()] });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        quote: { supplierCancellationRef: "orc_1", refundAmount: 80, refundCurrency: "EUR", expiresAt: "t2" },
      }),
    });

    const quote = await quoteCancellation("o1");

    expect(quote).toEqual({
      orderId: "o1",
      supplierCancellationRef: "orc_1",
      refundAmount: 80,
      refundCurrency: "EUR",
      expiresAt: "t2",
    });
    expect(queryMock).toHaveBeenCalledTimes(1); // only the SELECT, no writes
  });
});

describe("confirmCancellation", () => {
  it("does not touch the DB if the supplier confirm call fails", async () => {
    queryMock.mockResolvedValueOnce({ rows: [orderRow()] });
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "duffel error",
    });

    await expect(confirmCancellation("o1", "orc_1")).rejects.toThrow(/cancellation confirm failed/);
    expect(queryMock).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE/INSERT
  });

  it("marks the order cancelled and writes a reversing ledger entry on success", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [orderRow()] }) // SELECT
      .mockResolvedValueOnce({ rows: [{ updated_at: "t3" }] }) // UPDATE status
      .mockResolvedValueOnce({ rows: [] }); // INSERT ledger_entries

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({ confirmed: true }) });

    const order = await confirmCancellation("o1", "orc_1");

    expect(order.status).toBe("cancelled");

    const ledgerCall = queryMock.mock.calls[2];
    expect(ledgerCall[0]).toContain("ledger_entries");
    expect(ledgerCall[1]).toEqual(["o1", "100.00", "EUR"]);
  });
});
