#!/usr/bin/env node
/*
 * docsify-isf material diagnostician.
 *
 * Builds and compiles one or more bundled materials the way the viewer does
 * (includes + dialect + ES3/promotion retries) and prints, for failures, the
 * generated line and the exact compiler error.
 *
 *   node tests/diagnose.mjs /modules/src/isf-source/library/foo/foo.fs [...]
 *   node tests/diagnose.mjs foo bar          # slugs resolved under both
 *                                            # isf-source and isf-filter
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (!fs.existsSync(chrome)) {
    console.log("diagnose: no Chrome found (set CHROME_PATH).");
    process.exit(0);
}

const inputs = process.argv.slice(2);
const urls = [];
for (const input of inputs) {
    if (input.startsWith("/")) {
        urls.push(input);
        continue;
    }
    for (const base of ["/modules/src/isf-source/library/", "/modules/fx/isf-filter/library/", "/modules/src/isf-transition/library/"]) {
        if (fs.existsSync(path.join(root, base, input, input + ".fs"))) {
            urls.push(base + input + "/" + input + ".fs");
        }
    }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".glsl": "text/plain", ".fs": "text/plain" };
const server = http.createServer((request, response) => {
    let urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(root, urlPath);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404); response.end("not found"); return;
    }
    response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
});
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/docsify-plugins/docsify-isf/tests/coverage-host.html`, { waitUntil: "networkidle0", timeout: 90000 });

const results = await page.evaluate(async (paths) => {
    const includeRe = /^[ \t]*#include[ \t]+["']([^"']+)["'][ \t]*(?:\/\/[^\n]*)?$/gm;
    function collect(text) {
        const names = [];
        let match;
        const re = new RegExp(includeRe.source, "gm");
        while ((match = re.exec(text))) names.push(match[1]);
        return names;
    }
    const out = [];
    for (const url of paths) {
        const base = new URL(url, location.origin);
        const text = await (await fetch(base)).text();
        const parsed = window.DocsifyISF.parseISF(text);
        if (!parsed.valid) { out.push({ url, error: parsed.error && parsed.error.message }); continue; }
        const includes = {};
        async function load(names, baseUrl) {
            for (const name of names) {
                let response = await fetch(new URL(name, baseUrl));
                if (!response.ok) response = await fetch(new URL(name, location.origin + "/modules/src/isf-source/isf/glsl/"));
                if (!response.ok) continue;
                const includeText = await response.text();
                includes[name] = includeText;
                await load(collect(includeText), new URL(name, baseUrl));
            }
        }
        await load(collect(text), base);
        const built = window.DocsifyISF.buildShader(parsed, { includes });
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        function compile(type, source) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
            const log = ok ? "" : gl.getShaderInfoLog(shader) || "";
            gl.deleteShader(shader);
            return { ok, log };
        }
        const attempts = [
            ["es1", built.vertex, built.fragment],
            ["es3", built.vertexES3, built.fragmentES3],
            ["es3+promotion", built.vertexES3Loose, built.fragmentES3Loose]
        ];
        let status = "OK";
        let detail = "";
        let failed = false;
        for (const [label, vs, fsSrc] of attempts) {
            const vertex = compile(gl.VERTEX_SHADER, vs);
            if (!vertex.ok) { status = label + " vertex"; detail = vertex.log; failed = true; continue; }
            const fragmentShader = compile(gl.FRAGMENT_SHADER, fsSrc);
            if (!fragmentShader.ok) {
                status = label;
                detail = fragmentShader.log;
                failed = true;
                continue;
            }
            // This attempt compiled: no need to try the more permissive ones.
            failed = false;
            status = "OK" + (label === "es1" ? "" : " (" + label + ")");
            detail = "";
            break;
        }
        if (failed) {
            var errorRe = /0:(\d+):/g;
            var errorMatch;
            var printed = 0;
            var source = status.indexOf("es3") === 0 ? built.fragmentES3Loose : built.fragment;
            var sourceLines = source.split("\n");
            var extra = [];
            while ((errorMatch = errorRe.exec(detail)) && printed < 4) {
                var number = Number(errorMatch[1]);
                extra.push("    line " + number + ": " + (sourceLines[number - 1] || "").trim().slice(0, 170));
                printed++;
            }
            if (extra.length) detail += "\n" + extra.join("\n");
        }
        out.push({ url, status, detail: detail.split("\n").slice(0, 8).join("\n    ") });
    }
    return out;
}, urls);

for (const result of results) {
    console.log("\n" + result.url.split("/").slice(-2)[0] + "  [" + (result.status || "ERROR") + "]");
    if (result.error) console.log("  " + result.error);
    if (result.detail) console.log("  " + result.detail);
}

await browser.close();
server.close();
