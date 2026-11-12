/**
 * The kitchen board's ear: when a new order lands, or one waits too long
 * unstarted, it chimes — and, if the tablet is set to it, reads the order out
 * loud. In a loud kitchen nobody has to watch the screen to catch a new ticket.
 *
 * The sound is a choice of the tablet, not of the restaurant: one screen can be
 * silent while the one by the pass speaks. So the mode lives in this browser's
 * storage, like the admin language, and is never a server setting.
 *
 * The tricky parts — which orders are new since last look, and which have
 * waited past the nudge window — are pure functions here, tested without a
 * browser. The browser-only bits (Web Audio, speech) are guarded so a device
 * that lacks them simply stays quiet.
 */
import { useEffect, useRef } from "react";
import type { ApiOrder } from "@zhaoyun/contracts";
import type { AdminLanguage } from "../../app/i18n";

export type AnnounceMode = "off" | "beep" | "voice";
/** Tapping the bell cycles through these in order. */
export const ANNOUNCE_MODES: AnnounceMode[] = ["off", "beep", "voice"];
const STORAGE_KEY = "zy_board_announce";
/** An order left unstarted this long gets a second chime, and again after. */
export const DEFAULT_OVERDUE_MS = 3 * 60 * 1000;

/** The orders the kitchen has not started yet — the only ones worth a sound. */
export function pendingNew(orders: ApiOrder[]): ApiOrder[] {
  return orders.filter((order) => order.status === "new");
}

/**
 * Split the pending orders into the ones new since last look (ids not in
 * `seen`) and the ones that have waited past `overdueMs` unstarted and are due
 * another nudge (their last nudge, from `nudgedAt`, is at least `overdueMs`
 * ago). A fresh order is never also overdue — it just arrived.
 */
export function announceDiff(
  orders: ApiOrder[],
  seen: Set<string>,
  nudgedAt: Map<string, number>,
  now: number,
  overdueMs: number
): { fresh: ApiOrder[]; overdue: ApiOrder[] } {
  const pending = pendingNew(orders);
  const fresh = pending.filter((order) => !seen.has(order.id));
  const overdue = pending.filter((order) => {
    if (!seen.has(order.id)) return false;
    if (now - Date.parse(order.createdAt) < overdueMs) return false;
    return now - (nudgedAt.get(order.id) ?? 0) >= overdueMs;
  });
  return { fresh, overdue };
}

export function loadAnnounceMode(): AnnounceMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (ANNOUNCE_MODES as string[]).includes(stored ?? "") ? (stored as AnnounceMode) : "off";
  } catch {
    return "off";
  }
}

export function saveAnnounceMode(mode: AnnounceMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* a locked-down browser just forgets the choice between loads */
  }
}

export function nextAnnounceMode(mode: AnnounceMode): AnnounceMode {
  return ANNOUNCE_MODES[(ANNOUNCE_MODES.indexOf(mode) + 1) % ANNOUNCE_MODES.length]!;
}

const SPEECH_LANG: Record<AdminLanguage, string> = { zh: "zh-CN", en: "en-US", de: "de-DE" };

// Browsers won't make a sound until the page has been touched, so the audio
// context is opened and resumed on the tap that turns the bell on.
let audioContext: (AudioContext | null) = null;

export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    audioContext = null;
  }
}

/** A short two-tone chime, `beeps` times; silent if Web Audio is unavailable. */
export function playChime(beeps: number): void {
  if (!audioContext) return;
  try {
    const now = audioContext.currentTime;
    for (let index = 0; index < beeps; index += 1) {
      const start = now + index * 0.18;
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(gain).connect(audioContext.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    }
  } catch {
    /* ignore: a chime that cannot play is not worth crashing the board */
  }
}

function orderWhere(language: AdminLanguage, order: ApiOrder): string {
  if (order.channel === "pickup") {
    const no = order.pickupNo ?? order.no;
    return language === "zh" ? `取餐${no}号` : language === "de" ? `Abholung ${no}` : `pickup ${no}`;
  }
  return language === "zh" ? `${order.table}桌` : language === "de" ? `Tisch ${order.table}` : `table ${order.table}`;
}

/** What the tablet says out loud for this round of fresh and overdue orders. */
export function announceText(language: AdminLanguage, fresh: ApiOrder[], overdue: ApiOrder[]): string {
  const parts: string[] = [];
  if (fresh.length === 1) {
    const where = orderWhere(language, fresh[0]!);
    parts.push(language === "zh" ? `${where}，新订单` : language === "de" ? `Neue Bestellung, ${where}` : `New order, ${where}`);
  } else if (fresh.length > 1) {
    parts.push(language === "zh" ? `${fresh.length}个新订单` : language === "de" ? `${fresh.length} neue Bestellungen` : `${fresh.length} new orders`);
  }
  for (const order of overdue) {
    parts.push(language === "zh" ? `${orderWhere(language, order)}催单` : language === "de" ? `${orderWhere(language, order)} wartet` : `${orderWhere(language, order)} is waiting`);
  }
  return parts.join("，");
}

function speak(language: AdminLanguage, text: string): void {
  if (!text) return;
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG[language];
    synth.speak(utterance);
  } catch {
    /* no speech engine: the chime still played */
  }
}

/**
 * Watch the board's orders and sound off as they arrive or linger. The first
 * run only takes stock of what is already pending, so turning the board on to a
 * backlog does not set off a storm of chimes; the same holds while the mode is
 * "off", so switching the sound on later speaks only what comes next.
 */
export function useOrderAnnouncer(orders: ApiOrder[], mode: AnnounceMode, language: AdminLanguage, overdueMs: number = DEFAULT_OVERDUE_MS): void {
  const seen = useRef<Set<string>>(new Set());
  const nudgedAt = useRef<Map<string, number>>(new Map());
  const primed = useRef(false);

  useEffect(() => {
    const pending = pendingNew(orders);

    if (!primed.current || mode === "off") {
      // Remember what is already on the board without announcing it.
      for (const order of pending) seen.current.add(order.id);
      primed.current = true;
    } else {
      const now = Date.now();
      const { fresh, overdue } = announceDiff(orders, seen.current, nudgedAt.current, now, overdueMs);
      for (const order of fresh) seen.current.add(order.id);
      for (const order of overdue) nudgedAt.current.set(order.id, now);
      if (fresh.length + overdue.length > 0) {
        playChime(fresh.length > 0 ? 2 : 1);
        if (mode === "voice") speak(language, announceText(language, fresh, overdue));
      }
    }

    // Forget orders that have left the board so the sets do not grow forever.
    const live = new Set(orders.map((order) => order.id));
    for (const id of [...seen.current]) if (!live.has(id)) seen.current.delete(id);
    for (const id of [...nudgedAt.current.keys()]) if (!live.has(id)) nudgedAt.current.delete(id);
  }, [orders, mode, language, overdueMs]);
}
