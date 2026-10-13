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
    console.log("browser-smoke: no Chrome/Chromium found (set CHROME_PATH). Skipping.");
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
        const blocks = Array.from(document.querySelectorAll(".isf-block"));
        for (const block of blocks) {
            block.scrollIntoView({ block: "center" });
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        window.scrollTo(0, 0);
        await new Promise((resolve) => setTimeout(resolve, 400));
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
                const hasParams = block.querySelectorAll(".isf-param").length > 0;
                const hasView = !!block.querySelector(".isf-view");
                const erroring = overlayVisible && /error|could not|invalid|unexpected|redefinition|syntax/i.test(overlay.textContent);
                const statusError = status && /error/i.test(status.className);
                return hasParams || hasView || erroring || statusError;
            });
        }, { timeout: 45000, polling: 250 });
    } catch (error) {
        const stuck = await page.evaluate(() => Array.from(document.querySelectorAll(".isf-block")).map((block) => ({
            title: (block.querySelector(".isf-title") || {}).textContent,
            status: (block.querySelector(".isf-status") || {}).textContent,
            params: block.querySelectorAll(".isf-param").length
        })).filter((item) => !item.params && !/error/i.test(item.status || "")));
        problems.push("viewers never reached a terminal state: " + JSON.stringify(stuck));
    }

    const summary = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".isf-block")).map((block) => {
            const status = block.querySelector(".isf-status");
            const canvas = block.querySelector("canvas");
            const overlay = block.querySelector(".isf-overlay");
            const title = block.querySelector(".isf-title");
            const editors = block.querySelectorAll(".isf-editor");
            const badge = block.querySelector(".isf-badge");
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
                hasParams: !!block.querySelector(".isf-param"),
                hasView: !!block.querySelector(".isf-view")
            };
        });
    });

    fs.mkdirSync(path.join(here, "artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(here, "artifacts", "browser-smoke.png"), fullPage: false });

    // Capture each self-test viewer on its own for visual review.
    const blocks = await page.$$(".isf-block");
    for (const block of blocks) {
        const title = await block.evaluate((element) => {
            const node = element.querySelector(".isf-title");
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
        if (!item.canvasWidth || !item.canvasHeight) problems.push(item.title + ": canvas has no size");
        if (!item.hasContext) problems.push(item.title + ": no WebGL context");
        if (!item.hasParams && !item.hasView) problems.push(item.title + ": no controls or view row");
        if (!item.hasEditor) problems.push(item.title + ": no editor");
    }

    // Transition auto-animation: the progress control must move on its own.
    const crossfade = await page.evaluate(async () => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Crossfade/i.test(b.textContent));
        if (!block) return { missing: true };
        block.scrollIntoView({ block: "center" });
        await new Promise((resolve) => setTimeout(resolve, 600));
        const row = Array.from(block.querySelectorAll(".isf-param")).find((r) => /progress/i.test(r.dataset.isfParam || ""));
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
        const editorButton = Array.from(block.querySelectorAll(".isf-btn")).find((button) => button.title === "Source editor");
        if (editorButton) editorButton.click();
        return true;
    });
    if (!plasma) problems.push("plasma viewer not found for editor test");
    else {
        await page.waitForFunction(() => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const editor = block && block.querySelector(".isf-editor");
            return editor && !block.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed") &&
                editor.querySelectorAll(".isf-tok-isf, .isf-tok-kw, .isf-tok-type").length > 10;
        }, { timeout: 10000, polling: 100 }).catch(() => problems.push("editor did not open / highlight"));

        const editorAudit = await page.evaluate(async () => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const editor = block.querySelector(".isf-editor");
            const pos = block.querySelector(".isf-editor-pos");
            const active = block.querySelector(".isf-active-line");
            const resizeY = block.querySelector(".isf-resize-y");
            const resizeX = block.querySelector(".isf-resize-x");
            const drawer = block.querySelector(".isf-drawer-left");

            const heightBefore = editor.getBoundingClientRect().height;
            resizeY.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            const heightAfter = editor.getBoundingClientRect().height;

            const sideBefore = drawer.getBoundingClientRect().width;
            resizeX.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            const sideAfter = drawer.getBoundingClientRect().width;

            const scaleRow = Array.from(block.querySelectorAll(".isf-param")).find((row) => row.dataset.isfParam === "scale");
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
                sideBefore: sideBefore,
                sideAfter: sideAfter,
                resizeXDisplay: getComputedStyle(resizeX).display,
                scaleValue: Number(numberInput.value),
                scaleMax: Number(numberInput.max),
                layout: layout
            };
        });

        if (!/^Ln \d+, Col \d+$/.test(editorAudit.pos)) problems.push("editor caret label missing: " + JSON.stringify(editorAudit.pos));
        if (!editorAudit.activeLineVisible) problems.push("editor active-line marker not visible");
        if (!(editorAudit.heightAfter < editorAudit.heightBefore)) problems.push("editor pane did not resize: " + JSON.stringify(editorAudit));
        if (editorAudit.resizeXDisplay === "none") problems.push("side pane resizer hidden while the panel is open");
        if (!(editorAudit.sideAfter < editorAudit.sideBefore)) problems.push("drawer did not resize: " + JSON.stringify(editorAudit));
        if (editorAudit.scaleValue !== editorAudit.scaleMax) problems.push("out-of-range parameter was not clamped: " + JSON.stringify(editorAudit));
        if (!editorAudit.layout || editorAudit.layout.editorHeight == null || editorAudit.layout.leftWidth == null) {
            problems.push("pane sizes were not persisted: " + JSON.stringify(editorAudit.layout));
        }

        const plasmaBlock = (await page.$$(".isf-block"))[0];
        if (plasmaBlock) {
            await plasmaBlock.screenshot({ path: path.join(here, "artifacts", "editor.png") });
        }

        // The close button must collapse the pane again.
        const closed = await page.evaluate(async () => {
            const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
            const close = block.querySelector('.isf-editor-wrap .isf-btn[aria-label="Close editor"]');
            if (!close) return { missing: true };
            close.click();
            await new Promise((resolve) => setTimeout(resolve, 50));
            return { hidden: block.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed") };
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
        if (block.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed")) byTitle(block, "Source editor").click();
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
        if (block.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed")) byTitle(block, "Source editor").click();
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

    // View controls: pass preview, quality selector, PNG export, share link.
    const viewControls = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const plasma = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(b.textContent));
        const share = plasma.querySelector('.isf-btn[title="Copy a link with the current parameters"]');
        const quality = plasma.querySelector('select[aria-label="Render quality"]');
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
            const title = b.querySelector(".isf-title");
            return title && /Multi-pass/i.test(title.textContent);
        });
        const passSelect = multipass.querySelector('select[aria-label="Preview a render pass"]');
        const passOptions = passSelect ? Array.from(passSelect.options).map((option) => option.value) : [];
        if (passSelect) {
            passSelect.value = "halfImage";
            passSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await wait(300);
        return { share: !!share, qualityShrunk: after < before, passOptions: passOptions, exportLength: exportLength };
    });
    if (!viewControls.share) problems.push("share button missing");
    if (!viewControls.qualityShrunk) problems.push("quality selector did not resize the canvas: " + JSON.stringify(viewControls));
    if (viewControls.passOptions.indexOf("halfImage") === -1) problems.push("pass preview selector missing halfImage: " + JSON.stringify(viewControls.passOptions));
    if (viewControls.exportLength < 100) problems.push("PNG export produced no data");

    // WebGL2 / ES3 fallback: the dynamic-indexing sample must compile in
    // compatibility mode (headless Chrome has WebGL2).
    const es3 = await page.evaluate(() => {
        const block = Array.from(document.querySelectorAll(".isf-block")).find((b) => {
            const title = b.querySelector(".isf-title");
            return title && /ES3 fallback/i.test(title.textContent);
        });
        if (!block) return { missing: true };
        const status = block.querySelector(".isf-status");
        const canvas = block.querySelector("canvas");
        return { missing: false, status: status ? status.textContent : "", canvas: canvas ? canvas.width + "x" + canvas.height : "" };
    });
    if (es3.missing) problems.push("ES3 fallback sample not found");
    else if (!/Compatibility mode/.test(es3.status)) problems.push("ES3 fallback did not activate: " + JSON.stringify(es3));

    // Live controls: randomize, time scrub, Ctrl+B, shortcut overlay, drop.
    const liveControls = await page.evaluate(async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const byText = (root, text) => Array.from(root.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
        const titleOf = (block) => (block.querySelector(".isf-title") || {}).textContent || "";
        const plasma = Array.from(document.querySelectorAll(".isf-block")).find((b) => /Plasma/i.test(titleOf(b)));
        const speedValue = () => {
            const row = Array.from(plasma.querySelectorAll(".isf-param")).find((r) => r.dataset.isfParam === "speed");
            return row && row.querySelector('input[type="range"]') ? Number(row.querySelector('input[type="range"]').value) : null;
        };
        const before = speedValue();
        byText(plasma, "Randomize").click();
        await wait(250);
        const randomized = before !== speedValue();

        const timeRange = plasma.querySelector(".isf-time-row input[type=\"range\"]");
        timeRange.value = "12.5";
        timeRange.dispatchEvent(new Event("input", { bubbles: true }));
        await wait(180);
        const timeScrubbed = Number(timeRange.value) >= 12;

        const editorWrap = plasma.querySelector(".isf-editor-wrap");
        const leftDrawer = plasma.querySelector(".isf-drawer-left");
        const editorWasHidden = leftDrawer.classList.contains("isf-drawer-closed");
        plasma.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true }));
        await wait(180);
        const editorToggled = leftDrawer.classList.contains("isf-drawer-closed") !== editorWasHidden;

        const keysButton = Array.from(plasma.querySelectorAll(".isf-editor-wrap .isf-btn")).find((b) => b.textContent.trim() === "?");
        let shortcutsShown = false;
        if (keysButton) {
            keysButton.click();
            await wait(180);
            shortcutsShown = /Keyboard shortcuts/.test(plasma.querySelector(".isf-overlay").textContent);
            const close = plasma.querySelector('.isf-overlay [data-isf-overlay="close"]');
            if (close) close.click();
            await wait(100);
        }

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

    // Real interaction regression: edge tabs, slider drag, editor typing.
    await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        b.scrollIntoView({ block: "center" });
        if (!b.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed")) b.querySelector('.isf-btn[title="Source editor"]').click();
        if (!b.querySelector(".isf-drawer-right").classList.contains("isf-drawer-closed")) b.querySelector('.isf-btn[title="Parameters"]').click();
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const edgeTabBefore = await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        const left = b.querySelector(".isf-edge-tab-left");
        return { visible: !!left && !left.classList.contains("isf-hidden") };
    });
    await page.click(".isf-block .isf-edge-tab-left");
    await new Promise((resolve) => setTimeout(resolve, 350));
    const edgeTabAfter = await page.evaluate(() => {
        const b = document.querySelector(".isf-block");
        return {
            drawerOpen: !b.querySelector(".isf-drawer-left").classList.contains("isf-drawer-closed"),
            tabHidden: b.querySelector(".isf-edge-tab-left").classList.contains("isf-hidden")
        };
    });
    if (!edgeTabBefore.visible) problems.push("left edge tab missing while the drawer is closed");
    if (!edgeTabAfter.drawerOpen || !edgeTabAfter.tabHidden) problems.push("left edge tab did not toggle the code drawer");

    await page.click('.isf-block .isf-btn[title="Parameters"]');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const slider = await page.$('.isf-block .isf-param[data-isf-param="scale"] input[type="range"]');
    if (slider) {
        const box = await slider.boundingBox();
        const scaleBefore = await page.$eval('.isf-block .isf-param[data-isf-param="scale"] input[type="number"]', (el) => Number(el.value));
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
        await page.mouse.down();
        for (let step = 1; step <= 8; step++) {
            await page.mouse.move(box.x + box.width * (0.2 + 0.075 * step), box.y + box.height / 2);
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        await page.mouse.up();
        await new Promise((resolve) => setTimeout(resolve, 250));
        const scaleAfter = await page.$eval('.isf-block .isf-param[data-isf-param="scale"] input[type="number"]', (el) => Number(el.value));
        if (scaleAfter === scaleBefore) problems.push("real slider drag did not change the parameter (" + scaleBefore + " -> " + scaleAfter + ")");
    } else {
        problems.push("scale slider not found for the drag test");
    }

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
