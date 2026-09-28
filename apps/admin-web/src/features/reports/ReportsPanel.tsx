import { useCallback, useEffect, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiSalesReport } from "@zhaoyun/contracts";
import { formatMoney, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  /** The restaurant's time zone: "today" is its today, not the browser's. */
  timeZone: string;
  failed: (error: unknown) => void;
}

type Preset = "today" | "yesterday" | "week" | "month" | "lastMonth";
const PRESETS: Array<[Preset, CopyKey]> = [["today", "reportToday"], ["yesterday", "reportYesterday"], ["week", "reportWeek"], ["month", "reportMonth"], ["lastMonth", "reportLastMonth"]];

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today in the restaurant's time zone, as YYYY-MM-DD. */
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rangeOf(preset: Preset, timeZone: string): [string, string] {
  const today = todayIn(timeZone);
  const at = Date.parse(`${today}T00:00:00Z`);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": return [isoDay(at - DAY_MS), isoDay(at - DAY_MS)];
    case "week": return [isoDay(at - 6 * DAY_MS), today];
    case "month": return [`${today.slice(0, 8)}01`, today];
    case "lastMonth": {
      const first = Date.UTC(month === 1 ? year - 1 : year, month === 1 ? 11 : month - 2, 1);
      return [isoDay(first), isoDay(Date.UTC(year, month - 1, 1) - DAY_MS)];
    }
  }
}

/** A CSV the way Excel opens it right: a BOM for UTF-8, fields quoted. */
function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const text = `﻿${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const euros = (cents: number) => (cents / 100).toFixed(2);

/**
 * One series of bars over a baseline: takings per hour or per day. Thin bars
 * with a small gap, the values on hover and in the table beside it — the
 * chart is for the shape, the table for the numbers.
 */
function Bars({ label, points, money }: { label: string; points: Array<{ key: string; label: string; cents: number; receipts: number }>; money: (cents: number) => string }) {
  const top = Math.max(1, ...points.map((point) => point.cents));
  return <figure className="report-bars" aria-label={label}>
    <div className="report-bars-plot" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((point) => <div className="report-bar-slot" key={point.key} data-tip={`${point.label} · ${money(point.cents)} · ${point.receipts}`} tabIndex={0} aria-label={`${point.label}: ${money(point.cents)}`}>
        <i className="report-bar" style={{ height: `${Math.max(0, point.cents) / top * 100}%` }} />
      </div>)}
    </div>
    <div className="report-bars-axis" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((point, index) => <span key={point.key}>{index % Math.ceil(points.length / 8) === 0 ? point.label : ""}</span>)}
    </div>
  </figure>;
}

/**
 * Sales over the manager's days: what the day closings add up to, and what
 * they do not show — the dishes, the hours, the waiters. Built from the
 * receipts on the server (shared/reports.mjs), so it agrees with the Z
 * reports to the cent.
 */
export function ReportsPanel({ api, timeZone, failed }: Props) {
  const { t, language } = useI18n();
  const [range, setRange] = useState<[string, string]>(() => rangeOf("today", timeZone));
  const [preset, setPreset] = useState<Preset | null>("today");
  const [report, setReport] = useState<ApiSalesReport | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (cents: number) => formatMoney(cents, language);

  const load = useCallback(async (from: string, to: string) => {
    setBusy(true);
    try {
      setReport((await api.salesReport(from, to)).report);
    } catch (error) { failed(error); } finally { setBusy(false); }
  }, [api, failed]);

  useEffect(() => { void load(range[0], range[1]); }, [load, range]);

  const pick = (next: Preset) => { setPreset(next); setRange(rangeOf(next, timeZone)); };
  const itemName = (item: ApiSalesReport["items"][number]) => item.names?.[language] || item.name;
  const totals = report?.totals;
  const suffix = report ? `${report.from}_${report.to}` : "";

  return <section id="reportsPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <div>
        <h1>{t("reportsTitle")}</h1>
        <p>{t("reportsLead")}</p>
      </div>
    </div>

    <div className="report-range">
      <div className="report-presets" role="group" aria-label={t("reportRange")}>
        {PRESETS.map(([key, label]) => <button key={key} type="button" className={preset === key ? "primary-action" : "ghost-action"} aria-pressed={preset === key} onClick={() => pick(key)}>{t(label)}</button>)}
      </div>
      <form className="report-dates" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPreset(null);
        setRange([String(data.get("from")), String(data.get("to"))]);
      }}>
        <label><span>{t("reportFrom")}</span><input name="from" type="date" required defaultValue={range[0]} key={`from-${range[0]}`} /></label>
        <label><span>{t("reportTo")}</span><input name="to" type="date" required defaultValue={range[1]} key={`to-${range[1]}`} /></label>
        <button type="submit" className="ghost-action" disabled={busy}>{t("reportShow")}</button>
      </form>
    </div>

    {report && totals && <>
      <div className="report-tiles">
        <div className="report-tile"><small>{t("reportGross")}</small><b data-report="gross">{money(totals.grossCents)}</b></div>
        <div className="report-tile"><small>{t("reportReceipts")}</small><b data-report="receipts">{totals.receipts}</b></div>
        <div className="report-tile"><small>{t("reportAverage")}</small><b>{money(totals.averageCents)}</b></div>
        <div className="report-tile"><small>{t("reportStornos")}</small><b>{totals.stornos}</b></div>
        {(totals.discountCents ?? 0) !== 0 && <div className="report-tile"><small>{t("reportDiscounts")}</small><b>{money(totals.discountCents ?? 0)}</b></div>}
        {totals.vouchersSoldCents !== 0 && <div className="report-tile"><small>{t("reportVouchers")}</small><b>{money(totals.vouchersSoldCents)}</b></div>}
      </div>

      {totals.receipts === 0 && totals.stornos === 0 ? <div className="admin-empty">{t("reportEmpty")}</div> : <div className="report-grid">
        <section className="report-card">
          <h2>{t("reportByHour")}</h2>
          <Bars label={t("reportByHour")} money={money} points={report.hours.map((hour) => ({ key: String(hour.hour), label: `${String(hour.hour).padStart(2, "0")}:00`, cents: hour.grossCents, receipts: hour.receipts }))} />
        </section>

        {report.days.length > 1 && <section className="report-card">
          <div className="report-card-head">
            <h2>{t("reportByDay")}</h2>
            <button type="button" className="ghost-action" onClick={() => downloadCsv(`sales-days_${suffix}.csv`, [[t("reportDate"), t("reportReceipts"), t("reportGross")], ...report.days.map((day) => [day.date, day.receipts, euros(day.grossCents)])])}>⬇ CSV</button>
          </div>
          <Bars label={t("reportByDay")} money={money} points={report.days.map((day) => ({ key: day.date, label: day.date.slice(5), cents: day.grossCents, receipts: day.receipts }))} />
        </section>}

        <section className="report-card">
          <h2>{t("reportPayments")}</h2>
          <table className="report-table">
            <tbody>{(["cash", "card", "voucher"] as const).map((type) => <tr key={type}><td>{t(type === "cash" ? "reportCash" : type === "card" ? "reportCard" : "reportVoucher")}</td><td>{money(totals.payments[type] ?? 0)}</td></tr>)}</tbody>
          </table>
          <h2>{t("reportVat")}</h2>
          <table className="report-table">
            <thead><tr><th>{t("billRate")}</th><th>{t("billNet")}</th><th>{t("billVat")}</th><th>{t("billGross")}</th></tr></thead>
            <tbody>{totals.vat.map((group) => <tr key={group.percent}><td>{group.percent}%</td><td>{money(group.netCents)}</td><td>{money(group.vatCents)}</td><td>{money(group.grossCents)}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="report-card">
          <h2>{t("reportStaff")}</h2>
          <table className="report-table">
            <thead><tr><th>{t("reportWaiter")}</th><th>{t("reportReceipts")}</th><th>{t("reportGross")}</th></tr></thead>
            <tbody>{report.staff.map((person) => <tr key={person.name}><td>{person.name || t("reportConsole")}</td><td>{person.receipts}</td><td>{money(person.grossCents)}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="report-card report-card-wide">
          <div className="report-card-head">
            <h2>{t("reportItems")}</h2>
            <button type="button" className="ghost-action" data-action="items-csv" onClick={() => downloadCsv(`sales-dishes_${suffix}.csv`, [[t("reportDish"), t("reportQuantity"), t("reportGross")], ...report.items.map((item) => [itemName(item), item.quantity, euros(item.grossCents)])])}>⬇ CSV</button>
          </div>
          <table className="report-table report-items">
            <thead><tr><th>#</th><th>{t("reportDish")}</th><th>{t("reportQuantity")}</th><th>{t("reportGross")}</th><th>{t("reportShare")}</th></tr></thead>
            <tbody>{report.items.map((item, index) => <tr key={`${item.name}-${index}`}>
              <td>{index + 1}</td><td>{itemName(item)}</td><td>{item.quantity}</td><td>{money(item.grossCents)}</td>
              <td>{totals.grossCents ? `${Math.round(item.grossCents / totals.grossCents * 1000) / 10}%` : "—"}</td>
            </tr>)}</tbody>
          </table>
        </section>
      </div>}
    </>}
  </div></section>;
}
