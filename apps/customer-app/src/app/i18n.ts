import type { Product } from "@zhaoyun/domain";
import type { CustomerState } from "./model";

export type Language = CustomerState["language"];

const copy = {
  zh: {
    start: "开始点餐", orders: "订单状态", service: "呼叫服务员", staff: "员工看板",
    menu: "菜单", cart: "购物车", search: "搜索菜品", clear: "清除", empty: "没有找到商品",
    add: "加入购物车", customize: "加入购物车前选择口味与加料", close: "关闭详情", flip: "点击卡片翻转查看详情", back: "返回正面",
    ingredients: "主要食材", allergens: "过敏原", time: "制作时间", portion: "份量 / 难度",
    submit: "确认下单", total: "合计", note: "订单备注", emptyCart: "购物车还是空的",
    backMenu: "返回菜单", noOrders: "还没有已提交订单", order: "订单", serviceSent: "请求已发送",
    table: "桌号", dish: "菜品", category: "分类"
  },
  de: {
    start: "Bestellen", orders: "Bestellstatus", service: "Service rufen", staff: "Mitarbeiter",
    menu: "Speisekarte", cart: "Warenkorb", search: "Gericht suchen", clear: "Löschen", empty: "Keine Gerichte gefunden",
    add: "In den Warenkorb", customize: "Geschmack und Extras vor dem Hinzufügen wählen", close: "Details schließen", flip: "Karte für Details antippen", back: "Vorderseite",
    ingredients: "Zutaten", allergens: "Allergene", time: "Zubereitungszeit", portion: "Portion / Schärfe",
    submit: "Bestellung bestätigen", total: "Gesamt", note: "Bestellnotiz", emptyCart: "Der Warenkorb ist leer",
    backMenu: "Zur Speisekarte", noOrders: "Noch keine Bestellung", order: "Bestellung", serviceSent: "Anfrage gesendet",
    table: "Tisch", dish: "Gericht", category: "Kategorie"
  },
  en: {
    start: "Start order", orders: "Order status", service: "Call service", staff: "Staff board",
    menu: "Menu", cart: "Cart", search: "Search dishes", clear: "Clear", empty: "No dishes found",
    add: "Add to cart", customize: "Choose taste and extras before adding", close: "Close details", flip: "Tap card to see details", back: "Front side",
    ingredients: "Ingredients", allergens: "Allergens", time: "Preparation time", portion: "Portion / level",
    submit: "Place order", total: "Total", note: "Order note", emptyCart: "Your cart is empty",
    backMenu: "Back to menu", noOrders: "No orders yet", order: "Order", serviceSent: "Request sent",
    table: "Table", dish: "Dish", category: "Category"
  }
} as const;

export type CopyKey = keyof typeof copy.zh;

export function t(language: Language, key: CopyKey): string {
  return copy[language][key];
}

export function productName(product: Product, language: Language): string {
  return product.names[language] || product.names.en || product.names.de || product.names.zh;
}
