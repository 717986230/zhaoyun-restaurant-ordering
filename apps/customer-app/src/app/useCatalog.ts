import { useQuery } from "@tanstack/react-query";
import type { Product } from "@zhaoyun/domain";
import { mapApiProduct, restaurantApi } from "./api";

const cacheKey = "zy_catalog_cache_v2";

/**
 * Offline devices fall back to the last catalog the server actually served. There is deliberately
 * no built-in demo menu: showing dishes the kitchen does not have produces orders the server
 * rejects on reconnect.
 */
function cachedCatalog(): Product[] {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as Product[] | null;
    return Array.isArray(cached) ? cached : [];
  } catch {
    return [];
  }
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: async () => {
      const { products } = await restaurantApi.catalog();
      const catalog = products.map(mapApiProduct);
      localStorage.setItem(cacheKey, JSON.stringify(catalog));
      return catalog;
    },
    initialData: cachedCatalog,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
    retry: 1,
    networkMode: "offlineFirst"
  });
}
