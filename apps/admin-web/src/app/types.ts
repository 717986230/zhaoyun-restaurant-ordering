import type { ApiBill, ApiOrder, ApiPrintJob, ApiServiceRequest, MenuThemeId } from "@zhaoyun/contracts";
import type { AuditEntry, RestaurantTable, StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { DiscoveredPrinter, PrinterProfile, Product } from "@zhaoyun/domain";

export type AdminTab = "catalog" | "board" | "tables" | "printers" | "system";
export type ProductFilter = "all" | "food" | "drink" | "sushi";

export interface AdminState {
  tab: AdminTab;
  role: StaffRole | null;
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
