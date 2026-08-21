import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("./db.js", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

let getOrder: typeof import("./queries.js").getOrder;
let getOrderByIdempotencyKey: typeof import("./queries.js").getOrderByIdempotencyKey;
beforeAll(async () => {
  ({ getOrder, getOrderByIdempotencyKey } = await import("./queries.js"));
});

beforeEach(() => {
  queryMock.mockReset();
});

describe("getOrder", () => {
  it("throws when the order does not exist", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getOrder("missing")).rejects.toThrow(/not found/);
  });

  it("maps the DB row to the internal Order shape", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          order_id: "o1",
          trip_id: null,
          supplier_code: "duffel",
          supplier_order_ref: "ABC123",
          status: "ticketed",
          currency: "EUR",
          total_amount: "199.99",
          created_at: "t0",
          updated_at: "t1",
        },
      ],
    });

    const order = await getOrder("o1");

    expect(order).toEqual({
      orderId: "o1",
      tripId: undefined,
      supplierCode: "duffel",
      supplierOrderRef: "ABC123",
      offerId: "",
      status: "ticketed",
      price: { currency: "EUR", base: 0, taxes: 0, total: 199.99 },
      createdAt: "t0",
      updatedAt: "t1",
    });
  });
});

describe("getOrderByIdempotencyKey", () => {
  it("returns null when no order has that idempotency key", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(getOrderByIdempotencyKey("idem-1")).resolves.toBeNull();
  });

  it("maps the DB row to the internal Order shape when found", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          order_id: "o1",
          trip_id: null,
          supplier_code: "duffel",
          supplier_order_ref: "ABC123",
          status: "ticketed",
          currency: "EUR",
          total_amount: "199.99",
          created_at: "t0",
          updated_at: "t1",
        },
      ],
    });

    const order = await getOrderByIdempotencyKey("idem-1");

    expect(order?.orderId).toBe("o1");
    expect(queryMock.mock.calls[0][0]).toContain("idempotency_key = $1");
    expect(queryMock.mock.calls[0][1]).toEqual(["idem-1"]);
  });
});
