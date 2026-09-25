import { Type } from "@sinclair/typebox";
import { PRINT_JOB_STATUSES } from "../src/contracts.js";

// Request bodies are the shared wire contract; only the route-shaped schemas
// below are server-local.
export {
  CategoryRenameBody, CategoryVatBody, CheckoutBody, StornoBody, CreateOrderBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody,
  ServiceStatusBody, SetPasswordBody, SettingsBody, SignInBody, TableBody, TableLockBody
} from "../src/contracts.js";

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 128 }) });
const TableParams = Type.Object({ table: Type.String({ minLength: 1, maxLength: 8 }) });
const LimitQuery = Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) });

export const PrintJobsQuery = Type.Object({
  status: Type.Optional(Type.Union(PRINT_JOB_STATUSES.map((status) => Type.Literal(status)))),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
});

// A voucher code as printed (ABCDE-FGHJK), or typed without the dash.
const VoucherParams = Type.Object({ code: Type.String({ minLength: 1, maxLength: 32 }) });
// The journal between two days: from inclusive, to exclusive (YYYY-MM-DD).
const IsoDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const JournalQuery = Type.Object({ from: IsoDate, to: IsoDate });

export { IdParams, JournalQuery, LimitQuery, TableParams, VoucherParams };
