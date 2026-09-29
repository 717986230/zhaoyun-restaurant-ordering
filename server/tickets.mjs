/**
 * What a printer prints, as ESC/POS bytes.
 *
 * Every ticket is laid out here for the printer it goes to (shared/printing.mjs,
 * printerOptions): in that printer's language, with an optional second one under
 * each dish, as wide as its paper, in the characters its encoding can show.
 * The kitchen's tickets carry what the kitchens of the mature systems ask for —
 * the table or pickup number large, the station, the time, dishes large if the
 * printer is set so, one ticket per dish (一菜一单) and extra copies — and the
 * receipts stay plain, as the register law has them.
 *
 * A line is a string, `{ text, size, bold, center, indent }` or
 * `{ left, right }` (an amount on the right); the encoder wraps and pads them
 * once the text is in the characters the printer will get, so a column never
 * drifts because an umlaut became two letters or a Chinese character is two
 * columns wide.
 */
import iconv from "iconv-lite";
import { printerOptions, resolvedEncoding } from "../shared/printing.mjs";

const ESC = 0x1b;
const GS = 0x1d;

export const labels = {
  zh: {
    title: "赵云餐厅", order: "订单", table: "桌号", note: "备注",
    bill: "账单", total: "合计", net: "净额", vat: "增值税", rate: "税率",
    disclaimer: "内部账单，不是税务收据",
    kitchen: "后厨单 · 不是收据",
    unsigned: "测试小票 · 未签名（RKSV）", receipt: "小票", register: "收银机", storno: "冲销", stornoOf: "冲销小票 {no}",
    sum: "合计", cash: "现金", card: "银行卡", voucher: "代金券", tendered: "收", change: "找零", gross: "含税",
    voucherCode: "代金券码", closing: "日结", sales: "销售", stornos: "冲销", receipts: "小票", vouchersSold: "售出代金券", uid: "UID",
    waiter: "服务员", pickup: "外带 取餐号", settlement: "跑堂结算", discount: "折扣", tip: "小费", tips: "小费（不计营业额）", handIn: "应交现金",
    drawer: "点钞 · 交班", float: "备用金", cashSales: "现金收入", payIn: "存入", payOut: "取出", cardTips: "卡付小费（付给员工）", expected: "应有现金", counted: "实点现金", difference: "差额", opened: "开班", countedBy: "点钞",
    voidTicket: "*** 退菜 · 停止制作 ***", reason: "原因", voids: "退菜", receiptCopy: "*** 小票副本 ***",
    guestDineIn: "*** 顾客扫码点餐 ***", guestPickup: "*** 线上自取 ***",
    deliveryDelivery: "外送", deliveryPickup: "到店自取", due: "取餐时间",
    stations: { kitchen: "厨房", bar: "吧台", sushi: "寿司台", front: "前台" },
    standIn: "*** 代打：{name} ***", part: "第 {n}/{total} 张",
    test: "打印测试", testPrinter: "打印机", testStation: "档口", testLanguage: "语言", testEncoding: "编码", testPaper: "纸宽", testOk: "能看清下面三种文字、这一行没有被截断，就设置好了。"
  },
  de: {
    title: "ZHAO YUN RESTAURANT", order: "Bestellung", table: "Tisch", note: "Notiz",
    bill: "Rechnung", total: "Gesamt", net: "Netto", vat: "MwSt", rate: "Satz",
    disclaimer: "Interne Rechnung, kein Kassenbeleg",
    kitchen: "KÜCHENBON – KEIN BELEG",
    unsigned: "TESTBELEG – NICHT SIGNIERT", receipt: "Beleg", register: "Kasse", storno: "STORNO", stornoOf: "Storno zu Beleg {no}",
    sum: "SUMME", cash: "Bar", card: "Karte", voucher: "Gutschein", tendered: "gegeben", change: "Rückgeld", gross: "Brutto",
    voucherCode: "Gutschein-Code", closing: "TAGESABSCHLUSS", sales: "Verkäufe", stornos: "Stornos", receipts: "Belege", vouchersSold: "Gutscheine verkauft", uid: "UID",
    waiter: "Kellner", pickup: "ABHOLUNG Nr.", settlement: "KELLNERABRECHNUNG", discount: "Rabatt", tip: "Trinkgeld", tips: "Trinkgeld (kein Umsatz)", handIn: "Abzugeben bar",
    drawer: "KASSENSTURZ", float: "Wechselgeld Anfang", cashSales: "Bareinnahmen", payIn: "Einlage", payOut: "Entnahme", cardTips: "Kartentrinkgeld ausbezahlt", expected: "Soll", counted: "Ist (gezählt)", difference: "Differenz", opened: "Geöffnet", countedBy: "Gezählt",
    voidTicket: "*** STORNO – NICHT ZUBEREITEN ***", reason: "Grund", voids: "Stornos", receiptCopy: "*** BELEGKOPIE ***",
    guestDineIn: "*** GAST-BESTELLUNG (QR) ***", guestPickup: "*** ONLINE – ABHOLUNG ***",
    deliveryDelivery: "LIEFERUNG", deliveryPickup: "ABHOLUNG", due: "Fertig um",
    stations: { kitchen: "KÜCHE", bar: "BAR", sushi: "SUSHI", front: "KASSE" },
    standIn: "*** ERSATZ FÜR {name} ***", part: "Bon {n}/{total}",
    test: "TESTDRUCK", testPrinter: "Drucker", testStation: "Station", testLanguage: "Sprache", testEncoding: "Kodierung", testPaper: "Papier", testOk: "Sind alle drei Schriften lesbar und diese Zeile nicht abgeschnitten, passt alles."
  },
  en: {
    title: "ZHAO YUN RESTAURANT", order: "Order", table: "Table", note: "Note",
    bill: "Bill", total: "Total", net: "Net", vat: "VAT", rate: "Rate",
    disclaimer: "Internal bill, not a fiscal receipt",
    kitchen: "Kitchen ticket – not a receipt",
    unsigned: "TEST RECEIPT – NOT SIGNED", receipt: "Receipt", register: "Register", storno: "CANCELLATION", stornoOf: "Cancels receipt {no}",
    sum: "TOTAL", cash: "Cash", card: "Card", voucher: "Voucher", tendered: "given", change: "change", gross: "Gross",
    voucherCode: "Voucher code", closing: "DAY CLOSING", sales: "sales", stornos: "cancellations", receipts: "Receipts", vouchersSold: "Vouchers sold", uid: "UID",
    waiter: "Waiter", pickup: "TAKEAWAY No.", settlement: "WAITER SETTLEMENT", discount: "Discount", tip: "Tip", tips: "Tips (not takings)", handIn: "Cash to hand in",
    drawer: "CASH COUNT", float: "Float", cashSales: "Cash sales", payIn: "Paid in", payOut: "Paid out", cardTips: "Card tips paid out", expected: "Expected", counted: "Counted", difference: "Difference", opened: "Opened", countedBy: "Counted",
    voidTicket: "*** VOID – STOP COOKING ***", reason: "Reason", voids: "Voids", receiptCopy: "*** RECEIPT COPY ***",
    guestDineIn: "*** GUEST ORDER (QR) ***", guestPickup: "*** ONLINE PICKUP ***",
    deliveryDelivery: "DELIVERY", deliveryPickup: "COLLECTION", due: "Ready by",
    stations: { kitchen: "KITCHEN", bar: "BAR", sushi: "SUSHI", front: "FRONT" },
    standIn: "*** STANDING IN FOR {name} ***", part: "Ticket {n}/{total}",
    test: "TEST PRINT", testPrinter: "Printer", testStation: "Station", testLanguage: "Language", testEncoding: "Encoding", testPaper: "Paper", testOk: "If all three scripts are readable and this line is not cut off, it is set up."
  }
};

const LANGUAGE_NAMES = { zh: "中文", de: "Deutsch", en: "English" };
const COLUMNS = { 58: 32, 80: 48 };
const TIME_ZONE = "Europe/Vienna";

// ——— Columns. A Chinese character (or any East Asian wide one) takes two.

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

function charWidth(character) {
  return WIDE.test(character) || character.codePointAt(0) > 0xffff ? 2 : 1;
}

export function displayWidth(text) {
  let width = 0;
  for (const character of String(text)) width += charWidth(character);
  return width;
}

/** Lines no wider than `width`: at a space where there is one, anywhere in Chinese. */
export function wrap(text, width, indent = "") {
  const rows = [];
  let current = "";
  let used = 0;
  const room = () => width - (rows.length ? displayWidth(indent) : 0);
  for (const character of String(text)) {
    const size = charWidth(character);
    if (used + size > room() && current) {
      const space = size === 1 && character !== " " ? current.lastIndexOf(" ") : -1;
      if (space > 0) {
        rows.push(current.slice(0, space));
        current = current.slice(space + 1);
      } else {
        rows.push(current);
        current = "";
      }
      if (character === " " && !current) {
        used = 0;
        continue;
      }
      used = displayWidth(current);
    }
    current += character;
    used += size;
  }
  if (current || !rows.length) rows.push(current);
  return rows.map((row, index) => (index ? indent + row.trimStart() : row));
}

/** Text on the left, an amount on the right; a long name wraps and the amount keeps its column. */
function amountRows(left, right, width) {
  const amount = String(right);
  const room = width - displayWidth(amount) - 1;
  const rows = wrap(left, width, "  ");
  const last = rows[rows.length - 1];
  if (displayWidth(last) <= room) rows[rows.length - 1] = `${last}${" ".repeat(room - displayWidth(last))} ${amount}`;
  else rows.push(`${" ".repeat(width - displayWidth(amount))}${amount}`);
  return rows;
}

// ——— Characters. What the printer's encoding cannot show is written the way
// a person would write it without the key.

const UMLAUTS = { Ä: "Ae", Ö: "Oe", Ü: "Ue", ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

function forEncoding(text, encoding) {
  const plain = String(text).replace(/[\u0000-\u0009\u000b-\u001f]/g, "");
  if (encoding === "utf8") return plain;
  const ascii = plain.replace(/–/g, "-").replace(/€/g, "EUR").replace(/[„“”]/g, "\"").replace(/[‚‘’]/g, "'");
  // The Chinese and Japanese code pages have no umlauts; cp437 has them.
  return encoding === "cp437" ? ascii : ascii.replace(/[ÄÖÜäöüß]/g, (character) => UMLAUTS[character]);
}

// ——— Bytes.

const SIZE = { normal: 0x00, tall: 0x01, big: 0x11 };
const FS = 0x1c;
const MODE = { gb18030: [FS, 0x26], cp437: [FS, 0x2e, ESC, 0x74, 0x00] };

function encodeLines(lines, { width, encoding }) {
  const chunks = [];
  const text = (value) => chunks.push(iconv.encode(value, encoding));
  for (const entry of lines) {
    if (entry === null || entry === undefined || entry === false || entry === "") continue;
    if (entry === "\n") {
      text("\n");
      continue;
    }
    const line = typeof entry === "string" ? { text: entry } : entry;
    if (line.left !== undefined) {
      text(`${amountRows(forEncoding(line.left, encoding), forEncoding(line.right, encoding), width).join("\n")}\n`);
      continue;
    }
    const size = SIZE[line.size] ?? SIZE.normal;
    const columns = line.size === "big" ? Math.floor(width / 2) : width;
    const commands = [];
    if (line.center) commands.push(ESC, 0x61, 0x01);
    if (line.bold) commands.push(ESC, 0x45, 0x01);
    if (size) commands.push(GS, 0x21, size);
    if (commands.length) chunks.push(Buffer.from(commands));
    text(`${wrap(forEncoding(line.text, encoding), columns, line.indent ?? "").join("\n")}\n`);
    const reset = [];
    if (size) reset.push(GS, 0x21, 0x00);
    if (line.bold) reset.push(ESC, 0x45, 0x00);
    if (line.center) reset.push(ESC, 0x61, 0x00);
    if (reset.length) chunks.push(Buffer.from(reset));
  }
  return Buffer.concat(chunks);
}

// ——— Tickets.

function money(value) {
  return Number(value || 0).toFixed(2);
}
const euros = (cents) => (Number(cents || 0) / 100).toFixed(2);
const at = (iso) => (iso ? new Date(iso).toLocaleString("de-AT", { timeZone: TIME_ZONE }) : "");
const clock = (iso) => new Date(iso || Date.now()).toLocaleTimeString("de-AT", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

function companyLines(company = {}, copy) {
  return [company.name, company.address, company.uid ? `${copy.uid}: ${company.uid}` : ""].filter(Boolean);
}

/** A dish or an option in the printer's language, and in its second one if that differs.
 *  A name missing in a Latin language is the other Latin one before it is the Chinese. */
function named(entry, context) {
  const fallbacks = context.language === "zh" ? ["zh"] : [context.language, ...["de", "en"].filter((language) => language !== context.language)];
  const main = fallbacks.map((language) => entry.names?.[language]).find(Boolean) || entry.name || entry.sku || "Item";
  const second = context.second ? entry.names?.[context.second] : null;
  return { main, second: second && second !== main ? second : null };
}

/** A kitchen ticket: what to cook, for which table. No price and no tax —
 *  it is not a receipt, and says so. */
function orderLines(payload, context, part = null) {
  const { copy, rule } = context;
  // A void: the same ticket, marked, the quantities taken back, and why.
  const voiding = payload.kind === "void";
  const dish = context.largeText ? { size: "tall", bold: true } : {};
  const lines = [
    ...(voiding ? [{ text: copy.voidTicket, bold: true, center: true }] : []),
    // A guest ordered it from their phone: nobody at the pass took it down.
    ...(payload.guest ? [{ text: payload.guest.channel === "pickup" ? copy.guestPickup : copy.guestDineIn, bold: true, center: true }] : []),
    ...(context.standInFor ? [{ text: copy.standIn.replace("{name}", context.standInFor), bold: true, center: true }] : []),
    { text: copy.kitchen, center: true },
    { text: copy.title, center: true },
    ...(context.station ? [{ text: copy.stations[context.station] ?? context.station, bold: true, center: true }] : []),
    // A takeaway's pickup number is what the kitchen calls out; the table where
    // it is served otherwise. Either is the largest thing on the ticket.
    // A delivery platform's order: the platform and its number, the way the rider or the guest will say it.
    ...(payload.delivery ? [
      { text: `*** ${payload.delivery.name} · ${payload.delivery.type === "pickup" ? copy.deliveryPickup : copy.deliveryDelivery} ***`, bold: true, center: true },
      // Big print is half as many characters to a line: the number alone, as the rider will say it.
      { text: `#${payload.delivery.reference}`, size: "big", bold: true },
      ...(payload.delivery.dueAt ? [{ text: `${copy.due} ${clock(payload.delivery.dueAt)}`, bold: true }] : []),
      ...(payload.delivery.customerName ? [payload.delivery.customerName] : [])
    ] : [payload.pickupNo ? { text: `${copy.pickup} ${payload.pickupNo}`, size: "big", bold: true } : { text: `${copy.table} ${payload.table || ""}`, size: "big", bold: true }]),
    payload.delivery ? clock(payload.at) : `${copy.order} ${payload.orderNo || ""}${payload.pickupNo ? `  ${copy.table} ${payload.table || ""}` : ""}  ${clock(payload.at)}`,
    ...(payload.staffName ? [`${copy.waiter}: ${payload.staffName}`] : []),
    ...(payload.guest?.name ? [payload.guest.name] : []),
    ...(part ? [{ text: copy.part.replace("{n}", part.n).replace("{total}", part.total), bold: true }] : []),
    rule
  ];
  for (const item of payload.items || []) {
    const name = named(item, context);
    const lead = `${voiding ? "-" : ""}${item.quantity} x `;
    lines.push({ text: `${lead}${name.main}`, indent: " ".repeat(lead.length), ...dish });
    // The second language under the first, for whoever helps out at this station.
    if (name.second) lines.push({ text: `${" ".repeat(lead.length)}(${name.second})`, indent: " ".repeat(lead.length + 1) });
    for (const modifier of item.modifiers || []) {
      const option = named(modifier, context);
      lines.push({ text: `  - ${option.main}${option.second ? ` / ${option.second}` : ""}`, indent: "    " });
    }
  }
  if (payload.note) lines.push({ text: `${copy.note}: ${payload.note}`, bold: true });
  if (voiding && payload.reason) lines.push(`${copy.reason}: ${payload.reason}`);
  lines.push(rule, "\n");
  return lines;
}

function billLines(payload, context) {
  const { copy, rule, language } = context;
  const lines = [
    copy.title,
    `${copy.bill}  ${copy.table} ${payload.table || ""}`,
    payload.issuedAt ? new Date(payload.issuedAt).toLocaleString("de-AT") : "",
    rule
  ];
  for (const item of payload.items || []) {
    lines.push(`${item.qty} x ${item.names?.[language] || item.name || "Item"}`);
    for (const modifier of item.modifiers || []) lines.push(`  - ${modifier.names?.[language] || modifier.name}`);
    // A set menu over two rates shows both.
    const rates = item.vatSplit ? item.vatSplit.map((part) => `${part.percent}%`).join("/") : `${item.vatPercent}%`;
    lines.push(`      ${money(item.lineTotal)}  ${rates}`);
  }
  lines.push(rule, `${copy.total}: EUR ${money(payload.total)}`);
  for (const group of payload.vatBreakdown || []) {
    lines.push(`${copy.rate} ${group.percent}%  ${copy.net} ${money(group.net)}  ${copy.vat} ${money(group.vat)}`);
  }
  lines.push(rule, copy.disclaimer, "\n");
  return lines;
}

/**
 * A register receipt (shared/register.mjs): who issued it, its number, the
 * register and the time, each line, the amount per VAT rate, and how it was
 * paid. Until the receipt is signed (fiskaly) it says, at its head and its
 * foot, that it is a test receipt.
 */
function receiptLines(payload, context) {
  const { copy, rule, language } = context;
  const receipt = payload.receipt;
  const unsigned = receipt.fiscalStatus !== "signed";
  const lines = [
    ...(payload.copy ? [copy.receiptCopy] : []),
    ...(unsigned ? [copy.unsigned] : []),
    ...companyLines(payload.company, copy),
    rule,
    `${copy.receipt} ${receipt.receiptNo}  ${copy.register} ${receipt.cashRegisterId}`,
    `${at(receipt.createdAt)}${receipt.table ? `  ${copy.table} ${receipt.table}` : ""}`,
    ...(receipt.staffName ? [`${copy.waiter}: ${receipt.staffName}`] : [])
  ];
  if (receipt.type === "storno") lines.push(copy.storno, copy.stornoOf.replace("{no}", String(receipt.refersToNo ?? "")), receipt.reason || "");
  lines.push(rule);
  for (const line of receipt.lines) {
    // The dish in the front printer's language: German on the guest's receipt.
    const name = line.names?.[language] || line.name;
    lines.push(line.kind === "discount" ? { left: name, right: euros(line.totalCents) } : { left: `${line.quantity} x ${name}`, right: euros(line.totalCents) });
    for (const modifier of line.modifiers || []) lines.push(`  - ${modifier}`);
    lines.push(`    ${line.vatSplit.map((part) => `${part.percent}%`).join("/")}${line.quantity !== 1 && line.quantity !== -1 ? `  à ${euros(line.unitPriceCents)}` : ""}`);
  }
  lines.push(rule, { left: `${copy.sum} EUR`, right: euros(receipt.totalCents) });
  // Per rate on one line: rate, net and tax on the left, the gross amount
  // (what § 11 RKSV asks per rate) in the amount column.
  for (const group of receipt.vat) lines.push({ left: `${group.percent}% ${copy.net} ${euros(group.netCents)} ${copy.vat} ${euros(group.vatCents)}`, right: euros(group.grossCents) });
  lines.push(rule);
  for (const payment of receipt.payments) {
    lines.push({ left: `${copy[payment.type] ?? payment.type}${payment.voucherCode ? ` ${payment.voucherCode}` : ""}`, right: euros(payment.amountCents) });
    // Below the payment and outside the sum: a tip is not part of the sale.
    if (payment.tipCents) lines.push({ left: `  + ${copy.tip}`, right: euros(payment.tipCents) });
    if (payment.tenderedCents) lines.push(`  ${copy.tendered} ${euros(payment.tenderedCents)}  ${copy.change} ${euros(payment.changeCents)}`);
  }
  for (const line of receipt.lines) if (line.kind === "voucher" && receipt.type === "sale") lines.push(rule, `${copy.voucherCode}: ${line.code}`, { left: copy.voucher, right: euros(line.totalCents) });
  lines.push(rule, ...(unsigned ? [copy.unsigned] : []), "\n");
  return lines;
}

/** The day's closing (Z report): the run of receipts and what they add up to. */
function closingLines(payload, context) {
  const { copy, rule } = context;
  const { closing } = payload;
  const totals = closing.totals;
  const lines = [
    `${copy.closing} ${closing.closingNo}`,
    ...companyLines(payload.company, copy),
    `${copy.register} ${payload.cashRegisterId}  ${at(closing.createdAt)}`,
    rule,
    `${copy.receipts} ${totals.firstReceiptNo}–${totals.lastReceiptNo}: ${totals.sales} ${copy.sales}, ${totals.stornos} ${copy.stornos}`,
    { left: `${copy.sum} EUR`, right: euros(totals.grossCents) }
  ];
  for (const group of totals.vat) lines.push({ left: `${group.percent}% ${copy.net} ${euros(group.netCents)} ${copy.vat} ${euros(group.vatCents)}`, right: euros(group.grossCents) });
  lines.push(rule);
  for (const [type, amount] of Object.entries(totals.payments)) lines.push({ left: copy[type] ?? type, right: euros(amount) });
  if (totals.vouchersSoldCents) lines.push({ left: copy.vouchersSold, right: euros(totals.vouchersSoldCents) });
  lines.push(...tipLines(totals, copy, rule), rule, "\n");
  return lines;
}

/** A waiter's settlement: the receipts they took and the cash they hand in. */
function settlementLines(payload, context) {
  const { copy, rule } = context;
  const { settlement } = payload;
  const totals = settlement.totals;
  return [
    copy.settlement,
    ...companyLines(payload.company, copy),
    `${copy.waiter}: ${settlement.staffName}  ${at(settlement.createdAt)}`,
    rule,
    `${copy.receipts} ${totals.firstReceiptNo}–${totals.lastReceiptNo}: ${totals.sales} ${copy.sales}, ${totals.stornos} ${copy.stornos}`,
    { left: `${copy.sum} EUR`, right: euros(totals.grossCents) },
    rule,
    ...Object.entries(totals.payments).map(([type, amount]) => ({ left: copy[type] ?? type, right: euros(amount) })),
    ...(totals.voids?.count ? [{ left: `${copy.voids} ${totals.voids.count}x`, right: euros(-totals.voids.cents) }] : []),
    ...tipLines(totals, copy, rule),
    ...(totals.handInCents !== undefined ? [rule, { left: copy.handIn, right: euros(totals.handInCents) }] : []),
    rule,
    "\n"
  ];
}

/**
 * The drawer counted at the end of a shift (Kassensturz): what should be in
 * it, line by line, against what was counted, and every movement with why.
 */
function drawerLines(payload, context) {
  const { copy, rule } = context;
  const { drawer } = payload;
  const totals = drawer.totals;
  const lines = [
    { text: copy.drawer, bold: true, center: true },
    ...companyLines(payload.company, copy),
    `${copy.opened}: ${at(drawer.openedAt)}${drawer.openedBy ? ` ${drawer.openedBy}` : ""}`,
    `${copy.countedBy}: ${at(drawer.closedAt)}${drawer.closedBy ? ` ${drawer.closedBy}` : ""}`,
    ...(totals.receipts ? [`${copy.receipts} ${totals.firstReceiptNo}–${totals.lastReceiptNo}`] : []),
    rule,
    { left: copy.float, right: euros(totals.floatCents) },
    { left: `+ ${copy.cashSales}`, right: euros(totals.cashSalesCents) }
  ];
  for (const movement of drawer.movements) {
    lines.push({ left: `${movement.kind === "in" ? "+" : "-"} ${movement.kind === "in" ? copy.payIn : copy.payOut}`, right: euros(movement.kind === "in" ? movement.amountCents : -movement.amountCents) });
    lines.push(`    ${movement.reason}${movement.staffName ? ` (${movement.staffName})` : ""}`);
  }
  if (totals.cardTipsCents) lines.push({ left: `- ${copy.cardTips}`, right: euros(-totals.cardTipsCents) });
  lines.push(rule, { left: copy.expected, right: euros(totals.expectedCents) }, { left: copy.counted, right: euros(totals.countedCents) });
  lines.push({ text: `${copy.difference} ${totals.differenceCents > 0 ? "+" : ""}${euros(totals.differenceCents)}`, bold: true });
  if (drawer.counts) {
    lines.push(rule);
    for (const [cents, count] of Object.entries(drawer.counts).sort(([left], [right]) => Number(right) - Number(left))) {
      lines.push({ left: `${count} x ${euros(Number(cents))}`, right: euros(Number(cents) * count) });
    }
  }
  if (drawer.note) lines.push(rule, drawer.note);
  lines.push(rule, "\n");
  return lines;
}

/** Tips, apart from the takings, per way paid (none printed when there were none). */
function tipLines(totals, copy, rule) {
  if (!totals.tipsCents) return [];
  return [
    rule,
    copy.tips,
    ...Object.entries(totals.tips).filter(([, amount]) => amount).map(([type, amount]) => ({ left: `  ${copy[type] ?? type}`, right: euros(amount) }))
  ];
}

/**
 * A test page: which printer this is and how it is set, a ruler as wide as
 * the paper it was told it has, and a line in each language — so whoever
 * installs it sees at once whether the width and the encoding are right.
 */
function testLines(payload, context) {
  const { copy, rule, options, width } = context;
  const ruler = Array.from({ length: width }, (_, index) => String((index + 1) % 10)).join("");
  return [
    { text: copy.test, size: "big", bold: true, center: true },
    ...(context.standInFor ? [{ text: copy.standIn.replace("{name}", context.standInFor), bold: true, center: true }] : []),
    rule,
    `${copy.testPrinter}: ${payload.printerName ?? ""}`,
    `${copy.testStation}: ${copy.stations[payload.station] ?? payload.station ?? ""}`,
    `${copy.testLanguage}: ${LANGUAGE_NAMES[options.printLanguage]}${options.secondLanguage ? ` + ${LANGUAGE_NAMES[options.secondLanguage]}` : ""}`,
    `${copy.testEncoding}: ${options.encoding === "auto" ? `auto → ${resolvedEncoding(options)}` : options.encoding}  ${copy.testPaper}: ${options.paperWidth} mm`,
    rule,
    ruler,
    "中文：宫保鸡丁 加辣 · 寿司拼盘",
    "Deutsch: Nudeln – ÄÖÜ äöü ß",
    "English: Spring rolls (2 pcs)",
    { text: "1 x 蔬菜拉面 Ramen mit Gemüse", size: "tall", bold: true },
    rule,
    copy.testOk,
    at(payload.at),
    "\n"
  ];
}

const BUILDERS = { bill: billLines, receipt: receiptLines, closing: closingLines, settlement: settlementLines, drawer: drawerLines, test: testLines };
const KITCHEN = new Set([undefined, "order", "void"]);

/**
 * The bytes for one print job on one printer. `station` is the station the
 * job was for; `standInFor` names the printer this one prints for when that
 * one did not answer.
 */
export function renderTickets(payload, printer = {}, { station = null, standInFor = null } = {}) {
  const options = printerOptions(printer.capabilities);
  const encodingUsed = resolvedEncoding(options);
  // A code page without Chinese prints the English names rather than question marks.
  const latinOnly = encodingUsed === "cp437";
  const language = latinOnly && options.printLanguage === "zh" ? "en" : options.printLanguage;
  const second = latinOnly && options.secondLanguage === "zh" ? null : options.secondLanguage;
  const width = COLUMNS[options.paperWidth] ?? COLUMNS[58];
  const context = { copy: labels[language], language, second: second === language ? null : second, width, rule: "-".repeat(width), options, station, standInFor, largeText: options.largeText };

  const kitchen = KITCHEN.has(payload.kind);
  let tickets;
  if (kitchen) {
    const items = payload.items || [];
    const split = options.splitItems && items.length > 1;
    const once = split
      ? items.map((item, index) => orderLines({ ...payload, items: [item] }, context, { n: index + 1, total: items.length }))
      : [orderLines(payload, context)];
    tickets = Array.from({ length: options.copies }, () => once).flat();
  } else {
    tickets = [(BUILDERS[payload.kind] ?? orderLines)(payload, context)];
  }

  const encoding = { width, encoding: encodingUsed };
  // Reset, then put the printer in the mode these bytes are written for,
  // whatever it was left in: Chinese (FS &) for GB18030, code page 437 with
  // Chinese off (FS . and ESC t 0) otherwise.
  const chunks = [Buffer.from([ESC, 0x40]), Buffer.from(MODE[encodingUsed] ?? [])];
  // A beep on a kitchen ticket, for the printers that have one (ESC B n t).
  if (options.beep && (kitchen || payload.kind === "test")) chunks.push(Buffer.from([ESC, 0x42, 0x03, 0x02]));
  for (const lines of tickets) {
    chunks.push(encodeLines(lines, encoding));
    // Feed past the cutter, then cut.
    chunks.push(Buffer.from([ESC, 0x64, 0x03, GS, 0x56, 0x00]));
  }
  return Buffer.concat(chunks);
}
