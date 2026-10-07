import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { existsSync } from "node:fs";
import { createApi, createApiState } from "../shared/http.mjs";
import { liveRole } from "../shared/live.mjs";
import { iconRequest } from "../shared/app-icons.mjs";

/**
 * The Node server's routes: every /api route is shared/http.mjs's — the same
 * code the Worker runs — handed the request as the web's own Request. What is
 * the Node server's own is here: the live channel's sockets, uploads written
 * to disk (videos too, up to 50 MB), and the built web app.
 */
const MEDIA_TYPES = new Map([
  ["image/jpeg", { type: "image", extension: ".jpg" }],
  ["image/png", { type: "image", extension: ".png" }],
  ["image/webp", { type: "image", extension: ".webp" }],
  ["video/mp4", { type: "video", extension: ".mp4" }],
  ["video/webm", { type: "video", extension: ".webm" }]
]);
const API_BODY_LIMIT = 2 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = 51 * 1024 * 1024;
// An app's icon: four PNGs of at most 1 MB each.
const ICON_BODY_LIMIT = 5 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const API_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

export function registerRoutes(app, { database, realtime, config }) {
  /** An upload on disk, served at /media/<file>; the dish gets the URL. */
  async function saveUpload(productId, file) {
    const accepted = MEDIA_TYPES.get(file.type);
    if (!accepted) return { error: "Only JPEG, PNG, WebP, MP4 and WebM are supported" };
    if (file.size > UPLOAD_MAX_BYTES) return { error: "Media file exceeds 50 MB", status: 413 };
    if (!(await database.getProduct(productId))) return { product: null };
    const filename = `${randomUUID()}${accepted.extension}`;
    const target = path.join(config.uploadDir, filename);
    try {
      await pipeline(Readable.fromWeb(file.stream()), createWriteStream(target, { flags: "wx" }));
      const product = await database.addMedia(productId, { type: accepted.type, url: `/media/${filename}` });
      if (!product) await unlink(target).catch(() => undefined);
      return { product };
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
  }

  const api = createApi({
    store: database,
    state: createApiState({ publicWindowMs: config.publicRateLimitWindowMs, orderMax: config.orderRateLimitMax, serviceMax: config.serviceRateLimitMax }),
    tokens: { manager: config.adminToken, staff: config.staffToken, kitchen: config.kitchenToken },
    uploads: saveUpload,
    publish: (event) => realtime.publish(event),
    realtimeClients: () => realtime.size(),
    version: config.version ?? null,
    delivery: config.delivery ?? {},
    mail: config.mail ?? null,
    ...(config.deliveryFetch ? { fetch: config.deliveryFetch } : {})
  });

  /** A Fastify request as the web's Request, for shared/http.mjs. */
  function toRequest(request) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) headers.append(name, String(item));
    }
    const hasBody = !["GET", "HEAD"].includes(request.method) && request.body !== undefined && request.body !== null;
    return new Request(`http://${request.headers.host || "localhost"}${request.url}`, { method: request.method, headers, ...(hasBody ? { body: request.body } : {}) });
  }

  /** The Response back through Fastify's reply. */
  async function send(reply, response) {
    reply.code(response.status);
    for (const [name, value] of response.headers) reply.header(name, value);
    if (response.status === 204 || response.status === 304) return reply.send();
    return reply.send(Buffer.from(await response.arrayBuffer()));
  }

  // Every body reaches shared/http.mjs as it came: it parses and checks it.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (request, bodyBytes, done) => done(null, bodyBytes));

  async function forward(request, reply) {
    const response = await api(toRequest(request), { ip: request.ip, requestId: request.id });
    if (!response) return reply.code(404).send({ error: "API route not found" });
    return send(reply, response);
  }

  app.route({ method: API_METHODS, url: "/api/*", bodyLimit: API_BODY_LIMIT, handler: forward });
  // A dish's photo or video, larger than any other body.
  app.route({ method: ["POST"], url: "/api/admin/products/:id/media", bodyLimit: UPLOAD_BODY_LIMIT, handler: forward });
  app.route({ method: ["PUT"], url: "/api/admin/app-icons/:app", bodyLimit: ICON_BODY_LIMIT, handler: forward });

  // The installed apps' icons and manifests: the owner's own when there is one
  // (shared/app-icons.mjs), before the built files in the web folder answer.
  app.addHook("onRequest", async (request, reply) => {
    if (!["GET", "HEAD"].includes(request.method) || !iconRequest(request.url.split("?")[0])) return;
    const response = await api(toRequest(request), { ip: request.ip, requestId: request.id });
    if (response) return send(reply, response);
  });

  app.get("/ws", { websocket: true }, (socket, request) => {
    realtime.connect(socket, liveRole(new URLSearchParams(request.query ?? {})));
  });

  // A picture kept in the database answers first; anything else is an upload
  // on disk. The id carries a hash of the bytes, so it can be cached for good.
  app.get("/media/:file", async (request, reply) => {
    const response = await api(toRequest(request), { ip: request.ip, requestId: request.id });
    if (response) return send(reply, response);
    return reply.sendFile(request.params.file);
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found" });
    // Never answer a missing bundle with the HTML shell: browsers then fail on the MIME type
    // instead of showing that the build is stale.
    if (request.url.startsWith("/assets/") || request.url.startsWith("/media/")) {
      return reply.code(404).send({ error: "Asset not found" });
    }
    const pages = { "/admin": "admin.html", "/pos": "pos.html", "/book": "book.html" };
    const fallback = path.join(config.webDir, pages[request.url.split("?")[0]] ?? "index.html");
    if (existsSync(fallback)) return reply.type("text/html").sendFile(path.basename(fallback), config.webDir);
    return reply.code(404).send({ error: "Run npm run build before using the production web server" });
  });
}
