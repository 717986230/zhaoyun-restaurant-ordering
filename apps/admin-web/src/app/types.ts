import type { ApiBill, ApiOrder, ApiPrintJob, ApiServiceRequest, MenuThemeId } from "@zhaoyun/contracts";
import type { AuditEntry, RestaurantTable, StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { DiscoveredPrinter, PrinterProfile, Product } from "@zhaoyun/domain";

export type AdminTab = "catalog" | "board" | "tables" | "printers" | "system";
export type ProductFilter = "all" | "food" | "drink" | "sushi";

/**
 * What the console knows about the door in front of it. `checking` is the
 * moment before the server has answered, and it is a state of its own: drawing
 * "set a password" and then flipping it to "type the password" is how someone
 * ends up setting a password that was already set.
 */
export interface GateState {
  checking: boolean;
  configured: boolean;
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
  gate: GateState;
  auditEntries: AuditEntry[];
  connected: boolean;
  connectionText: string;
  products: Product[];
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  failedJobs: ApiPrintJob[];
  bill: ApiBill | null;
  tables: RestaurantTable[];
  tableOverview: TableOverview[];
  boardBusy: boolean;
  printers: PrinterProfile[];
  discoveredPrinters: DiscoveredPrinter[];
  editingProduct: Product | null;
  editingPrinter: PrinterProfile | null;
  productFilter: ProductFilter;
  menuTheme: MenuThemeId | null;
  toast: { message: string; kind: "success" | "warning" | "error" } | null;
}
