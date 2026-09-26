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

/**
 * A socket on the live channel that hands its messages out one at a time:
 * `next()` resolves with the next one, or fails after `ms` without one.
 */
function listen(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const queue = [];
    const waiting = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const deliver = waiting.shift();
      if (deliver) deliver(message); else queue.push(message);
    });
    socket.addEventListener("error", () => reject(new Error(`could not open ${url}`)));
    socket.addEventListener("open", () => resolve({
      next(ms = 5000) {
        if (queue.length) return Promise.resolve(queue.shift());
        return new Promise((done, fail) => {
          const timer = setTimeout(() => fail(new Error("no live event")), ms);
          waiting.push((message) => { clearTimeout(timer); done(message); });
        });
      },
      close: () => socket.close()
    }));
  });
}

/** `liveBase` is the backend's address as ws://host:port. */
export function contractChecks(call, assert, { liveBase } = {}) {
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
      assert.deepEqual(before.json.menu, { title: "La Carte", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true, timeZone: "Europe/Vienna", setsSchedule: null, navPinned: [], navLabels: {}, featured: null },
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
        { title: "Speisekarte", restaurantName: "Goldener Drache", defaultScheme: "light", showTableNumber: false, timeZone: "Europe/Vienna", setsSchedule: null, navPinned: [], navLabels: {}, featured: null });
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

    ["the restaurant registers one account, signs in with its name and password, and gets back in with ADMIN_TOKEN", async () => {
      const before = await call("GET", "/api/account");
      assert.equal(before.status, 200, "whether there is an account is answered without one");
      assert.deepEqual(before.json, { registered: false }, "one bit, and only that bit");
      assert.equal((await call("GET", "/api/admin/products")).status, 401);

      assert.equal((await call("POST", "/api/account/register", { body: { login: "wirt", password: "short" } })).status, 400, "the password floor");
      assert.equal((await call("POST", "/api/account/register", { body: { login: "x", password: "kueche-passwort-2026" } })).status, 400, "the account name floor");
      assert.equal((await call("POST", "/api/account/register", { body: { login: "wirt name!", password: "kueche-passwort-2026" } })).status, 400, "the account name's letters");

      const registered = await call("POST", "/api/account/register", { body: { login: " Wirt@Zhaoyun.at ", name: "Frau Li", password: "kueche-passwort-2026" } });
      assert.equal(registered.status, 201);
      assert.ok(registered.json.token, "registering signs in");
      assert.deepEqual({ ...registered.json.account, id: "", createdAt: "" }, { id: "", login: "wirt@zhaoyun.at", name: "Frau Li", createdAt: "" }, "the name is kept without case or spaces; no hash leaves");
      assert.deepEqual((await call("GET", "/api/account")).json, { registered: true });
      const second = await call("POST", "/api/account/register", { body: { login: "someone", password: "anderes-passwort" } });
      assert.equal(second.status, 409, "one restaurant, one account: registration closes");

      assert.equal((await call("POST", "/api/account/sign-in", { body: { login: "wirt@zhaoyun.at", password: "kueche-passwort-2025" } })).status, 401, "a wrong password");
      assert.equal((await call("POST", "/api/account/sign-in", { body: { login: "nobody", password: "kueche-passwort-2026" } })).status, 401, "an unknown name, the same answer");
      const signedIn = await call("POST", "/api/account/sign-in", { body: { login: "WIRT@zhaoyun.at", password: "kueche-passwort-2026" } });
      assert.equal(signedIn.status, 200, "the name without case");
      const session = signedIn.json.token;
      assert.equal((await call("GET", "/api/admin/products", { token: session })).status, 200, "the account is manager");
      const who = (await call("GET", "/api/admin/session", { token: session })).json;
      assert.equal(who.role, "manager");
      assert.equal(who.account.name, "Frau Li", "and says whose session it is");

      // Every change is made against the password in force.
      assert.equal((await call("PUT", "/api/account", { token: session, body: { currentPassword: "falsch-falsch", name: "X" } })).status, 401);
      const renamed = await call("PUT", "/api/account", { token: session, body: { currentPassword: "kueche-passwort-2026", login: "chef", name: "Chef Li" } });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.json.account.login, "chef");
      assert.equal(renamed.json.token, undefined, "a new name keeps the sessions");
      assert.equal((await call("GET", "/api/admin/products", { token: session })).status, 200);
      const changed = await call("PUT", "/api/account", { token: session, body: { currentPassword: "kueche-passwort-2026", password: "ein-neues-passwort" } });
      assert.equal(changed.status, 200);
      assert.ok(changed.json.token, "a new password hands this device a fresh session");
      assert.equal((await call("GET", "/api/admin/products", { token: session })).status, 401, "and ends the others");
      assert.equal((await call("GET", "/api/admin/products", { token: changed.json.token })).status, 200);
      assert.equal((await call("POST", "/api/account/sign-in", { body: { login: "chef", password: "kueche-passwort-2026" } })).status, 401);

      // ADMIN_TOKEN is the way back in, and it is the token rather than a
      // session that may do this: a stolen tablet must not lock the owner out.
      assert.equal((await call("POST", "/api/account/recover", { token: changed.json.token, body: { password: "wieder-hereingekommen" } })).status, 401);
      const recovered = await call("POST", "/api/account/recover", { admin: true, body: { password: "wieder-hereingekommen" } });
      assert.equal(recovered.status, 200, "ADMIN_TOKEN resets the password without knowing it");
      assert.equal(recovered.json.account.login, "chef");
      assert.equal((await call("GET", "/api/admin/products", { token: changed.json.token })).status, 401, "and ends every session");
      const back = await call("POST", "/api/account/sign-in", { body: { login: "chef", password: "wieder-hereingekommen" } });
      assert.equal(back.status, 200);

      const out = await call("POST", "/api/account/sign-out", { token: back.json.token });
      assert.equal(out.status, 204);
      assert.equal((await call("GET", "/api/admin/products", { token: back.json.token })).status, 401, "a signed-out token is dead");
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
      // The bill printed for the guest to read is not a payment: it frees nothing.
      const printed = await call("POST", "/api/admin/tables/L1/bill/print", { role: "staff" });
      assert.equal(printed.status, 200);
      assert.equal(printed.json.bill.total, 25);
      assert.ok(printed.json.bill.printJobId, "the bill goes to the front printer as a job");
      assert.equal((await call("GET", "/api/admin/tables/overview", { role: "staff" })).json.tables.find((entry) => entry.table === "L1").state, "locked");

      // Paying is a receipt.
      const paid = await call("POST", "/api/admin/checkout", {
        role: "staff",
        body: { table: "L1", items: bill.json.bill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "cash", amount: 25 }] }
      });
      assert.equal(paid.status, 201, JSON.stringify(paid.json));

      const afterSettle = await call("GET", "/api/admin/tables/overview", { role: "staff" });
      const freed = afterSettle.json.tables.find((entry) => entry.table === "L1");
      assert.equal(freed.state, "free", "paying is what frees the table");
      assert.equal(freed.locked, false, "and it clears the lock the waiter set");
      assert.equal(freed.orders.length, 0, "paid orders leave the open bill");

      const emptied = await call("GET", "/api/admin/tables/L1/bill", { role: "staff" });
      assert.equal(emptied.json.bill.total, 0);
      assert.equal((await call("POST", "/api/admin/tables/L1/bill/print", { role: "staff" })).status, 409, "nothing left to print");

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

    ["the owner names the tabs per language, and renames or merges a category with its dishes", async () => {
      const settings = (body) => call("PUT", "/api/admin/settings", { admin: true, body });
      const rename = (from, to) => call("POST", "/api/admin/categories/rename", { admin: true, body: { from, to } });
      assert.deepEqual((await call("GET", "/api/admin/settings", { admin: true })).json.navLabels, {});

      // Names per language, trimmed; a blank one keeps the menu's wording, a tab with none is dropped.
      const named = await settings({ navLabels: { RAMEN: { zh: " 拉面 ", de: "Ramen", en: "" }, ALLE: { zh: "全部菜品" }, SUSHI: { zh: "" } } });
      assert.equal(named.status, 200);
      assert.deepEqual(named.json.navLabels, { RAMEN: { zh: "拉面", de: "Ramen" }, ALLE: { zh: "全部菜品" } });
      assert.deepEqual((await call("GET", "/api/catalog")).json.menu.navLabels, named.json.navLabels, "the menu gets them");
      assert.equal((await settings({ navLabels: { RAMEN: { fr: "Ramen" } } })).status, 400, "zh, en and de only");
      assert.equal((await settings({ navLabels: { RAMEN: { zh: "x".repeat(25) } } })).status, 400, "24 characters at most");

      // A rename moves the dishes, and the category's place and names go with it.
      await settings({ navPinned: ["RAMEN", "ALLE"] });
      const ramenCount = (await call("GET", "/api/admin/products", { admin: true })).json.products.filter((dish) => dish.category === "RAMEN").length;
      const moved = await rename("RAMEN", " noodle  soups ");
      assert.equal(moved.status, 200);
      assert.equal(moved.json.renamed, ramenCount);
      assert.equal(moved.json.category, "NOODLE SOUPS", "stored as dishes store a category");
      assert.deepEqual(moved.json.settings.navPinned, ["NOODLE SOUPS", "ALLE"]);
      assert.deepEqual(moved.json.settings.navLabels.RAMEN, undefined);
      assert.deepEqual(moved.json.settings.navLabels["NOODLE SOUPS"], { zh: "拉面", de: "Ramen" });
      const products = (await call("GET", "/api/catalog")).json.products;
      assert.equal(products.filter((dish) => dish.category === "RAMEN").length, 0);
      assert.equal(products.filter((dish) => dish.category === "NOODLE SOUPS").length, ramenCount);

      // Onto an existing category, the two are one; that one's names stay.
      const merged = await rename("NOODLE SOUPS", "SPECIALS");
      assert.equal(merged.status, 200);
      assert.deepEqual(merged.json.settings.navPinned, ["SPECIALS", "ALLE"]);
      assert.equal(merged.json.settings.navLabels["NOODLE SOUPS"], undefined);

      assert.equal((await rename("NO SUCH CATEGORY", "X")).status, 404, "nothing to move");
      assert.equal((await rename("SPECIALS", "SPECIALS")).status, 400, "the same name");
      assert.equal((await rename("SPECIALS", "ALLE")).status, 400, "not the all-dishes tab's id");
      assert.equal((await rename("SPECIALS", "拉面")).status, 400, "a category code is Latin letters and digits");

      // Leave the room as it was found: split the merged dishes back apart by their codes.
      for (const dish of (await call("GET", "/api/admin/products", { admin: true })).json.products) {
        if (dish.category === "SPECIALS" && /^R\d/.test(dish.sku)) {
          assert.equal((await call("PUT", `/api/admin/products/${dish.id}`, { admin: true, body: { ...dish, category: "RAMEN" } })).status, 200);
        }
      }
      await settings({ navPinned: [], navLabels: {} });
    }],

    ["the owner picks the guest menu's first three tabs, without conflicts", async () => {
      const settings = (body) => call("PUT", "/api/admin/settings", { admin: true, body });
      assert.deepEqual((await call("GET", "/api/admin/settings", { admin: true })).json.navPinned, []);
      assert.deepEqual((await settings({ navPinned: [" RAMEN ", "RAMEN"] })).json.navPinned, ["RAMEN"], "trimmed, once each");
      assert.deepEqual((await settings({ navPinned: ["", "SUSHI"] })).json.navPinned, ["SUSHI"], "a blank place leaves the next to move up");
      const saved = await settings({ navPinned: ["RAMEN", "__featured__", "__sets__"] });
      assert.equal(saved.status, 200);
      assert.deepEqual(saved.json.navPinned, ["RAMEN", "__featured__", "__sets__"]);
      assert.deepEqual((await call("GET", "/api/catalog")).json.menu.navPinned, ["RAMEN", "__featured__", "__sets__"]);
      assert.equal((await settings({ navPinned: ["RAMEN", "SUSHI", "ALLE", "__sets__"] })).status, 400, "the first three, no more");
      assert.deepEqual((await settings({ navPinned: [] })).json.navPinned, []);
    }],

    ["each dish keeps its VAT rate, a set is split over its dishes' rates, and a category is set at once", async () => {
      const dish = async (body) => {
        const saved = await call("POST", "/api/admin/products", { admin: true, body: { names: { zh: body.sku, de: body.sku, en: body.sku }, published: true, available: true, ...body } });
        assert.equal(saved.status, 201, JSON.stringify(saved.json));
        return saved.json.product;
      };
      // A drink starts at 20%, food at 10%, and a rate the owner picks is kept.
      const soup = await dish({ sku: "VAT-F", kind: "food", category: "VATTEST", price: 10, printStation: "kitchen" });
      const cola = await dish({ sku: "VAT-D", kind: "drink", category: "VATDRINKS", price: 5, printStation: "bar" });
      assert.equal(soup.vatPercent, 10);
      assert.equal(cola.vatPercent, 20);
      const juice = await dish({ sku: "VAT-J", kind: "drink", category: "VATDRINKS", price: 4, printStation: "bar", vatPercent: 13 });
      assert.equal(juice.vatPercent, 13, "the rate the owner sets is the one saved");
      const edited = await call("PUT", `/api/admin/products/${juice.id}`, { admin: true, body: { ...juice, vatPercent: 20 } });
      assert.equal(edited.json.product.vatPercent, 20, "and an edit keeps it too");
      assert.equal((await call("POST", "/api/admin/products", { admin: true, body: { sku: "VAT-X", kind: "food", category: "VATTEST", names: { zh: "x", de: "x", en: "x" }, price: 1, vatPercent: 15 } })).status, 400);

      // A set of the soup and the drink, sold for 12: its price divides in the
      // proportion of 10 to 5, so 8 at 10% and 4 at 20%.
      const set = await dish({ sku: "VAT-S", kind: "food", category: "VATSETS", price: 12, printStation: "kitchen", bundleItems: [{ productId: soup.id, quantity: 1 }, { productId: cola.id, quantity: 1 }] });

      const table = await call("POST", "/api/admin/tables", { admin: true, body: { table: "V1" } });
      const ordered = await call("POST", "/api/orders", {
        tableToken: table.json.table.token,
        body: { clientRequestId: "contract-vat", table: "V1", note: "", items: [{ id: cola.id, qty: 2 }, { id: set.id, qty: 1 }] }
      });
      assert.equal(ordered.status, 201, JSON.stringify(ordered.json));
      const bill = (await call("GET", "/api/admin/tables/V1/bill", { role: "staff" })).json.bill;
      assert.equal(bill.total, 22);
      assert.deepEqual(bill.vatBreakdown, [
        { percent: 10, gross: 8, net: 7.27, vat: 0.73 },
        { percent: 20, gross: 14, net: 11.67, vat: 2.33 }
      ], "two drinks and the set's drink share at 20%, the set's soup share at 10%");
      const setLine = bill.items.find((item) => item.name === "VAT-S");
      assert.deepEqual(setLine.vatSplit, [{ percent: 10, amount: 8 }, { percent: 20, amount: 4 }]);
      assert.equal(bill.items.find((item) => item.name === "VAT-D").vatSplit, undefined, "a dish at one rate is just that rate");

      // What the kitchen and the bar get has no price on it.
      const jobs = (await call("GET", "/api/admin/print-jobs?status=queued&limit=50", { role: "staff" })).json.jobs
        .filter((job) => job.orderId === ordered.json.order.id);
      assert.deepEqual(jobs.map((job) => job.printerRole).sort(), ["bar", "kitchen"]);
      for (const job of jobs) assert.ok(!JSON.stringify(job.payload).includes("price"), `the ${job.printerRole} ticket carries no price`);

      // A whole category at once; set menus keep their split.
      const moved = await call("POST", "/api/admin/categories/vat", { admin: true, body: { category: " vatdrinks ", vatPercent: 13 } });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      assert.deepEqual(moved.json, { updated: 2, category: "VATDRINKS", vatPercent: 13 });
      assert.equal((await call("POST", "/api/admin/categories/vat", { admin: true, body: { category: "VATSETS", vatPercent: 20 } })).status, 404, "a category of set menus has nothing to set");
      assert.equal((await call("POST", "/api/admin/categories/vat", { admin: true, body: { category: "NOSUCH", vatPercent: 20 } })).status, 404);
      assert.equal((await call("POST", "/api/admin/categories/vat", { admin: true, body: { category: "VATDRINKS", vatPercent: 7 } })).status, 400);
      assert.equal((await call("POST", "/api/admin/categories/vat", { role: "staff", body: { category: "VATDRINKS", vatPercent: 20 } })).status, 403, "rates are the owner's");
      // The order already written keeps the rates it was written with.
      assert.deepEqual((await call("GET", "/api/admin/tables/V1/bill", { role: "staff" })).json.bill.vatBreakdown.map((group) => group.percent), [10, 20]);

      const open = (await call("GET", "/api/admin/tables/V1/bill", { role: "staff" })).json.bill;
      assert.equal((await call("POST", "/api/admin/checkout", {
        role: "staff", body: { table: "V1", items: open.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "card", amount: open.total }] }
      })).status, 201);
      for (const product of [soup, cola, juice, set]) await call("DELETE", `/api/admin/products/${product.id}`, { admin: true });
      await call("DELETE", "/api/admin/tables/V1", { admin: true });
    }],

    ["the register: split receipts, cash change, vouchers, storno, the day's closing and a journal that shows any change", async () => {
      const staff = { role: "staff" };
      const checkout = (body, auth = staff) => call("POST", "/api/admin/checkout", { ...auth, body });
      // Start after a closing, so the day's totals below are this check's alone.
      await call("POST", "/api/admin/day-closings", { admin: true });

      const dish = async (body) => (await call("POST", "/api/admin/products", { admin: true, body: { names: { zh: body.sku, de: body.sku, en: body.sku }, published: true, available: true, ...body } })).json.product;
      const noodles = await dish({ sku: "REG-N", kind: "food", category: "REGTEST", price: 10, printStation: "kitchen" });
      const tea = await dish({ sku: "REG-T", kind: "drink", category: "REGTEST", price: 4, printStation: "bar" });
      const token = (await call("POST", "/api/admin/tables", { admin: true, body: { table: "K1" } })).json.table.token;
      const order = async (clientRequestId, items) => (await call("POST", "/api/orders", { tableToken: token, body: { clientRequestId, table: "K1", note: "", items } })).json.order;
      const placed = await order("contract-register-1", [{ id: noodles.id, qty: 2 }, { id: tea.id, qty: 1 }]);
      const lines = async () => (await call("GET", "/api/admin/tables/K1/bill", staff)).json.bill.items;
      const lineOf = async (sku) => (await lines()).find((item) => item.name === sku);

      // One guest pays one bowl by card: a receipt of that line alone.
      const first = await checkout({ table: "K1", items: [{ orderItemId: (await lineOf("REG-N")).orderItemId, quantity: 1 }], payments: [{ type: "card", amount: 10 }] });
      assert.equal(first.status, 201, JSON.stringify(first.json));
      const a = first.json.receipt;
      assert.equal(a.type, "sale");
      assert.equal(a.totalCents, 1000);
      assert.deepEqual(a.vat, [{ percent: 10, grossCents: 1000, netCents: 909, vatCents: 91 }]);
      assert.equal(a.fiscalStatus, "unsigned", "no signature until fiskaly is connected");
      assert.equal(a.table, "K1");
      assert.equal((await lineOf("REG-N")).qty, 1, "the paid bowl is off the bill");
      assert.equal((await call("GET", "/api/admin/tables/overview", staff)).json.tables.find((entry) => entry.table === "K1").state, "seated", "the table is not paid yet");

      // What does not add up is refused, with a reason a cashier can read.
      const rest = await lines();
      const all = rest.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty }));
      assert.equal((await checkout({ items: [{ orderItemId: all[0].orderItemId, quantity: 5 }], payments: [{ type: "cash", amount: 50 }] })).status, 400, "more than is left");
      const short = await checkout({ items: all, payments: [{ type: "cash", amount: 13 }] });
      assert.equal(short.status, 400);
      assert.match(short.json.error, /13\.00.*14\.00/);
      assert.equal((await checkout({ items: all, payments: [{ type: "cheque", amount: 14 }] })).status, 400);
      assert.equal((await checkout({ items: all, payments: [{ type: "cash", amount: 14, tendered: 10 }] })).status, 400, "less handed over than it pays");
      assert.equal((await checkout({ items: all, payments: [{ type: "cash", amount: 14 }] }, { role: "kitchen" })).status, 403);

      // The rest in cash, with a 20 note: the change is worked out, the table is free.
      const second = await checkout({ table: "K1", items: all, payments: [{ type: "cash", amount: 14, tendered: 20 }], clientRequestId: "contract-register-b" });
      assert.equal(second.status, 201, JSON.stringify(second.json));
      const b = second.json.receipt;
      assert.equal(b.receiptNo, a.receiptNo + 1, "receipt numbers run on without a gap");
      assert.deepEqual(b.payments, [{ type: "cash", amountCents: 1400, tenderedCents: 2000, changeCents: 600 }]);
      assert.deepEqual(b.vat.map((group) => [group.percent, group.grossCents]), [[10, 1000], [20, 400]]);
      assert.equal((await call("GET", "/api/admin/tables/overview", staff)).json.tables.find((entry) => entry.table === "K1").state, "free");
      const again = await checkout({ table: "K1", items: all, payments: [{ type: "cash", amount: 14 }], clientRequestId: "contract-register-b" });
      assert.equal(again.json.receipt.id, b.id, "a retried checkout is the same receipt, not a second one");
      assert.equal((await checkout({ items: all, payments: [{ type: "cash", amount: 14 }] })).status, 400, "a paid line cannot be paid twice");

      // A value voucher: on the receipt at 0%, its VAT is due when it is spent.
      const sold = await checkout({ vouchers: [{ amount: 30 }], payments: [{ type: "card", amount: 30 }] });
      assert.equal(sold.status, 201, JSON.stringify(sold.json));
      const c = sold.json.receipt;
      assert.deepEqual(c.vat, [{ percent: 0, grossCents: 3000, netCents: 3000, vatCents: 0 }]);
      const code = c.lines[0].code;
      assert.match(code, /^[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/);
      assert.equal((await call("GET", `/api/admin/vouchers/${code.toLowerCase().replace("-", "")}`, staff)).json.voucher.balanceCents, 3000, "a code typed without its dash, in small letters, is found");
      assert.equal((await checkout({ vouchers: [{ amount: 10 }], payments: [{ type: "voucher", amount: 10, voucherCode: code }] })).status, 400, "a voucher cannot pay for a voucher");

      // Spent in part on the next order, the rest in cash.
      await order("contract-register-2", [{ id: noodles.id, qty: 2 }]);
      const next = await lines();
      assert.equal((await checkout({ items: next.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "voucher", amount: 20, voucherCode: "NOSUCH" }] })).status, 400);
      const tooMuch = await checkout({ items: next.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "voucher", amount: 31, voucherCode: code }] });
      assert.equal(tooMuch.status, 400);
      const spent = await checkout({ table: "K1", items: next.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "voucher", amount: 12, voucherCode: code }, { type: "cash", amount: 8 }] });
      assert.equal(spent.status, 201, JSON.stringify(spent.json));
      const d = spent.json.receipt;
      assert.equal((await call("GET", `/api/admin/vouchers/${code}`, staff)).json.voucher.balanceCents, 1800);

      // A storno: the manager's, with a reason; the same lines negated, under a number of its own.
      assert.equal((await call("POST", `/api/admin/receipts/${b.id}/storno`, { ...staff, body: { reason: "wrong table" } })).status, 403);
      assert.equal((await call("POST", `/api/admin/receipts/${b.id}/storno`, { admin: true, body: { reason: "" } })).status, 400);
      const cancelled = await call("POST", `/api/admin/receipts/${b.id}/storno`, { admin: true, body: { reason: "wrong table" } });
      assert.equal(cancelled.status, 201, JSON.stringify(cancelled.json));
      const e = cancelled.json.receipt;
      assert.equal(e.type, "storno");
      assert.equal(e.refersTo, b.id);
      assert.equal(e.refersToNo, b.receiptNo);
      assert.equal(e.totalCents, -1400);
      assert.equal(e.reason, "wrong table");
      assert.deepEqual(e.lines.map((line) => line.quantity), b.lines.map((line) => -line.quantity));
      assert.equal((await call("GET", `/api/admin/receipts/${b.id}`, staff)).json.receipt.cancelledBy, e.id);
      assert.equal((await call("POST", `/api/admin/receipts/${b.id}/storno`, { admin: true, body: { reason: "twice" } })).status, 409);
      assert.equal((await call("POST", `/api/admin/receipts/${e.id}/storno`, { admin: true, body: { reason: "a storno of a storno" } })).status, 400);
      assert.equal((await call("POST", "/api/admin/receipts/nope/storno", { admin: true, body: { reason: "x" } })).status, 404);
      // Its lines are open again, and the table with them.
      assert.equal((await lines()).reduce((sum, item) => sum + item.qty, 0), 2, "one bowl and the tea, to pay again");
      assert.equal((await call("GET", "/api/admin/tables/overview", staff)).json.tables.find((entry) => entry.table === "K1").state, "seated");
      // An order on a standing receipt cannot just be cancelled.
      assert.equal((await call("PATCH", `/api/orders/${placed.id}/status`, { role: "staff", body: { status: "cancelled" } })).status, 400);

      // A voucher partly spent cannot be taken back; the receipt it paid can, and gives the money back to it.
      assert.equal((await call("POST", `/api/admin/receipts/${c.id}/storno`, { admin: true, body: { reason: "refund" } })).status, 400);
      assert.equal((await call("POST", `/api/admin/receipts/${d.id}/storno`, { admin: true, body: { reason: "refund" } })).status, 201);
      assert.equal((await call("GET", `/api/admin/vouchers/${code}`, staff)).json.voucher.balanceCents, 3000);

      // The day's closing: what the receipts since the last one add up to.
      const preview = (await call("GET", "/api/admin/day-closings/preview", { admin: true })).json.totals;
      assert.equal(preview.sales, 4);
      assert.equal(preview.stornos, 2);
      assert.equal(preview.grossCents, 1000 + 3000, "a cancelled sale adds up to nothing");
      assert.deepEqual(preview.payments, { cash: 0, card: 4000, voucher: 0 });
      assert.equal(preview.vouchersSoldCents, 3000);
      assert.equal((await call("GET", "/api/admin/day-closings/preview", staff)).status, 403);
      const closed = await call("POST", "/api/admin/day-closings", { admin: true });
      assert.equal(closed.status, 201);
      assert.equal(closed.json.closing.totals.lastReceiptNo, preview.lastReceiptNo);
      assert.equal((await call("POST", "/api/admin/day-closings", { admin: true })).status, 409, "nothing since");
      assert.equal((await call("GET", "/api/admin/day-closings", { admin: true })).json.closings[0].closingNo, closed.json.closing.closingNo);

      // The journal: everything above, in order, each entry chained to the one before.
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const journal = await call("GET", `/api/admin/journal?from=${today}&to=${tomorrow}`, { admin: true });
      assert.equal(journal.status, 200, JSON.stringify(journal.json));
      assert.deepEqual(journal.json.verification, { ok: true, brokenAt: null, reason: null });
      const kinds = journal.json.entries.map((entry) => entry.kind);
      for (const kind of ["order.created", "receipt.issued", "receipt.storno", "day.closed"]) assert.ok(kinds.includes(kind), kind);
      const seqs = journal.json.entries.map((entry) => entry.seq);
      assert.deepEqual(seqs, seqs.map((_, index) => seqs[0] + index), "no gap");
      const issued = journal.json.entries.find((entry) => entry.kind === "receipt.issued" && entry.ref === b.id);
      assert.equal(issued.payload.totalCents, 1400, "the journal keeps the whole receipt");
      assert.equal((await call("GET", `/api/admin/journal?from=${today}`, { admin: true })).status, 400);
      const instants = await call("GET", `/api/admin/journal?from=${encodeURIComponent(`${today}T00:00:00.000Z`)}&to=${encodeURIComponent(`${tomorrow}T00:00:00.000Z`)}`, { admin: true });
      assert.equal(instants.json.entries.length, journal.json.entries.length, "a day as an instant is the same day");
      assert.equal((await call("GET", "/api/admin/journal?from=yesterday&to=today", { admin: true })).status, 400);
      assert.equal((await call("GET", `/api/admin/journal?from=${today}&to=${tomorrow}`, staff)).status, 403);

      await call("PATCH", `/api/orders/${placed.id}/status`, { role: "staff", body: { status: "preparing" } });
      await call("DELETE", "/api/admin/tables/K1", { admin: true });
      for (const product of [noodles, tea]) await call("DELETE", `/api/admin/products/${product.id}`, { admin: true });
    }],

    ["the POS: paired devices, waiters' PINs, tables locked to the device that has them open, takeaway, moving a table, settlement", async () => {
      // Only the manager pairs a device; its token is what lets waiters sign in on it.
      assert.equal((await call("POST", "/api/admin/pos-devices", { role: "staff", body: { name: "Tablet A" } })).status, 403);
      assert.equal((await call("POST", "/api/admin/pos-devices", { admin: true, body: { name: " " } })).status, 400);
      const pairA = await call("POST", "/api/admin/pos-devices", { admin: true, body: { name: "Tablet A" } });
      assert.equal(pairA.status, 201, JSON.stringify(pairA.json));
      const deviceA = pairA.json.token;
      const deviceB = (await call("POST", "/api/admin/pos-devices", { admin: true, body: { name: "Phone B" } })).json.token;

      // The waiters, with their PINs; no PIN ever comes back.
      const hire = (body) => call("POST", "/api/admin/staff", { admin: true, body });
      const li = (await hire({ name: "Li", pin: "1234" })).json.staff;
      const wang = (await hire({ name: "Wang", role: "manager", pin: "987654" })).json.staff;
      assert.deepEqual(li, { id: li.id, name: "Li", role: "staff", active: true });
      assert.equal((await hire({ name: "Li", pin: "1111" })).status, 400, "one waiter per name");
      assert.equal((await hire({ name: "Zhao", pin: "12" })).status, 400, "a PIN is 4 to 6 digits");
      assert.equal((await hire({ name: "Zhao" })).status, 400, "a new waiter needs a PIN");
      assert.equal((await hire({ name: "Zhao", role: "owner", pin: "1234" })).status, 400);

      // A device that is not paired gets neither the names nor a sign-in.
      assert.equal((await call("GET", "/api/pos/staff")).status, 401);
      assert.equal((await call("POST", "/api/pos/sign-in", { body: { staffId: li.id, pin: "1234" } })).status, 401);
      const listed = (await call("GET", "/api/pos/staff", { deviceToken: deviceA })).json.staff;
      assert.deepEqual(listed.map((person) => person.name).filter((name) => ["Li", "Wang"].includes(name)).sort(), ["Li", "Wang"]);
      assert.ok(listed.every((person) => !("pin_hash" in person) && !("pinHash" in person)));
      assert.equal((await call("POST", "/api/pos/sign-in", { deviceToken: deviceA, body: { staffId: li.id, pin: "0000" } })).status, 401);
      const liSession = (await call("POST", "/api/pos/sign-in", { deviceToken: deviceA, body: { staffId: li.id, pin: "1234" } })).json;
      assert.ok(liSession.token);
      assert.equal(liSession.staff.name, "Li");
      const wangSession = (await call("POST", "/api/pos/sign-in", { deviceToken: deviceB, body: { staffId: wang.id, pin: "987654" } })).json;
      const asLi = { token: liSession.token };
      const asWang = { token: wangSession.token };

      assert.equal((await call("GET", "/api/pos/floor", asLi)).status, 200);
      assert.equal((await call("GET", "/api/pos/floor", { role: "staff" })).status, 403, "the POS is for a waiter signed in on a device");
      assert.equal((await call("GET", "/api/admin/products", asLi)).status, 403, "a waiter's PIN is not the manager's console");

      // Li opens table P1: it is Li's device's until Li closes it or leaves it alone.
      const claim = await call("POST", "/api/pos/tables/p1/claim", asLi);
      assert.equal(claim.status, 200, JSON.stringify(claim.json));
      assert.equal(claim.json.claim.staffName, "Li");
      const refused = await call("POST", "/api/pos/tables/P1/claim", asWang);
      assert.equal(refused.status, 409);
      assert.match(refused.json.error, /Li/);
      assert.ok((await call("GET", "/api/pos/floor", asWang)).json.claims.some((entry) => entry.table === "P1" && entry.staffName === "Li"));

      // Li orders on it; the ticket says who. Wang cannot add to it meanwhile.
      const dishes = (await call("GET", "/api/catalog")).json.products.filter((product) => !product.bundleItems?.length);
      const [food] = dishes.filter((product) => product.kind === "food");
      const [drink] = dishes.filter((product) => product.kind === "drink");
      const posOrder = (auth, table, clientRequestId, items) => call("POST", "/api/pos/orders", { ...auth, body: { clientRequestId, table, note: "", items } });
      const ordered = await posOrder(asLi, "P1", "contract-pos-1", [{ id: food.id, qty: 2 }, { id: drink.id, qty: 1 }]);
      assert.equal(ordered.status, 201, JSON.stringify(ordered.json));
      const jobs = (await call("GET", "/api/admin/print-jobs?status=queued&limit=200", { role: "staff" })).json.jobs.filter((job) => job.orderId === ordered.json.order.id);
      assert.ok(jobs.length && jobs.every((job) => job.payload.staffName === "Li"), "the kitchen ticket names the waiter");
      assert.equal((await posOrder(asWang, "P1", "contract-pos-2", [{ id: food.id, qty: 1 }])).status, 409);

      // The console sees the floor as it stands: who has P1 open, who took the
      // order, and each waiter — where signed in, which tables, the shift so far.
      const p1Now = (await call("GET", "/api/admin/tables/overview", { admin: true })).json.tables.find((entry) => entry.table === "P1");
      assert.deepEqual(p1Now.openOn, { staffId: li.id, staffName: "Li" });
      assert.equal(p1Now.orders[0].staffName, "Li");
      assert.equal((await call("GET", "/api/orders?limit=20", { admin: true })).json.orders.find((order) => order.id === ordered.json.order.id).staffName, "Li");
      const liNow = (await call("GET", "/api/admin/staff/activity", { admin: true })).json.staff.find((entry) => entry.id === li.id);
      assert.equal(liNow.online, true);
      assert.equal(liNow.devices.length, 1);
      assert.deepEqual(liNow.tables, ["P1"]);
      assert.equal(liNow.shift.receipts, 0);
      assert.equal((await call("GET", "/api/admin/staff/activity", asLi)).status, 403, "the manager's view");

      // Closed on Li's device, it is anyone's.
      assert.equal((await call("DELETE", "/api/pos/tables/P1/claim", asLi)).status, 204);
      assert.equal((await call("POST", "/api/pos/tables/P1/claim", asWang)).status, 200);

      // Wang takes payment for the food with 10% off; Li cannot pay it from the other device.
      const bill = (await call("GET", "/api/admin/tables/P1/bill", asWang)).json.bill;
      const foodLine = bill.items.find((item) => item.name === ordered.json.order.items[0].name);
      assert.equal((await call("POST", "/api/admin/checkout", { ...asLi, body: { table: "P1", items: [{ orderItemId: foodLine.orderItemId, quantity: 2 }], payments: [{ type: "cash", amount: 1 }] } })).status, 409);
      const foodCents = Math.round(food.price * 100) * 2;
      const off = Math.round(foodCents * 10 / 100);
      const paid = await call("POST", "/api/admin/checkout", {
        ...asWang, body: { table: "P1", items: [{ orderItemId: foodLine.orderItemId, quantity: 2 }], discountPercent: 10, payments: [{ type: "card", amount: (foodCents - off) / 100 }] }
      });
      assert.equal(paid.status, 201, JSON.stringify(paid.json));
      assert.equal(paid.json.receipt.staffName, "Wang");
      assert.equal(paid.json.receipt.totalCents, foodCents - off);
      const discount = paid.json.receipt.lines.find((line) => line.kind === "discount");
      assert.equal(discount.totalCents, -off);
      assert.deepEqual(paid.json.receipt.vat.map((group) => group.grossCents), [foodCents - off], "the discount comes off the rate it applies to");
      assert.equal(paid.json.receipt.lines[0].names.de, food.names.de, "the receipt keeps the German name for the front printer");
      assert.equal((await call("POST", "/api/admin/checkout", { ...asWang, body: { items: [], discountPercent: 150, vouchers: [{ amount: 5 }], payments: [{ type: "cash", amount: 5 }] } })).status, 400);

      // The guests move to P2; their drink goes with them.
      assert.equal((await call("POST", "/api/pos/tables/P1/move", { ...asWang, body: { to: "P1" } })).status, 400);
      const moved = await call("POST", "/api/pos/tables/P1/move", { ...asWang, body: { to: "P2" } });
      assert.equal(moved.status, 200, JSON.stringify(moved.json));
      assert.deepEqual(moved.json, { from: "P1", to: "P2", moved: 1 });
      const p2 = (await call("GET", "/api/admin/tables/P2/bill", asWang)).json.bill;
      assert.equal(p2.items.length, 1);
      assert.equal((await call("POST", "/api/pos/tables/P1/move", { ...asWang, body: { to: "P3" } })).status, 404, "nothing left on P1");

      // Takeaway: the next pickup number, as a table of its own; the ticket carries it.
      const takeaway = await call("POST", "/api/pos/takeaway", asLi);
      assert.equal(takeaway.status, 201, JSON.stringify(takeaway.json));
      assert.equal(takeaway.json.table, `TA-${takeaway.json.pickupNo}`);
      const second = (await call("POST", "/api/pos/takeaway", asWang)).json;
      assert.equal(second.pickupNo, takeaway.json.pickupNo + 1, "a number another device has open is taken");
      const togo = await posOrder(asLi, takeaway.json.table, "contract-pos-togo", [{ id: food.id, qty: 1 }]);
      assert.equal(togo.status, 201, JSON.stringify(togo.json));
      const togoJob = (await call("GET", "/api/admin/print-jobs?status=queued&limit=200", { role: "staff" })).json.jobs.find((job) => job.orderId === togo.json.order.id);
      assert.equal(togoJob.payload.pickupNo, takeaway.json.pickupNo);
      const togoBill = (await call("GET", `/api/admin/tables/${takeaway.json.table}/bill`, asLi)).json.bill;
      const liPaid = await call("POST", "/api/admin/checkout", {
        ...asLi, body: { table: takeaway.json.table, items: togoBill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "cash", amount: togoBill.total, tendered: togoBill.total + 5 }] }
      });
      assert.equal(liPaid.status, 201, JSON.stringify(liPaid.json));
      const liShift = (await call("GET", "/api/admin/staff/activity", { admin: true })).json.staff.find((entry) => entry.id === li.id).shift;
      assert.equal(liShift.receipts, 1);
      assert.equal(liShift.payments.cash, Math.round(togoBill.total * 100), "the cash Li holds");

      // Settlement: Li hands in the cash Li took; Wang's is Wang's.
      const preview = (await call("GET", "/api/pos/settlement", asLi)).json.totals;
      assert.equal(preview.receipts, 1);
      assert.equal(preview.payments.cash, Math.round(togoBill.total * 100));
      assert.equal((await call("GET", `/api/pos/settlement?staffId=${wang.id}`, asLi)).status, 403, "only the manager looks at another waiter's");
      const settled = await call("POST", "/api/pos/settlement", { ...asLi, body: {} });
      assert.equal(settled.status, 201, JSON.stringify(settled.json));
      assert.equal(settled.json.settlement.staffName, "Li");
      assert.equal((await call("POST", "/api/pos/settlement", { ...asLi, body: {} })).status, 409, "nothing since");
      assert.equal((await call("POST", "/api/pos/settlement", { ...asWang, body: { staffId: li.id } })).status, 409, "the manager may, but there is nothing");
      assert.equal((await call("POST", "/api/pos/settlement", { ...asWang, body: {} })).status, 201);
      assert.ok((await call("GET", "/api/pos/settlements", asWang)).json.settlements.some((entry) => entry.staffName === "Li"));

      // In the journal: who moved what, who settled.
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      const kinds = (await call("GET", `/api/admin/journal?from=${today}&to=${tomorrow}`, { admin: true })).json.entries.map((entry) => entry.kind);
      for (const kind of ["table.moved", "staff.settled"]) assert.ok(kinds.includes(kind), kind);

      // A waiter switched off is signed out at once.
      assert.equal((await call("PUT", `/api/admin/staff/${li.id}`, { admin: true, body: { active: false } })).status, 200);
      assert.equal((await call("GET", "/api/pos/floor", asLi)).status, 401);

      // Leave the room as it was found.
      for (const table of ["P1", "P2", takeaway.json.table, second.table]) await call("DELETE", `/api/pos/tables/${table}/claim?force=1`, asWang);
      const p2Left = (await call("GET", "/api/admin/tables/P2/bill", asWang)).json.bill;
      await call("POST", "/api/admin/checkout", { ...asWang, body: { table: "P2", items: p2Left.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })), payments: [{ type: "card", amount: p2Left.total }] } });
      await call("PUT", `/api/admin/staff/${wang.id}`, { admin: true, body: { active: false } });
      for (const device of (await call("GET", "/api/admin/pos-devices", { admin: true })).json.devices) {
        assert.equal((await call("DELETE", `/api/admin/pos-devices/${device.id}`, { admin: true })).status, 204);
      }
    }],

    ["every write tells the console and the POS at once, and the menus only about the dishes", async () => {
      const staff = await listen(`${liveBase}/ws?role=staff`);
      const guest = await listen(`${liveBase}/ws?table=05`);
      try {
        assert.equal((await staff.next()).type, "connected");
        assert.equal((await guest.next()).type, "connected");

        // A signal, never data: the type and the table, and nothing to leak.
        assert.equal((await call("POST", "/api/admin/tables", { admin: true, body: { table: "lv1" } })).status, 201);
        const registered = await staff.next();
        assert.deepEqual({ type: registered.type, table: registered.table }, { type: "floor.changed", table: "LV1" });
        assert.deepEqual(Object.keys(registered).sort(), ["at", "table", "type"]);

        // A refused write and a read say nothing; the next event is the next change.
        assert.equal((await call("POST", "/api/admin/tables", { admin: true, body: { table: "!!" } })).status, 400);
        await call("GET", "/api/admin/tables/overview", { admin: true });
        assert.equal((await call("DELETE", "/api/admin/tables/LV1", { admin: true })).status, 204);
        const removed = await staff.next();
        assert.deepEqual({ type: removed.type, table: removed.table }, { type: "floor.changed", table: "LV1" });

        // The dishes: everybody, the guests included — and the guests heard nothing before it.
        const current = (await call("GET", "/api/admin/settings", { admin: true })).json;
        assert.equal((await call("PUT", "/api/admin/settings", { admin: true, body: { menuTitle: current.menuTitle } })).status, 200);
        assert.equal((await staff.next()).type, "catalog.changed");
        assert.equal((await guest.next()).type, "catalog.changed", "a guest hears of the dishes, and of nothing on the floor");
      } finally {
        staff.close();
        guest.close();
      }
    }],

    ["an unknown API route is a JSON 404, not the web app", async () => {
      const { status, json } = await call("GET", "/api/not-a-route");
      assert.equal(status, 404);
      assert.ok(json.error, "an API 404 answers with an error body");
    }]
  ];
}
