import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiBirthday, ApiMenuSettings } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import { balanceReason, g, pointsReason } from "../../app/guest-i18n";
import { formatPrice, productName, t } from "../../app/i18n";
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
  birthdayPerk: ApiMenuSettings["birthdayPerk"];
  ordering: OrderingState;
  /** Who keeps the data, for the privacy notice. */
  restaurantName: string;
  /** The points for signing up from a table's code (0: none). */
  signupPoints: number;
}

const PASSWORD_MIN = 6;

type Language = CustomerState["language"];

/** What the restaurant keeps about an account and what the guest may do about it (GDPR Art. 13). */
function PrivacyNotice({ language, restaurantName, open = false }: { language: Language; restaurantName: string; open?: boolean }) {
  return <details className="privacy-notice" open={open}>
    <summary>{g(language, "privacy")}</summary>
    <p>{g(language, "privacyBody", { restaurant: restaurantName || "—" })}</p>
  </details>;
}

/** The guest's data as a file on their phone: everything the restaurant keeps about the account. */
async function downloadMyData(language: Language, dispatch: CustomerDispatch) {
  try {
    const data = await restaurantApi.exportCustomerData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `my-data-${data.exportedAt.slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({ type: "toast", message: g(language, "dataDownloaded") });
  } catch (error) {
    dispatch({ type: "toast", message: message(language, error) });
  }
}

/**
 * The guest's account: signing in or registering (an email and a password),
 * and once in, their points and the rewards they buy with them, their
 * orders, and their settings — deleting the account included.
 */
export function AccountSheet({ state, dispatch, products, account, loyalty, birthdayPerk, ordering, restaurantName, signupPoints }: Props) {
  const language = state.language;
  const close = () => dispatch({ type: "sheet", sheet: null });
  return <Sheet id="accountSheet" title={g(language, "account")} closeLabel={t(language, "close")} onClose={close}>
    {account.signedIn && account.customer
      ? <SignedIn state={state} dispatch={dispatch} products={products} account={account} loyalty={loyalty} birthdayPerk={birthdayPerk} ordering={ordering} restaurantName={restaurantName} signupPoints={signupPoints} />
      : <SignInForm language={language} account={account} restaurantName={restaurantName} signupPoints={signupPoints} />}
  </Sheet>;
}

function message(language: CustomerState["language"], error: unknown): string {
  if (!(error instanceof ApiError)) return g(language, "offline");
  if (error.code === "EMAIL_TAKEN") return g(language, "emailTaken");
  if (error.code === "ACCOUNTS_OFF") return g(language, "accountsOff");
  if (error.code === "BAD_LOGIN") return g(language, "loginInvalid");
  if (error.code === "NOT_MOBILE") return g(language, "phoneNotMobile");
  if (error.status === 401) return g(language, "wrongLogin");
  if (error.status === 429) return g(language, "tooManyTries");
  // Never the server's own words (English, technical) to a guest.
  return g(language, "accountFailed");
}

function SignInForm({ language, account, restaurantName, signupPoints }: { language: Language; account: CustomerAccount; restaurantName: string; signupPoints: number }) {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registering = mode === "register";
  const mismatch = registering && repeat.length > 0 && password !== repeat;
  // An email or a mobile number: the server says which, and what is wrong with it.
  const ready = email.trim().length >= 3 && (registering ? password.length >= PASSWORD_MIN && password === repeat : password.length > 0);

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
    {/* What signing up brings. */}
    {signupPoints > 0 ? <p className="signup-bonus" id="signupBonusHint">{g(language, "signupBonusHint", { n: signupPoints })}</p> : null}
    <div className="segmented" role="tablist">
      <button type="button" role="tab" aria-selected={!registering} className={!registering ? "on" : ""} onClick={() => setMode("sign-in")}>{g(language, "signIn")}</button>
      <button type="button" role="tab" aria-selected={registering} className={registering ? "on" : ""} onClick={() => setMode("register")}>{g(language, "register")}</button>
    </div>
    <label>{g(language, "login")}<input name="email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="0660 1234567 / name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    {registering && <label>{g(language, "name")}<input name="name" autoComplete="nickname" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>}
    <label>{g(language, "password")}{registering && <small> · {g(language, "passwordHint")}</small>}
      <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
    </label>
    {registering && <label>{g(language, "passwordRepeat")}<input name="password-repeat" type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} required /></label>}
    {mismatch && <p className="cart-error">{g(language, "passwordMismatch")}</p>}
    {error && <p className="cart-error" role="alert">{error}</p>}
    <button type="submit" className="primary" disabled={!ready || busy}>{busy ? "…" : g(language, registering ? "register" : "signIn")}</button>
    {!registering && <p className="cart-hint">{g(language, "forgot")}</p>}
    {registering && <p className="cart-hint">{g(language, "registerConsent", { privacy: g(language, "privacy") })}</p>}
    {registering && <PrivacyNotice language={language} restaurantName={restaurantName} />}
  </form>;
}

function SignedIn({ state, dispatch, products, account, loyalty, birthdayPerk, ordering, restaurantName }: Props) {
  const language = state.language;
  const customer = account.customer!;
  const byId = new Map(products.map((product) => [product.id, product]));
  const rewards = (loyalty?.rewards ?? []).flatMap((reward) => {
    const product = byId.get(reward.productId);
    return product ? [{ product, points: reward.points }] : [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const history = useQuery({ queryKey: ["customer-points", customer.id, customer.points], enabled: showHistory, queryFn: () => restaurantApi.customerPoints() });
  const [showTopUps, setShowTopUps] = useState(false);
  const topUps = useQuery({ queryKey: ["customer-balance", customer.id, customer.balanceCents], enabled: showTopUps, queryFn: () => restaurantApi.customerBalance() });
  const [saved, setSaved] = useState<ApiBirthday | null>(customer.membership?.birthday ?? null);
  const [bMonth, setBMonth] = useState(saved?.month ?? 0);
  const [bDay, setBDay] = useState(saved?.day ?? 0);
  async function saveBirthday() {
    if (!bMonth || !bDay) return;
    try {
      const { birthday } = await restaurantApi.setCustomerBirthday(bMonth, bDay);
      setSaved(birthday);
      dispatch({ type: "toast", message: g(language, "birthdaySaved") });
    } catch (error) {
      dispatch({ type: "toast", message: error instanceof ApiError ? error.message : g(language, "birthdaySaved") });
    }
  }
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB");

  function redeem(product: Product, points: number) {
    dispatch({ type: "add-to-cart", productId: product.id, quantity: 1, modifiers: [], reward: true });
    dispatch({ type: "toast", message: g(language, "rewardAdded", { name: productName(product, language), points }) });
    dispatch({ type: "sheet", sheet: "cart" });
  }

  return <div className="guest-account">
    {account.signupBonus > 0 && <p className="signup-bonus" id="signupBonusGot" role="status">{g(language, "signupBonusGot", { n: account.signupBonus })}</p>}
    <div className="guest-card">
      <div>
        <strong>{g(language, "welcome", { name: customer.name || customer.email.split("@")[0] || customer.email })}</strong>
        <small>{customer.email}</small>
        {customer.membership?.tier && <small className="member-tier">{g(language, "myTier")}: {customer.membership.tier}{customer.membership.discountPercent > 0 ? ` · ${g(language, "memberPriceOff", { percent: customer.membership.discountPercent })}` : ""}</small>}
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
        <span>{pointsReason(language, entry.reason, entry.kind)}{entry.note ? ` · ${entry.note}` : ""}<small>{dateOf(entry.createdAt)}</small></span>
        <b className={entry.delta > 0 ? "plus" : "minus"}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</b>
      </li>)}</ul>}
    </section>}

    {(customer.balanceCents ?? 0) > 0 && <section className="guest-section">
      <h3>{g(language, "myBalance")}</h3>
      <div className="points-balance" aria-label={g(language, "myBalance")}><b>{formatPrice(customer.balanceCents ?? 0, language)}</b></div>
      <p className="cart-hint">{g(language, "topUpAtCounter")}</p>
      <button type="button" className="link-button" onClick={() => setShowTopUps(!showTopUps)}>{g(language, "topUpHistory")} {showTopUps ? "▴" : "▾"}</button>
      {showTopUps && <ul className="points-history">
        {(topUps.data?.entries ?? []).map((entry) => <li key={entry.id}>
          <span>{balanceReason(language, entry.reason)}{entry.note ? ` · ${entry.note}` : ""}<small>{dateOf(entry.createdAt)}</small></span>
          <b className={entry.deltaCents > 0 ? "plus" : "minus"}>{entry.deltaCents > 0 ? `+${formatPrice(entry.deltaCents, language)}` : formatPrice(entry.deltaCents, language)}</b>
        </li>)}
        {topUps.data && topUps.data.entries.length === 0 && <li className="cart-hint">{g(language, "noTopUps")}</li>}
      </ul>}
    </section>}

    {birthdayPerk && <section className="guest-section">
      <h3>{g(language, "myBirthday")}</h3>
      {customer.membership?.birthdayMonth
        ? <p className="cart-hint">{g(language, "birthdayMonthNote", { percent: birthdayPerk.discountPercent })}</p>
        : <p className="cart-hint">{g(language, "birthdayHint", { percent: birthdayPerk.discountPercent })}</p>}
      {birthdayPerk.email && <p className="cart-hint">{g(language, "birthdayEmailNote")}</p>}
      <div className="birthday-fields">
        <label><span>{g(language, "birthMonth")}</span>
          <select value={bMonth} onChange={(event) => setBMonth(Number(event.target.value))}>
            <option value={0}>—</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
        <label><span>{g(language, "birthDay")}</span>
          <select value={bDay} onChange={(event) => setBDay(Number(event.target.value))}>
            <option value={0}>—</option>
            {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" disabled={!bMonth || !bDay || (saved?.month === bMonth && saved?.day === bDay)} onClick={() => void saveBirthday()}>{g(language, "birthdaySave")}</button>
      </div>
    </section>}

    <div className="guest-actions">
      <button type="button" className="secondary" onClick={() => dispatch({ type: "sheet", sheet: "orders" })}>{g(language, "myOrders")}</button>
      <button type="button" className="secondary" onClick={() => void account.signOut()}>{g(language, "signOut")}</button>
    </div>

    <ProfileForm language={language} account={account} dispatch={dispatch} />
    <div className="guest-privacy">
      <button type="button" className="link-button" onClick={() => void downloadMyData(language, dispatch)}>⬇ {g(language, "downloadData")}</button>
      <PrivacyNotice language={language} restaurantName={restaurantName} />
    </div>
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
