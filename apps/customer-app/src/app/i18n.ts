import { services } from "@zhaoyun/domain";
import type { OrderStatus, Product, ServiceRequest } from "@zhaoyun/domain";
import type { CustomerState } from "./model";

export type Language = CustomerState["language"];

const copy = {
  zh: {
    start: "开始点餐", orders: "订单状态", service: "呼叫服务员", staff: "员工看板",
    menuOffline: "离线菜单，价格以店内为准",
    menu: "菜单", cart: "购物车", search: "搜索菜品", clear: "清除", empty: "没有找到商品", unavailable: "菜单暂时不可用，请呼叫服务员",
    add: "加入购物车", customize: "加入购物车前选择口味与加料", close: "关闭详情", flip: "点击卡片翻转查看详情", back: "返回正面",
    ingredients: "主要食材", allergens: "过敏原", time: "制作时间", portion: "份量 / 难度",
    submit: "确认下单", total: "合计", note: "订单备注", emptyCart: "购物车还是空的",
    backMenu: "返回菜单", noOrders: "还没有已提交订单", order: "订单", serviceSent: "请求已发送",
    table: "桌号", dish: "菜品", category: "分类",
    detailRegion: "菜品详细信息", goBack: "返回",

    statusPendingSync: "等待同步", statusSyncFailed: "同步失败", statusNew: "新订单",
    statusPreparing: "制作中", statusReady: "可上菜", statusCompleted: "已完成", statusCancelled: "已取消",

    orderPlaced: "订单已提交",
    orderQueued: "服务器离线，订单已保存并等待自动重试",
    orderRejected: "订单未被接受，请检查菜品或购物车",
    orderUnconfirmed: "订单尚未被餐厅服务器确认",
    clearCart: "清空购物车",
    notePlaceholder: "例如：少盐、不要香菜",

    servicePrompt: "请选择需要的服务",
    serviceQueued: "服务请求等待同步",
    serviceOnTheWay: "{name}请求已发送，服务员马上过来",

    staffLocalNote: "本机订单与呼叫，离线也可查看；全店订单看板在管理台。",
    staffLocalOrders: "本机订单", staffServiceCalls: "服务呼叫",
    staffNoOrders: "暂无订单", staffNoRequests: "暂无服务请求",
    staffAdvanceTo: "更新为", staffHandled: "已处理", staffPending: "待同步",
    setTable: "设置桌号", tablePrompt: "请输入本设备所在的桌号（1-8 位字母或数字）", tableInvalid: "桌号无效，请使用 1-8 位字母或数字",
    tableUnset: "本设备还没有分配桌号，订单会记到默认桌号"
  },
  de: {
    start: "Bestellen", orders: "Bestellstatus", service: "Service rufen", staff: "Mitarbeiter",
    menuOffline: "Offline-Speisekarte, Preise laut Lokal",
    menu: "Speisekarte", cart: "Warenkorb", search: "Gericht suchen", clear: "Löschen", empty: "Keine Gerichte gefunden", unavailable: "Speisekarte nicht verfügbar, bitte Service rufen",
    add: "In den Warenkorb", customize: "Geschmack und Extras vor dem Hinzufügen wählen", close: "Details schließen", flip: "Karte für Details antippen", back: "Vorderseite",
    ingredients: "Zutaten", allergens: "Allergene", time: "Zubereitungszeit", portion: "Portion / Schärfe",
    submit: "Bestellung bestätigen", total: "Gesamt", note: "Bestellnotiz", emptyCart: "Der Warenkorb ist leer",
    backMenu: "Zur Speisekarte", noOrders: "Noch keine Bestellung", order: "Bestellung", serviceSent: "Anfrage gesendet",
    table: "Tisch", dish: "Gericht", category: "Kategorie",
    detailRegion: "Gerichtdetails", goBack: "Zurück",

    statusPendingSync: "Wird übertragen", statusSyncFailed: "Übertragung fehlgeschlagen", statusNew: "Neu",
    statusPreparing: "In Zubereitung", statusReady: "Fertig zum Servieren", statusCompleted: "Abgeschlossen", statusCancelled: "Storniert",

    orderPlaced: "Bestellung übermittelt",
    orderQueued: "Server offline — die Bestellung ist gespeichert und wird automatisch erneut gesendet",
    orderRejected: "Bestellung nicht angenommen, bitte Gerichte und Warenkorb prüfen",
    orderUnconfirmed: "Vom Restaurant noch nicht bestätigt",
    clearCart: "Warenkorb leeren",
    notePlaceholder: "z. B. wenig Salz, ohne Koriander",

    servicePrompt: "Bitte gewünschten Service wählen",
    serviceQueued: "Service-Anfrage wartet auf Übertragung",
    serviceOnTheWay: "{name}: Anfrage gesendet, der Service kommt gleich",

    staffLocalNote: "Bestellungen und Rufe dieses Geräts, auch offline sichtbar. Die Übersicht für das ganze Lokal liegt in der Verwaltung.",
    staffLocalOrders: "Bestellungen dieses Geräts", staffServiceCalls: "Service-Rufe",
    staffNoOrders: "Keine Bestellungen", staffNoRequests: "Keine Service-Rufe",
    staffAdvanceTo: "Ändern auf", staffHandled: "Erledigt", staffPending: "Wird übertragen",
    setTable: "Tisch einstellen", tablePrompt: "Tischnummer dieses Geräts eingeben (1-8 Zeichen)", tableInvalid: "Ungültige Tischnummer: 1-8 Buchstaben oder Ziffern",
    tableUnset: "Diesem Gerät ist noch kein Tisch zugewiesen"
  },
  en: {
    start: "Start order", orders: "Order status", service: "Call service", staff: "Staff board",
    menuOffline: "Offline menu, prices as shown in the restaurant",
    menu: "Menu", cart: "Cart", search: "Search dishes", clear: "Clear", empty: "No dishes found", unavailable: "Menu unavailable, please call service",
    add: "Add to cart", customize: "Choose taste and extras before adding", close: "Close details", flip: "Tap card to see details", back: "Front side",
    ingredients: "Ingredients", allergens: "Allergens", time: "Preparation time", portion: "Portion / level",
    submit: "Place order", total: "Total", note: "Order note", emptyCart: "Your cart is empty",
    backMenu: "Back to menu", noOrders: "No orders yet", order: "Order", serviceSent: "Request sent",
    table: "Table", dish: "Dish", category: "Category",
    detailRegion: "Dish details", goBack: "Back",

    statusPendingSync: "Sending", statusSyncFailed: "Send failed", statusNew: "New",
    statusPreparing: "Being prepared", statusReady: "Ready to serve", statusCompleted: "Completed", statusCancelled: "Cancelled",

    orderPlaced: "Order submitted",
    orderQueued: "Server offline — your order is saved and will be resent automatically",
    orderRejected: "Order was not accepted, please check the dishes in your cart",
    orderUnconfirmed: "Not yet confirmed by the restaurant",
    clearCart: "Clear cart",
    notePlaceholder: "e.g. less salt, no cilantro",

    servicePrompt: "Choose the service you need",
    serviceQueued: "Service request waiting to send",
    serviceOnTheWay: "{name}: request sent, someone is on the way",

    staffLocalNote: "Orders and calls from this device, visible offline. The board for the whole restaurant is in the admin console.",
    staffLocalOrders: "Orders from this device", staffServiceCalls: "Service calls",
    staffNoOrders: "No orders yet", staffNoRequests: "No service calls",
    staffAdvanceTo: "Change to", staffHandled: "Done", staffPending: "sending",
    setTable: "Set table", tablePrompt: "Enter the table number of this device (1-8 characters)", tableInvalid: "Invalid table number: use 1-8 letters or digits",
    tableUnset: "This device has no table assigned yet"
  }
} as const;

export type CopyKey = keyof typeof copy.zh;

export function t(language: Language, key: CopyKey): string {
  return copy[language][key];
}

const statusKey: Record<OrderStatus, CopyKey> = {
  "pending-sync": "statusPendingSync",
  "sync-failed": "statusSyncFailed",
  new: "statusNew",
  preparing: "statusPreparing",
  ready: "statusReady",
  completed: "statusCompleted",
  cancelled: "statusCancelled"
};

/** Fills `{name}`-style slots so word order and separators stay per-language. */
export function format(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function orderStatusLabel(status: OrderStatus, language: Language): string {
  return t(language, statusKey[status]);
}

const serviceNames: Record<string, Record<Language, string>> =
  Object.fromEntries(services.map((service) => [service.id, service.names]));

/** Falls back across languages so an unnamed service still shows something. */
export function serviceName(serviceType: ServiceRequest["serviceType"], language: Language): string {
  const names = serviceNames[serviceType];
  if (!names) return serviceType;
  return names[language] || names.en || names.de || names.zh;
}

export function productName(product: Product, language: Language): string {
  return product.names[language] || product.names.en || product.names.de || product.names.zh;
}
