import { useEffect, useState } from "react";
import { kiosk } from "@zhaoyun/native-bridge";
import { useInstall } from "../../app/install";
import { t } from "../../app/i18n";
import type { Language } from "../../app/i18n";

const SEEN_KEY = "zy_install_offer";
/** A moment after the menu is on screen, so the first thing a guest sees is the menu. */
const DELAY_MS = 1200;

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}

function markSeen(): void {
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage refused: it may ask again next visit */ }
}

/**
 * The first time a phone or computer opens the menu, it offers to install
 * itself: one tap where the browser can install (Chrome, Edge, Android), the
 * two steps where it cannot (an iPhone, Safari). Once answered — installed,
 * declined or closed — it does not ask again on that device. Not in the
 * kiosk shell, which is an app already, nor once installed.
 */
export function InstallOffer({ language }: { language: Language }) {
  const installer = useInstall();
  const [due, setDue] = useState(false);
  const [closed, setClosed] = useState(seen);
  useEffect(() => {
    const timer = window.setTimeout(() => setDue(true), DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const steps = installer.platform === "ios" || installer.platform === "safari";
  const open = due && !closed && !installer.installed && !kiosk.isNative() && (installer.canPrompt || steps);
  if (!open) return null;

  const close = () => { markSeen(); setClosed(true); };
  return <aside className="install-offer" role="dialog" aria-label={t(language, "installTitle")}>
    <img src="icons/menu-192.png" alt="" width="44" height="44" />
    <div className="install-offer-text">
      <strong>{t(language, "installTitle")}</strong>
      <span>{installer.canPrompt ? t(language, "installText") : t(language, installer.platform === "ios" ? "installStepsIos" : "installStepsSafari")}</span>
    </div>
    {installer.canPrompt && <button type="button" className="install-offer-go" onClick={async () => { await installer.install(); close(); }}>{t(language, "installAction")}</button>}
    <button type="button" className="install-offer-close" aria-label={t(language, "installLater")} title={t(language, "installLater")} onClick={close}>×</button>
  </aside>;
}
