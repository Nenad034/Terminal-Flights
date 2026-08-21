import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderLookup } from "./OrderLookup";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  push.mockReset();
});

describe("OrderLookup", () => {
  it("navigates to the booking page for the entered order id", async () => {
    const user = userEvent.setup();
    render(<OrderLookup />);

    await user.type(screen.getByPlaceholderText("Broj rezervacije (order ID)"), "order-1");
    await user.click(screen.getByRole("button", { name: "Pronađi rezervaciju" }));

    expect(push).toHaveBeenCalledWith("/booking/order-1");
  });

  it("trims whitespace from the order id before navigating", async () => {
    const user = userEvent.setup();
    render(<OrderLookup />);

    await user.type(screen.getByPlaceholderText("Broj rezervacije (order ID)"), "  order-2  ");
    await user.click(screen.getByRole("button", { name: "Pronađi rezervaciju" }));

    expect(push).toHaveBeenCalledWith("/booking/order-2");
  });

  it("does not navigate when the input is empty", async () => {
    const user = userEvent.setup();
    render(<OrderLookup />);

    await user.click(screen.getByRole("button", { name: "Pronađi rezervaciju" }));

    expect(push).not.toHaveBeenCalled();
  });
});
