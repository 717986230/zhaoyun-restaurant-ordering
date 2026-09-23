const storageKey = "zy_table_no";
const tokenKey = "zy_table_token";

/** Used only until a device has been assigned to a real table. */
export const DEFAULT_TABLE_NO = "08";

export interface TableIdentity {
  /** Table number sent with every order and service request. */
  tableNo: string;
  /** False while the device still runs on the placeholder table. */
  configured: boolean;
  /** Token from the kiosk link; required once the table is registered on the server. */
  token: string;
}

export function normalizeTableNo(value: string | null | undefined): string | null {
  const candidate = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,7}$/.test(candidate) ? candidate : null;
}

export function normalizeToken(value: string | null | undefined): string {
  const token = String(value ?? "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(token) ? token : "";
}

/** Pure resolution order: `?table=` wins over the stored value, otherwise the placeholder. */
export function resolveTableNo(search: string, stored: string | null, storedToken: string | null = null): TableIdentity {
  const params = new URLSearchParams(search);
  const fromUrl = normalizeTableNo(params.get("table"));
  const urlToken = normalizeToken(params.get("k"));
  if (fromUrl) return { tableNo: fromUrl, configured: true, token: urlToken || (normalizeTableNo(stored) === fromUrl ? normalizeToken(storedToken) : "") };
  const fromStorage = normalizeTableNo(stored);
  if (fromStorage) return { tableNo: fromStorage, configured: true, token: normalizeToken(storedToken) };
  return { tableNo: DEFAULT_TABLE_NO, configured: false, token: "" };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persist(key: string, value: string, previous: string | null): void {
  if (value === previous) return;
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* Private browsing keeps the table for this session only. */
  }
}

export function tableIdentity(): TableIdentity {
  const stored = read(storageKey);
  const identity = resolveTableNo(location.search, stored, read(tokenKey));
  if (identity.configured) {
    persist(storageKey, identity.tableNo, stored);
    persist(tokenKey, identity.token, read(tokenKey));
  }
  return identity;
}

export function tableNo(): string {
  return tableIdentity().tableNo;
}

/** The table this device was actually given, or null. The menu must not show
 *  the placeholder: "Table 08" on a phone that scanned no card is made up. */
export function assignedTableNo(): string | null {
  const identity = tableIdentity();
  return identity.configured ? identity.tableNo : null;
}

export function tableToken(): string {
  return tableIdentity().token;
}

/** @returns the stored table number, or null when the input is not a valid table. */
export function setTableNo(value: string): string | null {
  const normalized = normalizeTableNo(value);
  if (!normalized) return null;
  try {
    localStorage.setItem(storageKey, normalized);
  } catch {
    /* Private browsing keeps the table for this session only. */
  }
  return normalized;
}
