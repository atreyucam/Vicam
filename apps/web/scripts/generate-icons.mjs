import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsRoot = path.join(webRoot, "public", "icons");
const standardSource = await readFile(path.join(iconsRoot, "vicam-mark.svg"), "utf8");
const maskableSource = await readFile(path.join(iconsRoot, "vicam-maskable.svg"), "utf8");
const targets = [
  ["pwa-192.png", 192, standardSource],
  ["pwa-512.png", 512, standardSource],
  ["pwa-maskable-512.png", 512, maskableSource],
  ["apple-touch-icon.png", 180, standardSource],
];

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const [fileName, size, source] of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body,svg{display:block;margin:0;width:100%;height:100%}</style>${source}`,
    );
    await page.screenshot({ path: path.join(iconsRoot, fileName) });
  }
} finally {
  await browser.close();
}
