import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ApiBill } from "@zhaoyun/contracts";
import type { ModifierGroup, Product } from "@zhaoyun/domain";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";

/** How often an open table tells the server this device still has it. */
const HOLD_MS = 30_000;

interface CartLine { key: string; product: Product; quantity: number; modifiers: Array<{ id: string; name: string; priceCents: number }> }

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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  // One id per batch sent: a retried tap is the same order, not a second one.
  const requestId = useRef(crypto.randomUUID());

  const name = (product: Product) => product.names[language] || product.names.zh || product.names.de;
  const loadBill = useCallback(async () => {
    try { setBill((await api.bill(table)).bill); } catch (error) { pos.failed(error); }
  }, [table, pos.failed]);

  useEffect(() => {
    void loadBill();
    // Keep the table this device's while it is open; let it go on the way out.
    const hold = window.setInterval(() => { api.claim(table).catch(pos.failed); }, HOLD_MS);
    return () => { window.clearInterval(hold); void api.release(table).catch(() => undefined); };
  }, [table, loadBill, pos.failed]);

  // A guest ordering at this table by QR, a move to it: the sent lines follow.
  useLiveReload(pos, (event) => event.type === "floor.changed" && (!event.table || event.table === table), () => void loadBill());

  const menu = useMemo(() => pos.products.filter((product) => product.published && product.available), [pos.products]);
  const categories = useMemo(() => [...new Set(menu.map((product) => product.category))], [menu]);
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return menu.filter((product) => (!category || product.category === category)
      && (!text || product.sku.toLowerCase().startsWith(text) || Object.values(product.names).some((value) => value?.toLowerCase().includes(text))));
  }, [menu, category, query]);

  function add(product: Product, modifiers: CartLine["modifiers"] = []) {
    const key = lineKey(product, modifiers);
    setCart((current) => current.some((line) => line.key === key)
      ? current.map((line) => (line.key === key ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line))
      : [...current, { key, product, quantity: 1, modifiers }]);
  }
  const pick = (product: Product) => (product.modifiers?.length ? setChoosing(product) : add(product));
  const change = (key: string, by: number) => setCart((current) => current.flatMap((line) => {
    if (line.key !== key) return [line];
    const quantity = line.quantity + by;
    return quantity > 0 ? [{ ...line, quantity }] : [];
  }));

  /** A dish number and Enter: straight onto the order. */
  function byNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = query.trim().toLowerCase();
    if (!code) return;
    const match = menu.find((product) => product.sku.toLowerCase() === code);
    if (!match) return pos.notify(t("notFound", { code: query.trim() }), "error");
    pick(match);
    setQuery("");
  }

  async function send() {
    if (!cart.length) return;
    setBusy(true);
    try {
      await api.order({
        clientRequestId: requestId.current,
        table,
        note: note.trim(),
        items: cart.map((line) => ({ id: line.product.id, qty: line.quantity, ...(line.modifiers.length ? { modifiers: line.modifiers.map((modifier) => ({ id: modifier.id })) } : {}) }))
      });
      pos.notify(t("sentToKitchen", { count: cart.reduce((sum, line) => sum + line.quantity, 0) }));
      requestId.current = crypto.randomUUID();
      setCart([]);
      setNote("");
      await loadBill();
    } catch (error) {
      pos.failed(error);
    } finally {
      setBusy(false);
    }
  }

  const leave = (next: Screen) => { if (!cart.length || window.confirm(t("leaveUnsent"))) go(next); };
  async function printBill() {
    try { await api.printBill(table); pos.notify(t("billPrinted")); } catch (error) { pos.failed(error); }
  }
  async function move() {
    const to = window.prompt(t("moveTo"))?.trim().toUpperCase();
    if (!to) return;
    try {
      await api.move(table, to);
      pos.notify(t("moved", { to }));
      go({ name: "floor" });
    } catch (error) { pos.failed(error); }
  }

  const cartCents = cart.reduce((sum, line) => sum + (line.product.priceCents + line.modifiers.reduce((part, modifier) => part + modifier.priceCents, 0)) * line.quantity, 0);
  const sentCents = Math.round((bill?.total ?? 0) * 100);

  return <section className="pos-order">
    <aside className="pos-ticket">
      <div className="pos-ticket-head">
        <button type="button" onClick={() => leave({ name: "floor" })}>← {t("back")}</button>
        <h1>{pickupNo ? t("pickupNo", { no: pickupNo }) : t("table", { table })}</h1>
      </div>
      <h2>{t("sent")} <span>{money(sentCents)}</span></h2>
      {bill?.items.length ? <ul className="pos-lines sent">{bill.items.map((item) => <li key={item.orderItemId}>
        <span>{item.qty} × {item.names?.[language] || item.name}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}</span>
        <b>{money(Math.round(item.lineTotal * 100))}</b>
      </li>)}</ul> : <p className="pos-muted">{t("nothingSent")}</p>}
      <h2>{t("newItems")} <span>{money(cartCents)}</span></h2>
      {cart.length ? <ul className="pos-lines new">{cart.map((line) => <li key={line.key}>
        <span>{name(line.product)}{line.modifiers.length ? <small>{line.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}</span>
        <span className="pos-stepper">
          <button type="button" aria-label="−" onClick={() => change(line.key, -1)}>−</button>
          <b>{line.quantity}</b>
          <button type="button" aria-label="+" onClick={() => change(line.key, 1)}>+</button>
        </span>
      </li>)}</ul> : <p className="pos-muted">{t("cartEmpty")}</p>}
      <input className="pos-note" value={note} maxLength={500} placeholder={t("note")} onChange={(event) => setNote(event.target.value)} />
      <div className="pos-ticket-actions">
        <button type="button" className="pos-primary" disabled={!cart.length || busy} onClick={() => void send()}>{t("sendKitchen")}</button>
        <button type="button" disabled={!bill?.items.length} onClick={() => void printBill()}>{t("printBill")}</button>
        <button type="button" className="pos-pay" disabled={!bill?.items.length} onClick={() => leave({ name: "pay", table })}>{t("pay")}</button>
        {!pickupNo && <button type="button" disabled={!bill?.items.length} onClick={() => void move()}>{t("moveTable")}</button>}
      </div>
    </aside>

    <div className="pos-menu">
      <form className="pos-number" onSubmit={byNumber}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("dishNumber")} aria-label={t("dishNumber")} autoFocus />
      </form>
      <nav className="pos-categories">
        <button type="button" className={category ? "" : "on"} onClick={() => setCategory("")}>{t("all")}</button>
        {categories.map((entry) => <button key={entry} type="button" className={category === entry ? "on" : ""} onClick={() => setCategory(entry)}>{entry}</button>)}
      </nav>
      <div className="pos-dishes">{shown.map((product) => <button key={product.id} type="button" data-sku={product.sku} onClick={() => pick(product)}>
        <small>{product.sku}</small>
        <b>{name(product)}</b>
        <span>{money(product.priceCents)}</span>
      </button>)}</div>
    </div>

    {choosing && <ModifierPicker pos={pos} product={choosing} onCancel={() => setChoosing(null)} onAdd={(modifiers) => { add(choosing, modifiers); setChoosing(null); }} />}
  </section>;
}

/** A dish's options: one of a "single" group, any of a "multi" group. */
function ModifierPicker({ pos, product, onAdd, onCancel }: { pos: Pos; product: Product; onAdd: (modifiers: CartLine["modifiers"]) => void; onCancel: () => void }) {
  const { t, money, language } = pos;
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
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
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        <button type="button" className="pos-primary" onClick={() => onAdd(selected)}>{t("add")}</button>
      </div>
    </div>
  </div>;
}
