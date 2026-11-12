import { useEffect, useRef, useState } from "react";
import type { MemberTierTheme } from "@zhaoyun/domain";

const MUTE_KEY = "member-entry-muted";

function reads(key: string): boolean {
  try { return window.localStorage.getItem(key) === "1"; } catch { return false; }
}
function writes(key: string, on: boolean): void {
  try { window.localStorage.setItem(key, on ? "1" : "0"); } catch { /* private mode */ }
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** A short, synthesised 入场音效 — no audio file, so nothing to load. A rising
 *  gong-like swell, richer for the higher 龙王 tiers. Built lazily inside the
 *  tap that opened the account, so autoplay rules are satisfied, and skipped
 *  when muted or when the guest asks for reduced motion. */
function playChime(theme: MemberTierTheme): void {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  let ctx: AudioContext;
  try { ctx = new Ctor(); } catch { return; }
  const now = ctx.currentTime;
  // Pentatonic rise; the top tiers add a shimmering upper octave and a longer tail.
  const rich = theme === "gilded" || theme === "dark";
  const notes = rich ? [392, 523.25, 659.25, 783.99, 1046.5] : [392, 523.25, 659.25];
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(rich ? 0.09 : 0.06, now + 0.04);
  master.gain.exponentialRampToValueAtTime(0.0001, now + (rich ? 1.9 : 1.2));
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = theme === "gilded" ? "triangle" : "sine";
    osc.frequency.value = freq;
    const at = now + index * 0.085;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + (rich ? 1.1 : 0.7));
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 1.4);
  });
  window.setTimeout(() => { ctx.close().catch(() => undefined); }, (rich ? 2200 : 1500));
}

/**
 * Drives a member's 入场特效 the first time their account opens: a one-shot
 * reveal flag for the badge/theme, plus the matching chime (unless muted or
 * reduced-motion). Returns the mute state and a toggle so the guest can silence
 * it; the animation never blocks and leaves no residue once it has played.
 */
export function useTierEntry(theme: MemberTierTheme | null): { entering: boolean; muted: boolean; toggleMuted: () => void } {
  const [entering, setEntering] = useState(false);
  const [muted, setMuted] = useState(() => reads(MUTE_KEY));
  const played = useRef(false);

  useEffect(() => {
    if (!theme || played.current) return;
    played.current = true;
    if (prefersReducedMotion()) return;
    setEntering(true);
    if (!reads(MUTE_KEY)) playChime(theme);
    const timer = window.setTimeout(() => setEntering(false), 2200);
    return () => window.clearTimeout(timer);
  }, [theme]);

  function toggleMuted(): void {
    setMuted((on) => { const next = !on; writes(MUTE_KEY, next); return next; });
  }
  return { entering, muted, toggleMuted };
}
