#!/usr/bin/env node
/*
 * docsify-isf WebGL2 / GLSL ES 3.00 coverage measurement.
 *
 * Compiles every bundled ISF material twice in headless Chrome — first the
 * legacy GLSL ES 1.00 program the viewer generates, then (on failure) the
 * ES 3.00 fallback — and reports how many materials render, how many only
 * render in compatibility mode, and what still fails.
 *
 *   node tests/es3-coverage.mjs [--limit N] [--library fx|src|transition]
 *
 * Requires puppeteer-core and a Chrome/Chromium binary (same setup as
 * tests/browser-smoke.mjs). Skips with a message when either is missing.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const pluginDir = path.resolve(here, "..");

const args = process.argv.slice(2);
let limit = Infinity;
let filter = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = Number(args[++i]) || Infinity;
    else if (args[i] === "--library") filter = args[++i];
}

const libraryRoots = [
    { name: "isf-filter", dir: path.join(root, "modules", "fx", "isf-filter", "library") },
    { name: "isf-source", dir: path.join(root, "modules", "src", "isf-source", "library") },
    { name: "isf-transition", dir: path.join(root, "modules", "src", "isf-transition", "library") }
];

function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (/\.fs$/.test(entry.name)) out.push(full);
    }
    return out;
}

const materials = [];
for (const library of libraryRoots) {
    if (filter && library.name.indexOf(filter) === -1) continue;
    for (const file of walk(library.dir, [])) {
        materials.push({
            library: library.name,
            url: "/" + path.relative(root, file).split(path.sep).join("/")
        });
    }
}
const selected = materials.slice(0, limit);

let puppeteer;
try {
    puppeteer = (await import("puppeteer-core")).default;
} catch (error) {
    console.log("es3-coverage: puppeteer-core is not installed — run `npm install` first. Skipping.");
    process.exit(0);
}
function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}
const executablePath = findChrome();
if (!executablePath) {
    console.log("es3-coverage: no Chrome/Chromium found (set CHROME_PATH). Skipping.");
    process.exit(0);
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".fs": "text/plain; charset=utf-8",
    ".vs": "text/plain; charset=utf-8",
    ".png": "image/png"
};
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
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
});
const page = await browser.newPage();

// The coverage host page loads docsify-isf.js with the same includePaths the
// parent site uses, and creates no viewers.
await page.goto(origin + "/docsify-plugins/docsify-isf/tests/coverage-host.html", { waitUntil: "networkidle0", timeout: 90000 });
const hasWebGL2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
if (!hasWebGL2) {
    console.log("es3-coverage: WebGL2 is not available in this browser. Skipping.");
    await browser.close();
    server.close();
    process.exit(0);
}

console.log(`es3-coverage: ${selected.length} material(s) from ${materials.length}, compiling ES1 + ES3 …`);
const started = Date.now();
const results = await page.evaluate(async (items) => {
    // A fresh context every N materials: the software compiler accumulates
    // programs and starts reporting spurious errors after several hundred.
    let canvas = document.createElement("canvas");
    let gl = canvas.getContext("webgl2");
    let compiledCount = 0;

    function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        const log = ok ? "" : gl.getShaderInfoLog(shader) || "";
        gl.deleteShader(shader);
        return { ok, log };
    }

    function compileProgram(shader) {
        const vs = compile(gl.VERTEX_SHADER, shader.vertex);
        if (!vs.ok) return { ok: false, log: "vertex: " + vs.log };
        const fs = compile(gl.FRAGMENT_SHADER, shader.fragment);
        if (!fs.ok) return { ok: false, log: fs.log };
        return { ok: true, log: "" };
    }

    function compileES3(shader, loose) {
        const vs = compile(gl.VERTEX_SHADER, loose ? shader.vertexES3Loose : shader.vertexES3);
        if (!vs.ok) return { ok: false, log: "vertex: " + vs.log };
        const fs = compile(gl.FRAGMENT_SHADER, loose ? shader.fragmentES3Loose : shader.fragmentES3);
        if (!fs.ok) return { ok: false, log: fs.log };
        return { ok: true, log: "" };
    }

    const out = [];
    function collectIncludeNames(source) {
        const names = [];
        const re = /^[ \t]*#include[ \t]+["']([^"']+)["'][ \t]*$/gm;
        let match;
        while ((match = re.exec(source))) if (names.indexOf(match[1]) === -1) names.push(match[1]);
        return names;
    }

    // Resolve includes the way the viewer does: next to the file, then the
    // configured includePaths (the coverage host mirrors the docs site).
    const includeMap = {};
    const visited = {};
    async function loadIncludes(names, fromUrl) {
        for (const name of names) {
            if (visited[name]) continue;
            visited[name] = true;
            const config = (window.$docsify && window.$docsify.isf) || {};
            const candidates = [new URL(name, fromUrl).toString()];
            for (const base of config.includePaths || []) {
                candidates.push(new URL(base.replace(/\/?$/, "/") + name, window.location.origin).toString());
            }
            let includeText = null;
            for (const candidate of candidates) {
                try {
                    const includeResponse = await fetch(candidate);
                    if (includeResponse.ok) { includeText = await includeResponse.text(); break; }
                } catch (err) { /* try the next candidate */ }
            }
            if (includeText) {
                includeMap[name] = includeText;
                await loadIncludes(collectIncludeNames(includeText), new URL(name, fromUrl));
            }
        }
    }

    for (const item of items) {
        if (++compiledCount % 100 === 0) {
            canvas = document.createElement("canvas");
            gl = canvas.getContext("webgl2");
        }
        const response = await fetch(item.url);
        const text = await response.text();
        const parsed = window.DocsifyISF.parseISF(text);
        if (!parsed.valid) {
            out.push({ library: item.library, url: item.url, status: "parse-error", log: parsed.error && parsed.error.message });
            continue;
        }
        await loadIncludes(collectIncludeNames(text), new URL(item.url, window.location.origin));
        let built;
        try {
            built = window.DocsifyISF.buildShader(parsed, { includes: includeMap });
        } catch (error) {
            out.push({ library: item.library, url: item.url, status: "build-error", log: error.message });
            continue;
        }
        if (built.unresolved.length) {
            out.push({ library: item.library, url: item.url, status: "unresolved", log: JSON.stringify(built.unresolved[0]) });
            continue;
        }
        const es1 = compileProgram(built);
        if (es1.ok) {
            out.push({ library: item.library, url: item.url, status: "es1" });
            continue;
        }
        const es3 = compileES3(built);
        if (es3.ok) {
            out.push({ library: item.library, url: item.url, status: "es3" });
            continue;
        }
        const es3Loose = compileES3(built, true);
        if (es3Loose.ok) {
            out.push({ library: item.library, url: item.url, status: "es3-promoted" });
            continue;
        }
        out.push({
            library: item.library,
            url: item.url,
            status: "fail",
            log: (es3Loose.log || es3.log || es1.log || "unknown").split("\n")[0].slice(0, 160)
        });
    }
    return out;
}, selected);

await browser.close();
server.close();

const totals = { es1: 0, es3: 0, "es3-promoted": 0, fail: 0, "parse-error": 0, "build-error": 0, unresolved: 0 };
const perLibrary = {};
for (const result of results) {
    totals[result.status] = (totals[result.status] || 0) + 1;
    perLibrary[result.library] = perLibrary[result.library] || { es1: 0, es3: 0, "es3-promoted": 0, fail: 0, other: 0 };
    if (result.status === "es1") perLibrary[result.library].es1++;
    else if (result.status === "es3") perLibrary[result.library].es3++;
    else if (result.status === "es3-promoted") perLibrary[result.library]["es3-promoted"]++;
    else if (result.status === "fail") perLibrary[result.library].fail++;
    else perLibrary[result.library].other++;
}

console.log(`\ncompiled ${results.length} material(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  ES 1.00            : ${totals.es1}`);
console.log(`  ES 3.00 fallback   : ${totals.es3}`);
console.log(`  ES 3.00 + promotion: ${totals["es3-promoted"]}`);
console.log(`  compile failures   : ${totals.fail}`);
const other = (totals["parse-error"] || 0) + (totals["build-error"] || 0) + (totals.unresolved || 0);
if (other) console.log(`  parse/build issues : ${other}`);
console.log("\nper library:");
for (const name of Object.keys(perLibrary)) {
    const entry = perLibrary[name];
    console.log(`  ${name.padEnd(14)} es1=${entry.es1} es3=${entry.es3} promoted=${entry["es3-promoted"]} fail=${entry.fail}${entry.other ? " other=" + entry.other : ""}`);
}
const failures = results.filter((result) => result.status === "fail");
if (failures.length) {
    const patterns = {};
    for (const failure of failures) {
        const key = String(failure.log || "unknown")
            .replace(/\d+/g, "N")
            .replace(/'.*?'/g, "'X'")
            .slice(0, 90);
        if (!patterns[key]) patterns[key] = { count: 0, samples: [] };
        patterns[key].count++;
        if (patterns[key].samples.length < 3) patterns[key].samples.push(failure.url.split("/").slice(-2)[0]);
    }
    const top = Object.keys(patterns).sort((a, b) => patterns[b].count - patterns[a].count).slice(0, 10);
    console.log("\nfailure classes:");
    for (const key of top) console.log(String(patterns[key].count).padStart(5) + "  " + key + "  [" + patterns[key].samples.join(", ") + "]");

    // Which helper functions still fail to resolve?
    const overloads = {};
    for (const failure of failures) {
        const match = /no matching overloaded function found/.test(failure.log || "") && /'([A-Za-z_]\w*)'/.exec(failure.log);
        if (match) {
            if (!overloads[match[1]]) overloads[match[1]] = { count: 0, sample: failure.url };
            overloads[match[1]].count++;
        }
    }
    const overloadNames = Object.keys(overloads).sort((a, b) => overloads[b].count - overloads[a].count).slice(0, 15);
    if (overloadNames.length) {
        console.log("\nunresolved functions:");
        for (const name of overloadNames) console.log(String(overloads[name].count).padStart(5) + "  " + name + "  (" + overloads[name].sample.split("/").slice(-2)[0] + ")");
    }
    console.log("\nsample failures:");
    for (const failure of failures.slice(0, 10)) {
        console.log("  " + failure.url.split("/").slice(-2).join("/") + " — " + failure.log);
    }
    if (process.argv.indexOf("--list") !== -1) {
        console.log("\nall failures:");
        for (const failure of failures) {
            console.log(failure.url.split("/").slice(-2)[0] + " — " + String(failure.log).split("\n")[0]);
        }
    }
}
