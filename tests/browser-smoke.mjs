#!/usr/bin/env node
/*
 * docsify-isf browser smoke test.
 *
 * Serves this directory over HTTP, opens the Docsify self-test page in
 * headless Chrome and checks that every self-test link became a viewer that
 * actually rendered:
 *
 *   - the page has no console errors / uncaught exceptions
 *   - every positive sample reaches a non-error state and gets a sized canvas
 *   - the two negative samples show an error surface on purpose
 *   - the parameter panel and the editor open and react
 *
 * Requires Chrome/Chromium and `npm install` (puppeteer-core). Skips with a
 * message when either is missing.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

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

function chromeCandidates() {
    const fromEnv = process.env.CHROME_PATH;
    const candidates = [];
    if (fromEnv) candidates.push(fromEnv);
    candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    );
    return candidates;
}

function findChrome() {
    for (const candidate of chromeCandidates()) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
}

let puppeteer;
try {
    puppeteer = (await import("puppeteer-core")).default;
} catch (error) {
    console.log("browser-smoke: puppeteer-core is not installed — run `npm install` first. Skipping.");
    process.exit(0);
}

const executablePath = findChrome();
if (!executablePath) {
    const missing = "browser-smoke: no Chrome/Chromium found (set CHROME_PATH).";
    if (process.env.REQUIRE_BROWSER === "1") {
        console.error(missing);
        process.exit(1);
    }
    console.log(missing + " Skipping.");
    process.exit(0);
}

const server = http.createServer((request, response) => {
    let urlPath = decodeURIComponent((request.url || "/").split("?")[0].split("#")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(root, urlPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
        return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/`;
console.log("browser-smoke: serving " + root + " at " + url);

const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader"
    ]
});

const problems = [];
const consoleErrors = [];
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
        window.__copied = null;
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {
                writeText: (text) => { window.__copied = String(text); return Promise.resolve(); }
            }
        });

        const workbench = (block) => block && block.querySelector(".isf-workbench");
        const pane = (block, region) => block && block.querySelector(".pui-workbench-pane.is-" + region);
        const paneOpen = (block, region) => {
            const p = pane(block, region);
            return !!p && !p.classList.contains("is-collapsed");
        };
        const togglePane = (block, region, open) => {
            const p = pane(block, region);
            if (!p) return false;
            const want = open === undefined ? !paneOpen(block, region) : !!open;
            if (want === paneOpen(block, region)) return true;
            const toggle = block.querySelector('.pui-workbench-toggle[aria-controls="' + p.id + '"]');
            if (!toggle) return false;
            toggle.click();
            return true;
        };
        const selectTab = (block, region, label) => {
            const p = pane(block, region);
            if (!p) return false;
            const tab = Array.from(p.querySelectorAll(".pui-pane-tab")).find((node) => node.textContent === label);
            if (!tab) return false;
            if (!paneOpen(block, region)) togglePane(block, region, true);
            tab.click();
            return true;
        };
        const selectedTab = (block, region) => {
            const p = pane(block, region);
            const tab = p && p.querySelector('.pui-pane-tab[aria-selected="true"]');
            return tab ? tab.textContent : "";
        };
        const menuTrigger = (block) => block && (block.querySelector('.pui-workbench-toolbar .pui-header-menu-trigger') ||
            block.querySelector('.pui-workbench-toolbar [aria-haspopup]'));
        const menuAction = (block, label) => {
            const trigger = menuTrigger(block);
            if (!trigger) return false;
            if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
            const root = trigger.closest(".pui-header-menu");
            const popup = root && root.querySelector(".pui-header-menu-popup");
            if (!popup) return false;
            const items = Array.from(popup.querySelectorAll(".pui-actions button, .pui-actions a"))
                .filter((node) => node.getClientRects().length);
            const item = items.find((node) => label.test(node.textContent));
            if (!item) return false;
            item.click();
            return true;
        };

        window.isfWorkbench = workbench;
        window.isfPane = pane;
        window.isfPaneOpen = paneOpen;
        window.isfTogglePane = togglePane;
        window.isfSelectTab = selectTab;
        window.isfSelectedTab = selectedTab;
        window.isfOpenInspector = (block, tab) => {
            if (!block) return false;
            if (tab === "editor" || tab === "source") return window.isfOpenEditor(block);
            return selectTab(block, "right", "Parameters");
        };
        window.isfOpenEditor = (block) => {
            if (!block) return false;
            togglePane(block, "left", true);
            const pane = block.querySelector(".pui-workbench-pane.is-left");
            return !!(pane && !pane.classList.contains("is-collapsed"));
        };
        window.isfOpenMaterial = (block) => selectTab(block, "right", "Parameters");
        window.isfOpenInspectorPane = (block, tab) => selectTab(block, "right", tab || "View");
        window.isfMenuAction = menuAction;
        window.isfMenuTrigger = menuTrigger;
    });
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (/Failed to load resource/i.test(message.text())) return;
        consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));
    page.on("requestfailed", (request) => {
        if (!/favicon/.test(request.url())) consoleErrors.push("requestfailed: " + request.url() + " " + (request.failure() && request.failure().errorText));
    });
    page.on("response", (response) => {
        if (response.status() !== 404) return;
        const responseUrl = response.url();
        if (/\.vs(\?|$)/.test(responseUrl) || /favicon/.test(responseUrl)) return;
        consoleErrors.push("404: " + responseUrl);
    });

    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".isf-block").length >= 12, { timeout: 30000, polling: 100 });
    await page.waitForFunction(() => document.querySelectorAll(".isf-workbench").length >= 12, { timeout: 30000, polling: 100 });
    await page.evaluate(async () => {
        const blocks = Array.from(document.querySelectorAll(".isf-block"));
        for (const block of blocks) {
            block.scrollIntoView({ block: "center" });
            await new Promise((resolve) => setTimeout(resolve, 80));
        }
        window.scrollTo(0, 0);
    });
    await new Promise((resolve) => setTimeout(resolve, 1800));

    const summary = await page.evaluate(() => Array.from(document.querySelectorAll(".isf-block")).map((block) => {
        const canvas = block.querySelector(".isf-canvas");
        const controller = canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"));
        const stage = block.querySelector(".isf-stage");
        const workbench = block.querySelector(".isf-workbench");
        const left = block.querySelector(".pui-workbench-pane.is-left");
        const right = block.querySelector(".pui-workbench-pane.is-right");
        const bottom = block.querySelector(".pui-workbench-pane.is-bottom");
        const statusbar = block.querySelector(".pui-statusbar");
        const overlay = block.querySelector(".isf-overlay");
        const leftOpen = !!left && !left.classList.contains("is-collapsed");
        return {
            title: block.dataset.isfTitle || "",
            canvasWidth: canvas ? canvas.width : 0,
            canvasHeight: canvas ? canvas.height : 0,
            cssWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
            hasContext: !!controller,
            workbench: !!workbench,
            stage: !!stage,
            stageInWorkbench: !!(stage && workbench && workbench.contains(stage)),
            toolbar: !!block.querySelector(".pui-workbench-toolbar"),
            left: !!left,
            right: !!right,
            bottom: !!bottom,
            leftOpen: leftOpen,
            rightOpen: !!right && !right.classList.contains("is-collapsed"),
            leftTab: "",
            rightTab: right && right.querySelector('.pui-pane-tab[aria-selected="true"]') ? right.querySelector('.pui-pane-tab[aria-selected="true"]').textContent : "",
            params: block.querySelectorAll("[data-isf-param]").length,
            view: !!block.querySelector(".isf-view"),
            editor: !!block.querySelector(".isf-editor"),
            transport: !!block.querySelector(".pui-transport"),
            statusbar: !!statusbar,
            status: statusbar ? statusbar.textContent.trim() : "",
            overlayVisible: !!overlay && getComputedStyle(overlay).display !== "none",
            overlayText: overlay ? overlay.textContent.trim() : "",
            released: !!((statusbar && /context released/i.test(statusbar.textContent)) || (overlay && /context released/i.test(overlay.textContent))),
            empty: !block.querySelector(".pui-workbench-toolbar")
        };
    }));

    console.log("\nviewers:");
    for (const item of summary) {
        console.log(
            "  " +
            item.title.padEnd(26) +
            " canvas=" + item.canvasWidth + "x" + item.canvasHeight +
            " ctx=" + item.hasContext +
            " workbench=" + item.workbench +
            " params=" + item.params +
            " editor=" + item.editor +
            " source=" + (item.leftOpen ? "open" : "closed") +
            " params=" + (item.rightOpen ? item.rightTab : "closed") +
            " status=" + JSON.stringify(item.status.slice(0, 90))
        );
    }

    if (summary.length < 10) problems.push("expected at least 10 viewers, found " + summary.length);
    for (const item of summary) {
        const negative = /Broken/i.test(item.title);
        if (negative) continue;
        if (/Error|error/.test(item.status) || (item.overlayVisible && !/released/i.test(item.overlayText))) {
            problems.push(item.title + ": status/overlay reports an error: " + item.status + " " + item.overlayText);
            continue;
        }
        if (item.released) continue;
        if (item.empty) continue; // covered by the context-budget recovery below
        if (!item.workbench) problems.push(item.title + ": no PUI workbench");
        if (!item.stageInWorkbench) problems.push(item.title + ": stage is not the workbench preview");
        if (!item.toolbar) problems.push(item.title + ": no workbench toolbar");
        if (!item.left || !item.right || !item.bottom) problems.push(item.title + ": workbench panes missing");
        if (!item.transport) problems.push(item.title + ": no playback transport");
        if (!item.statusbar) problems.push(item.title + ": no statusbar");
        if (!item.canvasWidth || !item.canvasHeight) problems.push(item.title + ": canvas has no size");
        if (!item.hasContext) problems.push(item.title + ": no WebGL context");
        if (!item.params && !item.view) problems.push(item.title + ": no parameter or view controls");
        if (!item.editor) problems.push(item.title + ": no editor");
    }

    // Auto-open is contextual and never stacks Material panes.
    const autoOpen = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(".isf-block"));
        const open = blocks.filter((block) => {
            const pane = block.querySelector(".pui-workbench-pane.is-right");
            return pane && !pane.classList.contains("is-collapsed");
        });
        return {
            count: open.length,
            active: !!window.__isfActiveInspector,
            tabs: open.map((block) => {
                const tab = block.querySelector('.pui-workbench-pane.is-right .pui-pane-tab[aria-selected="true"]');
                return tab ? tab.textContent : "";
            })
        };
    });
    if (autoOpen.count > 1) problems.push("more than one Parameters pane auto-opened: " + JSON.stringify(autoOpen));
    if (autoOpen.active && autoOpen.count < 1) problems.push("the active inspector has no open Parameters pane: " + JSON.stringify(autoOpen));
    if (autoOpen.tabs.some((tab) => tab !== "Parameters")) problems.push("auto-open selected the wrong Parameters tab: " + JSON.stringify(autoOpen));

    const statusPUI = await page.evaluate(() => {
        const block = document.querySelector(".isf-block");
        const status = block && block.querySelector(".pui-statusbar");
        if (!status) return null;
        return {
            role: status.getAttribute("role") || status.closest("[role]") && status.closest("[role]").getAttribute("role"),
            text: status.textContent.trim()
        };
    });
    if (!statusPUI || (statusPUI.role !== "status" && !statusPUI.text)) {
        problems.push("the playback statusbar is missing its role/text: " + JSON.stringify(statusPUI));
    }

    const recovery = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Kaleidoscope filter/i.test(b.dataset.isfTitle || ""));
        if (!block) return { missing: true };
        block.scrollIntoView({ block: "center" });
        await wait(2200);
        const canvas = block.querySelector(".isf-canvas");
        return {
            toolbar: !!block.querySelector(".pui-workbench-toolbar"),
            workbench: !!block.querySelector(".isf-workbench .pui-workbench"),
            stage: !!block.querySelector(".isf-workbench .isf-stage"),
            params: block.querySelectorAll("[data-isf-param]").length,
            canvas: canvas ? [canvas.width, canvas.height] : null,
            status: block.querySelector(".pui-statusbar") ? block.querySelector(".pui-statusbar").textContent : ""
        };
    });
    if (recovery.missing || !recovery.toolbar || !recovery.stage || !recovery.canvas || !recovery.canvas[0]) {
        problems.push("the context-budget-released viewer did not recover its workbench: " + JSON.stringify(recovery));
    }

    const negative = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Broken header/i.test(b.dataset.isfTitle || ""));
        if (!block) return { missing: true };
        block.scrollIntoView({ block: "center" });
        await wait(1600);
        const overlay = block.querySelector(".isf-overlay");
        const status = block.querySelector(".isf-status");
        return {
            overlay: overlay ? getComputedStyle(overlay).display !== "none" && overlay.textContent : "",
            status: status ? status.textContent : "",
            text: block.textContent
        };
    });
    if (negative.missing || !/Shader could not be loaded|Invalid|Unexpected token|Error/i.test(negative.overlay + " " + negative.status + " " + negative.text)) {
        problems.push("broken-header viewer has no visible error: " + JSON.stringify(negative));
    }

    await page.screenshot({ path: path.join(here, "artifacts", "browser-smoke.png"), fullPage: false });
    const blocks = await page.$$(".isf-block");
    for (let index = 0; index < blocks.length; index++) {
        const item = summary[index];
        if (!item) continue;
        const slug = String(item.title || "viewer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "viewer";
        try {
            await blocks[index].screenshot({ path: path.join(here, "artifacts", slug + ".png") });
        } catch (error) {
            problems.push("screenshot failed for " + item.title + ": " + error.message);
        }
    }

    // ── true workbench shell ─────────────────────────────────────────────
    const shell = await page.evaluate(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        if (block) { window.isfOpenMaterial(block); }
        const workbench = block && block.querySelector(".isf-workbench");
        const wb = block && block.querySelector(".pui-workbench");
        const toolbar = block && block.querySelector(".pui-workbench-toolbar");
        const stagePane = block && block.querySelector(".pui-workbench-pane.is-stage");
        const stage = block && block.querySelector(".isf-stage");
        const left = block && block.querySelector(".pui-workbench-pane.is-left");
        const right = block && block.querySelector(".pui-workbench-pane.is-right");
        const bottom = block && block.querySelector(".pui-workbench-pane.is-bottom");
        const r = (node) => node ? node.getBoundingClientRect() : null;
        return {
            found: !!block,
            oldHeader: !!block && !!block.querySelector(".isf-header"),
            toolbarHeight: toolbar ? Math.round(r(toolbar).height) : 0,
            workbenchHeight: workbench ? Math.round(r(workbench).height) : 0,
            stageInPreview: !!(stage && stagePane && stagePane.contains(stage)),
            stageFit: wb ? wb.getAttribute("data-stage-fit") : "",
            leftOpen: !!left && !left.classList.contains("is-collapsed"),
            leftTab: left && left.querySelector('.pui-pane-tab[aria-selected="true"]') ? left.querySelector('.pui-pane-tab[aria-selected="true"]').textContent : "",
            rightTabs: right ? Array.from(right.querySelectorAll(".pui-pane-tab")).map((tab) => tab.textContent) : [],
            leftTabs: left ? Array.from(left.querySelectorAll(".pui-pane-tab")).map((tab) => tab.textContent) : [],
            rightOpen: !!right && !right.classList.contains("is-collapsed"),
            rightTab: right && right.querySelector('.pui-pane-tab[aria-selected="true"]') ? right.querySelector('.pui-pane-tab[aria-selected="true"]').textContent : "",
            sourceToggle: !!block && Array.from(block.querySelectorAll(".pui-workbench-toggle")).some((button) => button.textContent === "Source"),
            paramsToggle: !!block && Array.from(block.querySelectorAll(".pui-workbench-toggle")).some((button) => button.textContent === "Parameters"),
            title: block && block.querySelector(".pui-workbench-title") ? block.querySelector(".pui-workbench-title").textContent : "",
            description: block && block.querySelector(".pui-workbench-description") ? block.querySelector(".pui-workbench-description").textContent : "",
            titlebarToggle: block && !!block.querySelector(".pui-workbench-titlebar-toggle"),
            bottomOpen: !!bottom && !bottom.classList.contains("is-collapsed"),
            stageWidth: stage ? Math.round(r(stage).width) : 0,
            blockWidth: block ? Math.round(r(block).width) : 0,
            toolbarLabels: toolbar ? Array.from(toolbar.querySelectorAll(".pui-workbench-toggle")).map((button) => button.textContent) : [],
            narrow: wb ? wb.classList.contains("is-narrow") : false,
            stageHeight: stage ? Math.round(r(stage).height) : 0,
            blockHeight: block ? Math.round(r(block).height) : 0
        };
    });
    if (!shell.found) problems.push("plasma viewer not found");
    if (shell.oldHeader) problems.push("the old overlay header is still rendered");
    if (shell.toolbarHeight > 120) problems.push("the workbench title bar is too tall: " + JSON.stringify(shell));
    if (!shell.stageInPreview || shell.stageFit !== "contain") problems.push("the stage is not the PUI preview with fit=contain: " + JSON.stringify(shell));
    if (shell.leftTabs.length !== 0) problems.push("Source pane should not have local tabs: " + JSON.stringify(shell.leftTabs));
    if (shell.rightTabs.join(",") !== "Parameters,View,Log") problems.push("Parameters tabs are wrong: " + JSON.stringify(shell.rightTabs));
    if (!shell.sourceToggle || !shell.paramsToggle) problems.push("Source/Parameters show-hide buttons are missing: " + JSON.stringify(shell));
    if (!shell.rightOpen || shell.rightTab !== "Parameters") problems.push("Parameters is not the initial right-pane tab: " + JSON.stringify(shell));
    if (!shell.title || !/Plasma/i.test(shell.title)) problems.push("the workbench title is missing: " + JSON.stringify(shell));
    if (!shell.description || shell.description.length < 20) problems.push("the workbench description is missing: " + JSON.stringify(shell));
    if (!shell.titlebarToggle) problems.push("the title bar has no collapse control");
    if (!shell.bottomOpen) problems.push("Playback is collapsed by default");
    if (shell.stageWidth < shell.blockWidth * 0.2) problems.push("the stage is unusably narrow: " + JSON.stringify(shell));
    if (shell.stageHeight < shell.blockHeight * 0.35) problems.push("the stage is too short: " + JSON.stringify(shell));
    const sourceButton = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const source = Array.from(block.querySelectorAll(".pui-workbench-toggle")).find((button) => button.textContent === "Source");
        if (!source) return { missing: true };
        source.click();
        await wait(250);
        const editor = block.querySelector(".isf-editor");
        const visible = window.isfPaneOpen(block, "left");
        const editorBox = editor ? editor.getBoundingClientRect() : null;
        return { missing: false, visible: visible, editor: !!editor, editorHeight: editorBox ? Math.round(editorBox.height) : 0, stage: block.querySelector(".isf-stage").getBoundingClientRect().width };
    });
    if (sourceButton.missing || !sourceButton.visible || !sourceButton.editor || sourceButton.editorHeight < 120) {
        problems.push("the Source show/hide button did not open the editor: " + JSON.stringify(sourceButton));
    }

    // Collapsing the title bar must leave the function buttons in place.
    const titlebar = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const toolbar = block.querySelector(".pui-workbench-toolbar");
        const heading = block.querySelector(".pui-workbench-heading");
        const toggle = block.querySelector(".pui-workbench-titlebar-toggle");
        const before = toolbar.getBoundingClientRect().height;
        const toolsBefore = toolbar.querySelectorAll(".pui-workbench-toggle").length;
        toggle.click();
        await wait(180);
        const collapsed = toolbar.classList.contains("is-titlebar-collapsed");
        const after = toolbar.getBoundingClientRect().height;
        const toolsAfter = toolbar.querySelectorAll(".pui-workbench-toggle").length;
        const headingDisplay = getComputedStyle(heading).display;
        toggle.click();
        await wait(180);
        return { collapsed: collapsed, before: before, after: after, toolsBefore: toolsBefore, toolsAfter: toolsAfter, headingDisplay: headingDisplay, expanded: toggle.getAttribute("aria-expanded"), label: toggle.getAttribute("aria-label") };
    });
    if (!titlebar.collapsed || titlebar.after >= titlebar.before) problems.push("collapsing the title bar did not reclaim space: " + JSON.stringify(titlebar));
    if (titlebar.headingDisplay !== "none" || titlebar.toolsAfter < 3) problems.push("collapsing removed content or function buttons: " + JSON.stringify(titlebar));
    if (titlebar.expanded !== "true" || !/Collapse/.test(titlebar.label || "")) problems.push("title bar collapse state is not announced: " + JSON.stringify(titlebar));

    // ── parameters: a real slider drag reaches the host ─────────────────
    await page.evaluate(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        block.scrollIntoView({ block: "center" });
        window.isfOpenMaterial(block);
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const slider = await page.$('.isf-block [data-isf-param="speed"] input[type="range"]');
    let sliderResult = null;
    if (slider) {
        const box = await slider.boundingBox();
        if (box) {
            await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
            await page.mouse.down();
            await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 10 });
            await page.mouse.up();
            await new Promise((resolve) => setTimeout(resolve, 250));
            sliderResult = await page.evaluate(() => {
                const input = document.querySelector('.isf-block [data-isf-param="speed"] input[type="range"]');
                const number = document.querySelector('.isf-block [data-isf-param="speed"] input[type="number"]');
                return { range: input ? Number(input.value) : null, number: number ? Number(number.value) : null };
            });
        }
    }
    if (!sliderResult || !(sliderResult.range > 0.4)) problems.push("dragging the speed slider did not reach the PUI/host: " + JSON.stringify(sliderResult));

    // Randomize through the Inspector View tab.
    const viewResult = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        window.isfOpenInspectorPane(block, "View");
        await wait(200);
        const before = Number(block.querySelector('[data-isf-param="speed"] input[type="range"]').value);
        const random = Array.from(block.querySelectorAll(".isf-view button")).find((button) => /Randomize/i.test(button.textContent));
        if (!random) return { missing: true };
        random.click();
        await wait(300);
        const after = Number(block.querySelector('[data-isf-param="speed"] input[type="range"]').value);
        return { before: before, after: after, view: !!block.querySelector(".isf-view"), pane: window.isfPaneOpen(block, "right"), tab: window.isfSelectedTab(block, "right") };
    });
    if (viewResult.missing || !viewResult.view) problems.push("the View tab has no host view controls: " + JSON.stringify(viewResult));
    if (!viewResult.pane || viewResult.tab !== "View") problems.push("the Inspector did not open on View: " + JSON.stringify(viewResult));
    if (!(viewResult.after !== viewResult.before)) problems.push("Randomize in the View tab did not change a parameter: " + JSON.stringify(viewResult));

    const logResult = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        window.isfSelectTab(block, "right", "Log");
        await wait(200);
        const pane = block.querySelector(".pui-workbench-pane.is-right");
        return { text: pane ? pane.textContent : "", selected: window.isfSelectedTab(block, "right") };
    });
    if (logResult.selected !== "Log" || !/Inputs/i.test(logResult.text) || !/Passes/i.test(logResult.text)) {
        problems.push("the Log tab is missing workbench diagnostics: " + JSON.stringify(logResult));
    }

    // ── source editor tab: highlighting, typing, fold and templates ─────
    await page.evaluate(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        window.isfOpenEditor(block);
    });
    await page.waitForFunction(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const editor = block && block.querySelector(".isf-editor");
        return editor && !block.querySelector(".isf-editor-wrap").classList.contains("isf-hidden") &&
            block.querySelectorAll(".isf-tok-isf, .isf-tok-kw, .isf-tok-type").length > 10;
    }, { timeout: 10000, polling: 100 }).catch(() => problems.push("the Source editor did not open/highlight"));

    const editorResult = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const textarea = block.querySelector(".isf-input");
        const before = textarea.value;
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
        textarea.value = textarea.value + "\n// workbench smoke\n";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
        await wait(900);
        const applied = /Applied/.test(block.querySelector(".isf-editor-status").textContent);
        const changed = textarea.value !== before;
        const fold = block.querySelector(".isf-fold-btn");
        const wrap = block.querySelector(".isf-editor-wrap");
        const heightBefore = block.querySelector(".isf-editor").getBoundingClientRect().height;
        if (fold) fold.click();
        await wait(250);
        const folded = wrap.classList.contains("isf-toolbar-folded");
        const heightFolded = block.querySelector(".isf-editor").getBoundingClientRect().height;
        if (fold) fold.click();
        await wait(200);
        const template = block.querySelector(".isf-template-menu .pui-menu-trigger");
        let templateInserted = false;
        if (template) {
            template.click();
            await wait(200);
            const item = Array.from(block.querySelectorAll('.isf-template-menu [role="menuitem"]')).find((node) => /float input/i.test(node.textContent));
            if (item) { item.click(); await wait(300); templateInserted = /Inserted a float input/.test(block.querySelector(".isf-editor-status").textContent); }
        }
        return { applied: applied, changed: changed, folded: folded, grew: heightFolded > heightBefore, templateInserted: templateInserted, sourceOpen: window.isfPaneOpen(block, "left") };
    });
    if (!editorResult.applied || !editorResult.changed) problems.push("editing/applying the source did not reach the host: " + JSON.stringify(editorResult));
    if (!editorResult.sourceOpen) problems.push("the Source pane was not open: " + JSON.stringify(editorResult));
    if (!editorResult.folded) problems.push("the editor toolbar did not fold");
    if (!editorResult.templateInserted) problems.push("the editor Templates PUI menu did not insert a fragment");

    // ── transport: play, pause and seek ─────────────────────────────────
    const transport = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const pane = block.querySelector(".pui-workbench-pane.is-bottom");
        if (pane.classList.contains("is-collapsed")) {
            const toggle = block.querySelector('.pui-workbench-toggle[aria-controls="' + pane.id + '"]');
            if (toggle) toggle.click();
        }
        const play = Array.from(block.querySelectorAll(".pui-transport button")).find((button) => /Pause|Play/i.test(button.getAttribute("aria-label") || button.textContent));
        const seek = block.querySelector(".pui-transport input[type=range]");
        const before = seek ? Number(seek.value) : null;
        if (seek) {
            seek.value = "12";
            seek.dispatchEvent(new Event("input", { bubbles: true }));
            seek.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await wait(250);
        if (play) play.click();
        await wait(450);
        const after = seek ? Number(seek.value) : null;
        if (play) play.click();
        await wait(200);
        return { hasPlay: !!play, hasSeek: !!seek, before: before, after: after, transport: !!block.querySelector(".pui-transport"), time: block.querySelector(".pui-transport") ? block.querySelector(".pui-transport").textContent : "" };
    });
    if (!transport.transport || !transport.hasSeek) problems.push("the playback transport/seek control is missing: " + JSON.stringify(transport));
    if (!(transport.after >= 11.5)) problems.push("transport seek did not move the clock: " + JSON.stringify(transport));

    // ── header menu actions: reset, help, share ─────────────────────────
    const menuResult = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const speed = block.querySelector('[data-isf-param="speed"] input[type="range"]');
        speed.value = "2.4";
        speed.dispatchEvent(new Event("input", { bubbles: true }));
        speed.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(250);
        const reset = window.isfMenuAction(block, /^Reset parameters$/i);
        await wait(300);
        const afterReset = Number(block.querySelector('[data-isf-param="speed"] input[type="range"]').value);
        const help = window.isfMenuAction(block, /Keyboard shortcuts/i);
        await wait(250);
        const overlay = block.querySelector(".isf-overlay");
        const helpShown = !!overlay && getComputedStyle(overlay).display !== "none" && /Keyboard shortcuts/.test(overlay.textContent);
        const close = overlay && Array.from(overlay.querySelectorAll("button")).find((button) => /Close/i.test(button.textContent));
        if (close) close.click();
        await wait(150);
        const share = window.isfMenuAction(block, /Copy OBS link/i);
        await wait(300);
        return { reset: reset, afterReset: afterReset, help: help, helpShown: helpShown, share: share, copied: window.__copied };
    });
    if (!menuResult.reset || Math.abs(menuResult.afterReset - 0.4) > 0.02) problems.push("the header menu Reset action did not reset speed: " + JSON.stringify(menuResult));
    if (!menuResult.help || !menuResult.helpShown) problems.push("the header menu Help action did not show shortcuts");
    if (!menuResult.share || !menuResult.copied || !/isf-shader=/.test(menuResult.copied) || !/isf-fullscreen=1/.test(menuResult.copied)) {
        problems.push("the header menu Share action did not copy an OBS link: " + JSON.stringify(menuResult));
    }

    // ── fullscreen: same workbench, stage fills the screen ──────────────
    const fullscreen = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        const canvas = block.querySelector(".isf-canvas");
        const rect = canvas.getBoundingClientRect();
        window.__fullscreenPoint = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        return { point: window.__fullscreenPoint, enabled: document.fullscreenEnabled };
    });
    if (!fullscreen.point) problems.push("fullscreen point missing");
    else {
        await page.mouse.click(fullscreen.point.x, fullscreen.point.y, { clickCount: 2 });
        await new Promise((resolve) => setTimeout(resolve, 900));
        const fs = await page.evaluate(() => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
            const active = document.fullscreenElement || document.webkitFullscreenElement;
            const stage = block.querySelector(".isf-stage");
            const toolbar = block.querySelector(".pui-workbench-toolbar");
            const hint = block.querySelector(".isf-fullscreen-hint");
            return {
                active: active === block,
                full: block.classList.contains("isf-fullscreen"),
                stageWidth: Math.round(stage.getBoundingClientRect().width),
                stageHeight: Math.round(stage.getBoundingClientRect().height),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                toolbar: !!toolbar && getComputedStyle(toolbar).display !== "none",
                hint: !!hint && !hint.classList.contains("isf-hidden")
            };
        });
        if (!fs.active || !fs.full) problems.push("double-clicking the canvas did not enter fullscreen: " + JSON.stringify(fs));
        if (fs.stageWidth < fs.viewportWidth * 0.85 || fs.stageHeight < fs.viewportHeight * 0.7) problems.push("fullscreen stage did not fill the workbench: " + JSON.stringify(fs));
        if (!fs.toolbar) problems.push("fullscreen lost the workbench toolbar");
        if (fs.hint) problems.push("the old fullscreen hint reappeared");
        await page.evaluate(async () => {
            const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
            if (exit) await exit.call(document);
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
    }

    // ── contextual: one open Material at a time across viewers ──────────
    const context = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const blocks = Array.from(document.querySelectorAll(".isf-block")).filter((b) => /Plasma|Generator|Filter/i.test(b.dataset.isfTitle || ""));
        if (blocks.length < 2) return { missing: true };
        const [a, b] = blocks;
        a.scrollIntoView({ block: "center" });
        window.isfOpenMaterial(a);
        await wait(200);
        b.scrollIntoView({ block: "center" });
        window.isfOpenMaterial(b);
        await wait(300);
        return {
            a: window.isfPaneOpen(a, "right"),
            b: window.isfPaneOpen(b, "right"),
            active: window.__isfActiveInspector === undefined ? null : !!window.__isfActiveInspector,
            aTab: window.isfSelectedTab(a, "right"),
            bTab: window.isfSelectedTab(b, "right")
        };
    });
    if (context.missing) problems.push("context viewers not found");
    else if (context.a || !context.b) problems.push("opening one viewer's Parameters did not close the previous one: " + JSON.stringify(context));

    // ── desktop and phone panes: one overlay at a time, code keeps space ─
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const phone = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.dataset.isfTitle || ""));
        block.scrollIntoView({ block: "center" });
        await wait(500);
        // Parameters (right) first.
        window.isfOpenMaterial(block);
        await wait(350);
        if (!window.isfPaneOpen(block, "right")) {
            window.isfTogglePane(block, "right", true);
            await wait(300);
        }
        const right = block.querySelector(".pui-workbench-pane.is-right");
        const left = block.querySelector(".pui-workbench-pane.is-left");
        const stage = block.querySelector(".isf-stage");
        const stageRect = stage.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const paramsOpen = window.isfPaneOpen(block, "right");
        const paramsWidth = Math.round(rightRect.width);
        const paramsTab = window.isfSelectedTab(block, "right");
        // Source (left) replaces the Parameters overlay on a phone.
        window.isfOpenEditor(block);
        await wait(400);
        const editor = block.querySelector(".isf-editor");
        const editorRect = editor ? editor.getBoundingClientRect() : null;
        const sourceOpen = window.isfPaneOpen(block, "left");
        const paramsAfterSource = window.isfPaneOpen(block, "right");
        const sourceTab = window.isfSelectedTab(block, "left");
        // Inspector View replaces Source in turn.
        window.isfOpenInspectorPane(block, "View");
        await wait(400);
        const rightOpen = window.isfPaneOpen(block, "right");
        const leftOpen = window.isfPaneOpen(block, "left");
        const viewTab = window.isfSelectedTab(block, "right");
        const buttons = Array.from(block.querySelectorAll(".pui-workbench-toggle, .pui-pane-tab"));
        const minButton = Math.min.apply(null, buttons.map((button) => {
            const box = button.getBoundingClientRect();
            return Math.min(box.width, box.height);
        }).filter((n) => n > 0));
        return {
            blockWidth: Math.round(block.getBoundingClientRect().width),
            viewport: window.innerWidth,
            docWidth: document.documentElement.scrollWidth,
            paramsOpen: paramsOpen,
            paramsWidth: paramsWidth,
            paramsTab: paramsTab,
            sourceOpen: sourceOpen,
            sourceTab: sourceTab,
            paramsAfterSource: paramsAfterSource,
            editor: !!editor,
            editorHeight: editorRect ? Math.round(editorRect.height) : 0,
            rightOpen: rightOpen,
            leftOpen: leftOpen,
            viewTab: viewTab,
            stageWidth: Math.round(stageRect.width),
            stageHeight: Math.round(stageRect.height),
            minButton: minButton
        };
    });
    if (phone.blockWidth > phone.viewport + 1) problems.push("mobile: viewer is wider than the viewport");
    if (phone.docWidth > phone.viewport + 1) problems.push("mobile: document scrolls horizontally");
    if (!phone.paramsOpen || phone.paramsTab !== "Parameters" || phone.paramsWidth < phone.stageWidth * 0.7) problems.push("mobile: Parameters is not a usable overlay: " + JSON.stringify(phone));
    if (!phone.sourceOpen || phone.paramsAfterSource || !phone.editor || phone.editorHeight < 120) problems.push("mobile: Source did not replace Parameters / editor lost space: " + JSON.stringify(phone));
    if (!phone.rightOpen || phone.leftOpen || phone.viewTab !== "View") problems.push("mobile: View did not replace Source in narrow mode: " + JSON.stringify(phone));
    if (phone.minButton < 30) problems.push("mobile: workbench touch target under 30px (" + phone.minButton + ")");
    await page.screenshot({ path: path.join(here, "artifacts", "mobile.png"), fullPage: false });
    await page.setViewport({ width: 1280, height: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 800));

    // ── OBS / bare workbench: stage only until revealed, then full controls ─
    const shaderUrl = url + "samples/plasma.fs";
    const obsURL = url + "?isf-shader=" + encodeURIComponent(shaderUrl) + "&isf-fullscreen=1";
    await page.goto(obsURL, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".isf-block.isf-bare").length === 1, { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const bare = await page.evaluate(() => {
        const block = document.querySelector(".isf-block");
        const workbench = block.querySelector(".isf-workbench");
        const toolbar = block.querySelector(".pui-workbench-toolbar");
        const stage = block.querySelector(".isf-stage");
        const left = block.querySelector(".pui-workbench-pane.is-left");
        const bottom = block.querySelector(".pui-workbench-pane.is-bottom");
        const canvas = block.querySelector(".isf-canvas");
        const r = (node) => node ? node.getBoundingClientRect() : null;
        return {
            bare: block.classList.contains("isf-bare"),
            revealed: block.classList.contains("isf-revealed"),
            toolbar: toolbar ? getComputedStyle(toolbar).display : "missing",
            left: left ? getComputedStyle(left).display : "missing",
            bottom: bottom ? getComputedStyle(bottom).display : "missing",
            stage: r(stage) ? [Math.round(r(stage).width), Math.round(r(stage).height)] : null,
            canvas: r(canvas) ? [Math.round(r(canvas).width), Math.round(r(canvas).height)] : null,
            viewport: [window.innerWidth, window.innerHeight],
            reveal: !!block.querySelector(".isf-reveal-btn")
        };
    });
    if (!bare.bare || !bare.reveal) problems.push("OBS bare viewer did not mount the bare workbench: " + JSON.stringify(bare));
    if (bare.toolbar !== "none" || bare.left !== "none" || bare.bottom !== "none") problems.push("OBS bare viewer exposes chrome before reveal: " + JSON.stringify(bare));
    if (!bare.stage || bare.stage[0] < bare.viewport[0] * 0.85 || bare.stage[1] < bare.viewport[1] * 0.8) problems.push("OBS bare stage does not fill the viewport: " + JSON.stringify(bare));
    const revealed = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = document.querySelector(".isf-block");
        block.querySelector(".isf-reveal-btn").click();
        await wait(250);
        const toolbar = block.querySelector(".pui-workbench-toolbar");
        const left = block.querySelector(".pui-workbench-pane.is-left");
        const modifier = toolbar ? getComputedStyle(toolbar).display : "missing";
        window.isfOpenMaterial(block);
        await wait(250);
        window.isfMenuAction(block, /^Reset parameters$/i);
        await wait(250);
        const speed = block.querySelector('[data-isf-param="speed"] input[type="range"]');
        return {
            revealed: block.classList.contains("isf-revealed"),
            toolbar: modifier,
            left: window.isfPaneOpen(block, "right"),
            params: !!speed,
            speed: speed ? Number(speed.value) : null
        };
    });
    if (!revealed.revealed || revealed.toolbar === "none" || !revealed.left || !revealed.params) {
        problems.push("revealing the OBS bare viewer did not expose the workbench controls: " + JSON.stringify(revealed));
    }
    if (revealed.speed === null || Math.abs(revealed.speed - 0.4) > 0.05) {
        problems.push("OBS bare viewer did not load the plasma defaults: " + JSON.stringify(revealed));
    }

    if (consoleErrors.length) {
        problems.push("console errors: " + consoleErrors.slice(0, 8).join(" | "));
    }
    await browser.close();

    console.log("\nbrowser-smoke: " + (problems.length ? problems.length + " problem(s)" : "ok"));
    for (const problem of problems) console.log("  ✗ " + problem);
    process.exit(problems.length ? 1 : 0);
} catch (error) {
    try { await browser.close(); } catch (closeError) { /* ignore */ }
    console.error("browser-smoke: " + (error && error.stack ? error.stack : error));
    process.exit(1);
}
