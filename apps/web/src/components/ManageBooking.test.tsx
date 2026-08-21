import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "@/test-utils";
import { ManageBooking } from "./ManageBooking";

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

function mockFetch(overrides: Partial<Record<string, () => Promise<unknown>>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      for (const [key, handler] of Object.entries(overrides)) {
        if (url.includes(key)) return handler();
      }
      throw new Error(`unexpected fetch call: ${url}`);
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("ManageBooking", () => {
  it("shows an error message when the order is not found", async () => {
    mockFetch({ "/api/booking/missing": () => jsonResponse({ error: "order missing not found" }, false, 404) });
    renderWithQueryClient(<ManageBooking orderId="missing" />);

    expect(await screen.findByText(/order missing not found/)).toBeInTheDocument();
  });

  it("shows order details and a cancel button for a cancellable order", async () => {
    mockFetch({
      "/api/booking/order-1": () =>
        jsonResponse({
          order: { orderId: "order-1", status: "ticketed", supplierCode: "duffel", supplierOrderRef: "ABC123", price: { currency: "EUR", total: 199.99 } },
        }),
    });
    renderWithQueryClient(<ManageBooking orderId="order-1" />);

    expect(await screen.findByText(/status:/)).toBeInTheDocument();
    expect(screen.getByText("ticketed")).toBeInTheDocument();
    expect(screen.getByText(/PNR: ABC123/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Otkaži rezervaciju" })).toBeInTheDocument();
  });

  it("hides the cancel button for an already-cancelled order", async () => {
    mockFetch({
      "/api/booking/order-2": () =>
        jsonResponse({
          order: { orderId: "order-2", status: "cancelled", supplierCode: "duffel", price: { currency: "EUR", total: 199.99 } },
        }),
    });
    renderWithQueryClient(<ManageBooking orderId="order-2" />);

    await screen.findByText("cancelled");
    expect(screen.queryByRole("button", { name: "Otkaži rezervaciju" })).not.toBeInTheDocument();
  });

  it("runs quote then confirm and refetches the order to show the cancelled status", async () => {
    mockFetch({
      "/api/booking/order-1/cancellation-quote": () =>
        jsonResponse({ quote: { supplierCancellationRef: "orc_1", refundAmount: 50, refundCurrency: "EUR", expiresAt: "t2" } }),
      "/api/booking/order-1/cancellation-confirm": () =>
        jsonResponse({ order: { orderId: "order-1", status: "cancelled" } }),
      "/api/booking/order-1": () =>
        jsonResponse({
          order: { orderId: "order-1", status: "ticketed", supplierCode: "duffel", price: { currency: "EUR", total: 199.99 } },
        }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<ManageBooking orderId="order-1" />);

    await user.click(await screen.findByRole("button", { name: "Otkaži rezervaciju" }));
    expect(await screen.findByText(/Refund: 50 EUR/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Potvrdi otkazivanje" }));
    expect(await screen.findByText("Rezervacija otkazana.")).toBeInTheDocument();
  });
});
