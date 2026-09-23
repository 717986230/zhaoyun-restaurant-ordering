import QRCode from "qrcode";
import type { MenuLanguage } from "@zhaoyun/contracts";

/**
 * The printable QR card, as a PNG a phone or a print shop can use as is.
 *
 * One drawing for every card the console hands out — the menu's own code and
 * each table's — so they cannot drift apart. The words on it are in the
 * languages the menu offers, not the console's: it is the guests who read it.
 * Error correction is high because the card lives on a restaurant table.
 */
export const CARD_COPY: Record<MenuLanguage, { table: string; scan: string }> = {
  zh: { table: "桌", scan: "扫码看菜单" },
  de: { table: "Tisch", scan: "Speisekarte scannen" },
  en: { table: "Table", scan: "Scan for the menu" }
};

export interface QrCardContent {
  url: string;
  restaurantName: string;
  menuLanguages: MenuLanguage[];
  /** A table number, for a table's own card; none for the menu's. */
  table?: string;
  /** The table's note ("Terrasse"), under its number. */
  label?: string;
}

const WIDTH = 1200;
const HEIGHT = 1650;
const INK = "#111417";
const INK_2 = "#3f4a45";
const RULE = "#d7ddda";
const SERIF = 'Georgia, "Noto Serif SC", "Songti SC", serif';
const SANS = 'system-ui, -apple-system, "Noto Sans SC", "PingFang SC", sans-serif';

/** Writes one centred line, shrinking the type until it fits the card. */
function line(context: CanvasRenderingContext2D, text: string, y: number, size: number, font: string, color: string) {
  let px = size;
  do {
    context.font = font.replace("{size}", String(px));
    if (context.measureText(text).width <= WIDTH - 200) break;
    px -= 2;
  } while (px > 18);
  context.fillStyle = color;
  context.textAlign = "center";
  context.fillText(text, WIDTH / 2, y);
}

export async function renderQrCard(content: QrCardContent): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the card");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = RULE;
  context.lineWidth = 3;
  context.beginPath();
  context.roundRect(40, 40, WIDTH - 80, HEIGHT - 80, 36);
  context.stroke();

  const languages = content.menuLanguages.length ? content.menuLanguages : (["de", "en"] as MenuLanguage[]);
  line(context, content.restaurantName, 200, 96, `400 {size}px ${SERIF}`, INK);
  if (content.table) {
    line(context, `${languages.map((language) => CARD_COPY[language].table).join(" · ")} ${content.table}`, 290, 56, `italic 400 {size}px ${SERIF}`, INK_2);
    if (content.label) line(context, content.label, 350, 36, `400 {size}px ${SANS}`, INK_2);
  }

  const code = document.createElement("canvas");
  await QRCode.toCanvas(code, content.url, { errorCorrectionLevel: "H", margin: 2, width: 820, color: { dark: INK, light: "#ffffff" } });
  context.imageSmoothingEnabled = false;
  context.drawImage(code, (WIDTH - 820) / 2, 400, 820, 820);

  const [first, ...others] = languages.map((language) => CARD_COPY[language].scan);
  line(context, first ?? "", 1330, 56, `600 {size}px ${SANS}`, INK);
  if (others.length) line(context, others.join(" · "), 1405, 38, `400 {size}px ${SANS}`, INK_2);
  line(context, new URL(content.url).host, 1510, 32, `400 {size}px ui-monospace, Menlo, monospace`, INK_2);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))), "image/png"));
}

/**
 * A file name every browser keeps. ASCII only: Chromium, and phones after it,
 * silently save a name with Chinese characters in it as plain "download".
 * The restaurant's name comes along when it is written in Latin letters
 * ("Gasthaus Kröll" → gasthaus-kroll); "赵云" simply drops out.
 */
export function cardFileName(restaurantName: string, table?: string): string {
  const slug = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${[slug(restaurantName), table ? `table-${slug(table)}` : "menu", "qr"].filter(Boolean).join("-")}.png`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Kept alive a while: Safari starts the download after the click returns,
  // and a URL revoked too early saves an empty file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadQrCard(content: QrCardContent) {
  downloadBlob(await renderQrCard(content), cardFileName(content.restaurantName, content.table));
}
