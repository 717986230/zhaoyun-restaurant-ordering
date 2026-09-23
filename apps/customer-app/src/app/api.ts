import { RestaurantApi, toProduct } from "@zhaoyun/api-client";
import { tableNo, tableToken } from "./table";

export function apiBaseUrl(): string {
  // A device configured by hand wins; then the address baked in at build time;
  // then the origin, which inside the Capacitor shell is localhost and has
  // nothing listening on it.
  const built = import.meta.env.VITE_API_BASE?.replace(/\/+$/, "");
  const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : built || location.origin;
  return localStorage.getItem("zy_api_base") || fallback;
}

export const restaurantApi = new RestaurantApi({ baseUrl: apiBaseUrl, headers: () => ({ "x-table-token": tableToken() }), socketParams: () => ({ table: tableNo() }) });

/** Kept as a name for the callers here; the mapping itself is shared with the admin console. */
export const mapApiProduct = toProduct;
