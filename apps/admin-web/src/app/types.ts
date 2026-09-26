import type { PosStaffActivity, ApiAccount, ApiBill, ApiOrder, ApiPrintJob, ApiServiceRequest, ApiSettings } from "@zhaoyun/contracts";
import type { AuditEntry, RestaurantTable, StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { DiscoveredPrinter, PrinterProfile, Product } from "@zhaoyun/domain";

export type AdminTab = "catalog" | "board" | "tables" | "printers" | "system";
/** "sets" is every dish that packages others, whatever its kind. */
export type ProductFilter = "all" | "food" | "drink" | "sushi" | "sets";

/**
 * What the console knows about the door in front of it. `checking` is the
 * moment before the server has answered, and it is a state of its own: drawing
 * "register" and then flipping it to "sign in" is how someone ends up trying
 * to register an account that already exists.
 */
export interface GateState {
  checking: boolean;
  /** Whether the restaurant's account exists: sign in if so, register if not. */
  registered: boolean;
  busy: boolean;
  error: string | null;
  /** False when the backend could not be reached at all. Then the problem is
   *  the address, not the password, so the console shows the connection tab
   *  instead of a door nobody can open. */
  reachable: boolean;
}

export interface AdminState {
  tab: AdminTab;
  role: StaffRole | null;
  /** The account signed in, or null for a device opened with a configured token. */
  account: ApiAccount | null;
  gate: GateState;
  auditEntries: AuditEntry[];
  connected: boolean;
  /** Why the last attempt to reach the backend failed, when it did. */
  connectionError: string | null;
  products: Product[];
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  failedJobs: ApiPrintJob[];
  bill: ApiBill | null;
  tables: RestaurantTable[];
  tableOverview: TableOverview[];
  /** The waiters as the floor has them now; the manager's view only. */
  staffActivity: PosStaffActivity[];
  boardBusy: boolean;
  printers: PrinterProfile[];
  discoveredPrinters: DiscoveredPrinter[];
  editingProduct: Product | null;
  editingPrinter: PrinterProfile | null;
  productFilter: ProductFilter;
  /** Null until the console has loaded them, and for roles that cannot. */
  settings: ApiSettings | null;
  toast: { message: string; kind: "success" | "warning" | "error" } | null;
}
