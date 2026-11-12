/**
 * The server refuses in plain English (shared/*.mjs). Staff read the console
 * and the till in Chinese or German, so the refusals they can actually cause
 * from a form are put into their language here; anything not listed is shown
 * as the server wrote it. Shared by the admin console and the POS.
 */
type Lang = "zh" | "de" | "en";
type Text = Record<Lang, string>;

const EXACT: Record<string, Text> = {
  "A member tier has a name": { zh: "每个会员等级都要填名称", de: "Jede Mitgliedsstufe braucht einen Namen", en: "Every member tier needs a name" },
  "A threshold is a tier once": { zh: "两个会员等级的门槛金额不能相同", de: "Zwei Stufen dürfen nicht dieselbe Schwelle haben", en: "Two tiers cannot share a threshold" },
  "A tier's threshold is 0 to 1000000 euros": { zh: "等级门槛要在 €0 到 €1,000,000 之间", de: "Die Schwelle liegt zwischen € 0 und € 1.000.000", en: "A threshold is €0 to €1,000,000" },
  "A tier's discount is 0 to 100 percent": { zh: "会员价折扣要在 0–100% 之间", de: "Der Rabatt liegt zwischen 0 und 100 %", en: "The discount is 0 to 100%" },
  "A top-up amount is a tier once": { zh: "两档充值金额不能相同", de: "Zwei Bonusstufen dürfen nicht denselben Betrag haben", en: "Two bonus tiers cannot share an amount" },
  "A tier's top-up is 1 cent to 1000 euros": { zh: "充值档位金额要在 €0.01 到 €1,000 之间", de: "Der Aufladebetrag liegt zwischen € 0,01 und € 1.000", en: "A tier's top-up is €0.01 to €1,000" },
  "A tier's bonus is 0 to 1000 euros": { zh: "赠送金额要在 €0 到 €1,000 之间", de: "Der Bonus liegt zwischen € 0 und € 1.000", en: "The bonus is €0 to €1,000" },
  "A dish is a reward once": { zh: "同一道菜只能设一次积分兑换", de: "Ein Gericht ist nur einmal eine Prämie", en: "A dish can be a reward only once" },
  "A reward costs 1 to 100000 points": { zh: "兑换所需积分要在 1 到 100000 之间", de: "Eine Prämie kostet 1 bis 100.000 Punkte", en: "A reward costs 1 to 100,000 points" },
  "Points per euro is a whole number from 0 to 100": { zh: "积分数要是 0 到 100 的整数", de: "Punkte: ganze Zahl von 0 bis 100", en: "Points: a whole number from 0 to 100" },
  "Euros per point is a whole number from 1 to 1000": { zh: "每多少欧元积分要是 1 到 1000 的整数", de: "Euro je Punkt: ganze Zahl von 1 bis 1000", en: "Euros per point: a whole number from 1 to 1000" },
  "Rewards per order is 1 to 10": { zh: "每单可兑换数量要在 1 到 10 之间", de: "Prämien pro Bestellung: 1 bis 10", en: "Rewards per order: 1 to 10" },
  "The birthday discount is 0 to 100 percent": { zh: "生日折扣要在 0–100% 之间", de: "Der Geburtstagsrabatt liegt zwischen 0 und 100 %", en: "The birthday discount is 0 to 100%" },
  "A change of points is a whole number, not zero": { zh: "积分调整要填一个不为 0 的整数", de: "Punkteänderung: ganze Zahl, nicht 0", en: "A points change is a whole number, not zero" },
  "A change of balance is an amount, not zero": { zh: "请输入有效的调整金额（不能为 0）", de: "Bitte einen gültigen Betrag eingeben (nicht 0)", en: "Enter a valid amount (not zero)" },
  "A change of balance is at most 10000 euros": { zh: "单次调整金额不能超过 €10,000", de: "Eine einzelne Änderung darf höchstens € 10.000 betragen", en: "A single change can be at most €10,000" },
  "Say why the balance changes (1–120 characters)": { zh: "请填写调整原因（最多 120 字）", de: "Bitte einen Grund angeben (max. 120 Zeichen)", en: "Say why (up to 120 characters)" },
  "Say why the points change (1–120 characters)": { zh: "请填写调整原因（最多 120 字）", de: "Bitte einen Grund angeben (max. 120 Zeichen)", en: "Say why (up to 120 characters)" },
  "Say why the top-up is booked (1–120 characters)": { zh: "请选择或填写充值原因", de: "Bitte einen Grund für die Aufladung angeben", en: "Give a reason for the top-up" },
  "Member top-up is switched off": { zh: "会员储值还没开启（后台 → 会员 → 会员储值）", de: "Guthaben-Aufladung ist ausgeschaltet", en: "Member top-up is switched off" },
  "A top-up is at most 1000 euros": { zh: "单次充值不能超过 €1,000", de: "Eine Aufladung ist höchstens € 1.000", en: "A top-up is at most €1,000" },
  "A top-up is paid in cash or by card": { zh: "充值只能用现金或刷卡", de: "Aufladung nur bar oder mit Karte", en: "A top-up is paid in cash or by card" },
  "Less cash was handed over than it pays": { zh: "收到的现金少于应付金额", de: "Weniger Bargeld erhalten als zu zahlen", en: "Less cash was handed over than it pays" },
  "No such member": { zh: "找不到这个会员", de: "Mitglied nicht gefunden", en: "No such member" },
  "This top-up has been spent and cannot be cancelled": { zh: "这笔充值已被消费，不能撤销", de: "Diese Aufladung wurde schon ausgegeben und kann nicht storniert werden", en: "This top-up has been spent and cannot be cancelled" },
  "That is not a day in the month": { zh: "这个月没有这一天", de: "Diesen Tag gibt es in dem Monat nicht", en: "That is not a day in the month" }
};

const PATTERNS: Array<[RegExp, (match: RegExpMatchArray) => Text]> = [
  [/^At most (\d+) member tiers$/, (m) => ({ zh: `最多 ${m[1]} 个会员等级`, de: `Höchstens ${m[1]} Stufen`, en: `At most ${m[1]} member tiers` })],
  [/^At most (\d+) rewards$/, (m) => ({ zh: `最多 ${m[1]} 个兑换菜品`, de: `Höchstens ${m[1]} Prämien`, en: `At most ${m[1]} rewards` })],
  [/^At most (\d+) top-up tiers$/, (m) => ({ zh: `最多 ${m[1]} 个充值档位`, de: `Höchstens ${m[1]} Bonusstufen`, en: `At most ${m[1]} bonus tiers` })],
  [/^The payments add up to ([\d.]+), the top-up to ([\d.]+)$/, (m) => ({ zh: `付款合计 €${m[1]}，与充值金额 €${m[2]} 不一致`, de: `Zahlungen € ${m[1]}, Aufladung € ${m[2]}`, en: `The payments add up to €${m[1]}, the top-up to €${m[2]}` })]
];

/** The server's refusal in the staff member's language, or as written when unknown. */
export function serverErrorText(message: string, language: string): string {
  const lang: Lang = language === "de" || language === "en" ? language : "zh";
  const exact = EXACT[message.trim()];
  if (exact) return exact[lang];
  for (const [pattern, text] of PATTERNS) {
    const match = message.trim().match(pattern);
    if (match) return text(match)[lang];
  }
  return message;
}
