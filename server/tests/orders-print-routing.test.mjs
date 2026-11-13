import test from "node:test";
import assert from "node:assert/strict";
import { planOrder } from "../../shared/orders.mjs";

/** A minimal product row as the store hands planOrder. */
function row(id, over = {}) {
  return {
    id, sku: id.toUpperCase(), name_zh: `菜${id}`, name_de: "", name_en: "",
    kind: "food", published: 1, available: 1, price_cents: 1000, vat_percent: 10,
    print_station: "kitchen", print_printer_id: "", modifiers_json: "[]", bundle_items_json: "[]",
    ...over
  };
}

function jobsFor(rows, items) {
  const productRows = new Map(rows.map((product) => [product.id, product]));
  const plan = planOrder({ table: "7", items }, productRows);
  return plan.printJobs.map((job) => ({ printerRole: job.printerRole, ...JSON.parse(job.payloadJson) }));
}

test("dishes pinned to different printers in one station split into one ticket each, carrying the printer id", () => {
  const rows = [
    row("a", { print_printer_id: "p1" }),
    row("b", { print_printer_id: "p2" }),
    row("c") // no pin: routes by station
  ];
  const jobs = jobsFor(rows, [{ id: "a", qty: 1 }, { id: "b", qty: 1 }, { id: "c", qty: 1 }]);
  assert.equal(jobs.length, 3, "one ticket for each distinct station+printer");
  const pinnedA = jobs.find((job) => job.printerId === "p1");
  const pinnedB = jobs.find((job) => job.printerId === "p2");
  const unpinned = jobs.find((job) => !("printerId" in job));
  assert.ok(pinnedA && pinnedB && unpinned, "a pinned ticket per printer and one station ticket");
  for (const job of jobs) assert.equal(job.printerRole, "kitchen", "the station stays the claim role");
  assert.deepEqual(pinnedA.items.map((item) => item.sku), ["A"]);
  assert.deepEqual(unpinned.items.map((item) => item.sku), ["C"]);
});

test("two dishes pinned to the same printer share one ticket; no pin keeps the old one-per-station behaviour", () => {
  const rows = [
    row("a", { print_printer_id: "p1" }),
    row("b", { print_printer_id: "p1" }),
    row("d", { kind: "drink", print_station: "bar" })
  ];
  const jobs = jobsFor(rows, [{ id: "a", qty: 1 }, { id: "b", qty: 2 }, { id: "d", qty: 1 }]);
  assert.equal(jobs.length, 2, "one pinned kitchen ticket, one bar ticket");
  const pinned = jobs.find((job) => job.printerId === "p1");
  assert.deepEqual(pinned.items.map((item) => item.sku).sort(), ["A", "B"]);
  const bar = jobs.find((job) => job.printerRole === "bar");
  assert.ok(bar && !("printerId" in bar), "the unpinned bar ticket carries no printer id");
});
