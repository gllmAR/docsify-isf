#!/usr/bin/env node
/*
 * Reproducible UI audit captures for docs/ui-audit.
 * Run: node tools/ui-audit.mjs [--chrome PATH]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "docs", "ui-audit");
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".fs": "text/plain; charset=utf-8",
    ".vs": "text/plain; charset=utf-8",
    ".json": "application/json"
};
const chromeArg = process.argv.indexOf("--chrome");
const executablePath = chromeArg >= 0 ? process.argv[chromeArg + 1] :
    process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(executablePath)) {
    console.error("ui-audit: Chrome not found; pass --chrome PATH");
    process.exit(1);
}
const puppeteer = (await import("puppeteer-core")).default;
const server = http.createServer((request, response) => {
    let urlPath = decodeURIComponent((request.url || "/").split("?")[0].split("#")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(root, urlPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404); response.end("not found"); return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
    executablePath, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
});
const page = await browser.newPage();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const blockInfo = async () => page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    block.scrollIntoView({ block: "center" });
    return true;
});
const clickRegion = async (region) => page.evaluate((name) => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const toggle = block && block.querySelector('.pui-workbench-toggle[data-pui-region="' + name + '"]');
    if (!toggle) return false;
    if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
    return true;
}, region);
const clickTab = async (label) => page.evaluate((name) => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const pane = block && block.querySelector(".pui-workbench-pane.is-right");
    const tab = pane && Array.from(pane.querySelectorAll(".pui-pane-tab")).find((node) => node.textContent === name);
    if (tab) tab.click();
}, label);
const shot = async (name) => {
    const block = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll(".isf-block")).find((x) => /Plasma/i.test(x.dataset.isfTitle || ""));
        b && b.scrollIntoView({ block: "center" });
        return true;
    });
    if (!block) return;
    await sleep(350);
    const handle = await page.$(".isf-block[data-isf-title='Plasma generator']");
    if (handle) await handle.screenshot({ path: path.join(out, name + ".png") });
    else await page.screenshot({ path: path.join(out, name + ".png") });
};

await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await blockInfo();
await sleep(1000);
await clickRegion("right");
await sleep(300);
await shot("desktop-default");

// Named preset: save the current look, capture it, then remove it so the
// remaining captures start from a clean store.
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const presetBlock = block.querySelector(".pui-presets");
    const save = presetBlock && Array.from(presetBlock.querySelectorAll("button")).find((node) => /Save preset/i.test(node.textContent));
    if (save) save.click();
});
await sleep(200);
await page.evaluate(() => {
    const dialog = document.querySelector("dialog.pui-dialog");
    const input = dialog && dialog.querySelector('input[type="text"]');
    if (input) input.value = "Review look";
    const submit = dialog && dialog.querySelector('button[type="submit"]');
    if (submit) submit.click();
});
await sleep(400);
await shot("desktop-presets");
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const presetBlock = block.querySelector(".pui-presets");
    const remove = presetBlock && Array.from(presetBlock.querySelectorAll("button")).find((node) => /Delete preset/i.test(node.textContent));
    if (remove) remove.click();
});
await sleep(200);
await page.evaluate(() => {
    const dialog = document.querySelector("dialog.pui-dialog");
    const submit = dialog && dialog.querySelector('button[type="submit"]');
    if (submit) submit.click();
});
await sleep(300);
await page.evaluate(() => {
    document.querySelectorAll(".pui-toast-close").forEach((button) => button.click());
});
await sleep(200);
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("P");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(350);
await page.screenshot({ path: path.join(out, "desktop-palette.png") });
await page.keyboard.press("Escape");
await sleep(150);

await clickRegion("left");
await sleep(300);
await shot("desktop-both-panes");

await clickTab("View");
await page.waitForFunction(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const selected = block && block.querySelector('.pui-workbench-pane.is-right .pui-pane-tab[aria-selected="true"]');
    return selected && selected.textContent === "View";
}, { timeout: 2000 });
await sleep(200);
await shot("desktop-view-tab");

await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const toggle = block.querySelector(".pui-workbench-titlebar-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
});
await sleep(250);
await shot("desktop-compact");
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const toggle = block.querySelector(".pui-workbench-titlebar-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "false") toggle.click();
});
await sleep(250);

// Shortcuts overlay: a workbench-level modal, readable over the whole editor.
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const trigger = block && block.querySelector(".pui-header-menu-trigger");
    if (trigger) trigger.click();
});
await sleep(150);
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const item = block && Array.from(block.querySelectorAll(".pui-actions button")).find((b) => /Keyboard shortcuts/i.test(b.textContent));
    if (item) item.click();
});
await sleep(300);
await shot("desktop-help");
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const close = block && block.querySelector('.isf-overlay [data-isf-overlay="close"]');
    if (close) close.click();
});
await sleep(150);

// Focus preview is a direct titlebar action, not a Header-menu item.
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const action = block.querySelector('.pui-workbench-action[data-pui-action="focus"]');
    if (action) action.click();
});
await sleep(400);
await shot("desktop-focus");

// Responsive captures load at phone width so narrow mode and auto-open are
// exercised exactly as a phone user sees them.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await blockInfo();
await sleep(1500);
await clickRegion("right");
await sleep(300);
await shot("mobile-parameters");
await clickRegion("left");
await sleep(400);
await shot("mobile-source");

// Stage HUD at phone width: close Source and Playback, then tap the preview.
// The HUD owns play/time/stats/capture/fullscreen without the bottom strip.
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const left = block && block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (left && left.getAttribute("aria-expanded") === "true") left.click();
    const bottom = block && block.querySelector('.pui-workbench-toggle[data-pui-region="bottom"]');
    if (bottom && bottom.getAttribute("aria-expanded") === "true") bottom.click();
});
await sleep(350);
const stagePoint = await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    block.scrollIntoView({ block: "center" });
    const rect = block.querySelector(".isf-stage").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.touchscreen.tap(stagePoint.x, stagePoint.y);
await page.mouse.click(stagePoint.x, stagePoint.y);
await sleep(350);
await shot("mobile-stage");

// Long-press tooltip on a stage HUD action at phone width.
const tooltipPoint = await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const button = block.querySelector('.pui-workbench-toggle[data-pui-region="right"]');
    button.scrollIntoView({ block: "center" });
    const rect = button.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await sleep(200);
await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (target) target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch", clientX: x, clientY: y }));
}, tooltipPoint);
await sleep(650);
// Do not scroll here: PUI correctly dismisses a tooltip on scroll.
await page.screenshot({ path: path.join(out, "mobile-tooltip.png") });
await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (target) target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", clientX: x, clientY: y }));
}, tooltipPoint);
await page.keyboard.press("Escape");
await sleep(150);

// Help and palette at phone width: both must fit without horizontal clipping.
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const trigger = block && block.querySelector(".pui-header-menu-trigger");
    if (trigger) trigger.click();
});
await sleep(150);
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const item = block && Array.from(block.querySelectorAll(".pui-actions button")).find((b) => /Keyboard shortcuts/i.test(b.textContent));
    if (item) item.click();
});
await sleep(300);
await page.screenshot({ path: path.join(out, "mobile-help.png") });
await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    const close = block && block.querySelector('.isf-overlay [data-isf-overlay="close"]');
    if (close) close.click();
});
await sleep(150);
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("P");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(350);
await page.screenshot({ path: path.join(out, "mobile-palette.png") });
await page.keyboard.press("Escape");
await sleep(150);

await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await blockInfo();
await sleep(1000);
await clickRegion("right");
await sleep(300);

// Fullscreen: trusted double-click required by requestFullscreen.
const point = await page.evaluate(() => {
    const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
    block.scrollIntoView({ block: "center" });
    const rect = block.querySelector(".isf-canvas").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.click(point.x, point.y, { clickCount: 2 });
await sleep(900);
await page.screenshot({ path: path.join(out, "desktop-fullscreen.png") });
await page.evaluate(async () => {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) await exit.call(document);
});
await sleep(500);
await browser.close();
server.close();
console.log("ui-audit: wrote " + out);
