/**
 * The booking page's words, in the menu's three languages. `{name}` slots
 * are filled by `b`.
 */
export type BookingLanguage = "zh" | "de" | "en";

const copy = {
  zh: {
    title: "预约餐桌", loading: "正在加载…", off: "目前不接受在线预约，请直接致电餐厅。", failedLoad: "连不上餐厅，请稍后再试。", retry: "重试",
    party: "人数", guests: "{n} 位", moreGuests: "更多", largeParty: "超过 {n} 位请直接致电餐厅。", date: "日期", otherDate: "其他日期", closed: "休息",
    time: "时间", noTimes: "这一天没有可预约的时间。", fullDay: "这一天已经订满了，请换一天。", pickTime: "请选择时间", full: "已满", timesLoading: "正在查看空位…",
    signInTitle: "登录后预约", signInLead: "没有账户？用邮箱或手机号注册，不需要验证码。", signIn: "登录", register: "注册", loginEmail: "邮箱或手机号", password: "密码", passwordHint: "至少 6 位",
    signedInAs: "已登录：{email}", signOut: "退出", account: "个人中心", signInToSee: "登录后查看。请在页面下方登录。", close: "关闭", themeLight: "浅色", themeDark: "深色", chooseTime: "请选择", showMemberCode: "显示会员码", hideMemberCode: "收起会员码", pointsShortLine: "预约一次需要 {min} 积分，你现在有 {points} 积分。", pointsHowWelcome: "到店消费结账时请服务员扫会员码，赠送 {welcome} 积分。", ruleSignup: "扫码注册送 {n} 积分", ruleBooking: "每次预约扣 {n} 积分（取消退回）", ruleWelcome: "首次到店消费送 {n} 积分", ruleNoShow: "预约未到另扣 {n} 积分", bookingCost: "扣 {n} 积分", signupBonus: "在店里扫桌上的二维码注册，赠送 {n} 积分。", pointsBalance: "{points} 积分", memberTitle: "会员预约", memberRule: "预约需要 {min} 积分。首次到店消费后赠送 {welcome} 积分；预约未按时到店会扣 {noShow} 积分。", pointsShort: "你现在有 {points} 积分，还差 {missing} 积分才能在线预约。", memberHow: "到店消费结账时，请服务员扫这个会员码，即赠送 {welcome} 积分（在店里用这个账户扫码点餐的，结账后自动赠送）。", memberQrAlt: "会员码", memberRefresh: "已到店领取？刷新积分", wrongLogin: "账号或密码不对", emailTaken: "这个邮箱或手机号已经注册过，请直接登录", forgot: "忘记密码？请联系餐厅重设。",
    myBookings: "我的预约", noBookings: "还没有预约", registerConsent: "注册即表示同意餐厅按下方说明使用你的邮箱和预约信息。",
    seat: "选座", pickTable: "请选择餐桌", tableSeats: "{seats} 座", tableName: "{table} 号桌", tablesLoading: "正在查看空桌…", noTables: "这个时间没有适合 {n} 位的空桌，请换个时间。", tableBooked: "已订", tableSmall: "座位不够", yourTable: "餐桌",
    details: "联系方式", name: "姓名", phone: "手机号", contact: "手机号或邮箱", contactHint: "0660 1234567 或 name@example.com", contactMissing: "请留下手机号或邮箱。", emailInvalid: "请填写有效的邮箱。", loginInvalid: "请填写有效的邮箱或手机号，例如 0660 1234567。", phoneHint: "有变动时餐厅会打给你", phoneInvalid: "请填写有效的手机号，例如 0660 1234567 或 +43 660 1234567。", phoneNotMobile: "请填写手机号，不是座机号码。", verifyTitle: "验证邮箱", verifyLead: "验证码会发到 {email}。", sendCode: "发送验证码", resend: "重新发送", resendIn: "{s} 秒后可重新发送", codeSent: "验证码已发到 {email}，10 分钟内有效。", codeLabel: "6 位验证码", verify: "验证", verified: "邮箱已验证，可以预约了。", notes: "备注（可不填）", notesHint: "例如：儿童椅、过敏、庆生",
    submit: "确认预约", needPoints: "还差 {missing} 积分才能预约", submitting: "正在预约…", staysFor: "餐桌为你保留约 {minutes} 分钟。",
    booked: "预约成功", pending: "已收到预约，餐厅确认后生效", confirmed: "已确认", cancelled: "已取消", seated: "已入座", completed: "已完成", declined: "餐厅无法接受这次预约", no_show: "未到店",
    reference: "预约号", showPass: "点按出示预约二维码", qrHint: "到店出示，服务员扫码签到", qrAlt: "预约二维码 {reference}", backToTime: "点按看时间", when: "{date} {time}", partyOf: "{n} 位", keepLink: "请保存这个链接，可以随时查看或取消预约：", copy: "复制链接", copied: "已复制",
    cancel: "取消预约", cancelConfirm: "确定要取消这次预约吗？", cancelDone: "预约已取消", cannotCancel: "现在不能在线取消了，请直接致电餐厅。",
    another: "再订一桌", myBooking: "我的预约", notFound: "找不到这个预约，链接可能不完整。",
    errors: {
      SLOT_FULL: "这个时间刚刚订满了，请换一个时间。", SLOT_UNAVAILABLE: "这个时间不能在线预约，请换一个时间或致电餐厅。", PARTY_TOO_LARGE: "人数较多，请直接致电餐厅。",
      RESERVATIONS_OFF: "目前不接受在线预约。", TABLE_TAKEN: "这张桌刚刚被订走了，请选另一张。", TABLE_REQUIRED: "请选择餐桌。", TABLE_TOO_SMALL: "这张桌坐不下这么多人，请选大一点的。",
      SIGN_IN_REQUIRED: "请先登录再预约。", NO_SHOW_BLOCKED: "你之前有预约没有到店，目前不能在线预约，请直接致电餐厅。", DAY_LIMIT: "同一天最多预约 {limit} 次。", TOO_MANY_BOOKINGS: "你已经有 {limit} 个未到的预约，取消一个才能再订。", INVALID: "请检查填写的内容：{message}", RATE: "操作太频繁，请稍后再试。", OFFLINE: "网络连不上，预约没有发出去。", EMAIL_UNVERIFIED: "请先验证邮箱。", BAD_PHONE: "请填写有效的手机号，例如 0660 1234567 或 +43 660 1234567。", NOT_MOBILE: "请填写手机号，不是座机号码。", WRONG_CODE: "验证码不对，还可以再试 {left} 次。", CODE_EXPIRED: "验证码已失效，请重新发送。", CODE_TOO_SOON: "请等 {s} 秒再重新发送。", TOO_MANY_CODES: "发送次数太多，请一小时后再试。", MAIL_FAILED: "邮件没发出去，请稍后再试，或直接致电餐厅。", CONTACT_REQUIRED: "请留下手机号或邮箱。", BAD_LOGIN: "请填写有效的邮箱或手机号。", NOT_ENOUGH_POINTS: "预约需要 {min} 积分，你现在有 {points} 积分。"
    }
  },
  de: {
    title: "Tisch reservieren", loading: "Wird geladen …", off: "Online-Reservierungen sind derzeit nicht möglich – bitte rufen Sie uns an.", failedLoad: "Keine Verbindung zum Restaurant – bitte später noch einmal.", retry: "Erneut versuchen",
    party: "Personen", guests: "{n} Pers.", moreGuests: "Mehr", largeParty: "Ab {n} Personen bitte telefonisch reservieren.", date: "Datum", otherDate: "Anderes Datum", closed: "Ruhetag",
    time: "Uhrzeit", noTimes: "An diesem Tag gibt es keine Reservierungszeiten.", fullDay: "Dieser Tag ist ausgebucht – bitte einen anderen wählen.", pickTime: "Bitte eine Uhrzeit wählen", full: "ausgebucht", timesLoading: "Freie Tische werden gesucht …",
    signInTitle: "Zum Reservieren anmelden", signInLead: "Noch kein Konto? Mit E-Mail oder Handynummer registrieren – ohne Code.", signIn: "Anmelden", register: "Registrieren", loginEmail: "E-Mail oder Handynummer", password: "Passwort", passwordHint: "Mindestens 6 Zeichen",
    signedInAs: "Angemeldet: {email}", signOut: "Abmelden", account: "Mein Konto", signInToSee: "Bitte unten auf der Seite anmelden.", close: "Schließen", themeLight: "Hell", themeDark: "Dunkel", chooseTime: "Wählen", showMemberCode: "Mitgliedscode zeigen", hideMemberCode: "Mitgliedscode ausblenden", pointsShortLine: "Eine Reservierung braucht {min} Punkte, Sie haben {points}.", pointsHowWelcome: "Zeigen Sie beim Bezahlen im Restaurant Ihren Mitgliedscode – dafür gibt es {welcome} Punkte.", ruleSignup: "{n} Punkte für die Registrierung am Tisch", ruleBooking: "{n} Punkte pro Reservierung (zurück bei Storno)", ruleWelcome: "{n} Punkte für den ersten Besuch", ruleNoShow: "{n} Punkte mehr bei Nichterscheinen", bookingCost: "{n} Punkte", signupBonus: "Im Restaurant den QR-Code am Tisch scannen und registrieren: {n} Punkte geschenkt.", pointsBalance: "{points} Punkte", memberTitle: "Reservieren für Mitglieder", memberRule: "Zum Reservieren brauchen Sie {min} Punkte. Nach Ihrem ersten Besuch schenken wir Ihnen {welcome} Punkte; eine nicht wahrgenommene Reservierung kostet {noShow} Punkte.", pointsShort: "Sie haben {points} Punkte – es fehlen noch {missing}, um online zu reservieren.", memberHow: "Zeigen Sie beim Bezahlen im Restaurant diesen Mitgliedscode – wir scannen ihn und schenken Ihnen {welcome} Punkte (bestellen Sie vor Ort mit diesem Konto, kommen sie nach dem Bezahlen von selbst).", memberQrAlt: "Mitgliedscode", memberRefresh: "Schon da gewesen? Punkte aktualisieren", wrongLogin: "Konto oder Passwort falsch", emailTaken: "Diese E-Mail oder Nummer ist schon registriert – bitte anmelden", forgot: "Passwort vergessen? Das Restaurant setzt es neu.",
    myBookings: "Meine Reservierungen", noBookings: "Noch keine Reservierungen", registerConsent: "Mit der Registrierung stimmst du zu, dass das Restaurant E-Mail und Reservierungen wie unten beschrieben verwendet.",
    seat: "Tisch wählen", pickTable: "Bitte einen Tisch wählen", tableSeats: "{seats} Plätze", tableName: "Tisch {table}", tablesLoading: "Freie Tische werden gesucht …", noTables: "Zu dieser Zeit ist kein Tisch für {n} Personen frei – bitte eine andere Uhrzeit wählen.", tableBooked: "Reserviert", tableSmall: "Zu klein", yourTable: "Tisch",
    details: "Kontakt", name: "Name", phone: "Handynummer", contact: "Handynummer oder E-Mail", contactHint: "0660 1234567 oder name@example.com", contactMissing: "Bitte Handynummer oder E-Mail angeben.", emailInvalid: "Bitte eine gültige E-Mail angeben.", loginInvalid: "Bitte eine gültige E-Mail oder Handynummer angeben, z. B. 0660 1234567.", phoneHint: "Für Rückfragen des Restaurants", phoneInvalid: "Bitte eine gültige Handynummer angeben, z. B. 0660 1234567 oder +43 660 1234567.", phoneNotMobile: "Bitte eine Handynummer angeben, keine Festnetznummer.", verifyTitle: "E-Mail bestätigen", verifyLead: "Wir senden einen Code an {email}.", sendCode: "Code senden", resend: "Erneut senden", resendIn: "Erneut senden in {s} s", codeSent: "Code an {email} gesendet, 10 Minuten gültig.", codeLabel: "6-stelliger Code", verify: "Bestätigen", verified: "E-Mail bestätigt – Sie können jetzt reservieren.", notes: "Anmerkung (optional)", notesHint: "z. B. Kinderstuhl, Allergien, Geburtstag",
    submit: "Verbindlich reservieren", needPoints: "Noch {missing} Punkte bis zur Reservierung", submitting: "Wird reserviert …", staysFor: "Der Tisch ist für etwa {minutes} Minuten für Sie reserviert.",
    booked: "Reserviert", pending: "Anfrage erhalten – gilt, sobald das Restaurant bestätigt", confirmed: "Bestätigt", cancelled: "Storniert", seated: "Am Tisch", completed: "Abgeschlossen", declined: "Das Restaurant kann diese Reservierung leider nicht annehmen", no_show: "Nicht erschienen",
    reference: "Reservierungsnummer", showPass: "Antippen: QR-Code zeigen", qrHint: "Beim Eintreffen zeigen – wir scannen ihn ein", qrAlt: "QR-Code der Reservierung {reference}", backToTime: "Antippen: Uhrzeit zeigen", when: "{date}, {time} Uhr", partyOf: "{n} Personen", keepLink: "Bitte diesen Link aufheben – damit können Sie die Reservierung jederzeit ansehen oder stornieren:", copy: "Link kopieren", copied: "Kopiert",
    cancel: "Reservierung stornieren", cancelConfirm: "Diese Reservierung wirklich stornieren?", cancelDone: "Die Reservierung ist storniert", cannotCancel: "Online nicht mehr stornierbar – bitte rufen Sie uns an.",
    another: "Noch einen Tisch reservieren", myBooking: "Meine Reservierung", notFound: "Reservierung nicht gefunden – ist der Link vollständig?",
    errors: {
      SLOT_FULL: "Diese Uhrzeit ist gerade ausgebucht – bitte eine andere wählen.", SLOT_UNAVAILABLE: "Diese Uhrzeit ist online nicht buchbar – bitte eine andere wählen oder anrufen.", PARTY_TOO_LARGE: "Für größere Gruppen bitte anrufen.",
      RESERVATIONS_OFF: "Online-Reservierungen sind derzeit nicht möglich.", TABLE_TAKEN: "Dieser Tisch wurde gerade reserviert – bitte einen anderen wählen.", TABLE_REQUIRED: "Bitte einen Tisch wählen.", TABLE_TOO_SMALL: "An diesem Tisch ist nicht genug Platz – bitte einen größeren wählen.",
      SIGN_IN_REQUIRED: "Bitte zuerst anmelden.", NO_SHOW_BLOCKED: "Nach nicht wahrgenommenen Reservierungen ist online derzeit keine Reservierung möglich – bitte rufen Sie uns an.", DAY_LIMIT: "Höchstens {limit} Reservierung(en) pro Tag.", TOO_MANY_BOOKINGS: "Sie haben schon {limit} offene Reservierungen – bitte zuerst eine stornieren.", INVALID: "Bitte die Angaben prüfen: {message}", RATE: "Zu viele Versuche – bitte kurz warten.", OFFLINE: "Keine Verbindung – die Reservierung wurde nicht gesendet.", EMAIL_UNVERIFIED: "Bitte zuerst Ihre E-Mail bestätigen.", BAD_PHONE: "Bitte eine gültige Handynummer angeben, z. B. 0660 1234567 oder +43 660 1234567.", NOT_MOBILE: "Bitte eine Handynummer angeben, keine Festnetznummer.", WRONG_CODE: "Der Code stimmt nicht – noch {left} Versuch(e).", CODE_EXPIRED: "Der Code ist abgelaufen – bitte einen neuen anfordern.", CODE_TOO_SOON: "Bitte {s} Sekunden warten, dann erneut senden.", TOO_MANY_CODES: "Zu viele Codes – bitte in einer Stunde erneut versuchen.", MAIL_FAILED: "Die E-Mail konnte nicht gesendet werden – bitte später erneut versuchen oder anrufen.", CONTACT_REQUIRED: "Bitte Handynummer oder E-Mail angeben.", BAD_LOGIN: "Bitte eine gültige E-Mail oder Handynummer angeben.", NOT_ENOUGH_POINTS: "Zum Reservieren brauchen Sie {min} Punkte, Sie haben {points}."
    }
  },
  en: {
    title: "Book a table", loading: "Loading…", off: "Online booking is not available right now – please call us.", failedLoad: "Cannot reach the restaurant – please try again later.", retry: "Try again",
    party: "Guests", guests: "{n}", moreGuests: "More", largeParty: "For more than {n} guests, please call us.", date: "Date", otherDate: "Another date", closed: "Closed",
    time: "Time", noTimes: "No booking times on this day.", fullDay: "This day is fully booked – please pick another.", pickTime: "Please pick a time", full: "full", timesLoading: "Checking free tables…",
    signInTitle: "Sign in to book", signInLead: "No account yet? Register with an email or a mobile number – no code needed.", signIn: "Sign in", register: "Register", loginEmail: "Email or mobile number", password: "Password", passwordHint: "At least 6 characters",
    signedInAs: "Signed in: {email}", signOut: "Sign out", account: "My account", signInToSee: "Please sign in further down the page.", close: "Close", themeLight: "Light", themeDark: "Dark", chooseTime: "Pick", showMemberCode: "Show member code", hideMemberCode: "Hide member code", pointsShortLine: "A booking takes {min} points; you have {points}.", pointsHowWelcome: "Show your member code when you pay at the restaurant for {welcome} points.", ruleSignup: "{n} points for signing up at a table", ruleBooking: "{n} points per booking (back if cancelled)", ruleWelcome: "{n} points for your first visit", ruleNoShow: "{n} more points if you miss a booking", bookingCost: "{n} points", signupBonus: "Scan the QR code on your table and sign up at the restaurant: {n} points on us.", pointsBalance: "{points} points", memberTitle: "Booking for members", memberRule: "Booking takes {min} points. Your first visit brings {welcome} points; a booking not kept costs {noShow} points.", pointsShort: "You have {points} points – {missing} more to book online.", memberHow: "When you pay at the restaurant, show this member code: we scan it and give you {welcome} points (order at the table with this account and they come by themselves once paid).", memberQrAlt: "Member code", memberRefresh: "Been in already? Refresh your points", wrongLogin: "Wrong account or password", emailTaken: "This email or number is registered already – please sign in", forgot: "Forgot your password? The restaurant can set a new one.",
    myBookings: "My bookings", noBookings: "No bookings yet", registerConsent: "By registering you agree to the restaurant using your email and bookings as described below.",
    seat: "Pick your table", pickTable: "Please pick a table", tableSeats: "{seats} seats", tableName: "Table {table}", tablesLoading: "Checking free tables…", noTables: "No table for {n} is free at this time – please pick another time.", tableBooked: "Booked", tableSmall: "Too small", yourTable: "Table",
    details: "Your details", name: "Name", phone: "Mobile number", contact: "Mobile number or email", contactHint: "0660 1234567 or name@example.com", contactMissing: "Please leave a mobile number or an email.", emailInvalid: "Please enter a valid email.", loginInvalid: "Please enter a valid email or mobile number, e.g. 0660 1234567.", phoneHint: "In case the restaurant needs to reach you", phoneInvalid: "Please enter a valid mobile number, e.g. 0660 1234567 or +43 660 1234567.", phoneNotMobile: "Please enter a mobile number, not a landline.", verifyTitle: "Confirm your email", verifyLead: "We will send a code to {email}.", sendCode: "Send code", resend: "Send again", resendIn: "Send again in {s}s", codeSent: "Code sent to {email}, valid for 10 minutes.", codeLabel: "6-digit code", verify: "Confirm", verified: "Email confirmed – you can book now.", notes: "Note (optional)", notesHint: "e.g. high chair, allergies, birthday",
    submit: "Book now", needPoints: "{missing} more points to book", submitting: "Booking…", staysFor: "Your table is held for about {minutes} minutes.",
    booked: "Booked", pending: "Request received – it stands once the restaurant confirms", confirmed: "Confirmed", cancelled: "Cancelled", seated: "Seated", completed: "Completed", declined: "The restaurant cannot take this booking", no_show: "No-show",
    reference: "Booking number", showPass: "Tap to show your QR code", qrHint: "Show it when you arrive – we scan it to check you in", qrAlt: "Booking QR code {reference}", backToTime: "Tap for the time", when: "{date} at {time}", partyOf: "{n} guests", keepLink: "Keep this link to see or cancel your booking at any time:", copy: "Copy link", copied: "Copied",
    cancel: "Cancel booking", cancelConfirm: "Cancel this booking?", cancelDone: "Your booking is cancelled", cannotCancel: "It can no longer be cancelled online – please call us.",
    another: "Book another table", myBooking: "My booking", notFound: "Booking not found – is the link complete?",
    errors: {
      SLOT_FULL: "That time has just filled up – please pick another.", SLOT_UNAVAILABLE: "That time cannot be booked online – please pick another or call us.", PARTY_TOO_LARGE: "For larger groups, please call us.",
      RESERVATIONS_OFF: "Online booking is not available right now.", TABLE_TAKEN: "That table has just been booked – please pick another.", TABLE_REQUIRED: "Please pick a table.", TABLE_TOO_SMALL: "That table is too small for your party – please pick a larger one.",
      SIGN_IN_REQUIRED: "Please sign in first.", NO_SHOW_BLOCKED: "After missed bookings, online booking is not available for now – please call us.", DAY_LIMIT: "At most {limit} booking(s) per day.", TOO_MANY_BOOKINGS: "You already have {limit} upcoming bookings – cancel one to book another.", INVALID: "Please check your details: {message}", RATE: "Too many attempts – please wait a moment.", OFFLINE: "No connection – the booking was not sent.", EMAIL_UNVERIFIED: "Please confirm your email first.", BAD_PHONE: "Please enter a valid mobile number, e.g. 0660 1234567 or +43 660 1234567.", NOT_MOBILE: "Please enter a mobile number, not a landline.", WRONG_CODE: "Wrong code – {left} more tries.", CODE_EXPIRED: "The code has expired – please ask for a new one.", CODE_TOO_SOON: "Please wait {s} seconds before sending again.", TOO_MANY_CODES: "Too many codes – please try again in an hour.", MAIL_FAILED: "The email could not be sent – please try again later or call us.", CONTACT_REQUIRED: "Please leave a mobile number or an email.", BAD_LOGIN: "Please enter a valid email or mobile number.", NOT_ENOUGH_POINTS: "Booking takes {min} points; you have {points}."
    }
  }
} as const;

type Copy = typeof copy.zh;
export type BookingKey = Exclude<keyof Copy, "errors">;
export type BookingErrorKey = keyof Copy["errors"];

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function b(language: BookingLanguage, key: BookingKey, values: Record<string, string | number> = {}): string {
  return fill(copy[language][key], values);
}

export function bookingError(language: BookingLanguage, key: BookingErrorKey, values: Record<string, string | number> = {}): string {
  return fill(copy[language].errors[key], values);
}

const LOCALES: Record<BookingLanguage, string> = { zh: "zh-CN", de: "de-AT", en: "en-GB" };

/** "Sa., 3. Okt." — a calendar day in the guest's language, read as the restaurant's day. */
export function formatDay(language: BookingLanguage, date: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat(LOCALES[language], { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

const LANGUAGE_KEY = "zy_booking_language";
/** The menu's own saved state (app/model.ts): the language a guest picked there. */
const MENU_STATE_KEY = "zy_customer_state_v5";

function menuLanguage(): string | null {
  try {
    const state = JSON.parse(localStorage.getItem(MENU_STATE_KEY) ?? "null") as { language?: unknown; languageChosen?: unknown } | null;
    return state?.languageChosen && typeof state.language === "string" ? state.language : null;
  } catch {
    return null;
  }
}

/**
 * One language for the menu and the booking page: `?lang=` (the menu's link
 * here), else what the guest picked on the menu or here, else the phone's
 * language, else German.
 */
export function initialLanguage(): BookingLanguage {
  const pick = (value: string | null | undefined): BookingLanguage | null => {
    const code = String(value ?? "").slice(0, 2).toLowerCase();
    return code === "zh" || code === "de" || code === "en" ? code : null;
  };
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANGUAGE_KEY); } catch { /* Private tab. */ }
  return pick(new URLSearchParams(location.search).get("lang")) ?? pick(menuLanguage()) ?? pick(stored) ?? pick(navigator.language) ?? "de";
}

/** Kept here and on the menu, so the menu opens in the language picked here. */
export function rememberLanguage(language: BookingLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
    const state = JSON.parse(localStorage.getItem(MENU_STATE_KEY) ?? "null") as Record<string, unknown> | null;
    if (state && typeof state === "object") localStorage.setItem(MENU_STATE_KEY, JSON.stringify({ ...state, language, languageChosen: true }));
  } catch { /* Private tab: this visit only. */ }
}
