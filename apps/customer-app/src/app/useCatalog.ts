import { useQuery } from "@tanstack/react-query";
import { seedDishes } from "@zhaoyun/domain";
import type { Product } from "@zhaoyun/domain";
import { mapApiProduct, restaurantApi } from "./api";

const cacheKey = "zy_catalog_cache_v2";

function seedCatalog(): Product[] {
  return seedDishes.map((dish) => ({
    id: String(dish.id),
    sku: `FOOD-${dish.id}`,
    kind: "food",
    category: dish.cat,
    names: { zh: dish.zh, de: dish.de, en: dish.en },
    description: dish.intro,
    priceCents: Math.round(dish.price * 100),
    vatPercent: 10,
    allergens: dish.allergens.split(",").map((value) => value.trim()).filter(Boolean),
    details: { time: dish.time, people: dish.people, level: dish.level, ingredients: dish.ingredients },
    appearance: { art: dish.art, pattern: dish.pattern },
    media: [],
    available: true,
    published: true,
    printStation: "kitchen"
  }));
}

function cachedCatalog(): Product[] {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as Product[] | null;
    return Array.isArray(cached) && cached.length ? cached : seedCatalog();
  } catch {
    return seedCatalog();
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
