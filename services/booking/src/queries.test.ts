import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("./db.js", () => ({ pool: { query: (...args: unknown[]) => queryMock(...args) } }));

let getOrder: typeof import("./queries.js").getOrder;
beforeAll(async () => {
  ({ getOrder } = await import("./queries.js"));
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
