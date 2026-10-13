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
    await page.waitForFunction(() => document.querySelectorAll(".isf-block").length >= 10, { timeout: 30000, polling: 100 });

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
                const erroring = overlayVisible && /error|could not|invalid|unexpected|redefinition|syntax/i.test(overlay.textContent);
                const statusError = status && /error/i.test(status.className);
                return hasParams || erroring || statusError;
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
                hasParams: !!block.querySelector(".isf-param")
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
        if (!item.hasParams) problems.push(item.title + ": no parameter controls");
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

    // Exercise the editor: open it on the plasma viewer and check the highlighted layer.
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
            return editor && !block.querySelector(".isf-editor-wrap").classList.contains("isf-hidden") &&
                editor.querySelectorAll(".isf-tok-isf, .isf-tok-kw, .isf-tok-type").length > 10;
        }, { timeout: 10000, polling: 100 }).catch(() => problems.push("editor did not open / highlight"));
        const plasmaBlock = (await page.$$(".isf-block"))[0];
        if (plasmaBlock) {
            await plasmaBlock.screenshot({ path: path.join(here, "artifacts", "editor.png") });
        }
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
