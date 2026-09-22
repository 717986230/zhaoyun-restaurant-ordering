import test from "node:test";
import assert from "node:assert/strict";
import { generate, committed } from "../../scripts/bundle-catalog.mjs";

/**
 * The catalogue shipped inside the app is a copy of the server's seed, and a
 * copy drifts. If someone edits the seed without running the generator, a fresh
 * tablet shows a menu the kitchen no longer has — and, worse, product ids the
 * server may have stopped issuing, which is the failure the bundled menu exists
 * to avoid. Fail here instead: `npm run catalog:bundle`.
 */
test("the bundled catalogue matches the seed the server would serve", () => {
  assert.equal(committed(), generate(), "apps/customer-app/src/app/bundled-catalog.json is stale — run: npm run catalog:bundle");
});

test("every bundled product carries the fields the app maps", () => {
  const products = JSON.parse(committed());
  assert.ok(products.length > 100, `expected the full menu, got ${products.length}`);
  for (const product of products) {
    assert.ok(product.id, "product without an id");
    assert.ok(product.sku, `product ${product.id} without a sku`);
    assert.ok(product.names?.zh && product.names?.de && product.names?.en, `product ${product.sku} is not trilingual`);
    assert.equal(typeof product.price, "number", `product ${product.sku} has no numeric price`);
  }
});
