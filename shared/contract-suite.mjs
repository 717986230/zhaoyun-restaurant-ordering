/**
 * One set of assertions, run against both backends.
 *
 * The Node server and the Worker are separate implementations of the same API,
 * and the two apps are typed against one contract, so a tablet cannot tell
 * which one answered — and must not be able to. Duplicated backends drift; this
 * is what makes the drift fail a test rather than a dinner service.
 *
 * `call(method, path, { body, admin })` is whatever each runner provides:
 * `app.inject` for Fastify, `fetch` for the Worker. It returns
 * `{ status, json }`.
 */
export function contractChecks(call, assert) {
  return [
    ["the catalogue is the seeded menu", async () => {
      const denied = await call("GET", "/api/admin/products");
      assert.equal(denied.status, 401, "admin products must require a token");

      const { status, json } = await call("GET", "/api/catalog");
      assert.equal(status, 200);
      assert.equal(json.products.length, 111);
      const ramen = json.products.find((product) => product.sku === "R1");
      assert.ok(ramen, "R1 is missing from the catalogue");
      assert.equal(ramen.category, "RAMEN");
      assert.equal(ramen.price, 12.5);
      assert.equal(ramen.names.de, "Ramen mit Gemüse");
      assert.ok(json.products.some((product) => product.kind === "sushi" && product.printStation === "sushi"));
      // The category that could not be saved before it was allowed a space.
      assert.ok(json.products.some((product) => product.category === "MAIN DISHES"));
    }],

    ["an order prices its modifiers and routes one job per station", async () => {
      const created = await call("POST", "/api/orders", {
        body: {
          clientRequestId: "contract-order-0001",
          table: "17",
          note: "少盐",
          items: [
            { id: "photo-r1", qty: 2, modifiers: [{ id: "extra-noodles" }] },
            { id: "photo-n1-6", qty: 1 }
          ]
        }
      });
      assert.equal(created.status, 201);
      const order = created.json.order;
      assert.equal(order.table, "17");
      assert.equal(order.status, "new");
      // (12.50 + 2.50) × 2 for the ramen, plus the nigiri.
      assert.equal(order.items.find((item) => item.id === "photo-r1").unitPrice, 15);
      assert.equal(order.items.length, 2);

      const jobs = await call("GET", "/api/admin/print-jobs?status=queued", { admin: true });
      assert.equal(jobs.status, 200);
      const roles = jobs.json.jobs.map((job) => job.printer_role).sort();
      assert.deepEqual(roles, ["kitchen", "sushi"], "a ramen and a nigiri are two stations");
      for (const job of jobs.json.jobs) assert.equal(job.payload.table, "17");
    }],

    ["the same client request id never places a second order", async () => {
      const command = {
        clientRequestId: "contract-order-0001",
        table: "17",
        note: "少盐",
        items: [{ id: "photo-r1", qty: 2, modifiers: [{ id: "extra-noodles" }] }]
      };
      const again = await call("POST", "/api/orders", { body: command });
      assert.equal(again.status, 201);

      const list = await call("GET", "/api/orders", { admin: true });
      assert.equal(list.status, 200);
      const matching = list.json.orders.filter((order) => order.clientRequestId === "contract-order-0001");
      assert.equal(matching.length, 1, "a retried order must not duplicate");
      assert.equal(matching[0].no, again.json.order.no);
    }],

    ["an order refuses a table it was not given", async () => {
      const missing = await call("POST", "/api/orders", { body: { clientRequestId: "contract-no-table", note: "", items: [{ id: "photo-r1", qty: 1 }] } });
      assert.equal(missing.status, 400);

      const unknown = await call("POST", "/api/orders", { body: { clientRequestId: "contract-no-dish", table: "17", note: "", items: [{ id: "not-a-dish", qty: 1 }] } });
      assert.equal(unknown.status, 400);

      const silly = await call("POST", "/api/orders", { body: { clientRequestId: "contract-bad-qty", table: "17", note: "", items: [{ id: "photo-r1", qty: 0 }] } });
      assert.equal(silly.status, 400);
    }],

    ["a modifier that belongs to another dish is refused", async () => {
      const wrong = await call("POST", "/api/orders", {
        body: { clientRequestId: "contract-bad-modifier", table: "17", note: "", items: [{ id: "photo-r1", qty: 1, modifiers: [{ id: "not-an-option" }] }] }
      });
      assert.equal(wrong.status, 400);
    }],

    ["the order status machine only allows its own transitions", async () => {
      const created = await call("POST", "/api/orders", {
        body: { clientRequestId: "contract-order-0002", table: "18", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      const id = created.json.order.id;

      const skipped = await call("PATCH", `/api/orders/${id}/status`, { admin: true, body: { status: "completed" } });
      assert.equal(skipped.status, 400, "new -> completed skips preparing and ready");

      const forward = await call("PATCH", `/api/orders/${id}/status`, { admin: true, body: { status: "preparing" } });
      assert.equal(forward.status, 200);
      assert.equal(forward.json.order.status, "preparing");

      const gone = await call("PATCH", "/api/orders/not-an-order/status", { admin: true, body: { status: "preparing" } });
      assert.equal(gone.status, 404);
    }],

    ["a service request opens and closes", async () => {
      const created = await call("POST", "/api/service-requests", { body: { table: "17", type: "water" } });
      assert.equal(created.status, 201);
      assert.equal(created.json.request.serviceType, "water");
      assert.equal(created.json.request.status, "open");
      assert.equal(created.json.request.table, "17");
      // The row columns must not leak: the app is typed against `table`, not `table_no`.
      assert.equal(created.json.request.table_no, undefined);

      const done = await call("PATCH", `/api/service-requests/${created.json.request.id}/status`, {
        admin: true, body: { status: "completed" }
      });
      assert.equal(done.status, 200);
      assert.equal(done.json.request.status, "completed");

      const listed = await call("GET", "/api/service-requests", { admin: true });
      assert.equal(listed.status, 200);
      assert.ok(listed.json.requests.some((request) => request.id === created.json.request.id));
    }],

    ["a printer round-trips and validates", async () => {
      const created = await call("POST", "/api/admin/printers", {
        admin: true, body: { name: "Küche", transport: "lan", address: "192.168.1.50", port: 9100, role: "kitchen", enabled: true }
      });
      assert.equal(created.status, 201);
      assert.equal(created.json.printer.enabled, true);
      assert.equal(created.json.printer.capabilities_json, undefined, "row columns must not leak");

      const badPort = await call("POST", "/api/admin/printers", {
        admin: true, body: { name: "X", transport: "lan", address: "10.0.0.1", port: 99999, role: "kitchen", enabled: true }
      });
      assert.equal(badPort.status, 400);

      const badRole = await call("POST", "/api/admin/printers", {
        admin: true, body: { name: "X", transport: "lan", address: "10.0.0.1", port: 9100, role: "sommelier", enabled: true }
      });
      assert.equal(badRole.status, 400);

      const listed = await call("GET", "/api/admin/printers", { admin: true });
      assert.ok(listed.json.printers.some((printer) => printer.id === created.json.printer.id));
    }],

    ["a product with a space in its category saves", async () => {
      const saved = await call("POST", "/api/admin/products", {
        admin: true,
        body: { sku: "CONTRACT-1", kind: "food", category: "MAIN DISHES", names: { zh: "测试", de: "Test", en: "Test" }, price: 9.9, printStation: "kitchen" }
      });
      assert.equal(saved.status, 201, "45 of the seeded dishes have a space in their category");
      assert.equal(saved.json.product.category, "MAIN DISHES");
      assert.equal(saved.json.product.price, 9.9);

      const removed = await call("DELETE", `/api/admin/products/${saved.json.product.id}`, { admin: true });
      assert.equal(removed.status, 204);

      const gone = await call("DELETE", `/api/admin/products/${saved.json.product.id}`, { admin: true });
      assert.equal(gone.status, 404);
    }],

    ["an unknown API route is a JSON 404, not the web app", async () => {
      const { status, json } = await call("GET", "/api/not-a-route");
      assert.equal(status, 404);
      assert.ok(json.error, "an API 404 answers with an error body");
    }]
  ];
}
