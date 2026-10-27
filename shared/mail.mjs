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
    bookingConfirmedSubject: "{restaurant}：预约已确认 · {date} {time}",
    bookingPendingSubject: "{restaurant}：预约已收到 · {date} {time}",
    bookingConfirmedLead: "你的预约已确认：",
    bookingPendingLead: "我们收到了你的预约，正在确认，确认后会再通知你：",
    bookingDate: "日期：{date}",
    bookingTime: "时间：{time}",
    bookingParty: "人数：{party} 位",
    bookingTable: "桌号：{table}",
    bookingReference: "预约号：{reference}",
    bookingManage: "查看或取消预约：{url}"
  },
  de: {
    subject: "{restaurant} – Ihr Bestätigungscode: {code}",
    lead: "Ihr Bestätigungscode lautet:",
    expires: "Der Code ist {minutes} Minuten gültig. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    testSubject: "{restaurant}: Test-E-Mail",
    test: "Der E-Mail-Versand funktioniert – so erhalten Gäste ihren Bestätigungscode.",
    bookingConfirmedSubject: "{restaurant} – Reservierung bestätigt · {date} {time}",
    bookingPendingSubject: "{restaurant} – Reservierung eingegangen · {date} {time}",
    bookingConfirmedLead: "Ihre Reservierung ist bestätigt:",
    bookingPendingLead: "Wir haben Ihre Reservierung erhalten und bestätigen sie in Kürze:",
    bookingDate: "Datum: {date}",
    bookingTime: "Uhrzeit: {time}",
    bookingParty: "Personen: {party}",
    bookingTable: "Tisch: {table}",
    bookingReference: "Buchungsnr.: {reference}",
    bookingManage: "Reservierung ansehen oder stornieren: {url}"
  },
  en: {
    subject: "{restaurant} – your verification code: {code}",
    lead: "Your verification code is:",
    expires: "The code is valid for {minutes} minutes. If you did not ask for it, you can ignore this email.",
    testSubject: "{restaurant}: test email",
    test: "Email is working – this is how guests receive their verification code.",
    bookingConfirmedSubject: "{restaurant} – booking confirmed · {date} {time}",
    bookingPendingSubject: "{restaurant} – booking received · {date} {time}",
    bookingConfirmedLead: "Your booking is confirmed:",
    bookingPendingLead: "We have your booking and will confirm it shortly:",
    bookingDate: "Date: {date}",
    bookingTime: "Time: {time}",
    bookingParty: "Party: {party}",
    bookingTable: "Table: {table}",
    bookingReference: "Reference: {reference}",
    bookingManage: "View or cancel your booking: {url}"
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

/**
 * The email a guest gets when they book online: confirmed at once, or received
 * and awaiting the restaurant's confirmation, with the day, time, party, table
 * (when one is set) and reference, and the link back to view or cancel it.
 */
export function bookingMessage(reservation, { language = "de", restaurant = "", manageUrl = "" } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const confirmed = reservation.status === "confirmed";
  const values = { restaurant: restaurant || "Restaurant", date: reservation.date, time: reservation.time, party: reservation.party, table: reservation.table ?? "", reference: reservation.reference };
  const lines = [
    fill(copy.bookingDate, values),
    fill(copy.bookingTime, values),
    fill(copy.bookingParty, values),
    ...(reservation.table ? [fill(copy.bookingTable, values)] : []),
    fill(copy.bookingReference, values)
  ];
  const lead = fill(confirmed ? copy.bookingConfirmedLead : copy.bookingPendingLead, values);
  const manage = manageUrl ? fill(copy.bookingManage, { url: manageUrl }) : "";
  return {
    subject: fill(confirmed ? copy.bookingConfirmedSubject : copy.bookingPendingSubject, values),
    text: `${lead}\n\n${lines.join("\n")}\n${manage ? `\n${manage}\n` : ""}`,
    html: `<p>${escapeHtml(lead)}</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>${manage ? `<p><a href="${escapeHtml(manageUrl)}">${escapeHtml(fill(copy.bookingManage, { url: "" }).replace(/[:：]\s*$/, ""))}</a></p>` : ""}`
  };
}

/** A message the owner sends themselves from the console, to see mail arrive. */
export function testMessage({ language = "de", restaurant = "" } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const values = { restaurant: restaurant || "Restaurant" };
  return { subject: fill(copy.testSubject, values), text: `${copy.test}\n`, html: `<p>${escapeHtml(copy.test)}</p>` };
}

/**
 * The email the owner gets when the system hits an error it did not plan for
 * (a request that ended in a 500). The caller sends it best-effort and at most
 * once per cooldown, so a burst of failures is one email, not a flood. Written
 * in all three languages, because the owner may read any of them, with the
 * request id that matches the line in the host's log (docs/OPERATIONS.md).
 */
export function alertMessage({ restaurant = "", method = "", path = "", requestId = "", time = "" } = {}) {
  const name = restaurant || "Restaurant";
  const where = `${method} ${path}`.trim();
  const facts = [
    `时间 / Zeit / time: ${time}`,
    `请求 / Anfrage / request: ${where}`,
    ...(requestId ? [`编号 / ID: ${requestId}`] : [])
  ];
  const zh = `${name} 的点餐系统刚刚遇到一个未预料到的错误（一次请求失败，返回 500）。可能还有更多，详见托管平台（Cloudflare）的日志。`;
  const de = `Im Bestellsystem von ${name} ist ein unerwarteter Fehler aufgetreten (eine Anfrage schlug mit 500 fehl). Weitere Details stehen im Log der Hosting-Plattform (Cloudflare).`;
  const en = `${name}'s ordering system hit an unexpected error (a request failed with 500). There may be more — see the hosting platform's log (Cloudflare).`;
  return {
    subject: `${name}：系统出错提醒 / Systemfehler / system error`,
    text: `${zh}\n\n${de}\n\n${en}\n\n${facts.join("\n")}\n`,
    html: `<p>${escapeHtml(zh)}</p><p>${escapeHtml(de)}</p><p>${escapeHtml(en)}</p><ul>${facts.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
  };
}
