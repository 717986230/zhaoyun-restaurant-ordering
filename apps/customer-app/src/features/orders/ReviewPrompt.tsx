import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { restaurantApi } from "../../app/api";
import { g } from "../../app/guest-i18n";
import type { CustomerState, PlacedOrder } from "../../app/model";

const ASKED_KEY = "zy_review_asked";
/** Asked once, and not again for two months: a regular is not asked every visit. */
const ASK_AGAIN_MS = 60 * 24 * 60 * 60 * 1000;
/** Only today's orders: a phone that ordered last week is not asked now. */
const RECENT_MS = 12 * 60 * 60 * 1000;

function askedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(ASKED_KEY) ?? 0);
    return Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return false;
  }
}

function rememberAsked(): void {
  try { localStorage.setItem(ASKED_KEY, String(Date.now())); } catch { /* Asked this time; maybe again next. */ }
}

/**
 * Once the guest's order is paid, a card asks them to rate the restaurant
 * (on the review page the owner set, Google usually). The phone's own orders
 * are checked every half minute while one is open and unpaid; asked once.
 */
export function ReviewPrompt({ placed, reviewUrl, language }: { placed: PlacedOrder[]; reviewUrl: string | undefined; language: CustomerState["language"] }) {
  const [closed, setClosed] = useState(askedRecently);
  const recent = placed.filter((order) => Date.now() - Date.parse(order.createdAt) < RECENT_MS).map((order) => order.clientRequestId);
  const { data } = useQuery({
    queryKey: ["paid-check", recent.join(",")],
    enabled: Boolean(reviewUrl) && !closed && recent.length > 0,
    refetchInterval: 30_000,
    queryFn: () => restaurantApi.trackOrders(recent)
  });
  const paid = data?.orders.some((order) => order.billedAt && order.status !== "cancelled");
  if (!reviewUrl || closed || !paid) return null;

  const done = () => { rememberAsked(); setClosed(true); };
  return <aside className="review-prompt" id="reviewPrompt" aria-labelledby="reviewPromptTitle">
    <p id="reviewPromptTitle"><strong>{g(language, "reviewTitle")}</strong><span>{g(language, "reviewBody")}</span></p>
    <div className="review-prompt-actions">
      <a className="primary" href={reviewUrl} target="_blank" rel="noopener noreferrer" onClick={done}>★ {g(language, "reviewGo")}</a>
      <button type="button" className="link-button" onClick={done}>{g(language, "reviewLater")}</button>
    </div>
  </aside>;
}
