import { useState } from "react";

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

const PASSWORD_MIN = 8;

export function GatePanel({ configured, busy, error, onSignIn, onSetPassword }: GatePanelProps) {
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
          <h1>{configured ? "管理台" : "设置管理密码"}</h1>
          <p>{configured
            ? "输入管理密码即可修改菜单"
            : "这台设备第一次打开管理台。设置一个密码，之后改菜单都用它。"}</p>
        </div>
      </div>

      <label>
        <span>{configured ? "管理密码" : `新密码（至少 ${PASSWORD_MIN} 位）`}</span>
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
        <span>再输入一次</span>
        <input
          type="password"
          name="admin-password-repeat"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </label>}

      {tooShort && <p className="gate-note">密码至少 {PASSWORD_MIN} 位</p>}
      {mismatch && <p className="gate-note">两次输入不一致</p>}
      {error && <p className="gate-note error" role="alert">{error}</p>}

      <button type="submit" className="primary-action" disabled={!ready || busy}>
        {busy ? "请稍候…" : configured ? "进入管理台" : "设置密码并进入"}
      </button>

      {!configured && <p className="gate-note">
        密码只保存在你自己的后端里，服务器存的是它的哈希，不是密码本身。
      </p>}
    </form>
  </div>;
}
