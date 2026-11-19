import type { RestaurantTable } from "@zhaoyun/api-client";

/** The guest menu's address: where this console's API lives, else this site. */
export function menuUrl(baseUrl: string): string {
  return `${(baseUrl || window.location.origin).replace(/\/+$/, "")}/`;
}

/** A table's entry link: the menu with its number and code, for its card. */
export function entryUrl(baseUrl: string, table: RestaurantTable): string {
  return `${menuUrl(baseUrl)}?table=${encodeURIComponent(table.table)}&k=${encodeURIComponent(table.token)}`;
}
