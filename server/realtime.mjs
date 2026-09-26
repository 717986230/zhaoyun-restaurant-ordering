import { liveMessage, reaches } from "../shared/live.mjs";

/**
 * The live channel on the Node server: every open /ws socket and its role,
 * "staff" (the console, the POS) or "guest" (a menu). What an event is and
 * who hears it is shared/live.mjs's; this only holds the sockets.
 */
export function createRealtimeHub() {
  const clients = new Map();

  return {
    connect(socket, role = "guest") {
      clients.set(socket, role);
      socket.send(liveMessage({ type: "connected" }));
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
    },
    /** @param {{ type: string, table?: string }} event */
    publish(event) {
      const message = liveMessage(event);
      for (const [socket, role] of clients) {
        if (reaches(event, role) && socket.readyState === 1) socket.send(message);
      }
    },
    size() {
      return clients.size;
    }
  };
}
