import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiBirthday, ApiMenuSettings } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { memberTierVisual } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import { balanceReason, g, pointsReason, tierRank } from "../../app/guest-i18n";
import { formatPrice, productName, t } from "../../app/i18n";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import type { OrderingState } from "../../app/ordering";
import { Sheet } from "../../components/Sheet";
import { COUNTRY_DIAL_CODES, validateEmailOnly, validateMobileOnly } from "../../app/contactInput";
import { useElderMode } from "../../app/useElderMode";
import type { CustomerAccount } from "./useCustomer";
import { MemberBadge } from "./MemberBadge";
import { useTierEntry } from "./useTierEntry";

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

const PASSWORD_MIN = 8;

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
  if (error.code === "BAD_EMAIL") return g(language, "emailInvalid");
  if (error.code === "BAD_PHONE") return g(language, "phoneInvalid");
  if (error.code === "CONTACT_REQUIRED") return g(language, "contactRequired");
  if (error.code === "NOT_MOBILE") return g(language, "phoneNotMobile");
  if (error.status === 401) return g(language, "wrongLogin");
  if (error.status === 429) return g(language, "tooManyTries");
  // Never the server's own words (English, technical) to a guest.
  return g(language, "accountFailed");
}

function splitDialCode(phone: string): { dialCode: string; local: string } {
  const clean = phone.trim();
  if (!clean.startsWith("+")) return { dialCode: "43", local: clean };
  const digits = clean.slice(1);
  const sorted = [...COUNTRY_DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
  const match = sorted.find((entry) => digits.startsWith(entry.code));
  if (match) return { dialCode: match.code, local: digits.slice(match.code.length) };
  return { dialCode: "43", local: clean };
}

function validateSeparatedContacts(
  language: Language,
  phoneRaw: string,
  dialCode: string,
  emailRaw: string
): { ok: true; phone: string; email: string } | { ok: false; error: string } {
  const hasPhone = phoneRaw.trim().length > 0;
  const hasEmail = emailRaw.trim().length > 0;
  if (!hasPhone && !hasEmail) return { ok: false, error: g(language, "contactRequired") };
  let phone = "";
  if (hasPhone) {
    const mobile = validateMobileOnly(phoneRaw, dialCode);
    if (!mobile.ok) {
      return { ok: false, error: g(language, mobile.reason === "NOT_MOBILE" ? "phoneNotMobile" : "phoneInvalid") };
    }
    phone = mobile.e164;
  }
  let email = "";
  if (hasEmail) {
    const mail = validateEmailOnly(emailRaw);
    if (!mail.ok) return { ok: false, error: g(language, "emailInvalid") };
    email = mail.value;
  }
  return { ok: true, phone, email };
}

function ContactFields({
  language,
  dialCode,
  phone,
  email,
  onDialCode,
  onPhone,
  onEmail,
  emailAutoComplete = "email"
}: {
  language: Language;
  dialCode: string;
  phone: string;
  email: string;
  onDialCode: (next: string) => void;
  onPhone: (next: string) => void;
  onEmail: (next: string) => void;
  emailAutoComplete?: string;
}) {
  return <>
    <p className="cart-hint">{g(language, "contactEitherHint")}</p>
    <label>{g(language, "phone")}
      <div className="phone-input-group">
        <select className="dial-code-select" aria-label={g(language, "dialCode")} value={dialCode} onChange={(event) => onDialCode(event.target.value)}>
          {COUNTRY_DIAL_CODES.map((entry) => <option key={entry.code} value={entry.code}>{entry.flag} {entry.label}</option>)}
        </select>
        <input name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="0660 1234567" value={phone} onChange={(event) => onPhone(event.target.value)} />
      </div>
    </label>
    <label>{g(language, "email")}
      <input name="email" type="email" autoComplete={emailAutoComplete} autoCapitalize="none" spellCheck={false} placeholder="name@example.com" value={email} onChange={(event) => onEmail(event.target.value)} />
    </label>
  </>;
}

function SignInForm({ language, account, restaurantName, signupPoints }: { language: Language; account: CustomerAccount; restaurantName: string; signupPoints: number }) {
  const [elder, toggleElder] = useElderMode();
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [dialCode, setDialCode] = useState("43");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const registering = mode === "register";
  const tooShort = registering && password.length > 0 && password.length < PASSWORD_MIN;
  const mismatch = registering && repeat.length > 0 && password !== repeat;
  const ready = (phone.trim().length > 0 || email.trim().length > 0) && password.length > 0 && (!registering || repeat.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const contacts = validateSeparatedContacts(language, phone, dialCode, email);
    if (!contacts.ok) {
      setError(contacts.error);
      return;
    }
    if (registering && password.length < PASSWORD_MIN) {
      setError(g(language, "passwordTooShort", { n: PASSWORD_MIN }));
      return;
    }
    if (registering && password !== repeat) {
      setError(g(language, "passwordMismatch"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const loginPayload = {
        ...(contacts.phone ? { phone: contacts.phone } : {}),
        ...(contacts.email ? { email: contacts.email } : {})
      };
      if (registering) await account.register({ ...loginPayload, password, ...(name.trim() ? { name: name.trim() } : {}) });
      else await account.signIn(loginPayload, password);
    } catch (failure) {
      setError(message(language, failure));
    } finally {
      setBusy(false);
    }
  }

  return <form className="guest-form" onSubmit={submit}>
    <div className="sheet-mode-row">
      <button type="button" className={`elder-pill ${elder ? "on" : ""}`} aria-pressed={elder} onClick={toggleElder}>
        {elder ? `Aa · ${g(language, "standardMode")}` : `Aa · ${g(language, "elderMode")}`}
      </button>
    </div>
    <p className="sheet-lead">{g(language, "signInLead")}</p>
    {/* What signing up brings. */}
    {signupPoints > 0 ? <p className="signup-bonus" id="signupBonusHint">{g(language, "signupBonusHint", { n: signupPoints })}</p> : null}
    <div className="segmented" role="tablist">
      <button type="button" role="tab" aria-selected={!registering} className={!registering ? "on" : ""} onClick={() => { setMode("sign-in"); setError(""); }}>{g(language, "signIn")}</button>
      <button type="button" role="tab" aria-selected={registering} className={registering ? "on" : ""} onClick={() => { setMode("register"); setError(""); }}>{g(language, "register")}</button>
    </div>
    <ContactFields
      language={language}
      dialCode={dialCode}
      phone={phone}
      email={email}
      onDialCode={(next) => { setDialCode(next); if (error) setError(""); }}
      onPhone={(next) => { setPhone(next); if (error) setError(""); }}
      onEmail={(next) => { setEmail(next); if (error) setError(""); }}
      emailAutoComplete={registering ? "email" : "username"}
    />
    {registering && !elder && <label>{g(language, "name")}<input name="name" autoComplete="nickname" maxLength={40} value={name} onChange={(event) => setName(event.target.value)} /></label>}
    <label>{g(language, "password")}{registering && <small> · {g(language, "passwordHint")}</small>}
      <div className="password-input-wrap">
        <input name="password" type={showPassword ? "text" : "password"} autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }} required />
        <button type="button" className="password-toggle" aria-pressed={showPassword} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((on) => !on)}>{showPassword ? "🙈" : "👁"}</button>
      </div>
    </label>
    {registering && <label>{g(language, "passwordRepeat")}<input name="password-repeat" type={showPassword ? "text" : "password"} autoComplete="new-password" value={repeat} onChange={(event) => { setRepeat(event.target.value); if (error) setError(""); }} required /></label>}
    {tooShort && <p className="cart-error">{g(language, "passwordTooShort", { n: PASSWORD_MIN })}</p>}
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
  const [elder, toggleElder] = useElderMode();
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

  const [showQr, setShowQr] = useState(() => elder);
  const [qrSrc, setQrSrc] = useState("");
  useEffect(() => {
    if (elder) setShowQr(true);
  }, [elder]);
  useEffect(() => {
    setQrSrc("");
    if (!showQr) return;
    let current = true;
    void import("qrcode").then(({ default: QRCode }) =>
      QRCode.toString(`ZYMEM:${customer.id}`, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } })
    ).then((svg) => {
      if (current) setQrSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }).catch(() => {});
    return () => { current = false; };
  }, [showQr, customer.id]);

  const tierLevel = customer.membership?.tierLevel ?? 0;
  const visual = memberTierVisual(tierLevel);
  const { entering, muted, toggleMuted } = useTierEntry(visual?.theme ?? null);
  const realEmail = customer.email.includes("@") ? customer.email : "";
  const phoneNumber = customer.phone || (!customer.email.includes("@") ? customer.email : "");
  const displayName = customer.name || (realEmail ? realEmail.split("@")[0] : phoneNumber) || customer.email;

  return <div
    className={`guest-account${visual ? " member-themed" : ""}${visual?.skin ? ` tier-skin-${visual.skin}` : ""}${entering ? " tier-entering" : ""}`}
    data-tier-theme={visual?.theme}
  >
    <div className="sheet-mode-row">
      <button type="button" className={`elder-pill ${elder ? "on" : ""}`} aria-pressed={elder} onClick={toggleElder}>
        {elder ? `Aa · ${g(language, "standardMode")}` : `Aa · ${g(language, "elderMode")}`}
      </button>
    </div>
    <div className={`guest-card member-hero${visual ? " member-crest" : ""}`} data-tier-theme={visual?.theme}>
      <div className="member-hero-top">
        {visual && <div className="member-crest-art">
          <MemberBadge level={tierLevel} rank={tierRank(language, visual.theme)} size="md" animate={entering} initial={displayName} />
        </div>}
        <div className="member-hero-identity">
          {visual && <span className="member-crest-rank">{tierRank(language, visual.theme)} · {customer.membership?.tier}</span>}
          <strong className={visual ? "member-hero-greeting" : ""}>{g(language, "welcome", { name: displayName })}</strong>
          {phoneNumber && <small>📱 {phoneNumber}</small>}
          {realEmail && <small>✉ {realEmail}</small>}
          <span className="member-crest-meta">
            {customer.membership && customer.membership.discountPercent > 0 && <em>{g(language, "memberPriceOff", { percent: customer.membership.discountPercent })}</em>}
            {!visual && customer.membership?.tier && <small>{customer.membership.tier}</small>}
            {visual && <small>{g(language, "memberGrowth", { amount: formatPrice(customer.membership?.growthCents ?? 0, language) })}</small>}
          </span>
          {visual?.skin && <span className="member-crest-skin">{g(language, visual.skin === "gilded" ? "exclusiveGilded" : "exclusiveDark")}</span>}
        </div>
        {visual && <button type="button" className="member-mute member-mute-icon" onClick={toggleMuted} aria-pressed={!muted} aria-label={g(language, muted ? "soundOff" : "soundOn")} title={g(language, muted ? "soundOff" : "soundOn")}>
          {muted ? "🔕" : "🔔"}
        </button>}
      </div>
      <div className="member-hero-metrics">
        {loyalty && <div className="points-balance" aria-label={g(language, "points")}><b>{customer.points}</b><small>{g(language, "points")}</small></div>}
        {(customer.balanceCents ?? 0) > 0 && <div className="member-metric" aria-label={g(language, "myBalance")}><b>{formatPrice(customer.balanceCents ?? 0, language)}</b><small>{g(language, "myBalance")}</small></div>}
        <button type="button" className="secondary member-qr-toggle" id="accountShowQr" aria-expanded={showQr} onClick={() => setShowQr((v) => !v)}>
          {g(language, showQr ? "hideMemberCode" : "showMemberCode")}
        </button>
      </div>
      {showQr && qrSrc && <div className="member-qr-box">
        <div className="member-qr-tile"><img src={qrSrc} alt={g(language, "memberQrAlt")} width="132" height="132" /></div>
        <div className="member-qr-info">
          <strong>{displayName}</strong>
          {customer.membership?.tier && <span className="member-qr-tier">{customer.membership.tier}</span>}
          <small>{g(language, "memberQrHint")}</small>
        </div>
      </div>}
    </div>
    {account.signupBonus > 0 && <p className="signup-bonus" id="signupBonusGot" role="status">{g(language, "signupBonusGot", { n: account.signupBonus })}</p>}

    {loyalty && <section className="guest-section">
      <h3>{g(language, "rewards")}</h3>
      <p className="cart-hint">{g(language, "pointsLead", { n: loyalty.pointsPerEuro, e: loyalty.eurosPerPoint ?? 1 })}{loyalty.topUpPoints ? ` · ${g(language, "pointsTopUp")}` : ""}</p>
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

    <div className="guest-actions">
      <button type="button" className="secondary" onClick={() => dispatch({ type: "sheet", sheet: "orders" })}>{g(language, "myOrders")}</button>
      <button type="button" className="secondary" onClick={() => void account.signOut()}>{g(language, "signOut")}</button>
    </div>

    {!elder && <details className="guest-preferences">
      <summary>
        <span>{g(language, "preferences")}</span>
        {saved && birthdayPerk && <small>🎂 {saved.month}/{saved.day}</small>}
      </summary>
      <div className="guest-preferences-body">
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
            <button type="button" className="primary birthday-save" disabled={!bMonth || !bDay || (saved?.month === bMonth && saved?.day === bDay)} onClick={() => void saveBirthday()}>{g(language, "birthdaySave")}</button>
          </div>
        </section>}

        <MarketingToggle language={language} dispatch={dispatch} />
        <ProfileForm language={language} account={account} dispatch={dispatch} />
      </div>
    </details>}
    <div className="guest-privacy">
      <button type="button" className="link-button" onClick={() => void downloadMyData(language, dispatch)}>⬇ {g(language, "downloadData")}</button>
      <PrivacyNotice language={language} restaurantName={restaurantName} />
    </div>
  </div>;
}

/**
 * 会员营销授权 (GDPR opt-in): the member's own switch for marketing email.
 * Off until the member turns it on; a broadcast never reaches anyone who has
 * not. Reads the current state on open, writes on toggle.
 */
function MarketingToggle({ language, dispatch }: { language: CustomerState["language"]; dispatch: CustomerDispatch }) {
  const consent = useQuery({ queryKey: ["customer-marketing"], queryFn: () => restaurantApi.customerMarketing() });
  const [busy, setBusy] = useState(false);
  const enabled = consent.data?.marketing ?? false;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await restaurantApi.setCustomerMarketing(next);
      await consent.refetch();
      dispatch({ type: "toast", message: g(language, "marketingSaved") });
    } catch (failure) {
      dispatch({ type: "toast", message: failure instanceof ApiError ? failure.message : g(language, "marketingSaved") });
    } finally {
      setBusy(false);
    }
  }

  return <section className="guest-section">
    <h3>{g(language, "marketingTitle")}</h3>
    <p className="cart-hint">{g(language, "marketingHint")}</p>
    <label className="marketing-opt">
      <input type="checkbox" checked={enabled} disabled={busy || consent.isLoading} onChange={(event) => void toggle(event.target.checked)} />
      <span>{g(language, "marketingLabel")}</span>
    </label>
  </section>;
}

function ProfileForm({ language, account, dispatch }: { language: CustomerState["language"]; account: CustomerAccount; dispatch: CustomerDispatch }) {
  const customer = account.customer;
  const savedPhone = customer ? (customer.phone || (!customer.email.includes("@") ? customer.email : "")) : "";
  const savedEmail = customer && customer.email.includes("@") ? customer.email : "";
  const initialPhone = splitDialCode(savedPhone);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customer?.name ?? "");
  const [dialCode, setDialCode] = useState(initialPhone.dialCode);
  const [phone, setPhone] = useState(initialPhone.local);
  const [email, setEmail] = useState(savedEmail);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openEditor() {
    const parsed = splitDialCode(savedPhone);
    setName(customer?.name ?? "");
    setDialCode(parsed.dialCode);
    setPhone(parsed.local);
    setEmail(savedEmail);
    setError("");
    setOpen(true);
  }

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

  if (!open) return <button type="button" className="link-button" onClick={openEditor}>{g(language, "profile")} ▾</button>;
  return <form className="guest-form profile" onSubmit={(event) => {
    event.preventDefault();
    if (deleting) {
      void run(() => account.remove(current), g(language, "deleted"));
      return;
    }
    const contacts = validateSeparatedContacts(language, phone, dialCode, email);
    if (!contacts.ok) {
      setError(contacts.error);
      return;
    }
    void run(() => account.update({
      currentPassword: current,
      name: name.trim(),
      phone: contacts.phone,
      email: contacts.email,
      ...(next ? { password: next } : {})
    }), g(language, "saved"));
  }}>
    <h3>{g(language, "profile")}</h3>
    {!deleting && <ContactFields
      language={language}
      dialCode={dialCode}
      phone={phone}
      email={email}
      onDialCode={(val) => { setDialCode(val); if (error) setError(""); }}
      onPhone={(val) => { setPhone(val); if (error) setError(""); }}
      onEmail={(val) => { setEmail(val); if (error) setError(""); }}
    />}
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
