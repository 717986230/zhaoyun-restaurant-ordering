import { useEffect, useReducer } from "react";
import type { Order, OrderStatus, ServiceRequest } from "@zhaoyun/domain";

export type Screen = "home" | "menu" | "cart" | "orders" | "service" | "staff";

export interface CustomerState {
  screen: Screen;
  category: string;
  query: string;
  searchOpen: boolean;
  activeProductId: string | null;
  productFlipped: boolean;
  detailQuantity: number;
  cart: Record<string, number>;
  orders: Order[];
  requests: ServiceRequest[];
  language: "zh" | "de" | "en";
  serviceMessage: string;
  toast: string;
}

type Action =
  | { type: "navigate"; screen: Screen }
  | { type: "category"; category: string }
  | { type: "query"; query: string }
  | { type: "toggle-search" }
  | { type: "open-product"; productId: string; quantity: number }
  | { type: "close-product" }
  | { type: "toggle-product-flip" }
  | { type: "detail-quantity"; quantity: number }
  | { type: "add-to-cart"; productId: string; quantity: number }
  | { type: "clear-cart" }
  | { type: "order-created"; order: Order }
  | { type: "order-status"; orderId: string; clientRequestId?: string; status: OrderStatus; totalCents?: number }
  | { type: "advance-order"; orderId: string; status: OrderStatus }
  | { type: "service-created"; request: ServiceRequest; message: string }
  | { type: "service-done"; requestId: string }
  | { type: "language"; language: CustomerState["language"] }
  | { type: "toast"; message: string };

const storageKey = "zy_customer_state_v4";
const initialState: CustomerState = {
  screen: "home",
  category: "ALLE",
  query: "",
  searchOpen: false,
  activeProductId: null,
  productFlipped: false,
  detailQuantity: 1,
  cart: {},
  orders: [],
  requests: [],
  language: "zh",
  serviceMessage: "请选择需要的服务",
  toast: ""
};

function hydrate(): CustomerState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as Partial<CustomerState> | null;
    return stored ? { ...initialState, ...stored, screen: "home", activeProductId: null, productFlipped: false, toast: "" } : initialState;
  } catch {
    return initialState;
  }
}

function reducer(state: CustomerState, action: Action): CustomerState {
  switch (action.type) {
    case "navigate": return { ...state, screen: action.screen, activeProductId: null, productFlipped: false };
    case "category": return { ...state, category: action.category };
    case "query": return { ...state, query: action.query };
    case "toggle-search": return { ...state, searchOpen: !state.searchOpen };
    case "open-product": return { ...state, activeProductId: action.productId, productFlipped: false, detailQuantity: action.quantity };
    case "close-product": return { ...state, activeProductId: null, productFlipped: false };
    case "toggle-product-flip": return { ...state, productFlipped: !state.productFlipped };
    case "detail-quantity": return { ...state, detailQuantity: Math.max(1, Math.min(99, action.quantity)) };
    case "add-to-cart": return { ...state, cart: { ...state.cart, [action.productId]: action.quantity } };
    case "clear-cart": return { ...state, cart: {} };
    case "order-created": return { ...state, cart: {}, orders: [action.order, ...state.orders] };
    case "order-status": return {
      ...state,
      orders: state.orders.map((order) => order.id === action.orderId || (action.clientRequestId && order.clientRequestId === action.clientRequestId)
        ? { ...order, status: action.status, totalCents: action.totalCents ?? order.totalCents }
        : order)
    };
    case "advance-order": return { ...state, orders: state.orders.map((order) => order.id === action.orderId ? { ...order, status: action.status } : order) };
    case "service-created": return { ...state, requests: [action.request, ...state.requests], serviceMessage: action.message };
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
