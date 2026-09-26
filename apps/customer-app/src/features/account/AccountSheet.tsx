import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiMenuSettings } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import { g, pointsReason } from "../../app/guest-i18n";
import { productName, t } from "../../app/i18n";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import type { OrderingState } from "../../app/ordering";
import { Sheet } from "../../components/Sheet";
import type { CustomerAccount } from "./useCustomer";

interface Props {
  state: CustomerState;
  dispatch: CustomerDispatch;
  products: Product[];
  account: CustomerAccount;
  loyalty: ApiMenuSettings["loyalty"];
  ordering: OrderingState;
}

const PASSWORD_MIN = 6;

/**
 * The guest's account: signing in or registering (an email and a password),
 * and once in, their points and the rewards they buy with them, their
 * orders, and their settings — deleting the account included.
 */
export function AccountSheet({ state, dispatch, products, account, loyalty, ordering }: Props) {
  const language = state.language;
  const close = () => dispatch({ type: "sheet", sheet: null });
  return <Sheet id="accountSheet" title={g(language, "account")} closeLabel={t(language, "close")} onClose={close}>
    {account.signedIn && account.customer
      ? <SignedIn state={state} dispatch={dispatch} products={products} account={account} loyalty={loyalty} ordering={ordering} />
      : <SignInForm language={language} account={account} />}
  </Sheet>;
}

function message(language: CustomerState["language"], error: unknown): string {
  if (!(error instanceof ApiError)) return g(language, "offline");
  if (error.code === "EMAIL_TAKEN") return g(language, "emailTaken");
  if (error.code === "ACCOUNTS_OFF") return g(language, "accountsOff");
  if (error.status === 401) return g(language, "wrongLogin");
  return error.message;
}

function SignInForm({ language, account }: { language: CustomerState["language"]; account: CustomerAccount }) {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registering = mode === "register";
  const mismatch = registering && repeat.length > 0 && password !== repeat;
  const ready = email.includes("@") && (registering ? password.length >= PASSWORD_MIN && password === repeat : password.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      if (registering) await account.register({ email: email.trim(), password, ...(name.trim() ? { name: name.trim() } : {}) });
      else await account.signIn(email.trim(), password);
    } catch (failure) {
      setError(message(language, failure));
    } finally {
      setBusy(false);
    }
  }

  return <form className="guest-form" onSubmit={submit}>
    <p className="sheet-lead">{g(language, "signInLead")}</p>
    <div className="segmented" role="tablist">
      <button type="button" role="tab" aria-selected={!registering} className={!registering ? "on" : ""} onClick={() => setMode("sign-in")}>{g(language, "signIn")}</button>
      <button type="button" role="tab" aria-selected={registering} className={registering ? "on" : ""} onClick={() => setMode("register")}>{g(language, "register")}</button>
    </div>
    <label>{g(language, "email")}<input name="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    {registering && <label>{g(language, "name")}<input name="name" autoComplete="nickname" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>}
    <label>{g(language, "password")}{registering && <small> · {g(language, "passwordHint")}</small>}
      <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
    </label>
    {registering && <label>{g(language, "passwordRepeat")}<input name="password-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required /></label>}
    {mismatch && <p className="cart-error">{g(language, "passwordMismatch")}</p>}
    {error && <p className="cart-error" role="alert">{error}</p>}
    <button type="submit" className="primary" disabled={!ready || busy}>{busy ? "…" : g(language, registering ? "register" : "signIn")}</button>
    {!registering && <p className="cart-hint">{g(language, "forgot")}</p>}
  </form>;
}

function SignedIn({ state, dispatch, products, account, loyalty, ordering }: Props) {
  const language = state.language;
  const customer = account.customer!;
  const byId = new Map(products.map((product) => [product.id, product]));
  const rewards = (loyalty?.rewards ?? []).flatMap((reward) => {
    const product = byId.get(reward.productId);
    return product ? [{ product, points: reward.points }] : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ["customer-points", customer.id, customer.points], enabled: showHistory, queryFn: () => restaurantApi.customerPoints() });

  function redeem(product: Product, points: number) {
    dispatch({ type: "add-to-cart", productId: product.id, quantity: 1, modifiers: [], reward: true });
    dispatch({ type: "toast", message: g(language, "rewardAdded", { name: productName(product, language), points }) });
    dispatch({ type: "sheet", sheet: "cart" });
  }

  return <div className="guest-account">
    <div className="guest-card">
      <div>
        <strong>{g(language, "welcome", { name: customer.name || customer.email.split("@")[0] || customer.email })}</strong>
        <small>{customer.email}</small>
      </div>
      {loyalty && <div className="points-balance" aria-label={g(language, "points")}><b>{customer.points}</b><small>{g(language, "points")}</small></div>}
    </div>

    {loyalty && <section className="guest-section">
      <h3>{g(language, "rewards")}</h3>
      <p className="cart-hint">{g(language, "pointsLead", { n: loyalty.pointsPerEuro })}</p>
      {rewards.length > 0 && <ul className="reward-list">{rewards.map(({ product, points }) => {
        const affordable = customer.points >= points;
        return <li key={product.id}>
          <span><b>{productName(product, language)}</b><small>{g(language, "rewardCost", { points })}</small></span>
          <button type="button" className="secondary" disabled={!affordable || !ordering.open} onClick={() => redeem(product, points)}>
            {affordable ? g(language, "redeem") : g(language, "notEnoughPoints")}
          </button>
        </li>;
      })}</ul>}
      <button type="button" className="link-button" onClick={() => setShowHistory(!showHistory)}>{g(language, "pointsHistory")} {showHistory ? "▴" : "▾"}</button>
      {showHistory && <ul className="points-history">{(history.data?.entries ?? []).map((entry) => <li key={entry.id}>
        <span>{pointsReason(language, entry.reason)}{entry.note ? ` · ${entry.note}` : ""}<small>{new Date(entry.createdAt).toLocaleDateString(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB")}</small></span>
        <b className={entry.delta > 0 ? "plus" : "minus"}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</b>
      </li>)}</ul>}
    </section>}

    <div className="guest-actions">
      <button type="button" className="secondary" onClick={() => dispatch({ type: "sheet", sheet: "orders" })}>{g(language, "myOrders")}</button>
      <button type="button" className="secondary" onClick={() => void account.signOut()}>{g(language, "signOut")}</button>
    </div>

    <ProfileForm language={language} account={account} dispatch={dispatch} />
  </div>;
}

function ProfileForm({ language, account, dispatch }: { language: CustomerState["language"]; account: CustomerAccount; dispatch: CustomerDispatch }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(account.customer?.name ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setCurrent("");
      setNext("");
      dispatch({ type: "toast", message: done });
    } catch (failure) {
      setError(failure instanceof ApiError && failure.status === 401 ? g(language, "wrongLogin") : message(language, failure));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <button type="button" className="link-button" onClick={() => setOpen(true)}>{g(language, "profile")} ▾</button>;
  return <form className="guest-form profile" onSubmit={(event) => {
    event.preventDefault();
    if (deleting) void run(() => account.remove(current), g(language, "deleted"));
    else void run(() => account.update({ currentPassword: current, name: name.trim(), ...(next ? { password: next } : {}) }), g(language, "saved"));
  }}>
    <h3>{g(language, "profile")}</h3>
    {!deleting && <label>{g(language, "name")}<input value={name} maxLength={40} onChange={(event) => setName(event.target.value)} /></label>}
    {!deleting && <label>{g(language, "newPassword")}<input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} /></label>}
    {deleting && <p className="cart-error">{g(language, "deleteConfirm")}</p>}
    <label>{g(language, "currentPassword")}<input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required /></label>
    {error && <p className="cart-error" role="alert">{error}</p>}
    <button type="submit" className={deleting ? "danger" : "primary"} disabled={busy || !current || (!deleting && next.length > 0 && next.length < PASSWORD_MIN)}>
      {deleting ? g(language, "deleteAccount") : g(language, "save")}
    </button>
    <button type="button" className="link-button" onClick={() => { setDeleting(!deleting); setError(""); }}>{deleting ? t(language, "goBack") : g(language, "deleteAccount")}</button>
  </form>;
}
