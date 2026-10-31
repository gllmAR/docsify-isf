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
        window.isfInspectorHost = (block) => block && block.querySelector(".isf-inspector-pui");
        window.isfInspectorPanel = (block) => {
            const host = window.isfInspectorHost(block);
            return host && host.querySelector(".pui-drawer-panel");
        };
        window.isfEditorHost = (block) => block && block.querySelector(".isf-editor-pui");
        window.isfEditorPanel = (block) => {
            const host = window.isfEditorHost(block);
            return host && host.querySelector(".pui-drawer-panel");
        };
        window.isfOpenEditor = (block) => {
            if (!block) return null;
            const panel = window.isfEditorPanel(block);
            if (!panel) return null;
            if (panel.hidden) {
                const controls = block.querySelector('.isf-header [data-pui-item="editor"]');
                if (controls) controls.click();
            }
            return panel;
        };
        window.isfOpenInspector = (block, tab) => {
            if (!block) return null;
            if (tab === "editor" || tab === "source") return window.isfOpenEditor(block);
            const panel = window.isfInspectorPanel(block);
            if (!panel) return null;
            if (panel.hidden) {
                const controls = block.querySelector('.isf-header [data-pui-item="controls"]');
                if (controls) controls.click();
            }
            return panel;
        };
        window.isfFooterAction = (block, id) => {
            if (!block) return null;
            window.isfOpenInspector(block, "params");
            const host = window.isfInspectorHost(block);
            const trigger = host && host.querySelector('.pui-drawer-body > .pui-toolbar .pui-menu-trigger');
            if (trigger && trigger.getAttribute("aria-expanded") !== "true") trigger.click();
            const action = host && (host.querySelector('[data-pui-item="' + id + '"]') ||
                block.querySelector('[data-pui-item="' + id + '"]'));
            if (action) action.click();
            return action;
        };
    });
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        // Expected probes (sibling .vs files, favicons) are reported by the
        // 404 response handler below only when they are not expected.
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

    // Scroll every lazy viewer into view so the intersection observer starts it.
    await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        // Docsify mounts viewers while the page settles. Scroll every current
        // block, then repeat until the count stops growing so viewers created
        // during an earlier pass are observed too (otherwise lazy viewers at
        // the tail stay unloaded and the terminal-state wait times out).
        let seen = -1;
        for (let pass = 0; pass < 4; pass++) {
            const blocks = Array.from(document.querySelectorAll(".isf-block"));
            for (const block of blocks) {
                block.scrollIntoView({ block: "center" });
                await wait(150);
            }
            if (blocks.length === seen) break;
            seen = blocks.length;
        }
        // One final sweep after the page has settled: late-mounted lazy viewers
        // under a slow CI GPU would otherwise never be observed.
        await wait(500);
        for (const block of Array.from(document.querySelectorAll(".isf-block"))) {
            block.scrollIntoView({ block: "center" });
            await wait(180);
        }
        window.scrollTo(0, 0);
        await wait(400);
    });

    // Wait until every viewer reached a terminal state: parameter controls
    // built, or an error overlay shown.
    try {
        await page.waitForFunction(() => {
            const blocks = Array.from(document.querySelectorAll(".isf-block"));
            if (blocks.length < 10) return false;
            return blocks.every((block) => {
                const status = block.querySelector(".isf-status");
                const overlay = block.querySelector(".isf-overlay");
                const loading = status && /Loading/i.test(status.textContent);
                const overlayVisible = overlay && overlay.style.display !== "none";
                if (loading || (overlayVisible && /Loading/.test(overlay.textContent))) return false;
                const hasParams = block.querySelectorAll("[data-isf-param]").length > 0;
                const hasView = !!block.querySelector(".isf-view");
                const erroring = overlayVisible && /error|could not|invalid|unexpected|redefinition|syntax/i.test(overlay.textContent);
                const statusError = status && /error/i.test(status.className);
                const released = overlayVisible && /released|Waiting for a GPU context/i.test(overlay.textContent);
                return hasParams || hasView || erroring || statusError || released;
            });
        }, { timeout: 45000, polling: 250 });
    } catch (error) {
        const stuck = await page.evaluate(() => Array.from(document.querySelectorAll(".isf-block")).map((block) => ({
            title: (block.querySelector('.isf-header [data-pui-item="title"]') || {}).textContent,
            status: (block.querySelector(".isf-status") || {}).textContent,
            params: block.querySelectorAll("[data-isf-param]").length,
            released: (() => {
                const overlay = block.querySelector(".isf-overlay");
                return !!overlay && overlay.style.display !== "none" &&
                    /released|Waiting for a GPU context/i.test(overlay.textContent);
            })()
        })).filter((item) => !item.params && !item.released && !/error/i.test(item.status || "")));
        problems.push("viewers never reached a terminal state: " + JSON.stringify(stuck));
    }

    // Auto-open is contextual: at most the visible viewer gets an inspector,
    // never every viewer on the page.
    const autoOpen = await page.evaluate(() => {
        const open = Array.from(document.querySelectorAll(".isf-block")).filter((block) => {
            const panel = window.isfInspectorPanel(block);
            return panel && !panel.hidden;
        });
        return { count: open.length, inStages: open.every((block) => block.querySelector(".isf-stage").contains(window.isfInspectorPanel(block))) };
    });
    if (autoOpen.count > 1) problems.push("more than one inspector auto-opened: " + JSON.stringify(autoOpen));
    if (!autoOpen.inStages) problems.push("an auto-opened inspector is not anchored in its viewer stage");

    // The global status line is a PUI statusbar once the toolkit loads.
    const statusPUI = await page.evaluate(() => {
        const bars = Array.from(document.querySelectorAll(".isf-status .pui-statusbar"));
        const bar = bars.find((b) => {
            const value = b.querySelector(".pui-statusbar-value");
            return value && value.textContent.trim();
        });
        if (!bar) return null;
        const value = bar.querySelector(".pui-statusbar-value");
        const item = bar.querySelector(".pui-statusbar-item");
        const style = value ? getComputedStyle(value) : null;
        const rect = bar.getBoundingClientRect();
        return {
            role: bar.getAttribute("role"),
            live: bar.getAttribute("aria-live"),
            value: value ? value.textContent : "",
            tone: item ? item.getAttribute("data-tone") : null,
            height: Math.round(rect.height),
            padTop: style ? style.paddingTop : "",
            marginTop: style ? style.marginTop : ""
        };
    });
    if (!statusPUI || statusPUI.role !== "status" || !statusPUI.value) {
        problems.push("the status line is not a PUI statusbar: " + JSON.stringify(statusPUI));
    } else {
        if (statusPUI.height > 60) problems.push("the PUI statusbar is too tall: " + JSON.stringify(statusPUI));
        if (statusPUI.padTop !== "0px" || statusPUI.marginTop !== "0px") {
            problems.push("PUI outputs inherit docsify's code-block styling: " + JSON.stringify(statusPUI));
        }
        if (["info", "success", "warning", "error"].indexOf(statusPUI.tone) < 0) {
            problems.push("the statusbar is not using a PUI tone: " + JSON.stringify(statusPUI));
        }
    }

    const summary = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".isf-block")).map((block) => {
            const status = block.querySelector(".isf-status");
            const canvas = block.querySelector("canvas");
            const overlay = block.querySelector(".isf-overlay");
            const title = block.querySelector('.isf-header [data-pui-item="title"]');
            const editors = block.querySelectorAll(".isf-editor");
            const badge = block.querySelector('.isf-header [data-pui-item="stats"] .pui-toolbar-readout-value');
            return {
                title: title ? title.textContent.trim() : "",
                status: status ? status.textContent.trim() : "",
                statusClass: status ? status.className : "",
                canvasWidth: canvas ? canvas.width : 0,
                canvasHeight: canvas ? canvas.height : 0,
                hasContext: !!(canvas && (canvas.getContext("webgl2") || canvas.getContext("webgl"))),
                overlayVisible: !!(overlay && overlay.style.display !== "none"),
                overlayText: overlay ? overlay.textContent.trim().slice(0, 120) : "",
                badge: badge ? badge.textContent.trim() : "",
                hasEditor: editors.length > 0,
                hasParams: !!block.querySelector("[data-isf-param]"),
                hasView: !!block.querySelector(".isf-view"),
                released: !!overlay && overlay.style.display !== "none" &&
                    /released|Waiting for a GPU context/i.test(overlay.textContent)
            };
        });
    });

    fs.mkdirSync(path.join(here, "artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(here, "artifacts", "browser-smoke.png"), fullPage: false });

    // Capture each self-test viewer on its own for visual review.
    const blocks = await page.$$(".isf-block");
    for (const block of blocks) {
        const title = await block.evaluate((element) => {
            const node = element.querySelector('.isf-header [data-pui-item="title"]');
            return node ? node.textContent.trim() : "viewer";
        });
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        try {
            await block.screenshot({ path: path.join(here, "artifacts", slug + ".png") });
        } catch (error) {
            problems.push("screenshot failed for " + title + ": " + error.message);
        }
    }

    console.log("\nviewers:");
    for (const item of summary) {
        console.log(
            "  " +
            item.title.padEnd(26) +
            " canvas=" + item.canvasWidth + "x" + item.canvasHeight +
            " ctx=" + item.hasContext +
            " params=" + item.hasParams +
            " editor=" + item.hasEditor +
            " badge=" + JSON.stringify(item.badge) +
            (item.overlayVisible ? " overlay=" + JSON.stringify(item.overlayText.slice(0, 40)) : "") +
            " status=" + JSON.stringify(item.status.slice(0, 90))
        );
    }

    if (summary.length < 10) problems.push("expected at least 10 viewers, found " + summary.length);
    for (const item of summary) {
        const negative = /Broken/i.test(item.title);
        if (negative) {
            if (!/Error|error|Shader error/.test(item.status + " " + item.overlayText)) {
                problems.push(item.title + ": negative sample did not report an error");
            }
            continue;
        }
        if (/Error|error/.test(item.status) || (item.overlayVisible && !/released/i.test(item.overlayText))) {
            problems.push(item.title + ": status/overlay reports an error: " + item.status + " " + item.overlayText);
            continue;
        }
        if (item.released) continue; // the context-budget recovery test covers this viewer
        if (!item.canvasWidth || !item.canvasHeight) problems.push(item.title + ": canvas has no size");
        if (!item.hasContext) problems.push(item.title + ": no WebGL context");
        if (!item.hasParams && !item.hasView) problems.push(item.title + ": no controls or view row");
        if (!item.hasEditor) problems.push(item.title + ": no editor");
    }

    // The top toolbar is a floating overlay: it costs no document flow and
    // fades when idle, then returns on activity.
    const chrome = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = document.querySelector(".isf-block");
        const header = block.querySelector(".isf-header");
        const stage = block.querySelector(".isf-stage");
        const status = block.querySelector(".isf-status");
        const headerRect = header.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        const statusRect = status.getBoundingClientRect();
        block.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
        await sleep(80);
        const shown = !header.classList.contains("isf-header-idle");
        await sleep(2750);
        const idle = header.classList.contains("isf-header-idle");
        const idleOpacity = parseFloat(getComputedStyle(header).opacity);
        block.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
        await sleep(100);
        const revealed = !header.classList.contains("isf-header-idle");
        return {
            position: getComputedStyle(header).position,
            headerHeight: Math.round(headerRect.height),
            stageOffset: Math.round(stageRect.top - blockRect.top),
            blockOverhead: Math.round(blockRect.height - stageRect.height - statusRect.height),
            shown: shown,
            idle: idle,
            idleOpacity: idleOpacity,
            revealed: revealed,
            scrolledOverStage: stageRect.top <= blockRect.top + 2
        };
    });
    if (chrome.position !== "absolute") problems.push("the top toolbar is not a floating overlay: " + JSON.stringify(chrome));
    if (chrome.headerHeight > 48) problems.push("the floating toolbar is too tall: " + JSON.stringify(chrome));
    if (!chrome.scrolledOverStage || chrome.blockOverhead > 6) problems.push("the top toolbar still consumes document flow: " + JSON.stringify(chrome));
    if (!chrome.shown || !chrome.idle || chrome.idleOpacity > 0.45 || !chrome.revealed) {
        problems.push("the floating toolbar did not auto-hide/reveal: " + JSON.stringify(chrome));
    }

    // Transition auto-animation: the progress control must move on its own.
    const crossfade = await page.evaluate(async () => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Crossfade/i.test(b.textContent));
        if (!block) return { missing: true };
        block.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 600));
        const row = Array.from(block.querySelectorAll("[data-isf-param]")).find((r) => /progress/i.test(r.dataset.isfParam || ""));
        const input = row && row.querySelector('input[type="number"]');
        if (!input) return { missing: true };
        const first = Number(input.value);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { first: first, second: Number(input.value) };
    });
    if (crossfade.missing) problems.push("crossfade progress control not found");
    else if (crossfade.first === crossfade.second) problems.push("transition progress did not animate: " + JSON.stringify(crossfade));

    // Exercise the editor: open it on the plasma viewer, check highlighting,
    // caret feedback, pane resizing and constraint clamping.
    const plasma = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(".isf-block"));
        const block = blocks.find((b) => /Plasma/i.test(b.textContent));
        if (!block) return null;
        window.isfOpenInspector(block, "editor");
        return true;
    });
    if (!plasma) problems.push("plasma viewer not found for editor test");
    else {
        await page.waitForFunction(() => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const editor = block && block.querySelector(".isf-editor");
            const panel = window.isfEditorPanel(block);
            return editor && panel && !panel.hidden && !block.querySelector(".isf-editor-wrap").classList.contains("isf-hidden") &&
                editor.querySelectorAll(".isf-tok-isf, .isf-tok-kw, .isf-tok-type").length > 10;
        }, { timeout: 10000, polling: 100 }).catch(() => problems.push("editor did not open / highlight"));

        const editorAudit = await page.evaluate(async () => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const editor = block.querySelector(".isf-editor");
            const pos = block.querySelector(".isf-editor-pos");
            const active = block.querySelector(".isf-active-line");
            const resizeY = block.querySelector(".isf-resize-y");
            const heightBefore = editor.getBoundingClientRect().height;
            resizeY.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            const heightAfter = editor.getBoundingClientRect().height;

            const scaleRow = Array.from(block.querySelectorAll("[data-isf-param]")).find((row) => row.dataset.isfParam === "scale");
            const numberInput = scaleRow && scaleRow.querySelector('input[type="number"]');
            numberInput.value = "999";
            numberInput.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));

            let layout = null;
            try { layout = JSON.parse(localStorage.getItem("docsify-isf:layout") || "null"); } catch (err) { layout = null; }

            return {
                pos: pos ? pos.textContent : "",
                activeLineVisible: !!active && !active.classList.contains("isf-hidden"),
                heightBefore: heightBefore,
                heightAfter: heightAfter,
                scaleValue: Number(numberInput.value),
                scaleMax: Number(numberInput.max),
                layout: layout
            };
        });

        if (!/^Ln \d+, Col \d+$/.test(editorAudit.pos)) problems.push("editor caret label missing: " + JSON.stringify(editorAudit.pos));
        if (!editorAudit.activeLineVisible) problems.push("editor active-line marker not visible");
        if (!(editorAudit.heightAfter > editorAudit.heightBefore)) problems.push("editor pane did not resize: " + JSON.stringify(editorAudit));
        if (editorAudit.scaleValue !== editorAudit.scaleMax) problems.push("out-of-range parameter was not clamped: " + JSON.stringify(editorAudit));
        if (!editorAudit.layout || editorAudit.layout.editorHeight == null) {
            problems.push("editor size was not persisted: " + JSON.stringify(editorAudit.layout));
        }

        const plasmaBlock = (await page.$$(".isf-block"))[0];
        if (plasmaBlock) {
            await plasmaBlock.screenshot({ path: path.join(here, "artifacts", "editor.png") });
        }

        // The close button must collapse the pane again.
        const closed = await page.evaluate(async () => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const host = window.isfEditorHost(block);
            const close = host && host.querySelector('.isf-editor-head .isf-panel-close');
            if (!close) return { missing: true };
            close.click();
            await new Promise((resolve) => setTimeout(resolve, 200));
            return { hidden: window.isfEditorPanel(block).hidden };
        });
        if (closed.missing) problems.push("editor close button missing");
        else if (!closed.hidden) problems.push("editor close button did not collapse the pane");
    }

    // Live-editing features: fragment/vertex tabs, comment toggle, font zoom.
    const editorFeatures = await page.evaluate(async () => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const byTitle = (root, title) => Array.from(root.querySelectorAll(".isf-btn")).find((b) => b.title === title);
        const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
        window.isfOpenInspector(block, "editor");
        await wait(300);
        const textarea = block.querySelector(".isf-input");
        Array.from(block.querySelectorAll(".isf-tab")).find((t) => /Vertex/i.test(t.textContent)).click();
        await wait(150);
        const vertexStarter = /isf_vertShaderInit/.test(textarea.value);
        byText(block, "Apply").click();
        await wait(700);
        const vertexApplied = /Applied/.test(block.querySelector(".isf-editor-status").textContent);
        Array.from(block.querySelectorAll(".isf-tab")).find((t) => /Fragment/i.test(t.textContent)).click();
        await wait(150);
        textarea.selectionStart = textarea.selectionEnd = 0;
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
        await wait(150);
        const commented = textarea.value.split("\n")[0].indexOf("//") === 0;
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true }));
        await wait(120);
        const sizeBefore = parseFloat(getComputedStyle(block.querySelector(".isf-editor")).fontSize);
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true }));
        await wait(150);
        const sizeAfter = parseFloat(getComputedStyle(block.querySelector(".isf-editor")).fontSize);
        textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true }));
        await wait(120);
        return { vertexStarter: vertexStarter, vertexApplied: vertexApplied, commented: commented, sizeBefore: sizeBefore, sizeAfter: sizeAfter };
    });
    if (!editorFeatures.vertexStarter) problems.push("vertex tab did not prefill the starter");
    if (!editorFeatures.vertexApplied) problems.push("custom vertex shader apply failed");
    if (!editorFeatures.commented) problems.push("Ctrl+/ did not toggle the comment");
    if (!(editorFeatures.sizeAfter > editorFeatures.sizeBefore)) problems.push("Ctrl+= did not zoom the editor: " + JSON.stringify(editorFeatures));

    // Shadertoy importer round trip (paste, convert, apply, revert).
    const importFlow = await page.evaluate(async () => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const byTitle = (root, title) => Array.from(root.querySelectorAll(".isf-btn")).find((b) => b.title === title);
        const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
        window.isfOpenInspector(block, "editor");
        await wait(250);
        byText(block, "Import").click();
        await wait(250);
        const panel = block.querySelector(".isf-import");
        const area = panel.querySelector("textarea");
        area.value = "void mainImage(out vec4 fragColor, in vec2 fragCoord) { vec2 uv = fragCoord / iResolution.xy; fragColor = texture(iChannel0, uv) * (0.5 + 0.5 * sin(iTime)) + iMouse.x * 0.001; }";
        byText(panel, "Convert & Load").click();
        await wait(1400);
        const source = block.querySelector(".isf-input").value;
        const status = block.querySelector(".isf-editor-status").textContent;
        const error = /is-error/.test(block.querySelector(".isf-status").className) || /error/i.test(status);
        const converted = /Converted from a Shadertoy/.test(source) && /iChannel0/.test(source) && /texture2D\(iChannel0/.test(source) && /#define iMouse _isfMouse/.test(source) && /mainImage\(gl_FragColor, gl_FragCoord.xy\)/.test(source);
        // exercise the pointer extension on the imported shader
        const stage = block.querySelector(".isf-stage");
        stage.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, pointerId: 1, cancelable: true }));
        stage.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 140, clientY: 120, pointerId: 1, cancelable: true }));
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
        await wait(400);
        const pointerError = /is-error/.test(block.querySelector(".isf-status").className);
        byText(block, "Revert").click();
        await wait(900);
        const restored = /CATEGORIES/.test(block.querySelector(".isf-input").value);
        return { converted: converted, error: error, status: status, restored: restored, pointerError: pointerError };
    });
    if (!importFlow.converted) problems.push("Shadertoy import did not produce ISF: " + JSON.stringify(importFlow));
    if (importFlow.error) problems.push("imported shader reported an error: " + JSON.stringify(importFlow));
    if (importFlow.pointerError) problems.push("pointer events broke the imported shader");
    if (!importFlow.restored) problems.push("revert after import did not restore the original source");

    // The editor template picker is a PUI menu once the toolkit is loaded.
    const templateMenu = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        const trigger = block && block.querySelector(".isf-template-menu .pui-menu-trigger");
        if (!trigger) return {missing: true, fallback: !!(block && block.querySelector(".isf-template-select"))};
        trigger.click();
        await wait(200);
        const item = Array.from(block.querySelectorAll('.isf-template-menu [role="menuitem"]'))
            .find((node) => /float input/i.test(node.textContent));
        if (!item) return {missing: false, item: false};
        item.click();
        await wait(300);
        const status = block.querySelector(".isf-editor-status");
        return {missing: false, item: true, inserted: !!status && /Inserted a float input/.test(status.textContent)};
    });
    if (templateMenu.missing) problems.push("editor Templates did not adopt the PUI menu: " + JSON.stringify(templateMenu));
    else if (!templateMenu.item) problems.push("editor Templates menu has no float input item");
    else if (!templateMenu.inserted) problems.push("editor Templates menu did not insert the snippet");

    // View controls: pass preview, quality selector, PNG export, share link.
    const viewControls = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const plasma = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        window.isfFooterAction(plasma, "share");
        const quality = plasma.querySelector('select[aria-label="Render scale"]');
        const canvas = plasma.querySelector(".isf-canvas");
        const before = canvas.width;
        quality.value = "0.5";
        quality.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(500);
        const after = canvas.width;
        quality.value = "auto";
        quality.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(300);
        const exportLength = canvas.toDataURL("image/png").length;
        const multipass = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /Multi-pass/i.test(title.textContent);
        });
        const passSelect = multipass.querySelector('select[aria-label="Preview a render pass"]');
        const passOptions = passSelect ? Array.from(passSelect.options).map((option) => option.value) : [];
        if (passSelect) {
            passSelect.value = "halfImage";
            passSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await wait(300);
        return {
            qualityShrunk: after < before,
            passOptions: passOptions,
            exportLength: exportLength,
            // The whole drawer is one PUI surface; the view row is a host block.
            viewInPui: !!plasma.querySelector(".isf-pui .isf-view")
        };
    });
    if (!viewControls.viewInPui) problems.push("the view row is not inside the PUI drawer");
    if (!viewControls.qualityShrunk) problems.push("quality selector did not resize the canvas: " + JSON.stringify(viewControls));
    if (viewControls.passOptions.indexOf("halfImage") === -1) problems.push("pass preview selector missing halfImage: " + JSON.stringify(viewControls.passOptions));
    if (viewControls.exportLength < 100) problems.push("PNG export produced no data");

    // WebGL2 / ES3 fallback: the dynamic-indexing sample must compile in
    // compatibility mode (headless Chrome has WebGL2).
    const es3 = await page.evaluate(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /ES3 fallback/i.test(title.textContent);
        });
        if (!block) return { missing: true };
        const status = block.querySelector(".isf-status");
        const canvas = block.querySelector("canvas");
        return { missing: false, status: status ? status.textContent : "", canvas: canvas ? canvas.width + "x" + canvas.height : "" };
    });
    if (es3.missing) problems.push("ES3 fallback sample not found");
    else if (!/Compatibility mode/.test(es3.status)) problems.push("ES3 fallback did not activate: " + JSON.stringify(es3));

    // Orientation: isf_FragNormCoord is bottom-left (ISF), image sources are
    // top-down, and captures must match the canvas. A known 4-quadrant image
    // catches both axes and both the upload and capture flips at once.
    const orientation = await page.evaluate(async () => {
        const quad = document.createElement("canvas");
        quad.width = 64;
        quad.height = 64;
        const q = quad.getContext("2d");
        q.fillStyle = "#ff0000"; q.fillRect(0, 0, 32, 32);
        q.fillStyle = "#00ff00"; q.fillRect(32, 0, 32, 32);
        q.fillStyle = "#0000ff"; q.fillRect(0, 32, 32, 32);
        q.fillStyle = "#ffffff"; q.fillRect(32, 32, 32, 32);
        const source = quad.toDataURL("image/png");
        async function corners(frame) {
            const image = new Image();
            image.src = frame.dataUrl;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const at = (x, y) => Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
            return {
                tl: at(1, 1), tr: at(image.width - 2, 1),
                bl: at(1, image.height - 2), br: at(image.width - 2, image.height - 2)
            };
        }
        const near = (c, r, g, b) => Math.abs(c[0] - r) < 8 && Math.abs(c[1] - g) < 8 && Math.abs(c[2] - b) < 8;
        const imageFrame = await DocsifyISF.renderFrame({
            url: "tests/fixtures/orientation.fs", width: 64, height: 64, time: 0,
            images: { inputImage: source }
        });
        const uvFrame = await DocsifyISF.renderFrame({
            url: "tests/fixtures/orientation-uv.fs", width: 64, height: 64, time: 0
        });
        const image = await corners(imageFrame);
        const uv = await corners(uvFrame);
        return {
            image: image,
            uv: uv,
            imageOk: near(image.tl, 255, 0, 0) && near(image.tr, 0, 255, 0) &&
                near(image.bl, 0, 0, 255) && near(image.br, 255, 255, 255),
            uvOk: near(uv.tl, 0, 255, 0) && near(uv.tr, 255, 255, 0) &&
                near(uv.bl, 0, 0, 0) && near(uv.br, 255, 0, 0)
        };
    });
    if (!orientation.imageOk) problems.push("image inputs are not upright: " + JSON.stringify(orientation.image));
    if (!orientation.uvOk) problems.push("isf_FragNormCoord/capture orientation is wrong: " + JSON.stringify(orientation.uv));

    // Live controls: randomize, time scrub, Ctrl+B, shortcut overlay, drop.
    const liveControls = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
        const titleOf = (block) => (block.querySelector('.isf-header [data-pui-item="title"]') || {}).textContent || "";
        const plasma = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(titleOf(b)));
        const speedValue = () => {
            const row = Array.from(plasma.querySelectorAll("[data-isf-param]")).find((r) => r.dataset.isfParam === "speed");
            return row && row.querySelector('input[type="range"]') ? Number(row.querySelector('input[type="range"]').value) : null;
        };
        const before = speedValue();
        byText(plasma, "Randomize").click();
        await wait(250);
        const randomized = before !== speedValue();

        const timeRange = plasma.querySelector('.isf-inspector-pui .pui-transport-controls input[type="range"]') ||
            plasma.querySelector('.isf-time-row input[type="range"]');
        timeRange.value = "12.5";
        timeRange.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(180);
        const timeScrubbed = Number(timeRange.value) >= 12;

        const editorWrap = plasma.querySelector(".isf-editor-wrap");
        const editorWasHidden = window.isfEditorPanel(plasma).hidden;
        plasma.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
        await wait(220);
        const editorToggled = window.isfEditorPanel(plasma).hidden !== editorWasHidden;

        let shortcutsShown = false;
        window.isfFooterAction(plasma, "help");
        await wait(220);
        shortcutsShown = /Keyboard shortcuts/.test(plasma.querySelector(".isf-overlay").textContent);
        const closeShortcuts = plasma.querySelector('.isf-overlay [data-isf-overlay="close"]');
        if (closeShortcuts) closeShortcuts.click();
        await wait(100);

        // Drag & drop an image onto a filter viewer.
        const kaleido = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Kaleidoscope/i.test(titleOf(b)));
        kaleido.scrollIntoView({ block: "center" });
        await wait(700);
        const overlay = kaleido.querySelector(".isf-overlay");
        if (overlay && overlay.style.display !== "none") { overlay.click(); await wait(700); }
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        canvas.getContext("2d").fillRect(0, 0, 2, 2);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        const transfer = new DataTransfer();
        transfer.items.add(new File([blob], "drop-test.png", { type: "image/png" }));
        kaleido.querySelector(".isf-stage").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        await wait(800);
        const dropStatus = kaleido.querySelector(".isf-status").textContent;

        return { randomized: randomized, timeScrubbed: timeScrubbed, editorToggled: editorToggled, shortcutsShown: shortcutsShown, dropStatus: dropStatus };
    });
    if (!liveControls.randomized) problems.push("randomize did not change a parameter");
    if (!liveControls.timeScrubbed) problems.push("time scrubber did not move the clock");
    if (!liveControls.editorToggled) problems.push("Ctrl+B did not toggle the editor");
    if (!liveControls.shortcutsShown) problems.push("shortcut overlay did not open");
    if (!/Loaded drop-test\.png/.test(liveControls.dropStatus)) problems.push("drag & drop did not load the image: " + JSON.stringify(liveControls.dropStatus));

    // Real interaction regression: toolbar drawer toggles, slider drag, editor typing.
    await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        b.scrollIntoView({ block: "center" });
        const panel = window.isfInspectorPanel(b);
        if (panel && !panel.hidden) {
            const close = window.isfInspectorHost(b).querySelector('.pui-drawer-body > .pui-toolbar [data-pui-item="close"]');
            if (close) close.click();
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const lateralTabs = await page.$$eval(".isf-block .isf-edge-tab", (elements) => elements.length);
    if (lateralTabs !== 0) problems.push("lateral edge tabs should be gone, found " + lateralTabs);

    await page.evaluate(() => window.isfOpenEditor(document.querySelector(".isf-block")));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const toolbarToggle = await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        const editorTrigger = b.querySelector('.isf-header [data-pui-item="editor"]');
        const inspectorTrigger = b.querySelector('.isf-header [data-pui-item="controls"]');
        return {
            drawerOpen: !window.isfEditorPanel(b).hidden,
            pressed: !!editorTrigger && editorTrigger.getAttribute("aria-pressed") === "true",
            inspectorSeparate: !!inspectorTrigger && inspectorTrigger.getAttribute("aria-pressed") === "false"
        };
    });
    if (!toolbarToggle.drawerOpen || !toolbarToggle.pressed || !toolbarToggle.inspectorSeparate) problems.push("the header source trigger did not open the left editor drawer");

    await page.evaluate(() => window.isfOpenInspector(document.querySelector(".isf-block"), "params"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const slider = await page.$('.isf-block [data-isf-param="scale"] input[type="range"]');
    if (slider) {
        await slider.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await new Promise((resolve) => setTimeout(resolve, 150));
        const box = await slider.boundingBox();
        const scaleBefore = await page.$eval('.isf-block [data-isf-param="scale"] input[type="number"]', (el) => Number(el.value));
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 8; step++) {
            await page.mouse.move(box.x + box.width * (0.2 + 0.075 * step), box.y + box.height / 2);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await page.mouse.up();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const scaleAfter = await page.$eval('.isf-block [data-isf-param="scale"] input[type="number"]', (el) => Number(el.value));
        if (scaleAfter === scaleBefore) problems.push("real slider drag did not change the parameter (" + scaleBefore + " -> " + scaleAfter + ")");
    } else {
        problems.push("scale slider not found for the drag test");
    }

    // The inspector is tabbed now; switch back to Source before typing.
    await page.evaluate(() => window.isfOpenInspector(document.querySelector(".isf-block"), "editor"));
    await new Promise((resolve) => setTimeout(resolve, 350));
    const textareaHandle = await page.$(".isf-block .isf-input");
    if (textareaHandle) {
        const textBox = await textareaHandle.boundingBox();
        const textBefore = await page.$eval(".isf-block .isf-input", (el) => el.value);
        await page.mouse.click(textBox.x + 50, textBox.y + 40);
        await page.keyboard.type("Z");
        await new Promise((resolve) => setTimeout(resolve, 250));
        const textAfter = await page.$eval(".isf-block .isf-input", (el) => el.value);
        if (textAfter === textBefore) problems.push("real editor click + typing did not change the source");
    } else {
        problems.push("editor textarea not found for the typing test");
    }

    // The editor toolbar folds away to give the code pane the space.
    const foldResult = await page.evaluate(async () => {
        const b = document.querySelector(".isf-block");
        const fold = b.querySelector(".isf-fold-btn");
        const actions = b.querySelector(".isf-editor-actions");
        const editor = b.querySelector(".isf-editor");
        if (!fold) return { missing: true };
        const before = editor.getBoundingClientRect().height;
        fold.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const folded = {
            actionsHidden: getComputedStyle(actions).display === "none",
            summaryShown: getComputedStyle(b.querySelector(".isf-editor-folded-summary")).display !== "none",
            grew: editor.getBoundingClientRect().height > before + 8
        };
        const pressed = fold.getAttribute("aria-expanded");
        fold.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { folded: folded, pressed: pressed, restored: getComputedStyle(actions).display !== "none" };
    });
    if (foldResult.missing) problems.push("editor fold button not found");
    else {
        if (!foldResult.folded.actionsHidden || !foldResult.folded.summaryShown) problems.push("folding the editor toolbar did not hide its controls");
        if (!foldResult.folded.grew) problems.push("folding the editor toolbar did not grow the code pane");
        if (foldResult.pressed !== "false") problems.push("fold button did not report aria-expanded=false when folded");
        if (!foldResult.restored) problems.push("unfolding the editor toolbar did not restore its controls");
    }

    // Context budget: scroll a released viewer into view and wait for the pump.
    const recovery = await page.evaluate(async () => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Input-type test card/i.test(b.textContent));
        if (!block) return { found: false };
        block.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        const overlay = block.querySelector(".isf-overlay");
        if (!overlay || overlay.style.display === "none") return { found: true, alreadyLive: true };
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const after = block.querySelector(".isf-overlay");
        return {
            found: true,
            resumed: !(after && after.style.display !== "none"),
            overlay: after ? after.textContent.trim().slice(0, 90) : ""
        };
    });
    if (!recovery.found) problems.push("test-card viewer not found for budget recovery");
    else if (!recovery.alreadyLive && !recovery.resumed) problems.push("released viewer did not resume: " + recovery.overlay);

    // Context: each inspector belongs to its own shader, and opening one
    // viewer closes the previous inspector instead of stacking global panels.
    const inspectorContext = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const plasma = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        const kaleido = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Kaleidoscope/i.test(b.textContent));
        if (!plasma || !kaleido) return { missing: true };
        window.isfOpenInspector(plasma, "params");
        await sleep(300);
        const plasmaPanel = window.isfInspectorPanel(plasma);
        window.isfOpenInspector(kaleido, "params");
        await sleep(350);
        const kaleidoPanel = window.isfInspectorPanel(kaleido);
        const title = window.isfInspectorHost(kaleido).querySelector(".pui-drawer-body > .pui-toolbar .pui-toolbar-label");
        const trigger = kaleido.querySelector('.isf-header [data-pui-item="controls"]');
        const triggerRect = trigger.getBoundingClientRect();
        const panelRect = kaleidoPanel.getBoundingClientRect();
        const result = {
            plasmaClosed: plasmaPanel.hidden,
            kaleidoOpen: !kaleidoPanel.hidden,
            plasmaContext: plasma.querySelector(".isf-stage").contains(plasmaPanel),
            kaleidoContext: kaleido.querySelector(".isf-stage").contains(kaleidoPanel),
            triggerNear: Math.abs(triggerRect.right - panelRect.right) <= 24 &&
                panelRect.top >= triggerRect.bottom - 2 && panelRect.top - triggerRect.bottom <= 24,
            title: title ? title.textContent : ""
        };
        const close = window.isfInspectorHost(kaleido).querySelector('.pui-drawer-body > .pui-toolbar [data-pui-item="close"]');
        if (close) close.click();
        await sleep(220);
        return result;
    });
    if (inspectorContext.missing) problems.push("inspector context viewers not found");
    else {
        if (!inspectorContext.plasmaClosed || !inspectorContext.kaleidoOpen) {
            problems.push("opening a second inspector did not close the first: " + JSON.stringify(inspectorContext));
        }
        if (!inspectorContext.plasmaContext || !inspectorContext.kaleidoContext) {
            problems.push("the inspector is not anchored inside its viewer stage: " + JSON.stringify(inspectorContext));
        }
        if (!/Kaleidoscope/i.test(inspectorContext.title)) {
            problems.push("the inspector lost its shader context title: " + JSON.stringify(inspectorContext.title));
        }
        if (!inspectorContext.triggerNear) {
            problems.push("the inspector trigger is not anchored at the edge of its panel: " + JSON.stringify(inspectorContext));
        }
    }

    // Desktop: Parameters on the right and Source on the left coexist, each
    // trigger sits at its drawer edge, and the drawer heads stay compact.
    const splitDrawers = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        if (!block) return { missing: true };
        window.isfOpenEditor(block);
        await sleep(300);
        window.isfOpenInspector(block, "params");
        await sleep(350);
        const editorPanel = window.isfEditorPanel(block);
        const inspectorPanel = window.isfInspectorPanel(block);
        const editorTrigger = block.querySelector('.isf-header [data-pui-item="editor"]');
        const inspectorTrigger = block.querySelector('.isf-header [data-pui-item="controls"]');
        const er = editorPanel.getBoundingClientRect();
        const ir = inspectorPanel.getBoundingClientRect();
        const et = editorTrigger.getBoundingClientRect();
        const it = inspectorTrigger.getBoundingClientRect();
        const inspectorHost = window.isfInspectorHost(block);
        const editorHost = window.isfEditorHost(block);
        const result = {
            editorOpen: !editorPanel.hidden,
            inspectorOpen: !inspectorPanel.hidden,
            separated: er.right <= ir.left + 1,
            editorTriggerNear: Math.abs(et.left - er.left) <= 24 && er.top >= et.bottom - 2 && er.top - et.bottom <= 24,
            inspectorTriggerNear: Math.abs(it.right - ir.right) <= 24 && ir.top >= it.bottom - 2 && ir.top - it.bottom <= 24,
            inspectorHeadless: !inspectorHost.querySelector(".pui-drawer-head"),
            editorHeadless: !editorHost.querySelector(".pui-drawer-head"),
            editorTitleBar: (() => {
                const head = editorHost.querySelector(".isf-editor-head");
                return !!head && getComputedStyle(head).display !== "none";
            })(),
            translucent: editorPanel.classList.contains("is-translucent") && getComputedStyle(editorPanel).backdropFilter !== "none",
            contained: inspectorPanel.classList.contains("is-contained") && editorPanel.classList.contains("is-contained"),
            externalTriggers: !inspectorHost.querySelector(".pui-drawer-trigger") && !editorHost.querySelector(".pui-drawer-trigger"),
            declaredWidths: [inspectorPanel, editorPanel].map((panel) => panel.style.getPropertyValue("--pui-drawer-width")),
            inspectorTitle: (() => {
                const label = inspectorHost.querySelector(".pui-drawer-body > .pui-toolbar .pui-toolbar-label");
                return label ? label.textContent : "";
            })()
        };
        const editorClose = editorHost.querySelector(".isf-editor-head .isf-panel-close");
        if (editorClose) editorClose.click();
        const inspectorClose = inspectorHost.querySelector('.pui-drawer-body > .pui-toolbar [data-pui-item="close"]');
        if (inspectorClose) inspectorClose.click();
        await sleep(250);
        result.closedAgain = window.isfEditorPanel(block).hidden && window.isfInspectorPanel(block).hidden;
        return result;
    });
    if (splitDrawers.missing) problems.push("split drawer viewer not found");
    else {
        if (!splitDrawers.editorOpen || !splitDrawers.inspectorOpen || !splitDrawers.separated) {
            problems.push("desktop source/parameters drawers do not coexist: " + JSON.stringify(splitDrawers));
        }
        if (!splitDrawers.editorTriggerNear || !splitDrawers.inspectorTriggerNear) {
            problems.push("a drawer trigger is not anchored at its drawer edge: " + JSON.stringify(splitDrawers));
        }
        if (!splitDrawers.inspectorHeadless || !splitDrawers.editorHeadless || !splitDrawers.editorTitleBar) {
            problems.push("the drawers did not merge their title chrome: " + JSON.stringify(splitDrawers));
        }
        if (!splitDrawers.translucent) problems.push("the source drawer should use the PUI translucent surface");
        if (!splitDrawers.contained || !splitDrawers.externalTriggers) {
            problems.push("the split drawers did not use PUI contained/external-trigger options: " + JSON.stringify(splitDrawers));
        }
        if (splitDrawers.declaredWidths.join(",") !== "min(420px, 40%),min(560px, 48%)") {
            problems.push("the split drawers lost their PUI CSS-length widths: " + JSON.stringify(splitDrawers.declaredWidths));
        }
        if (!/Plasma/i.test(splitDrawers.inspectorTitle)) problems.push("the parameters drawer title lost its shader context");
        if (!splitDrawers.closedAgain) problems.push("the split drawers did not close");
    }

    // Modern phone: the toolbar stays usable, drawers fill the stage and
    // swapping one for the other keeps the render reachable.
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.waitForFunction(() => {
        const b = document.querySelector(".isf-block");
        return !!b && !!b.querySelector(".isf-pui-header .pui-toolbar");
    }, { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        if (!b) return;
        b.scrollIntoView({ block: "center" });
        const panel = window.isfInspectorPanel(b);
        if (panel && !panel.hidden) {
            const close = window.isfInspectorHost(b).querySelector(".pui-drawer-close");
            if (close) close.click();
        }
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const phone = await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        const actions = b.querySelector(".isf-pui-header .pui-toolbar");
        const header = b.querySelector(".isf-pui-header");
        if (!actions) return { missing: true, viewport: window.innerWidth, blockWidth: b.getBoundingClientRect().width,
            headerClass: header ? header.className : "none", headerHtml: header ? header.innerHTML.slice(0, 300) : "",
            status: (b.querySelector(".isf-status") || {}).textContent || "" };
        const buttons = Array.from(actions.querySelectorAll("button.pui-button"))
            .filter((button) => button.getClientRects().length && button.getBoundingClientRect().height > 0);
        const heights = buttons.map((button) => button.getBoundingClientRect().height);
        return {
            viewport: window.innerWidth,
            docWidth: document.documentElement.scrollWidth,
            blockWidth: b.getBoundingClientRect().width,
            overflow: b.scrollWidth - b.clientWidth,
            minButton: heights.length ? Math.min.apply(null, heights) : 0,
            actionButtons: buttons.length,
            stripHeight: actions.getBoundingClientRect().height,
            moreVisible: (() => { const more = actions.querySelector(".pui-menu-trigger"); return !!more && !more.hidden; })(),
            collapsed: Array.from(actions.children).filter((node) => node.hidden).map((node) => node.getAttribute("data-pui-item")),
            wide: Array.from(b.querySelectorAll("*")).map((el) => ({tag: el.tagName, cls: String(el.className || "").slice(0, 60), w: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right)})).filter((el) => el.right > b.getBoundingClientRect().right + 1).slice(0, 8),
            layout: actions.__puiToolbarLayout ? {client: actions.clientWidth, rect: Math.round(actions.getBoundingClientRect().width), collapsed: actions.__puiToolbarLayout.collapsed, main: actions.__puiToolbarLayout.main.map((entry) => ({id: entry.item.id, hidden: entry.node.hidden, w: Math.round(entry.node.getBoundingClientRect().width), p: entry.item.priority}))} : null
        };
    });
    if (phone.missing) problems.push("mobile: PUI header toolbar did not mount " + JSON.stringify(phone));
    if (phone.blockWidth > phone.viewport + 1) problems.push("mobile: viewer is wider than the viewport (" + phone.blockWidth + " > " + phone.viewport + ")");
    if (phone.docWidth > phone.viewport + 1) problems.push("mobile: the document scrolls horizontally (" + phone.docWidth + " > " + phone.viewport + ")");
    if (phone.overflow > 1) problems.push("mobile: viewer has horizontal overflow (" + phone.overflow + "px) " + JSON.stringify({wide: phone.wide, layout: phone.layout}));
    if (phone.minButton < 32) problems.push("mobile: touch target under 32px (" + phone.minButton.toFixed(1) + ")");
    if (phone.actionButtons > 2) problems.push("mobile: the header should expose only the source and inspector toggles: " + JSON.stringify(phone));

    // Wait for the target's controls: a budget-released viewer rebuilds them
    // when it resumes, and the test must click after that settled.
    await page.waitForFunction(() => {
        const b = Array.from(document.querySelectorAll(".isf-block"))
            .find((block) => /Plasma generator/i.test(block.textContent));
        return !!b && b.querySelectorAll("[data-isf-param]").length > 0;
    }, { timeout: 20000 }).catch(() => {});

    // One atomic evaluate per interaction: pick the viewer, normalise its
    // drawer state, click the toolbar button and read the result, so a
    // Docsify re-render or a layout shift cannot split the click and the
    // assertion across DOM nodes.
    const phoneParams = await page.evaluate(async () => {
        const b = Array.from(document.querySelectorAll(".isf-block"))
            .find((block) => /Plasma generator/i.test(block.textContent)) ||
            document.querySelector(".isf-block");
        const panel = window.isfInspectorPanel(b);
        if (panel && !panel.hidden) {
            const close = window.isfInspectorHost(b).querySelector('.pui-drawer-body > .pui-toolbar [data-pui-item="close"]');
            if (close) close.click();
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        window.isfOpenInspector(b, "params");
        await new Promise((resolve) => setTimeout(resolve, 350));
        const drawer = window.isfInspectorPanel(b);
        const button = b.querySelector('.isf-header [data-pui-item="controls"]');
        const stage = b.querySelector(".isf-stage");
        const heading = window.isfInspectorHost(b).querySelector(".pui-drawer-body > .pui-toolbar .pui-toolbar-label");
        return {
            open: !drawer.hidden,
            drawerWidth: drawer.getBoundingClientRect().width,
            stageWidth: stage.getBoundingClientRect().width,
            title: (b.querySelector('.isf-header [data-pui-item="title"]') || {}).textContent || "",
            drawerTitle: heading ? heading.textContent : "",
            pressed: button.getAttribute("aria-pressed")
        };
    });
    if (!phoneParams.open || phoneParams.pressed !== "true") {
        problems.push("mobile: parameters did not open from the inspector trigger (" +
            JSON.stringify(phoneParams) + ")");
    }
    if (phoneParams.drawerWidth < phoneParams.stageWidth - 2) problems.push("mobile: parameters drawer should fill the stage width");

    const phoneSwap = await page.evaluate(async () => {
        const b = Array.from(document.querySelectorAll(".isf-block"))
            .find((block) => /Plasma generator/i.test(block.textContent)) ||
            document.querySelector(".isf-block");
        window.isfOpenEditor(b);
        await new Promise((resolve) => setTimeout(resolve, 350));
        const editorTrigger = b.querySelector('.isf-header [data-pui-item="editor"]');
        const drawer = window.isfEditorPanel(b);
        const editor = b.querySelector(".isf-editor");
        const editorHead = window.isfEditorHost(b).querySelector(".isf-editor-head");
        const panelStyle = getComputedStyle(drawer);
        return {
            editorOpen: !drawer.hidden && editorTrigger.getAttribute("aria-pressed") === "true",
            inspectorClosed: window.isfInspectorPanel(b).hidden,
            compactChrome: b.querySelector(".isf-editor-status").getBoundingClientRect().height <= 2 &&
                getComputedStyle(b.querySelector(".isf-editor-pos")).display === "none",
            codeShare: editor.getBoundingClientRect().height / Math.max(1, drawer.getBoundingClientRect().height),
            transparent: panelStyle.backdropFilter !== "none" && /rgba|color\(/i.test(panelStyle.backgroundColor),
            editorChrome: !!editorHead && getComputedStyle(editorHead).display !== "none"
        };
    });
    if (!phoneSwap.editorOpen || !phoneSwap.inspectorClosed) problems.push("mobile: opening the source drawer should close the inspector");
    if (!phoneSwap.transparent) problems.push("mobile: the source drawer is not translucent");
    if (!phoneSwap.editorChrome) problems.push("mobile: the source editor lost its compact title bar");
    if (!phoneSwap.compactChrome) problems.push("mobile: the editor should drop the status/caret chrome");
    if (phoneSwap.codeShare < 0.5) problems.push("mobile: the code pane got less than half the inspector: " + phoneSwap.codeShare.toFixed(2));
    await page.screenshot({ path: path.join(here, "artifacts", "mobile.png"), fullPage: false });

    const phoneFold = await page.evaluate(async () => {
        const b = document.querySelector(".isf-block");
        const fold = b.querySelector(".isf-fold-btn");
        const actions = b.querySelector(".isf-editor-actions");
        const editor = b.querySelector(".isf-editor");
        const before = editor.getBoundingClientRect().height;
        fold.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const summary = b.querySelector(".isf-editor-folded-summary");
        return {
            hidden: getComputedStyle(actions).display === "none",
            grew: Math.round(editor.getBoundingClientRect().height - before),
            summary: summary ? summary.textContent.trim().slice(0, 40) : ""
        };
    });
    if (!phoneFold.hidden) problems.push("mobile: folded editor toolbar is still visible");
    if (phoneFold.grew < 24) problems.push("mobile: folding the toolbar freed only " + phoneFold.grew + "px");
    await page.screenshot({ path: path.join(here, "artifacts", "mobile-folded.png"), fullPage: false });
    await page.setViewport({ width: 1280, height: 1000 });
    // A viewport change can rebuild a lazy viewer; wait for its PUI header
    // before asserting where the stats readout lives.
    await page.waitForFunction(() => {
        const host = document.querySelector(".isf-block .isf-pui-header");
        return host && !host.classList.contains("isf-hidden") && !!host.querySelector(".pui-toolbar");
    }, { timeout: 10000, polling: 100 });

    // ── UI: the stats pill belongs to the top bar, never over the shader ──
    const badgeHome = await page.evaluate(() => {
        const stats = Array.from(document.querySelectorAll('[data-pui-item="stats"]'));
        const statsNamed = stats.filter((el) => el.getAttribute("aria-label") === "Render statistics").length;
        const headerButtons = Array.from(document.querySelectorAll(
            ".isf-block .isf-pui-header .pui-toolbar > button.pui-button, " +
            ".isf-block .isf-pui-header .pui-toolbar > .pui-menu > .pui-menu-trigger"
        ));
        const pressedItems = Array.from(document.querySelectorAll(".isf-block .isf-pui-header [aria-pressed]"))
            .map((el) => el.getAttribute("data-pui-item"));
        const headerMore = document.querySelector(".isf-block .isf-pui-header .pui-toolbar-overflow .pui-menu-trigger");
        const toolbar = document.querySelector(".isf-block .isf-pui-header .pui-toolbar");
        return {
            count: stats.length,
            statsNamed: statsNamed,
            inStage: stats.filter((el) => !!el.closest(".isf-stage")).length,
            outsideHeader: stats.filter((el) => !el.closest(".isf-header")).length,
            headerToolbar: !!document.querySelector(".isf-block .isf-pui-header .pui-toolbar"),
            headerButtons: headerButtons.length,
            nameless: headerButtons.filter((button) => !(
                (button.getAttribute("aria-label") || "").trim() ||
                (button.title || "").trim() ||
                (button.textContent || "").trim()
            )).length,
            pressedItems: pressedItems,
            moreHidden: !headerMore || headerMore.hidden,
            toolbarClient: toolbar ? toolbar.clientWidth : null,
            layout: toolbar && toolbar.__puiToolbarLayout ? {
                collapsed: toolbar.__puiToolbarLayout.collapsed,
                main: toolbar.__puiToolbarLayout.main.map((entry) => ({id: entry.item.id, hidden: entry.node.hidden, w: Math.round(entry.node.getBoundingClientRect().width), p: entry.item.priority}))
            } : null,
            unexpectedPressed: pressedItems.filter((id) => ["controls", "editor", "fullscreen"].indexOf(id) < 0)
        };
    });
    if (!badgeHome.headerToolbar || badgeHome.inStage || badgeHome.outsideHeader) {
        problems.push("the stats readout should live in the PUI header, never over the shader: " + JSON.stringify(badgeHome));
    }
    if (badgeHome.count && badgeHome.statsNamed !== badgeHome.count) {
        problems.push("the stats readout needs its accessible name: " + JSON.stringify(badgeHome));
    }

    // Structural PUI renders (source reloads, input-set changes) must restore
    // focus to the same public item hook.
    const puiFocus = await page.evaluate(() => {
        const UI = window.PupitreUI;
        if (!UI) return {missing: true};
        const mount = document.createElement("div");
        document.body.appendChild(mount);
        const doc = {format: "pupitre-ui", version: 1, panels: [{id: "focus", pages: [{id: "p", sections: [{id: "s", blocks: [
            {kind: "toolbar", items: [{id: "one", label: "One", call: "one"}, {id: "two", label: "Two", call: "two"}]}
        ]}]}]}]};
        const ui = UI.create({mount, getValue: () => undefined, setValue: () => true, callAction: () => true, getPathMeta: () => ({})});
        ui.render(doc);
        const first = mount.querySelector('[data-pui-item="one"]');
        first.focus();
        ui.render(doc);
        const after = mount.querySelector('[data-pui-item="one"]');
        const ok = document.activeElement === after && after !== first;
        ui.destroy();
        mount.remove();
        return {missing: false, ok: ok};
    });
    if (puiFocus.missing) problems.push("PupitreUI is not exposed for the focus contract check");
    else if (!puiFocus.ok) problems.push("PUI render() did not restore focus to the same item");
    if (!badgeHome.headerButtons || badgeHome.nameless) {
        problems.push("PUI header icon actions need an accessible name: " + JSON.stringify(badgeHome));
    }
    if (!badgeHome.moreHidden) {
        problems.push("desktop header overflowed despite available width: " + JSON.stringify(badgeHome));
    }
    if (badgeHome.unexpectedPressed.length) {
        problems.push("only real toggle controls should expose aria-pressed: " + JSON.stringify(badgeHome));
    }

    // ── UI: the code editor fills the drawer and follows a taller stage ──
    const editorFill = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = document.querySelector(".isf-block");
        window.isfOpenInspector(block, "editor");
        await sleep(400);
        // a stored manual height would pin the editor; reset to the flex fill
        block.querySelector(".isf-resize-y").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        await sleep(300);
        const editor = block.querySelector(".isf-editor");
        const wrap = block.querySelector(".isf-editor-wrap");
        const toolbar = block.querySelector(".isf-editor-toolbar");
        const resize = block.querySelector(".isf-editor-wrap .isf-resize-y");
        const stage = block.querySelector(".isf-stage");
        const chrome = (resize ? resize.getBoundingClientRect().height : 0) +
            toolbar.getBoundingClientRect().height;
        const measure = () => ({
            editor: Math.round(editor.getBoundingClientRect().height),
            available: Math.round(wrap.getBoundingClientRect().height - chrome)
        });
        const first = measure();
        stage.style.height = "620px";
        await sleep(400);
        const taller = measure();
        stage.style.height = "";
        return { first: first, taller: taller };
    });
    if (editorFill.first.editor < 160) {
        problems.push("the editor pane collapsed: " + JSON.stringify(editorFill.first));
    }
    if (editorFill.taller.editor <= editorFill.first.editor + 60) {
        problems.push("the editor did not follow the taller stage: " + JSON.stringify(editorFill));
    }

    // ── resolution: SD by default, fullscreen is distraction-free with a hint ──
    const resolution = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /Plasma/i.test(title.textContent);
        });
        if (!block) return { missing: true };
        block.scrollIntoView({ block: "center" });
        await sleep(600);
        const canvas = () => block.querySelector(".isf-canvas");
        const buffer = () => [canvas().width, canvas().height];
        const rect = (el) => {
            const r = el.getBoundingClientRect();
            return { width: Math.round(r.width), height: Math.round(r.height) };
        };
        const aspectOk = (b) => {
            const css = rect(canvas());
            return css.width > 0 && css.height > 0 && Math.abs(b[0] / b[1] - css.width / css.height) < 0.03;
        };
        const initial = {
            buffer: buffer(),
            stage: rect(block.querySelector(".isf-stage")),
            storedCap: JSON.parse(localStorage.getItem("docsify-isf:layout") || "{}").resolutionCap || null
        };
        const initialAspect = aspectOk(initial.buffer);
        window.isfFooterAction(block, "fullscreen");
        await sleep(700);
        const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
        const viewport = { width: innerWidth, height: innerHeight };
        const fullscreen = {
            active: fsElement === block,
            block: rect(block),
            stage: rect(block.querySelector(".isf-stage")),
            canvas: rect(canvas()),
            buffer: buffer(),
            viewport: viewport
        };
        const fullscreenAspect = aspectOk(fullscreen.buffer);
        const header = block.querySelector(".isf-header");
        const status = block.querySelector(".isf-status");
        const hint = block.querySelector(".isf-fullscreen-hint");
        const drawer = window.isfInspectorPanel(block);
        const headerHidden = getComputedStyle(header).display === "none";
        const statusHidden = getComputedStyle(status).display === "none";
        const inspectorClosed = drawer.hidden;
        const legacyToolbar = !!block.querySelector(".isf-pui-toolbar");
        const hintVisible = !!hint && !hint.classList.contains("isf-hidden") && getComputedStyle(hint).display !== "none";
        await sleep(2350);
        const hintAutoHidden = !!hint && hint.classList.contains("isf-hidden");
        document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }));
        await sleep(150);
        const hintRearmed = !!hint && !hint.classList.contains("isf-hidden");
        if (hint) hint.click();
        await sleep(450);
        const host = window.isfInspectorHost(block);
        const paramsButton = block.querySelector('.isf-header [data-pui-item="controls"]');
        const paramsOpen = !drawer.hidden && !!paramsButton && paramsButton.getAttribute("aria-pressed") === "true";
        const actionItems = host ? Array.from(host.querySelectorAll("[data-pui-item]")).map((el) => el.getAttribute("data-pui-item")) : [];
        const labels = host ? Array.from(host.querySelectorAll(".pui-menu-popup .pui-button, .pui-drawer-body > .pui-toolbar .pui-button")).map((el) => el.textContent.trim()) : [];
        const inspectorTitle = host ? host.querySelector(".pui-drawer-body > .pui-toolbar .pui-toolbar-label") : null;
        const tabs = [];
        const transport = host && host.querySelector(".pui-drawer-body > .pui-transport");
        const transportInScroll = !!transport;
        const drawerTitle = inspectorTitle ? inspectorTitle.textContent : "";
        const select = block.querySelector('select[aria-label="Render resolution"]');
        const setResolution = async (value) => {
            if (!select) return;
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await sleep(700);
        };
        await setResolution("hd");
        const hd = {
            value: select && select.value,
            buffer: buffer(),
            storedCap: JSON.parse(localStorage.getItem("docsify-isf:layout") || "{}").resolutionCap || null
        };
        await setResolution("default");
        const back = {
            value: select && select.value,
            buffer: buffer(),
            storedCap: JSON.parse(localStorage.getItem("docsify-isf:layout") || "{}").resolutionCap || null
        };
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(350);
        const escapeClosed = drawer.hidden;
        const hintAfterEscape = !!hint && !hint.classList.contains("isf-hidden");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
        await sleep(350);
        const hOpened = !drawer.hidden;
        window.isfFooterAction(block, "fullscreen");
        await sleep(700);
        const afterExit = {
            fullscreen: !!(document.fullscreenElement || document.webkitFullscreenElement),
            headerDisplay: getComputedStyle(header).display,
            hintHidden: !!hint && hint.classList.contains("isf-hidden"),
            legacyToolbar: !!block.querySelector(".isf-pui-toolbar")
        };
        return {
            missing: false,
            initial: initial,
            fullscreen: fullscreen,
            hd: hd,
            back: back,
            initialAspect: initialAspect,
            fullscreenAspect: fullscreenAspect,
            headerHidden: headerHidden,
            statusHidden: statusHidden,
            inspectorClosed: inspectorClosed,
            legacyToolbar: legacyToolbar,
            hintVisible: hintVisible,
            hintAutoHidden: hintAutoHidden,
            hintRearmed: hintRearmed,
            hintAfterEscape: hintAfterEscape,
            paramsOpen: paramsOpen,
            footerActions: actionItems,
            footerLabels: labels,
            tabs: tabs,
            transportInScroll: transportInScroll,
            drawerTitle: drawerTitle,
            escapeClosed: escapeClosed,
            hOpened: hOpened,
            afterExit: afterExit
        };
    });
    if (resolution.missing) {
        problems.push("plasma viewer not found for the resolution/fullscreen test");
    } else {
        const fs = resolution.fullscreen;
        if (!fs.active) problems.push("fullscreen did not activate on the viewer block");
        if (Math.abs(fs.block.width - fs.viewport.width) > 4 || Math.abs(fs.block.height - fs.viewport.height) > 4) {
            problems.push("fullscreen block does not fill the viewport: " + JSON.stringify(fs));
        }
        if (!resolution.headerHidden) problems.push("the fullscreen header is still visible");
        if (!resolution.statusHidden) problems.push("the fullscreen status bar is still visible");
        if (!resolution.inspectorClosed) problems.push("fullscreen did not enter with the inspector closed");
        if (resolution.legacyToolbar) problems.push("the retired fullscreen toolbox is still rendered");
        if (!resolution.hintVisible) problems.push("the fullscreen inspector hint is not visible on entry");
        if (!resolution.hintAutoHidden) problems.push("the fullscreen hint did not auto-hide after inactivity");
        if (!resolution.hintRearmed) problems.push("pointer activity did not re-arm the fullscreen hint");
        if (!resolution.paramsOpen) problems.push("clicking the fullscreen hint did not open Parameters");
        if (resolution.footerActions.indexOf("more") < 0 ||
            resolution.footerActions.indexOf("fullscreen") < 0 ||
            resolution.footerActions.indexOf("reset") < 0 ||
            resolution.footerActions.indexOf("share") < 0 ||
            resolution.footerActions.indexOf("source-file") < 0) {
            problems.push("the inspector More menu is missing actions: " + JSON.stringify(resolution.footerActions));
        }
        if (resolution.footerLabels.indexOf("Exit fullscreen") < 0) {
            problems.push("the inspector More menu does not expose Exit fullscreen: " + JSON.stringify(resolution.footerLabels));
        }
        if (!resolution.transportInScroll) problems.push("the transport should be mounted in the PUI inspector");
        if (!/Plasma/i.test(resolution.drawerTitle)) problems.push("the inspector title lost the shader context: " + JSON.stringify(resolution.drawerTitle));
        if (!/Plasma/i.test(resolution.drawerTitle)) {
            problems.push("the inspector title lost the shader context: " + JSON.stringify(resolution.drawerTitle));
        }
        if (!resolution.escapeClosed) problems.push("Escape did not close the fullscreen inspector");
        if (!resolution.hintAfterEscape) problems.push("the hint did not return after closing the inspector");
        if (!resolution.hOpened) problems.push("H did not reopen the fullscreen inspector");
        if (resolution.afterExit.fullscreen) problems.push("the footer fullscreen action did not exit");
        if (resolution.afterExit.headerDisplay === "none") problems.push("the header did not return after fullscreen");
        if (!resolution.afterExit.hintHidden) problems.push("the fullscreen hint is still visible after exit");
        if (resolution.afterExit.legacyToolbar) problems.push("the retired fullscreen toolbox returned after exit");
        if (fs.stage.width < fs.viewport.width * 0.9 || fs.stage.height < fs.viewport.height * 0.9) {
            problems.push("fullscreen stage does not fill the block: " + JSON.stringify(fs.stage));
        }
        if (resolution.initial.buffer[0] > 854 || resolution.initial.buffer[1] > 480) {
            problems.push("the default render buffer exceeds SD: " + JSON.stringify(resolution.initial.buffer));
        }
        if (!resolution.initialAspect) problems.push("the default buffer does not preserve the stage aspect ratio");
        if (fs.buffer[0] > 854 || fs.buffer[1] > 480) {
            problems.push("the fullscreen buffer exceeds the SD cap: " + JSON.stringify(fs.buffer));
        }
        if (!resolution.fullscreenAspect) problems.push("the fullscreen buffer does not preserve the stage aspect ratio");
        if (resolution.hd.value !== "hd" || resolution.hd.storedCap !== "hd") {
            problems.push("the HD preset was not selected/persisted: " + JSON.stringify(resolution.hd));
        }
        if (resolution.hd.buffer[0] <= 854 && resolution.hd.buffer[1] <= 480) {
            problems.push("the HD preset did not raise the buffer: " + JSON.stringify(resolution.hd.buffer));
        }
        if (resolution.hd.buffer[0] > 1280 || resolution.hd.buffer[1] > 720) {
            problems.push("the HD buffer exceeds its preset: " + JSON.stringify(resolution.hd.buffer));
        }
        if (resolution.back.value !== "default" || resolution.back.storedCap !== null) {
            problems.push("Default did not clear the persisted cap: " + JSON.stringify(resolution.back));
        }
        if (resolution.back.buffer[0] > 854 || resolution.back.buffer[1] > 480) {
            problems.push("Default did not return to SD: " + JSON.stringify(resolution.back.buffer));
        }
    }

    // ── share: the copied URL carries values, resolution and quality ──
    const shareLink = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /Plasma/i.test(title.textContent);
        });
        if (!block) return null;
        block.scrollIntoView({ block: "center" });
        await sleep(400);
        window.isfFooterAction(block, "share");
        await sleep(450);
        return window.__copied;
    });
    if (!shareLink) {
        problems.push("the inspector share action did not copy a fullscreen URL");
    } else {
        const shared = new URL(shareLink);
        if (shared.searchParams.get("isf-fullscreen") !== "1") problems.push("the share URL is not fullscreen");
        if (shared.searchParams.get("isf-res") !== "sd") problems.push("the share URL lost the resolution: " + shared.searchParams.get("isf-res"));
        if (shared.searchParams.get("isf-quality") !== "auto") problems.push("the share URL lost the quality: " + shared.searchParams.get("isf-quality"));
        if (!shared.searchParams.get("isf-values")) problems.push("the share URL lost the parameter payload");
        if (!shared.searchParams.get("isf-shader")) problems.push("the share URL lost the shader");
    }
    const shareToast = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const find = () => Array.from(document.querySelectorAll(".isf-pui-toasts .pui-toast"))
            .find((toast) => /OBS link copied/i.test(toast.textContent));
        let toast = find();
        for (let i = 0; i < 30 && !toast; i += 1) {
            await sleep(50);
            toast = find();
        }
        if (!toast) return null;
        const record = {role: toast.getAttribute("role"), text: toast.textContent};
        const close = toast.querySelector(".pui-toast-close");
        if (close) close.click();
        await sleep(250);
        record.gone = !find();
        return record;
    });
    if (!shareToast || shareToast.role !== "status" || !/OBS link copied/i.test(shareToast.text) || !shareToast.gone) {
        problems.push("the share action did not use the PUI toast stack: " + JSON.stringify(shareToast));
    }

    // ── persistence: a resolution choice survives a reload ──
    await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /Plasma/i.test(title.textContent);
        });
        if (!block) return;
        window.isfOpenInspector(block, "params");
        await sleep(400);
        const select = block.querySelector('select[aria-label="Render resolution"]');
        if (select) {
            select.value = "hd";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await sleep(500);
    });
    await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".isf-block").length >= 12, { timeout: 30000, polling: 100 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const persisted = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector('.isf-header [data-pui-item="title"]');
            return title && /Plasma/i.test(title.textContent);
        });
        if (!block) return null;
        block.scrollIntoView({ block: "center" });
        await sleep(700);
        window.isfOpenInspector(block, "params");
        await sleep(500);
        const select = block.querySelector('select[aria-label="Render resolution"]');
        const value = select ? select.value : null;
        if (select) {
            select.value = "default";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await sleep(400);
        return { value: value, storedCap: JSON.parse(localStorage.getItem("docsify-isf:layout") || "{}").resolutionCap || null };
    });
    if (!persisted || persisted.value !== "hd") {
        problems.push("the resolution choice did not survive a reload: " + JSON.stringify(persisted));
    }
    if (persisted && persisted.storedCap !== null) {
        problems.push("resetting to Default did not clear the stored cap: " + JSON.stringify(persisted));
    }

    // ── share: the OBS URL mounts a bare fullscreen viewer with values ──
    const shaderUrl = url + "samples/plasma.fs";
    const encodeValues = (values) => Buffer.from(JSON.stringify(values)).toString("base64")
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const obsBase = url + "?isf-shader=" + encodeURIComponent(shaderUrl) + "&isf-fullscreen=1";
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await page.goto(obsBase, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(1800);
    const obsDefault = await page.evaluate(() => {
        const block = document.querySelector(".isf-block.isf-bare");
        if (!block) return null;
        const rect = block.getBoundingClientRect();
        const canvas = block.querySelector(".isf-canvas");
        const canvasRect = canvas ? canvas.getBoundingClientRect() : { width: 0, height: 0 };
        return {
            fills: Math.abs(rect.width - window.innerWidth) < 4 && Math.abs(rect.height - window.innerHeight) < 4,
            headerHidden: getComputedStyle(block.querySelector(".isf-header")).display === "none",
            statusHidden: getComputedStyle(block.querySelector(".isf-status")).display === "none",
            canvas: canvas ? canvas.width : 0,
            canvasHeight: canvas ? canvas.height : 0,
            canvasAspect: canvas && canvasRect.height ? canvas.width / canvas.height : 0,
            cssAspect: canvasRect.height ? canvasRect.width / canvasRect.height : 0,
            status: block.querySelector(".isf-status").textContent,
            overlayVisible: block.querySelector(".isf-overlay").style.display !== "none"
        };
    });
    if (!obsDefault || !obsDefault.fills || !obsDefault.headerHidden || !obsDefault.statusHidden ||
        !obsDefault.canvas || /error/i.test(obsDefault.status) || obsDefault.overlayVisible) {
        problems.push("the OBS fullscreen URL did not mount a bare viewer: " + JSON.stringify(obsDefault));
    }
    if (obsDefault && (obsDefault.canvas > 854 || obsDefault.canvasHeight > 480)) {
        problems.push("the OBS default buffer exceeds SD: " + obsDefault.canvas + "x" + obsDefault.canvasHeight);
    }
    if (obsDefault && Math.abs(obsDefault.canvasAspect - obsDefault.cssAspect) > 0.03) {
        problems.push("the OBS buffer does not preserve the viewport aspect: " + JSON.stringify(obsDefault));
    }
    const obsValues = obsBase + "&isf-res=hd&isf-values=" + encodeValues({ [shaderUrl]: { speed: 1.9, scale: 12 } });
    await page.goto(obsValues, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(1800);
    const obsParameterized = await page.evaluate(() => {
        const block = document.querySelector(".isf-block.isf-bare");
        const row = block && block.querySelector('[data-isf-param="speed"]');
        const range = row && row.querySelector('input[type="range"]');
        const canvas = block && block.querySelector(".isf-canvas");
        return {
            speed: range ? Number(range.value) : null,
            width: canvas ? canvas.width : 0,
            height: canvas ? canvas.height : 0
        };
    });
    if (obsParameterized.speed === null || Math.abs(obsParameterized.speed - 1.9) > 0.05) {
        problems.push("the OBS URL did not apply the encoded parameters: " + JSON.stringify(obsParameterized));
    }
    if (obsParameterized.width <= 854 && obsParameterized.height <= 480) {
        problems.push("the OBS URL did not apply isf-res=hd: " + JSON.stringify(obsParameterized));
    }
    if (obsParameterized.width > 1280 || obsParameterized.height > 720) {
        problems.push("the OBS HD buffer exceeds its preset: " + JSON.stringify(obsParameterized));
    }

    // The shared viewer hides every control by default but keeps the full
    // editing experience one gesture away, and can be hidden back.
    const obsReveal = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const block = document.querySelector(".isf-block.isf-bare");
        const header = block.querySelector(".isf-header");
        const reveal = block.querySelector(".isf-reveal-btn");
        const headerHidden = getComputedStyle(header).display === "none";
        reveal.click();
        await sleep(300);
        const revealed = block.classList.contains("isf-revealed") && getComputedStyle(header).display !== "none";
        window.isfOpenInspector(block, "editor");
        await sleep(400);
        const panel = window.isfEditorPanel(block);
        const editorOpen = !!panel && !panel.hidden && getComputedStyle(panel).display !== "none";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(300);
        const hiddenAgain = getComputedStyle(header).display === "none";
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
        await sleep(300);
        const keyboardReveal = getComputedStyle(header).display !== "none";
        const more = block.querySelector('.isf-header [data-pui-item="more"]');
        if (more) more.click();
        window.isfFooterAction(block, "reset");
        await sleep(400);
        const speedRow = block.querySelector('[data-isf-param="speed"]');
        const speedRange = speedRow && speedRow.querySelector('input[type="range"]');
        const resetSpeed = speedRange ? Number(speedRange.value) : null;
        return {
            headerHidden: headerHidden, revealed: revealed, editorOpen: editorOpen,
            hiddenAgain: hiddenAgain, keyboardReveal: keyboardReveal, resetSpeed: resetSpeed
        };
    });
    if (!obsReveal.headerHidden || !obsReveal.revealed || !obsReveal.editorOpen ||
        !obsReveal.hiddenAgain || !obsReveal.keyboardReveal) {
        problems.push("the shared viewer's hidden controls did not reveal/hide: " + JSON.stringify(obsReveal));
    }
    if (obsReveal.resetSpeed === null || Math.abs(obsReveal.resetSpeed - 0.4) > 0.05) {
        problems.push("the shared viewer did not return to the shader defaults: " + JSON.stringify(obsReveal));
    }
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(600);

    if (consoleErrors.length) {
        problems.push("console errors:\n    " + consoleErrors.join("\n    "));
    }
} finally {
    await browser.close();
    server.close();
}

if (problems.length) {
    console.log("\nbrowser-smoke: " + problems.length + " problem(s)");
    for (const problem of problems) console.log("  - " + problem);
    process.exit(1);
}
console.log("\nbrowser-smoke: ok");
