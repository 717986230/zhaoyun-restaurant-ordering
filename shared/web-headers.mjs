/**
 * The headers every page of the web app is served with, wherever it is served
 * from: the Worker (as dist/web/_headers, which Cloudflare's static assets
 * read), the Node server, and `vite preview`, which the browser tests run
 * against — so a policy that breaks a page fails a test before it ships.
 *
 * The app loads nothing from anywhere else: no CDN, no web font, no inline
 * script. So scripts come from this origin only, which is what stops an
 * injected <script> from running. Styles allow 'unsafe-inline' for React's
 * style attributes. Pictures and connections may go to another server: a
 * dish photo can be a link, and the console and the POS can be pointed at
 * a restaurant's own server on its network.
 *
 * Nothing here may import `node:` anything: vite.config.js and the Node
 * server both read it.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob: https: http:",
  "font-src 'self' data:",
  // Not 'self' alone: the console and the POS can be pointed at a restaurant's
  // own server on its network (http://192.168.…), and an https page is kept
  // from plain http by the browser's mixed-content rules regardless.
  "connect-src 'self' https: http: wss: ws:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export const WEB_HEADERS = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  // A year, once a browser has seen the site over HTTPS. Browsers ignore it over plain HTTP (a Node server on the restaurant's network).
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  // Nothing in the app uses these; a script that got in cannot either.
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"
};

/** The POS reads a guest's booking QR code with the camera at the door; no other page may use one. */
export const POS_PERMISSIONS = "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()";
const POS_PAGES = ["/pos", "/pos.html"];

/** The headers for one path: the POS page's let it use the camera. */
export function headersFor(url = "/") {
  const path = url.split(/[?#]/)[0];
  return POS_PAGES.includes(path) ? { ...WEB_HEADERS, "permissions-policy": POS_PERMISSIONS } : WEB_HEADERS;
}

/**
 * Cloudflare's `_headers` file: the same headers on every page and asset,
 * and on the POS page (served as /pos, or /pos.html) the camera let through:
 * `! name` drops the value the `/*` rule set before it is set again.
 */
export function headersFile() {
  const pos = POS_PAGES.flatMap((page) => [page, "  ! permissions-policy", `  permissions-policy: ${POS_PERMISSIONS}`]);
  return ["/*", ...Object.entries(WEB_HEADERS).map(([name, value]) => `  ${name}: ${value}`), ...pos, ""].join("\n");
}
