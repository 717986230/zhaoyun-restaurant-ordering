/**
 * Renders the admin console's app icons from public/icons/admin.svg: the PNG
 * sizes a browser wants before it offers to install the console as a desktop
 * app, and a "maskable" one (the art inside the safe circle, the colour to
 * the edge) that Android crops to its own shape. Run after changing the SVG:
 *   node scripts/make-admin-icons.mjs
 * (Chromium comes from Playwright; PLAYWRIGHT_CHROMIUM overrides where.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(path.join(root, "public/icons/admin.svg"), "utf8");
const maskable = svg.replace(/<rect[^>]*\/>/, '<rect width="512" height="512" fill="#1d4739"/><g transform="translate(51.2 51.2) scale(0.8)">').replace("</svg>", "</g></svg>");

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage();
for (const [file, source, size] of [["admin-192.png", svg, 192], ["admin-512.png", svg, 512], ["admin-maskable-512.png", maskable, 512], ["admin-180.png", svg, 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`);
  await page.screenshot({ path: path.join(root, "public/icons", file), omitBackground: true });
}
await browser.close();

