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
    test: "邮件服务已经连通，顾客会收到这样的验证码邮件。"
  },
  de: {
    subject: "{restaurant} – Ihr Bestätigungscode: {code}",
    lead: "Ihr Bestätigungscode lautet:",
    expires: "Der Code ist {minutes} Minuten gültig. Wenn Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren.",
    testSubject: "{restaurant}: Test-E-Mail",
    test: "Der E-Mail-Versand funktioniert – so erhalten Gäste ihren Bestätigungscode."
  },
  en: {
    subject: "{restaurant} – your verification code: {code}",
    lead: "Your verification code is:",
    expires: "The code is valid for {minutes} minutes. If you did not ask for it, you can ignore this email.",
    testSubject: "{restaurant}: test email",
    test: "Email is working – this is how guests receive their verification code."
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

/** A message the owner sends themselves from the console, to see mail arrive. */
export function testMessage({ language = "de", restaurant = "" } = {}) {
  const copy = COPY[language] ?? COPY.de;
  const values = { restaurant: restaurant || "Restaurant" };
  return { subject: fill(copy.testSubject, values), text: `${copy.test}\n`, html: `<p>${escapeHtml(copy.test)}</p>` };
}
