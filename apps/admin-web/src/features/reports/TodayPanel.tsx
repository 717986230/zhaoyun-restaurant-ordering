import { useCallback, useEffect, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiToday } from "@zhaoyun/contracts";
import { formatMoney, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

const STATUS_KEYS: Record<string, CopyKey> = { pending: "todayPending", confirmed: "todayConfirmed", seated: "todaySeated" };

/**
 * 今日概况: what the owner opens the console for — today's takings, how many
 * paid and the average, the five dishes sold most, the tables seated now and
 * what they still owe, and the day's bookings by time. Refreshed every half
 * minute and whenever the live channel says something changed.
 */
export function TodayPanel({ api, failed, liveTick }: { api: AdminApi; failed: (error: unknown) => void; liveTick: number }) {
  const { t, language } = useI18n();
  const [today, setToday] = useState<ApiToday | null>(null);
  const money = (cents: number) => formatMoney(cents, language);

  const load = useCallback(async () => {
    try {
      setToday((await api.today()).today);
    } catch (error) {
      failed(error);
    }
  }, [api]);
  useEffect(() => { void load(); }, [load, liveTick]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!today) return <section id="todayPanel" className="admin-panel active"><div className="settings-page"><p className="admin-empty">…</p></div></section>;
  const dateLabel = new Date(`${today.date}T12:00:00Z`).toLocaleDateString(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return <section id="todayPanel" className="admin-panel active"><div className="settings-page">
    <h1 className="settings-title">{t("todayTitle")} <small className="today-date">{dateLabel}</small></h1>
    <div className="report-tiles" id="todayTiles">
      <div className="report-tile"><small>{t("todayTakings")}</small><b id="todayGross">{money(today.grossCents)}</b></div>
      <div className="report-tile"><small>{t("todayReceipts")}</small><b>{today.receipts}</b></div>
      <div className="report-tile"><small>{t("todayAverage")}</small><b>{money(today.averageCents)}</b></div>
      <div className="report-tile"><small>{t("todaySeatedNow")}</small><b id="todaySeatedNow">{today.seatedTables}</b><small>{today.openCents ? t("todayOpen", { amount: money(today.openCents) }) : t("todayNothingOpen")}</small></div>
      <div className="report-tile"><small>{t("todayBooked")}</small><b>{today.bookings.length}</b><small>{t("todayGuests", { n: today.bookedGuests })}</small></div>
    </div>
    <div className="report-grid">
      <section className="report-card" id="todayTop">
        <h2>{t("todayTopTitle")}</h2>
        {today.top.length ? <ol className="today-list">{today.top.map((item, index) => <li key={`${item.name}-${index}`}>
          <span className="today-rank">{index + 1}</span>
          <span className="today-name">{item.names?.[language] || item.name}</span>
          <b>{item.quantity}×</b>
          <small>{money(item.grossCents)}</small>
        </li>)}</ol> : <p className="settings-hint">{t("todayNoSales")}</p>}
      </section>
      <section className="report-card" id="todayBookings">
        <h2>{t("todayBookingsTitle")}</h2>
        {today.bookings.length ? <ul className="today-list">{today.bookings.map((booking) => <li key={booking.id} data-status={booking.status}>
          <span className="today-rank today-time">{booking.time}</span>
          <span className="today-name">{booking.name}<small> · {t("todayParty", { n: booking.party })}{booking.table ? ` · ${t("todayTable", { table: booking.table })}` : ""}</small></span>
          <small className={`today-status ${booking.status}`}>{t(STATUS_KEYS[booking.status] ?? "todayConfirmed")}</small>
        </li>)}</ul> : <p className="settings-hint">{t("todayNoBookings")}</p>}
      </section>
    </div>
  </div></section>;
}
