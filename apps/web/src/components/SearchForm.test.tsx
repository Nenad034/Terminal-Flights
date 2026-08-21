import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createThreeDSecureSession } from "@duffel/components";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQueryClient } from "@/test-utils";
import { SearchForm } from "./SearchForm";

// @duffel/components renders a cross-origin iframe internally (PCI-compliant
// card tokenization) — not renderable/useful in jsdom. We fake just enough of
// its surface to exercise SearchForm's wiring: capture the success/failure
// callbacks passed to DuffelCardForm, and let the mocked
// useDuffelCardFormActions' createCardForTemporaryUse invoke them, mirroring
// how the real iframe posts a message back after tokenizing the card.
// (`forwardRef` is imported inside the async factory, not at module top
// level, because vi.mock factories are hoisted above regular imports.)
let latestCardSuccess: ((data: { id: string }) => void) | undefined;
let latestCardFailure: ((error: { message: string }) => void) | undefined;

vi.mock("@duffel/components", async () => {
  const { forwardRef } = await import("react");
  return {
    DuffelCardForm: forwardRef(
      (
        props: {
          onCreateCardForTemporaryUseSuccess?: (data: { id: string }) => void;
          onCreateCardForTemporaryUseFailure?: (error: { message: string }) => void;
        },
        _ref
      ) => {
        latestCardSuccess = props.onCreateCardForTemporaryUseSuccess;
        latestCardFailure = props.onCreateCardForTemporaryUseFailure;
        return null;
      }
    ),
    useDuffelCardFormActions: () => ({
      ref: { current: null },
      saveCard: () => {},
      createCardForTemporaryUse: () => latestCardSuccess?.({ id: "tcd_1" }),
    }),
    createThreeDSecureSession: vi.fn(),
  };
});

const offer = {
  offerId: "duffel:off_1",
  supplierCode: "duffel",
  supplierOfferRef: "off_1",
  segments: [{ marketingCarrier: "AA", flightNumber: "123", departureAt: "2026-09-15T10:00:00Z" }],
  price: { currency: "EUR", total: 199.99 },
  expiresAt: "2099-01-01T00:00:00Z",
};

const seat = { serviceId: "ase_1", type: "seat" as const, label: "12A", price: { currency: "EUR", total: 15 } };

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

/** Rutira fetch pozive po URL-u/metodi na fiksne odgovore za jedan test. */
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

async function searchAndSelectOffer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Pretraži letove" }));
  const offerItem = await screen.findByText("duffel");
  await user.click(offerItem.closest("li")!);
}

async function fillPassenger(index: number) {
  const given = screen.getAllByPlaceholderText("Ime")[index];
  const family = screen.getAllByPlaceholderText("Prezime")[index];
  const born = screen.getAllByPlaceholderText("Datum rođenja")[index];
  const email = screen.getAllByPlaceholderText("Email")[index];
  const phone = screen.getAllByPlaceholderText("Telefon")[index];

  const user = userEvent.setup();
  await user.type(given, "Ana");
  await user.type(family, "Anic");
  await user.type(born, "1990-01-01");
  await user.type(email, "ana@example.com");
  await user.type(phone, "0600000000");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  latestCardSuccess = undefined;
  latestCardFailure = undefined;
});

const noCardPayment = { "/api/payment-sessions": () => jsonResponse({ error: "not supported" }, false, 501) };

describe("SearchForm", () => {
  it("renders with default search values", () => {
    renderWithQueryClient(<SearchForm />);
    expect(screen.getByDisplayValue("BEG")).toBeInTheDocument();
    expect(screen.getByDisplayValue("JFK")).toBeInTheDocument();
    expect(screen.getByLabelText("Putnici")).toHaveValue(1);
  });

  it("shows a 'no offers' message when the search returns an empty list", async () => {
    mockFetch({ "/api/search": () => jsonResponse({ offers: [] }) });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await user.click(screen.getByRole("button", { name: "Pretraži letove" }));

    expect(await screen.findByText(/Nema ponuda/)).toBeInTheDocument();
  });

  it("sends the adults count to the search endpoint", async () => {
    mockFetch({ "/api/search": () => jsonResponse({ offers: [offer] }) });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    fireEvent.change(screen.getByLabelText("Putnici"), { target: { value: "3" } });
    await user.click(screen.getByRole("button", { name: "Pretraži letove" }));

    await screen.findByText("duffel");

    const [, requestInit] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(body.passengers).toEqual({ adults: 3 });
  });

  it("renders one passenger form block per adult and shows seat selection for a single passenger", async () => {
    mockFetch({
      ...noCardPayment,
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [seat] }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);

    expect(screen.getAllByPlaceholderText("Ime")).toHaveLength(1);
    expect(await screen.findByText(/12A/)).toBeInTheDocument();
  });

  it("hides seat selection when there is more than one passenger, even if seats are available", async () => {
    mockFetch({
      ...noCardPayment,
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [seat] }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    fireEvent.change(screen.getByLabelText("Putnici"), { target: { value: "2" } });
    await searchAndSelectOffer(user);

    expect(screen.getAllByPlaceholderText("Ime")).toHaveLength(2);
    // Give the ancillaries query a chance to resolve before asserting absence.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/ancillaries"), expect.anything()));
    expect(screen.queryByText(/12A/)).not.toBeInTheDocument();
  });

  it("submits a booking with all passengers and the selected seat's serviceId", async () => {
    mockFetch({
      ...noCardPayment,
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [seat] }),
      "/api/booking": () => jsonResponse({ order: { orderId: "order-1", status: "ticketed", supplierOrderRef: "ABC123" } }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await screen.findByText(/12A/);
    await user.click(screen.getByRole("button", { name: /12A/ }));
    await fillPassenger(0);
    await user.click(screen.getByRole("button", { name: "Rezerviši" }));

    expect(await screen.findByText(/Order order-1/)).toBeInTheDocument();
    expect(screen.getByText(/PNR: ABC123/)).toBeInTheDocument();

    const bookingCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].includes("/api/booking"));
    const body = JSON.parse(bookingCall![1].body);
    expect(body.passengers).toHaveLength(1);
    expect(body.passengers[0]).toMatchObject({ givenName: "Ana", familyName: "Anic" });
    expect(body.serviceIds).toEqual(["ase_1"]);
    expect(body.totalAmount).toBe(offer.price.total + seat.price.total);
  });

  it("runs the quote-then-confirm cancellation flow after a successful booking", async () => {
    mockFetch({
      ...noCardPayment,
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [] }),
      "/api/booking/order-1/cancellation-quote": () =>
        jsonResponse({ quote: { supplierCancellationRef: "orc_1", refundAmount: 50, refundCurrency: "EUR", expiresAt: "t2" } }),
      "/api/booking/order-1/cancellation-confirm": () =>
        jsonResponse({ order: { orderId: "order-1", status: "cancelled" } }),
      "/api/booking": () => jsonResponse({ order: { orderId: "order-1", status: "ticketed" } }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await fillPassenger(0);
    await user.click(screen.getByRole("button", { name: "Rezerviši" }));
    await screen.findByText(/Order order-1/);

    await user.click(screen.getByRole("button", { name: "Otkaži rezervaciju" }));
    expect(await screen.findByText(/Refund: 50 EUR/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Potvrdi otkazivanje" }));
    expect(await screen.findByText("Rezervacija otkazana.")).toBeInTheDocument();
  });

  it("surfaces the server error message when booking fails", async () => {
    mockFetch({
      ...noCardPayment,
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [] }),
      "/api/booking": () => jsonResponse({ error: "offer expired, cannot proceed to booking" }, false, 500),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await fillPassenger(0);
    await user.click(screen.getByRole("button", { name: "Rezerviši" }));

    expect(await screen.findByText(/offer expired/)).toBeInTheDocument();
  });

  it("collects card payment via DuffelCardForm and books with the resulting 3DS session", async () => {
    (createThreeDSecureSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "ready_for_payment",
      id: "3ds_1",
    });
    mockFetch({
      "/api/payment-sessions": () => jsonResponse({ componentClientKey: "key_1" }),
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [] }),
      "/api/booking": () => jsonResponse({ order: { orderId: "order-1", status: "ticketed", supplierOrderRef: "ABC123" } }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await fillPassenger(0);
    await user.click(screen.getByRole("button", { name: "Rezerviši" }));

    expect(await screen.findByText(/Order order-1/)).toBeInTheDocument();
    expect(createThreeDSecureSession).toHaveBeenCalledWith("key_1", "tcd_1", offer.supplierOfferRef, [], true);

    const bookingCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0].includes("/api/booking"));
    const body = JSON.parse(bookingCall![1].body);
    expect(body.cardPayment).toEqual({
      threeDSecureSessionId: "3ds_1",
      amount: offer.price.total,
      currency: offer.price.currency,
    });
  });

  it("surfaces an error when 3D Secure authentication does not succeed", async () => {
    (createThreeDSecureSession as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "failed", id: "3ds_1" });
    mockFetch({
      "/api/payment-sessions": () => jsonResponse({ componentClientKey: "key_1" }),
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [] }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await fillPassenger(0);
    await user.click(screen.getByRole("button", { name: "Rezerviši" }));

    expect(await screen.findByText(/3D Secure autentikacija nije uspela/)).toBeInTheDocument();
  });

  it("surfaces an error when the card form itself fails to tokenize the card", async () => {
    mockFetch({
      "/api/payment-sessions": () => jsonResponse({ componentClientKey: "key_1" }),
      "/api/search": () => jsonResponse({ offers: [offer] }),
      "/api/ancillaries": () => jsonResponse({ options: [] }),
    });
    const user = userEvent.setup();
    renderWithQueryClient(<SearchForm />);

    await searchAndSelectOffer(user);
    await waitFor(() => expect(latestCardFailure).toBeDefined());

    act(() => latestCardFailure!({ message: "invalid card number" }));

    expect(await screen.findByText(/invalid card number/)).toBeInTheDocument();
  });
});
