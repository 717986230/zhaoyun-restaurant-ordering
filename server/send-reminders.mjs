/**
 * The day-before reservation reminder for a self-hosted Node server
 * (shared/reminders.mjs). The restaurant's own cron runs `npm run reminders`
 * once a day, the way it runs `npm run backup`. On Cloudflare the Worker's Cron
 * Trigger does this instead (workers/index.mjs); a deployment runs one, not both.
 *
 * Does nothing unless mail (Brevo) is configured and reservations are on. Exits
 * non-zero only on an unexpected error, so a failed run is visible in cron's log.
 */
import { config } from "./config.mjs";
import { createDatabase } from "./database.mjs";
import { remindReservations } from "../shared/reminders.mjs";

const store = createDatabase(config.databasePath);
try {
  const result = await remindReservations({ store, mail: config.mail });
  console.log(JSON.stringify({ level: "info", msg: "reservation reminders", ...result }));
} catch (error) {
  console.error(JSON.stringify({ level: "error", msg: "reservation reminders failed", error: String(error?.message ?? error) }));
  process.exitCode = 1;
} finally {
  store.close();
}
