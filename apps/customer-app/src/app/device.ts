const tableKey = "zy_table_no";
const defaultTable = "08";

function sanitize(value: string): string {
  return value.trim().slice(0, 32);
}

/**
 * The table number is per device, not per build. A tablet is provisioned either by opening
 * the app once with `?table=12` or from the admin console's connection settings.
 */
export function tableNumber(): string {
  try {
    const fromUrl = sanitize(new URLSearchParams(location.search).get("table") || "");
    if (fromUrl) {
      localStorage.setItem(tableKey, fromUrl);
      return fromUrl;
    }
    return sanitize(localStorage.getItem(tableKey) || "") || defaultTable;
  } catch {
    return defaultTable;
  }
}

export function setTableNumber(value: string): void {
  const table = sanitize(value);
  if (table) localStorage.setItem(tableKey, table);
}
