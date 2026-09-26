/**
 * Renders each app's icons from its SVG in public/icons: the guest menu
 * (menu.svg), the POS (pos.svg) and the admin console (admin.svg). For each,
 * the PNG sizes a browser wants before it offers to install the app on a
 * phone or a computer, an iPhone's home-screen icon, and a "maskable" one (the
 * art inside the safe circle, the colour to the edge) that Android crops to
 * its own shape. Run after changing an SVG:
 *   node scripts/make-app-icons.mjs
 * (Chromium comes from Playwright; PLAYWRIGHT_CHROMIUM overrides where.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["menu", "pos", "admin"];

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();
for (const app of APPS) {
  const svg = readFileSync(path.join(root, "public/icons", `${app}.svg`), "utf8");
  // The first rect is the rounded background: square to the edge, the art shrunk into the safe zone.
  const background = /<rect[^>]*fill="([^"]+)"[^>]*\/>/.exec(svg)[1];
  const maskable = svg.replace(/<rect[^>]*\/>/, `<rect width="512" height="512" fill="${background}"/><g transform="translate(51.2 51.2) scale(0.8)">`).replace("</svg>", "</g></svg>");
  for (const [file, source, size] of [[`${app}-192.png`, svg, 192], [`${app}-512.png`, svg, 512], [`${app}-maskable-512.png`, maskable, 512], [`${app}-180.png`, svg, 180]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
    await page.screenshot({ path: path.join(root, "public/icons", file), omitBackground: true });
  }
}
await browser.close();
