/**
 * The stubbed specs talk to no backend, and that includes the live channel.
 * The one server there can be on the API port is pos.spec's, and its events
 * (a dish sold out, a setting saved) would otherwise reach these pages in the
 * middle of an assertion: a menu refetching while a card is being measured.
 * Here /ws opens and closes at once, as it would with no server, so each page
 * keeps its polling and hears nothing from anyone else's test.
 */
export function isolateLive(page) {
  return page.routeWebSocket(/\/ws(\?|$)/, (socket) => socket.close());
}
