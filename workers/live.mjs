import { DurableObject } from "cloudflare:workers";
import { liveMessage, liveRole, reaches } from "../shared/live.mjs";

/**
 * The live channel on Cloudflare: one Durable Object ("hub") holds every open
 * /ws socket, the way server/realtime.mjs holds them in the Node process.
 * What an event is and who hears it is shared/live.mjs's.
 *
 * The sockets are accepted with the hibernation API, so an idle restaurant
 * costs nothing: the object sleeps between events and each socket's role
 * travels as its tag.
 */
export class LiveHub extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const event = await request.json();
      const message = liveMessage(event);
      for (const role of ["staff", "guest"]) {
        if (!reaches(event, role)) continue;
        for (const socket of this.ctx.getWebSockets(role)) {
          try { socket.send(message); } catch { /* A socket closing as we speak. */ }
        }
      }
      return new Response(null, { status: 204 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [liveRole(url.searchParams)]);
    server.send(liveMessage({ type: "connected" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketClose(socket, code) {
    try { socket.close(code); } catch { /* Already closed. */ }
  }
}

/** The one hub every Worker instance talks to. */
function hub(env) {
  return env.LIVE?.get(env.LIVE.idFromName("hub"));
}

/** Hands a /ws request to the hub. */
export function openLive(request, env) {
  const stub = hub(env);
  return stub ? stub.fetch(request) : new Response("Live updates are not configured", { status: 404 });
}

/** Tells every socket that should know. Never fails the write it follows. */
export async function publishLive(env, event) {
  try {
    await hub(env)?.fetch("https://live/publish", { method: "POST", body: JSON.stringify(event) });
  } catch { /* The next poll catches up. */ }
}
