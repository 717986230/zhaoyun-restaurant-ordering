import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  CreateOrderBody, MENU_LANGUAGES, MENU_THEMES, ORDER_STATUSES, OrderStatusBody, PRINT_STATIONS, ProductBody,
  SERVICE_STATUSES, ServiceRequestBody, ServiceStatusBody, SettingsBody, TableBody
} from "../../../src/contracts.js";
import type { CreateOrderCommand, CreateServiceRequestCommand, OrderStatus, ServiceStatus } from "../src/index";
import type { AdminProductInput } from "../../api-client/src/index";
import { MENU_THEME_IDS } from "../../domain/src/themes";
import { MENU_LANGUAGES as RULE_MENU_LANGUAGES } from "../../../shared/rules.mjs";

/**
 * The runtime schemas and these TypeScript types describe the same requests.
 * Nothing makes the compiler check that, so the check is here: a value the
 * types accept must pass validation, and a value the schema rejects must be
 * one the types could not have produced.
 */
describe("Wire contract parity", () => {
  it("accepts an order the client type allows", () => {
    const command: CreateOrderCommand = {
      clientRequestId: "b0d5f2c1-8e4a-4f2a-9d3b-11d0a4f6c7e2",
      table: "T-3",
      note: "wenig Salz",
      items: [{ id: "photo-r1", qty: 2, modifiers: [{ id: "extra-noodles" }] }]
    };
    expect(Value.Check(CreateOrderBody, command)).toBe(true);
  });

  it("rejects orders the client type cannot express", () => {
    const base = { clientRequestId: "long-enough-id", table: "07", note: "", items: [{ id: "photo-r1", qty: 1 }] };
    expect(Value.Check(CreateOrderBody, { ...base, items: [] })).toBe(false);
    expect(Value.Check(CreateOrderBody, { ...base, items: [{ id: "photo-r1", qty: 0 }] })).toBe(false);
    expect(Value.Check(CreateOrderBody, { ...base, items: [{ id: "photo-r1", qty: 1.5 }] })).toBe(false);
    expect(Value.Check(CreateOrderBody, { ...base, clientRequestId: "short" })).toBe(false);
  });

  it("holds every layer to the same eight-character table number", () => {
    const order = { clientRequestId: "long-enough-id", note: "", items: [{ id: "photo-r1", qty: 1 }] };
    expect(Value.Check(CreateOrderBody, { ...order, table: "TERRASSE" })).toBe(true);
    expect(Value.Check(CreateOrderBody, { ...order, table: "TERRASSE-2" })).toBe(false);
    expect(Value.Check(ServiceRequestBody, { table: "TERRASSE-2", type: "water" })).toBe(false);
    expect(Value.Check(TableBody, { table: "TERRASSE-2" })).toBe(false);
  });

  it("accepts a service request the client type allows", () => {
    const command: CreateServiceRequestCommand = { table: "12", type: "water" };
    expect(Value.Check(ServiceRequestBody, command)).toBe(true);
  });

  it("keeps the status unions identical on both sides", () => {
    const orderStatuses: OrderStatus[] = ["new", "preparing", "ready", "completed", "cancelled"];
    const serviceStatuses: ServiceStatus[] = ["open", "acknowledged", "completed", "cancelled"];
    expect([...ORDER_STATUSES]).toEqual(orderStatuses);
    expect([...SERVICE_STATUSES]).toEqual(serviceStatuses);
    for (const status of orderStatuses) expect(Value.Check(OrderStatusBody, { status })).toBe(true);
    for (const status of serviceStatuses) expect(Value.Check(ServiceStatusBody, { status })).toBe(true);
    expect(Value.Check(OrderStatusBody, { status: "paid" })).toBe(false);
  });

  it("accepts the product payload the admin client builds", () => {
    const input: AdminProductInput = {
      sku: "TEST-1",
      kind: "drink",
      category: "WINE",
      names: { zh: "白葡萄酒", de: "Weisswein", en: "White wine" },
      description: "",
      price: 6.9,
      details: { ingredients: "", time: "", people: "", level: "" },
      allergens: ["O"],
      vatPercent: 20,
      printStation: "bar",
      available: true,
      published: true
    };
    expect(Value.Check(ProductBody, input)).toBe(true);
    expect(Value.Check(ProductBody, { ...input, allergens: ["Z"] })).toBe(false);
    expect(Value.Check(ProductBody, { ...input, vatPercent: 7 })).toBe(false);
    expect([...PRINT_STATIONS]).toEqual(["kitchen", "bar", "sushi", "front"]);
  });

  it("keeps the vetted menu styles identical between the server schema and the domain presets", () => {
    expect([...MENU_THEMES]).toEqual([...MENU_THEME_IDS]);
    for (const menuTheme of MENU_THEME_IDS) expect(Value.Check(SettingsBody, { menuTheme })).toBe(true);
    expect(Value.Check(SettingsBody, { menuTheme: "gold" })).toBe(false);
  });

  it("keeps the menu languages identical between the wire schema and the shared rules", () => {
    expect([...MENU_LANGUAGES]).toEqual([...RULE_MENU_LANGUAGES]);
    expect(Value.Check(SettingsBody, { menuLanguages: ["en", "de"] })).toBe(true);
    expect(Value.Check(SettingsBody, { menuLanguages: ["zh"] })).toBe(true);
    // No languages, an unknown one, or the same one twice: not a menu.
    expect(Value.Check(SettingsBody, { menuLanguages: [] })).toBe(false);
    expect(Value.Check(SettingsBody, { menuLanguages: ["fr"] })).toBe(false);
    expect(Value.Check(SettingsBody, { menuLanguages: ["en", "en"] })).toBe(false);
    // Either setting may be saved alone, but a save has to carry one of them.
    expect(Value.Check(SettingsBody, {})).toBe(false);
  });
});
