const storageKey = "zy_table_no";

/** Used only until a device has been assigned to a real table. */
export const DEFAULT_TABLE_NO = "08";

export interface TableIdentity {
  /** Table number sent with every order and service request. */
  tableNo: string;
  /** False while the device still runs on the placeholder table. */
  configured: boolean;
}

export function normalizeTableNo(value: string | null | undefined): string | null {
  const candidate = String(value ?? "").trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{0,7}$/.test(candidate) ? candidate : null;
}

/** Pure resolution order: `?table=` wins over the stored value, otherwise the placeholder. */
export function resolveTableNo(search: string, stored: string | null): TableIdentity {
  const fromUrl = normalizeTableNo(new URLSearchParams(search).get("table"));
  if (fromUrl) return { tableNo: fromUrl, configured: true };
  const fromStorage = normalizeTableNo(stored);
  if (fromStorage) return { tableNo: fromStorage, configured: true };
  return { tableNo: DEFAULT_TABLE_NO, configured: false };
}

function read(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

export function tableIdentity(): TableIdentity {
  const stored = read();
  const identity = resolveTableNo(location.search, stored);
  if (identity.configured && identity.tableNo !== stored) {
    try {
      localStorage.setItem(storageKey, identity.tableNo);
    } catch {
      /* Private browsing keeps the table for this session only. */
    }
  }
  return identity;
}

export function tableNo(): string {
  return tableIdentity().tableNo;
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
