import { useEffect, useRef, useState } from "react";
import type { MemberTierTheme } from "@zhaoyun/domain";

const MUTE_KEY = "member-entry-muted";

function reads(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function writes(key: string, on: boolean): void {
  try { window.localStorage.setItem(key, on ? "1" : "0"); } catch { /* private mode */ }
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

export function entryMuted(): boolean {
  return reads(MUTE_KEY);
}

/*
 * One AudioContext for the page, unlocked on the guest's first tap anywhere.
 * iOS Safari only lets sound play from a context created or resumed inside a
 * user gesture; the entrance usually plays a moment *after* the tap (once the
 * sign-in answer is back), so the context has to be opened by the tap itself.
 */
let shared: AudioContext | null = null;
function context(): AudioContext | null {
  if (shared) return shared;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { shared = new Ctor(); } catch { return null; }
  return shared;
}

/** Opens (or wakes) the page's audio inside a tap. Safe to call often. */
export function primeAudio(): void {
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  // A silent blip: what iOS needs to count the context as started by the user.
  try {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, 22050);
    source.connect(ctx.destination);
    source.start(0);
  } catch { /* nothing to unlock */ }
}

let listening = false;
/** Primes audio on the first tap or key press anywhere on the page. */
export function unlockAudioOnFirstGesture(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const once = () => {
    primeAudio();
    window.removeEventListener("pointerdown", once, true);
    window.removeEventListener("keydown", once, true);
    window.removeEventListener("touchend", once, true);
  };
  window.addEventListener("pointerdown", once, true);
  window.addEventListener("keydown", once, true);
  window.addEventListener("touchend", once, true);
}

/** A short, synthesised 入场音效 — no audio file, so nothing to load. A rising
 *  gong-like swell, richer for the higher 龙王 tiers. Skipped when muted. */
let lastChimeAt = 0;
export function playChime(theme: MemberTierTheme, { force = false }: { force?: boolean } = {}): void {
  if (reads(MUTE_KEY)) return;
  // The entrance and the account crest can both start at sign-in: one chime.
  if (!force && Date.now() - lastChimeAt < 4000) return;
  lastChimeAt = Date.now();
  const ctx = context();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  const now = ctx.currentTime + 0.02;
  const rich = theme === "gilded" || theme === "dark";
  const notes = rich ? [392, 523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25];
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(rich ? 0.18 : 0.12, now + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, now + (rich ? 2.2 : 1.4));
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = theme === "gilded" ? "triangle" : "sine";
    osc.frequency.value = freq;
    const at = now + index * 0.09;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.6, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (rich ? 1.3 : 0.8));
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 1.6);
  });
}

/**
 * Drives the crest's reveal the first time a member's account opens, plus the
 * chime (unless muted). Reduced motion keeps the crest still but still plays
 * the sound — sound is not motion. Returns the mute state and a toggle.
 */
export function useTierEntry(theme: MemberTierTheme | null, { chime = true }: { chime?: boolean } = {}): { entering: boolean; muted: boolean; toggleMuted: () => void } {
  const [entering, setEntering] = useState(false);
  const [muted, setMuted] = useState(() => reads(MUTE_KEY));
  const played = useRef(false);

  useEffect(() => {
    if (!theme || played.current) return;
    played.current = true;
    if (chime) playChime(theme);
    if (prefersReducedMotion()) return;
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 2200);
    return () => window.clearTimeout(timer);
  }, [theme, chime]);

  function toggleMuted(): void {
    const next = !muted;
    writes(MUTE_KEY, next);
    setMuted(next);
    if (!next && theme) { primeAudio(); playChime(theme, { force: true }); }
  }
  return { entering, muted, toggleMuted };
}
