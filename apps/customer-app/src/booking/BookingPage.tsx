import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ApiBookingInfo, ApiCustomer, ApiGuestReservation, ApiReservationSlot, ApiTableChoice } from "@zhaoyun/contracts";
import { ApiError, RestaurantApi } from "@zhaoyun/api-client";
import { apiBaseUrl, customerToken, setCustomerToken } from "../app/api";
import { b, bookingError, formatDay, initialLanguage, rememberLanguage } from "./booking-i18n";
import type { BookingErrorKey, BookingLanguage } from "./booking-i18n";
import { checkMobile } from "../../../../shared/phone.mjs";

// The guest's session is the menu's own (the same account, the same phone).
const api = new RestaurantApi({ baseUrl: apiBaseUrl, headers: () => ({ "x-customer-token": customerToken() }) });

/** A booking this phone holds: its id and the token that opens it. */
interface Held { id: string; token: string }

const HELD_KEY = "zy_booking";
const LANGUAGES: Array<[BookingLanguage, string]> = [["de", "Deutsch"], ["en", "English"], ["zh", "中文"]];
const DAY_CHIPS = 14;

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
      "EMAIL_UNVERIFIED", "BAD_PHONE", "NOT_MOBILE", "WRONG_CODE", "CODE_EXPIRED", "CODE_TOO_SOON", "TOO_MANY_CODES", "MAIL_FAILED"];
    const limit = error.code === "DAY_LIMIT" ? info?.maxPerDayPerGuest : info?.maxActivePerGuest;
    const details = (error.details ?? {}) as { attemptsLeft?: number; retryAfter?: number };
    if (error.code && (known as string[]).includes(error.code)) return bookingError(language, error.code as BookingErrorKey, { message: error.message, limit: limit ?? "", left: details.attemptsLeft ?? "", s: details.retryAfter ?? "" });
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

  return <main className="bk-page">
    <header className="bk-head">
      <div>
        <p className="bk-eyebrow">{info?.restaurantName ?? ""}</p>
        <h1>{booking ? b(language, "myBooking") : b(language, "title")}</h1>
      </div>
      <nav className="bk-languages" aria-label="Language">
        {LANGUAGES.map(([code, label]) => <button key={code} type="button" className={code === language ? "active" : ""} aria-pressed={code === language} onClick={() => chooseLanguage(code)}>{label}</button>)}
      </nav>
    </header>

    {notFound && !booking ? <section className="bk-card bk-message" id="bookingNotFound">
      <p>{b(language, "notFound")}</p>
      <button type="button" className="bk-secondary" onClick={startOver}>{b(language, "another")}</button>
    </section> : null}

    {customer ? <p className="bk-account" id="bookingAccount">{b(language, "signedInAs", { email: customer.email })} · <button type="button" className="bk-link-button" onClick={() => void signOut()}>{b(language, "signOut")}</button></p> : null}

    {booking && held
      ? <BookingDetails language={language} booking={booking} held={held} info={info} onChange={(next) => { setBooking(next); void loadMine(); }} onAnother={startOver} />
      : loadFailed
        ? <section className="bk-card bk-message"><p>{b(language, "failedLoad")}</p><button type="button" className="bk-secondary" onClick={() => void load()}>{b(language, "retry")}</button></section>
        : !info
          ? <p className="bk-muted">{b(language, "loading")}</p>
          : !info.enabled
            ? <section className="bk-card bk-message" id="bookingOff"><p>{b(language, "off")}</p></section>
            : <BookingForm language={language} info={info} customer={customer} onSignedIn={signedIn} onVerified={setCustomer} onBooked={booked} />}

    {/* The booking open above is not listed a second time under it. */}
    {customer && others.length ? <MyBookings language={language} bookings={others} info={info} onChange={() => void loadMine()} /> : null}
  </main>;
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
  const [name, setName] = useState("");
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
        : await api.registerCustomer({ email, password, ...(name.trim() ? { name: name.trim() } : {}) }));
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
      {mode === "register" ? <label className="bk-field"><span>{b(language, "accountName")}</span><input maxLength={40} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
      {mode === "register" ? <p className="bk-privacy">{b(language, "registerConsent")}</p> : <p className="bk-privacy">{b(language, "forgot")}</p>}
      {error ? <p className="bk-error" role="alert">{error}</p> : null}
      <button type="submit" className="bk-secondary" id="bookingSignInSubmit" disabled={busy}>{b(language, mode)}</button>
    </form>
  </section>;
}

function BookingForm({ language, info, customer, onSignedIn, onVerified, onBooked }: {
  language: BookingLanguage; info: ApiBookingInfo; customer: ApiCustomer | null;
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
  const seatSelection = Boolean(info.seatSelection);
  const [tables, setTables] = useState<ApiTableChoice[] | null>(null);
  const [table, setTable] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  // Where mail goes out, a guest proves their email before booking (shared/email-verify.mjs).
  const mustVerify = Boolean(info.emailVerification && customer && !customer.emailVerified);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Signed in: the account's name to start from.
  useEffect(() => {
    if (customer?.name) setName((current) => current || customer.name);
  }, [customer]);

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

  const chips = Array.from({ length: DAY_CHIPS }, (_, offset) => addDays(info.today, offset)).filter((day) => day <= info.lastDate);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!time) {
      setError(b(language, "pickTime"));
      return;
    }
    if (seatSelection && !table) {
      setError(b(language, "pickTable"));
      return;
    }
    // The same check the server makes (shared/phone.mjs), before the guest waits for it.
    const mobile = checkMobile(phone);
    if (!mobile.ok) {
      setPhoneError(b(language, mobile.reason === "NOT_MOBILE" ? "phoneNotMobile" : "phoneInvalid"));
      document.getElementById("bookingPhone")?.focus();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { reservation, token } = await api.book({ date, time, party, name, phone, ...(email ? { email } : {}), ...(notes ? { notes } : {}), ...(seatSelection ? { table } : {}), language });
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

  return <><form className="bk-form" id="bookingForm" onSubmit={(event) => void submit(event)}>
    <section className="bk-card">
      <h2>{b(language, "party")}</h2>
      {/* A list to pick from: twenty buttons were a screenful for one number. */}
      <label className="bk-field bk-select">
        <select id="bookingParty" aria-label={b(language, "party")} value={party} onChange={(event) => setParty(Number(event.target.value))}>
          {Array.from({ length: info.maxParty }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{b(language, "guests", { n: count })}</option>)}
        </select>
      </label>
      <p className="bk-muted">{b(language, "largeParty", { n: info.maxParty })}</p>
    </section>

    <section className="bk-card">
      <h2>{b(language, "date")}</h2>
      <div className="bk-days">
        {chips.map((day) => {
          const open = bookable(day);
          return <button key={day} type="button" data-date={day} disabled={!open} className={day === date ? "active" : ""} aria-pressed={day === date} onClick={() => setDate(day)}>
            <span>{formatDay(language, day, { weekday: "short" })}</span>
            <strong>{formatDay(language, day, { day: "numeric" })}</strong>
            <small>{open ? formatDay(language, day, { month: "short" }) : b(language, "closed")}</small>
          </button>;
        })}
      </div>
      <label className="bk-field bk-other-date">
        <span>{b(language, "otherDate")}</span>
        <input type="date" id="bookingDate" min={info.today} max={info.lastDate} value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} />
      </label>
    </section>

    <section className="bk-card">
      <h2>{b(language, "time")} <span className="bk-muted">· {formatDay(language, date, { weekday: "long", day: "numeric", month: "long" })}</span></h2>
      {slots === null
        ? <p className="bk-muted">{b(language, "timesLoading")}</p>
        : !slots.length
          ? <p className="bk-muted" id="bookingNoTimes">{b(language, "noTimes")}</p>
          : <>
            {!anyFree ? <p className="bk-muted" id="bookingFullDay">{b(language, "fullDay")}</p> : null}
            <label className="bk-field bk-select">
              <select id="bookingTime" aria-label={b(language, "time")} value={time} onChange={(event) => setTime(event.target.value)}>
                <option value="" disabled>{b(language, "pickTime")}</option>
                {slots.map((slot) => <option key={slot.time} value={slot.time} disabled={!slot.available}>{slot.available ? slot.time : `${slot.time} · ${b(language, "full")}`}</option>)}
              </select>
            </label>
          </>}
      <p className="bk-muted">{b(language, "staysFor", { minutes: info.durationMinutes })}</p>
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
          disabled={!choice.available} className={`bk-table ${choice.table === table ? "active" : ""}`} onClick={() => setTable(choice.table)}>
          <strong>{b(language, "tableName", { table: choice.table })}</strong>
          <span className="bk-seats" aria-hidden="true">{"●".repeat(Math.min(choice.seats, 12))}</span>
          <small>{choice.available ? b(language, "tableSeats", { seats: choice.seats }) : choice.seats < party ? b(language, "tableSmall") : b(language, "tableBooked")}</small>
        </button>)}
      </div> : null}
    </section> : null}

    {customer && !mustVerify ? <section className="bk-card">
      <h2>{b(language, "details")}</h2>
      <label className="bk-field"><span>{b(language, "name")}</span><input id="bookingName" required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="bk-field"><span>{b(language, "phone")}</span>
        <input id="bookingPhone" required type="tel" maxLength={30} autoComplete="tel" inputMode="tel" placeholder="0660 1234567" aria-invalid={phoneError ? true : undefined} value={phone}
          onChange={(event) => { setPhone(event.target.value); setPhoneError(""); }}
          onBlur={() => { const mobile = checkMobile(phone); setPhoneError(!phone.trim() || mobile.ok ? "" : b(language, mobile.reason === "NOT_MOBILE" ? "phoneNotMobile" : "phoneInvalid")); }} />
        {phoneError ? <small className="bk-field-error" id="bookingPhoneError" role="alert">{phoneError}</small> : <small>{b(language, "phoneHint")}</small>}
      </label>
      <label className="bk-field"><span>{b(language, "email")}</span><input id="bookingEmail" type="email" maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="bk-field"><span>{b(language, "notes")}</span><textarea id="bookingNotes" maxLength={500} rows={2} placeholder={b(language, "notesHint")} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      {info.note ? <p className="bk-note">{info.note}</p> : null}
      <p className="bk-privacy">{b(language, "privacy", { restaurant: info.restaurantName })}</p>
    </section> : null}

    {error ? <p className="bk-error" role="alert" id="bookingError">{error}</p> : null}
    {customer && !mustVerify ? <button type="submit" className="bk-primary" id="bookingSubmit" disabled={busy}>
      {busy ? b(language, "submitting") : time ? `${b(language, "submit")} · ${formatDay(language, date)} ${time} · ${b(language, "partyOf", { n: party })}${table ? ` · ${b(language, "tableName", { table })}` : ""}` : b(language, "submit")}
    </button> : null}
  </form>
  {/* Their own forms, after the booking's: forms do not nest. */}
  {!customer ? <SignInCard language={language} onSignedIn={onSignedIn} /> : null}
  {customer && mustVerify ? <VerifyEmailCard language={language} customer={customer} onVerified={onVerified} /> : null}
  </>;
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
  return <section className="bk-card bk-booking" id="bookingDetails" data-status={booking.status}>
    <p className={`bk-status bk-status-${booking.status}`} id="bookingStatus">{booking.status === "cancelled" ? b(language, "cancelDone") : b(language, booking.status)}</p>
    {/* The time and the day first and large, as a ticket reads; the rest under
        it. ② Flip to reveal: a tap turns the ticket over to the booking number,
        large, to show at the door; another tap turns it back. */}
    <button type="button" className={`bk-when bk-pass ${flipped ? "flipped" : ""}`} id="bookingPass" aria-pressed={flipped}
      aria-label={flipped ? b(language, "backToTime") : b(language, "showPass")} onClick={() => setFlipped((value) => !value)}>
      <span className="bk-pass-inner">
        <span className="bk-pass-face bk-pass-front" aria-hidden={flipped}>
          <strong>{booking.time}</strong>
          <span>{formatDay(language, booking.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
          <small className="bk-pass-hint">{b(language, "showPass")} ↻</small>
        </span>
        <span className="bk-pass-face bk-pass-back" aria-hidden={!flipped}>
          <small>{b(language, "reference")}</small>
          <strong>{booking.reference}</strong>
          <span>{[b(language, "partyOf", { n: booking.party }), booking.table ? b(language, "tableName", { table: booking.table }) : "", booking.name].filter(Boolean).join(" · ")}</span>
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
