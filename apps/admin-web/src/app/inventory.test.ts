import { describe, expect, it } from "vitest";
import { INVENTORY_FALLBACK, inventoryAddress } from "./inventory";

describe("the stock app's address", () => {
  it("sits beside the console on its workers.dev subdomain, as kc", () => {
    expect(inventoryAddress("https://ck.chiri.workers.dev/admin.html")).toBe("https://kc.chiri.workers.dev/");
    expect(inventoryAddress("https://717986230.github.io/zhaoyun/admin.html", "https://ck.chiri.workers.dev")).toBe("https://kc.chiri.workers.dev/");
  });
  it("is the project's page anywhere else", () => {
    expect(inventoryAddress("http://127.0.0.1:5173/admin.html", "", "not a url")).toBe(INVENTORY_FALLBACK);
  });
});
