import type { CartLine, Product, SelectedModifier } from "@zhaoyun/domain";

/**
 * The guest's cart, priced the way the server will price it (shared/rules.mjs,
 * planOrder): a dish at its price plus its options; a reward — the dish for
 * its points — at its options alone. The server prices the order again and
 * its total is the one that counts; this is what the guest sees before.
 */
export interface CartEntry extends CartLine {
  modifiers: SelectedModifier[];
  /** Bought with points (shared/customer.mjs). */
  reward?: boolean;
}

export type Cart = Record<string, CartEntry>;

/** One line per dish, options and reward-or-not: the same dish with other options is another line. */
export function cartKey(productId: string, modifiers: readonly SelectedModifier[], reward = false): string {
  return `${productId}::${modifiers.map((modifier) => modifier.id).sort().join(",")}${reward ? "::reward" : ""}`;
}

export function unitPriceCents(product: Product, entry: Pick<CartEntry, "modifiers" | "reward">): number {
  const options = entry.modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
  return entry.reward ? options : product.priceCents + options;
}

export interface CartLineView {
  key: string;
  entry: CartEntry;
  product: Product;
  unitCents: number;
}

export interface CartSummary {
  lines: CartLineView[];
  count: number;
  totalCents: number;
  /** What the rewards in it cost, in points. */
  points: number;
  rewards: number;
}

/** The cart against the menu as it is now: a dish taken off since is left out, not charged. */
export function summarize(cart: Cart, products: readonly Product[], rewardPoints: ReadonlyMap<string, number> = new Map()): CartSummary {
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: CartLineView[] = [];
  let count = 0;
  let totalCents = 0;
  let points = 0;
  let rewards = 0;
  for (const [key, entry] of Object.entries(cart)) {
    const product = byId.get(entry.productId);
    if (!product) continue;
    const unitCents = unitPriceCents(product, entry);
    lines.push({ key, entry, product, unitCents });
    count += entry.quantity;
    totalCents += unitCents * entry.quantity;
    if (entry.reward) {
      rewards += entry.quantity;
      points += (rewardPoints.get(entry.productId) ?? 0) * entry.quantity;
    }
  }
  return { lines, count, totalCents, points, rewards };
}

/** The cart as the order command's items. */
export function orderItems(cart: Cart): Array<{ id: string; qty: number; modifiers: Array<{ id: string }>; reward?: boolean }> {
  return Object.values(cart).map((entry) => ({
    id: entry.productId,
    qty: entry.quantity,
    modifiers: entry.modifiers.map((modifier) => ({ id: modifier.id })),
    ...(entry.reward ? { reward: true } : {})
  }));
}
