import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ApiBookingInfo, ApiCustomer, ApiGuestReservation, ApiReservationSlot, ApiTableChoice } from "@zhaoyun/contracts";
import { ApiError, RestaurantApi } from "@zhaoyun/api-client";
import { apiBaseUrl, customerToken, setCustomerToken } from "../app/api";
import { useColorScheme } from "../app/useColorScheme";
import { b, bookingError, formatDay, initialLanguage, rememberLanguage } from "./booking-i18n";
import type { BookingErrorKey, BookingLanguage } from "./booking-i18n";
import { checkMobile } from "../../../../shared/phone.mjs";

// The guest's session is the menu's own (the same account, the same phone).
const api = new RestaurantApi({ baseUrl: apiBaseUrl, headers: () => ({ "x-customer-token": customerToken() }) });

/** A booking this phone holds: its id and the token that opens it. */
interface Held { id: string; token: string }

const HELD_KEY = "zy_booking";
const LANGUAGES: Array<[BookingLanguage, string]> = [["de", "Deutsch"], ["en", "English"], ["zh", "中文"]];

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

/** The booking in this page's link: `?r=<id>#t=<token>`. The token rides in the fragment, which never reaches a server. */
function heldFromLink(): Held | null {
  const id = new URLSearchParams(location.search).get("r");
  const token = new URLSearchParams(location.hash.slice(1)).get("t");
  return id && token ? { id, token } : null;
}
function heldOnPhone(): Held | null {
  try {
    const held = JSON.parse(localStorage.getItem(HELD_KEY) || "null") as Held | null;
    return held?.id && held.token ? held : null;
  } catch {
    return null;
  }
}
function remember(held: Held | null): void {
  try {
    if (held) localStorage.setItem(HELD_KEY, JSON.stringify(held));
    else localStorage.removeItem(HELD_KEY);
  } catch { /* Private tab: the link on screen is what the guest keeps. */ }
}
function linkFor(held: Held): string {
  return `${location.origin}${location.pathname}?r=${encodeURIComponent(held.id)}#t=${encodeURIComponent(held.token)}`;
}

function refusal(language: BookingLanguage, error: unknown, info: ApiBookingInfo | null = null): string {
  if (error instanceof ApiError) {
    if (error.status === 429 && error.code !== "NO_SHOW_BLOCKED" && error.code !== "CODE_TOO_SOON" && error.code !== "TOO_MANY_CODES") return bookingError(language, "RATE");
    const known: BookingErrorKey[] = ["SLOT_FULL", "SLOT_UNAVAILABLE", "PARTY_TOO_LARGE", "RESERVATIONS_OFF", "INVALID", "TABLE_TAKEN", "TABLE_REQUIRED", "TABLE_TOO_SMALL", "SIGN_IN_REQUIRED", "NO_SHOW_BLOCKED", "DAY_LIMIT", "TOO_MANY_BOOKINGS",
      "EMAIL_UNVERIFIED", "BAD_PHONE", "NOT_MOBILE", "WRONG_CODE", "CODE_EXPIRED", "CODE_TOO_SOON", "TOO_MANY_CODES", "MAIL_FAILED", "NOT_ENOUGH_POINTS", "CONTACT_REQUIRED"];
    const limit = error.code === "DAY_LIMIT" ? info?.maxPerDayPerGuest : info?.maxActivePerGuest;
    const details = (error.details ?? {}) as { attemptsLeft?: number; retryAfter?: number; minPoints?: number; points?: number };
    if (error.code && (known as string[]).includes(error.code)) return bookingError(language, error.code as BookingErrorKey, { message: error.message, limit: limit ?? "", left: details.attemptsLeft ?? "", s: details.retryAfter ?? "", min: details.minPoints ?? info?.minPoints ?? "", points: details.points ?? "" });
    return bookingError(language, "INVALID", { message: error.message });
  }
  return bookingError(language, "OFFLINE");
}

/**
 * The guest's booking page (/book): how many, which day, which time, who —
 * and afterwards their booking, which the link they keep opens again.
 */
export function BookingPage() {
  const [language, setLanguage] = useState<BookingLanguage>(initialLanguage);
  const [info, setInfo] = useState<ApiBookingInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [held, setHeld] = useState<Held | null>(() => heldFromLink());
  const [booking, setBooking] = useState<ApiGuestReservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  // The signed-in guest: booking needs one (against fake bookings), and their bookings are listed.
  const [customer, setCustomer] = useState<ApiCustomer | null>(null);
  const [mine, setMine] = useState<ApiGuestReservation[]>([]);
  // Light or dark, as on the menu (the same choice, kept on this phone).
  const [scheme, toggleScheme] = useColorScheme(undefined);
  // The guest's other bookings and their account open over the page from the dock.
  const [sheet, setSheet] = useState<"bookings" | "account" | null>(null);

  const loadMine = useCallback(async () => {
    if (!customerToken()) return;
    try {
      setMine((await api.myReservations()).reservations);
    } catch { /* The list is a convenience; the form still works. */ }
  }, []);

  useEffect(() => {
    if (!customerToken()) return;
    api.customer().then(({ customer: signedIn }) => {
      setCustomer(signedIn);
      void loadMine();
    }).catch((error: unknown) => {
      // An expired session is no session.
      if (error instanceof ApiError && error.status === 401) setCustomer(null);
    });
  }, [loadMine]);

  const signedIn = (session: { token: string; customer: ApiCustomer }) => {
    setCustomerToken(session.token);
    setCustomer(session.customer);
    void loadMine();
  };
  const signOut = async () => {
    try { await api.signOutCustomer(); } catch { /* Gone from this phone either way. */ }
    setCustomerToken(null);
    setCustomer(null);
    setMine([]);
  };

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      setInfo((await api.bookingInfo()).booking);
    } catch {
      setLoadFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // A booking opened by its link, or the one this phone made last.
  useEffect(() => {
    const opening = held ?? heldOnPhone();
    if (!opening) return;
    let cancelled = false;
    api.reservation(opening.id, opening.token).then(({ reservation }) => {
      if (cancelled) return;
      setHeld(opening);
      setBooking(reservation);
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (error instanceof ApiError && error.status === 404) {
        if (held) setNotFound(true);
        else remember(null);
      }
    });
    return () => { cancelled = true; };
  // Once, for whatever the page opened with.
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    document.title = info?.restaurantName ? `${b(language, "title")} · ${info.restaurantName}` : b(language, "title");
  }, [language, info]);

  const chooseLanguage = (next: BookingLanguage) => {
    setLanguage(next);
    rememberLanguage(next);
  };

  const booked = (reservation: ApiGuestReservation, token: string) => {
    const next = { id: reservation.id, token };
    remember(next);
    setHeld(next);
    setBooking({ ...reservation, cancellable: true });
    history.replaceState(null, "", linkFor(next));
    window.scrollTo({ top: 0 });
    void loadMine();
  };

  const startOver = () => {
    setBooking(null);
    setNotFound(false);
    history.replaceState(null, "", location.pathname);
  };

  const others = mine.filter((entry) => !(booking && held && entry.id === booking.id));
  // The name and number of the guest's latest booking, to start the next one from.
  const latest = mine.find((entry) => entry.phone);
  const recent = useMemo(() => (latest ? { name: latest.name, phone: latest.phone } : null), [latest?.name, latest?.phone]);

  return <main className="bk-page">
    <header className="bk-head">
      <div>
        <p className="bk-eyebrow">{info?.restaurantName ?? ""}</p>
        <h1>{booking ? b(language, "myBooking") : b(language, "title")}</h1>
      </div>
      <div className="bk-tools">
        <select className="bk-language" id="bookingLanguage" aria-label="Language" value={language} onChange={(event) => chooseLanguage(event.target.value as BookingLanguage)}>
          {LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <button type="button" className="bk-theme" id="bookingTheme" aria-label={b(language, scheme === "dark" ? "themeLight" : "themeDark")} title={b(language, scheme === "dark" ? "themeLight" : "themeDark")} onClick={toggleScheme}>
          <span aria-hidden="true">{scheme === "dark" ? "☀" : "☾"}</span>
        </button>
      </div>
    </header>

    {notFound && !booking ? <section className="bk-card bk-message" id="bookingNotFound">
      <p>{b(language, "notFound")}</p>
      <button type="button" className="bk-secondary" onClick={startOver}>{b(language, "another")}</button>
    </section> : null}

    {booking && held
      ? <BookingDetails language={language} booking={booking} held={held} info={info} onChange={(next) => { setBooking(next); void loadMine(); }} onAnother={startOver} />
      : loadFailed
        ? <section className="bk-card bk-message"><p>{b(language, "failedLoad")}</p><button type="button" className="bk-secondary" onClick={() => void load()}>{b(language, "retry")}</button></section>
        : !info
          ? <p className="bk-muted">{b(language, "loading")}</p>
          : !info.enabled
            ? <section className="bk-card bk-message" id="bookingOff"><p>{b(language, "off")}</p></section>
            : <>
              {/* Short of the points, said first: no picking a time that cannot be booked yet. */}
              {customer && shortOfPoints(info, customer) ? <MemberCard language={language} info={info} customer={customer} onRefreshed={setCustomer} /> : null}
              <BookingForm language={language} info={info} customer={customer} recent={recent} onSignedIn={signedIn} onVerified={setCustomer} onBooked={booked} />
            </>}

    {/* The guest's other bookings and their account: one tap each, from the corner. */}
    <nav className="bk-dock" aria-label={b(language, "account")}>
      <button type="button" id="bookingDockBookings" aria-haspopup="dialog" onClick={() => setSheet("bookings")}>
        <span aria-hidden="true">📅</span>{b(language, "myBookings")}{customer && others.length ? <b className="bk-dock-count">{others.length}</b> : null}
      </button>
      <button type="button" id="bookingDockAccount" aria-haspopup="dialog" onClick={() => setSheet("account")}>
        <span aria-hidden="true">👤</span>{b(language, "account")}
      </button>
    </nav>
    {sheet ? <BookingSheet language={language} title={b(language, sheet === "bookings" ? "myBookings" : "account")} onClose={() => setSheet(null)}>
      {!customer
        ? <p className="bk-muted" id="bookingSignInToSee">{b(language, "signInToSee")}</p>
        : sheet === "bookings"
          // The booking open on the page is not listed a second time.
          ? others.length ? <MyBookings language={language} bookings={others} info={info} onChange={() => void loadMine()} /> : <p className="bk-muted">{b(language, "noBookings")}</p>
          : <AccountPanel language={language} info={info} customer={customer} onRefreshed={setCustomer} onSignOut={() => { setSheet(null); void signOut(); }} />}
    </BookingSheet> : null}
  </main>;
}

/** A panel over the page, from the bottom: the guest's bookings or account. Escape or the scrim closes it. */
function BookingSheet({ language, title, onClose, children }: { language: BookingLanguage; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="bk-sheet" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="bk-sheet-panel" role="dialog" aria-modal="true" aria-label={title} id="bookingSheet">
      <header><h2>{title}</h2><button type="button" className="bk-sheet-close" aria-label={b(language, "close")} onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>;
}

/** The guest's account: who, how many points, the rule, the member code behind a tap, and signing out. */
function AccountPanel({ language, info, customer, onRefreshed, onSignOut }: {
  language: BookingLanguage; info: ApiBookingInfo | null; customer: ApiCustomer; onRefreshed: (customer: ApiCustomer) => void; onSignOut: () => void;
}) {
  useEffect(() => {
    // Opened to see the points: the latest, after a visit at the counter.
    api.customer().then(({ customer: fresh }) => onRefreshed(fresh)).catch(() => { /* What is on screen stays. */ });
  }, []);
  return <div className="bk-account-panel" id="bookingAccount">
    <p className="bk-account-email">{customer.email}</p>
    <p className="bk-account-points"><b id="bookingPoints">{b(language, "pointsBalance", { points: customer.points })}</b></p>
    {info?.minPoints ? <p className="bk-muted" id="bookingMemberRule">{b(language, "memberRule", { min: info.minPoints, welcome: info.welcomePoints ?? 0, noShow: info.noShowPoints ?? 0 })}</p> : null}
    <MemberCode language={language} customer={customer} id="accountMemberQr" />
    <button type="button" className="bk-secondary" id="bookingSignOut" onClick={onSignOut}>{b(language, "signOut")}</button>
  </div>;
}

/** The guest's member code (ZYMEM: and their account), shown on a tap, for the waiter to scan when they pay. */
function MemberCode({ language, customer, id }: { language: BookingLanguage; customer: ApiCustomer; id: string }) {
  const [shown, setShown] = useState(false);
  const qr = useQr(shown ? `ZYMEM:${customer.id}` : "");
  return <>
    <button type="button" className="bk-secondary" id={`${id}Toggle`} aria-expanded={shown} onClick={() => setShown((value) => !value)}>
      {b(language, shown ? "hideMemberCode" : "showMemberCode")}
    </button>
    {shown && qr ? <span className="bk-member-code"><img id={id} src={qr} alt={b(language, "memberQrAlt")} width="220" height="220" /></span> : null}
  </>;
}

/** The signed-in guest's own bookings, each cancellable while it still may be. */
function MyBookings({ language, bookings, info, onChange }: { language: BookingLanguage; bookings: ApiGuestReservation[]; info: ApiBookingInfo | null; onChange: () => void }) {
  const [error, setError] = useState("");
  async function cancel(booking: ApiGuestReservation) {
    if (!window.confirm(b(language, "cancelConfirm"))) return;
    setError("");
    try {
      await api.cancelReservation(booking.id, "");
      onChange();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.code === "TOO_LATE" ? b(language, "cannotCancel") : refusal(language, failure, info));
    }
  }
  return <section className="bk-card" id="myBookings">
    <h2>{b(language, "myBookings")}</h2>
    {error ? <p className="bk-error" role="alert">{error}</p> : null}
    <ul className="bk-mine">{bookings.map((booking) => <li key={booking.id} data-reference={booking.reference} data-status={booking.status}>
      <span>
        <strong>{formatDay(language, booking.date)} · {booking.time}</strong>
        <small>{[b(language, "partyOf", { n: booking.party }), booking.table ? b(language, "tableName", { table: booking.table }) : "", booking.reference, booking.status === "cancelled" ? b(language, "cancelled") : b(language, booking.status)].filter(Boolean).join(" · ")}</small>
      </span>
      {booking.cancellable ? <button type="button" className="bk-danger" onClick={() => void cancel(booking)}>{b(language, "cancel")}</button> : null}
    </li>)}</ul>
  </section>;
}

/**
 * Proving the account's email before the first booking: a six-digit code
 * sent to it, typed back. Once proved, it stays so for that address.
 */
function VerifyEmailCard({ language, customer, onVerified }: { language: BookingLanguage; customer: ApiCustomer; onVerified: (customer: ApiCustomer) => void }) {
  const [sentTo, setSentTo] = useState("");
  const [wait, setWait] = useState(0);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((left) => left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function send() {
    setBusy(true);
    setError("");
    try {
      const answer = await api.requestEmailCode(language);
      setSentTo(answer.sentTo);
      setWait(answer.retryAfter);
      document.getElementById("bookingEmailCode")?.focus();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "ALREADY_VERIFIED") onVerified({ ...customer, emailVerified: true });
      else {
        setError(refusal(language, failure));
        const after = failure instanceof ApiError ? Number((failure.details as { retryAfter?: number } | undefined)?.retryAfter) : 0;
        if (after > 0 && after < 3600) setWait(after);
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onVerified((await api.verifyEmail(code.replace(/\s/g, ""))).customer);
    } catch (failure) {
      setError(refusal(language, failure));
      if (failure instanceof ApiError && failure.code === "CODE_EXPIRED") setCode("");
    } finally {
      setBusy(false);
    }
  }

  return <section className="bk-card" id="bookingVerify">
    <h2>{b(language, "verifyTitle")}</h2>
    <p className="bk-muted">{sentTo ? b(language, "codeSent", { email: sentTo }) : b(language, "verifyLead", { email: customer.email })}</p>
    {sentTo ? <form className="bk-verify" onSubmit={(event) => void verify(event)}>
      <label className="bk-field"><span>{b(language, "codeLabel")}</span>
        <input id="bookingEmailCode" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9 ]/g, ""))} />
      </label>
      <button type="submit" className="bk-primary" id="bookingVerifySubmit" disabled={busy || code.replace(/\s/g, "").length !== 6}>{b(language, "verify")}</button>
    </form> : null}
    {error ? <p className="bk-error" role="alert" id="bookingVerifyError">{error}</p> : null}
    <button type="button" className="bk-secondary" id="bookingSendCode" disabled={busy || wait > 0} onClick={() => void send()}>
      {wait > 0 ? b(language, "resendIn", { s: wait }) : sentTo ? b(language, "resend") : b(language, "sendCode")}
    </button>
  </section>;
}

/** Signing in, or registering, before a booking: a booking someone has to stand behind. */
function SignInCard({ language, onSignedIn }: { language: BookingLanguage; onSignedIn: (session: { token: string; customer: ApiCustomer }) => void }) {
  const [mode, setMode] = useState<"signIn" | "register">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    setBusy(true);
    setError("");
    try {
      onSignedIn(mode === "signIn"
        ? await api.signInCustomer(email, password)
        : await api.registerCustomer({ email, password }));
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setError(b(language, "wrongLogin"));
      else if (failure instanceof ApiError && failure.code === "EMAIL_TAKEN") setError(b(language, "emailTaken"));
      else if (failure instanceof ApiError && failure.status === 429) setError(bookingError(language, "RATE"));
      else setError(refusal(language, failure));
    } finally {
      setBusy(false);
    }
  }

  return <section className="bk-card" id="bookingSignIn">
    <h2>{b(language, "signInTitle")}</h2>
    <p className="bk-muted">{b(language, "signInLead")}</p>
    <div className="bk-tabs" role="tablist">
      {(["signIn", "register"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? "active" : ""} onClick={() => { setMode(key); setError(""); }}>{b(language, key)}</button>)}
    </div>
    <form className="bk-signin" onSubmit={(event) => void submit(event)}>
      <label className="bk-field"><span>{b(language, "loginEmail")}</span><input id="bookingEmailLogin" type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="bk-field"><span>{b(language, "password")}</span><input id="bookingPassword" type="password" required minLength={mode === "register" ? 6 : 1} maxLength={200} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />{mode === "register" ? <small>{b(language, "passwordHint")}</small> : null}</label>
      {mode === "register" ? <p className="bk-privacy">{b(language, "registerConsent")}</p> : <p className="bk-privacy">{b(language, "forgot")}</p>}
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      <button type="submit" className="bk-secondary" id="bookingSignInSubmit" disabled={busy}>{b(language, mode)}</button>
    </form>
  </section>;
}

/** Party sizes offered as one tap each; a list holds the rest, where there are more. */
const PARTY_CHIPS = 8;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What is wrong with how the guest left to be reached, or "": an email (it
 * has an @) or a mobile number (the server's own check, shared/phone.mjs).
 */
function contactProblem(language: BookingLanguage, value: string): string {
  const clean = value.trim();
  if (!clean) return b(language, "contactMissing");
  if (clean.includes("@")) return EMAIL_SHAPE.test(clean) ? "" : b(language, "emailInvalid");
  const mobile = checkMobile(clean);
  return mobile.ok ? "" : b(language, mobile.reason === "NOT_MOBILE" ? "phoneNotMobile" : "phoneInvalid");
}

/** The name and mobile number (or email) a guest booked with last, kept on this phone only. */
const CONTACT_KEY = "zy_book_contact";

function rememberedContact(): { name: string; phone: string } {
  try {
    const value = JSON.parse(localStorage.getItem(CONTACT_KEY) ?? "null") as { name?: unknown; phone?: unknown } | null;
    if (value && typeof value.name === "string" && typeof value.phone === "string") return { name: value.name, phone: value.phone };
  } catch { /* A private tab, or nothing kept yet. */ }
  return { name: "", phone: "" };
}

function rememberContact(name: string, phone: string): void {
  try { localStorage.setItem(CONTACT_KEY, JSON.stringify({ name, phone })); } catch { /* Kept for this visit only. */ }
}

/**
 * The booking, quickest first: every choice is one tap — the party, the day,
 * the time, the table — and each one brings the next step up the screen. Then
 * the one card that is left: signing in, proving the email, or the name and
 * mobile number, filled in from the last booking on this phone.
 */
function BookingForm({ language, info, customer, recent, onSignedIn, onVerified, onBooked }: {
  language: BookingLanguage; info: ApiBookingInfo; customer: ApiCustomer | null;
  recent: { name: string; phone: string } | null;
  onSignedIn: (session: { token: string; customer: ApiCustomer }) => void;
  onVerified: (customer: ApiCustomer) => void;
  onBooked: (reservation: ApiGuestReservation, token: string) => void;
}) {
  const [party, setParty] = useState(Math.min(2, info.maxParty));
  const bookable = (date: string) => date >= info.today && date <= info.lastDate && info.days.includes(weekdayOf(date)) && !info.closedDates.includes(date);
  const [date, setDate] = useState(() => {
    for (let offset = 0; offset <= 60; offset += 1) {
      const day = addDays(info.today, offset);
      if (bookable(day)) return day;
    }
    return info.today;
  });
  const [slots, setSlots] = useState<ApiReservationSlot[] | null>(null);
  const [time, setTime] = useState("");
  // The guest's own table, where the restaurant lets them pick one.
  // A party larger than every table books seats; the floor puts tables together (shared/reservations.mjs, picksTable).
  const seatSelection = Boolean(info.seatSelection) && (info.tables ?? []).some((choice) => choice.seats >= party);
  const [tables, setTables] = useState<ApiTableChoice[] | null>(null);
  const [table, setTable] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  // Where mail goes out, a guest proves their email before booking (shared/email-verify.mjs).
  const mustVerify = Boolean(info.emailVerification && customer && !customer.emailVerified);
  // Booking is for members: short of the points it takes, the page shows how to get them (MemberCard) instead.
  const short = Boolean(customer && shortOfPoints(info, customer));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The step to bring up the screen once it is there.
  const [bringUp, setBringUp] = useState<string | null>(null);

  // Name and number from the last booking — on this phone, or on the account — then the account's name.
  useEffect(() => {
    const kept = rememberedContact();
    setName((current) => current || recent?.name || kept.name || customer?.name || "");
    setPhone((current) => current || recent?.phone || kept.phone || customer?.email || "");
  }, [customer, recent]);

  useEffect(() => {
    if (!bringUp) return;
    const element = document.getElementById(bringUp);
    if (!element) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    setBringUp(null);
  }, [bringUp, slots, tables]);

  const loadSlots = useCallback(async () => {
    setSlots(null);
    try {
      const answer = await api.availability(date, party);
      setSlots(answer.slots);
      setTime((current) => (answer.slots.some((slot) => slot.time === current && slot.available) ? current : ""));
    } catch (failure) {
      setSlots([]);
      setError(refusal(language, failure));
    }
  }, [date, party, language]);
  useEffect(() => {
    setError("");
    void loadSlots();
  }, [loadSlots]);

  // The tables free at the time picked, for a party this size.
  const loadTables = useCallback(async () => {
    if (!seatSelection || !time) {
      setTables(null);
      return;
    }
    setTables(null);
    try {
      const answer = await api.availability(date, party, time);
      const choices = answer.tables ?? [];
      setTables(choices);
      setTable((current) => (choices.some((choice) => choice.table === current && choice.available) ? current : ""));
    } catch (failure) {
      setTables([]);
      setError(refusal(language, failure));
    }
  }, [seatSelection, date, party, time, language]);
  useEffect(() => { void loadTables(); }, [loadTables]);

  // Every day that takes bookings, up to the last one open.
  const days = useMemo(() => {
    const open: string[] = [];
    for (let day = info.today; day <= info.lastDate && open.length < 120; day = addDays(day, 1)) if (bookable(day)) open.push(day);
    return open.length ? open : [info.today];
  }, [info]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!time) {
      setError(b(language, "pickTime"));
      setBringUp("bookingTimes");
      return;
    }
    if (seatSelection && !table) {
      setError(b(language, "pickTable"));
      setBringUp("bookingSeats");
      return;
    }
    // The same check the server makes, before the guest waits for it.
    const problem = contactProblem(language, phone);
    if (problem) {
      setPhoneError(problem);
      document.getElementById("bookingContact")?.focus();
      return;
    }
    const contact = phone.trim();
    const byEmail = contact.includes("@");
    setBusy(true);
    setError("");
    try {
      // The account's email goes with it, for the floor: the guest is not asked for it again.
      // A mobile number or an email: either reaches the guest. With a number, the account's email goes along for the floor.
      const email = byEmail ? contact : customer?.email;
      const { reservation, token } = await api.book({ date, time, party, name, ...(byEmail ? {} : { phone: contact }), ...(email ? { email } : {}), ...(notes ? { notes } : {}), ...(seatSelection ? { table } : {}), language });
      rememberContact(name.trim(), contact);
      onBooked(reservation, token);
    } catch (failure) {
      setError(refusal(language, failure, info));
      // The time or the table may have just gone: show what is left.
      if (failure instanceof ApiError && failure.code === "SLOT_FULL") void loadSlots();
      if (failure instanceof ApiError && failure.code === "TABLE_TAKEN") void loadTables();
    } finally {
      setBusy(false);
    }
  }

  const anyFree = slots?.some((slot) => slot.available);

  return <div className="bk-form">
    {/* How many, which day, what time: three dropdowns on one card. */}
    <section className="bk-card bk-pick" id="bookingTimes">
      <div className="bk-selects">
        <label className="bk-field bk-select"><span>{b(language, "party")}</span>
          <select id="bookingParty" value={party} onChange={(event) => setParty(Number(event.target.value))}>
            {Array.from({ length: info.maxParty }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{b(language, "guests", { n: count })}</option>)}
          </select>
        </label>
        <label className="bk-field bk-select"><span>{b(language, "date")}</span>
          <select id="bookingDate" value={date} onChange={(event) => setDate(event.target.value)}>
            {days.map((day) => <option key={day} value={day}>{formatDay(language, day)}</option>)}
          </select>
        </label>
        <label className="bk-field bk-select"><span>{b(language, "time")}</span>
          <select id="bookingTime" value={time} disabled={!slots?.length} onChange={(event) => { setTime(event.target.value); setError(""); if (event.target.value) setBringUp(seatSelection ? "bookingSeats" : "bookingFinish"); }}>
            <option value="">{slots === null ? b(language, "timesLoading") : b(language, "chooseTime")}</option>
            {(slots ?? []).map((slot) => <option key={slot.time} value={slot.time} disabled={!slot.available}>{slot.available ? slot.time : `${slot.time} · ${b(language, "full")}`}</option>)}
          </select>
        </label>
      </div>
      {slots && !slots.length ? <p className="bk-muted" id="bookingNoTimes">{b(language, "noTimes")}</p> : null}
      {slots?.length && !anyFree ? <p className="bk-muted" id="bookingFullDay">{b(language, "fullDay")}</p> : null}
    </section>

    {/* Only once there is a time: an empty card before it said nothing. */}
    {seatSelection && time ? <section className="bk-card" id="bookingSeats">
      <h2>{b(language, "seat")} <span className="bk-muted">· {time}</span></h2>
      {tables === null
          ? <p className="bk-muted">{b(language, "tablesLoading")}</p>
          : !tables.some((choice) => choice.available)
            ? <p className="bk-muted" id="bookingNoTables">{b(language, "noTables", { n: party })}</p>
            : null}
      {tables?.length ? <div className="bk-tables" role="radiogroup" aria-label={b(language, "seat")}>
        {tables.map((choice) => <button key={choice.table} type="button" role="radio" aria-checked={choice.table === table} data-table={choice.table}
          disabled={!choice.available} className={`bk-table ${choice.table === table ? "active" : ""}`} onClick={() => { setTable(choice.table); setError(""); setBringUp("bookingFinish"); }}>
          <strong>{b(language, "tableName", { table: choice.table })}</strong>
          <span className="bk-seats" aria-hidden="true">{"●".repeat(Math.min(choice.seats, 12))}</span>
          <small>{choice.available ? b(language, "tableSeats", { seats: choice.seats }) : choice.seats < party ? b(language, "tableSmall") : b(language, "tableBooked")}</small>
        </button>)}
      </div> : null}
    </section> : null}

    {/* The one card left: who is booking. */}
    <div id="bookingFinish" className="bk-finish">
      {!customer ? <SignInCard language={language} onSignedIn={onSignedIn} /> : null}
      {customer && mustVerify ? <VerifyEmailCard language={language} customer={customer} onVerified={onVerified} /> : null}
      {customer && !mustVerify && !short ? <form className="bk-card bk-details" id="bookingForm" onSubmit={(event) => void submit(event)}>
        <h2>{b(language, "details")}</h2>
        <label className="bk-field"><span>{b(language, "name")}</span><input id="bookingName" required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="bk-field"><span>{b(language, "contact")}</span>
          <input id="bookingContact" required maxLength={254} autoComplete="tel email" placeholder={b(language, "contactHint")} aria-invalid={phoneError ? true : undefined} value={phone}
            onChange={(event) => { setPhone(event.target.value); setPhoneError(""); }}
            onBlur={() => setPhoneError(phone.trim() ? contactProblem(language, phone) : "")} />
          {phoneError ? <small className="bk-field-error" id="bookingContactError" role="alert">{phoneError}</small> : null}
        </label>
        <label className="bk-field"><span>{b(language, "notes")}</span><textarea id="bookingNotes" maxLength={500} rows={2} placeholder={b(language, "notesHint")} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        {info.note ? <p className="bk-note">{info.note}</p> : null}
        <p className="bk-privacy">{b(language, "privacy", { restaurant: info.restaurantName })}</p>
        {error ? <p className="bk-error" role="alert" id="bookingError">{error}</p> : null}
        <button type="submit" className="bk-primary" id="bookingSubmit" disabled={busy}>
          {busy ? b(language, "submitting") : time ? `${b(language, "submit")} · ${formatDay(language, date)} ${time} · ${b(language, "partyOf", { n: party })}${table ? ` · ${b(language, "tableName", { table })}` : ""}` : b(language, "submit")}
        </button>
      </form> : null}
    </div>
  </div>;
}

/** Whether a signed-in guest (their email proved, where it must be) has fewer points than booking takes. */
function shortOfPoints(info: ApiBookingInfo, customer: ApiCustomer): boolean {
  const mustVerify = Boolean(info.emailVerification && !customer.emailVerified);
  return !mustVerify && Boolean(info.minPoints) && customer.points < (info.minPoints ?? 0);
}

/**
 * Booking for members, short of the points: what it takes, what they have,
 * and the member code the waiter scans when they pay at the restaurant —
 * their first visit's points (POS, apps/pos-web/src/BookingScanner.tsx).
 */
function MemberCard({ language, info, customer, onRefreshed }: { language: BookingLanguage; info: ApiBookingInfo; customer: ApiCustomer; onRefreshed: (customer: ApiCustomer) => void }) {
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      onRefreshed((await api.customer()).customer);
    } catch { /* Still short: the card stays. */ } finally {
      setBusy(false);
    }
  }
  return <section className="bk-card bk-member" id="bookingMember">
    <p className="bk-member-short">{b(language, "pointsShortLine", { min: info.minPoints ?? 0, points: customer.points, welcome: info.welcomePoints ?? 0 })}</p>
    <div className="bk-member-actions">
      <MemberCode language={language} customer={customer} id="bookingMemberQr" />
      <button type="button" className="bk-secondary" id="bookingRefreshPoints" disabled={busy} onClick={() => void refresh()}>{b(language, "memberRefresh")}</button>
    </div>
  </section>;
}

/**
 * The booking's QR code, for the waiter to scan at the door (the POS reads
 * "ZYRES:" and the number, apps/pos-web/src/BookingScanner.tsx). Drawn as
 * SVG, black on white for any camera, by a library fetched only once there is
 * a booking to show.
 */
function useBookingQr(reference: string): string {
  return useQr(reference ? `ZYRES:${reference}` : "");
}

/** A QR code for `text` as an SVG data URL; "" while it is drawn, or for no text. */
function useQr(text: string): string {
  const [qr, setQr] = useState("");
  useEffect(() => {
    setQr("");
    if (!text) return;
    let current = true;
    void import("qrcode").then(({ default: QRCode }) =>
      QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } })
    ).then((svg) => {
      if (current) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }).catch(() => { /* The number is on the ticket to read out. */ });
    return () => { current = false; };
  }, [text]);
  return qr;
}

function BookingDetails({ language, booking, held, info, onChange, onAnother }: {
  language: BookingLanguage; booking: ApiGuestReservation; held: Held; info: ApiBookingInfo | null;
  onChange: (booking: ApiGuestReservation) => void; onAnother: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const link = linkFor(held);

  async function cancel() {
    if (!window.confirm(b(language, "cancelConfirm"))) return;
    setBusy(true);
    setError("");
    try {
      onChange((await api.cancelReservation(held.id, held.token)).reservation);
    } catch (failure) {
      setError(failure instanceof ApiError && failure.code === "TOO_LATE" ? b(language, "cannotCancel") : refusal(language, failure));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch { /* The link is on screen to copy by hand. */ }
  }

  const active = booking.status === "pending" || booking.status === "confirmed";
  const [flipped, setFlipped] = useState(false);
  const qr = useBookingQr(active ? booking.reference : "");
  return <section className="bk-card bk-booking" id="bookingDetails" data-status={booking.status}>
    <p className={`bk-status bk-status-${booking.status}`} id="bookingStatus">{booking.status === "cancelled" ? b(language, "cancelDone") : b(language, booking.status)}</p>
    {/* The time and the day first and large, as a ticket reads; the rest under
        it. ② Flip to reveal: a tap turns the ticket over to the booking number,
        large, to show at the door; another tap turns it back. */}
    <button type="button" className={`bk-when bk-pass ${flipped ? "flipped" : ""}`} id="bookingPass" aria-pressed={flipped}
      aria-label={flipped ? b(language, "backToTime") : b(language, "showPass")} onClick={() => setFlipped((value) => !value)}>
      <span className="bk-pass-inner">
        <span className="bk-pass-face bk-pass-front" aria-hidden={flipped}>
          <span className="bk-pass-stub">
            <strong>{booking.time}</strong>
            <span>{formatDay(language, booking.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          </span>
          <small className="bk-pass-hint">{b(language, "showPass")} ↻</small>
        </span>
        <span className="bk-pass-face bk-pass-back" aria-hidden={!flipped}>
          {/* One white rectangle, like a boarding pass: the code large in the
              middle, the number and who under it, for the door to read or type. */}
          <span className="bk-pass-code">
            {qr && <img className="bk-pass-qr" id="bookingQr" src={qr} alt={b(language, "qrAlt", { reference: booking.reference })} width="240" height="240" />}
            <small>{b(language, "reference")}</small>
            <strong>{booking.reference}</strong>
            <span>{[b(language, "partyOf", { n: booking.party }), booking.table ? b(language, "tableName", { table: booking.table }) : "", booking.name].filter(Boolean).join(" · ")}</span>
          </span>
          {qr && <span className="bk-pass-scan">{b(language, "qrHint")}</span>}
          <small className="bk-pass-hint">{b(language, "backToTime")} ↻</small>
        </span>
      </span>
    </button>
    <dl className="bk-summary">
      <div><dt>{b(language, "reference")}</dt><dd id="bookingReference">{booking.reference}</dd></div>
      <div><dt>{b(language, "party")}</dt><dd>{b(language, "partyOf", { n: booking.party })}</dd></div>
      {booking.table ? <div><dt>{b(language, "yourTable")}</dt><dd id="bookingTable">{b(language, "tableName", { table: booking.table })}</dd></div> : null}
      <div><dt>{b(language, "name")}</dt><dd>{booking.name}</dd></div>
      {booking.notes ? <div><dt>{b(language, "notes")}</dt><dd>{booking.notes}</dd></div> : null}
    </dl>
    {active ? <div className="bk-link">
      <p>{b(language, "keepLink")}</p>
      <div className="bk-link-row">
        <input readOnly value={link} id="bookingLink" onFocus={(event) => event.target.select()} />
        <button type="button" className="bk-secondary" onClick={() => void copy()}>{copied ? b(language, "copied") : b(language, "copy")}</button>
      </div>
    </div> : null}
    {error ? <p className="bk-error" role="alert">{error}</p> : null}
    <div className="bk-actions">
      {active && booking.cancellable !== false ? <button type="button" className="bk-danger" id="bookingCancel" disabled={busy} onClick={() => void cancel()}>{b(language, "cancel")}</button> : null}
      {active && booking.cancellable === false ? <p className="bk-muted">{b(language, "cannotCancel")}</p> : null}
      {info?.enabled ? <button type="button" className="bk-secondary" id="bookingAnother" onClick={onAnother}>{b(language, "another")}</button> : null}
    </div>
  </section>;
}
