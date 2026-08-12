import type { ApiBill, ApiOrder, ApiPrintJob, ApiServiceRequest } from "@zhaoyun/contracts";
import type { RestaurantTable } from "@zhaoyun/api-client";
import type { DiscoveredPrinter, PrinterProfile, Product } from "@zhaoyun/domain";

export type AdminTab = "catalog" | "board" | "printers" | "system";
export type ProductFilter = "all" | "food" | "drink" | "sushi";

export interface AdminState {
  tab: AdminTab;
  connected: boolean;
  connectionText: string;
  products: Product[];
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  failedJobs: ApiPrintJob[];
  bill: ApiBill | null;
  tables: RestaurantTable[];
  boardBusy: boolean;
  printers: PrinterProfile[];
  discoveredPrinters: DiscoveredPrinter[];
  editingProduct: Product | null;
  editingPrinter: PrinterProfile | null;
  productFilter: ProductFilter;
  toast: { message: string; kind: "success" | "warning" | "error" } | null;
}
