import assert from "node:assert/strict";
import test from "node:test";
import { headersFile, headersFor, POS_PERMISSIONS, WEB_HEADERS } from "../../shared/web-headers.mjs";

test("only the POS page may use the camera, to scan booking QR codes at the door", () => {
  for (const url of ["/pos", "/pos.html", "/pos.html?lang=de"]) {
    assert.match(headersFor(url)["permissions-policy"], /camera=\(self\)/, url);
    assert.match(headersFor(url)["permissions-policy"], /microphone=\(\)/, url);
  }
  for (const url of ["/", "/index.html", "/book.html", "/admin.html", "/api/catalog", "/pos.html.map", "/media/pos.html"]) {
    assert.equal(headersFor(url)["permissions-policy"], WEB_HEADERS["permissions-policy"], url);
  }
  assert.equal(headersFor("/pos.html")["content-security-policy"], WEB_HEADERS["content-security-policy"], "the rest stays the same");
});

test("Cloudflare's _headers drops the shut camera on the POS page before it lets it through", () => {
  const file = headersFile();
  assert.ok(file.startsWith("/*\n"));
  for (const page of ["/pos", "/pos.html"]) {
    assert.ok(file.includes(`\n${page}\n  ! permissions-policy\n  permissions-policy: ${POS_PERMISSIONS}\n`), page);
  }
});
