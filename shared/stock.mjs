/**
 * Portions a dish has left today (每日限量): 30 baskets of xiaolongbao a day,
 * or "only 5 left" said at the pass. Every order counts down — the waiter's,
 * the guest's own from the menu, a delivery platform's once accepted — and a
 * dish at zero is off the menus until the next day, or until someone says
 * there are more.
 *
 * One row per limited dish in `product_stock` (a table of its own, so the
 * products table and its migrations stay as they are):
 *
 *  - `daily_limit`: the portions each day starts with; NULL, as many as ordered.
 *  - `stock_day` / `stock_left`: what is left on that restaurant day. Once a
 *    day is under way it is what counts (NULL there: no limit today); on a new
 *    day it starts over from `daily_limit`.
 *
 * Days are the restaurant's own (settings.timeZone), not UTC: the count starts
 * over at midnight in Vienna.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

export const MAX_PORTIONS = 9999;

/** The restaurant's calendar day, YYYY-MM-DD. */
export function restaurantDay(timeZone, at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Portions left today from a dish's `product_stock` row (or none), null for as many as ordered. */
export function leftToday(stock, today) {
  if (!stock) return null;
  if (stock.stock_day === today) return stock.stock_left ?? null;
  return stock.daily_limit ?? null;
}

export function stockError(message, code, status = 400, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

function portions(value, field) {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_PORTIONS) throw stockError(`${field} is 0 to ${MAX_PORTIONS} portions, or none`, "BAD_STOCK");
  return number;
}

/** What the floor or the owner sets: `dailyLimit` (each day), `leftToday` (today only); either may be null (no limit). */
export function normalizeStockInput(input) {
  if (!input || typeof input !== "object") throw stockError("Stock is { dailyLimit, leftToday }", "BAD_STOCK");
  const result = {};
  if ("dailyLimit" in input) {
    result.dailyLimit = portions(input.dailyLimit, "The daily limit");
    if (result.dailyLimit === 0) throw stockError("A daily limit of 0 is a dish off the menu: use sold out instead", "BAD_STOCK");
  }
  if ("leftToday" in input) result.leftToday = portions(input.leftToday, "Portions left today");
  if (!("dailyLimit" in result) && !("leftToday" in result)) throw stockError("Say the daily limit, today's portions, or both", "BAD_STOCK");
  return result;
}

/** How many of each dish an order asks for: `lines` are { productId, quantity }. */
export function stockDemand(lines) {
  const demand = new Map();
  for (const line of lines) demand.set(String(line.productId), (demand.get(String(line.productId)) ?? 0) + Number(line.quantity));
  return demand;
}

/**
 * Refuses an order for more than a dish has left, saying which dish and how
 * many there are (`code` SOLD_OUT, `left`, `sku`). `rows` are the products
 * by id, `stock` their `product_stock` rows by id.
 */
export function assertStock(demand, rows, stock, today) {
  for (const [id, quantity] of demand) {
    const row = rows.get(id);
    if (!row) continue;
    const left = leftToday(stock.get(id), today);
    if (left !== null && quantity > left) {
      const name = row.name_zh || row.name_de || row.name_en || row.sku;
      throw stockError(left ? `${name}: only ${left} left today` : `${name} is sold out for today`, "SOLD_OUT", 409, { left, sku: row.sku, productId: row.id });
    }
  }
}

/**
 * Counts portions down: today's count if the day is under way, the daily
 * limit otherwise; never below zero (a delivery accepted over the count is
 * still cooked). A dish without a limit is left alone.
 * Parameters: today, quantity, today, at, id, today.
 */
export const TAKE_STOCK_SQL = `UPDATE product_stock
  SET stock_left = MAX(0, (CASE WHEN stock_day = ? THEN stock_left ELSE daily_limit END) - ?), stock_day = ?, updated_at = ?
  WHERE product_id = ? AND (CASE WHEN stock_day = ? THEN stock_left ELSE daily_limit END) IS NOT NULL`;

/** A dish voided today goes back on the count. Parameters: quantity, at, id, today. */
export const RETURN_STOCK_SQL = "UPDATE product_stock SET stock_left = stock_left + ?, updated_at = ? WHERE product_id = ? AND stock_day = ? AND stock_left IS NOT NULL";

/** The statements that take an order's portions: `sql` is the store's statement maker, `stock` the rows by id. */
export function takeStockStatements(sql, demand, stock, today, at) {
  const statements = [];
  for (const [id, quantity] of demand) {
    if (leftToday(stock.get(id), today) !== null) statements.push(sql(TAKE_STOCK_SQL, today, quantity, today, at, id, today));
  }
  return statements;
}

/**
 * A dish's limits set anew: `change` is normalizeStockInput's. The daily
 * limit alone leaves today's count as it is; today's portions alone leave the
 * daily limit. Parameters built here, for `INSERT … ON CONFLICT`.
 */
export function setStockStatement(sql, productId, current, change, today, at) {
  const dailyLimit = "dailyLimit" in change ? change.dailyLimit : current?.daily_limit ?? null;
  const todaySet = "leftToday" in change;
  const stockDay = todaySet ? today : current?.stock_day ?? null;
  const stockLeft = todaySet ? change.leftToday : current?.stock_left ?? null;
  return sql(
    `INSERT INTO product_stock (product_id, daily_limit, stock_day, stock_left, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET daily_limit = excluded.daily_limit, stock_day = excluded.stock_day, stock_left = excluded.stock_left, updated_at = excluded.updated_at`,
    String(productId), dailyLimit, stockDay, stockLeft, at
  );
}

/** What the menus and the POS are told: the daily limit and what is left today (null: no limit). */
export function stockView(stock, today) {
  return { dailyLimit: stock?.daily_limit ?? null, leftToday: leftToday(stock, today) };
}
