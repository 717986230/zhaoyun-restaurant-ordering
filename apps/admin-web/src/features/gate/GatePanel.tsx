import { useState } from "react";
import { useI18n } from "../../app/i18n";

/**
 * The door of the console, and the whole of it.
 *
 * There are no accounts to pick from and nothing to register: one restaurant,
 * one password. The first person to open the console sets it; everyone after
 * types it. Which of the two this is, is what `configured` says — the server
 * answers that before anything else is drawn.
 */
export interface GatePanelProps {
  configured: boolean;
  busy: boolean;
  error: string | null;
  onSignIn: (password: string) => void;
  onSetPassword: (password: string) => void;
}

const PASSWORD_MIN = 6;

export function GatePanel({ configured, busy, error, onSignIn, onSetPassword }: GatePanelProps) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  // Checked here as well as on the server, because the server never sees the
  // second field: a typo in a password nobody has written down anywhere is
  // how a restaurant locks itself out of its own menu.
  const mismatch = !configured && repeat.length > 0 && password !== repeat;
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN;
  const ready = password.length >= PASSWORD_MIN && (configured || password === repeat);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (configured) onSignIn(password); else onSetPassword(password);
    setPassword("");
    setRepeat("");
  }

  return <div className="gate-pane">
    <form className="editor-form gate-form" onSubmit={submit}>
      <div className="form-title">
        <div>
          <h1>{t(configured ? "gateTitle" : "gateSetTitle")}</h1>
          <p>{t(configured ? "gateLead" : "gateSetLead")}</p>
        </div>
      </div>

      <label>
        <span>{configured ? t("gatePassword") : t("gateNewPassword", { min: PASSWORD_MIN })}</span>
        <input
          type="password"
          name="admin-password"
          autoComplete={configured ? "current-password" : "new-password"}
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {!configured && <label>
        <span>{t("gateRepeat")}</span>
        <input
          type="password"
          name="admin-password-repeat"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </label>}

      {tooShort && <p className="gate-note">{t("gateTooShort", { min: PASSWORD_MIN })}</p>}
      {mismatch && <p className="gate-note">{t("gateMismatch")}</p>}
      {error && <p className="gate-note error" role="alert">{error}</p>}

      <button type="submit" className="primary-action" disabled={!ready || busy}>
        {busy ? t("gateWait") : t(configured ? "gateEnter" : "gateSetAndEnter")}
      </button>

      {!configured && <p className="gate-note">{t("gateStored")}</p>}
    </form>
  </div>;
}
