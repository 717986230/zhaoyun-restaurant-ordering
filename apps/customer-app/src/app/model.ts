import { useEffect, useReducer } from "react";
import type { CreateOrderCommand } from "@zhaoyun/contracts";
import type { CartLine, Order, OrderStatus, SelectedModifier, ServiceRequest } from "@zhaoyun/domain";
import { tableNo } from "./table";

export type Screen = "home" | "menu" | "cart" | "orders" | "service" | "staff";

export interface CustomerState {
  screen: Screen;
  table: string;
  category: string;
  query: string;
  searchOpen: boolean;
  activeProductId: string | null;
  productFlipped: boolean;
  detailQuantity: number;
  detailModifiers: SelectedModifier[];
  cart: Record<string, CartLine>;
  orders: Order[];
  pendingOrders: Record<string, { command: CreateOrderCommand; attempts: number; nextAttemptAt: number }>;
  requests: ServiceRequest[];
  language: "zh" | "de" | "en";
  /** Last service the guest called, resolved to a name at render time. */
  lastServiceType: string | null;
  toast: string;
}

type Action =
  | { type: "navigate"; screen: Screen }
  | { type: "category"; category: string }
  | { type: "query"; query: string }
  | { type: "toggle-search" }
  | { type: "open-product"; productId: string }
  | { type: "close-product" }
  | { type: "toggle-product-flip" }
  | { type: "detail-quantity"; quantity: number }
  | { type: "detail-modifiers"; modifiers: SelectedModifier[] }
  | { type: "add-to-cart"; productId: string; quantity: number; modifiers: SelectedModifier[] }
  | { type: "clear-cart" }
  | { type: "order-created"; order: Order }
  | { type: "order-queued"; order: Order; command: CreateOrderCommand }
  | { type: "order-synced"; clientRequestId: string }
  | { type: "order-retry-scheduled"; clientRequestId: string }
  | { type: "order-status"; orderId: string; clientRequestId?: string; status: OrderStatus; totalCents?: number }
  | { type: "advance-order"; orderId: string; status: OrderStatus }
  | { type: "service-created"; request: ServiceRequest }
  | { type: "service-done"; requestId: string }
  | { type: "language"; language: CustomerState["language"] }
  | { type: "toast"; message: string };

const storageKey = "zy_customer_state_v4";
const maxStoredOrders = 50;
// The menu is the whole guest app now; "home" and the screens it used to lead
// to (cart, orders, service, staff) stay in the Screen union and the reducer
// below so ordering can be switched back on without a reducer rewrite, but
// nothing navigates away from "menu" any more.
const initialState: CustomerState = {
  screen: "menu",
  table: tableNo(),
  category: "ALLE",
  query: "",
  searchOpen: false,
  activeProductId: null,
  productFlipped: false,
  detailQuantity: 1,
  detailModifiers: [],
  cart: {},
  orders: [],
  pendingOrders: {},
  requests: [],
  language: "zh",
  lastServiceType: null,
  toast: ""
};

function hydrate(): CustomerState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<CustomerState> | null;
    if (!stored) return initialState;
    const cart = Object.fromEntries(Object.entries(stored.cart || {}).map(([key, value]) => [key, typeof value === "number" ? { productId: key, quantity: value, modifiers: [] } : value]));
    return {
      ...initialState, ...stored, cart, pendingOrders: stored.pendingOrders || {},
      orders: (stored.orders || []).slice(0, maxStoredOrders),
      table: tableNo(), screen: "menu", activeProductId: null, productFlipped: false, detailModifiers: [], toast: ""
    };
  } catch {
    return initialState;
  }
}

function reducer(state: CustomerState, action: Action): CustomerState {
  switch (action.type) {
    case "navigate": return { ...state, screen: action.screen, activeProductId: null, productFlipped: false, detailModifiers: [] };
    case "category": return { ...state, category: action.category };
    case "query": return { ...state, query: action.query };
    case "toggle-search": return { ...state, searchOpen: !state.searchOpen };
    case "open-product": return { ...state, activeProductId: action.productId, productFlipped: false, detailQuantity: 1, detailModifiers: [] };
    case "close-product": return { ...state, activeProductId: null, productFlipped: false, detailModifiers: [] };
    case "toggle-product-flip": return { ...state, productFlipped: !state.productFlipped };
    case "detail-quantity": return { ...state, detailQuantity: Math.max(1, Math.min(99, action.quantity)) };
    case "detail-modifiers": return { ...state, detailModifiers: action.modifiers };
    case "add-to-cart": {
      const modifierKey = action.modifiers.map((modifier) => modifier.id).sort().join(",");
      const key = `${action.productId}::${modifierKey}`;
      const quantity = Math.min(99, (state.cart[key]?.quantity ?? 0) + action.quantity);
      return { ...state, cart: { ...state.cart, [key]: { productId: action.productId, quantity, modifiers: action.modifiers } } };
    }
    case "clear-cart": return { ...state, cart: {} };
    case "order-created": return { ...state, cart: {}, orders: [action.order, ...state.orders].slice(0, maxStoredOrders) };
    case "order-queued": return {
      ...state,
      cart: {},
      orders: [action.order, ...state.orders].slice(0, maxStoredOrders),
      pendingOrders: { ...state.pendingOrders, [action.command.clientRequestId]: { command: action.command, attempts: 0, nextAttemptAt: 0 } }
    };
    case "order-synced": {
      const pendingOrders = { ...state.pendingOrders };
      delete pendingOrders[action.clientRequestId];
      return { ...state, pendingOrders };
    }
    case "order-retry-scheduled": {
      const pending = state.pendingOrders[action.clientRequestId];
      if (!pending) return state;
      const attempts = pending.attempts + 1;
      return { ...state, pendingOrders: { ...state.pendingOrders, [action.clientRequestId]: { ...pending, attempts, nextAttemptAt: Date.now() + Math.min(60_000, 2_000 * 2 ** Math.min(attempts, 5)) } } };
    }
    case "order-status": return {
      ...state,
      orders: state.orders.map((order) => order.id === action.orderId || (action.clientRequestId && order.clientRequestId === action.clientRequestId)
        ? { ...order, status: action.status, totalCents: action.totalCents ?? order.totalCents }
        : order)
    };
    case "advance-order": return { ...state, orders: state.orders.map((order) => order.id === action.orderId ? { ...order, status: action.status } : order) };
    case "service-created": return { ...state, requests: [action.request, ...state.requests], lastServiceType: action.request.serviceType };
    case "service-done": return { ...state, requests: state.requests.map((request) => request.id === action.requestId ? { ...request, status: "completed" } : request) };
    case "language": return { ...state, language: action.language };
    case "toast": return { ...state, toast: action.message };
  }
}

export function useCustomerState() {
  const [state, dispatch] = useReducer(reducer, undefined, hydrate);
  useEffect(() => {
    const { toast: _toast, activeProductId: _active, productFlipped: _flipped, searchOpen: _search, ...persistent } = state;
    localStorage.setItem(storageKey, JSON.stringify(persistent));
  }, [state]);
  useEffect(() => {
    if (!state.toast) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "toast", message: "" }), 1600);
    return () => window.clearTimeout(timer);
  }, [state.toast]);
  return { state, dispatch };
}

export type CustomerDispatch = React.Dispatch<Action>;
