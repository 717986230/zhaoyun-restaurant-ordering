import { useQuery } from "@tanstack/react-query";
import type { ApiOrder } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import { g, statusLabel } from "../../app/guest-i18n";
import { formatPrice, productName, t } from "../../app/i18n";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { Sheet } from "../../components/Sheet";

/**
 * The guest's orders and where they are: sent to the kitchen, being made,
 * ready — the pickup number large, for the counter. The orders this phone
 * placed are followed without an account (by the ids it made up for them);
 * a signed-in guest sees their account's too. Refreshed while it is open.
 */
export function OrdersSheet({ state, dispatch, products, signedIn }: { state: CustomerState; dispatch: CustomerDispatch; products: Product[]; signedIn: boolean }) {
  const language = state.language;
  const ids = state.placed.map((order) => order.clientRequestId);
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["my-orders", signedIn, ids.join(",")],
    refetchInterval: 15_000,
    queryFn: async () => {
      const [tracked, mine] = await Promise.all([
        ids.length ? restaurantApi.trackOrders(ids).then((result) => result.orders) : Promise.resolve([] as ApiOrder[]),
        signedIn ? restaurantApi.customerOrders().then((result) => result.orders).catch(() => [] as ApiOrder[]) : Promise.resolve([] as ApiOrder[])
      ]);
      const byId = new Map([...tracked, ...mine].map((order) => [order.id, order]));
      return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  return <Sheet id="ordersSheet" title={g(language, "myOrders")} closeLabel={t(language, "close")} onClose={() => dispatch({ type: "sheet", sheet: null })}>
    {!orders.length ? <p className="sheet-empty">{isLoading ? "…" : g(language, "noOrders")}</p>
      : <ul className="my-orders">{orders.map((order) => <li key={order.id} className={`my-order status-${order.status}`} data-order={order.id}>
        <div className="my-order-head">
          {order.pickupNo ? <span className="pickup-no"><small>{g(language, "pickupNo")}</small><b>{order.pickupNo}</b></span>
            : <span className="pickup-no table"><small>{g(language, "table")}</small><b>{order.table}</b></span>}
          <div>
            <strong>{g(language, "orderNo", { no: order.no })}</strong>
            <small>{new Date(order.createdAt).toLocaleString(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</small>
          </div>
          <span className="my-order-status">{statusLabel(language, order)}</span>
        </div>
        <ul className="my-order-items">{order.items.map((item, index) => {
          const product = byId.get(item.id);
          return <li key={`${item.id}-${index}`}>{item.qty}× {product ? productName(product, language) : item.name}
            {item.modifiers?.length ? <small> · {item.modifiers.map((modifier) => modifier.names?.[language] || modifier.name).join(" · ")}</small> : null}</li>;
        })}</ul>
        <div className="total"><span>{g(language, "total")}</span><b>{formatPrice(Math.round(order.total * 100), language)}</b></div>
      </li>)}</ul>}
  </Sheet>;
}
