import test from "node:test";
import assert from "node:assert/strict";
import { liveEvent, liveRole, reaches } from "../../shared/live.mjs";

test("a successful write is an event; a read, a refusal or a sign-in is not", () => {
  assert.deepEqual(liveEvent("POST", "/api/pos/orders", 201, "8"), { type: "floor.changed", table: "8" });
  assert.deepEqual(liveEvent("POST", "/api/pos/tables/ta-3/claim", 200), { type: "floor.changed", table: "TA-3" }, "the path's table first");
  assert.deepEqual(liveEvent("POST", "/api/admin/checkout", 201), { type: "floor.changed" });
  assert.deepEqual(liveEvent("PUT", "/api/admin/products/p1", 200), { type: "catalog.changed" });
  assert.deepEqual(liveEvent("PUT", "/api/admin/settings", 200), { type: "catalog.changed" });
  assert.equal(liveEvent("GET", "/api/orders", 200), null);
  assert.equal(liveEvent("POST", "/api/pos/orders", 409), null);
  for (const path of ["/api/account/sign-in", "/api/pos/sign-in", "/api/admin/staff", "/api/admin/pos-devices/d1", "/api/admin/print-jobs/j1/claim", "/api/admin/print-jobs/claim"]) {
    assert.equal(liveEvent("POST", path, 200), null, path);
  }
  assert.deepEqual(liveEvent("POST", "/api/admin/print-jobs/j1/fail", 200), { type: "floor.changed" }, "a failed print shows on the board");
});

test("the floor is for the staff; the dishes are for everyone", () => {
  assert.equal(reaches({ type: "floor.changed" }, "staff"), true);
  assert.equal(reaches({ type: "floor.changed" }, "guest"), false);
  assert.equal(reaches({ type: "catalog.changed" }, "guest"), true);
  assert.equal(liveRole(new URLSearchParams("role=staff")), "staff");
  assert.equal(liveRole(new URLSearchParams("table=05")), "guest");
});
