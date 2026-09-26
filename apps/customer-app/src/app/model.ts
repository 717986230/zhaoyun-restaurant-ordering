import { useEffect, useReducer } from "react";
import type { ApiOrder, GuestChannel } from "@zhaoyun/contracts";
import type { SelectedModifier } from "@zhaoyun/domain";
import { cartKey } from "./cart";
import type { Cart } from "./cart";
import { tableNo } from "./table";

/** The sheets that open over the menu: the cart, the guest's account, their orders. */
export type Sheet = "cart" | "account" | "orders" | null;

/** An order this phone placed: enough to follow it, with or without an account. */
export interface PlacedOrder {
  clientRequestId: string;
  id: string;
  no: string;
  channel: GuestChannel;
  table: string;
  pickupNo?: number;
  createdAt: string;
}

export interface CustomerState {
  table: string;
  category: string;
  query: string;
  searchOpen: boolean;
  activeProductId: string | null;
  productFlipped: boolean;
  detailQuantity: number;
  detailModifiers: SelectedModifier[];
  cart: Cart;
  placed: PlacedOrder[];
  sheet: Sheet;
  language: "zh" | "de" | "en";
  /** Whether `language` is the guest's own pick. Until it is, the menu follows
   *  the phone's language among the ones the restaurant offers. */
  languageChosen: boolean;
  toast: string;
}

type Action =
  | { type: "category"; category: string }
  | { type: "query"; query: string }
  | { type: "toggle-search" }
  | { type: "open-product"; productId: string }
  | { type: "close-product" }
  | { type: "toggle-product-flip" }
  | { type: "detail-quantity"; quantity: number }
  | { type: "detail-modifiers"; modifiers: SelectedModifier[] }
  | { type: "add-to-cart"; productId: string; quantity: number; modifiers: SelectedModifier[]; reward?: boolean }
  | { type: "cart-quantity"; key: string; quantity: number }
  | { type: "clear-cart" }
  | { type: "order-placed"; order: ApiOrder; channel: GuestChannel }
  | { type: "sheet"; sheet: Sheet }
  | { type: "language"; language: CustomerState["language"] }
  | { type: "toast"; message: string };

const storageKey = "zy_customer_state_v5";
const MAX_PLACED = 20;
const MAX_LINE_QUANTITY = 99;

const initialState: CustomerState = {
  table: tableNo(),
  category: "ALLE",
  query: "",
  searchOpen: false,
  activeProductId: null,
  productFlipped: false,
  detailQuantity: 1,
  detailModifiers: [],
  cart: {},
  placed: [],
  sheet: null,
  language: "de",
  languageChosen: false,
  toast: ""
};

function hydrate(): CustomerState {
  try {
    // The version before kept the guest's language too; it comes along once.
    const stored = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem("zy_customer_state_v4") || "null") as Partial<CustomerState> | null;
    if (!stored) return initialState;
    return {
      ...initialState,
      category: stored.category ?? initialState.category,
      language: stored.language ?? initialState.language,
      languageChosen: stored.languageChosen ?? false,
      cart: stored.cart && typeof stored.cart === "object" ? Object.fromEntries(Object.entries(stored.cart).filter(([, entry]) => entry && typeof entry === "object" && Array.isArray(entry.modifiers))) : {},
      placed: Array.isArray(stored.placed) ? stored.placed.slice(0, MAX_PLACED) : [],
      table: tableNo()
    };
  } catch {
    return initialState;
  }
}

function reducer(state: CustomerState, action: Action): CustomerState {
  switch (action.type) {
    case "category": return { ...state, category: action.category };
    case "query": return { ...state, query: action.query };
    // Closing the search ends it: a query left behind would go on filtering
    // every page, invisibly, under a category tab that says otherwise.
    case "toggle-search": return { ...state, searchOpen: !state.searchOpen, query: state.searchOpen ? "" : state.query };
    case "open-product": return { ...state, activeProductId: action.productId, productFlipped: false, detailQuantity: 1, detailModifiers: [] };
    case "close-product": return { ...state, activeProductId: null, productFlipped: false, detailModifiers: [] };
    case "toggle-product-flip": return { ...state, productFlipped: !state.productFlipped };
    case "detail-quantity": return { ...state, detailQuantity: Math.max(1, Math.min(MAX_LINE_QUANTITY, action.quantity)) };
    case "detail-modifiers": return { ...state, detailModifiers: action.modifiers };
    case "add-to-cart": {
      const key = cartKey(action.productId, action.modifiers, action.reward);
      const quantity = Math.min(MAX_LINE_QUANTITY, (state.cart[key]?.quantity ?? 0) + action.quantity);
      return { ...state, cart: { ...state.cart, [key]: { productId: action.productId, quantity, modifiers: action.modifiers, ...(action.reward ? { reward: true } : {}) } } };
    }
    case "cart-quantity": {
      const entry = state.cart[action.key];
      if (!entry) return state;
      const cart = { ...state.cart };
      if (action.quantity <= 0) delete cart[action.key];
      else cart[action.key] = { ...entry, quantity: Math.min(MAX_LINE_QUANTITY, action.quantity) };
      return { ...state, cart };
    }
    case "clear-cart": return { ...state, cart: {} };
    case "order-placed": {
      const { order } = action;
      const placed: PlacedOrder = {
        clientRequestId: order.clientRequestId, id: order.id, no: order.no, channel: action.channel, table: order.table, createdAt: order.createdAt,
        ...(order.pickupNo ? { pickupNo: order.pickupNo } : {})
      };
      return { ...state, cart: {}, sheet: "orders", placed: [placed, ...state.placed.filter((entry) => entry.id !== order.id)].slice(0, MAX_PLACED) };
    }
    case "sheet": return { ...state, sheet: action.sheet };
    case "language": return { ...state, language: action.language, languageChosen: true };
    case "toast": return { ...state, toast: action.message };
  }
}

export function useCustomerState() {
  const [state, dispatch] = useReducer(reducer, undefined, hydrate);
  useEffect(() => {
    const { category, language, languageChosen, cart, placed } = state;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ category, language, languageChosen, cart, placed }));
    } catch { /* Private browsing keeps it for this visit only. */ }
  }, [state]);
  useEffect(() => {
    if (!state.toast) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: "toast", message: "" }), 2200);
    return () => window.clearTimeout(timer);
  }, [state.toast]);
  return { state, dispatch };
}

export type CustomerDispatch = React.Dispatch<Action>;
