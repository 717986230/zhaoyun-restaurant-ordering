export function createRealtimeHub() {
  const clients = new Set();

  return {
    connect(socket) {
      clients.add(socket);
      socket.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
      socket.on("close", () => clients.delete(socket));
      socket.on("error", () => clients.delete(socket));
    },
    broadcast(type, payload) {
      const message = JSON.stringify({ type, payload, at: new Date().toISOString() });
      for (const socket of clients) {
        if (socket.readyState === 1) socket.send(message);
      }
    },
    size() {
      return clients.size;
    }
  };
}

