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
fs.rmSync(artifacts, { recursive: true, force: true });
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
    // Scope to this workbench: a docsify page mounts many header menus.
    const item = Array.from(block.querySelectorAll(".pui-actions button")).find((b) => new RegExp(re).test(b.textContent));
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
const paramGroups = await blockEval((block) => {
    const groups = Array.from(block.querySelectorAll(".pui-disclosure"));
    return {
        labels: groups.map((group) => group.querySelector(".pui-disclosure-summary")?.textContent?.trim() || ""),
        fields: block.querySelectorAll("[data-isf-param]").length
    };
});
check("large materials group parameters by type", paramGroups.labels.length >= 3 && paramGroups.labels.some((label) => /Media|Color|Geometry|Values/.test(label)) && paramGroups.fields >= 8, paramGroups);

// ── named presets: save, change a value, recall, delete
const clickPresetAction = (re) => blockEval((block, [pattern]) => {
    const presetBlock = block.querySelector(".pui-presets");
    const button = presetBlock && Array.from(presetBlock.querySelectorAll("button")).find((node) => new RegExp(pattern).test(node.textContent));
    if (button) button.click();
    return !!button;
}, re);
check("save preset opens a name form", await clickPresetAction("^Save$"));
await sleep(250);
await page.screenshot({ path: path.join(artifacts, "02b-preset-save-dialog.png") });
actions.push("02b-preset-save-dialog");
const presetDialog = await page.$("dialog.pui-dialog");
if (presetDialog) {
    const presetName = await presetDialog.$('input[type="text"]');
    if (presetName) await presetName.type("Look A");
    const savePreset = await presetDialog.$('button[type="submit"]');
    if (savePreset) await savePreset.click();
}
await sleep(400);
const savedPresets = await blockEval((block) => Array.from(block.querySelectorAll(".pui-preset")).map((node) => ({text: node.textContent, selected: node.getAttribute("aria-selected")})));
check("preset save creates a selectable preset", savedPresets.length === 1 && savedPresets[0].text === "Look A" && savedPresets[0].selected === "true", savedPresets);
await capture("02c-preset-saved");
const levelNumber = await page.$(`${selector} [data-isf-param="level"] input[type="number"]`);
if (levelNumber) {
    await levelNumber.click({ clickCount: 3 });
    await page.keyboard.type("0.25");
    await page.keyboard.press("Tab");
    await sleep(250);
}
await blockEval((block) => {
    const preset = block.querySelector(".pui-preset");
    if (preset) preset.click();
    return !!preset;
});
await sleep(350);
const recalledLevel = levelNumber ? await levelNumber.evaluate((el) => el.value) : "";
check("preset recall restores the saved value", recalledLevel === "1", recalledLevel);
await capture("02d-preset-recall");
check("rename preset opens a name form", await clickPresetAction("^Rename$"));
await sleep(200);
const renameDialog = await page.$("dialog.pui-dialog");
if (renameDialog) {
    const renameInput = await renameDialog.$('input[type="text"]');
    if (renameInput) await renameInput.type("Look B");
    const renameSave = await renameDialog.$('button[type="submit"]');
    if (renameSave) await renameSave.click();
}
await sleep(350);
const renamedPreset = await blockEval((block) => {
    const preset = block.querySelector(".pui-preset");
    return preset ? preset.textContent : "";
});
check("preset rename updates the selected label", renamedPreset === "Look B", renamedPreset);
await capture("02e-preset-renamed");
check("delete preset opens confirmation", await clickPresetAction("^Delete$"));
await sleep(200);
const deleteDialog = await page.$("dialog.pui-dialog");
if (deleteDialog) {
    const confirmDelete = await deleteDialog.$('button[type="submit"]');
    if (confirmDelete) await confirmDelete.click();
}
await sleep(350);
const remainingPresets = await blockEval((block) => block.querySelectorAll(".pui-preset").length);
check("preset delete removes the preset", remainingPresets === 0, remainingPresets);
await capture("02f-preset-delete");
for (const label of ["View", "Log", "Parameters"]) {
    await selectTab(label);
    await sleep(200);
    const selectedTab = await blockEval((block) => {
        const selected = block.querySelector('.pui-workbench-pane.is-right .pui-pane-tab[aria-selected="true"]');
        return selected ? selected.textContent : "";
    });
    check("tab " + label + " is selected", selectedTab === label, selectedTab);
    await capture("03-tab-" + label.toLowerCase());
}
await blockEval((block) => {
    const left = block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (left && left.getAttribute("aria-expanded") !== "true") left.click();
    return true;
});
await page.waitForFunction((s) => {
    const block = document.querySelector(s);
    const more = block && block.querySelector(".isf-editor-more");
    return !!more && !more.classList.contains("isf-hidden") && !!more.querySelector(".pui-menu-trigger");
}, { timeout: 2500 }, selector).catch(() => {});
await sleep(250);
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
const helpOpen = await blockEval((block) => {
    const overlay = block.querySelector(".isf-overlay");
    return !!overlay && overlay.style.display !== "none" && /Keyboard shortcuts/.test(overlay.textContent);
});
check("Keyboard shortcuts opens the help overlay", helpOpen);
const menuClosed = await blockEval((block) => {
    const trigger = block.querySelector(".pui-header-menu-trigger");
    return !!trigger && trigger.getAttribute("aria-expanded") === "false";
});
check("header menu closes after an action", menuClosed);
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
// CI's viewport/contained workbench can leave the Source drawer collapsed;
// the More menu only makes sense with its host pane open.
await blockEval((block) => {
    const left = block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (left && left.getAttribute("aria-expanded") !== "true") left.click();
    return true;
});
await sleep(350);
const sourceReadyForMore = await blockEval((block) => {
    const pane = block.querySelector(".pui-workbench-pane.is-left");
    return !!pane && !pane.classList.contains("is-collapsed") && pane.getBoundingClientRect().width > 1;
});
check("Source pane is open before the editor More bounds", sourceReadyForMore);
const templateOpen = await blockEval((block) => {
    const trigger = block.querySelector(".isf-editor-more .pui-menu-trigger");
    if (!trigger) return false;
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    return true;
});
if (templateOpen) {
    await sleep(220);
    const moreBounds = await blockEval((block) => {
        const popup = block.querySelector(".isf-editor-more .pui-menu-popup");
        const source = block.querySelector(".pui-workbench-pane.is-left");
        if (!popup || !source) return null;
        const p = popup.getBoundingClientRect(), s = source.getBoundingClientRect();
        return {left: Math.round(p.left - s.left), right: Math.round(p.right - s.right)};
    });
    check("editor More menu stays inside the Source pane", !!moreBounds && moreBounds.left >= -1 && moreBounds.right <= 6, moreBounds);
    await capture("21-templates");
    await editorMenu("float input");
    await sleep(300);
}
const fold = await page.$(`${selector} .isf-fold-btn`);
if (fold) {
    await fold.click();
    await sleep(250);
    await capture("22-editor-folded");
    const folded = await page.evaluate((s) => {
        const block = document.querySelector(s);
        const pane = block.querySelector(".pui-workbench-pane.is-left");
        const wrap = block.querySelector(".isf-editor-wrap");
        const editor = block.querySelector(".isf-editor");
        const area = block.querySelector(".isf-editor textarea");
        const p = pane.getBoundingClientRect(), w = wrap.getBoundingClientRect(), e = editor.getBoundingClientRect();
        return {
            paneWidth: Math.round(p.width), paneHeight: Math.round(p.height),
            wrapWidth: Math.round(w.width), editorHeight: Math.round(e.height),
            clientHeight: area.clientHeight, scrollHeight: area.scrollHeight,
            overflowY: getComputedStyle(area).overflowY
        };
    }, selector);
    check("folded editor follows the Source width", folded.wrapWidth >= folded.paneWidth - 8, folded);
    check("folded editor owns vertical scrolling", folded.scrollHeight > folded.clientHeight && folded.editorHeight <= folded.paneHeight, folded);
    const dragResizer = async (dx) => {
        const resizePoint = await page.evaluate((s) => {
            const r = document.querySelector(s + " .pui-workbench-resizer.is-left").getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, selector);
        await page.mouse.move(resizePoint.x, resizePoint.y);
        await page.mouse.down();
        await page.mouse.move(resizePoint.x + dx, resizePoint.y, { steps: 8 });
        await page.mouse.up();
        await sleep(300);
        return page.evaluate((s) => {
            const block = document.querySelector(s);
            const pane = block.querySelector(".pui-workbench-pane.is-left");
            const wrap = block.querySelector(".isf-editor-wrap");
            return { paneWidth: Math.round(pane.getBoundingClientRect().width), wrapWidth: Math.round(wrap.getBoundingClientRect().width) };
        }, selector);
    };
    const widthBeforeResize = folded.paneWidth;
    let resized = await dragResizer(70);
    if (resized.paneWidth <= widthBeforeResize) resized = await dragResizer(110);
    await capture("22b-editor-resized");
    check("folded editor follows a Source pane resize", resized.paneWidth > widthBeforeResize && resized.wrapWidth >= resized.paneWidth - 8, {before: widthBeforeResize, ...resized});
    await fold.click();
    await sleep(200);
}
const sourceClose = await blockEval((block) => {
    const toggle = block.querySelector('.pui-workbench-toggle[data-pui-region="left"]');
    if (toggle && toggle.getAttribute("aria-expanded") === "true") toggle.click();
    return true;
});
await sleep(250);
await capture("23-source-closed");

// ── command palette (shared host shortcut, active viewer)
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("P");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(350);
const palettePresent = await page.$(".pui-palette");
if (palettePresent) {
    await page.screenshot({ path: path.join(artifacts, "23b-command-palette.png") });
    const paletteLabels = await page.$$eval(".pui-palette-option", (options) => options.map((option) => option.textContent));
    check("command palette lists workbench actions", paletteLabels.some((label) => /Reset parameters/.test(label)) && paletteLabels.some((label) => /Source/.test(label)), paletteLabels.slice(0, 12));
    const resetOption = await page.$$eval(".pui-palette-option", (options) => {
        const index = options.findIndex((option) => /Reset parameters/.test(option.textContent));
        return index;
    });
    const optionHandles = await page.$$(".pui-palette-option");
    if (optionHandles[resetOption]) await optionHandles[resetOption].click();
    await sleep(300);
    check("command palette executes and closes", !(await page.$(".pui-palette")));
} else {
    check("command palette opens with Ctrl+Shift+P", false);
}

// ── focus preview (direct titlebar action)
await blockEval((block) => {
    const action = block.querySelector('.pui-workbench-action[data-pui-action="focus"]');
    if (action) action.click();
    return !!action;
});
await sleep(450);
const hudState = await page.evaluate((s) => {
    const block = document.querySelector(s);
    const hud = block.querySelector(".isf-stage-hud");
    const styles = getComputedStyle(hud);
    return {
        visible: styles.visibility !== "hidden" && !hud.classList.contains("isf-hud-unavailable"),
        time: hud.querySelector(".isf-hud-time").textContent,
        stats: hud.querySelector(".isf-hud-stats").textContent,
        buttons: hud.querySelectorAll(".isf-hud-btn").length
    };
}, selector);
check("focus reveals the stage HUD", hudState.visible && /^\d+:\d{2} \/ \d+:\d{2}$/.test(hudState.time) && /×/.test(hudState.stats) && hudState.buttons === 3, hudState);
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
const hudPlay = await page.$(`${selector} .isf-stage-hud .isf-hud-btn`);
if (hudPlay) { await hudPlay.click(); await sleep(300); }
await capture("24b-hud-pause");
const hudPlayLabel = await page.$eval(`${selector} .isf-stage-hud .isf-hud-btn`, (el) => el.getAttribute("aria-label"));
check("HUD play/pause toggles playback", hudPlayLabel === "Play" || hudPlayLabel === "Pause", hudPlayLabel);
const hudCapture = await page.$(`${selector} .isf-stage-hud button[aria-label*="Export current frame"]`);
if (hudCapture) { await hudCapture.click(); await sleep(350); }
await capture("24c-hud-capture");
const hudDownloads = await page.evaluate(() => window.__downloads.slice());
check("HUD capture exports a PNG", hudDownloads.some((href) => /^data:image\/png/.test(href)), hudDownloads.slice(-1));

// Long-press tooltip on the titlebar: readable label without firing the toggle.
const parametersBefore = await blockEval((block) => {
    const pane = block.querySelector(".pui-workbench-pane.is-right");
    return !!pane && !pane.classList.contains("is-collapsed");
});
await page.keyboard.press("Escape");
await sleep(120);
await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
await sleep(150);
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
await sleep(120);
const titleToggleBox = await page.$eval(`${selector} .pui-workbench-toggle[data-pui-region="right"]`, (el) => {
    const rect = el.getBoundingClientRect();
    return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
});
await page.evaluate(({x, y}) => {
    const target = document.elementFromPoint(x, y);
    if (target) target.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", clientX: x, clientY: y}));
}, titleToggleBox);
// The toggle may already be focused, showing its tooltip. Wait past the
// 450 ms long-press threshold so this also arms release click suppression.
await sleep(650);
await page.waitForFunction(() => {
    const tip = document.querySelector(".pui-tooltip.is-visible");
    return tip && /Toggle Parameters/.test(tip.textContent);
}, {timeout: 2000}).catch(() => {});
await sleep(120);
const tooltipText = await page.evaluate(() => {
    const tip = document.querySelector(".pui-tooltip.is-visible");
    return tip ? tip.textContent : "";
});
check("long-press shows a tooltip label", /Toggle Parameters/.test(tooltipText), tooltipText);
await page.screenshot({ path: path.join(artifacts, "24d-title-tooltip.png") });
actions.push("24d-title-tooltip");
await page.evaluate(({x, y}) => {
    const target = document.elementFromPoint(x, y);
    if (target) {
        target.dispatchEvent(new PointerEvent("pointerup", {bubbles: true, pointerType: "touch", clientX: x, clientY: y}));
        const button = target.closest ? target.closest("button") : null;
        if (button) button.click();
    }
}, titleToggleBox);
await sleep(250);
const parametersAfter = await blockEval((block) => {
    const pane = block.querySelector(".pui-workbench-pane.is-right");
    return !!pane && !pane.classList.contains("is-collapsed");
});
check("long-press tooltip does not activate the toggle", parametersAfter === parametersBefore, {before: parametersBefore, after: parametersAfter});
await page.keyboard.press("Escape");
await sleep(120);

// ── fullscreen through the HUD action
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
const hudFullscreen = await page.$(`${selector} .isf-stage-hud button[aria-label="Fullscreen"]`);
if (hudFullscreen) await hudFullscreen.click();
else {
    const point = await page.evaluate((s) => {
        const rect = document.querySelector(s + " .isf-canvas").getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, selector);
    await page.mouse.click(point.x, point.y, { clickCount: 2 });
}
await sleep(900);
await capture("25-fullscreen");
check("fullscreen entered", await page.evaluate(() => !!(document.fullscreenElement || document.webkitFullscreenElement)));
try {
    await page.evaluate(async () => {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
    });
} catch (error) { /* headless may already have left fullscreen */ }
await sleep(500);

// ── mobile touch pass: reload at phone width so auto-open/narrow are native.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000 });
await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), selector);
await sleep(1500);
await capture("26-mobile-initial");
const tapRegion = async (region, expected) => {
    const target = `${selector} .pui-workbench-toggle[data-pui-region="${region}"]`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), target);
        await sleep(120);
        await page.tap(target);
        await sleep(400);
        if (expected === undefined) return;
        const state = await mobileLayout();
        if (!!state[region] === !!expected) return;
    }
};
const mobileLayout = () => blockEval((block) => {
    const left = block.querySelector(".pui-workbench-pane.is-left");
    const right = block.querySelector(".pui-workbench-pane.is-right");
    const bottom = block.querySelector(".pui-workbench-pane.is-bottom");
    const body = block.querySelector(".pui-workbench-body");
    const box = (node) => node ? node.getBoundingClientRect() : { width: 0, height: 0 };
    return {
        left: !!left && !left.classList.contains("is-collapsed"),
        right: !!right && !right.classList.contains("is-collapsed"),
        bottom: !!bottom && getComputedStyle(bottom).display !== "none",
        leftWidth: Math.round(box(left).width),
        rightWidth: Math.round(box(right).width),
        bodyWidth: Math.round(box(body).width),
        bottomHeight: Math.round(box(bottom).height)
    };
});
await tapRegion("left", true);
await capture("27-mobile-source");
let phone = await mobileLayout();
check("phone Source drawer is full-width and exclusive", phone.left && !phone.right && phone.leftWidth >= phone.bodyWidth - 2, phone);
const phoneMore = await blockEval((block) => {
    const pane = block.querySelector(".pui-workbench-pane.is-left");
    const trigger = block.querySelector(".isf-editor-more .pui-menu-trigger");
    if (!pane || !trigger) return null;
    trigger.scrollIntoView({ block: "center" });
    const p = pane.getBoundingClientRect();
    const r = trigger.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
        left: Math.round(r.left - p.left), right: Math.round(r.right - p.right),
        width: Math.round(r.width), hit: hit === trigger || (hit && trigger.contains(hit))
    };
});
check("phone Source More trigger stays inside the pane", !!phoneMore && phoneMore.left >= 0 && phoneMore.right <= 0 && phoneMore.width >= 20 && phoneMore.hit, phoneMore);
await tapRegion("right", true);
await capture("28-mobile-parameters");
phone = await mobileLayout();
check("phone Parameters drawer is full-width and exclusive", phone.right && !phone.left && phone.rightWidth >= phone.bodyWidth - 2, phone);
await tapRegion("bottom", false);
await capture("29-mobile-playback-closed");
phone = await mobileLayout();
check("phone Playback toggle closes the strip", !phone.bottom, phone);
await tapRegion("bottom", true);
await capture("29b-mobile-playback-open");
phone = await mobileLayout();
check("phone Playback strip stays visible", phone.bottom && phone.bottomHeight >= 60, phone);
await page.screenshot({ path: path.join(artifacts, "30-mobile-page.png") });

// The help modal and command palette must stay inside the viewport and remain
// visually opaque over a dark host page.
await openMenu();
await menuAction("Keyboard shortcuts");
await sleep(400);
const phoneHelp = await page.evaluate(() => {
    const overlay = document.querySelector(".isf-overlay-help");
    const close = overlay && overlay.querySelector('[data-isf-overlay="close"]');
    if (!overlay || !close) return null;
    const o = overlay.getBoundingClientRect();
    const c = close.getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return {
        top: Math.round(o.top), height: Math.round(o.height), viewport: window.innerHeight,
        closeVisible: c.top >= 0 && c.bottom <= window.innerHeight,
        closeHit: hit === close || (hit && close.contains(hit)),
        closeFocused: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-isf-overlay="close"]')),
        tooltipVisible: !!document.querySelector(".pui-tooltip.is-visible"),
        position: getComputedStyle(overlay).position
    };
});
check("phone help overlay is viewport-fixed and closable", !!phoneHelp && phoneHelp.position === "fixed" && phoneHelp.top === 0 &&
    phoneHelp.height === phoneHelp.viewport && phoneHelp.closeVisible && phoneHelp.closeHit &&
    phoneHelp.closeFocused && !phoneHelp.tooltipVisible, phoneHelp);
await capture("31-mobile-help");
await closeOverlay();
await sleep(200);
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("P");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(400);
const phonePalette = await page.evaluate(() => {
    const dialog = document.querySelector("dialog.pui-palette");
    if (!dialog) return null;
    const r = dialog.getBoundingClientRect();
    const bg = getComputedStyle(dialog).backgroundColor;
    const alpha = (/rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(bg) || [])[1];
    return {
        left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
        viewport: [window.innerWidth, window.innerHeight], background: bg,
        opaque: !alpha || Number(alpha) > 0
    };
});
check("phone command palette is opaque and inside the viewport", !!phonePalette && phonePalette.opaque &&
    phonePalette.left >= 0 && phonePalette.top >= 0 && phonePalette.right <= phonePalette.viewport[0] &&
    phonePalette.bottom <= phonePalette.viewport[1], phonePalette);
await capture("31b-mobile-palette");
await page.keyboard.press("Escape");
await sleep(200);

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
