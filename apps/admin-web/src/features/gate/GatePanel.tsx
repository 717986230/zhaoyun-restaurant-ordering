import { useState } from "react";
import type { RegisterCommand } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";

/**
 * The door of the console: the restaurant's account.
 *
 * The first person to open the console registers it — an account name and a
 * password; everyone after signs in with them. Which of the two this is, is
 * what `registered` says, and the server answers that before anything is drawn.
 */
export interface GatePanelProps {
  registered: boolean;
  busy: boolean;
  error: string | null;
  onSignIn: (login: string, password: string) => void;
  onRegister: (command: RegisterCommand) => void;
}

const PASSWORD_MIN = 6;
const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;

export function GatePanel({ registered, busy, error, onSignIn, onRegister }: GatePanelProps) {
  const { t } = useI18n();
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const account = login.trim().toLowerCase();
  // Checked here as well as on the server, because the server never sees the
  // second field: a typo in a password nobody has written down anywhere is
  // how a restaurant locks itself out of its own menu.
  const mismatch = !registered && repeat.length > 0 && password !== repeat;
  const tooShort = !registered && password.length > 0 && password.length < PASSWORD_MIN;
  const ready = registered
    ? account.length > 0 && password.length > 0
    : LOGIN_PATTERN.test(account) && password.length >= PASSWORD_MIN && password === repeat;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    if (registered) onSignIn(account, password);
    else onRegister({ login: account, ...(name.trim() ? { name: name.trim() } : {}), password });
    setPassword("");
    setRepeat("");
  }

  return <div className="gate-pane">
    <form className="editor-form gate-form" onSubmit={submit}>
      <div className="form-title">
        <div>
          <h1>{t(registered ? "gateTitle" : "gateRegisterTitle")}</h1>
          <p>{t(registered ? "gateLead" : "gateRegisterLead")}</p>
        </div>
      </div>

      <label>
        <span>{t("gateLogin")}</span>
        <input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={login} onChange={(event) => setLogin(event.target.value)} />
        {!registered && <small>{t("gateLoginHint")}</small>}
      </label>

      {!registered && <label>
        <span>{t("gateName")}</span>
        <input name="name" autoComplete="name" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} />
      </label>}

      <label>
        <span>{registered ? t("gatePassword") : t("gateNewPassword", { min: PASSWORD_MIN })}</span>
        <input
          type="password"
          name="password"
          autoComplete={registered ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>

      {!registered && <label>
        <span>{t("gateRepeat")}</span>
        <input type="password" name="password-repeat" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
      </label>}

      {tooShort && <p className="gate-note">{t("gateTooShort", { min: PASSWORD_MIN })}</p>}
      {mismatch && <p className="gate-note">{t("gateMismatch")}</p>}
      {error && <p className="gate-note error" role="alert">{error}</p>}

      <button type="submit" className="primary-action" disabled={!ready || busy}>
        {busy ? t("gateWait") : t(registered ? "gateEnter" : "gateRegister")}
      </button>

      <p className="gate-note">{t("gateStored")}</p>
    </form>
  </div>;
}
