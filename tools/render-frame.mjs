#!/usr/bin/env node
/* ============================================================================
 * tools/render-frame.mjs — headless deterministic frames for ISF materials
 *
 *   node tools/render-frame.mjs [options] [file.fs ...]
 *
 * Renders one or more ISF files with the docsify-isf browser renderer in a
 * headless Chrome (software WebGL), at a frozen time/size/inputs, and writes
 * PNGs plus a JSON report. It is the browser-side counterpart of the project's
 * OBS capture sweep (`scripts/library-capture.mjs`): the same 320x180 @ t=1.5
 * defaults, so frames can be diffed against `_cover.png` or against another
 * renderer for reliability comparisons.
 *
 * Options
 *   --file FILE.fs          a material to render (repeatable; positional works)
 *   --slug NAME             resolve a bundled material by directory name
 *   --kind K                generator|filter|transition|all (with --slug or
 *                           as a sweep when no file/slug is given)
 *   --limit N               stop after N sweep materials
 *   --out FILE.png          output path (single target)
 *   --out-dir DIR           output directory (default ./frames)
 *   --report FILE           write the JSON report
 *   --json                  print the JSON report instead of the summary
 *   --quiet                 only print errors
 *   --dry-run               render + compare, write nothing
 *   --time T                frozen material time in seconds (default 1.5)
 *   --steps N               virtual steps from 0 to T (default 1; use ~60 for
 *                           feedback/multi-pass shaders)
 *   --size WxH              render size (default 320x180)
 *   --input name=value      set an input (repeatable; JSON values allowed)
 *   --inputs '{"a":1}'      input map as JSON
 *   --parent MATERIAL       parent frame bound to the filter's image input
 *                           (slug or .fs; rendered once and reused)
 *   --image name=PATH       bind an image input from a file (repeatable)
 *   --date ISO|now          frozen DATE (default 2020-01-01T00:00:00Z)
 *   --include DIR           extra include search dir (repeatable)
 *   --compare REF.png       diff the frame against a reference PNG
 *   --compare-dir DIR       diff each sweep frame against DIR/<slug>.png
  --compare-cover         diff each material against the _cover.png next to it
                           (the OBS capture sweep's reference)
  --cover                 replay the OBS capture conditions from _covers.json
                           (time, parameters, parent image) and compare against
                           _cover.png — the one-flag reliability diff
 *   --threshold N           per-channel diff that counts as changed (default 2)
 *   --max-mae N             strict threshold (default 2)
 *   --strict                exit 1 when a MAE exceeds --max-mae
 *   --timeout MS            per-frame compile/render timeout (default 30000)
 *   --chrome PATH           Chrome/Chromium binary (or CHROME_PATH)
 *
 * Exit status: 1 when a material fails to render, or when --strict is set and
 * a comparison exceeds --max-mae (or the sizes differ).
 * ==========================================================================*/

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, "..");
const PARENT_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");
const SHARED_GLSL = path.join("modules", "src", "isf-source", "isf", "glsl");
// Inside obs-lua-projection-mapping the parent root also serves the bundled
// library and the shared GLSL ports; standalone it is just this repo.
const WEB_ROOT = fs.existsSync(path.join(PARENT_ROOT, SHARED_GLSL)) ? PARENT_ROOT : PLUGIN_ROOT;
const HOST_FILE = path.join(PLUGIN_ROOT, "tools", "frame-host.html");

// The plugin resolves a leading-slash includePath against the document base,
// exactly like the Docsify site (whose pages are served from the site root).
// The CLI serves frame-host.html from the web root for this reason.
function toIncludePath(dir) {
    const absolute = path.resolve(dir);
    if (!fs.existsSync(absolute)) return null;
    const relative = path.relative(WEB_ROOT, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return "/" + relative.split(path.sep).join("/") + "/";
}

const INCLUDE_PATHS = [toIncludePath(path.join(PARENT_ROOT, SHARED_GLSL))].filter(Boolean);

// The plugin's parser gives Node the input types needed to replay capture
// parameters (colours are packed OBS integers in the cover sidecar).
const require = createRequire(import.meta.url);
const isf = require(path.join(PLUGIN_ROOT, "docsify-isf.js"));

const LIBRARIES = {
    generator: "modules/src/isf-source/library",
    filter: "modules/fx/isf-filter/library",
    transition: "modules/src/isf-transition/library"
};

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".fs": "text/plain; charset=utf-8",
    ".vs": "text/plain; charset=utf-8",
    ".glsl": "text/plain; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac"
};

const IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp"
};

const logo = (message) => process.stdout.write(message + "\n");

function parseArgs(argv) {
    const opts = {
        files: [], inputs: {}, images: {}, includes: [],
        kind: null, slug: null, limit: 0,
        out: null, outDir: path.resolve(process.cwd(), "frames"), report: null,
        json: false, quiet: false, dryRun: false,
        width: 320, height: 180, time: 1.5, steps: 1,
        date: "2020-01-01T00:00:00Z",
        parent: null, compare: null, compareDir: null, compareCover: false, cover: false,
        threshold: 2, maxMae: 2, strict: false,
        timeout: 30000, chrome: process.env.CHROME_PATH || null
    };
    let sawInputs = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (next === undefined) throw new Error(arg + " needs a value");
            return next;
        };
        if (arg === "--file" || arg === "-f") opts.files.push(value());
        else if (arg === "--slug") opts.slug = value();
        else if (arg === "--kind") opts.kind = value();
        else if (arg === "--limit") opts.limit = parseInt(value(), 10) || 0;
        else if (arg === "--out") opts.out = value();
        else if (arg === "--out-dir") opts.outDir = path.resolve(value());
        else if (arg === "--report") opts.report = value();
        else if (arg === "--json") opts.json = true;
        else if (arg === "--quiet") opts.quiet = true;
        else if (arg === "--dry-run") opts.dryRun = true;
        else if (arg === "--time") { opts.time = Number(value()); opts.timeExplicit = true; }
        else if (arg === "--steps") opts.steps = Math.max(1, parseInt(value(), 10) || 1);
        else if (arg === "--size") {
            const [w, h] = value().split("x").map(Number);
            if (!w || !h) throw new Error("--size expects WxH");
            opts.width = w;
            opts.height = h;
        } else if (arg === "--input") {
            const pair = value();
            const index = pair.indexOf("=");
            if (index < 1) throw new Error("--input expects name=value");
            opts.inputs[pair.slice(0, index)] = parseValue(pair.slice(index + 1));
        } else if (arg === "--inputs") {
            sawInputs = true;
            const parsed = JSON.parse(value());
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--inputs expects a JSON object");
            Object.assign(opts.inputs, parsed);
        } else if (arg === "--image") {
            const pair = value();
            const index = pair.indexOf("=");
            if (index < 1) throw new Error("--image expects name=path");
            opts.images[pair.slice(0, index)] = path.resolve(pair.slice(index + 1));
        } else if (arg === "--parent") { opts.parent = value(); opts.parentExplicit = true; }
        else if (arg === "--date") opts.date = value();
        else if (arg === "--include") opts.includes.push(value());
        else if (arg === "--compare") opts.compare = path.resolve(value());
        else if (arg === "--compare-dir") opts.compareDir = path.resolve(value());
        else if (arg === "--compare-cover") opts.compareCover = true;
        else if (arg === "--cover") opts.cover = true;
        else if (arg === "--threshold") opts.threshold = Number(value());
        else if (arg === "--max-mae") opts.maxMae = Number(value());
        else if (arg === "--strict") opts.strict = true;
        else if (arg === "--timeout") opts.timeout = parseInt(value(), 10) || 30000;
        else if (arg === "--chrome") opts.chrome = value();
        else if (arg === "--help" || arg === "-h") {
            opts.help = true;
        } else if (arg.startsWith("--")) {
            throw new Error("unknown option " + arg);
        } else {
            opts.files.push(arg);
        }
    }
    if (sawInputs) opts.hasInputs = true;
    if (opts.out && opts.files.length + (opts.slug ? 1 : 0) > 1) throw new Error("--out is only valid for a single target");
    if (opts.compare && opts.compareDir) throw new Error("use either --compare or --compare-dir");
    if (opts.compare && (opts.files.length + (opts.slug ? 1 : 0) > 1 || (!opts.files.length && !opts.slug))) {
        throw new Error("--compare is only valid for a single target; use --compare-dir for sweeps");
    }
    return opts;
}

/**
 * The capture sweep stores its parameters under Lua control names
 * (`p_<hash>_<input>`, point2D split into `_x`/`_y`); translate them back so a
 * comparison is not silently run with defaults. Colours are packed OBS ABGR
 * integers (`0xFF30C0FF`), unpacked for the shader.
 */
function captureParams(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        const name = (key.match(/^p_[0-9a-f]+_(.+)$/i) || [null, key])[1];
        const xy = /^(.+)_([xy])$/.exec(name);
        if (xy) {
            const current = out[xy[1]];
            const pair = Array.isArray(current) ? current : [0, 0];
            pair[xy[2] === "x" ? 0 : 1] = value;
            out[xy[1]] = pair;
        } else {
            out[name] = value;
        }
    }
    return out;
}

function unpackColours(params, parsed) {
    const byName = new Map(((parsed.metadata && parsed.metadata.INPUTS) || []).map((input) => [input.NAME || input.name, input]));
    const out = Object.assign({}, params);
    for (const [name, value] of Object.entries(out)) {
        const input = byName.get(name);
        const type = input && String(input.TYPE || "").toLowerCase();
        if (type === "color" && typeof value === "number") {
            out[name] = [value & 255, (value >> 8) & 255, (value >> 16) & 255, (value >>> 24) & 255].map((v) => v / 255);
        }
    }
    return out;
}

/** The `_covers.json` record for a material, or null. */
function findCoverRecord(file) {
    let dir = path.dirname(file);
    for (let depth = 0; depth < 5; depth++) {
        const sidecar = path.join(dir, "_covers.json");
        if (fs.existsSync(sidecar)) {
            try {
                const doc = JSON.parse(fs.readFileSync(sidecar, "utf8"));
                const record = (doc.covers || {})[slugOf(file)];
                if (record) return record;
            } catch (err) { /* fall through to capture params */ }
        }
        const captureFile = path.join(dir, "_capture_params.json");
        if (fs.existsSync(captureFile)) {
            try {
                const doc = JSON.parse(fs.readFileSync(captureFile, "utf8"));
                const params = (doc.params || {})[slugOf(file)];
                if (params) return { params };
            } catch (err) { /* ignore */ }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/** IMPORTED textures resolved next to the material, as data URLs. */
function importImages(parsed, materialFile) {
    const out = {};
    const imported = (parsed.metadata && parsed.metadata.IMPORTED) || null;
    if (!imported) return out;
    const specs = Array.isArray(imported)
        ? imported.map((entry) => ({ name: entry.NAME || entry.name, path: entry.PATH || entry.path }))
        : Object.keys(imported).map((name) => ({ name, path: imported[name] }));
    const dir = path.dirname(materialFile);
    for (const spec of specs) {
        if (!spec.name || !spec.path) continue;
        const file = path.join(dir, spec.path);
        if (!fs.existsSync(file)) continue;
        const mime = IMAGE_MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
        out[spec.name] = "data:" + mime + ";base64," + fs.readFileSync(file).toString("base64");
    }
    return out;
}

function parseValue(text) {
    const trimmed = String(text).trim();
    if (/^(true|false)$/i.test(trimmed)) return /^true$/i.test(trimmed);
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) return Number(trimmed);
    if (/^\[.*\]$/.test(trimmed) || /^\{.*\}$/.test(trimmed)) {
        try { return JSON.parse(trimmed); } catch (err) { return text; }
    }
    const unquoted = /^"(.*)"$/.exec(trimmed);
    return unquoted ? unquoted[1] : text;
}

function slugOf(file) {
    return path.basename(file).replace(/\.fs$/i, "");
}

function findMaterial(slug, kind) {
    const kinds = kind && kind !== "all" && LIBRARIES[kind] ? [kind] : Object.keys(LIBRARIES);
    for (const candidate of kinds) {
        const dir = path.join(WEB_ROOT, LIBRARIES[candidate], slug);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const expected = path.join(dir, slug + ".fs");
        if (fs.existsSync(expected)) return { file: expected, slug, kind: candidate };
        const fsFiles = fs.readdirSync(dir).filter((name) => /\.fs$/i.test(name));
        if (fsFiles.length) return { file: path.join(dir, fsFiles[0]), slug, kind: candidate };
    }
    return null;
}

function sweepTargets(kind, limit) {
    const kinds = kind && kind !== "all" && LIBRARIES[kind] ? [kind] : Object.keys(LIBRARIES);
    const targets = [];
    for (const candidate of kinds) {
        const dir = path.join(WEB_ROOT, LIBRARIES[candidate]);
        if (!fs.existsSync(dir)) continue;
        const slugs = fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isDirectory());
        slugs.sort();
        for (const slug of slugs) {
            const material = findMaterial(slug, candidate);
            if (material) targets.push(material);
            if (limit && targets.length >= limit) return targets;
        }
    }
    return targets;
}

function collectTargets(opts) {
    const targets = [];
    for (const file of opts.files) {
        const resolved = path.resolve(file);
        if (!fs.existsSync(resolved)) throw new Error("no such material: " + file);
        targets.push({ file: resolved, slug: slugOf(resolved), kind: opts.kind && opts.kind !== "all" ? opts.kind : null });
    }
    if (opts.slug) {
        const material = findMaterial(opts.slug, opts.kind);
        if (!material) throw new Error("no bundled material named " + opts.slug);
        targets.push(material);
    }
    if (!targets.length) targets.push(...sweepTargets(opts.kind, opts.limit));
    const seen = new Set();
    return targets.filter((target) => {
        if (seen.has(target.file)) return false;
        seen.add(target.file);
        return true;
    });
}

function urlOf(file) {
    const relative = path.relative(WEB_ROOT, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(file + " is outside " + WEB_ROOT + " (pass files from the served tree)");
    }
    return "/" + relative.split(path.sep).join("/");
}

function readImageOption(file) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error("no such image: " + file);
    const mime = IMAGE_MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    return "data:" + mime + ";base64," + fs.readFileSync(resolved).toString("base64");
}

function chromeCandidates() {
    return [
        process.env.CHROME_PATH,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser"
    ].filter(Boolean);
}

function findChrome(explicit) {
    const candidates = explicit ? [explicit].concat(chromeCandidates()) : chromeCandidates();
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

const PLUGIN_PATH = "/" + path.relative(WEB_ROOT, path.join(PLUGIN_ROOT, "docsify-isf.js")).split(path.sep).join("/");

function createStaticServer(root) {
    const server = http.createServer((request, response) => {
        try {
            const url = new URL(request.url, "http://127.0.0.1");
            let pathname = decodeURIComponent(url.pathname);
            if (pathname === "/frame-host.html") {
                // Served from the web root so that site-absolute includePaths
                // resolve against the server root, like they do on the site.
                const html = fs.readFileSync(HOST_FILE, "utf8").replace('src="../docsify-isf.js"', 'src="' + PLUGIN_PATH + '"');
                response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
                response.end(html);
                return;
            }
            if (pathname === "/") pathname = "/index.html";
            const file = path.normalize(path.join(root, pathname));
            if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                response.writeHead(404, { "content-type": "text/plain" });
                response.end("not found");
                return;
            }
            response.writeHead(200, {
                "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
                "cache-control": "no-store"
            });
            fs.createReadStream(file).pipe(response);
        } catch (err) {
            response.writeHead(500, { "content-type": "text/plain" });
            response.end(String(err && err.message || err));
        }
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * Open one headless Chrome + static server and keep it for many frames.
 * Call session.close() when done.
 */
export async function createRenderSession(options = {}) {
    const chrome = findChrome(options.chrome);
    if (!chrome) throw new Error("Chrome/Chromium not found (set CHROME_PATH or --chrome)");
    const server = await createStaticServer(WEB_ROOT);
    const port = server.address().port;
    const hostUrl = "http://127.0.0.1:" + port + "/frame-host.html";
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--hide-scrollbars",
            "--mute-audio",
            "--enable-unsafe-swiftshader",
            "--use-angle=swiftshader",
            "--force-device-scale-factor=1"
        ]
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 400, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(hostUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeout || 60000 });
    await page.waitForFunction("window.DocsifyISF && typeof window.DocsifyISF.renderFrame === 'function'", { timeout: 30000 });

    async function render(task) {
        const frame = await page.evaluate((payload) => window.DocsifyISF.renderFrame(payload), task);
        const base64 = frame.dataUrl.slice(frame.dataUrl.indexOf(",") + 1);
        const png = Buffer.from(base64, "base64");
        return {
            png,
            width: frame.width,
            height: frame.height,
            mode: frame.mode,
            time: frame.time,
            steps: frame.steps,
            inputs: frame.inputs,
            warnings: frame.warnings || []
        };
    }

    async function compare(first, second, compareOptions) {
        return page.evaluate((payload) => window.DocsifyISF.compareFrames(payload.a, payload.b, payload.options), {
            a: first,
            b: second,
            options: compareOptions || {}
        });
    }

    return {
        baseUrl: "http://127.0.0.1:" + port,
        render,
        compare,
        page,
        pageErrors,
        close: async () => {
            try { await browser.close(); } finally { server.close(); }
        }
    };
}

/**
 * Render targets with one session (created here unless supplied) and write the
 * frames + report. Returns the report object.
 */
export async function renderFrames(options = {}) {
    const opts = Object.assign({
        width: 320, height: 180, time: 1.5, steps: 1,
        date: "2020-01-01T00:00:00Z",
        inputs: {}, images: {}, includes: [],
        threshold: 2, maxMae: 2, strict: false,
        dryRun: false, quiet: true
    }, options);
    const ownsSession = !opts.session;
    const session = opts.session || await createRenderSession({ chrome: opts.chrome, navigationTimeout: opts.timeout });
    const entries = [];
    let failed = 0;
    let worstMae = 0;
    try {
        const includePaths = INCLUDE_PATHS.concat((opts.includes || []).map((dir) => {
            const includePath = toIncludePath(dir);
            if (!includePath) throw new Error("--include " + dir + " does not exist");
            return includePath;
        }));
        const images = {};
        for (const name of Object.keys(opts.images || {})) images[name] = readImageOption(opts.images[name]);
        const baseRender = {
            width: opts.width,
            height: opts.height,
            time: opts.time,
            steps: opts.steps,
            date: opts.date,
            inputs: opts.inputs || {},
            images,
            includePaths,
            timeout: opts.timeout
        };
        const parentCache = {};
        async function renderParentFrame(slug, renderOptions) {
            const key = slug + "@" + renderOptions.time + "/" + renderOptions.width + "x" + renderOptions.height + "/" + renderOptions.steps;
            if (!parentCache[key]) {
                const material = slug.endsWith(".fs")
                    ? { file: path.resolve(slug), slug: slugOf(slug) }
                    : findMaterial(slug, "generator") || findMaterial(slug, null);
                if (!material) throw new Error("parent material not found: " + slug);
                const parent = await session.render(Object.assign({}, renderOptions, { url: session.baseUrl + urlOf(material.file) }));
                parentCache[key] = "data:image/png;base64," + parent.png.toString("base64");
            }
            return parentCache[key];
        }
        let explicitParentFrame = opts.parentFrame || null;
        if (opts.parent) explicitParentFrame = await renderParentFrame(opts.parent, baseRender);
        for (const target of opts.targets) {
            const started = Date.now();
            const entry = {
                slug: target.slug,
                file: target.file,
                url: urlOf(target.file),
                kind: target.kind || null
            };
            try {
                // Per-material render options: the cover sidecar records the
                // time/parameters/parent the OBS capture used, so replaying it
                // isolates renderer differences from capture differences.
                const task = Object.assign({}, baseRender, { inputs: Object.assign({}, baseRender.inputs), images: Object.assign({}, baseRender.images) });
                let compareRef = null;
                if (opts.cover) {
                    const record = findCoverRecord(target.file);
                    const source = fs.readFileSync(target.file, "utf8");
                    const parsed = isf.parseISF(source);
                    if (!opts.timeExplicit && record && Number.isFinite(Number(record.time))) task.time = Number(record.time);
                    if (record && record.params) {
                        const replay = unpackColours(captureParams(record.params), parsed);
                        task.inputs = Object.assign(replay, task.inputs);
                    }
                    if (target.kind === "transition" && task.inputs.progress == null) task.inputs.progress = 0.5;
                    for (const [name, source64] of Object.entries(importImages(parsed, target.file))) {
                        if (!task.images[name]) task.images[name] = source64;
                    }
                    const hasImage = ((parsed.metadata && parsed.metadata.INPUTS) || []).some((input) => String(input.TYPE || "").toLowerCase() === "image");
                    const parentSlug = opts.parentExplicit ? null : (record && record.parent && hasImage ? record.parent : null);
                    if (parentSlug) task.parentFrame = await renderParentFrame(parentSlug, task);
                    else if (explicitParentFrame) task.parentFrame = explicitParentFrame;
                    const cover = path.join(path.dirname(target.file), "_cover.png");
                    if (fs.existsSync(cover)) compareRef = cover;
                } else if (explicitParentFrame) {
                    task.parentFrame = explicitParentFrame;
                }
                const frame = await session.render(Object.assign({}, task, {
                    url: session.baseUrl + entry.url
                }));
                entry.width = frame.width;
                entry.height = frame.height;
                entry.mode = frame.mode;
                entry.time = frame.time;
                entry.steps = frame.steps;
                entry.inputs = frame.inputs;
                entry.warnings = frame.warnings;
                entry.sha256 = crypto.createHash("sha256").update(frame.png).digest("hex");
                entry.bytes = frame.png.length;
                entry.renderMs = Date.now() - started;
                let reference = compareRef;
                if (opts.compare) reference = opts.compare;
                else if (opts.compareDir) {
                    const candidate = path.join(opts.compareDir, target.slug + ".png");
                    if (fs.existsSync(candidate)) reference = candidate;
                } else if (opts.compareCover) {
                    const candidate = path.join(path.dirname(target.file), "_cover.png");
                    if (fs.existsSync(candidate)) reference = candidate;
                }
                if (reference) {
                    entry.compare = await session.compare(
                        "data:image/png;base64," + frame.png.toString("base64"),
                        "data:image/png;base64," + fs.readFileSync(reference).toString("base64"),
                        { threshold: opts.threshold }
                    );
                    entry.compare.reference = reference;
                    if (entry.compare.mae !== null && entry.compare.mae > worstMae) worstMae = entry.compare.mae;
                }
                if (!opts.dryRun) {
                    const outPath = opts.out || path.join(opts.outDir, target.slug + ".png");
                    fs.mkdirSync(path.dirname(outPath), { recursive: true });
                    fs.writeFileSync(outPath, frame.png);
                    entry.png = outPath;
                }
                if (!opts.quiet) {
                    let line = "  " + entry.slug.padEnd(28) + entry.width + "x" + entry.height +
                        "  " + entry.mode + "  " + entry.renderMs + "ms  sha " + entry.sha256.slice(0, 12);
                    if (entry.compare) {
                        line += entry.compare.mae === null
                            ? "  mae=size-mismatch"
                            : "  mae=" + entry.compare.mae.toFixed(2) + (entry.compare.identical ? " (identical)" : "");
                    }
                    logo(line);
                }
            } catch (error) {
                failed++;
                entry.error = String(error && error.message || error);
                if (!opts.quiet) logo("  " + entry.slug.padEnd(28) + "FAILED: " + entry.error);
            }
            entries.push(entry);
        }
        const strictFailures = opts.strict
            ? entries.filter((entry) => entry.compare && (entry.compare.mae === null || entry.compare.mae > opts.maxMae))
            : [];
        const report = {
            generatedAt: new Date().toISOString(),
            renderer: "docsify-isf",
            webRoot: WEB_ROOT,
            options: {
                width: opts.width,
                height: opts.height,
                time: opts.time,
                steps: opts.steps,
                date: opts.date,
                includePaths,
                parent: opts.parent || null,
                threshold: opts.threshold
            },
            entries,
            summary: {
                rendered: entries.length - failed,
                failed,
                strictFailures: strictFailures.length,
                maxMae: worstMae,
                strict: !!opts.strict,
                maxMaeAllowed: opts.maxMae
            }
        };
        if (ownsSession) await session.close();
        report.exitCode = failed || strictFailures.length ? 1 : 0;
        return report;
    } catch (error) {
        if (ownsSession) await session.close();
        throw error;
    }
}

function usage() {
    logo("usage: node tools/render-frame.mjs [options] [file.fs ...]");
    logo("       node tools/render-frame.mjs --kind generator --limit 10 --out-dir frames");
    logo("       node tools/render-frame.mjs samples/plasma.fs --input speed=0.2 --report report.json");
    logo("run --help for the option list");
}

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (error) {
        logo("render-frame: " + error.message);
        process.exit(2);
    }
    if (opts.help || (!opts.files.length && !opts.slug && !opts.kind)) {
        usage();
        process.exit(opts.help ? 0 : 2);
    }
    let targets;
    try {
        targets = collectTargets(opts);
    } catch (error) {
        logo("render-frame: " + error.message);
        process.exit(2);
    }
    if (!targets.length) {
        logo("render-frame: no materials to render (is the bundled library checked out?)");
        process.exit(2);
    }
    if (!opts.quiet) {
        logo("render-frame: " + targets.length + " material(s), " + opts.width + "x" + opts.height +
            " @ t=" + opts.time + "s" + (opts.steps > 1 ? " (" + opts.steps + " steps)" : "") +
            (opts.parent ? ", parent " + opts.parent : ""));
    }
    let report;
    try {
        report = await renderFrames(Object.assign({}, opts, {
            targets,
            quiet: opts.quiet,
            // creating the session once and reusing it keeps sweeps fast
            session: undefined
        }));
    } catch (error) {
        logo("render-frame: " + error.message);
        process.exit(1);
    }
    if (opts.report) {
        fs.mkdirSync(path.dirname(path.resolve(opts.report)), { recursive: true });
        fs.writeFileSync(path.resolve(opts.report), JSON.stringify(report, null, 2) + "\n");
    }
    if (opts.json) logo(JSON.stringify(report, null, 2));
    else if (!opts.quiet) {
        logo(report.summary.failed
            ? "render-frame: " + report.summary.failed + " failure(s)"
            : "render-frame: ok — " + report.summary.rendered + " frame(s)" +
              (report.summary.maxMae ? ", worst MAE " + report.summary.maxMae.toFixed(2) : ""));
    }
    process.exit(report.exitCode || 0);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    main();
}
