/**
 * A table of rows as a CSV file download, with a UTF-8 BOM so Excel opens the
 * German umlauts and Chinese names as they are. Shared by the panels that
 * export their lists (reservations, delivery orders); one copy, not one per
 * panel.
 */
export function downloadCsv(name: string, rows: Array<Array<string | number>>) {
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
