import type { ApiOrder, GuestOrderRefusal, PointsReason } from "@zhaoyun/contracts";
import type { Language } from "./i18n";

/**
 * The words of the guest's own side of the menu: their account, favourites,
 * cart, orders and points. Kept apart from the menu's own copy (i18n.ts) so
 * each file stays about one thing; `{name}` slots are filled by `g`.
 */
const copy = {
  zh: {
    account: "我的账户", signIn: "登录", register: "注册", signOut: "退出登录", email: "邮箱", password: "密码", passwordRepeat: "再输一次密码",
    name: "称呼（可不填）", passwordHint: "至少 6 位", passwordMismatch: "两次输入的密码不一样", wrongLogin: "邮箱或密码不对", emailTaken: "这个邮箱已经注册过，请直接登录",
    accountsOff: "餐厅暂未开放顾客注册", signInLead: "登录后可以收藏菜品、外带自取、积攒积分兑换菜品。", welcome: "你好，{name}",
    points: "积分", pointsLead: "每消费 €1 得 {n} 积分，结账后到账", rewards: "积分兑换", redeem: "兑换", notEnoughPoints: "积分不够", rewardAdded: "已加入购物车：{name}（{points} 积分）",
    pointsHistory: "积分记录", reasonEarn: "消费获得", reasonReverse: "退款扣回", reasonRedeem: "兑换", reasonRefund: "取消退回", reasonAdjust: "餐厅调整",
    myOrders: "我的订单", noOrders: "还没有订单", favorites: "我的收藏", favorite: "收藏", unfavorite: "取消收藏", favoritesPage: "♥ 收藏", signInToFavorite: "登录后可以收藏菜品",
    profile: "账户设置", currentPassword: "当前密码", newPassword: "新密码（不改就留空）", save: "保存", saved: "已保存", deleteAccount: "删除账户", deleteConfirm: "删除后积分和收藏都会清除，不能恢复。请输入密码确认。", deleted: "账户已删除",
    forgot: "忘记密码？请到前台，工作人员可以帮你重设。",
    cart: "购物车", addToCart: "加入购物车", added: "已加入：{name}", cartEmpty: "购物车是空的", total: "合计", note: "备注", notePlaceholder: "例如：少辣、不要香菜", placeOrder: "下单", placing: "正在下单…",
    dineIn: "堂食 · {table} 桌", pickup: "外带自取", channel: "用餐方式", noTable: "请扫描桌上的二维码再下单", pickupNeedsAccount: "外带自取需要先登录", payInStore: "到店 / 餐后付款",
    limits: "每单最多 {items} 份、{amount}", reward: "积分兑换", rewardCost: "{points} 积分", pointsNeeded: "需要 {points} 积分",
    orderPlaced: "下单成功，已送到后厨", orderNo: "订单 {no}", pickupNo: "取餐号", table: "桌号", closedNow: "现在不接受线上点餐",
    statusNew: "已送厨", statusPreparing: "制作中", statusReady: "可取餐 / 上菜", statusCompleted: "已完成", statusCancelled: "已取消", paid: "已结账",
    refused: {
      ORDERING_OFF: "餐厅暂未开放线上点餐，请呼叫服务员", ORDERING_CLOSED: "现在不接受线上点餐", TABLE_NOT_OPEN: "这桌还没开台，请先请服务员开台",
      TABLE_LOCKED: "这桌正在结账，暂时不能下单", TOO_SOON: "刚刚下过单，请 {seconds} 秒后再试", ORDER_TOO_LARGE: "这单超过了线上点餐的上限，请分开下单或请服务员帮忙",
      SIGN_IN_REQUIRED: "请先登录", TOO_MANY_PICKUPS: "你还有没取的外带订单，请先取餐", NOT_ENOUGH_POINTS: "积分不够兑换这道菜", PAYMENT_UNAVAILABLE: "暂不支持线上付款，请到店付款", BAD_CHANNEL: "请选择堂食或外带"
    } as Record<GuestOrderRefusal, string>,
    failed: "没能下单：{message}", offline: "网络连不上，订单没有发出去，请稍后再试"
  },
  de: {
    account: "Mein Konto", signIn: "Anmelden", register: "Registrieren", signOut: "Abmelden", email: "E-Mail", password: "Passwort", passwordRepeat: "Passwort wiederholen",
    name: "Name (optional)", passwordHint: "Mindestens 6 Zeichen", passwordMismatch: "Die Passwörter stimmen nicht überein", wrongLogin: "E-Mail oder Passwort falsch", emailTaken: "Diese E-Mail ist schon registriert – bitte anmelden",
    accountsOff: "Kundenkonten sind derzeit nicht verfügbar", signInLead: "Mit Konto: Lieblingsgerichte merken, zum Abholen bestellen, Punkte sammeln und einlösen.", welcome: "Hallo, {name}",
    points: "Punkte", pointsLead: "{n} Punkte pro € 1, gutgeschrieben nach dem Bezahlen", rewards: "Prämien", redeem: "Einlösen", notEnoughPoints: "Zu wenig Punkte", rewardAdded: "Im Warenkorb: {name} ({points} Punkte)",
    pointsHistory: "Punkteverlauf", reasonEarn: "Gesammelt", reasonReverse: "Storniert", reasonRedeem: "Eingelöst", reasonRefund: "Zurückgebucht", reasonAdjust: "Vom Restaurant",
    myOrders: "Meine Bestellungen", noOrders: "Noch keine Bestellungen", favorites: "Favoriten", favorite: "Merken", unfavorite: "Nicht mehr merken", favoritesPage: "♥ Favoriten", signInToFavorite: "Zum Merken bitte anmelden",
    profile: "Konto-Einstellungen", currentPassword: "Aktuelles Passwort", newPassword: "Neues Passwort (leer lassen = unverändert)", save: "Speichern", saved: "Gespeichert", deleteAccount: "Konto löschen", deleteConfirm: "Punkte und Favoriten werden endgültig gelöscht. Zum Bestätigen Passwort eingeben.", deleted: "Konto gelöscht",
    forgot: "Passwort vergessen? Das Personal kann es an der Kasse neu setzen.",
    cart: "Warenkorb", addToCart: "In den Warenkorb", added: "Hinzugefügt: {name}", cartEmpty: "Der Warenkorb ist leer", total: "Gesamt", note: "Notiz", notePlaceholder: "z. B. weniger scharf, ohne Koriander", placeOrder: "Bestellen", placing: "Wird bestellt …",
    dineIn: "Hier essen · Tisch {table}", pickup: "Zum Abholen", channel: "Wie?", noTable: "Bitte den QR-Code am Tisch scannen", pickupNeedsAccount: "Zum Abholen bitte anmelden", payInStore: "Bezahlung im Restaurant",
    limits: "Pro Bestellung höchstens {items} Stück, {amount}", reward: "Prämie", rewardCost: "{points} Punkte", pointsNeeded: "{points} Punkte nötig",
    orderPlaced: "Bestellt – die Küche hat es", orderNo: "Bestellung {no}", pickupNo: "Abholnummer", table: "Tisch", closedNow: "Derzeit keine Online-Bestellungen",
    statusNew: "In der Küche", statusPreparing: "In Zubereitung", statusReady: "Fertig", statusCompleted: "Erledigt", statusCancelled: "Storniert", paid: "Bezahlt",
    refused: {
      ORDERING_OFF: "Online-Bestellung ist nicht verfügbar – bitte Service rufen", ORDERING_CLOSED: "Derzeit keine Online-Bestellungen", TABLE_NOT_OPEN: "Der Tisch ist noch nicht freigegeben – bitte den Service fragen",
      TABLE_LOCKED: "Der Tisch wird gerade abgerechnet", TOO_SOON: "Gerade bestellt – bitte in {seconds} Sekunden noch einmal", ORDER_TOO_LARGE: "Zu groß für eine Online-Bestellung – bitte aufteilen oder den Service fragen",
      SIGN_IN_REQUIRED: "Bitte zuerst anmelden", TOO_MANY_PICKUPS: "Es warten noch Bestellungen auf Abholung", NOT_ENOUGH_POINTS: "Zu wenig Punkte für diese Prämie", PAYMENT_UNAVAILABLE: "Online-Zahlung noch nicht möglich – bitte im Restaurant bezahlen", BAD_CHANNEL: "Bitte hier essen oder abholen wählen"
    } as Record<GuestOrderRefusal, string>,
    failed: "Nicht bestellt: {message}", offline: "Keine Verbindung – die Bestellung wurde nicht gesendet, bitte gleich noch einmal"
  },
  en: {
    account: "My account", signIn: "Sign in", register: "Register", signOut: "Sign out", email: "Email", password: "Password", passwordRepeat: "Repeat password",
    name: "Name (optional)", passwordHint: "At least 6 characters", passwordMismatch: "The passwords differ", wrongLogin: "Wrong email or password", emailTaken: "This email is registered already – please sign in",
    accountsOff: "Guest accounts are not available right now", signInLead: "With an account: keep favourites, order for pickup, collect points and redeem them.", welcome: "Hello, {name}",
    points: "Points", pointsLead: "{n} points per €1, credited once paid", rewards: "Rewards", redeem: "Redeem", notEnoughPoints: "Not enough points", rewardAdded: "In your cart: {name} ({points} points)",
    pointsHistory: "Points history", reasonEarn: "Earned", reasonReverse: "Refunded receipt", reasonRedeem: "Redeemed", reasonRefund: "Returned", reasonAdjust: "By the restaurant",
    myOrders: "My orders", noOrders: "No orders yet", favorites: "Favourites", favorite: "Save", unfavorite: "Remove from favourites", favoritesPage: "♥ Favourites", signInToFavorite: "Sign in to keep favourites",
    profile: "Account settings", currentPassword: "Current password", newPassword: "New password (leave empty to keep)", save: "Save", saved: "Saved", deleteAccount: "Delete account", deleteConfirm: "Your points and favourites are deleted for good. Enter your password to confirm.", deleted: "Account deleted",
    forgot: "Forgot your password? The staff can set a new one at the counter.",
    cart: "Cart", addToCart: "Add to cart", added: "Added: {name}", cartEmpty: "Your cart is empty", total: "Total", note: "Note", notePlaceholder: "e.g. less spicy, no coriander", placeOrder: "Place order", placing: "Placing order…",
    dineIn: "Eat in · table {table}", pickup: "Pickup", channel: "How?", noTable: "Scan the QR code on your table to order", pickupNeedsAccount: "Sign in to order for pickup", payInStore: "Pay at the restaurant",
    limits: "Up to {items} items, {amount} per order", reward: "Reward", rewardCost: "{points} points", pointsNeeded: "{points} points needed",
    orderPlaced: "Ordered – it is with the kitchen", orderNo: "Order {no}", pickupNo: "Pickup number", table: "Table", closedNow: "Not taking orders right now",
    statusNew: "With the kitchen", statusPreparing: "Being prepared", statusReady: "Ready", statusCompleted: "Done", statusCancelled: "Cancelled", paid: "Paid",
    refused: {
      ORDERING_OFF: "Ordering from the menu is not available – please call a waiter", ORDERING_CLOSED: "Not taking orders right now", TABLE_NOT_OPEN: "Your table is not open for ordering yet – please ask a waiter",
      TABLE_LOCKED: "Your table's bill is being settled", TOO_SOON: "You just ordered – please try again in {seconds} seconds", ORDER_TOO_LARGE: "Too large for an order from the menu – split it or ask a waiter",
      SIGN_IN_REQUIRED: "Please sign in first", TOO_MANY_PICKUPS: "You have pickups waiting – please collect them first", NOT_ENOUGH_POINTS: "Not enough points for this reward", PAYMENT_UNAVAILABLE: "Online payment is not available yet – please pay at the restaurant", BAD_CHANNEL: "Please choose eat in or pickup"
    } as Record<GuestOrderRefusal, string>,
    failed: "Not ordered: {message}", offline: "No connection – the order was not sent, please try again"
  }
} as const;

type GuestKey = Exclude<keyof typeof copy.zh, "refused">;

export function g(language: Language, key: GuestKey, values: Record<string, string | number> = {}): string {
  return copy[language][key].replace(/\{(\w+)\}/g, (match, name: string) => (values[name] === undefined ? match : String(values[name])));
}

/** What to tell a guest whose order was refused; `code` is the server's (shared/ordering.mjs). */
export function refusal(language: Language, code: string | undefined, values: Record<string, string | number> = {}): string | null {
  const text = code ? (copy[language].refused as Record<string, string>)[code] : undefined;
  return text ? text.replace(/\{(\w+)\}/g, (match, name: string) => (values[name] === undefined ? match : String(values[name]))) : null;
}

const STATUS: Record<ApiOrder["status"], GuestKey> = {
  new: "statusNew", preparing: "statusPreparing", ready: "statusReady", completed: "statusCompleted", cancelled: "statusCancelled"
};

export function statusLabel(language: Language, order: Pick<ApiOrder, "status" | "billedAt">): string {
  return order.billedAt && order.status !== "cancelled" ? `${g(language, STATUS[order.status])} · ${g(language, "paid")}` : g(language, STATUS[order.status]);
}

const REASON: Record<PointsReason, GuestKey> = {
  earn: "reasonEarn", reverse: "reasonReverse", redeem: "reasonRedeem", refund: "reasonRefund", adjust: "reasonAdjust"
};

export function pointsReason(language: Language, reason: PointsReason): string {
  return g(language, REASON[reason]);
}
