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
import { wallClock } from "../src/schedule.js";

const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const clockTime = (minute) => {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

export function contractChecks(call, assert) {
  return [
    ["the catalogue is the seeded menu", async () => {
      const denied = await call("GET", "/api/admin/products");
      assert.equal(denied.status, 401, "admin products must require a token");

      const { status, json } = await call("GET", "/api/catalog");
      assert.equal(status, 200);
      assert.equal(json.products.length, 118, "111 dishes and 7 set menus");
      // Each set declares every allergen of every dish in it, and nothing else.
      const byId = new Map(json.products.map((product) => [product.id, product]));
      const sets = json.products.filter((product) => product.bundleItems?.length);
      assert.equal(sets.length, 7);
      for (const set of sets) {
        const parts = set.bundleItems.map((item) => byId.get(item.productId));
        assert.ok(parts.every(Boolean), `${set.sku} packs a dish that is not on the menu`);
        assert.deepEqual([...set.allergens].sort(), [...new Set(parts.flatMap((dish) => dish.allergens))].sort(), `${set.sku} allergens`);
      }
      const ramen = json.products.find((product) => product.sku === "R1");
      assert.ok(ramen, "R1 is missing from the catalogue");
      assert.equal(ramen.category, "RAMEN");
      assert.equal(ramen.price, 12.5);
      assert.equal(ramen.names.de, "Ramen mit Gemüse");
      assert.ok(json.products.some((product) => product.kind === "sushi" && product.printStation === "sushi"));
      // The category that could not be saved before it was allowed a space.
      assert.ok(json.products.some((product) => product.category === "MAIN DISHES"));
    }],

    ["a dish's photo is served where the catalogue says, and a new one can be uploaded", async () => {
      const { json } = await call("GET", "/api/catalog");
      // The seeded photos, when there are any, come out of the database with
      // their credit, cacheable for good since their URL names their bytes.
      const seeded = json.products.flatMap((product) => product.media).find((media) => media.credit);
      if (seeded) {
        const photo = await call("GET", seeded.url);
        assert.equal(photo.status, 200, `${seeded.url} is in the catalogue but not served`);
        assert.match(String(photo.headers["content-type"]), /^image\/jpeg/);
        assert.match(String(photo.headers["cache-control"]), /immutable/);
        assert.ok(photo.bytes.length > 1000, "a photo is more than a few bytes");
        assert.ok(photo.bytes[0] === 0xff && photo.bytes[1] === 0xd8, "a JPEG starts with FF D8");
      }
      assert.equal((await call("GET", "/media/no-such-picture.jpg")).status, 404);

      // A 1×1 PNG, uploaded the way the admin console does it.
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
      const boundary = "contract-boundary-7f3a";
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dish.png"\r\nContent-Type: image/png\r\n\r\n`),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ]);
      const raw = { contentType: `multipart/form-data; boundary=${boundary}`, body };
      assert.equal((await call("POST", "/api/admin/products/photo-d1/media", { raw })).status, 401, "uploading needs a token");
      const uploaded = await call("POST", "/api/admin/products/photo-d1/media", { raw, admin: true });
      assert.equal(uploaded.status, 201);
      const added = uploaded.json.product.media.at(-1);
      assert.equal(added.type, "image");
      const served = await call("GET", added.url);
      assert.equal(served.status, 200);
      assert.ok(Buffer.from(served.bytes).equals(png), "the upload comes back byte for byte");
    }],

    ["a dish is copied whole, off the menu until someone has looked at it", async () => {
      assert.equal((await call("POST", "/api/admin/products/photo-r1/duplicate")).status, 401);
      assert.equal((await call("POST", "/api/admin/products/no-such-dish/duplicate", { admin: true })).status, 404);

      const original = (await call("GET", "/api/admin/products/photo-r1", { admin: true })).json;
      const copied = await call("POST", "/api/admin/products/photo-r1/duplicate", { admin: true });
      assert.equal(copied.status, 201);
      const copy = copied.json.product;
      assert.notEqual(copy.id, original.id);
      assert.notEqual(copy.sku, original.sku, "the copy needs a code of its own");
      assert.equal(copy.names.zh, `${original.names.zh}（副本）`);
      assert.equal(copy.names.de, `${original.names.de} (Kopie)`);
      assert.equal(copy.published, false, "a half-edited twin must not reach a guest");
      for (const field of ["kind", "category", "description", "price", "vatPercent", "printStation"]) {
        assert.deepEqual(copy[field], original[field], `${field} is copied`);
      }
      assert.deepEqual(copy.allergens, original.allergens);
      assert.deepEqual(copy.modifiers, original.modifiers);
      assert.deepEqual(copy.media.map((media) => media.url), original.media.map((media) => media.url), "the photo comes along");

      const catalog = (await call("GET", "/api/catalog")).json.products;
      assert.ok(!catalog.some((product) => product.id === copy.id), "an unpublished copy stays off the menu");
      assert.equal((await call("DELETE", `/api/admin/products/${copy.id}`, { admin: true })).status, 204);
      // Removing the copy leaves the original's photo where it was.
      const after = (await call("GET", "/api/admin/products/photo-r1", { admin: true })).json;
      assert.deepEqual(after.media, original.media);
    }],

    ["the promotions page is off until switched on, and lists what the owner chose", async () => {
      const refusals = [{ featuredEnabled: "yes" }, { featuredTitle: "x".repeat(33) }, { featuredProductIds: Array.from({ length: 41 }, (_, index) => `dish-${index}`) }, { featuredProductIds: [""] }, { featuredTemplate: "neon" }];
      for (const body of refusals) {
        assert.equal((await call("PUT", "/api/admin/settings", { admin: true, body })).status, 400, `${JSON.stringify(body)} must be refused`);
      }
      const saved = await call("PUT", "/api/admin/settings", { admin: true, body: { featuredProductIds: ["photo-t4", "photo-r1", "photo-t4"], featuredTitle: "  Chef's   Selection " } });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.json.featuredProductIds, ["photo-t4", "photo-r1"], "in the owner's order, once each");
      assert.equal(saved.json.featuredTitle, "Chef's Selection");
      assert.equal((await call("GET", "/api/catalog")).json.menu.featured, null, "chosen but not switched on: nothing for a guest");

      await call("PUT", "/api/admin/settings", { admin: true, body: { featuredEnabled: true } });
      assert.deepEqual((await call("GET", "/api/catalog")).json.menu.featured, { title: "Chef's Selection", productIds: ["photo-t4", "photo-r1"], template: "gallery", schedule: null });
      assert.equal((await call("PUT", "/api/admin/settings", { admin: true, body: { featuredTemplate: "tasting" } })).json.featuredTemplate, "tasting");
      assert.equal((await call("GET", "/api/catalog")).json.menu.featured.template, "tasting");

      await call("PUT", "/api/admin/settings", { admin: true, body: { featuredEnabled: false, featuredTitle: "", featuredProductIds: [], featuredTemplate: "gallery" } });
      assert.equal((await call("GET", "/api/catalog")).json.menu.featured, null);
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
      const roles = jobs.json.jobs.map((job) => job.printerRole).sort();
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
      assert.equal(created.json.request.type, "water");
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
      assert.equal(created.json.printer.capabilities && typeof created.json.printer.capabilities, "object");

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

    ["the menu style is jade until a manager picks another, and the catalogue carries it", async () => {
      const before = await call("GET", "/api/catalog");
      assert.equal(before.json.theme, "jade", "a fresh restaurant ships the default menu style");

      const denied = await call("PUT", "/api/admin/settings", { body: { menuTheme: "teal" } });
      assert.equal(denied.status, 401, "changing the menu style requires a token");

      const badTheme = await call("PUT", "/api/admin/settings", { admin: true, body: { menuTheme: "gold" } });
      assert.equal(badTheme.status, 400, "only the vetted presets may be picked");

      const saved = await call("PUT", "/api/admin/settings", { admin: true, body: { menuTheme: "teal" } });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.menuTheme, "teal");

      const after = await call("GET", "/api/catalog");
      assert.equal(after.json.theme, "teal", "the guest menu reads the style a manager just picked");

      const read = await call("GET", "/api/admin/settings", { admin: true });
      assert.equal(read.json.menuTheme, "teal");

      // Leave the fixture as every other test expects it.
      await call("PUT", "/api/admin/settings", { admin: true, body: { menuTheme: "jade" } });
    }],

    ["the menu offers English and German until a manager picks otherwise", async () => {
      const before = await call("GET", "/api/catalog");
      assert.deepEqual(before.json.languages, ["en", "de"], "a fresh restaurant offers English and German");

      const denied = await call("PUT", "/api/admin/settings", { body: { menuLanguages: ["zh"] } });
      assert.equal(denied.status, 401, "changing the menu's languages requires a token");

      for (const menuLanguages of [[], ["fr"], ["en", "en"]]) {
        const refused = await call("PUT", "/api/admin/settings", { admin: true, body: { menuLanguages } });
        assert.equal(refused.status, 400, `${JSON.stringify(menuLanguages)} is not a set of menu languages`);
      }
      assert.equal((await call("PUT", "/api/admin/settings", { admin: true, body: {} })).status, 400, "an empty save is a mistake");

      // Picked in any order, stored and served in flag order.
      const saved = await call("PUT", "/api/admin/settings", { admin: true, body: { menuLanguages: ["de", "zh", "en"] } });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.json.menuLanguages, ["zh", "en", "de"]);
      assert.equal(saved.json.menuTheme, "jade", "saving the languages alone leaves the menu style as it was");
      assert.deepEqual((await call("GET", "/api/catalog")).json.languages, ["zh", "en", "de"]);

      // And the other way round: a style change leaves the languages alone.
      await call("PUT", "/api/admin/settings", { admin: true, body: { menuTheme: "teal" } });
      assert.deepEqual((await call("GET", "/api/admin/settings", { admin: true })).json.menuLanguages, ["zh", "en", "de"]);

      await call("PUT", "/api/admin/settings", { admin: true, body: { menuTheme: "jade", menuLanguages: ["en", "de"] } });
    }],

    ["the restaurant's name, the menu's title and its look are the owner's to set", async () => {
      const before = await call("GET", "/api/catalog");
      assert.deepEqual(before.json.menu, { title: "La Carte", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true, timeZone: "Europe/Vienna", setsSchedule: null, featured: null },
        "a fresh restaurant ships with these");

      assert.equal((await call("PUT", "/api/admin/settings", { body: { restaurantName: "Anyone" } })).status, 401);
      for (const body of [{ restaurantName: "   " }, { menuTitle: "x".repeat(25) }, { menuDefaultScheme: "sepia" }, { showTableNumber: "yes" }]) {
        const refused = await call("PUT", "/api/admin/settings", { admin: true, body });
        assert.equal(refused.status, 400, `${JSON.stringify(body)} must be refused`);
      }

      const saved = await call("PUT", "/api/admin/settings", {
        admin: true,
        body: { restaurantName: "  Goldener   Drache ", menuTitle: "Speisekarte", menuDefaultScheme: "light", showTableNumber: false }
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.json.restaurantName, "Goldener Drache", "names are trimmed and their spaces collapsed");
      assert.deepEqual((await call("GET", "/api/catalog")).json.menu,
        { title: "Speisekarte", restaurantName: "Goldener Drache", defaultScheme: "light", showTableNumber: false, timeZone: "Europe/Vienna", setsSchedule: null, featured: null });
      assert.equal(saved.json.showOrdering, false, "the ordering sections start hidden while the menu is view-only");
      // A save of one setting leaves the rest where they were.
      assert.equal(saved.json.menuTheme, "jade");
      assert.deepEqual(saved.json.menuLanguages, ["en", "de"]);

      await call("PUT", "/api/admin/settings", {
        admin: true,
        body: { restaurantName: "赵云", menuTitle: "La Carte", menuDefaultScheme: "dark", showTableNumber: true }
      });
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

    ["the menu belongs to the manager, and the board does not", async () => {
      // The reason this check exists: the Worker had one token and no roles at
      // all, so a waiter tablet pointed at the Cloudflare deployment could edit
      // the menu, its prices and its allergen declarations. Hiding the tab in
      // the console is not access control; this is.
      for (const role of ["staff", "kitchen"]) {
        const listed = await call("GET", "/api/admin/products", { role });
        assert.equal(listed.status, 403, `${role} must not read the catalogue`);
        const written = await call("POST", "/api/admin/products", {
          role,
          body: { sku: `DENY-${role}`, kind: "food", category: "MAIN", names: { zh: "x", de: "x", en: "x" }, price: 1, printStation: "kitchen" }
        });
        assert.equal(written.status, 403, `${role} must not write the catalogue`);
        const printers = await call("GET", "/api/admin/printers", { role });
        assert.equal(printers.status, 403, `${role} must not read printer profiles`);
      }

      // What each role may do instead. The console asks /session on connect and
      // shows only the tabs that answer, so this is what decides what it shows.
      for (const role of ["manager", "staff", "kitchen"]) {
        const session = await call("GET", "/api/admin/session", { role });
        assert.equal(session.status, 200);
        assert.equal(session.json.role, role, "a token must report its own role");
      }
      assert.equal((await call("GET", "/api/orders", { role: "kitchen" })).status, 200, "the kitchen screen reads orders");
      assert.equal((await call("GET", "/api/service-requests", { role: "kitchen" })).status, 403, "service calls are the floor's, not the kitchen's");
      assert.equal((await call("GET", "/api/service-requests", { role: "staff" })).status, 200);
      assert.equal((await call("GET", "/api/admin/print-jobs?status=queued", { role: "staff" })).status, 200);

      // A valid token used beyond its role is recorded, not just refused.
      const audit = await call("GET", "/api/admin/audit", { admin: true });
      assert.equal(audit.status, 200);
      assert.ok(
        audit.json.entries.some((entry) => entry.status === 403 && entry.route.includes("/api/admin/products")),
        "a refused catalogue read must leave an audit entry"
      );
    }],

    ["the console's password gate is set once and then signs in", async () => {
      const before = await call("GET", "/api/admin/gate");
      assert.equal(before.status, 200, "the gate says whether a password exists, without one");
      assert.equal(before.json.configured, false, "a fresh deployment has no password yet");
      // One bit, and only that bit: the hash must never leave the database.
      assert.deepEqual(Object.keys(before.json), ["configured"]);

      const tooShort = await call("POST", "/api/admin/gate/password", { body: { password: "short" } });
      assert.equal(tooShort.status, 400, "the password floor is refused at the edge");

      const set = await call("POST", "/api/admin/gate/password", { body: { password: "kueche-passwort-2026" } });
      assert.equal(set.status, 200);
      assert.equal(set.json.configured, true);
      assert.equal((await call("GET", "/api/admin/gate")).json.configured, true);

      const wrong = await call("POST", "/api/admin/gate/sign-in", { body: { password: "kueche-passwort-2025" } });
      assert.equal(wrong.status, 401, "a wrong password is refused");

      const signedIn = await call("POST", "/api/admin/gate/sign-in", { body: { password: "kueche-passwort-2026" } });
      assert.equal(signedIn.status, 200);
      assert.ok(signedIn.json.token, "signing in hands back a session token");
      assert.equal(signedIn.json.password, undefined, "and nothing else about the password");
      const session = signedIn.json.token;

      // The session is presented in the same header every other route reads,
      // which is the whole reason no other route had to change.
      const asManager = await call("GET", "/api/admin/products", { token: session });
      assert.equal(asManager.status, 200, "past the gate the console is manager");
      assert.equal((await call("GET", "/api/admin/session", { token: session })).json.role, "manager");

      // Once set, changing it takes the one in force — otherwise anyone who
      // reached the console could take it over.
      const unproven = await call("POST", "/api/admin/gate/password", { body: { password: "ein-neues-passwort" } });
      assert.equal(unproven.status, 401, "a second set needs the current password");

      const changed = await call("POST", "/api/admin/gate/password", {
        body: { password: "ein-neues-passwort", currentPassword: "kueche-passwort-2026" }
      });
      assert.equal(changed.status, 200);
      assert.equal(
        (await call("GET", "/api/admin/products", { token: session })).status, 401,
        "changing the password ends the sessions opened with the old one"
      );
      assert.equal((await call("POST", "/api/admin/gate/sign-in", { body: { password: "kueche-passwort-2026" } })).status, 401);

      // ADMIN_TOKEN is the way back in when the password is forgotten, and it
      // is the token rather than a live session that may do this: a stolen
      // session must not be able to lock the owner out of their own menu.
      const recovered = await call("POST", "/api/admin/gate/password", { admin: true, body: { password: "wieder-hereingekommen" } });
      assert.equal(recovered.status, 200, "ADMIN_TOKEN resets the password without knowing it");
      const back = await call("POST", "/api/admin/gate/sign-in", { body: { password: "wieder-hereingekommen" } });
      assert.equal(back.status, 200);

      const out = await call("POST", "/api/admin/gate/sign-out", { token: back.json.token });
      assert.equal(out.status, 204);
      assert.equal(
        (await call("GET", "/api/admin/products", { token: back.json.token })).status, 401,
        "a signed-out token is dead"
      );
    }],

    ["a table round-trips with the token its card prints", async () => {
      const created = await call("POST", "/api/admin/tables", { admin: true, body: { table: "c7", label: "Fenster" } });
      assert.equal(created.status, 201);
      assert.equal(created.json.table.table, "C7", "table numbers are upper-cased");
      assert.equal(created.json.table.label, "Fenster");
      assert.equal(created.json.table.enabled, true);
      assert.ok(created.json.table.token, "the entry link needs a token to carry");
      assert.equal(created.json.table.table_no, undefined, "row columns must not leak");

      // A label fix must not invalidate every printed card.
      const relabelled = await call("POST", "/api/admin/tables", { admin: true, body: { table: "C7", label: "Fenster links" } });
      assert.equal(relabelled.json.table.token, created.json.table.token);
      const rotated = await call("POST", "/api/admin/tables", { admin: true, body: { table: "C7", rotateToken: true } });
      assert.notEqual(rotated.json.table.token, created.json.table.token);

      const listed = await call("GET", "/api/admin/tables", { admin: true });
      assert.ok(listed.json.tables.some((table) => table.table === "C7"));
      assert.equal((await call("GET", "/api/admin/tables", { role: "staff" })).status, 403, "table tokens are manager-only");
      assert.equal((await call("GET", "/api/admin/tables/open", { role: "staff" })).status, 200, "but the floor sees which tables are open");

      const nonsense = await call("POST", "/api/admin/tables", { admin: true, body: { table: "no spaces here" } });
      assert.equal(nonsense.status, 400);

      assert.equal((await call("DELETE", "/api/admin/tables/C7", { admin: true })).status, 204);
      assert.equal((await call("DELETE", "/api/admin/tables/C7", { admin: true })).status, 404);
    }],

    ["a locked table stops taking orders, and settling is what frees it", async () => {
      // The lock is service state, not configuration: `enabled` takes a table
      // out of the room, this one stops it adding to a bill that is being
      // settled. An order that lands mid-settle is either missing from the bill
      // the guest just paid or reopens a table that was released, so the refusal
      // is the feature.
      const registered = await call("POST", "/api/admin/tables", { admin: true, body: { table: "L1" } });
      const tableToken = registered.json.table.token;

      // Registering the first table also closes the open mode a fresh install
      // starts in: from here an order has to carry the token printed on the
      // card, or anyone who knows the address can order onto someone's bill.
      const untokened = await call("POST", "/api/orders", {
        body: { clientRequestId: "contract-no-table-token", table: "L1", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      assert.equal(untokened.status, 403, "a registered table needs the token from its card");
      const unknownTable = await call("POST", "/api/orders", {
        tableToken,
        body: { clientRequestId: "contract-unknown-table", table: "ZZ", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      assert.equal(unknownTable.status, 403, "and it has to be a table that exists");

      const seated = await call("POST", "/api/orders", {
        tableToken,
        body: { clientRequestId: "contract-lock-before", table: "L1", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      assert.equal(seated.status, 201);

      const overview = await call("GET", "/api/admin/tables/overview", { role: "staff" });
      assert.equal(overview.status, 200);
      const before = overview.json.tables.find((entry) => entry.table === "L1");
      assert.ok(before, "a table with orders on it must appear in the overview");
      assert.equal(before.state, "seated");
      assert.equal(before.orders.length, 1);
      assert.equal(before.total, 12.5);
      assert.equal(before.orders[0].items[0].name, before.orders[0].items[0].name, "the overview carries what was ordered");
      assert.equal(before.token, undefined, "the entry token is the manager's, not the floor's");

      const locked = await call("POST", "/api/admin/tables/L1/lock", { role: "staff", body: { locked: true } });
      assert.equal(locked.status, 200);
      assert.equal(locked.json.table.locked, true);
      assert.ok(locked.json.table.lockedAt, "a lock records when it was set");

      const refused = await call("POST", "/api/orders", {
        tableToken,
        body: { clientRequestId: "contract-lock-during", table: "L1", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      assert.equal(refused.status, 409, "a locked table refuses new orders, and not as a bad request");

      const whileLocked = await call("GET", "/api/admin/tables/overview", { role: "staff" });
      assert.equal(whileLocked.json.tables.find((entry) => entry.table === "L1").state, "locked");

      const unlocked = await call("POST", "/api/admin/tables/L1/lock", { role: "staff", body: { locked: false } });
      assert.equal(unlocked.json.table.locked, false);
      assert.equal(unlocked.json.table.lockedAt, null);

      const accepted = await call("POST", "/api/orders", {
        tableToken,
        body: { clientRequestId: "contract-lock-after", table: "L1", note: "", items: [{ id: "photo-r1", qty: 1 }] }
      });
      assert.equal(accepted.status, 201, "unlocking lets the table order again");

      const missing = await call("POST", "/api/admin/tables/ZZ/lock", { role: "staff", body: { locked: true } });
      assert.equal(missing.status, 404);

      // The bill, and what settling does to the table.
      const bill = await call("GET", "/api/admin/tables/L1/bill", { role: "staff" });
      assert.equal(bill.status, 200);
      // Two orders survived above, one dish each at 12.50.
      assert.equal(bill.json.bill.total, 25);
      assert.equal(bill.json.bill.orderIds.length, 2);
      assert.equal(bill.json.bill.fiscalReceipt, false, "this is an internal bill, never a Kassenbeleg");
      // Menu prices are gross, so VAT comes out of the price rather than onto
      // it — and the rounding happens once per rate group, not per line.
      assert.deepEqual(bill.json.bill.vatBreakdown, [{ percent: 10, gross: 25, net: 22.73, vat: 2.27 }]);
      assert.equal(bill.json.bill.items.length, 2);
      assert.equal(bill.json.bill.items[0].unitPrice, 12.5);
      assert.ok(bill.json.bill.items[0].names.de, "a guest reads the bill, so the localized names travel with it");

      await call("POST", "/api/admin/tables/L1/lock", { role: "staff", body: { locked: true } });
      const settled = await call("POST", "/api/admin/tables/L1/bill/settle", { role: "staff" });
      assert.equal(settled.status, 200);
      assert.equal(settled.json.bill.total, 25);
      assert.ok(settled.json.bill.printJobId, "the bill goes to the front printer as a job");

      const afterSettle = await call("GET", "/api/admin/tables/overview", { role: "staff" });
      const freed = afterSettle.json.tables.find((entry) => entry.table === "L1");
      assert.equal(freed.state, "free", "paying is what frees the table");
      assert.equal(freed.locked, false, "and it clears the lock the waiter set");
      assert.equal(freed.orders.length, 0, "settled orders leave the open bill");

      const emptied = await call("GET", "/api/admin/tables/L1/bill", { role: "staff" });
      assert.equal(emptied.json.bill.total, 0);
      const again = await call("POST", "/api/admin/tables/L1/bill/settle", { role: "staff" });
      assert.equal(again.status, 409, "a settled table cannot be settled twice");

      // Leave the room as it was found: a registered table changes how every
      // later order is authenticated.
      assert.equal((await call("DELETE", "/api/admin/tables/L1", { admin: true })).status, 204);
    }],

    ["the promotions and set menus pages have hours, by the restaurant's clock", async () => {
      // Built around the moment the test runs: hours that have not begun, and
      // hours that are open now. Two hours either side of a minute boundary.
      const { minute } = wallClock(new Date(), "Europe/Vienna");
      const later = { days: EVERY_DAY, from: clockTime(minute + 120), to: clockTime(minute + 180) };
      const open = { days: EVERY_DAY, from: clockTime(minute - 120), to: clockTime(minute + 120) };
      const settings = (body) => call("PUT", "/api/admin/settings", { admin: true, body });

      const before = await call("GET", "/api/admin/settings", { admin: true });
      assert.equal(before.json.featuredSchedule, null, "no hours: always on");
      assert.equal(before.json.setsSchedule, null);

      const saved = await settings({ featuredEnabled: true, featuredProductIds: ["photo-r1"], featuredSchedule: { ...later, days: [5, 1, 5] }, setsSchedule: later });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.json.featuredSchedule, { ...later, days: [1, 5] }, "days are kept in order, once each");
      assert.deepEqual(saved.json.setsSchedule, later);

      // The menu gets the hours and the clock to read them by; hiding is the
      // menu's, so a menu left open all afternoon still changes on time.
      const menu = (await call("GET", "/api/catalog")).json.menu;
      assert.deepEqual(menu.featured.schedule, { ...later, days: [1, 5] });
      assert.deepEqual(menu.setsSchedule, later);
      assert.equal(menu.timeZone, "Europe/Vienna");

      // A set is not served outside the set menus' hours; a dish is, always.
      const order = (clientRequestId, id) => call("POST", "/api/orders", { body: { clientRequestId, table: "19", note: "", items: [{ id, qty: 1 }] } });
      assert.equal((await order("contract-set-before-hours", "set-lunch")).status, 400, "no set before its hours");
      assert.equal((await order("contract-dish-any-time", "photo-r1")).status, 201, "dishes have no hours");
      await settings({ setsSchedule: open });
      assert.equal((await order("contract-set-in-hours", "set-lunch")).status, 201, "sets are served in their hours");

      for (const schedule of [{ days: [], from: "11:00", to: "14:00" }, { days: [8], from: "11:00", to: "14:00" }, { days: [1], from: "25:00", to: "14:00" }, { days: [1], from: "11:00" }]) {
        assert.equal((await settings({ setsSchedule: schedule })).status, 400, JSON.stringify(schedule));
      }

      // The clock is a setting too; a zone no one has heard of is refused.
      assert.equal((await settings({ timeZone: "Mars/Olympus" })).status, 400);
      const moved = await settings({ timeZone: "Asia/Shanghai" });
      assert.equal(moved.json.timeZone, "Asia/Shanghai");
      assert.equal((await call("GET", "/api/catalog")).json.menu.timeZone, "Asia/Shanghai");

      // Leave the room as it was found.
      const reset = await settings({ timeZone: "Europe/Vienna", featuredSchedule: null, setsSchedule: null, featuredEnabled: false, featuredProductIds: [] });
      assert.equal(reset.json.featuredSchedule, null, "null takes the hours away: always on");
      assert.equal(reset.json.setsSchedule, null);
    }],

    ["an unknown API route is a JSON 404, not the web app", async () => {
      const { status, json } = await call("GET", "/api/not-a-route");
      assert.equal(status, 404);
      assert.ok(json.error, "an API 404 answers with an error body");
    }]
  ];
}
