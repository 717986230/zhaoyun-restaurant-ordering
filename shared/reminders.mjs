/**
 * The day-before reservation reminder (docs/RESERVATIONS.md, docs/OPERATIONS.md).
 *
 * A schedule — a Cloudflare Cron Trigger on the Worker, or the restaurant's own
 * cron running `npm run reminders` on a self-hosted Node server — calls this
 * once a day. It emails every guest with a confirmed booking for the next day
 * (in the restaurant's own time zone) who gave an address and has not already
 * been reminded, through the same Brevo pipeline the guests' codes use.
 *
 * Idempotent: each booking is written into reservation_reminders the moment its
 * reminder goes out, so a schedule that fires twice, or an isolate that retries,
 * sends one email per booking and no more. Best-effort — a send that fails is
 * logged and left unmarked, to be tried again the next day. Nothing here may
 * import `node:` anything, so it runs unchanged on Workers.
 */
import { createMailer, reminderMessage } from "./mail.mjs";
import { addDays, localNow } from "./reservations.mjs";

export async function remindReservations({ store, mail, send = (...args) => fetch(...args) } = {}) {
  if (!mail) return { ran: false, reason: "mail-off", sent: 0, due: 0 };
  const settings = await store.getSettings();
  if (!settings.reservations?.enabled) return { ran: false, reason: "reservations-off", sent: 0, due: 0 };
  // Tomorrow on the restaurant's own wall clock, so a booking at 20:00 is
  // reminded the day before wherever the schedule's own clock happens to be.
  const date = addDays(localNow(settings.timeZone).date, 1);
  const due = await store.reservations.remindableFor(date);
  const sendMail = createMailer({ mail, store, send });
  let sent = 0;
  for (const reservation of due) {
    const message = { to: reservation.email, ...reminderMessage(reservation, { language: reservation.language, restaurant: settings.restaurantName }) };
    if (await sendMail(message)) {
      await store.reservations.markReminded(reservation.id);
      sent += 1;
    }
  }
  return { ran: true, date, sent, due: due.length };
}
