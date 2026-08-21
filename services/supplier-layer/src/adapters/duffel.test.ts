import { beforeEach, describe, expect, it, vi } from "vitest";
import { DuffelAdapter } from "./duffel.js";

const searchParams = {
  origin: "BEG",
  destination: "JFK",
  departureDate: "2026-09-15",
  passengers: { adults: 1 },
};

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("DuffelAdapter.search", () => {
  it("returns [] without calling the API when no key is configured", async () => {
    const adapter = new DuffelAdapter("");
    const offers = await adapter.search(searchParams);
    expect(offers).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a Duffel offer to the internal Offer shape", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "orq_1",
          offers: [
            {
              id: "off_1",
              total_amount: "199.99",
              total_currency: "EUR",
              base_amount: "150.00",
              tax_amount: "49.99",
              expires_at: "2099-01-01T00:00:00Z",
              slices: [
                {
                  segments: [
                    {
                      origin: { iata_code: "BEG" },
                      destination: { iata_code: "JFK" },
                      departing_at: "2026-09-15T10:00:00Z",
                      arriving_at: "2026-09-15T18:00:00Z",
                      marketing_carrier: { iata_code: "AA" },
                      operating_carrier: { iata_code: "AA" },
                      marketing_carrier_flight_number: "123",
                      passengers: [
                        {
                          cabin_class: "economy",
                          baggages: [
                            { type: "checked", quantity: 1 },
                            { type: "carry_on", quantity: 1 },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
              conditions: {
                refund_before_departure: { allowed: true },
                change_before_departure: { allowed: false },
              },
            },
          ],
        },
      })
    );

    const adapter = new DuffelAdapter("test_key");
    const [offer] = await adapter.search(searchParams);

    expect(offer).toEqual({
      offerId: "duffel:off_1",
      supplierCode: "duffel",
      supplierOfferRef: "off_1",
      segments: [
        {
          origin: "BEG",
          destination: "JFK",
          departureAt: "2026-09-15T10:00:00Z",
          arrivalAt: "2026-09-15T18:00:00Z",
          marketingCarrier: "AA",
          operatingCarrier: "AA",
          flightNumber: "123",
          cabinClass: "economy",
        },
      ],
      price: { currency: "EUR", base: 150, taxes: 49.99, total: 199.99 },
      fareRules: { refundable: true, changeable: false, checkedBagsIncluded: 1, cabinBagsIncluded: 1 },
      expiresAt: "2099-01-01T00:00:00Z",
    });
  });

  it("degrades to [] instead of throwing when Duffel returns an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ errors: [] }, false, 500));

    const adapter = new DuffelAdapter("test_key");
    await expect(adapter.search(searchParams)).resolves.toEqual([]);
  });
});

describe("DuffelAdapter.getAncillaries", () => {
  it("returns [] without calling the API when no key is configured", async () => {
    const adapter = new DuffelAdapter("");
    await expect(adapter.getAncillaries("off_1")).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flattens the seat map into a flat list, skipping non-seat elements", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: "sea_1",
            segment_id: "seg_1",
            slice_id: "sli_1",
            cabins: [
              {
                rows: [
                  {
                    sections: [
                      {
                        elements: [
                          {
                            type: "seat",
                            designator: "12A",
                            name: "Standard seat",
                            available_services: [
                              { id: "ase_1", passenger_id: "pas_1", total_amount: "15.00", total_currency: "EUR" },
                            ],
                          },
                          { type: "empty" },
                          { type: "seat", designator: "12B" }, // no available_services -> no options
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      })
    );

    const adapter = new DuffelAdapter("test_key");
    const options = await adapter.getAncillaries("off_1");

    expect(options).toEqual([{ serviceId: "ase_1", type: "seat", label: "12A", price: { currency: "EUR", total: 15 } }]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/air/seat_maps?offer_id=off_1"),
      expect.any(Object)
    );
  });

  it("throws on a failed seat map request", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ errors: [] }, false, 404));
    const adapter = new DuffelAdapter("test_key");
    await expect(adapter.getAncillaries("off_1")).rejects.toThrow(/seat map fetch failed/);
  });
});

describe("DuffelAdapter.createOrder", () => {
  it("creates a hold order and derives status from payment_status/documents", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "ord_1",
          booking_reference: "ABC123",
          total_amount: "199.99",
          total_currency: "EUR",
          payment_status: { awaiting_payment: true, payment_required_by: null, price_guarantee_expires_at: null },
          documents: [],
        },
      })
    );

    const adapter = new DuffelAdapter("test_key");
    const order = await adapter.createOrder({
      offerId: "duffel:off_1",
      supplierOfferRef: "off_1",
      passengers: [
        {
          givenName: "Test",
          familyName: "User",
          bornOn: "1990-01-01",
          gender: "m",
          email: "test@example.com",
          phoneNumber: "+381600000000",
        },
      ],
    });

    expect(order.status).toBe("pending");
    expect(order.supplierOrderRef).toBe("ABC123");
    expect(order.offerId).toBe("duffel:off_1");

    const [, requestInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.data.type).toBe("hold");
    expect(body.data.selected_offers).toEqual(["off_1"]);
    expect(body.data.passengers[0]).toMatchObject({ given_name: "Test", family_name: "User" });
  });

  it("includes selected ancillary services in the request body when provided", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "ord_1",
          booking_reference: "ABC123",
          total_amount: "214.99",
          total_currency: "EUR",
          payment_status: { awaiting_payment: true, payment_required_by: null, price_guarantee_expires_at: null },
          documents: [],
        },
      })
    );

    const adapter = new DuffelAdapter("test_key");
    await adapter.createOrder({
      offerId: "duffel:off_1",
      supplierOfferRef: "off_1",
      passengers: [],
      serviceIds: ["ase_1"],
    });

    const [, requestInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.data.services).toEqual([{ id: "ase_1", quantity: 1 }]);
  });

  it("omits the services field entirely when no ancillaries are selected", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: {
          id: "ord_1",
          booking_reference: "ABC123",
          total_amount: "199.99",
          total_currency: "EUR",
          payment_status: { awaiting_payment: true, payment_required_by: null, price_guarantee_expires_at: null },
          documents: [],
        },
      })
    );

    const adapter = new DuffelAdapter("test_key");
    await adapter.createOrder({ offerId: "duffel:off_1", supplierOfferRef: "off_1", passengers: [] });

    const [, requestInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.data.services).toBeUndefined();
  });

  it("throws with the Duffel error body on failure", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ errors: [{ message: "invalid offer" }] }, false, 422)
    );

    const adapter = new DuffelAdapter("test_key");
    await expect(
      adapter.createOrder({ offerId: "x", supplierOfferRef: "off_1", passengers: [] })
    ).rejects.toThrow(/order creation failed/);
  });
});

describe("DuffelAdapter.payOrder", () => {
  it("pays via balance then re-fetches the order for the ticketed status", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse({ data: { order_id: "ord_1" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "ord_1",
            booking_reference: "ABC123",
            total_amount: "199.99",
            total_currency: "EUR",
            payment_status: { awaiting_payment: false, payment_required_by: null, price_guarantee_expires_at: null },
            documents: [{ type: "electronic_ticket", unique_identifier: "1234567890" }],
          },
        })
      );

    const adapter = new DuffelAdapter("test_key");
    const order = await adapter.payOrder("ord_1", 199.99, "EUR");

    expect(order.status).toBe("ticketed");
    expect(fetch).toHaveBeenCalledTimes(2);

    const [, paymentInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const paymentBody = JSON.parse(paymentInit.body);
    expect(paymentBody.data).toEqual({
      order_id: "ord_1",
      payment: { type: "balance", currency: "EUR", amount: "199.99" },
    });
  });
});

describe("DuffelAdapter cancellation", () => {
  it("quoteCancellation maps the response and defaults missing refund fields", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({
        data: { id: "orc_1", order_id: "ord_1", refund_amount: null, refund_currency: null, expires_at: "t2", confirmed_at: null },
      })
    );

    const adapter = new DuffelAdapter("test_key");
    const quote = await adapter.quoteCancellation("order-1", "ord_1");

    expect(quote).toEqual({
      supplierCancellationRef: "orc_1",
      refundAmount: 0,
      refundCurrency: "EUR",
      expiresAt: "t2",
    });
  });

  it("confirmCancellation resolves on success and throws on failure", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({}));
    const adapter = new DuffelAdapter("test_key");
    await expect(adapter.confirmCancellation("orc_1")).resolves.toBeUndefined();

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ errors: [] }, false, 422));
    await expect(adapter.confirmCancellation("orc_1")).rejects.toThrow(/cancellation confirm failed/);
  });
});
