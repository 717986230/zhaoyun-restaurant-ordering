/**
 * What the live channel (/ws) says, and when — one rule for both backends
 * (server/realtime.mjs on Node, workers/live.mjs on Cloudflare).
 *
 * An event is a signal, never data: `{ type, table?, at }`. Whoever gets one
 * fetches what it shows through the API it already uses, with its own
 * credentials. So the channel needs no credentials of its own and cannot leak
 * an order, a price or a name; what it says is only that something changed,
 * and at which table.
 *
 *  - `catalog.changed` reaches every socket: the menus reload their dishes.
 *  - `floor.changed` reaches the staff sockets (admin console, POS): an order,
 *    a table, a bill, a claim, a service call. The console's board and the
 *    POS floor reload at once instead of on their next poll.
 *
 * Every successful write to the API is an event unless it is listed here as
 * not one, so a new route is live without anybody remembering to make it so.
 */

export const LIVE_ROLES = ["staff", "guest"];

/** Writes that change nothing anyone else is looking at. */
const SILENT = [
  /^\/api\/account(\/|$)/,
  /^\/api\/pos\/(sign-in|sign-out)$/,
  /^\/api\/admin\/(staff|pos-devices|printers)(\/|$)/,
  // A print agent asks for work every few seconds; what it takes is nobody's news.
  /^\/api\/admin\/print-jobs\/[^/]+\/(claim|complete)$/,
  /^\/api\/admin\/print-jobs\/claim$/
];

const CATALOG = /^\/api\/admin\/(products|categories|settings)(\/|$)/;
const TABLE_IN_PATH = /\/tables\/([^/]+)(\/|$)/;

/**
 * The event a finished request makes, or null. `tableHint` is the table the
 * request body named, when the path does not (a guest's order, say).
 */
export function liveEvent(method, pathname, status, tableHint) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  if (status < 200 || status >= 300 || !pathname.startsWith("/api/")) return null;
  if (SILENT.some((pattern) => pattern.test(pathname))) return null;
  if (CATALOG.test(pathname)) return { type: "catalog.changed" };
  const inPath = TABLE_IN_PATH.exec(pathname)?.[1];
  const table = inPath ? decodeURIComponent(inPath).toUpperCase() : typeof tableHint === "string" && tableHint ? tableHint.toUpperCase() : undefined;
  return table ? { type: "floor.changed", table } : { type: "floor.changed" };
}

/** Which sockets an event goes to. */
export function reaches(event, role) {
  return event.type === "catalog.changed" || role === "staff";
}

/** A socket's role from its URL: `?role=staff` for the console and the POS, a guest otherwise. */
export function liveRole(searchParams) {
  return searchParams.get("role") === "staff" ? "staff" : "guest";
}

export function liveMessage(event) {
  return JSON.stringify({ ...event, at: new Date().toISOString() });
}
