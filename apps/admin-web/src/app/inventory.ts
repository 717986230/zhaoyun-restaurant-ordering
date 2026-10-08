/**
 * The restaurant's stock app (门店库存, the restaurant-stock project: its own
 * Worker, its own sign-in). The console links to it, a tab of its own.
 *
 * Both are deployed on one workers.dev subdomain, the ordering Worker as
 * `ck` and the stock Worker as `kc`: the stock app is found beside this
 * console, or beside the API it talks to (a console served from elsewhere).
 */
export const INVENTORY_FALLBACK = "https://github.com/717986230/restaurant-stock";

export function inventoryAddress(...hosts: string[]): string {
  for (const host of hosts) {
    let hostname = "";
    try { hostname = new URL(host).hostname; } catch { continue; }
    const match = /^ck\.([a-z0-9-]+\.workers\.dev)$/i.exec(hostname);
    if (match) return `https://kc.${match[1]}/`;
  }
  // Not deployed beside it (a test server, a shop's own machine): the project, with its setup steps.
  return INVENTORY_FALLBACK;
}
