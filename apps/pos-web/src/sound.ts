import { useEffect, useRef } from "react";
import type { TableOverview } from "@zhaoyun/api-client";
import type { ApiServiceRequest } from "@zhaoyun/contracts";
import type { MenuLanguage } from "@zhaoyun/domain";

const SPEECH_LANG: Record<MenuLanguage, string> = { zh: "zh-CN", de: "de-DE", en: "en-US" };
const CALL_LABEL: Record<MenuLanguage, Record<string, string>> = {
  zh: { waiter: "呼叫服务员", bill: "买单", water: "加水", utensils: "餐具", napkin: "纸巾", takeaway: "打包盒", clear: "收台" },
  de: { waiter: "Kellner", bill: "Zahlen", water: "Wasser", utensils: "Besteck", napkin: "Servietten", takeaway: "Mitnehmen", clear: "Abräumen" },
  en: { waiter: "Waiter", bill: "Bill", water: "Water", utensils: "Cutlery", napkin: "Napkins", takeaway: "Box", clear: "Clear" }
};

let ctx: AudioContext | null = null;
function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

function chime(double = false): void {
  const audio = context();
  if (!audio) return;
  const notes = double ? [880, 1175] : [784];
  const base = audio.currentTime;
  notes.forEach((freq, i) => {
    const start = base + i * 0.14;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(start);
    osc.stop(start + 0.23);
  });
}

function speak(language: MenuLanguage, text: string): void {
  if (!text) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[language];
    synth.speak(u);
  } catch { /* chime already played */ }
}

/** Play sound + voice alerts on the waiter's phone when new calls or orders arrive. */
export function useFloorAlerts(requests: ApiServiceRequest[], tables: TableOverview[], language: MenuLanguage): void {
  const seenCalls = useRef<Set<string>>(new Set());
  const seenOrders = useRef<Set<string>>(new Set());
  const primedCalls = useRef(false);
  const primedOrders = useRef(false);

  useEffect(() => {
    const wake = () => { context(); };
    window.addEventListener("pointerdown", wake, { once: true, passive: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    const open = requests.filter((req) => req.status === "open");
    if (!primedCalls.current) {
      for (const req of open) seenCalls.current.add(req.id);
      primedCalls.current = true;
    } else {
      const fresh = open.filter((req) => !seenCalls.current.has(req.id));
      for (const req of fresh) seenCalls.current.add(req.id);
      if (fresh.length > 0) {
        chime(true);
        const text = fresh.map((req) => {
          const label = CALL_LABEL[language][req.type] ?? req.type;
          return language === "zh" ? `${req.table}桌，${label}` : language === "de" ? `Tisch ${req.table}, ${label}` : `Table ${req.table}, ${label}`;
        }).join("，");
        speak(language, text);
      }
    }
    const live = new Set(open.map((req) => req.id));
    for (const id of [...seenCalls.current]) if (!live.has(id)) seenCalls.current.delete(id);
  }, [requests, language]);

  useEffect(() => {
    const currentOrders = tables.flatMap((table) => table.orders.map((order) => ({ id: order.id, table: table.table })));
    if (!primedOrders.current) {
      if (tables.length > 0) {
        for (const item of currentOrders) seenOrders.current.add(item.id);
        primedOrders.current = true;
      }
    } else {
      const fresh = currentOrders.filter((item) => !seenOrders.current.has(item.id));
      for (const item of fresh) seenOrders.current.add(item.id);
      if (fresh.length > 0) {
        chime(false);
        const first = fresh[0]!;
        const text = language === "zh"
          ? (fresh.length === 1 ? `${first.table}桌，新订单` : `${fresh.length}笔新订单`)
          : language === "de"
            ? (fresh.length === 1 ? `Tisch ${first.table}, neue Bestellung` : `${fresh.length} neue Bestellungen`)
            : (fresh.length === 1 ? `Table ${first.table}, new order` : `${fresh.length} new orders`);
        speak(language, text);
      }
    }
    const live = new Set(currentOrders.map((item) => item.id));
    for (const id of [...seenOrders.current]) if (!live.has(id)) seenOrders.current.delete(id);
  }, [tables, language]);
}
