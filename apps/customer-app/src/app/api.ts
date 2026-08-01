import { RestaurantApi } from "@zhaoyun/api-client";
import type { ApiCatalogProduct } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";

export function apiBaseUrl(): string {
  const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : location.origin;
  return localStorage.getItem("zy_api_base") || fallback;
}

export const restaurantApi = new RestaurantApi({ baseUrl: apiBaseUrl });

export function mapApiProduct(product: ApiCatalogProduct): Product {
  return {
    id: String(product.id),
    sku: product.sku,
    kind: product.kind,
    category: product.category,
    names: product.names,
    description: product.description,
    priceCents: Math.round(product.price * 100),
    allergens: product.allergens,
    details: product.details,
    appearance: product.appearance,
    modifiers: product.modifiers ?? [],
    media: (product.media ?? []).map((media) => ({ ...media })),
    available: product.available ?? true,
    published: product.published ?? true,
    printStation: product.printStation ?? (product.kind === "drink" ? "bar" : product.kind === "sushi" ? "sushi" : "kitchen")
  };
}
