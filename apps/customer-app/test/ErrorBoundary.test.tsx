import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/components/ErrorBoundary";

function Exploding(): never {
  throw new Error("catalog render failed");
}

// Vitest runs without globals, so RTL cannot register its own cleanup.
afterEach(cleanup);

describe("Customer error boundary", () => {
  it("replaces a crash with instructions the guest can act on", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Exploding /></ErrorBoundary>);

    // A blank tablet in front of a guest is the failure this prevents.
    expect(screen.getByText(/请叫服务员/)).toBeDefined();
    expect(screen.getByText(/Bitte rufen Sie das Personal/)).toBeDefined();
    expect(screen.getByText(/call our staff/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeDefined();

    consoleError.mockRestore();
  });

  it("keeps the crash reason for whoever has to fix it", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<ErrorBoundary><Exploding /></ErrorBoundary>);

    expect(screen.getByText("catalog render failed")).toBeDefined();
    expect(JSON.parse(localStorage.getItem("zy_last_client_error") ?? "{}").message).toBe("catalog render failed");

    consoleError.mockRestore();
  });

  it("renders children untouched when nothing throws", () => {
    render(<ErrorBoundary><p>menu</p></ErrorBoundary>);
    expect(screen.getByText("menu")).toBeDefined();
  });
});
