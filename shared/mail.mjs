/**
 * Email the restaurant sends: the code that proves a guest's address is
 * theirs, before they may book a table (shared/email-verify.mjs).
 *
 * Sent through Brevo's transactional API when the deployment has its key
 * (docs/MAIL.md): BREVO_API_KEY, BREVO_SENDER_EMAIL (a sender verified in
 * Brevo), BREVO_SENDER_NAME. Without them there is nothing to send with, so
 * no address is asked to prove itself and bookings go on as before.
 *
 * MAIL_OUTBOX=1 keeps the messages in the database instead of sending them
 * — for the tests, which read the code the guest would have got. It is
 * never on where a Brevo key is set.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

export const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";

/** How this deployment sends mail, from its environment; null when it cannot. */
export function mailConfig(env = {}) {
  if (env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL) {
    return { provider: "brevo", apiKey: String(env.BREVO_API_KEY), senderEmail: String(env.BREVO_SENDER_EMAIL), senderName: String(env.BREVO_SENDER_NAME || "") };
  }
  if (env.MAIL_OUTBOX === "1" || env.MAIL_OUTBOX === true) return { provider: "outbox" };
  return null;
}

/** What the console shows: whether mail goes out, how, and from whom. Never the key. */
export function mailStatus(config) {
  if (!config) return { configured: false, provider: null, sender: null };
  return { configured: true, provider: config.provider, sender: config.provider === "brevo" ? config.senderEmail : null };
}

/** The request Brevo takes for one message. */
export function brevoRequest(config, { to, subject, text, html }, restaurantName = "") {
  return {
    url: BREVO_EMAIL_URL,
    init: {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { email: config.senderEmail, name: config.senderName || restaurantName || config.senderEmail },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html
      })
    }
  };
}

const COPY = {
  zh: {
    subject: "{restaurant} 验证码：{code}",
    lead: "你的邮箱验证码是：",
    expires: "验证码 {minutes} 分钟内有效。不是你本人操作的话，忽略这封邮件即可。",
    testSubject: "{restaurant}：测试邮件",
    test: "邮件服务已经连通，顾客会收到这样的验证码邮件。",
    locale: "zh-CN",
    bookingSubjectConfirmed: "{restaurant} 预约确认 · {reference}",
    bookingSubjectPending: "{restaurant} 预约待确认 · {reference}",
    bookingSubjectCancelled: "{restaurant} 预约已取消 · {reference}",
    bookingGreeting: "{name} 您好，",
    bookingConfirmed: "您的预约已确认，我们期待您的光临。",
    bookingPending: "我们已收到您的预约，确认后会再发邮件通知您。",
    bookingCancelled: "您的预约已取消。期待下次再见。",
    bookingDate: "日期",
    bookingTime: "时间",
    bookingParty: "人数",
    bookingPartyValue: "{party} 位",
    bookingTable: "桌位",
    bookingReference: "预约号",
    bookingNotes: "备注",
    bookingManage: "如需更改或取消，请回复本邮件或直接致电餐厅，并告知预约号。"
  },
  de: {
    subject: "{restaurant} – Ihr Bestätigungscode: {code}",
    lead: "Ihr Bestätigungscode lautet:",
    expires: "Der Code ist {minutes} Minuten gültig. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    testSubject: "{restaurant}: Test-E-Mail",
    test: "Der E-Mail-Versand funktioniert – so erhalten Gäste ihren Bestätigungscode.",
    locale: "de-AT",
    bookingSubjectConfirmed: "{restaurant} – Reservierung bestätigt · {reference}",
    bookingSubjectPending: "{restaurant} – Reservierung eingegangen · {reference}",
    bookingSubjectCancelled: "{restaurant} – Reservierung storniert · {reference}",
    bookingGreeting: "Hallo {name},",
    bookingConfirmed: "Ihre Reservierung ist bestätigt. Wir freuen uns auf Ihren Besuch.",
    bookingPending: "Wir haben Ihre Reservierung erhalten und melden uns per E-Mail, sobald sie bestätigt ist.",
    bookingCancelled: "Ihre Reservierung wurde storniert. Wir freuen uns auf ein nächstes Mal.",
    bookingDate: "Datum",
    bookingTime: "Uhrzeit",
    bookingParty: "Personen",
    bookingPartyValue: "{party} Personen",
    bookingTable: "Tisch",
    bookingReference: "Reservierungsnummer",
    bookingNotes: "Anmerkung",
    bookingManage: "Zum Ändern oder Stornieren antworten Sie auf diese E-Mail oder rufen Sie uns an und nennen Sie die Reservierungsnummer."
  },
  en: {
    subject: "{restaurant} – your verification code: {code}",
    lead: "Your verification code is:",
    expires: "The code is valid for {minutes} minutes. If you did not ask for it, you can ignore this email.",
    testSubject: "{restaurant}: test email",
    test: "Email is working – this is how guests receive their verification code.",
    locale: "en-GB",
    bookingSubjectConfirmed: "{restaurant} – reservation confirmed · {reference}",
    bookingSubjectPending: "{restaurant} – reservation received · {reference}",
    bookingSubjectCancelled: "{restaurant} – reservation cancelled · {reference}",
    bookingGreeting: "Hello {name},",
    bookingConfirmed: "Your reservation is confirmed. We look forward to welcoming you.",
    bookingPending: "We have received your reservation and will email you again once it is confirmed.",
    bookingCancelled: "Your reservation has been cancelled. We hope to see you another time.",
    bookingDate: "Date",
    bookingTime: "Time",
    bookingParty: "Guests",
    bookingPartyValue: "{party} guests",
    bookingTable: "Table",
    bookingReference: "Reference",
    bookingNotes: "Note",
    bookingManage: "To change or cancel, reply to this email or call us and quote the reference."
  }
};

function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

/** The code's email, in the guest's language (German by default: the restaurant is in Austria). */
export function codeMessage(code, { language = "de", restaurant = "", minutes = 10 } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const values = { restaurant: restaurant || "Restaurant", code, minutes };
  const lead = fill(copy.lead, values);
  const expires = fill(copy.expires, values);
  return {
    subject: fill(copy.subject, values),
    text: `${lead}\n\n${code}\n\n${expires}\n`,
    html: `<p>${escapeHtml(lead)}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p><p style="color:#666">${escapeHtml(expires)}</p>`
  };
}

/** The booking's date as the guest reads it, in their language: "Samstag, 3. Oktober 2026". */
function longDate(date, locale) {
  // The stored date is a calendar day, not an instant: anchor at noon UTC and format as UTC so
  // the day never shifts, the same way weekdayOf does in shared/reservations.mjs.
  try {
    return new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

/**
 * A reservation email the guest gets when they book online, and again if they
 * cancel: what they booked and its reference, in their language. `kind` is the
 * booking's standing — "confirmed", "pending", or "cancelled".
 */
export function reservationMessage(reservation, { language = "de", restaurant = "", kind = reservation.status } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const name = String(reservation.name ?? "").trim();
  const values = {
    restaurant: restaurant || "Restaurant",
    reference: reservation.reference,
    name,
    party: reservation.party
  };
  const greeting = name ? fill(copy.bookingGreeting, values) : "";
  const subjectKey = kind === "cancelled" ? "bookingSubjectCancelled" : kind === "pending" ? "bookingSubjectPending" : "bookingSubjectConfirmed";
  const leadKey = kind === "cancelled" ? "bookingCancelled" : kind === "pending" ? "bookingPending" : "bookingConfirmed";
  const lead = fill(copy[leadKey], values);
  // The booking's facts, each a label and a value; the table only when the floor has given one.
  const rows = [
    [copy.bookingDate, longDate(reservation.date, copy.locale)],
    [copy.bookingTime, reservation.time],
    [copy.bookingParty, fill(copy.bookingPartyValue, values)],
    [copy.bookingReference, reservation.reference]
  ];
  if (reservation.table) rows.push([copy.bookingTable, reservation.table]);
  const notes = String(reservation.notes ?? "").trim();
  if (notes) rows.push([copy.bookingNotes, notes]);
  const manage = kind === "cancelled" ? "" : copy.bookingManage;

  const textLines = [greeting, "", lead, "", ...rows.map(([label, value]) => `${label}: ${value}`)];
  if (manage) textLines.push("", manage);
  const htmlRows = rows
    .map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(value)}</td></tr>`)
    .join("");
  const htmlParts = [
    greeting ? `<p>${escapeHtml(greeting)}</p>` : "",
    `<p>${escapeHtml(lead)}</p>`,
    `<table style="border-collapse:collapse;margin:8px 0">${htmlRows}</table>`,
    manage ? `<p style="color:#666">${escapeHtml(manage)}</p>` : ""
  ];
  return {
    subject: fill(copy[subjectKey], values),
    text: `${textLines.join("\n").trim()}\n`,
    html: htmlParts.filter(Boolean).join("")
  };
}

/** A message the owner sends themselves from the console, to see mail arrive. */
export function testMessage({ language = "de", restaurant = "" } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const values = { restaurant: restaurant || "Restaurant" };
  return { subject: fill(copy.testSubject, values), text: `${copy.test}\n`, html: `<p>${escapeHtml(copy.test)}</p>` };
}
