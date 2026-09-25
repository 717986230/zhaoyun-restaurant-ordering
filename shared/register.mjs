/**
 * The cash register (Registrierkasse), with no database attached: what a
 * receipt is, what it paid for, how a storno undoes one, what the day's
 * closing adds up, and the journal every business event is written into.
 *
 * Both backends call these and only read and write the rows, the way they
 * do for orders (shared/rules.mjs).
 *
 * What the law asks, in short (RKSV, § 131 and § 132a BAO):
 * - Every sale gets a receipt with a running number, the date and time, what
 *   was sold (quantity and name), the amount, and the amount per VAT rate.
 * - A receipt is never changed or deleted. A mistake is undone by a storno
 *   receipt that refers to it and carries the same lines negated.
 * - Every business event is recorded completely, in order, and in a way
 *   that shows if anything was changed afterwards: the journal (the "DEP 131"
 *   the tax office reads beside the register's signed "DEP 7"). Each entry
 *   carries the hash of the one before it, so an entry changed, removed or
 *   put in between breaks the chain from there on.
 *
 * The receipt's signature (fiskaly SIGN AT) is not here yet. Until it is, a
 * receipt is `unsigned` and says so when printed: it is a test receipt, not
 * a Kassenbeleg.
 */

import { now, parseJson, uuid } from "./rules.mjs";

export const PAYMENT_TYPES = ["cash", "card", "voucher"];
/** The hash the first journal entry follows. */
export const GENESIS_HASH = "0".repeat(64);
export const MAX_VOUCHER_CENTS = 100_000;

/**
 * How much of an order line receipts have paid for. A receipt cancelled by
 * a storno pays for nothing, so its lines are open again.
 */
const PAID_QUANTITY = `(SELECT COALESCE(SUM(receipt_items.quantity), 0) FROM receipt_items
    WHERE receipt_items.order_item_id = order_items.id
      AND NOT EXISTS (SELECT 1 FROM receipts AS storno WHERE storno.refers_to = receipt_items.receipt_id))`;

/** An order's lines, with their VAT split and how much of each is paid. */
export const ORDER_ITEMS_SQL = `SELECT order_items.*, order_item_vat_splits.split_json AS vat_split_json, ${PAID_QUANTITY} AS paid_quantity
FROM order_items LEFT JOIN order_item_vat_splits ON order_item_vat_splits.order_item_id = order_items.id
WHERE order_items.order_id = ?`;

/** Order lines by id, with what planCheckout needs of their order. */
export const CHECKOUT_ITEMS_SQL = `SELECT order_items.*, orders.table_no, orders.status, orders.billed_at, orders.order_no,
  order_item_vat_splits.split_json AS vat_split_json, ${PAID_QUANTITY} AS paid_quantity
FROM order_items JOIN orders ON orders.id = order_items.order_id
LEFT JOIN order_item_vat_splits ON order_item_vat_splits.order_item_id = order_items.id
WHERE order_items.id IN (?)`;

/** Whether any line of an order is on a receipt still standing. */
export const ORDER_PAID_SQL = `SELECT 1 FROM order_items WHERE order_items.order_id = ? AND ${PAID_QUANTITY} > 0 LIMIT 1`;

export const DEBIT_VOUCHER_SQL = "UPDATE vouchers SET balance_cents = balance_cents - ?, updated_at = ? WHERE code = ? AND voided_at IS NULL";
export const CREDIT_VOUCHER_SQL = "UPDATE vouchers SET balance_cents = balance_cents + ?, updated_at = ? WHERE code = ?";
export const VOID_VOUCHER_SQL = "UPDATE vouchers SET balance_cents = 0, voided_at = ?, updated_at = ? WHERE code = ?";
export const INSERT_VOUCHER_SQL = "INSERT INTO vouchers (code, value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)";
/** A storno's order lines are open again, so their orders are no longer billed. */
export const REOPEN_ORDERS_SQL = `UPDATE orders SET billed_at = NULL, updated_at = ?
  WHERE id IN (SELECT order_items.order_id FROM receipt_items JOIN order_items ON order_items.id = receipt_items.order_item_id WHERE receipt_items.receipt_id = ?)`;
/** The receipts not yet in a day's closing. */
export const OPEN_RECEIPTS_SQL = "SELECT * FROM receipts WHERE receipt_no > COALESCE((SELECT MAX(last_receipt_no) FROM day_closings), 0) ORDER BY receipt_no";

/**
 * A table is paid when none of its open orders has a line with anything
 * left to pay. Run after a receipt is written, in the same transaction or
 * batch, it marks those orders billed and frees the table.
 */
export const TABLE_PAID_SQL = `NOT EXISTS (
  SELECT 1 FROM order_items JOIN orders AS open_orders ON open_orders.id = order_items.order_id
  WHERE open_orders.table_no = ? AND open_orders.billed_at IS NULL AND open_orders.status <> 'cancelled'
    AND order_items.quantity > (SELECT COALESCE(SUM(receipt_items.quantity), 0) FROM receipt_items
      WHERE receipt_items.order_item_id = order_items.id
        AND NOT EXISTS (SELECT 1 FROM receipts AS storno WHERE storno.refers_to = receipt_items.receipt_id)))`;
export const SETTLE_PAID_TABLE_SQL = `UPDATE orders SET billed_at = ?, updated_at = ?
  WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled' AND ${TABLE_PAID_SQL}`;
export const UNLOCK_PAID_TABLE_SQL = `UPDATE restaurant_tables SET locked_at = NULL, updated_at = ?
  WHERE table_no = ? AND ${TABLE_PAID_SQL}`;

/** What the journal keeps of a new order: every line, at its price and rates. */
export function orderJournalPayload(plan) {
  return {
    orderId: plan.order.id,
    orderNo: plan.order.orderNo,
    table: plan.order.table,
    note: plan.order.note,
    totalCents: plan.order.totalCents,
    items: plan.items.map((item) => ({
      orderItemId: item.id,
      productId: item.productId,
      name: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      vatPercent: item.vatPercent,
      ...(item.vatSplitJson ? { vatSplit: JSON.parse(item.vatSplitJson) } : {}),
      modifiers: parseJson(item.modifiersJson, []).map((modifier) => modifier.name)
    }))
  };
}

/** The text a journal entry's hash is taken over: the one before it, then itself. */
export function journalText({ seq, at, kind, ref, payloadJson, prevHash }) {
  return [prevHash, seq, at, kind, ref ?? "", payloadJson].join("\n");
}

/**
 * The next journal entry after `last` (null for the first). The hash is the
 * backend's to take (Node's hashes synchronously inside its transaction,
 * the Worker's with Web Crypto), over journalText.
 */
export function journalEntry(last, kind, ref, payload, at = now()) {
  return {
    seq: (last?.seq ?? 0) + 1,
    at,
    kind,
    ref: ref ?? null,
    payloadJson: JSON.stringify(payload),
    prevHash: last?.hash ?? GENESIS_HASH
  };
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Checks a run of journal rows, oldest first: each follows the one before
 * it and its hash is what its content gives. `before` is the row just
 * before the run (null when the run starts at the first entry).
 */
export async function verifyJournal(rows, before = null) {
  let previous = before;
  for (const row of rows) {
    const expectedSeq = previous ? previous.seq + 1 : 1;
    const expectedPrev = previous ? previous.hash : GENESIS_HASH;
    if (row.seq !== expectedSeq || row.prev_hash !== expectedPrev) return { ok: false, brokenAt: row.seq, reason: "chain" };
    const hash = await sha256Hex(journalText({ seq: row.seq, at: row.at, kind: row.kind, ref: row.ref, payloadJson: row.payload_json, prevHash: row.prev_hash }));
    if (hash !== row.hash) return { ok: false, brokenAt: row.seq, reason: "content" };
    previous = row;
  }
  return { ok: true, brokenAt: null, reason: null };
}

export function journalView(row) {
  return { seq: row.seq, at: row.at, kind: row.kind, ref: row.ref, payload: parseJson(row.payload_json, {}), prevHash: row.prev_hash, hash: row.hash };
}

/** Gross cents per rate to the receipt's VAT lines, extracted once per rate. */
function vatGroups(parts) {
  const groups = new Map();
  for (const { percent, cents } of parts) groups.set(percent, (groups.get(percent) || 0) + cents);
  return [...groups].sort(([left], [right]) => left - right).map(([percent, grossCents]) => {
    const netCents = Math.round(grossCents / (1 + percent / 100));
    return { percent, grossCents, netCents, vatCents: grossCents - netCents };
  });
}

function cents(value, what) {
  const amount = Math.round(Number(value) * 100);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${what} must be more than zero`);
  return amount;
}

function voucherCode() {
  // No 0/O or 1/I: read aloud or typed from paper, they get mixed up.
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("").replace(/^(.{5})/, "$1-");
}

export function normalizeVoucherCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^(.{5})/, "$1-");
}

/**
 * A sale, checked and worked out: its lines, VAT, payments and the rows to
 * write. Throws with a message the cashier can read when something does not
 * add up.
 *
 * - `input.items`: which order lines and how many of each ([{ orderItemId,
 *   quantity }]); a guest paying for their own dishes is a receipt of those
 *   lines, the next guest's is another (split bill).
 * - `input.vouchers`: vouchers sold ([{ amount }]). A value voucher is not a
 *   sale of anything yet (Mehrzweckgutschein): it is on the receipt at 0% and
 *   the VAT is due when it is spent on food or drink.
 * - `input.payments`: [{ type, amount, tendered?, voucherCode? }], adding up
 *   to the total exactly; cash may be handed over with more (`tendered`),
 *   and the change is worked out.
 *
 * `itemRows` are the order lines named, each with its order's table_no,
 * status and billed_at, and paid_quantity (ORDER_ITEMS_SQL). `voucherRows`
 * are the vouchers paid with, by code.
 */
export function planCheckout(input, { itemRows, voucherRows, receiptNo, settings, role, at = now() }) {
  const byId = new Map(itemRows.map((row) => [String(row.id), row]));
  const requested = Array.isArray(input.items) ? input.items : [];
  const soldVouchers = Array.isArray(input.vouchers) ? input.vouchers : [];
  if (!requested.length && !soldVouchers.length) throw new Error("A receipt needs at least one line");

  const lines = [];
  const receiptItems = [];
  const vatParts = [];
  // The table as its orders were written; compared without case.
  let table = input.table ? String(input.table).trim() : null;
  const seen = new Set();
  for (const request of requested) {
    const id = String(request.orderItemId ?? "");
    const row = byId.get(id);
    if (!row || seen.has(id)) throw new Error(`Order line ${id} cannot be paid here`);
    seen.add(id);
    if (row.status === "cancelled" || row.billed_at) throw new Error(`Order line ${id} is not open`);
    if (table && String(row.table_no).toUpperCase() !== table.toUpperCase()) throw new Error("A receipt is for one table");
    table = String(row.table_no);
    const quantity = Number(request.quantity);
    const open = row.quantity - (row.paid_quantity ?? 0);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > open) throw new Error(`Only ${open} of ${row.product_name} are left to pay`);
    const unitSplit = parseJson(row.vat_split_json, null) ?? [{ percent: row.vat_percent, cents: row.unit_price_cents }];
    const split = unitSplit.map((part) => ({ percent: part.percent, cents: part.cents * quantity }));
    vatParts.push(...split);
    lines.push({
      kind: "item",
      orderItemId: id,
      productId: row.product_id,
      name: row.product_name,
      modifiers: parseJson(row.modifiers_json, []).map((modifier) => modifier.name),
      quantity,
      unitPriceCents: row.unit_price_cents,
      totalCents: row.unit_price_cents * quantity,
      vatSplit: split
    });
    receiptItems.push({ orderItemId: id, quantity });
  }

  const vouchers = [];
  for (const sold of soldVouchers) {
    const valueCents = cents(sold.amount, "A voucher");
    if (valueCents > MAX_VOUCHER_CENTS) throw new Error("A voucher is at most 1000 euros");
    const code = voucherCode();
    vouchers.push({ code, valueCents });
    vatParts.push({ percent: 0, cents: valueCents });
    lines.push({ kind: "voucher", code, name: "Gutschein", quantity: 1, unitPriceCents: valueCents, totalCents: valueCents, vatSplit: [{ percent: 0, cents: valueCents }] });
  }

  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const payments = [];
  const voucherDebits = new Map();
  const available = new Map(voucherRows.map((row) => [row.code, row]));
  for (const payment of Array.isArray(input.payments) ? input.payments : []) {
    const type = String(payment.type);
    if (!PAYMENT_TYPES.includes(type)) throw new Error("Payment is cash, card or voucher");
    const amountCents = cents(payment.amount, "A payment");
    const entry = { type, amountCents };
    if (type === "cash" && payment.tendered !== undefined && payment.tendered !== null && payment.tendered !== "") {
      const tenderedCents = cents(payment.tendered, "The cash handed over");
      if (tenderedCents < amountCents) throw new Error("Less cash was handed over than it pays");
      entry.tenderedCents = tenderedCents;
      entry.changeCents = tenderedCents - amountCents;
    }
    if (type === "voucher") {
      if (vouchers.length) throw new Error("A voucher cannot pay for a voucher");
      const code = normalizeVoucherCode(payment.voucherCode);
      const voucher = available.get(code);
      if (!voucher || voucher.voided_at) throw new Error(`No voucher ${code || "without a code"}`);
      const debit = (voucherDebits.get(code) || 0) + amountCents;
      if (debit > voucher.balance_cents) throw new Error(`Voucher ${code} has ${(voucher.balance_cents / 100).toFixed(2)} left`);
      voucherDebits.set(code, debit);
      entry.voucherCode = code;
    }
    payments.push(entry);
  }
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  if (paidCents !== totalCents) throw new Error(`The payments add up to ${(paidCents / 100).toFixed(2)}, the receipt to ${(totalCents / 100).toFixed(2)}`);

  const receipt = {
    id: uuid(),
    receiptNo,
    clientRequestId: String(input.clientRequestId || uuid()),
    cashRegisterId: settings.cashRegisterId,
    type: "sale",
    table,
    lines,
    vat: vatGroups(vatParts),
    totalCents,
    payments,
    refersTo: null,
    staffRole: role,
    createdAt: at
  };
  return { receipt, receiptItems, vouchers, voucherDebits: [...voucherDebits].map(([code, amountCents]) => ({ code, amountCents })) };
}

/**
 * The storno of a receipt: the same lines, VAT and payments negated, under
 * a number of its own, referring to the original. Its order lines are open
 * again (ORDER_ITEMS_SQL), to be paid on a new receipt or cancelled; the
 * vouchers it spent get their money back; vouchers it sold are voided, which
 * only an unspent voucher can be.
 */
export function planStorno(original, { receiptNo, reason, soldVoucherRows, role, at = now() }) {
  if (original.type !== "sale") throw new Error("Only a sale can be cancelled");
  const text = String(reason ?? "").trim();
  if (!text) throw new Error("A storno needs a reason");
  for (const voucher of soldVoucherRows) {
    if (voucher.voided_at || voucher.balance_cents !== voucher.value_cents) throw new Error(`Voucher ${voucher.code} has been used and cannot be taken back`);
  }
  const lines = parseJson(original.lines_json, []).map((line) => ({
    ...line,
    quantity: -line.quantity,
    totalCents: -line.totalCents,
    vatSplit: line.vatSplit.map((part) => ({ percent: part.percent, cents: -part.cents }))
  }));
  const payments = parseJson(original.payments_json, []).map((payment) => ({
    type: payment.type,
    amountCents: -payment.amountCents,
    ...(payment.voucherCode ? { voucherCode: payment.voucherCode } : {})
  }));
  const receipt = {
    id: uuid(),
    receiptNo,
    clientRequestId: uuid(),
    cashRegisterId: original.cash_register_id,
    type: "storno",
    table: original.table_no,
    lines,
    vat: parseJson(original.vat_json, []).map((group) => ({ percent: group.percent, grossCents: -group.grossCents, netCents: -group.netCents, vatCents: -group.vatCents })),
    totalCents: -original.total_cents,
    payments,
    refersTo: original.id,
    reason: text,
    staffRole: role,
    createdAt: at
  };
  const refunds = payments.filter((payment) => payment.type === "voucher").map((payment) => ({ code: payment.voucherCode, amountCents: -payment.amountCents }));
  return { receipt, refunds, voided: soldVoucherRows.map((voucher) => voucher.code) };
}

/** A receipt as the rows store it. */
export function receiptRow(receipt) {
  return [
    receipt.id, receipt.receiptNo, receipt.clientRequestId, receipt.cashRegisterId, receipt.type, receipt.table,
    JSON.stringify(receipt.lines), JSON.stringify(receipt.vat), receipt.totalCents, JSON.stringify(receipt.payments),
    receipt.refersTo, receipt.reason ?? null, receipt.staffRole, receipt.createdAt
  ];
}
export const INSERT_RECEIPT_SQL = `INSERT INTO receipts (id, receipt_no, client_request_id, cash_register_id, type, table_no,
  lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const INSERT_JOURNAL_SQL = "INSERT INTO journal (seq, at, kind, ref, payload_json, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)";

/** A receipt as the console and the printer read it. */
export function receiptView(row, { cancelledBy = null, referredNo = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    cashRegisterId: row.cash_register_id,
    type: row.type,
    table: row.table_no,
    lines: parseJson(row.lines_json, []),
    vat: parseJson(row.vat_json, []),
    totalCents: row.total_cents,
    payments: parseJson(row.payments_json, []),
    refersTo: row.refers_to,
    refersToNo: referredNo,
    reason: row.reason,
    cancelledBy,
    fiscalStatus: row.fiscal_status,
    staffRole: row.staff_role,
    createdAt: row.created_at
  };
}

/**
 * A planned receipt as receiptView shows it once written. The journal entry
 * and the print job are made from this, inside the same write, so both
 * backends journal exactly the same thing.
 */
export function plannedReceiptView(receipt, referredNo = null) {
  const [id, receiptNo, , cashRegisterId, type, table, linesJson, vatJson, totalCents, paymentsJson, refersTo, reason, staffRole, createdAt] = receiptRow(receipt);
  return receiptView({
    id, receipt_no: receiptNo, cash_register_id: cashRegisterId, type, table_no: table, lines_json: linesJson, vat_json: vatJson,
    total_cents: totalCents, payments_json: paymentsJson, refers_to: refersTo, reason, staff_role: staffRole, created_at: createdAt,
    fiscal_status: "unsigned"
  }, { referredNo });
}

/** Who issues the receipts, as printed at their head. */
export function companyOf(settings) {
  return { name: settings.companyName || settings.restaurantName, address: settings.companyAddress, uid: settings.companyUid };
}

/** What goes to the front printer for a receipt. */
export function receiptPrintPayload(view, settings) {
  return { kind: "receipt", company: companyOf(settings), receipt: view };
}

/** What goes to the front printer for a day's closing. */
export function closingPrintPayload(view, settings) {
  return { kind: "closing", company: companyOf(settings), cashRegisterId: settings.cashRegisterId, closing: view };
}

/**
 * The day's closing (Z report) over the receipts since the last one: how
 * many, the number range, the takings per VAT rate and per payment type,
 * vouchers sold, and the cash that should be in the drawer. Stornos count
 * negative, so a cancelled sale adds up to nothing.
 */
export function closingTotals(rows) {
  const vatParts = [];
  const payments = Object.fromEntries(PAYMENT_TYPES.map((type) => [type, 0]));
  let grossCents = 0;
  let vouchersSoldCents = 0;
  let sales = 0;
  let stornos = 0;
  for (const row of rows) {
    if (row.type === "storno") stornos += 1; else sales += 1;
    grossCents += row.total_cents;
    for (const group of parseJson(row.vat_json, [])) vatParts.push({ percent: group.percent, cents: group.grossCents });
    for (const payment of parseJson(row.payments_json, [])) payments[payment.type] += payment.amountCents;
    for (const line of parseJson(row.lines_json, [])) if (line.kind === "voucher") vouchersSoldCents += line.totalCents;
  }
  const numbers = rows.map((row) => row.receipt_no);
  return {
    sales,
    stornos,
    firstReceiptNo: numbers.length ? Math.min(...numbers) : null,
    lastReceiptNo: numbers.length ? Math.max(...numbers) : null,
    grossCents,
    vat: vatGroups(vatParts).filter((group) => group.grossCents !== 0),
    payments,
    vouchersSoldCents,
    cashCents: payments.cash
  };
}

export function closingView(row) {
  if (!row) return null;
  return { id: row.id, closingNo: row.closing_no, totals: parseJson(row.totals_json, {}), createdAt: row.created_at };
}
