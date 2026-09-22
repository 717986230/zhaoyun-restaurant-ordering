export function createRealtimeHub() {
  // Guest tablets share one socket endpoint, so every socket carries the table
  // it belongs to. Order, service and bill events only reach that table;
  // catalog events reach everyone.
  const clients = new Map();

  return {
    connect(socket, table = null) {
      clients.set(socket, table);
      socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
    },
    broadcast(type, payload, table = null) {
      const message = JSON.stringify({ type, payload, at: new Date().toISOString() });
      for (const [socket, scope] of clients) {
        if (table && scope !== table) continue;
        if (socket.readyState === 1) socket.send(message);
      }
    },
    size() {
      return clients.size;
    }
  };
}
