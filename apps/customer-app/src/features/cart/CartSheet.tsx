import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiMenuSettings, GuestChannel, GuestOrderCommand } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import { orderItems, summarize } from "../../app/cart";
import { g, refusal } from "../../app/guest-i18n";
import { formatPrice, productName, t } from "../../app/i18n";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { newRequestId } from "../../app/ordering";
import type { OrderingState } from "../../app/ordering";
import { Sheet } from "../../components/Sheet";
import type { CustomerAccount } from "../account/useCustomer";

interface Props {
  state: CustomerState;
  dispatch: CustomerDispatch;
  products: Product[];
  ordering: OrderingState;
  loyalty: ApiMenuSettings["loyalty"];
  account: CustomerAccount;
  /** Drinks to offer while the cart has none (the owner's picks or the best sellers). */
  suggestions: string[];
}

/**
 * The cart, and the order it becomes: at the table this phone scanned, or
 * for pickup (signed in). Straight to the kitchen when the server takes it;
 * when it does not, the guest is told why and what to do, and the cart stays.
 */
export function CartSheet({ state, dispatch, products, ordering, loyalty, account, suggestions }: Props) {
  const language = state.language;
  const rewardPoints = new Map((loyalty?.rewards ?? []).map((reward) => [reward.productId, reward.points]));
  const summary = summarize(state.cart, products, rewardPoints);
  const channels: GuestChannel[] = [...(ordering.table ? ["dine-in" as const] : []), ...(ordering.pickup ? ["pickup" as const] : [])];
  const [chosen, setChosen] = useState<GuestChannel | null>(null);
  const channel = chosen && channels.includes(chosen) ? chosen : channels[0] ?? null;
  // At the table: whether a waiter has opened it yet (开台), said before the cart is sent, not after.
  const tableOrdering = useQuery({
    queryKey: ["table-ordering", ordering.table],
    enabled: channel === "dine-in" && ordering.open && Boolean(ordering.table),
    queryFn: () => restaurantApi.tableOrdering(ordering.table!),
    refetchInterval: 15_000,
    retry: false
  });
  // A drink offered only while there is none in the cart, and only what can be ordered now.
  const hasDrink = summary.lines.some(({ product }) => product.kind === "drink");
  const productById = new Map(products.map((product) => [product.id, product]));
  const offered = ordering.open && !hasDrink ? suggestions.flatMap((id) => productById.get(id) ?? []).slice(0, 3) : [];
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One id per cart as sent: a retry after a lost answer is the same order, never a second one.
  const attempt = useRef<{ key: string; id: string } | null>(null);

  const tooMany = summary.count > ordering.maxItems;
  const tooDear = summary.totalCents > ordering.maxOrderCents;
  const shortOfPoints = summary.points > (account.customer?.points ?? 0);
  const needsAccount = (channel === "pickup" || summary.rewards > 0) && !account.signedIn;
  const blocked = !ordering.open || !channel || !summary.lines.length || tooMany || tooDear || shortOfPoints;

  async function submit() {
    if (blocked || busy || !channel) return;
    if (needsAccount) {
      dispatch({ type: "sheet", sheet: "account" });
      return;
    }
    const items = orderItems(state.cart);
    const key = JSON.stringify({ channel, table: ordering.table, note, items });
    if (attempt.current?.key !== key) attempt.current = { key, id: newRequestId() };
    const command: GuestOrderCommand = {
      clientRequestId: attempt.current.id,
      channel,
      ...(channel === "dine-in" && ordering.table ? { table: ordering.table } : {}),
      note: note.trim(),
      payment: "in-store",
      items
    };
    setBusy(true);
    setError("");
    try {
      const { order } = await restaurantApi.placeOrder(command);
      attempt.current = null;
      setNote("");
      dispatch({ type: "order-placed", order, channel });
      dispatch({ type: "toast", message: g(language, "orderPlaced") });
      account.refresh();
    } catch (failure) {
      if (!(failure instanceof ApiError)) {
        setError(g(language, "offline"));
      } else {
        if (failure.code === "SIGN_IN_REQUIRED") dispatch({ type: "sheet", sheet: "account" });
        if (failure.code === "TABLE_NOT_OPEN") void tableOrdering.refetch();
        // A dish counted out for today (每日限量) is named, with how many there still are.
        const soldOut = failure.code === "SOLD_OUT" ? products.find((product) => product.sku === failure.details.sku) : undefined;
        const dish = soldOut ? productName(soldOut, language) : String(failure.details.sku ?? "");
        setError(refusal(language, failure.code, { seconds: failure.retryAfter ?? 60, dish, left: Number(failure.details.left ?? 0) }) ?? g(language, "failed", { message: failure.message }));
        // A refusal is final for this cart as sent: a changed one is a new order.
        attempt.current = null;
      }
    } finally {
      setBusy(false);
    }
  }

  return <Sheet id="cartSheet" title={g(language, "cart")} closeLabel={t(language, "close")} onClose={() => dispatch({ type: "sheet", sheet: null })}>
    {tableOrdering.data?.open === false && <p className="cart-hint table-not-open" id="tableNotOpen" role="status">{g(language, "tableNotOpenYet")}</p>}
    {!summary.lines.length ? <p className="sheet-empty">{g(language, "cartEmpty")}</p> : <>
      <ul className="cart-lines">{summary.lines.map(({ key, entry, product, unitCents }) => <li key={key} className={`cart-line ${entry.reward ? "reward" : ""}`} data-key={key}>
        <div className="cart-line-text">
          <b>{productName(product, language)}</b>
          {entry.modifiers.length > 0 && <small>{entry.modifiers.map((modifier) => modifier.name).join(" · ")}</small>}
          {/* Two or more: what one costs, so the line's total explains itself. */}
          {entry.quantity > 1 && !entry.reward && <small className="cart-unit">{entry.quantity} × {formatPrice(unitCents, language)}</small>}
          {entry.reward && <small className="cart-reward">★ {g(language, "reward")} · {g(language, "rewardCost", { points: (rewardPoints.get(product.id) ?? 0) * entry.quantity })}</small>}
        </div>
        <div className="qty" role="group">
          <button type="button" aria-label="−" onClick={() => dispatch({ type: "cart-quantity", key, quantity: entry.quantity - 1 })}>−</button>
          <span>{entry.quantity}</span>
          <button type="button" aria-label="+" disabled={entry.reward && summary.rewards >= (loyalty?.maxRewardsPerOrder ?? 1)} onClick={() => dispatch({ type: "cart-quantity", key, quantity: entry.quantity + 1 })}>+</button>
        </div>
        <strong className="cart-line-price">{formatPrice(unitCents * entry.quantity, language)}</strong>
      </li>)}</ul>

      {/* Nothing to drink yet: two or three, one tap each. */}
      {offered.length > 0 && <section className="cart-suggest" id="cartSuggest" aria-labelledby="cartSuggestTitle">
        <h3 id="cartSuggestTitle">{g(language, "suggestDrinks")}</h3>
        <ul>{offered.map((product) => <li key={product.id}>
          <span><b>{productName(product, language)}</b><small>{formatPrice(product.priceCents, language)}</small></span>
          <button type="button" className="secondary" aria-label={`${g(language, "addToCart")}: ${productName(product, language)}`}
            onClick={() => dispatch({ type: "add-to-cart", productId: product.id, quantity: 1, modifiers: [] })}>＋</button>
        </li>)}</ul>
      </section>}

      {channels.length > 0 && <fieldset className={`cart-channel ${channels.length === 1 ? "single" : ""}`}>
        <legend>{g(language, "channel")}</legend>
        {channels.map((option) => <label key={option} className={channel === option ? "on" : ""}>
          <input type="radio" name="channel" value={option} checked={channel === option} onChange={() => setChosen(option)} />
          <span>{option === "dine-in" ? g(language, "dineIn", { table: ordering.table ?? "" }) : g(language, "pickup")}</span>
        </label>)}
      </fieldset>}
      {!channels.length && <p className="cart-hint">{g(language, "noTable")}</p>}

      <label className="note-label">{g(language, "note")}
        <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder={g(language, "notePlaceholder")} />
      </label>

      <div className="total"><span>{g(language, "total")}</span><b>{formatPrice(summary.totalCents, language)}</b></div>
      <p className="cart-hint">{g(language, "payInStore")} · {g(language, "limits", { items: ordering.maxItems, amount: formatPrice(ordering.maxOrderCents, language) })}</p>
      {summary.points > 0 && <p className={`cart-hint ${shortOfPoints ? "warn" : ""}`}>{g(language, "pointsNeeded", { points: summary.points })}{account.customer ? ` · ${g(language, "points")}: ${account.customer.points}` : ""}</p>}
      {(tooMany || tooDear) && <p className="cart-error" role="alert">{refusal(language, "ORDER_TOO_LARGE")}</p>}
      {!ordering.open && ordering.closed && <p className="cart-error" role="alert">{g(language, "closedNow")}</p>}
      {error && <p className="cart-error" role="alert">{error}</p>}
      {needsAccount && <p className="cart-hint">{g(language, "pickupNeedsAccount")}</p>}
      <button id="placeOrder" type="button" className="primary" disabled={blocked || busy} onClick={() => void submit()}>
        {busy ? g(language, "placing") : needsAccount ? g(language, "signIn") : `${g(language, "placeOrder")} · ${formatPrice(summary.totalCents, language)}`}
      </button>
    </>}
  </Sheet>;
}
