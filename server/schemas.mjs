import { Type } from "@sinclair/typebox";
import { PRINT_JOB_STATUSES } from "../src/contracts.js";

// Request bodies are the shared wire contract; only the route-shaped schemas
// below are server-local.
export {
  CategoryRenameBody, CategoryVatBody, CheckoutBody, StornoBody, StaffBody, DeviceBody, PosSignInBody, MoveTableBody, SettlementBody, CreateOrderBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody,
  ServiceStatusBody, SettingsBody, TableBody, TableLockBody, RegisterBody, AccountSignInBody, AccountUpdateBody, AccountRecoverBody, VoidBody, AvailabilityBody,
  GuestOrderBody, CustomerRegisterBody, CustomerSignInBody, CustomerUpdateBody, CustomerDeleteBody, PointsAdjustBody, CustomerPasswordBody, TableOrderingBody
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
// The journal between two moments: from inclusive, to exclusive. A day
// (YYYY-MM-DD, UTC) or an instant (the console sends the restaurant's
// midnights as ISO times, so a day is its own day, not UTC's).
const IsoDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z)?$" });
const JournalQuery = Type.Object({ from: IsoDate, to: IsoDate });

export { IdParams, JournalQuery, LimitQuery, TableParams, VoucherParams };
