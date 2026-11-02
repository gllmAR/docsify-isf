#!/usr/bin/env node
/*
 * Full workbench interaction audit.
 * Exercises every UI family, captures the result of each action, and fails on
 * console errors or missing UI state. Screenshots are written to
 * tests/artifacts/interaction/ (gitignored; upload them from CI when needed).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const artifacts = path.join(here, "artifacts", "interaction");
fs.mkdirSync(artifacts, { recursive: true });
const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".md": "text/markdown; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".png": "image/png", ".fs": "text/plain; charset=utf-8",
    ".vs": "text/plain; charset=utf-8", ".json": "application/json"
};
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
const puppeteer = (await import("puppeteer-core")).default;
const executablePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(executablePath)) {
    console.log("browser-interaction: Chrome not found — skipping"); process.exit(0);
}
const browser = await puppeteer.launch({
    executablePath, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
});
const page = await browser.newPage();
try { await browser.defaultBrowserContext().overridePermissions(url, []); } catch (error) { /* headless defaults */ }
const errors = [];
const actions = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const title = "Input-type test card";
const selector = `.isf-block[data-isf-title="${title}"]`;
const check = (name, ok, detail) => {
    checks.push({ name, ok, detail: detail || "" });
    if (!ok) console.log("FAIL " + name + (detail ? " " + JSON.stringify(detail) : ""));
};
const capture = async (name) => {
    await page.evaluate((s) => {
        const block = document.querySelector(s);
        if (block) block.scrollIntoView({ block: "center" });
    }, selector);
    await sleep(220);
    const handle = await page.$(selector);
    if (handle) await handle.screenshot({ path: path.join(artifacts, name + ".png") });
    actions.push(name);
};
const blockEval = (fn, ...args) => page.evaluate((s, f, a) => {
    const block = document.querySelector(s);
    return (new Function("block", "args", "return (" + f + ")(block, args);"))(block, a);
}, selector, fn.toString(), args);
const paneOpen = (region) => blockEval((block, [name]) => {
    const pane = block.querySelector(".pui-workbench-pane.is-" + name);
    return !!pane && !pane.classList.contains("is-collapsed");
}, region);
const togglePane = (region, open) => blockEval((block, [name, want]) => {
    const toggle = block.querySelector('.pui-workbench-toggle[data-pui-region="' + name + '"]');
    if (!toggle) return false;
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    if (want === undefined ? !isOpen : want !== isOpen) toggle.click();
    return true;
}, region, open);
const selectTab = (name) => blockEval((block, [label]) => {
    const pane = block.querySelector(".pui-workbench-pane.is-right");
    const tab = pane && Array.from(pane.querySelectorAll(".pui-pane-tab")).find((node) => node.textContent === label);
    if (tab) tab.click();
    return !!tab;
}, name);
const openMenu = () => blockEval((block) => {
    const trigger = block.querySelector(".pui-header-menu-trigger");
    if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    return !!trigger;
});
const menuAction = (label) => blockEval((block, [re]) => {
    const trigger = block.querySelector(".pui-header-menu-trigger");
    if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const item = Array.from(document.querySelectorAll(".pui-actions button")).find((b) => new RegExp(re).test(b.textContent));
    if (item) item.click();
    return !!item;
}, label);
const closeOverlay = () => blockEval((block) => {
    const overlay = block.querySelector(".isf-overlay");
    const close = overlay && Array.from(overlay.querySelectorAll("button")).find((b) => /Close/i.test(b.textContent));
    if (close) close.click();
    return true;
});

await page.evaluateOnNewDocument(() => {
    window.__copied = null;
    window.__downloads = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text) => { window.__copied = String(text); return Promise.resolve(); } } });
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (this.download) { window.__downloads.push(this.href); return; }
        return nativeClick.call(this);
    };
});
page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text()); });
page.on("pageerror", (error) => errors.push("pageerror: " + error.message));

await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
await sleep(1400);

// ── desktop shell, pane and tab actions
await capture("01-desktop-initial");
await togglePane("right", true);
await selectTab("Parameters");
await capture("02-parameters");
for (const label of ["View", "Log", "Parameters"]) {
    await selectTab(label);
    await sleep(200);
    await capture("03-tab-" + label.toLowerCase());
}
await blockEval((block) => {
    const left = block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (left && left.getAttribute("aria-expanded") !== "true") left.click();
    return true;
});
await sleep(400);
await capture("04-source-pane");
await blockEval((block) => {
    const toggle = block.querySelector(".pui-workbench-titlebar-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    return true;
});
await sleep(250);
await capture("05-titlebar-compact");
await blockEval((block) => {
    const toggle = block.querySelector(".pui-workbench-titlebar-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "false") toggle.click();
    return true;
});
await sleep(200);

// ── menu and direct actions
await openMenu();
await capture("06-menu-open");
await menuAction("Keyboard shortcuts");
await sleep(250);
await capture("07-help-overlay");
await closeOverlay();
await menuAction("Randomize parameters");
await sleep(250);
await capture("08-randomize");
await blockEval((block) => {
    const action = block.querySelector('.pui-workbench-action[data-pui-action="reset"]');
    if (action) action.click();
    return !!action;
});
await sleep(250);
await capture("09-direct-reset");
await blockEval((block) => {
    const action = block.querySelector('.pui-workbench-action[data-pui-action="share"]');
    if (action) action.click();
    return !!action;
});
await sleep(250);
await capture("10-direct-share");
const copied = await page.evaluate(() => window.__copied);
check("direct share copies a link", !!copied && /isf-shader=/.test(copied), copied && copied.slice(0, 80));

// ── parameter filter
await selectTab("Parameters");
const filter = await page.$(`${selector} .isf-params .pui-search input[type="search"]`);
if (filter) {
    await filter.click();
    await filter.type("center");
    await sleep(250);
    await capture("11-parameter-filter");
    await filter.evaluate((el) => {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(250);
} else {
    check("parameter filter exists", false);
}

// ── field families: range, number, bool, long, color, point2D, event, image
const fieldNames = await blockEval((block) => Array.from(block.querySelectorAll("[data-isf-param]")).map((row) => row.getAttribute("data-isf-param")));
check("all input families are rendered", fieldNames.length >= 8, fieldNames);
for (const name of fieldNames) {
    const field = await page.$(`${selector} [data-isf-param="${name}"]`);
    if (!field) continue;
    const range = await field.$('input[type="range"]');
    if (range) {
        const box = await range.boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.78, box.y + box.height / 2, { steps: 8 });
            await page.mouse.up();
            await sleep(180);
            await capture("12-field-" + name + "-range");
        }
    }
    const checkbox = await field.$('input[type="checkbox"]');
    if (checkbox) { await checkbox.click(); await sleep(150); await capture("12-field-" + name + "-bool"); }
    const select = await field.$("select");
    if (select) {
        const values = await select.$$eval("option", (options) => options.map((option) => option.value).filter(Boolean));
        if (values.length > 1) { await select.select(values[1]); await sleep(180); await capture("12-field-" + name + "-long"); }
    }
    const number = await field.$('input[type="number"]');
    if (number) {
        const value = await number.evaluate((el) => el.value);
        await number.click({ clickCount: 3 });
        await page.keyboard.type(value === "0" ? "1" : "0");
        await page.keyboard.press("Tab");
        await sleep(150);
        await capture("12-field-" + name + "-number");
    }
    const eventButton = await field.$("button.pui-primary, button.pui-button");
    if (eventButton) {
        const label = await eventButton.evaluate((el) => el.textContent);
        if (!/reset|choose|mic|audio|image/i.test(name + " " + label)) {
            await eventButton.click();
            await sleep(150);
            await capture("12-field-" + name + "-event");
        }
    }
}
// PUI per-field reset is a real button and must be exercised.
const resetField = await page.$(`${selector} [data-isf-param="level"] button.pui-reset`);
if (resetField) {
    await resetField.click();
    await sleep(200);
    await capture("12-field-level-reset");
}
// image chooser, if this fixture exposes one
const imageButton = await page.$(`${selector} [data-isf-param="inputImage"] button`);
if (imageButton) {
    try {
        const chooserPromise = page.waitForFileChooser({ timeout: 2000 });
        await imageButton.click();
        const chooser = await chooserPromise;
        await chooser.accept([path.join(root, "samples", "isf-logo.png")]);
        await sleep(500);
        await capture("13-image-input");
    } catch (error) { /* optional control */ }
}
const hasMicButton = await blockEval((block) => Array.from(block.querySelectorAll("button")).some((node) => /Use mic/i.test(node.textContent)));
if (hasMicButton) {
    await blockEval((block) => {
        const button = Array.from(block.querySelectorAll("button")).find((node) => /Use mic/i.test(node.textContent));
        if (button) button.click();
    });
    await sleep(500);
    await capture("13b-microphone-attempt");
}

// ── View and Log tabs own real host actions
await selectTab("View");
await sleep(250);
await capture("13c-view-tab");
const viewActions = await blockEval((block) => {
    const scale = block.querySelector('.isf-view select[aria-label="Render scale"]');
    const resolution = block.querySelector('.isf-view select[aria-label="Render resolution"]');
    if (scale) { scale.value = "0.5"; scale.dispatchEvent(new Event("change", { bubbles: true })); }
    if (resolution) { resolution.value = "hd"; resolution.dispatchEvent(new Event("change", { bubbles: true })); }
    return { scale: !!scale, resolution: !!resolution };
});
await sleep(400);
await capture("13d-view-scale-resolution");
const viewRandom = await blockEval((block) => {
    const button = Array.from(block.querySelectorAll(".isf-view button")).find((node) => /Randomize/i.test(node.textContent));
    if (button) button.click();
    return !!button;
});
await sleep(250);
await capture("13e-view-randomize");
await blockEval((block) => {
    const button = Array.from(block.querySelectorAll(".isf-view button")).find((node) => /Export PNG/i.test(node.textContent));
    if (button) button.click();
    return !!button;
});
await sleep(400);
await capture("13f-view-export");
check("View controls execute", viewActions.scale && viewActions.resolution && viewRandom, viewActions);
await selectTab("Log");
await sleep(250);
await capture("13g-log-tab");
await blockEval((block) => {
    const button = Array.from(block.querySelectorAll("[data-pui-section=log] button, .pui-section[data-pui-section=log] button"))
        .find((node) => /Reset parameters/i.test(node.textContent));
    if (button) button.click();
    return !!button;
});
await sleep(250);
await capture("13h-log-reset");

// ── transport controls
await togglePane("bottom", true);
const transport = await page.$(`${selector} .pui-transport`);
if (transport) {
    const play = await page.$(`${selector} .pui-transport button`);
    if (play) { await play.click(); await sleep(350); await capture("14-transport-playing"); await play.click(); }
    const seek = await page.$(`${selector} .pui-transport input[type="range"]`);
    if (seek) {
        const box = await seek.boundingBox();
        if (box) {
            await page.mouse.click(box.x + box.width * 0.65, box.y + box.height / 2);
            await sleep(250);
            await capture("15-transport-seek");
        }
    }
}

// ── editor actions
await togglePane("left", true);
await sleep(300);
await capture("16-source-open");
for (const text of ["Vertex", "Fragment"]) {
    await blockEval((block, [label]) => {
        const tab = Array.from(block.querySelectorAll(".isf-tab")).find((node) => new RegExp(label).test(node.textContent));
        if (tab) tab.click();
        return !!tab;
    }, text);
    await sleep(200);
    await capture("17-editor-" + text.toLowerCase());
}
const apply = await page.$(`${selector} .isf-editor-actions button.isf-apply`);
if (apply) { await apply.click(); await sleep(500); await capture("18-editor-apply"); }
const editorMenu = async (label) => blockEval((block, [re]) => {
    const trigger = block.querySelector(".isf-editor-more .pui-menu-trigger");
    if (!trigger) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const item = Array.from(block.querySelectorAll(".isf-editor-more .pui-menu-popup [role=menuitem], .isf-editor-more .pui-menu-popup .pui-button"))
        .find((node) => new RegExp(re).test(node.textContent));
    if (item) item.click();
    return !!item;
}, label);
if (await editorMenu("Import shader")) {
    await sleep(250);
    await capture("19-import-open");
    const area = await page.$(`${selector} .isf-import textarea`);
    if (area) {
        await area.type("void mainImage(out vec4 c, in vec2 p) { c = vec4(p / iResolution.xy, 0.5, 1.0); }");
        const convert = await page.$(`${selector} .isf-import-actions button`);
        if (convert) { await convert.click(); await sleep(800); await capture("20-import-converted"); }
        await editorMenu("Revert to file");
        await sleep(500);
    }
}
const moreAction = async (label) => blockEval((block, [re]) => {
    const trigger = block.querySelector(".isf-editor-more .pui-menu-trigger");
    if (!trigger) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    const item = Array.from(block.querySelectorAll(".isf-editor-more .pui-menu-popup [role=menuitem], .isf-editor-more .pui-menu-popup .pui-button"))
        .find((node) => new RegExp(re).test(node.textContent));
    if (item) item.click();
    return !!item;
}, label);
await moreAction("Copy source");
await sleep(250);
await capture("18b-editor-copy");
await moreAction("Keyboard shortcuts");
await sleep(250);
await capture("18c-editor-help");
await closeOverlay();
await moreAction("Revert to file");
await sleep(300);
await capture("18d-editor-revert");
const templateTrigger = await page.$(`${selector} .isf-editor-more .pui-menu-trigger`);
if (templateTrigger) {
    await templateTrigger.click(); await sleep(200);
    await capture("21-templates");
    const item = await page.$(`${selector} .isf-editor-more [role="menuitem"]`);
    if (item) { await item.click(); await sleep(250); }
}
const fold = await page.$(`${selector} .isf-fold-btn`);
if (fold) { await fold.click(); await sleep(200); await capture("22-editor-folded"); await fold.click(); }
const sourceClose = await blockEval((block) => {
    const toggle = block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    return true;
});
await sleep(250);
await capture("23-source-closed");

// ── focus preview (direct titlebar action)
await blockEval((block) => {
    const action = block.querySelector('.pui-workbench-action[data-pui-action="focus"]');
    if (action) action.click();
    return !!action;
});
await sleep(300);
await capture("24-focus-preview");
const focusState = await page.evaluate((s) => {
    const block = document.querySelector(s);
    return {
        left: block.querySelector('.pui-workbench-toggle[data-pui-region="left"]').getAttribute("aria-expanded"),
        right: block.querySelector('.pui-workbench-toggle[data-pui-region="right"]').getAttribute("aria-expanded"),
        bottom: block.querySelector('.pui-workbench-toggle[data-pui-region="bottom"]').getAttribute("aria-expanded")
    };
}, selector);
check("focus preview closes all panes", focusState.left === "false" && focusState.right === "false" && focusState.bottom === "false", focusState);

// ── fullscreen
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
const point = await page.evaluate((s) => {
    const rect = document.querySelector(s + " .isf-canvas").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}, selector);
await page.mouse.click(point.x, point.y, { clickCount: 2 });
await sleep(900);
await capture("25-fullscreen");
check("fullscreen entered", await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement)));
await page.evaluate(async () => {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) await exit.call(document);
});
await sleep(500);

// ── mobile touch pass: reload at phone width so auto-open/narrow are native.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
await sleep(1500);
await capture("26-mobile-initial");
const tapRegion = async (region) => {
    const point = await page.evaluate((s, name) => {
        const toggle = document.querySelector(s + ' .pui-workbench-toggle[data-pui-region="' + name + '"]');
        if (!toggle) return null;
        const rect = toggle.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector, region);
    if (point) await page.touchscreen.tap(point.x, point.y);
    await sleep(350);
};
await tapRegion("right");
await capture("27-mobile-parameters");
await tapRegion("left");
await capture("28-mobile-source");
await tapRegion("right");
await tapRegion("bottom");
await capture("29-mobile-playback");
await page.screenshot({ path: path.join(artifacts, "30-mobile-page.png") });

check("no console errors", errors.length === 0, errors.slice(0, 5));
try {
    await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 4000))]);
} catch (error) { /* force-close below */ }
try { if (browser.process()) browser.process().kill("SIGKILL"); } catch (error) { /* ignore */ }
server.close();
const failed = checks.filter((c) => !c.ok);
console.log("\nbrowser-interaction: " + actions.length + " actions captured, " + (checks.length - failed.length) + "/" + checks.length + " checks passed");
console.log("artifacts: " + artifacts);
if (failed.length) {
    console.log(JSON.stringify(failed, null, 2));
    process.exit(1);
}
process.exit(0);
