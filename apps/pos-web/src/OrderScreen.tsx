import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import type { ApiBill, PosClaim } from "@zhaoyun/contracts";
import type { ModifierGroup, Product } from "@zhaoyun/domain";
import { ApiError } from "@zhaoyun/api-client";
import { TAG_COLORS } from "../../../src/tag-colors.js";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";

/** How often an open table tells the server this device still has it. */
const HOLD_MS = 30_000;

interface CartLine { key: string; product: Product; quantity: number; modifiers: Array<{ id: string; name: string; priceCents: number }>; note?: string; hold?: boolean }

const lineKey = (product: Product, modifiers: CartLine["modifiers"]) => `${product.id}|${modifiers.map((modifier) => modifier.id).sort().join(",")}`;

/**
 * One table, open on this device: what is already ordered, what is being
 * added, and the dishes — by number (the way a Chinese restaurant's menu is
 * read out: "45, two times"), by name, or by tapping. "Send" puts the new
 * lines on the kitchen's tickets, in Chinese there, and on the bill.
 */
export function OrderScreen({ pos, table, pickupNo, go }: { pos: Pos; table: string; pickupNo?: number | undefined; go: (screen: Screen) => void }) {
  const { t, money, language } = pos;
  const [bill, setBill] = useState<ApiBill | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [note, setNote] = useState("");
  // 逐菜备注: the cart line whose per-dish note is open for editing.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [choosing, setChoosing] = useState<{ product: Product; qty: number } | null>(null);
  // 长按菜品：弹数量键盘问「点几份」。
  const [qtyFor, setQtyFor] = useState<Product | null>(null);
  const [qtyLine, setQtyLine] = useState<CartLine | null>(null);
  // 退菜: the sent line being voided. 沽清: tapping a dish switches it off or on instead of adding it.
  const [voiding, setVoiding] = useState<ApiBill["items"][number] | null>(null);
  const [soldOutMode, setSoldOutMode] = useState(false);
  // 限量: tapping a dish asks how many portions are left today instead of adding it.
  const [stockMode, setStockMode] = useState(false);
  const [busy, setBusy] = useState(false);
  // 转桌: the destination picker — free tables to tap, instead of typing a number blind.
  const [moving, setMoving] = useState(false);
  // 限量: the dish whose "how many left today" is being set.
  const [stockFor, setStockFor] = useState<Product | null>(null);
  // On a phone the ticket is a bottom sheet: collapsed to a summary bar while
  // the dishes fill the screen, tapped up to see and change the whole order.
  const [sheetOpen, setSheetOpen] = useState(false);
  // One id per batch sent: a retried tap is the same order, not a second one.
  const requestId = useRef(crypto.randomUUID());

  const name = (product: Product) => product.names[language] || product.names.zh || product.names.de;
  // Open for its guests to order from their phones (开台), and until when.
  const [orderingUntil, setOrderingUntil] = useState<string | null>(null);
  // 多人同桌: whether this table is open to several POS devices at once.
  const [shared, setShared] = useState(false);
  const loadBill = useCallback(async () => {
    try { setBill((await api.bill(table)).bill); } catch (error) { pos.failed(error); }
    api.floor().then((floor) => {
      const entry = floor.tables.find((row) => row.table === table);
      setOrderingUntil(entry?.orderingUntil ?? null);
      setShared(Boolean(entry?.openOn?.shared));
    }).catch(() => undefined);
  }, [table, pos.failed]);

  useEffect(() => {
    void loadBill();
    // Keep the table this device's while it is open; let it go on the way out.
    // Claim on mount too, not only via Floor.openTable: a remount (React, or a
    // StrictMode re-run whose cleanup already released the table) would otherwise
    // leave the table unclaimed until the first interval fired, so another device
    // would be free to merge onto it. PayScreen keeps the same pattern.
    void api.claim(table).catch(pos.failed);
    const hold = window.setInterval(() => { api.claim(table).catch(pos.failed); }, HOLD_MS);
    return () => { window.clearInterval(hold); void api.release(table).catch(() => undefined); };
  }, [table, loadBill, pos.failed]);

  // A guest ordering at this table by QR, a move to it: the sent lines follow.
  useLiveReload(pos, (event) => event.type === "floor.changed" && (!event.table || event.table === table), () => void loadBill());

  const menu = useMemo(() => pos.products.filter((product) => product.published), [pos.products]);
  const categories = useMemo(() => [...new Set(menu.map((product) => product.category))], [menu]);
  // A stable, distinct colour per category (by its order on the menu), so a
  // waiter tells categories apart at a glance: the chip's dot and the dish's stripe.
  const catColor = useCallback((entry: string) => TAG_COLORS[Math.max(0, categories.indexOf(entry)) % TAG_COLORS.length]!, [categories]);
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return menu.filter((product) => (!category || product.category === category)
      && (!text || product.sku.toLowerCase().startsWith(text) || Object.values(product.names).some((value) => value?.toLowerCase().includes(text))));
  }, [menu, category, query]);

  function add(product: Product, modifiers: CartLine["modifiers"] = [], qty = 1) {
    const key = lineKey(product, modifiers);
    setCart((current) => current.some((line) => line.key === key)
      ? current.map((line) => (line.key === key ? { ...line, quantity: Math.min(99, line.quantity + qty) } : line))
      : [...current, { key, product, quantity: Math.min(99, qty), modifiers }]);
  }
  /**
   * Put `qty` of a dish on the order — ask for its options first, and never
   * more than there are portions left today (限量): what won't fit is said.
   */
  const pick = (product: Product, qty = 1) => {
    if (!product.available) return pos.notify(t("soldOutNote", { name: name(product) }), "error");
    // 每日限量: no more on the order than there are portions left today.
    const left = product.leftToday ?? null;
    const inCart = cart.filter((line) => line.product.id === product.id).reduce((sum, line) => sum + line.quantity, 0);
    const room = left === null ? qty : Math.max(0, left - inCart);
    if (room <= 0) return pos.notify(left ? t("stockShort", { name: name(product), left }) : t("stockOutNote", { name: name(product) }), "error");
    const take = Math.min(qty, room);
    if (take < qty) pos.notify(t("stockShort", { name: name(product), left: left ?? take }), "error");
    return product.modifiers?.length ? setChoosing({ product, qty: take }) : add(product, [], take);
  };

  /** "How many are left today?": a number, or null for no limit today. */
  async function askStock(product: Product, leftToday: number | null) {
    setStockFor(null);
    if (leftToday !== null && (!Number.isInteger(leftToday) || leftToday < 0 || leftToday > 9999)) return pos.notify(t("stockInvalid"), "error");
    try {
      await api.setStock(product.id, { leftToday });
      pos.notify(leftToday === null ? t("stockCleared", { name: name(product) }) : t("stockSet", { name: name(product), n: leftToday }));
      pos.refreshMenu();
    } catch (error) { pos.failed(error); }
  }

  async function toggleSoldOut(product: Product) {
    try {
      await api.setAvailable(product.id, !product.available);
      pos.notify(t(product.available ? "soldOutDone" : "backOnDone", { name: name(product) }));
      pos.refreshMenu();
    } catch (error) { pos.failed(error); }
  }

  async function voidLine(item: ApiBill["items"][number], quantity: number, reason: string) {
    try {
      await api.voidItem(table, item.orderItemId, quantity, reason);
      pos.notify(t("voidDone", { count: quantity, name: item.names?.[language] || item.name }));
      setVoiding(null);
      await loadBill();
    } catch (error) { pos.failed(error); }
  }

  /** 催菜: print a hurry-up ticket to the station cooking this sent dish. */
  async function urge(item: ApiBill["items"][number]) {
    try {
      await api.urge(table, item.orderItemId);
      pos.notify(t("urgeDone", { name: item.names?.[language] || item.name }));
    } catch (error) { pos.failed(error); }
  }
  // 叫起: fire a held (等叫) dish to the kitchen now, then refresh the bill.
  async function fire(item: ApiBill["items"][number]) {
    try {
      await api.fire(table, item.orderItemId);
      pos.notify(t("fireDone", { name: item.names?.[language] || item.name }));
      await loadBill();
    } catch (error) { pos.failed(error); }
  }
  // 长按菜品 = 弹数量键盘点几份；短按仍是 +1。沽清/限量模式下不触发。
  const press = useRef<{ timer: number; fired: boolean }>({ timer: 0, fired: false });
  const startPress = (product: Product) => {
    if (soldOutMode || stockMode) return;
    press.current.fired = false;
    press.current.timer = window.setTimeout(() => { press.current.fired = true; setQtyFor(product); }, 500);
  };
  const endPress = () => { if (press.current.timer) { window.clearTimeout(press.current.timer); press.current.timer = 0; } };

  const change = (key: string, by: number) => setCart((current) => current.flatMap((line) => {
    if (line.key !== key) return [line];
    const quantity = line.quantity + by;
    return quantity > 0 ? [{ ...line, quantity }] : [];
  }));

  // 点击购物车数字直接设份数。
  const setLineQty = (key: string, qty: number) => setCart((current) => current.map((line) => (line.key === key ? { ...line, quantity: Math.max(1, Math.min(99, qty)) } : line)));

  // 逐菜备注：把某行的备注写上（空串则清掉）。
  const setLineNote = (key: string, text: string) => setCart((current) => current.map((line) => {
    if (line.key !== key) return line;
    const note = text.slice(0, 120);
    const { note: _drop, ...rest } = line;
    return note.trim() ? { ...rest, note } : rest;
  }));

  // 等叫：把某行标成「等叫」或取消；等叫的菜落单后不立即进厨房。
  const toggleHold = (key: string) => setCart((current) => current.map((line) => {
    if (line.key !== key) return line;
    if (line.hold) { const { hold: _drop, ...rest } = line; return rest; }
    return { ...line, hold: true };
  }));

  /**
   * A dish number and Enter: straight onto the order — "45" for one, "45×3",
   * "45*3" or "45 3" for three (点菜改数量 the way it is said at the table).
   */
  function byNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = query.trim();
    if (!raw) return;
    const parts = raw.match(/^(.+?)\s*(?:[*xX×＊]\s*|\s+)(\d{1,2})$/);
    const code = (parts ? parts[1]! : raw).trim().toLowerCase();
    const qty = parts ? Math.max(1, Math.min(99, Number(parts[2]))) : 1;
    const match = menu.find((product) => product.sku.toLowerCase() === code);
    if (!match) return pos.notify(t("notFound", { code: parts ? parts[1]!.trim() : raw }), "error");
    pick(match, qty);
    setQuery("");
  }

  async function send() {
    if (!cart.length) return;
    const count = cart.reduce((sum, line) => sum + line.quantity, 0);
    const command = {
      clientRequestId: requestId.current,
      table,
      note: note.trim(),
      items: cart.map((line) => ({ id: line.product.id, qty: line.quantity, ...(line.modifiers.length ? { modifiers: line.modifiers.map((modifier) => ({ id: modifier.id })) } : {}), ...(line.note?.trim() ? { note: line.note.trim() } : {}), ...(line.hold ? { hold: true } : {}) }))
    };
    const limited = cart.some((line) => line.product.leftToday !== null && line.product.leftToday !== undefined);
    setBusy(true);
    try {
      await api.order(command);
      pos.notify(t("sentToKitchen", { count }));
      requestId.current = crypto.randomUUID();
      setCart([]);
      setNote("");
      setNoteFor(null);
      setSheetOpen(false);
      await loadBill();
      // The counts of limited dishes went down.
      if (limited) pos.refreshMenu();
    } catch (error) {
      if (error instanceof ApiError && error.code === "SOLD_OUT") {
        // Another table was quicker: say which dish and how many there still are, and show the new counts.
        const dish = menu.find((product) => product.sku === error.details.sku);
        const left = Number(error.details.left ?? 0);
        pos.notify(left ? t("stockShort", { name: dish ? name(dish) : String(error.details.sku), left }) : t("stockOutNote", { name: dish ? name(dish) : String(error.details.sku) }), "error");
        pos.refreshMenu();
      } else if (!(error instanceof ApiError)) {
        // The server was never reached (the Wi-Fi dropped): keep the order on
        // this device and let it send itself once the network is back, rather
        // than lose it. It carries the same clientRequestId, so it cannot fire
        // twice even if the first attempt had in fact landed.
        pos.queueOffline(command, count);
        pos.notify(t("queuedOffline", { count }));
        requestId.current = crypto.randomUUID();
        setCart([]);
        setNote("");
        setSheetOpen(false);
        if (limited) pos.refreshMenu();
      } else pos.failed(error);
    } finally {
      setBusy(false);
    }
  }

  const leave = (next: Screen) => { if (!cart.length || window.confirm(t("leaveUnsent"))) go(next); };
  async function printBill() {
    try { await api.printBill(table); pos.notify(t("billPrinted")); } catch (error) { pos.failed(error); }
  }
  async function toggleGuestOrdering() {
    try {
      const { session } = await api.setTableOrdering(table, !orderingUntil);
      setOrderingUntil(session?.expiresAt ?? null);
      pos.notify(t(session ? "guestOrderingOpened" : "guestOrderingClosed", { table }));
    } catch (error) { pos.failed(error); }
  }
  // 多人同桌: open this table to several devices, or lock it back to this one.
  async function toggleShared() {
    try {
      const next = !shared;
      await api.claim(table, next);
      setShared(next);
      pos.notify(t(next ? "sharedOn" : "sharedOff", { table }));
    } catch (error) { pos.failed(error); }
  }
  async function move(to: string, merge = false) {
    const target = to.trim().toUpperCase();
    if (!target) return;
    setMoving(false);
    try {
      await api.move(table, target, merge);
      pos.notify(t(merge ? "mergedTo" : "moved", { to: target }));
      go({ name: "floor" });
    } catch (error) { pos.failed(error); }
  }

  const cartCents = cart.reduce((sum, line) => sum + (line.product.priceCents + line.modifiers.reduce((part, modifier) => part + modifier.priceCents, 0)) * line.quantity, 0);
  const sentCents = Math.round((bill?.total ?? 0) * 100);
  const newCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  // 已点份数: how many of each dish are already in the (unsent) order, summed
  // across its modifier variants — shown as a red badge on the dish so the
  // waiter sees a repeat before sending to the kitchen.
  const cartCountById = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of cart) counts.set(line.product.id, (counts.get(line.product.id) ?? 0) + line.quantity);
    return counts;
  }, [cart]);

  return <section className={`pos-order ${sheetOpen ? "sheet-open" : ""}`}>
    {sheetOpen && <div className="pos-sheet-scrim" onClick={() => setSheetOpen(false)} />}
    <aside className={`pos-ticket ${sheetOpen ? "open" : ""}`}>
      <div className="pos-ticket-head">
        <button type="button" onClick={() => leave({ name: "floor" })}>← {t("back")}</button>
        <h1>{pickupNo ? t("pickupNo", { no: pickupNo }) : t("table", { table })}</h1>
      </div>
      <h2>{t("sent")} <span>{money(sentCents)}</span></h2>
      {bill?.items.length ? <ul className="pos-lines sent">{bill.items.map((item) => <li key={item.orderItemId}>
        <span>{item.qty} × {item.names?.[language] || item.name}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}{item.note ? <small className="pos-line-note">✎ {item.note}</small> : null}{item.held ? <small className="pos-line-hold">{t("holdBadge")}</small> : null}</span>
        <b>{money(Math.round(item.lineTotal * 100))}</b>
        {item.held
          ? <button type="button" className="pos-fire" aria-label={t("fireOf", { name: item.names?.[language] || item.name })} onClick={() => void fire(item)}>{t("fire")}</button>
          : <button type="button" className="pos-urge" aria-label={t("urgeOf", { name: item.names?.[language] || item.name })} onClick={() => void urge(item)}>{t("urge")}</button>}
        <button type="button" className="pos-void" aria-label={t("voidOf", { name: item.names?.[language] || item.name })} onClick={() => setVoiding(item)}>{t("void")}</button>
      </li>)}</ul> : <p className="pos-muted">{t("nothingSent")}</p>}
      <h2>{t("newItems")} <span>{money(cartCents)}</span></h2>
      {cart.length ? <ul className="pos-lines new">{cart.map((line) => <li key={line.key} className="pos-line-notable">
        <div className="pos-line-main">
          <span>{name(line.product)}{line.modifiers.length ? <small>{line.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}{line.note ? <small className="pos-line-note">✎ {line.note}</small> : null}{line.hold ? <small className="pos-line-hold">{t("holdBadge")}</small> : null}</span>
          <span className="pos-stepper">
            <button type="button" className="pos-line-holdbtn" aria-label={t("hold")} aria-pressed={line.hold === true} onClick={() => toggleHold(line.key)}>{t("holdShort")}</button>
            <button type="button" className="pos-line-notebtn" aria-label={t("itemNote")} aria-pressed={noteFor === line.key} onClick={() => setNoteFor(noteFor === line.key ? null : line.key)}>✎</button>
            <button type="button" aria-label="−" onClick={() => change(line.key, -1)}>−</button>
            <button type="button" className="pos-qty-btn" onClick={() => setQtyLine(line)}><b>{line.quantity}</b></button>
            <button type="button" aria-label="+" onClick={() => change(line.key, 1)}>+</button>
          </span>
        </div>
        {noteFor === line.key ? <input className="pos-note pos-line-noteinput" autoFocus value={line.note ?? ""} maxLength={120} placeholder={t("itemNotePlaceholder")} onChange={(event) => setLineNote(line.key, event.target.value)} onBlur={() => setNoteFor(null)} onKeyDown={(event) => { if (event.key === "Enter") setNoteFor(null); }} /> : null}
      </li>)}</ul> : <p className="pos-muted">{t("cartEmpty")}</p>}
      <input className="pos-note" value={note} maxLength={500} placeholder={t("note")} onChange={(event) => setNote(event.target.value)} />
      <div className="pos-ticket-actions">
        <button type="button" className="pos-primary" disabled={!cart.length || busy} onClick={() => void send()}>{t("sendKitchen")}</button>
        <button type="button" disabled={!bill?.items.length} onClick={() => void printBill()}>{t("printBill")}</button>
        <button type="button" className="pos-pay" disabled={!bill?.items.length} onClick={() => leave({ name: "pay", table })}>{t("pay")}</button>
        {!pickupNo && <button type="button" disabled={!bill?.items.length} onClick={() => setMoving(true)}>{t("moveTable")}</button>}
        {!pickupNo && !/^TA-/i.test(table) && <button type="button" className={orderingUntil ? "pos-on" : ""} onClick={() => void toggleGuestOrdering()}>
          {orderingUntil ? t("guestOrderingClose") : t("guestOrderingOpen")}
        </button>}
        {!pickupNo && !/^TA-/i.test(table) && <button type="button" className={shared ? "pos-on" : ""} onClick={() => void toggleShared()}>
          {shared ? t("sharedClose") : t("sharedOpen")}
        </button>}
      </div>
      {orderingUntil && <p className="pos-muted pos-guest-ordering">{t("guestOrderingOn", { time: new Date(orderingUntil).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" }) })}</p>}
    </aside>

    <div className="pos-sheet-bar">
      <button type="button" className="pos-sheet-toggle" aria-expanded={sheetOpen}
        aria-label={sheetOpen ? t("hideOrder") : t("showOrder")} onClick={() => setSheetOpen((open) => !open)}>
        <span className="pos-sheet-grip" aria-hidden="true" />
        <span className="pos-sheet-title">{pickupNo ? t("pickupNo", { no: pickupNo }) : t("table", { table })}</span>
        <span className="pos-sheet-sum">
          <span>{newCount ? t("sheetItems", { count: newCount }) : t("sent")}</span>
          <b>{money(newCount ? cartCents : sentCents)}</b>
        </span>
      </button>
      <button type="button" className="pos-primary pos-sheet-send" disabled={!cart.length || busy} onClick={() => void send()}>{t("sendKitchen")}</button>
    </div>

    <div className="pos-menu">
      <form className="pos-number" onSubmit={byNumber}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("dishNumber")} aria-label={t("dishNumber")} autoFocus />
      </form>
      <div className="pos-dish-modes">
        <button type="button" className={`pos-soldout-mode ${soldOutMode ? "on" : ""}`} aria-pressed={soldOutMode} onClick={() => { setSoldOutMode((on) => !on); setStockMode(false); }}>{t(soldOutMode ? "soldOutModeOn" : "soldOutMode")}</button>
        <button type="button" className={`pos-soldout-mode pos-stock-mode ${stockMode ? "on" : ""}`} aria-pressed={stockMode} onClick={() => { setStockMode((on) => !on); setSoldOutMode(false); }}>{t(stockMode ? "stockModeOn" : "stockMode")}</button>
      </div>
      <nav className="pos-categories">
        <button type="button" className={category ? "" : "on"} onClick={() => setCategory("")}>{t("all")}</button>
        {categories.map((entry) => <button key={entry} type="button" className={category === entry ? "on" : ""} onClick={() => setCategory(entry)}>
          <span className="pos-cat-dot" aria-hidden="true" style={{ background: catColor(entry) }} />{entry}
        </button>)}
      </nav>
      <div className={`pos-dishes ${soldOutMode || stockMode ? "choosing-soldout" : ""}`}>{shown.map((product) => {
        const left = product.leftToday ?? null;
        const out = !product.available || left === 0;
        const inCart = cartCountById.get(product.id) ?? 0;
        return <button key={product.id} type="button" data-sku={product.sku}
          style={{ "--tag": product.tagColor || catColor(product.category) } as CSSProperties}
          className={out ? "soldout" : ""} aria-disabled={out && !soldOutMode && !stockMode}
          onPointerDown={() => startPress(product)} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}
          onClick={() => { if (press.current.fired) { press.current.fired = false; return; } void (soldOutMode ? toggleSoldOut(product) : stockMode ? setStockFor(product) : pick(product)); }}>
          <small>{product.sku}</small>
          <b>{name(product)}</b>
          <span>{!product.available ? t("soldOut") : left === 0 ? t("stockOut") : money(product.priceCents)}</span>
          {left !== null && left > 0 && <em className="pos-stock-left" data-left={left}>{t("stockLeft", { n: left })}</em>}
          {inCart > 0 && <em className="pos-dish-count" aria-label={t("inCart", { n: inCart })}>{inCart}</em>}
        </button>;
      })}</div>
    </div>

    {moving && <MoveDialog pos={pos} from={table} onCancel={() => setMoving(false)} onMove={(to, merge) => void move(to, merge)} />}
    {stockFor && <StockDialog pos={pos} product={stockFor} onCancel={() => setStockFor(null)} onSet={(leftToday) => void askStock(stockFor, leftToday)} />}
    {voiding && <VoidDialog pos={pos} item={voiding} onCancel={() => setVoiding(null)} onVoid={(quantity, reason) => void voidLine(voiding, quantity, reason)} />}
    {qtyFor && <QtyDialog pos={pos} product={qtyFor} onCancel={() => setQtyFor(null)} onPick={(qty) => { setQtyFor(null); pick(qtyFor, qty); }} />}
    {qtyLine && <QtyDialog pos={pos} product={qtyLine.product} onCancel={() => setQtyLine(null)} onPick={(qty) => { setLineQty(qtyLine.key, qty); setQtyLine(null); }} />}
    {choosing && <ModifierPicker pos={pos} product={choosing.product} initialQty={choosing.qty} onCancel={() => setChoosing(null)} onAdd={(modifiers, qty) => { add(choosing.product, modifiers, qty); setChoosing(null); }} />}
  </section>;
}

/** 退菜: how many of a sent dish go back, and why — the kitchen gets a void ticket. */
function VoidDialog({ pos, item, onVoid, onCancel }: { pos: Pos; item: ApiBill["items"][number]; onVoid: (quantity: number, reason: string) => void; onCancel: () => void }) {
  const { t, language } = pos;
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const reasons = [t("voidReasonGuest"), t("voidReasonWrong"), t("voidReasonKitchen"), t("voidReasonWait")];
  return <div className="pos-modal" role="dialog" aria-label={t("void")}>
    <form className="pos-card pos-void-form" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onVoid(quantity, reason.trim()); }}>
      <h2>{t("voidOf", { name: item.names?.[language] || item.name })}</h2>
      <span className="pos-stepper">
        <button type="button" aria-label="−" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</button>
        <b>{quantity}/{item.qty}</b>
        <button type="button" aria-label="+" disabled={quantity >= item.qty} onClick={() => setQuantity(quantity + 1)}>+</button>
      </span>
      <div className="pos-options">{reasons.map((option) => <button key={option} type="button" className={reason === option ? "on" : ""} aria-pressed={reason === option} onClick={() => setReason(option)}>{option}</button>)}</div>
      <label><span>{t("voidReason")}</span><input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="pos-modal-actions">
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        <button type="submit" className="pos-primary pos-danger" disabled={!reason.trim()}>{t("voidConfirm")}</button>
      </div>
    </form>
  </div>;
}

/**
 * 转桌 / 并台: where the open table goes. Free tables are laid out to tap for a
 * plain move (换台); occupied tables are a second grid for merging the two bills
 * onto one (并台), with a confirm first since it combines bills. A text box
 * stays for anything not shown.
 */
function MoveDialog({ pos, from, onMove, onCancel }: { pos: Pos; from: string; onMove: (to: string, merge: boolean) => void; onCancel: () => void }) {
  const { t, money } = pos;
  // The floor as it stands, with who has each table open: a table another
  // waiter is working on is not a target, here or by typing its number.
  const [floor, setFloor] = useState<{
    tables: { table: string; state: string; total: number }[];
    claims: PosClaim[];
    deviceId: string;
  } | null>(null);
  const [other, setOther] = useState("");
  // 并台: the occupied table a merge is about to go to, awaiting confirm.
  const [mergeTo, setMergeTo] = useState<string | null>(null);
  useEffect(() => {
    api.floor().then((data) => setFloor({ tables: data.tables, claims: data.claims, deviceId: data.deviceId })).catch(() => setFloor({ tables: [], claims: [], deviceId: "" }));
  }, []);
  const up = from.toUpperCase();
  const room = (floor?.tables ?? []).filter((entry) => !/^TA-/i.test(entry.table) && entry.table.toUpperCase() !== up);
  // Seated is the floor's word for a table with an open bill; "occupied" never
  // was one, so the merge grid below used to come up empty.
  const free = room.filter((entry) => entry.state === "free");
  const busy = room.filter((entry) => entry.state === "seated");
  const claimOf = (table: string) => floor?.claims.find((claim) => claim.table === table.toUpperCase());
  const heldByOther = (table: string) => {
    const claim = claimOf(table);
    return claim && claim.deviceId !== floor?.deviceId && !claim.shared ? claim.staffName ?? "?" : null;
  };
  // A typed number is routed the same way the grids are: onto a table with an
  // open bill it is a merge, so it waits for the same confirm instead of
  // folding two bills together unasked; onto a table another waiter holds,
  // it is refused at once, not after the confirm.
  function moveTyped() {
    const target = other.trim().toUpperCase();
    if (!target) return;
    const entry = room.find((item) => item.table.toUpperCase() === target);
    if (entry?.state === "seated") {
      const holder = heldByOther(entry.table);
      if (holder) pos.failed(new Error(t("claimedBy", { table: entry.table, name: holder })));
      else setMergeTo(entry.table);
      return;
    }
    if (entry) {
      const holder = heldByOther(entry.table);
      if (holder) { pos.failed(new Error(t("claimedBy", { table: entry.table, name: holder }))); return; }
    }
    onMove(other, false);
  }
  return <div className="pos-modal" role="dialog" aria-label={t("moveTitle", { from })}>
    <div className="pos-card pos-move">
      <h2>{t("moveTitle", { from })}</h2>
      {floor === null ? <p className="pos-muted">{t("moveLoading")}</p> : <>
        <h3>{t("moveFreeHeading")}</h3>
        {free.length ? <div className="pos-move-grid">{free.map((entry) => {
          const holder = heldByOther(entry.table);
          return <button key={entry.table} type="button" disabled={Boolean(holder)} title={holder ? t("claimedBy", { table: entry.table, name: holder }) : undefined} onClick={() => onMove(entry.table, false)}>
            {entry.table}{holder && <small>{t("openOn", { name: holder })}</small>}
          </button>;
        })}</div>
          : <p className="pos-muted">{t("moveNoFree")}</p>}
        {busy.length > 0 && <>
          <h3>{t("mergeHeading")}</h3>
          <div className="pos-move-grid">{busy.map((entry) => {
            const holder = heldByOther(entry.table);
            return <button key={entry.table} type="button" className={mergeTo === entry.table ? "on" : ""} aria-pressed={mergeTo === entry.table}
              disabled={Boolean(holder)} title={holder ? t("claimedBy", { table: entry.table, name: holder }) : undefined} onClick={() => setMergeTo(entry.table)}>
              {entry.table}{entry.total > 0 && <small>{money(Math.round(entry.total * 100))}</small>}{holder && <small>{t("openOn", { name: holder })}</small>}
            </button>;
          })}</div>
        </>}
      </>}
      {mergeTo && <div className="pos-merge-confirm" role="group">
        <span>{t("mergeConfirm", { to: mergeTo })}</span>
        <div className="pos-modal-actions">
          <button type="button" onClick={() => setMergeTo(null)}>{t("cancel")}</button>
          <button type="button" className="pos-primary" onClick={() => onMove(mergeTo, true)}>{t("mergeGo")}</button>
        </div>
      </div>}
      <form className="pos-move-other" onSubmit={(event) => { event.preventDefault(); moveTyped(); }}>
        <input value={other} maxLength={8} autoCapitalize="characters" placeholder={t("moveOther")} aria-label={t("moveOther")} onChange={(event) => setOther(event.target.value)} />
        <button type="submit" disabled={!other.trim()}>{t("moveGo")}</button>
      </form>
      <div className="pos-modal-actions">
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
      </div>
    </div>
  </div>;
}

/** 限量: how many portions of a dish are left today — a number, or "no limit". */
function StockDialog({ pos, product, onSet, onCancel }: { pos: Pos; product: Product; onSet: (leftToday: number | null) => void; onCancel: () => void }) {
  const { t, language } = pos;
  const current = product.leftToday === null || product.leftToday === undefined ? "" : String(product.leftToday);
  const [value, setValue] = useState(current);
  const name = product.names[language] || product.names.zh || product.names.de;
  return <div className="pos-modal" role="dialog" aria-label={t("stockMode")}>
    <form className="pos-card pos-stock-form" onSubmit={(event) => { event.preventDefault(); const text = value.trim(); onSet(text === "" ? null : Number(text)); }}>
      <h2>{t("stockTitle", { name })}</h2>
      <input inputMode="numeric" autoFocus value={value} maxLength={4} placeholder={t("stockUnlimited")} aria-label={t("stockTitle", { name })} onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ""))} />
      <div className="pos-modal-actions">
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        <button type="button" onClick={() => onSet(null)}>{t("stockNoLimit")}</button>
      </div>
      <button type="submit" className="pos-primary">{t("stockSave")}</button>
    </form>
  </div>;
}

/** 点几份: a quick quantity keypad for a long-pressed dish. */
function QtyDialog({ pos, product, onPick, onCancel }: { pos: Pos; product: Product; onPick: (qty: number) => void; onCancel: () => void }) {
  const { t, language } = pos;
  const name = product.names[language] || product.names.zh || product.names.de;
  const [qty, setQty] = useState(1);
  const quick = [2, 3, 4, 5, 6, 10];
  return <div className="pos-modal" role="dialog" aria-label={t("qtyTitle", { name })}>
    <div className="pos-card pos-qty-form">
      <h2>{t("qtyTitle", { name })}</h2>
      <span className="pos-stepper pos-qty-stepper">
        <button type="button" aria-label="−" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</button>
        <b>{qty}</b>
        <button type="button" aria-label="+" disabled={qty >= 99} onClick={() => setQty(qty + 1)}>+</button>
      </span>
      <div className="pos-options pos-qty-quick">{quick.map((n) => <button key={n} type="button" className={qty === n ? "on" : ""} aria-pressed={qty === n} onClick={() => setQty(n)}>{n}</button>)}</div>
      <div className="pos-modal-actions">
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        <button type="button" className="pos-primary" onClick={() => onPick(qty)}>{t("qtyAdd", { n: qty })}</button>
      </div>
    </div>
  </div>;
}

/** A dish's options: one of a "single" group, any of a "multi" group. */
function ModifierPicker({ pos, product, initialQty, onAdd, onCancel }: { pos: Pos; product: Product; initialQty: number; onAdd: (modifiers: CartLine["modifiers"], qty: number) => void; onCancel: () => void }) {
  const { t, money, language } = pos;
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(Math.max(1, initialQty));
  const toggle = (group: ModifierGroup, optionId: string) => setChosen((current) => {
    const had = current[group.id] ?? [];
    const next = group.selection === "single" ? (had.includes(optionId) ? [] : [optionId]) : had.includes(optionId) ? had.filter((id) => id !== optionId) : [...had, optionId];
    return { ...current, [group.id]: next };
  });
  const selected = (product.modifiers ?? []).flatMap((group) => group.options
    .filter((option) => (chosen[group.id] ?? []).includes(option.id))
    .map((option) => ({ id: option.id, name: option.names[language] || option.names.zh, priceCents: option.priceCents })));
  return <div className="pos-modal" role="dialog" aria-label={t("choose")}>
    <div className="pos-card">
      <h2>{product.names[language] || product.names.zh}</h2>
      {(product.modifiers ?? []).map((group) => <fieldset key={group.id}>
        <legend>{group.names[language] || group.names.zh}</legend>
        <div className="pos-options">{group.options.map((option) => <button key={option.id} type="button"
          className={(chosen[group.id] ?? []).includes(option.id) ? "on" : ""} aria-pressed={(chosen[group.id] ?? []).includes(option.id)}
          onClick={() => toggle(group, option.id)}>
          {option.names[language] || option.names.zh}{option.priceCents ? ` +${money(option.priceCents)}` : ""}
        </button>)}</div>
      </fieldset>)}
      <div className="pos-modal-actions">
        <span className="pos-stepper pos-qty-stepper">
          <button type="button" aria-label="−" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</button>
          <b>{qty}</b>
          <button type="button" aria-label="+" disabled={qty >= 99} onClick={() => setQty(qty + 1)}>+</button>
        </span>
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        <button type="button" className="pos-primary" onClick={() => onAdd(selected, qty)}>{t("add")}</button>
      </div>
    </div>
  </div>;
}
