import { describe, expect, it } from "vitest";
import { AdminApi, ApiError } from "../src/index.js";

function apiAnswering(body: string, init: ResponseInit = {}) {
  const storage = { baseUrl: "http://server", token: "token", role: null, save: () => undefined };
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(body, init)) as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = new AdminApi(storage as any);
  return { api, restore: () => { globalThis.fetch = original; } };
}

describe("a response that is not this API", () => {
  it("is a failure, not an empty object", async () => {
    // A hotel router's login page, a proxy error page and a dev server's
    // index.html all arrive as 200 text/html. Read as `{}` they used to make a
    // call look successful with every field undefined, and a list that is
    // undefined rather than empty takes the whole console down.
    const { api, restore } = apiAnswering("<!doctype html><title>Login</title>", { status: 200, headers: { "content-type": "text/html" } });
    try {
      await expect(api.tables()).rejects.toBeInstanceOf(ApiError);
    } finally {
      restore();
    }
  });

  it("keeps the server's own error message when there is one", async () => {
    const { api, restore } = apiAnswering(JSON.stringify({ error: "table is in use" }), { status: 409 });
    try {
      await expect(api.tables()).rejects.toThrow("table is in use");
    } finally {
      restore();
    }
  });

  it("still reads a normal answer", async () => {
    const { api, restore } = apiAnswering(JSON.stringify({ tables: [{ table: "12", label: "", enabled: true, token: "t" }] }), { status: 200 });
    try {
      expect((await api.tables()).tables).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
