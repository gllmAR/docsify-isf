/*!
 * docsify-isf v1.25.0
 * Interactive Shader Format (ISF) viewer for Docsify.
 *
 * Converts markdown links to `.fs` files into interactive WebGL viewers with
 * parameter controls, a live GLSL editor and fullscreen support, while leaving
 * the original link untouched for plain markdown hosts (Codeberg/GitHub web).
 *
 * Specification: https://github.com/mrRay/ISF_Spec  (ISF 2.0)
 * Docs:          https://docs.isf.video/
 * Design:        SDD.md next to this file.
 *
 * License: MIT.
 */
(function (root, factory) {
    "use strict";
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        var api = factory();
        root.DocsifyISF = api;
        if (root.$docsify) {
            root.$docsify.plugins = (root.$docsify.plugins || []).concat(api.plugin);
        } else {
            var install = function () {
                if (root.$docsify) {
                    root.$docsify.plugins = (root.$docsify.plugins || []).concat(api.plugin);
                    return true;
                }
                return false;
            };
            if (!install()) {
                var tries = 0;
                var timer = setInterval(function () {
                    if (install() || ++tries > 200) clearInterval(timer);
                }, 10);
                if (typeof document !== "undefined") {
                    document.addEventListener("DOMContentLoaded", function () {
                        install();
                        clearInterval(timer);
                    });
                }
            }
        }
    }
})(typeof self !== "undefined" ? self : this, function () {
    "use strict";
    /* @isf-core:inject — the vendored kernel bundle and adapter are generated here by tools/build.mjs */
    /* @pupitre-ui:inject — the vendored PUI renderer, ISF adapter and CSS are generated here by tools/build.mjs */

    var VERSION = "1.25.0";
    var VIEWER_SEQ = 0;
    var SCRIPT_SRC = (typeof document !== "undefined" && document.currentScript && document.currentScript.src) || "";
    var PUI_BASE = "";
    var puiLoading = null;

    /* ==================================================================
     * Configuration
     * ================================================================== */

    // Render-buffer presets: the canvas is capped to fit these dimensions
    // while preserving the stage aspect ratio, then the browser scales it to
    // the CSS size. `native` means "CSS size × DPR" (no cap).
    var RESOLUTION_PRESETS = {
        sd: {width: 854, height: 480, label: "SD 480p"},
        hd: {width: 1280, height: 720, label: "HD 720p"},
        fhd: {width: 1920, height: 1080, label: "FHD 1080p"},
        native: null
    };
    function resolutionPreset(name) {
        var key = String(name || "").toLowerCase();
        return Object.prototype.hasOwnProperty.call(RESOLUTION_PRESETS, key) ? key : "";
    }
    function resolutionLabel(name) {
        var preset = RESOLUTION_PRESETS[resolutionPreset(name)];
        return preset ? preset.label : "Native";
    }

    var DEFAULTS = {
        enabled: true,
        extensions: ["fs"],
        mode: "replace",            // "replace" | "augment"
        lazy: "visible",            // "visible" | "click" | "none"
        width: "100%",
        height: "360px",
        aspectRatio: null,          // e.g. "16/9"
        controls: true,
        params: "auto",             // "auto" | "open" | "closed"
        paramsOpenLimit: 6,
        autoplay: true,
        loopTransition: true,
        transitionDuration: 4.0,
        resolution: "auto",             // "auto" | 2 | 1 | 0.5
        maxPixelRatio: 2,
        maxResolution: "sd",        // "sd" | "hd" | "fhd" | "native"
        maxFps: 0,                  // 0 = unlimited, otherwise cap the render loop
        includePaths: [],           // extra directories for #include "file.glsl"
        maxContexts: 8,
        editor: true,
        editorOpen: false,
        editorLive: true,
        editorDebounce: 600,
        editorIndent: 2,            // spaces per indent level; 0 = tab
        persistLayout: true,        // remember editor height / side width
        persistValues: true,        // remember parameter values per shader URL
        share: true,                // show the copy-link button
        imageUrl: null,
        vertexShader: "auto",       // "auto" | false
        imports: true,
        showStats: true,
        showSource: true,
        sourceLabel: "Source",
        puiBase: null,              // optional URL prefix for on-demand PUI assets
        debug: false,
        silent: true
    };

    function getConfig() {
        var base = (typeof window !== "undefined" && window.$docsify && window.$docsify.isf) || {};
        var config = assign({}, DEFAULTS, base);
        config.extensions = Array.isArray(config.extensions)
            ? config.extensions.map(function (ext) {
                return String(ext || "").toLowerCase().replace(/^\./, "");
            }).filter(Boolean)
            : DEFAULTS.extensions.slice();
        if (config.mode !== "replace" && config.mode !== "augment") config.mode = DEFAULTS.mode;
        if (config.lazy !== "visible" && config.lazy !== "click" && config.lazy !== "none") config.lazy = DEFAULTS.lazy;
        if (config.params !== "auto" && config.params !== "open" && config.params !== "closed") config.params = DEFAULTS.params;
        if (typeof config.enabled !== "boolean") config.enabled = DEFAULTS.enabled;
        if (typeof config.controls !== "boolean") config.controls = DEFAULTS.controls;
        if (typeof config.editor !== "boolean") config.editor = DEFAULTS.editor;
        if (typeof config.editorOpen !== "boolean") config.editorOpen = DEFAULTS.editorOpen;
        if (typeof config.editorLive !== "boolean") config.editorLive = DEFAULTS.editorLive;
        if (typeof config.autoplay !== "boolean") config.autoplay = DEFAULTS.autoplay;
        if (typeof config.showStats !== "boolean") config.showStats = DEFAULTS.showStats;
        if (typeof config.showSource !== "boolean") config.showSource = DEFAULTS.showSource;
        if (!resolutionPreset(config.maxResolution)) config.maxResolution = DEFAULTS.maxResolution;
        return config;
    }

    /* ==================================================================
     * Small utilities
     * ================================================================== */

    function assign(target) {
        for (var i = 1; i < arguments.length; i++) {
            var src = arguments[i];
            if (!src) continue;
            for (var key in src) {
                if (Object.prototype.hasOwnProperty.call(src, key)) target[key] = src[key];
            }
        }
        return target;
    }

    function clamp(value, lo, hi) {
        value = Number(value);
        if (!isFinite(value)) return lo;
        return Math.min(hi, Math.max(lo, value));
    }

    function isFiniteNumber(value) {
        return typeof value === "number" && isFinite(value);
    }

    function numberOr(value, fallback) {
        var n = Number(value);
        return isFinite(n) ? n : fallback;
    }

    function escapeHtml(text) {
        return String(text == null ? "" : text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function trim(value) {
        return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
    }

    function basename(path) {
        var clean = String(path || "").split("?")[0].split("#")[0].replace(/\/+$/, "");
        var idx = clean.lastIndexOf("/");
        return idx === -1 ? clean : clean.slice(idx + 1);
    }

    function dirname(path) {
        var clean = String(path || "").split("?")[0].split("#")[0];
        var idx = clean.lastIndexOf("/");
        if (idx === -1) return "";
        return clean.slice(0, idx + 1);
    }

    function debugLog(config, message, data) {
        if (!config || !config.debug || typeof console === "undefined") return;
        try { console.warn("[docsify-isf] " + message, data == null ? "" : data); } catch (err) { /* ignore */ }
    }

    function escapeRegExp(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function lineOfOffset(source, offset) {
        var line = 1;
        for (var i = 0; i < offset && i < source.length; i++) {
            if (source.charCodeAt(i) === 10) line++;
        }
        return line;
    }

    function isObject(value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function prefersReducedMotion() {
        try {
            return typeof window !== "undefined" && !!window.matchMedia &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (err) {
            return false;
        }
    }

    var LAYOUT_KEY = "docsify-isf:layout";
    var VALUES_KEY_PREFIX = "docsify-isf:values:";
    var VIEWERS = [];
    var TOASTS = [];
    var TOAST_SEQ = 0;
    var toastUI = null;
    var toastHost = null;
    var toastTimers = {};

    function loadStoredValues(url) {
        try {
            var raw = typeof localStorage !== "undefined" ? localStorage.getItem(VALUES_KEY_PREFIX + url) : null;
            var parsed = raw ? JSON.parse(raw) : null;
            return isObject(parsed) ? parsed : null;
        } catch (err) {
            return null;
        }
    }

    function storeValues(viewer) {
        if (!viewer || viewer.disposed || viewer.config.persistValues === false) return;
        try {
            if (typeof localStorage !== "undefined") {
                localStorage.setItem(VALUES_KEY_PREFIX + viewer.url, JSON.stringify(viewer.nonDefaultValues()));
            }
        } catch (err) { /* private mode / full storage */ }
    }

    function readUrlFlags() {
        var flags = { editor: false, controls: false, values: null, fullscreen: false, shader: null, resolution: null, quality: null };
        try {
            var params = new URLSearchParams(window.location.search);
            flags.editor = params.get("isf-editor") === "1";
            flags.controls = params.get("isf-controls") === "1";
            var resolution = resolutionPreset(params.get("isf-res") || params.get("isf-resolution") || "");
            if (resolution) flags.resolution = resolution;
            var quality = params.get("isf-quality");
            if (/^(auto|2|1|0\.5|0\.25)$/.test(quality || "")) flags.quality = quality;
            // `isf-shader` + `isf-fullscreen=1`: a self-contained viewer the
            // share button produces for OBS browser sources.
            flags.fullscreen = params.get("isf-fullscreen") === "1";
            flags.shader = params.get("isf-shader") || null;
            var raw = params.get("isf-values");
            if (raw) {
                var padded = raw.replace(/-/g, "+").replace(/_/g, "/");
                while (padded.length % 4) padded += "=";
                flags.values = JSON.parse(atob(padded));
            }
        } catch (err) { /* malformed flags are ignored */ }
        return flags;
    }

    function encodeBase64Url(text) {
        var base64 = btoa(String(text));
        return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function loadLayout() {
        try {
            var raw = typeof localStorage !== "undefined" ? localStorage.getItem(LAYOUT_KEY) : null;
            var parsed = raw ? JSON.parse(raw) : null;
            return isObject(parsed) ? parsed : {};
        } catch (err) {
            return {};
        }
    }

    function saveLayout(layout) {
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout || {}));
        } catch (err) { /* private mode / disabled storage */ }
    }

    /* ==================================================================
     * Tolerant JSON parser
     *
     * The ISF corpus is not strict JSON: trailing commas, `//` and block
     * comments inside the header, single quotes, bare keys, `.5` / `360.`
     * numbers and unknown backslash escapes all occur in the wild. A strict
     * JSON.parse (even with a regex sanitizer) is not enough, so this is a
     * small recursive-descent reader with forgiving lexing.
     * ================================================================== */

    function parseJSONTolerant(text) {
        var source = String(text == null ? "" : text);
        var i = 0, line = 1, lineStart = 0, len = source.length;
        var depth = 0;

        function fail(message, at) {
            var offset = at == null ? i : at;
            return {
                ok: false,
                value: null,
                error: {
                    message: message,
                    index: offset,
                    line: line,
                    column: offset - lineStart + 1
                }
            };
        }

        function peek(offset) {
            return source.charAt(i + (offset || 0));
        }

        function skipWhitespaceAndComments() {
            while (i < len) {
                var c = source.charAt(i);
                if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\u00a0") {
                    i++;
                } else if (c === "\n") {
                    i++;
                    line++;
                    lineStart = i;
                } else if (c === "/" && peek(1) === "/") {
                    while (i < len && source.charAt(i) !== "\n") i++;
                } else if (c === "/" && peek(1) === "*") {
                    i += 2;
                    while (i < len && !(source.charAt(i) === "*" && source.charAt(i + 1) === "/")) {
                        if (source.charAt(i) === "\n") { line++; lineStart = i + 1; }
                        i++;
                    }
                    i = Math.min(len, i + 2);
                } else {
                    break;
                }
            }
        }

        function parseString() {
            var quote = source.charAt(i);
            var start = i;
            i++;
            var out = "";
            while (i < len) {
                var c = source.charAt(i);
                if (c === "\\") {
                    var esc = source.charAt(i + 1);
                    i += 2;
                    switch (esc) {
                        case "n": out += "\n"; break;
                        case "t": out += "\t"; break;
                        case "r": out += "\r"; break;
                        case "b": out += "\b"; break;
                        case "f": out += "\f"; break;
                        case "/": out += "/"; break;
                        case "\\": out += "\\"; break;
                        case "\"": out += "\""; break;
                        case "'": out += "'"; break;
                        case "u":
                            var hex = source.substr(i, 4);
                            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                                out += String.fromCharCode(parseInt(hex, 16));
                                i += 4;
                            } else {
                                out += "u";
                            }
                            break;
                        default:
                            // Unknown escapes (`\M`, Windows paths, …) are kept literal.
                            out += esc;
                            break;
                    }
                    if (esc === "\n") { line++; lineStart = i; }
                } else if (c === "\n") {
                    // A raw newline inside a string is invalid but tolerated.
                    line++;
                    lineStart = i + 1;
                    out += c;
                    i++;
                } else if (c === quote) {
                    i++;
                    return out;
                } else {
                    out += c;
                    i++;
                }
            }
            var err = fail("Unterminated string starting at line " + lineOfOffset(source, start), start);
            throw err;
        }

        function parseNumber() {
            var start = i;
            if (peek() === "+" || peek() === "-") i++;
            if (peek() === "0" && (peek(1) === "x" || peek(1) === "X")) {
                i += 2;
                while (i < len && /[0-9a-fA-F]/.test(source.charAt(i))) i++;
            } else {
                while (i < len && /[0-9]/.test(source.charAt(i))) i++;
                if (peek() === ".") {
                    i++;
                    while (i < len && /[0-9]/.test(source.charAt(i))) i++;
                }
                if (peek() === "e" || peek() === "E") {
                    var j = i + 1;
                    if (source.charAt(j) === "+" || source.charAt(j) === "-") j++;
                    if (/[0-9]/.test(source.charAt(j))) {
                        i = j;
                        while (i < len && /[0-9]/.test(source.charAt(i))) i++;
                    }
                }
            }
            var raw = source.slice(start, i);
            var value = Number(raw);
            if (!isFinite(value)) {
                // NaN / Infinity literals are not legal JSON but stray in some headers.
                if (/^[+-]?nan$/i.test(raw)) value = NaN;
                else if (/^[+-]?infinity$/i.test(raw)) value = raw.charAt(0) === "-" ? -Infinity : Infinity;
                else throw fail("Invalid number '" + raw + "'", start);
            }
            return value;
        }

        function parseIdentifier() {
            var start = i;
            while (i < len && /[A-Za-z0-9_$.-]/.test(source.charAt(i))) i++;
            return source.slice(start, i);
        }

        function parseValue() {
            if (++depth > 128) throw fail("JSON nested too deeply");
            skipWhitespaceAndComments();
            var c = source.charAt(i);
            var value;
            if (c === "{") value = parseObject();
            else if (c === "[") value = parseArray();
            else if (c === "\"" || c === "'") value = parseString();
            else if (c === "-" || c === "+" || c === "." || /[0-9]/.test(c)) value = parseNumber();
            else {
                var word = parseIdentifier();
                if (/^true$/i.test(word)) value = true;
                else if (/^false$/i.test(word)) value = false;
                else if (/^null$/i.test(word)) value = null;
                else if (/^(nan|infinity|[+-]?infinity)$/i.test(word)) value = Number(word);
                else throw fail("Unexpected token '" + word + "'");
            }
            depth--;
            return value;
        }

        function parseObject() {
            var obj = {};
            i++; // {
            skipWhitespaceAndComments();
            if (source.charAt(i) === "}") { i++; return obj; }
            while (i < len) {
                skipWhitespaceAndComments();
                var key;
                var c = source.charAt(i);
                if (c === "\"" || c === "'") {
                    key = parseString();
                } else if (c === "}") {
                    i++; // trailing comma
                    return obj;
                } else {
                    key = parseIdentifier();
                    if (!key) throw fail("Expected an object key");
                }
                skipWhitespaceAndComments();
                if (source.charAt(i) !== ":") throw fail("Expected ':' after key '" + key + "'");
                i++;
                obj[key] = parseValue();
                skipWhitespaceAndComments();
                c = source.charAt(i);
                if (c === ",") { i++; continue; }
                if (c === "}") { i++; return obj; }
                if (!c) throw fail("Unterminated object");
                throw fail("Expected ',' or '}' in object");
            }
            throw fail("Unterminated object");
        }

        function parseArray() {
            var arr = [];
            i++; // [
            skipWhitespaceAndComments();
            if (source.charAt(i) === "]") { i++; return arr; }
            while (i < len) {
                skipWhitespaceAndComments();
                if (source.charAt(i) === "]") { i++; return arr; } // trailing comma
                arr.push(parseValue());
                skipWhitespaceAndComments();
                var c = source.charAt(i);
                if (c === ",") { i++; continue; }
                if (c === "]") { i++; return arr; }
                if (!c) throw fail("Unterminated array");
                throw fail("Expected ',' or ']' in array");
            }
            throw fail("Unterminated array");
        }

        try {
            skipWhitespaceAndComments();
            var value = parseValue();
            skipWhitespaceAndComments();
            return { ok: true, value: value, error: null };
        } catch (err) {
            if (err && err.ok === false) return err;
            return {
                ok: false,
                value: null,
                error: { message: (err && err.message) || "Invalid JSON", index: i, line: line, column: i - lineStart + 1 }
            };
        }
    }

    /* ==================================================================
     * ISF header extraction
     * ================================================================== */

    var HEADER_HINT = /"(INPUTS|ISFVSN|PASSES|CATEGORIES|IMPORTED|DESCRIPTION|CREDIT|RESOURCE_TYPE|GENERATORS)"\s*:/;

    // A block comment scanner that tracks nesting, because ISF headers may
    // contain their own `/* ... */` comments (the corpus does).
    function scanBlockComments(text) {
        var out = [];
        var i = 0, n = text.length;
        while (i < n - 1) {
            if (text.charAt(i) === "/" && text.charAt(i + 1) === "*") {
                var start = i;
                i += 2;
                var depth = 1;
                while (i < n && depth > 0) {
                    if (text.charAt(i) === "/" && text.charAt(i + 1) === "*") { depth++; i += 2; continue; }
                    if (text.charAt(i) === "*" && text.charAt(i + 1) === "/") { depth--; i += 2; continue; }
                    i++;
                }
                out.push({
                    start: start,
                    end: Math.min(i, n),
                    content: text.slice(start + 2, depth === 0 ? i - 2 : i)
                });
                continue;
            }
            i++;
        }
        return out;
    }

    function parseISFMetadata(source) {
        var text = String(source == null ? "" : source);
        var comments = scanBlockComments(text);
        var parseable = null;
        var hinted = null;
        for (var c = 0; c < comments.length; c++) {
            var match = comments[c];
            var content = match.content;
            var looksLikeHeader = HEADER_HINT.test(content) || /^\s*\{/.test(content);
            var result = parseJSONTolerant(content);
            if (result.ok && isObject(result.value)) {
                var candidate = {
                    ok: true,
                    data: result.value,
                    error: null,
                    start: match.start,
                    end: match.end,
                    content: content
                };
                if (HEADER_HINT.test(content)) return candidate;
                if (!parseable) parseable = candidate;
            } else if (!hinted && looksLikeHeader) {
                hinted = {
                    ok: false,
                    data: null,
                    error: result.error,
                    start: match.start,
                    end: match.end,
                    content: content
                };
            }
        }
        if (parseable) return parseable;
        if (hinted) {
            if (hinted.error) {
                var fileLine = lineOfOffset(text, hinted.start + 2) + (hinted.error.line - 1);
                hinted.error.fileLine = fileLine;
                hinted.error.fileColumn = hinted.error.column;
                hinted.error.message = "Invalid ISF header JSON: " + hinted.error.message;
            }
            return hinted;
        }
        return {
            ok: false,
            data: null,
            error: { message: "No ISF metadata comment found (expected /*{ ... }*/ at the top of the file)", line: 1, column: 1, fileLine: 1 },
            start: -1,
            end: -1,
            content: ""
        };
    }

    function parseISF(source) {
        var text = String(source == null ? "" : source);
        var header = parseISFMetadata(text);
        var out = {
            valid: false,
            raw: text,
            metadata: {},
            header: null,
            body: "",
            bodyStart: 0,
            bodyStartLine: 1,
            error: null
        };
        if (!header.ok) {
            out.error = header.error || { message: "Invalid ISF header" };
            return out;
        }
        out.valid = true;
        out.header = header;
        out.metadata = header.data;
        out.bodyStart = header.end;
        out.body = text.slice(header.end);
        out.bodyStartLine = lineOfOffset(text, header.end);
        return out;
    }

    /* ==================================================================
     * Safe math expression evaluator (pass WIDTH/HEIGHT equations)
     *
     * The ISF spec delegates these equations to DDMathParser. Supporting the
     * full language is out of scope; this covers the constants, operators and
     * functions used by the shipped corpus and by the spec examples without
     * ever calling eval().
     * ================================================================== */

    var EXPR_CONSTANTS = {
        pi: Math.PI,
        PI: Math.PI,
        e: Math.E,
        E: Math.E,
        infinity: Infinity,
        infinity_: Infinity
    };

    function evalExpression(expression, variables) {
        var src = String(expression == null ? "" : expression);
        var vars = variables || {};
        var i = 0, len = src.length;

        function fail(message) {
            return { ok: false, value: NaN, error: message };
        }

        function skip() {
            while (i < len && /\s/.test(src.charAt(i))) i++;
        }

        function peek() { return src.charAt(i); }

        function parseNumber() {
            var start = i;
            if (peek() === "+" || peek() === "-") i++;
            while (i < len && /[0-9]/.test(src.charAt(i))) i++;
            if (peek() === ".") {
                i++;
                while (i < len && /[0-9]/.test(src.charAt(i))) i++;
            }
            if (peek() === "e" || peek() === "E") {
                var j = i + 1;
                if (src.charAt(j) === "+" || src.charAt(j) === "-") j++;
                if (/[0-9]/.test(src.charAt(j))) {
                    i = j;
                    while (i < len && /[0-9]/.test(src.charAt(i))) i++;
                }
            }
            var raw = src.slice(start, i);
            var value = Number(raw);
            if (!isFinite(value) && raw !== "0") return null;
            return value;
        }

        function parseIdentifierName() {
            var start = i;
            if (peek() === "$") i++;
            while (i < len && /[A-Za-z0-9_.]/.test(src.charAt(i))) i++;
            return src.slice(start, i);
        }

        function binary(op, next, leftAssoc) {
            return function () {
                var left = next();
                if (left === null) return null;
                while (true) {
                    skip();
                    var symbol = null;
                    for (var k = 0; k < op.length; k++) {
                        var candidate = op[k];
                        if (src.substr(i, candidate.length) === candidate) { symbol = candidate; break; }
                    }
                    if (symbol === null) return left;
                    i += symbol.length;
                    var right = next();
                    if (right === null) return null;
                    switch (symbol) {
                        case "+": left = left + right; break;
                        case "-": left = left - right; break;
                        case "*": left = left * right; break;
                        case "/": left = left / right; break;
                        case "%": left = left % right; break;
                        case "^": left = Math.pow(left, right); break;
                        default: return null;
                    }
                }
            };
        }

        var parseAddSub, parseMulDiv, parsePower, parseUnary, parsePrimary;

        parsePrimary = function () {
            skip();
            var c = peek();
            if (c === "(") {
                i++;
                var inner = parseAddSub();
                skip();
                if (peek() !== ")") return null;
                i++;
                return inner;
            }
            if (/[0-9.]/.test(c) || ((c === "-" || c === "+") && /[0-9.]/.test(src.charAt(i + 1)))) {
                return parseNumber();
            }
            if (/[A-Za-z_$]/.test(c)) {
                var name = parseIdentifierName();
                skip();
                if (peek() === "(") {
                    i++;
                    var args = [];
                    skip();
                    if (peek() !== ")") {
                        while (true) {
                            var arg = parseAddSub();
                            if (arg === null) return null;
                            args.push(arg);
                            skip();
                            if (peek() === ",") { i++; continue; }
                            break;
                        }
                    }
                    skip();
                    if (peek() !== ")") return null;
                    i++;
                    return callFunction(name, args);
                }
                return identifierValue(name);
            }
            return null;
        };

        parseUnary = function () {
            skip();
            var c = peek();
            if (c === "-") { i++; var v = parseUnary(); return v === null ? null : -v; }
            if (c === "+") { i++; return parseUnary(); }
            return parsePrimary();
        };

        parsePower = function () {
            var base = parseUnary();
            if (base === null) return null;
            skip();
            if (peek() === "^") {
                i++;
                var exp = parsePower(); // right associative
                if (exp === null) return null;
                return Math.pow(base, exp);
            }
            return base;
        };

        parseMulDiv = binary(["*", "/", "%"], parsePower, true);
        parseAddSub = binary(["+", "-"], parseMulDiv, true);

        function identifierValue(name) {
            if (Object.prototype.hasOwnProperty.call(vars, name)) {
                var value = Number(vars[name]);
                return isFinite(value) ? value : null;
            }
            var bare = name.charAt(0) === "$" ? name.slice(1) : name;
            if (Object.prototype.hasOwnProperty.call(vars, bare)) {
                var value2 = Number(vars[bare]);
                return isFinite(value2) ? value2 : null;
            }
            if (Object.prototype.hasOwnProperty.call(EXPR_CONSTANTS, name)) return EXPR_CONSTANTS[name];
            if (Object.prototype.hasOwnProperty.call(EXPR_CONSTANTS, bare)) return EXPR_CONSTANTS[bare];
            return null;
        }

        function callFunction(name, args) {
            var lower = name.toLowerCase();
            var arity = args.length;
            function need(n) { return arity === n && args.every(function (a) { return isFinite(a); }); }
            switch (lower) {
                case "abs": return need(1) ? Math.abs(args[0]) : null;
                case "sign": return need(1) ? Math.sign(args[0]) : null;
                case "floor": return need(1) ? Math.floor(args[0]) : null;
                case "ceil": return need(1) ? Math.ceil(args[0]) : null;
                case "round": return need(1) ? Math.round(args[0]) : null;
                case "trunc": return need(1) ? Math.trunc(args[0]) : null;
                case "sqrt": return need(1) ? Math.sqrt(args[0]) : null;
                case "exp": return need(1) ? Math.exp(args[0]) : null;
                case "log": return need(1) ? Math.log(args[0]) : null;
                case "log2": return need(1) ? Math.log2(args[0]) : null;
                case "log10": return need(1) ? Math.log10(args[0]) : null;
                case "sin": return need(1) ? Math.sin(args[0]) : null;
                case "cos": return need(1) ? Math.cos(args[0]) : null;
                case "tan": return need(1) ? Math.tan(args[0]) : null;
                case "asin": return need(1) ? Math.asin(args[0]) : null;
                case "acos": return need(1) ? Math.acos(args[0]) : null;
                case "atan": return need(1) ? Math.atan(args[0]) : (need(2) ? Math.atan2(args[0], args[1]) : null);
                case "radians": return need(1) ? args[0] * Math.PI / 180 : null;
                case "degrees": return need(1) ? args[0] * 180 / Math.PI : null;
                case "pow": return need(2) ? Math.pow(args[0], args[1]) : null;
                case "atan2": return need(2) ? Math.atan2(args[0], args[1]) : null;
                case "min": return arity >= 2 ? Math.min.apply(Math, args) : null;
                case "max": return arity >= 2 ? Math.max.apply(Math, args) : null;
                case "mod": return need(2) ? args[0] - args[1] * Math.floor(args[0] / args[1]) : null;
                case "fract": return need(1) ? args[0] - Math.floor(args[0]) : null;
                case "clamp": return need(3) ? Math.min(args[2], Math.max(args[1], args[0])) : null;
                case "mix": return need(3) ? args[0] * (1 - args[2]) + args[1] * args[2] : null;
                case "step": return need(2) ? (args[1] >= args[0] ? 1 : 0) : null;
                case "smoothstep": return need(3) ? smoothstep(args[0], args[1], args[2]) : null;
                case "length": return arity >= 1 ? Math.sqrt(args.reduce(function (sum, a) { return sum + a * a; }, 0)) : null;
                case "hypot": return arity >= 1 ? Math.hypot.apply(Math, args) : null;
                default: return null;
            }
        }

        function smoothstep(edge0, edge1, x) {
            if (edge0 === edge1) return x < edge0 ? 0 : 1;
            var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
            return t * t * (3 - 2 * t);
        }

        try {
            var value = parseAddSub();
            skip();
            if (value === null || i < len) return { ok: false, value: NaN, error: "Unsupported expression: " + src };
            if (!isFinite(value)) return { ok: false, value: NaN, error: "Expression is not finite: " + src };
            return { ok: true, value: value, error: null };
        } catch (err) {
            return { ok: false, value: NaN, error: (err && err.message) || "Invalid expression" };
        }
    }

    /* ==================================================================
     * GLSL tokenizer
     *
     * One scanner feeds both the syntax highlighter and the IMG_* rewriter,
     * so comments/strings are always treated as opaque and never rewritten.
     * ================================================================== */

    var GLSL_IDENT_START = /[A-Za-z_]/;
    var GLSL_IDENT_PART = /[A-Za-z0-9_]/;
    var GLSL_DIGIT = /[0-9]/;
    var OPS3 = { "<<=": 1, ">>=": 1, "...": 1 };
    var OPS2 = {
        "==": 1, "!=": 1, "<=": 1, ">=": 1, "&&": 1, "||": 1, "++": 1, "--": 1,
        "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "&=": 1, "|=": 1, "^=": 1,
        "<<": 1, ">>": 1, "->": 1, "##": 1
    };

    function tokenizeGLSL(source, options) {
        var src = String(source == null ? "" : source);
        var noPreproc = !!(options && options.noPreproc);
        var tokens = [];
        var i = 0, n = src.length, lineStart = true;

        function push(type, start, end) {
            tokens.push({ type: type, text: src.slice(start, end), start: start, end: end });
            i = end;
        }

        while (i < n) {
            var c = src.charAt(i);
            if (c === "\n") { push("newline", i, i + 1); lineStart = true; continue; }
            if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\u00a0") {
                var spaceStart = i;
                while (i < n && /[ \t\r\f\u00a0]/.test(src.charAt(i))) i++;
                push("space", spaceStart, i);
                continue;
            }
            if (c === "/" && src.charAt(i + 1) === "/") {
                var lineStartPos = i;
                while (i < n && src.charAt(i) !== "\n") i++;
                push("comment", lineStartPos, i);
                continue;
            }
            if (c === "/" && src.charAt(i + 1) === "*") {
                var blockStart = i;
                i += 2;
                while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i++;
                i = Math.min(n, i + 2);
                push("comment", blockStart, i);
                continue;
            }
            if (c === "#" && lineStart && !noPreproc) {
                var preStart = i;
                while (i < n) {
                    if (src.charAt(i) === "\\" && (src.charAt(i + 1) === "\n" || src.charAt(i + 1) === "\r")) {
                        i += 2;
                        if (src.charAt(i - 1) === "\r" && src.charAt(i) === "\n") i++;
                        continue;
                    }
                    if (src.charAt(i) === "\n") break;
                    i++;
                }
                push("preproc", preStart, i);
                continue;
            }
            if (c === "\"" || c === "'") {
                var quote = c;
                var strStart = i;
                i++;
                while (i < n && src.charAt(i) !== quote) {
                    if (src.charAt(i) === "\\") i++;
                    i++;
                }
                i = Math.min(n, i + 1);
                push("string", strStart, i);
                continue;
            }
            if (GLSL_DIGIT.test(c) || (c === "." && GLSL_DIGIT.test(src.charAt(i + 1)))) {
                if (c === "0" && (src.charAt(i + 1) === "x" || src.charAt(i + 1) === "X")) {
                    i += 2;
                    while (i < n && /[0-9a-fA-F]/.test(src.charAt(i))) i++;
                    push("number", i - 2, i);
                    continue;
                }
                var numStart = i;
                while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                if (src.charAt(i) === ".") {
                    i++;
                    while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                }
                if (src.charAt(i) === "e" || src.charAt(i) === "E") {
                    var j = i + 1;
                    if (src.charAt(j) === "+" || src.charAt(j) === "-") j++;
                    if (GLSL_DIGIT.test(src.charAt(j))) {
                        i = j;
                        while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                    }
                }
                push("number", numStart, i);
                continue;
            }
            if (GLSL_IDENT_START.test(c)) {
                var identStart = i;
                i++;
                while (i < n && GLSL_IDENT_PART.test(src.charAt(i))) i++;
                push("ident", identStart, i);
                continue;
            }
            var three = src.substr(i, 3);
            if (OPS3[three]) { push("op", i, i + 3); continue; }
            var two = src.substr(i, 2);
            if (OPS2[two]) { push("op", i, i + 2); continue; }
            push("op", i, i + 1);
        }
        return tokens;
    }

    /* ==================================================================
     * GLSL syntax highlighting
     * ================================================================== */

    var GLSL_KEYWORDS = words("attribute const uniform varying break continue do for while if else in out inout return discard struct switch case default true false precision lowp mediump highp invariant centroid flat smooth noperspective layout");
    var GLSL_TYPES = words("void bool int uint float vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uvec2 uvec3 uvec4 mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 sampler2D samplerCube sampler3D sampler2DArray");
    var GLSL_BUILTINS = words("radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D texture2DProj texture2DLod textureCube textureCubeLod dFdx dFdy fwidth");
    var GLSL_BUILTIN_VARS = words("gl_Position gl_PointSize gl_FragCoord gl_FrontFacing gl_PointCoord gl_FragColor gl_FragData gl_FragDepth gl_MaxVertexAttribs");
    var ISF_FUNCTIONS = words("IMG_PIXEL IMG_NORM_PIXEL IMG_THIS_PIXEL IMG_NORM_THIS_PIXEL IMG_THIS_NORM_PIXEL IMG_SIZE isf_vertShaderInit");
    var ISF_VARS = words("RENDERSIZE TIME TIMEDELTA DATE FRAMEINDEX PASSINDEX isf_FragNormCoord isf_FragCoord vv_FragNormCoord");

    function words(list) {
        var out = {};
        var parts = String(list).split(/\s+/);
        for (var i = 0; i < parts.length; i++) if (parts[i]) out[parts[i]] = true;
        return out;
    }

    function highlightGLSL(source) {
        var tokens = tokenizeGLSL(source);
        var html = [];
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            var cls = null;
            if (token.type === "comment") cls = "isf-tok-com";
            else if (token.type === "preproc") cls = "isf-tok-pre";
            else if (token.type === "string") cls = "isf-tok-str";
            else if (token.type === "number") cls = "isf-tok-num";
            else if (token.type === "ident") {
                var name = token.text;
                if (ISF_FUNCTIONS[name] || ISF_VARS[name]) cls = "isf-tok-isf";
                else if (GLSL_KEYWORDS[name]) cls = "isf-tok-kw";
                else if (GLSL_TYPES[name]) cls = "isf-tok-type";
                else if (GLSL_BUILTIN_VARS[name]) cls = "isf-tok-var";
                else if (GLSL_BUILTINS[name]) cls = "isf-tok-fn";
                else if (nextNonSpaceIsParen(tokens, i)) cls = "isf-tok-fn";
            } else if (token.type === "op") cls = "isf-tok-op";
            var text = escapeHtml(token.text);
            html.push(cls ? '<span class="' + cls + '">' + text + "</span>" : text);
        }
        return html.join("");
    }

    function nextNonSpaceIsParen(tokens, index) {
        for (var i = index + 1; i < tokens.length; i++) {
            var type = tokens[i].type;
            if (type === "space" || type === "newline" || type === "comment") continue;
            return type === "op" && tokens[i].text === "(";
        }
        return false;
    }

    /* ==================================================================
     * IMG_* / vv_* rewriting
     * ================================================================== */

    var IMG_REWRITE = {
        IMG_PIXEL: { arity: 2 },
        IMG_NORM_PIXEL: { arity: 2 },
        IMG_THIS_PIXEL: { arity: 1 },
        IMG_NORM_THIS_PIXEL: { arity: 1 },
        IMG_THIS_NORM_PIXEL: { arity: 1 },
        IMG_SIZE: { arity: 1 }
    };

    function rewriteGLSLText(text, known, warnings, unresolved) {
        var src = String(text == null ? "" : text);
        // Preprocessor lines are tokenised as ordinary tokens here so calls
        // inside macro definitions are rewritten too; the highlighter is what
        // wants whole-line `#` tokens.
        var tokens = tokenizeGLSL(src, { noPreproc: true });
        var out = [];
        var cursor = 0;

        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];

            if (token.type === "preproc") {
                out.push(src.slice(cursor, token.start));
                out.push(rewriteGLSLText(token.text, known, warnings, unresolved));
                cursor = token.end;
                continue;
            }
            if (token.type !== "ident") continue;

            var name = token.text;
            if (name === "vv_FragNormCoord" || name === "vv_vertShaderInit") {
                out.push(src.slice(cursor, token.start));
                out.push(name === "vv_FragNormCoord" ? "isf_FragNormCoord" : "isf_vertShaderInit");
                cursor = token.end;
                continue;
            }

            var spec = IMG_REWRITE[name];
            if (!spec) continue;

            var openIndex = -1;
            for (var j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === "space" || tokens[j].type === "newline" || tokens[j].type === "comment") continue;
                if (tokens[j].type === "op" && tokens[j].text === "(") openIndex = j;
                break;
            }
            if (openIndex === -1) continue;

            var depth = 0;
            var closeIndex = -1;
            for (var d = openIndex; d < tokens.length; d++) {
                var t = tokens[d];
                if (t.type !== "op") continue;
                if (t.text === "(") depth++;
                else if (t.text === ")") {
                    depth--;
                    if (depth === 0) { closeIndex = d; break; }
                }
            }
            if (closeIndex === -1) continue;

            var args = [];
            var current = [];
            var parens = 0, brackets = 0, braces = 0;
            for (var a = openIndex + 1; a < closeIndex; a++) {
                var at = tokens[a];
                if (at.type === "op") {
                    if (at.text === "(") parens++;
                    else if (at.text === ")") parens--;
                    else if (at.text === "[") brackets++;
                    else if (at.text === "]") brackets--;
                    else if (at.text === "{") braces++;
                    else if (at.text === "}") braces--;
                    else if (at.text === "," && parens === 0 && brackets === 0 && braces === 0) {
                        args.push(current.slice());
                        current = [];
                        continue;
                    }
                }
                current.push(at);
            }
            args.push(current);

            var argTexts = args.map(function (argTokens) {
                return trim(argTokens.map(function (x) { return x.text; }).join(""));
            });

            if (argTexts.length !== spec.arity || !argTexts[0]) {
                warnings.push({ message: name + "() expects " + spec.arity + " argument(s)", line: lineOfOffset(src, token.start) });
                continue;
            }

            var imageName = argTexts[0];
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(imageName)) {
                unresolved.push({ name: name, image: imageName, line: lineOfOffset(src, token.start), reason: "the image name is not a plain identifier" });
                continue;
            }
            if (!known[imageName]) {
                unresolved.push({ name: name, image: imageName, line: lineOfOffset(src, token.start), reason: "unknown image uniform" });
                continue;
            }

            var replacementText;
            if (name === "IMG_PIXEL") replacementText = "texture2D(" + imageName + ", (" + argTexts[1] + ") / _" + imageName + "_imgSize)";
            else if (name === "IMG_NORM_PIXEL") replacementText = "texture2D(" + imageName + ", " + argTexts[1] + ")";
            else if (name === "IMG_THIS_PIXEL") replacementText = "texture2D(" + imageName + ", gl_FragCoord.xy / _" + imageName + "_imgSize)";
            else if (name === "IMG_NORM_THIS_PIXEL" || name === "IMG_THIS_NORM_PIXEL") replacementText = "texture2D(" + imageName + ", isf_FragNormCoord)";
            else replacementText = "_" + imageName + "_imgSize";

            out.push(src.slice(cursor, token.start));
            out.push(replacementText);
            cursor = tokens[closeIndex].end;
            i = closeIndex;
        }

        if (out.length) {
            out.push(src.slice(cursor));
            return out.join("");
        }
        return src;
    }

    function rewriteSpecialFunctions(source, imageNames) {
        var known = {};
        if (Array.isArray(imageNames)) {
            for (var k = 0; k < imageNames.length; k++) known[imageNames[k]] = true;
        } else if (imageNames) {
            for (var key in imageNames) {
                if (Object.prototype.hasOwnProperty.call(imageNames, key)) known[key] = true;
            }
        }
        var warnings = [];
        var unresolved = [];
        var result = rewriteGLSLText(source, known, warnings, unresolved);
        return { source: result, warnings: warnings, unresolved: unresolved };
    }

    /* ==================================================================
     * ISF input / pass / import normalisation
     * ================================================================== */

    var INPUT_TYPE_INFO = {
        float: { uniform: "float" },
        bool: { uniform: "bool" },
        long: { uniform: "int" },
        event: { uniform: "bool" },
        color: { uniform: "vec4" },
        point2D: { uniform: "vec2" },
        image: { uniform: "sampler2D" },
        audio: { uniform: "sampler2D" },
        audioFFT: { uniform: "sampler2D" },
        // MadMapper generator/controller inputs surface as scalars, except
        // floatRange which is a min/max pair indexed by [0]/[1].
        floatRange: { uniform: "vec2" },
        animator: { uniform: "float" },
        shaper: { uniform: "float" },
        incrementer: { uniform: "float" },
        damper: { uniform: "float" },
        pass_thru: { uniform: "float" },
        linear_filter: { uniform: "float" },
        adsr: { uniform: "float" }
    };

    // Metadata TYPE spellings are case-insensitive; `int` is a MadMapper alias
    // of `long` and `audiofft` of `audioFFT`.
    var INPUT_TYPE_ALIASES = {
        float: "float",
        bool: "bool",
        long: "long",
        int: "long",
        event: "event",
        color: "color",
        point2d: "point2D",
        image: "image",
        audio: "audio",
        audiofft: "audioFFT",
        floatrange: "floatRange",
        animator: "animator",
        shaper: "shaper",
        incrementer: "incrementer",
        damper: "damper",
        pass_thru: "pass_thru",
        linear_filter: "linear_filter",
        adsr: "adsr"
    };

    function firstDefined() {
        for (var i = 0; i < arguments.length; i++) {
            if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
        }
        return undefined;
    }

    function pairValue(value, fallback) {
        if (Array.isArray(value)) {
            var x = numberOr(value[0], fallback);
            var y = numberOr(value.length > 1 ? value[1] : value[0], x);
            return [x, y];
        }
        if (isFiniteNumber(value)) return [value, value];
        return [fallback, fallback];
    }

    function quadValue(value, fallback) {
        var out = fallback.slice();
        if (Array.isArray(value)) {
            for (var i = 0; i < 4; i++) if (value[i] !== undefined) out[i] = numberOr(value[i], out[i]);
        } else if (isFiniteNumber(value)) {
            out = [value, value, value, 1];
        }
        return out;
    }

    function normalizeInputs(rawInputs, warnings) {
        var out = [];
        if (!Array.isArray(rawInputs)) return out;
        for (var i = 0; i < rawInputs.length; i++) {
            var raw = rawInputs[i];
            if (!isObject(raw)) continue;
            var name = trim(raw.NAME == null ? raw.Name : raw.NAME);
            if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                if (warnings) warnings.push({ message: "Input #" + (i + 1) + " has an invalid NAME" });
                continue;
            }
            var rawType = trim(String(firstDefined(raw.TYPE, raw.Type, "float"))).toLowerCase();
            var type = INPUT_TYPE_ALIASES[rawType];
            var info = type && INPUT_TYPE_INFO[type];
            if (!info) {
                if (warnings) warnings.push({ message: "Input " + name + " has unsupported TYPE '" + rawType + "'" });
                continue;
            }
            var label = trim(String(firstDefined(raw.LABEL, raw.Label, name)));
            var input = {
                name: name,
                label: label || name,
                type: type,
                uniform: info.uniform,
                raw: raw,
                min: null,
                max: null,
                default: null,
                define: /\bgenerate_as_define\b/.test(String(firstDefined(raw.FLAGS, raw.Flags, "")))
            };
            if (type === "float" || /^(animator|shaper|incrementer|damper|pass_thru|linear_filter|adsr)$/.test(type)) {
                var explicitMin = firstDefined(raw.MIN, raw.Min);
                var explicitMax = firstDefined(raw.MAX, raw.Max);
                // The 0…1 pair is the *control* range for materials that omit
                // MIN/MAX; values must not be clamped to it (`depth: 3`).
                input.boundedMin = explicitMin !== undefined && explicitMin !== null;
                input.boundedMax = explicitMax !== undefined && explicitMax !== null;
                input.min = numberOr(explicitMin, 0);
                input.max = numberOr(explicitMax, 1);
                if (input.min > input.max) { var swap = input.min; input.min = input.max; input.max = swap; }
                if (input.min === input.max) { input.min -= 0.5; input.max += 0.5; }
                input.default = numberOr(firstDefined(raw.DEFAULT, raw.Default, 0), 0);
            } else if (type === "bool" || type === "event") {
                input.default = !!firstDefined(raw.DEFAULT, raw.Default, false);
            } else if (type === "long") {
                var values = Array.isArray(raw.VALUES) ? raw.VALUES.slice() : null;
                var labels = Array.isArray(raw.LABELS) ? raw.LABELS.slice() : null;
                var def = firstDefined(raw.DEFAULT, raw.Default, 0);
                input.values = values;
                input.labels = labels;
                if (values && values.length) {
                    input.labels = labels && labels.length ? labels : values.map(function (v) { return String(v); });
                    input.defaultValue = values[0];
                    if (typeof def === "string") {
                        var labelIndex = labels ? labels.indexOf(def) : -1;
                        var valueIndex = labelIndex !== -1 ? labelIndex : values.indexOf(def);
                        input.defaultValue = values[valueIndex !== -1 ? valueIndex : 0];
                    } else if (typeof def === "number" && def >= 0 && def < values.length) {
                        input.defaultValue = values[def];
                    } else if (values.indexOf(def) !== -1) {
                        input.defaultValue = def;
                    }
                } else {
                    input.min = numberOr(firstDefined(raw.MIN, raw.Min), null);
                    input.max = numberOr(firstDefined(raw.MAX, raw.Max), null);
                    input.defaultValue = numberOr(def, 0);
                    if (input.min != null && input.max != null && input.min > input.max) {
                        var swap2 = input.min; input.min = input.max; input.max = swap2;
                    }
                    input.step = 1;
                }
                input.default = input.defaultValue;
            } else if (type === "color") {
                input.default = quadValue(firstDefined(raw.DEFAULT, raw.Default), [0, 0, 0, 1]);
                input.min = quadValue(firstDefined(raw.MIN, raw.Min), [0, 0, 0, 0]);
                input.max = quadValue(firstDefined(raw.MAX, raw.Max), [1, 1, 1, 1]);
            } else if (type === "floatRange") {
                input.default = pairValue(firstDefined(raw.DEFAULT, raw.Default), 0);
                input.min = pairValue(firstDefined(raw.MIN, raw.Min), 0);
                input.max = pairValue(firstDefined(raw.MAX, raw.Max), 1);
                for (var rangeAxis = 0; rangeAxis < 2; rangeAxis++) {
                    if (input.min[rangeAxis] === input.max[rangeAxis]) { input.min[rangeAxis] -= 0.5; input.max[rangeAxis] += 0.5; }
                }
            } else if (type === "point2D") {
                input.default = pairValue(firstDefined(raw.DEFAULT, raw.Default), 0);
                input.min = pairValue(firstDefined(raw.MIN, raw.Min), 0);
                input.max = pairValue(firstDefined(raw.MAX, raw.Max), 1);
                for (var axis = 0; axis < 2; axis++) {
                    if (input.min[axis] === input.max[axis]) { input.min[axis] -= 0.5; input.max[axis] += 0.5; }
                }
            } else if (type === "image") {
                input.default = undefined;
            } else if (type === "audio" || type === "audioFFT") {
                input.samples = Math.max(1, Math.round(numberOr(firstDefined(raw.MAX, raw.Max), 512)));
                input.default = undefined;
            }
            out.push(input);
        }
        return out;
    }

    function normalizePasses(rawPasses, warnings) {
        if (!Array.isArray(rawPasses) || rawPasses.length === 0) {
            return [{ target: null, persistent: false, float: false, width: "$WIDTH", height: "$HEIGHT" }];
        }
        var out = [];
        for (var i = 0; i < rawPasses.length; i++) {
            var raw = rawPasses[i] || {};
            var target = trim(raw.TARGET == null ? "" : raw.TARGET);
            if (target && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
                if (warnings) warnings.push({ message: "Pass #" + i + " has an invalid TARGET '" + target + "'" });
                target = name + "Image";
            }
            out.push({
                index: i,
                target: target || null,
                persistent: !!raw.PERSISTENT,
                float: !!raw.FLOAT,
                width: trim(String(raw.WIDTH == null ? "$WIDTH" : raw.WIDTH)) || "$WIDTH",
                height: trim(String(raw.HEIGHT == null ? "$HEIGHT" : raw.HEIGHT)) || "$HEIGHT"
            });
        }
        return out;
    }

    // MadMapper GENERATORS: named values computed on the CPU each frame and
    // exposed to the shader as uniforms (mostly `time_base` clocks).
    function normalizeGenerators(rawGenerators, inputs, warnings) {
        var out = [];
        if (!Array.isArray(rawGenerators)) return out;
        var inputByName = {};
        for (var i = 0; i < inputs.length; i++) inputByName[inputs[i].name] = inputs[i];
        for (var g = 0; g < rawGenerators.length; g++) {
            var raw = rawGenerators[g];
            if (!isObject(raw)) continue;
            var name = trim(raw.NAME);
            if (!name || !/^[A-Za-z_]\w*$/.test(name)) {
                if (warnings) warnings.push({ message: "Generator #" + g + " has an invalid NAME" });
                continue;
            }
            if (inputByName[name]) {
                if (warnings) warnings.push({ message: "Generator " + name + " collides with an input and was ignored" });
                continue;
            }
            var type = trim(String(raw.TYPE || "pass_thru")).toLowerCase();
            var params = isObject(raw.PARAMS) ? raw.PARAMS : (isObject(raw.Params) ? raw.Params : {});
            var uniform = "float";
            if (type === "pass_thru" || type === "multiplier") {
                var reference = trim(String(firstDefined(params.value, params.input, params.input1, "")));
                if (reference && inputByName[reference] && inputByName[reference].uniform === "bool") uniform = "bool";
            }
            out.push({ name: name, type: type, params: params, uniform: uniform });
        }
        return out;
    }

    function normalizeImports(rawImports, warnings) {
        var out = [];
        if (!rawImports) return out;
        function add(name, entry) {
            if (typeof entry === "string") entry = { PATH: entry };
            if (!isObject(entry)) return;
            var path = trim(firstDefined(entry.PATH, entry.path, ""));
            if (!path) return;
            var importName = trim(firstDefined(entry.NAME, entry.Name, name));
            if (!importName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(importName)) {
                if (warnings) warnings.push({ message: "IMPORTED entry '" + name + "' has an invalid texture name" });
                return;
            }
            out.push({
                name: importName,
                path: path,
                minFilter: entry.GL_TEXTURE_MIN_FILTER,
                magFilter: entry.GL_TEXTURE_MAG_FILTER,
                wrap: entry.GL_TEXTURE_WRAP
            });
        }
        if (Array.isArray(rawImports)) {
            for (var i = 0; i < rawImports.length; i++) {
                var item = rawImports[i];
                if (isObject(item)) add("import" + i, item);
                else if (typeof item === "string") add(basename(item).replace(/[^A-Za-z0-9_]/g, "_") || ("import" + i), item);
            }
        } else if (isObject(rawImports)) {
            for (var key in rawImports) {
                if (Object.prototype.hasOwnProperty.call(rawImports, key)) add(key, rawImports[key]);
            }
        }
        return out;
    }

    /* ==================================================================
     * Shader assembly
     * ================================================================== */

    var BUILTIN_NAMES = words("PASSINDEX RENDERSIZE TIME TIMEDELTA DATE FRAMEINDEX isf_FragNormCoord gl_FragCoord gl_FragColor");

    var FRAGMENT_PRELUDE = [
        "#ifdef GL_FRAGMENT_PRECISION_HIGH",
        "precision highp float;",
        "precision highp int;",
        "#else",
        "precision mediump float;",
        "precision mediump int;",
        "#endif",
        "",
        "uniform int PASSINDEX;",
        "uniform vec2 RENDERSIZE;",
        "uniform float TIME;",
        "uniform float TIMEDELTA;",
        "uniform int FRAMEINDEX;",
        "uniform vec4 DATE;",
        "uniform vec4 _isfMouse;",
        "varying vec2 isf_FragNormCoord;"
    ].join("\n") + "\n";

    function defaultVertexShader() {
        return [
            "precision highp float;",
            "precision highp int;",
            "attribute vec2 isf_position;",
            "uniform int PASSINDEX;",
            "uniform vec2 RENDERSIZE;",
            "varying vec2 isf_FragNormCoord;",
            "void isf_vertShaderInit(void);",
            "void main(void) {",
            "    isf_vertShaderInit();",
            "}",
            "void isf_vertShaderInit(void) {",
            "    gl_Position = vec4(isf_position, 0.0, 1.0);",
            "    isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5;",
            "}"
        ].join("\n") + "\n";
    }

    function stripVersionDirective(source) {
        return String(source == null ? "" : source).replace(/^[ \t]*#version[^\n]*\n?/m, "");
    }

    function collectIncludes(source) {
        var names = [];
        var re = /^[ \t]*#include[ \t]+["']([^"']+)["'][ \t]*(?:\/\/[^\n]*)?$/gm;
        var match;
        while ((match = re.exec(String(source || "")))) {
            if (names.indexOf(match[1]) === -1) names.push(match[1]);
        }
        return names;
    }

    // Known case/spelling variants of the bundled MadMapper includes.
    var INCLUDE_ALIASES = {
        "madnoise.glsl": "MadNoise.glsl",
        "madcommon.glsl": "MadCommon.glsl",
        "madsdf.glsl": "MadSDF.glsl"
    };

    function includeNameVariants(name) {
        var variants = [name];
        var alias = INCLUDE_ALIASES[String(name).toLowerCase()];
        if (alias && variants.indexOf(alias) === -1) variants.push(alias);
        return variants;
    }

    // Inline `#include "file.glsl"` with the text resolved by the viewer
    // (relative to the .fs file, then any configured includePaths). Missing or
    // cyclic includes become comments so the compile error stays near the use.
    function expandIncludes(source, includes, warnings, stack) {
        var map = includes || {};
        stack = stack || {};
        return String(source == null ? "" : source).replace(/^[ \t]*#include[ \t]+["']([^"']+)["'][ \t]*(?:\/\/[^\n]*)?$/gm, function (match, name) {
            var key = name.trim();
            if (stack[key]) {
                if (warnings) warnings.push({ message: "Cyclic include \"" + key + "\" was skipped" });
                return "// cyclic include: " + key;
            }
            var text = map[key];
            if (!text) {
                var variants = includeNameVariants(key);
                for (var v = 1; v < variants.length && !text; v++) text = map[variants[v]];
            }
            if (!text) {
                if (warnings) warnings.push({ message: "Missing include \"" + key + "\"" });
                return "// missing include: " + key;
            }
            stack[key] = true;
            var expanded = expandIncludes(text, map, warnings, stack);
            delete stack[key];
            return "// ---- " + key + " ----\n" + expanded + "\n// ---- end " + key + " ----";
        });
    }

    function stripComments(source) {
        return String(source || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    }

    // GLSL ES forbids non-constant global initialisers, but desktop/MadMapper
    // shaders commonly write `float t = mat_time_source;` at file scope.
    // Split those into a declaration plus an assignment hoisted into the entry
    // point. Only simple single-line declarations are touched.
    // Last-resort compatibility transform: GI and GLSL ES are stricter than
    // desktop GLSL about mixing integer literals with floats (`TIME * 2`).
    // Promote bare integer literals to floats on lines that are in a float
    // context, skipping integer-only lines. `floatNames` seeds the set of
    // known float identifiers (inputs, built-ins); `const float` / float-valued
    // `#define`s are learned from the source (including inlined includes).
    // Only ever used as a retry after a shader has already failed to compile,
    // so working shaders are untouched.
    // Per-line view of the identifiers visible in each lexical scope. The
    // corpus reuses names like `i` or `p` for different types in different
    // functions (`vec3 i` in one helper, `int i` in another), so a flat name
    // list cannot decide whether a literal or identifier needs promotion.
    function analyzeDeclarationScopes(text, seedInts, seedFloats) {
        var lines = String(text == null ? "" : text).split("\n");
        var frames = [{ ints: {}, floats: {} }];
        var key;
        if (seedInts) for (key in seedInts) if (Object.prototype.hasOwnProperty.call(seedInts, key)) frames[0].ints[key] = true;
        if (seedFloats) for (key in seedFloats) if (Object.prototype.hasOwnProperty.call(seedFloats, key)) frames[0].floats[key] = true;
        var intDeclRe = /\b(?:int|uint|ivec[234]|uvec[234])\s+([A-Za-z_]\w*)/g;
        var floatDeclRe = /\b(?:float|vec[234]|mat[234])\s+([A-Za-z_]\w*)/g;
        var defineRe = /#\s*define\s+([A-Za-z_]\w*)\s+[-+]?(?:\d+\.\d*|\.\d+)/g;
        var intDefineRe = /#\s*define\s+([A-Za-z_]\w*)\s+[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?![\d.]))/g;
        var result = [];
        var pendingParams = null;
        var returnTypes = [null];
        var pendingReturnType = null;
        for (var i = 0; i < lines.length; i++) {
            var raw = lines[i];
            var code = raw.replace(/\/\/[^\n]*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
            var active = { ints: {}, floats: {}, returnType: returnTypes[returnTypes.length - 1] };
            for (var f = 0; f < frames.length; f++) {
                var frame = frames[f];
                for (key in frame.ints) if (Object.prototype.hasOwnProperty.call(frame.ints, key)) active.ints[key] = true;
                for (key in frame.floats) if (Object.prototype.hasOwnProperty.call(frame.floats, key)) active.floats[key] = true;
            }
            result[i] = active;
            defineRe.lastIndex = 0;
            var defineMatch;
            while ((defineMatch = defineRe.exec(code))) {
                frames[0].floats[defineMatch[1]] = true;
                delete frames[0].ints[defineMatch[1]];
            }
            intDefineRe.lastIndex = 0;
            while ((defineMatch = intDefineRe.exec(code))) {
                if (!frames[0].floats[defineMatch[1]]) frames[0].ints[defineMatch[1]] = true;
            }
            // Function signatures: parameters of a definition belong to the
            // body scope (which may open on the next line), parameters of a
            // prototype must not leak anywhere.
            var signatureMatch = /^[ \t]*(void|float|int|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(code);
            var signatureTail = signatureMatch ? code.slice(signatureMatch[0].length) : "";
            var isPrototype = !!(signatureMatch && /^\s*;/.test(signatureTail));
            var isDefinition = !!(signatureMatch && /^\s*\{/.test(signatureTail));
            var isPendingSignature = !!(signatureMatch && !isPrototype && !isDefinition);
            var declSource = code;
            if (signatureMatch) declSource = isPrototype ? "" : signatureMatch[2];
            var lineInts = {};
            var lineFloats = {};
            var match;
            intDeclRe.lastIndex = 0;
            while ((match = intDeclRe.exec(declSource))) {
                if (declSource.charAt(intDeclRe.lastIndex) === "(") continue;
                lineInts[match[1]] = true;
            }
            floatDeclRe.lastIndex = 0;
            while ((match = floatDeclRe.exec(declSource))) lineFloats[match[1]] = true;
            // `int x = 1, y = 2;` / `float a, b;`: learn every declarator.
            var multiDecl = /^[ \t]*(?:(?:const|lowp|medium|highp)[ \t]+)*(int|uint|ivec[234]|uvec[234]|bvec[234]|float|vec[234]|mat[234])[ \t]+([A-Za-z_]\w*)((?:[ \t]*(?:=[^,]*)?,)[\s\S]*)$/.exec(declSource);
            if (!signatureMatch && multiDecl && declSource.indexOf("(") === -1) {
                var declarators = splitTopLevelArguments(multiDecl[1] + " " + multiDecl[2] + multiDecl[3]);
                var isIntType = /^(?:int|uint|ivec[234]|uvec[234]|bvec[234])$/.test(multiDecl[1]);
                for (var dec = 1; dec < declarators.length; dec++) {
                    var decName = /^[ \t]*([A-Za-z_]\w*)/.exec(declarators[dec]);
                    if (!decName) continue;
                    if (isIntType) lineInts[decName[1]] = true;
                    else lineFloats[decName[1]] = true;
                }
            }
            var opens = (code.match(/\{/g) || []).length;
            var closes = (code.match(/\}/g) || []).length;
            var net = opens - closes;
            // Declarations on a line that opens a block (function parameters,
            // for-counters) belong to the new scope. A one-line function
            // definition gets its own frame too, popped at the end of the line.
            if (isDefinition || net > 0) {
                frames.push({ ints: {}, floats: {} });
                returnTypes.push(isDefinition ? signatureMatch[1] : null);
            }
            var target = frames[frames.length - 1];
            if (isPendingSignature) {
                // `float foo(int n)` with the opening brace on the next line:
                // hold the parameters until that brace arrives.
                pendingParams = { ints: lineInts, floats: lineFloats };
                pendingReturnType = signatureMatch[1];
            } else {
                if (pendingParams && (isDefinition || net > 0)) {
                    for (key in pendingParams.ints) if (Object.prototype.hasOwnProperty.call(pendingParams.ints, key)) target.ints[key] = true;
                    for (key in pendingParams.floats) if (Object.prototype.hasOwnProperty.call(pendingParams.floats, key)) target.floats[key] = true;
                    returnTypes[returnTypes.length - 1] = pendingReturnType;
                    pendingParams = null;
                    pendingReturnType = null;
                }
                for (key in lineInts) if (Object.prototype.hasOwnProperty.call(lineInts, key)) target.ints[key] = true;
                for (key in lineFloats) if (Object.prototype.hasOwnProperty.call(lineFloats, key)) target.floats[key] = true;
            }
            if (isDefinition && net <= 0) {
                for (var popDefinition = 0; popDefinition < 1 - net && frames.length > 1; popDefinition++) {
                    frames.pop();
                    returnTypes.pop();
                }
            } else if (net < 0) {
                for (var pop = 0; pop < -net && frames.length > 1; pop++) {
                    frames.pop();
                    returnTypes.pop();
                }
            }
        }
        return result;
    }

    // GLSL built-ins whose arguments must share a type. When one argument is
    // a float expression and another is an in-scope int expression, the int
    // one is floated (`mix(randInt%1001, randInt%1001, fract(t))`).
    var INT_ARG_POSITIONS = {
        texelFetch: [2],
        textureSize: [1]
    };

    var COERCE_BUILTINS = {
        mix: true, clamp: true, step: true, smoothstep: true, min: true, max: true,
        pow: true, mod: true, atan: true, distance: true, dot: true, reflect: true,
        refract: true, faceforward: true, hypot: true
    };

    function findMatchingParen(text, open) {
        var depth = 0;
        for (var i = open; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch === "(") depth++;
            else if (ch === ")") {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    // An int declaration whose right-hand side mixes in float values
    // (`int y = a + b * 2.5;`) needs its int identifiers floated; a pure int
    // expression that only wraps parts in int() casts does not.
    function intDeclarationHasFloat(fragment, active, countLiterals) {
        var stripped = fragment;
        var re = /\b(?:int|uint)\s*\(/g;
        var match;
        while ((match = re.exec(stripped))) {
            var open = re.lastIndex - 1;
            var close = findMatchingParen(stripped, open);
            if (close === -1) break;
            stripped = stripped.slice(0, match.index) + stripped.slice(close + 1);
            re.lastIndex = 0;
        }
        if (/(?:\d+\.\d*|\.\d+)/.test(stripped)) return true;
        if (countLiterals && /\d+/.test(stripped)) return true;
        var identifiers = stripped.match(/[A-Za-z_]\w*/g) || [];
        for (var i = 0; i < identifiers.length; i++) {
            if (active.floats[identifiers[i]]) return true;
        }
        return false;
    }

    function splitTopLevelArguments(text) {
        var args = [];
        var current = "";
        var depth = 0;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            if (ch === "," && depth === 0) {
                args.push(current);
                current = "";
                continue;
            }
            current += ch;
        }
        args.push(current);
        return args;
    }

    function argumentLooksFloat(argument, active) {
        if (/(?:\d+\.\d*|\.\d+)/.test(argument)) return true;
        if (/\b(?:float|vec[234]|mat[234])\s*\(/.test(argument)) return true;
        var identifiers = argument.match(/[A-Za-z_]\w*/g) || [];
        for (var i = 0; i < identifiers.length; i++) {
            if (active.floats[identifiers[i]]) return true;
        }
        return false;
    }

    function argumentLooksInt(argument, active, inlineInts) {
        if (/(?:\d+\.\d*|\.\d+)/.test(argument)) return false;
        if (/^\s*\d+\s*$/.test(argument)) return true;
        if (/\bfloat\s*\(/.test(argument)) return false;
        if (/\b(?:float|vec[234]|mat[234])\s*\(/.test(argument)) return false;
        var identifiers = argument.match(/[A-Za-z_]\w*/g) || [];
        var found = false;
        for (var i = 0; i < identifiers.length; i++) {
            var name = identifiers[i];
            if (active.floats[name]) return false;
            if (active.ints[name] || (inlineInts && inlineInts[name])) {
                found = true;
                continue;
            }
            return false;
        }
        return found;
    }

    function coerceBuiltinArguments(text, active, inlineInts) {
        var re = /\b([A-Za-z_]\w*)\s*\(/g;
        var out = [];
        var cursor = 0;
        var match;
        while ((match = re.exec(text))) {
            if (!COERCE_BUILTINS[match[1]] && !INT_ARG_POSITIONS[match[1]] && !/^mm_/.test(match[1])) continue;
            var open = match.index + match[0].length - 1;
            var close = findMatchingParen(text, open);
            if (close === -1) continue;
            var inner = text.slice(open + 1, close);
            var args = splitTopLevelArguments(inner);
            if (args.length < 2) { re.lastIndex = close + 1; continue; }
            var anyFloat = false;
            var intFlags = [];
            for (var a = 0; a < args.length; a++) {
                if (argumentLooksFloat(args[a], active)) anyFloat = true;
                intFlags.push(argumentLooksInt(args[a], active, inlineInts));
            }
            var intPositions = INT_ARG_POSITIONS[match[1]];
            if (!anyFloat && !intPositions) { re.lastIndex = close + 1; continue; }
            var changed = false;
            var coerced = args.map(function (argument, index) {
                var trimmed = argument.trim();
                if (intPositions && intPositions.indexOf(index) !== -1 && !/^(?:int|uint|ivec[234])\s*\(/.test(trimmed) && !/^\d+$/.test(trimmed)) {
                    changed = true;
                    return "int(" + trimmed + ")";
                }
                if (!intFlags[index]) return argument;
                changed = true;
                return "float(" + trimmed + ")";
            });
            if (!changed) { re.lastIndex = close + 1; continue; }
            out.push(text.slice(cursor, open + 1));
            out.push(coerced.join(", "));
            cursor = close;
            re.lastIndex = close + 1;
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    // OBS's shader compiler lowers `pow(x, <positive integer>)` to repeated
    // multiplication, so a negative base keeps its sign (`pow(-2.0, 3.0)` is
    // -8.0). GLSL leaves `pow` undefined for a negative base and SwiftShader
    // turns it into NaN (written as black); the core applies the same
    // lowering, so the two kernels stay pixel-identical. Comments are copied
    // verbatim; only literal exponents 2…8 are rewritten.
    function lowerIntegerPowers(source) {
        var src = String(source == null ? "" : source);
        function isIdent(c) { return /[A-Za-z0-9_]/.test(c || ""); }
        var out = "";
        var i = 0;
        while (i < src.length) {
            var c = src.charAt(i);
            if (c === "/" && src.charAt(i + 1) === "/") {
                var nl = src.indexOf("\n", i);
                var lineEnd = nl < 0 ? src.length : nl;
                out += src.slice(i, lineEnd);
                i = lineEnd;
                continue;
            }
            if (c === "/" && src.charAt(i + 1) === "*") {
                var close = src.indexOf("*/", i + 2);
                var blockEnd = close < 0 ? src.length : close + 2;
                out += src.slice(i, blockEnd);
                i = blockEnd;
                continue;
            }
            if (c === "p" && src.substr(i, 3) === "pow" && !isIdent(src.charAt(i - 1)) && !isIdent(src.charAt(i + 3))) {
                var j = i + 3;
                while (j < src.length && /\s/.test(src.charAt(j))) j++;
                if (src.charAt(j) === "(") {
                    var depth = 0;
                    var comma = -1;
                    var k = j;
                    for (; k < src.length; k++) {
                        var ch = src.charAt(k);
                        if (ch === "(") depth++;
                        else if (ch === ")") { depth--; if (depth === 0) break; }
                        else if (ch === "," && depth === 1) { comma = k; break; }
                    }
                    if (comma > 0) {
                        depth = 1;
                        var m = comma + 1;
                        for (; m < src.length; m++) {
                            if (src.charAt(m) === "(") depth++;
                            else if (src.charAt(m) === ")") { depth--; if (depth === 0) break; }
                        }
                        if (m < src.length) {
                            // recurse into the base so nested integer powers lower too
                            var first = lowerIntegerPowers(src.slice(j + 1, comma).trim());
                            var second = src.slice(comma + 1, m);
                            var literal = /^\s*([2-8])(?:\.0*)?\s*$/.exec(second);
                            if (first && literal) {
                                var part = "(" + first + ")";
                                // the outer parentheses keep `a / pow(x,2)` a division
                                out += "(" + new Array(Number(literal[1]) + 1).join(part + " * ").replace(/ \* $/, "") + ")";
                                i = m + 1;
                                continue;
                            }
                        }
                    }
                }
            }
            out += c;
            i += 1;
        }
        return out;
    }

    function promoteIntegerLiterals(source, floatNames, intNames, noCastInts, intParamPositions, intReturnFunctions) {
        var text = String(source == null ? "" : source);
        var names = floatNames || {};
        var integers = intNames || {};
        var noCast = noCastInts || {};

        // 1. Float `const int` declarations whose name is only used in
        //    arithmetic (never as an array index, loop bound or bit operand).
        function constantUsedInBitwise(source, name) {
            var lines = String(source).split("\n");
            for (var li = 0; li < lines.length; li++) {
                var line = lines[li];
                if (line.indexOf(name) === -1) continue;
                var withoutLogical = line.replace(/&&/g, "").replace(/\|\|/g, "");
                if (/[&|^]|<<|>>/.test(withoutLogical)) return true;
            }
            return false;
        }

        var intConstRe = /const\s+(?:lowp\s+|mediump\s+|highp\s+)?int\s+([A-Za-z_]\w*)\s*=\s*([0-9]+)\s*;/g;
        var match;
        var conversions = [];
        while ((match = intConstRe.exec(text))) {
            var constantName = escapeRegExp(match[1]);
            var risky = new RegExp("\\[\\s*" + constantName + "\\b|\\b" + constantName + "\\s*]|[%]\\s*" + constantName + "\\b|\\b" + constantName + "\\s*[%]").test(text)
                || new RegExp("\\b(for|while)\\s*\\([^)]*\\b" + constantName + "\\b").test(text);
            if (!risky && !constantUsedInBitwise(text, match[1])) conversions.push({ name: match[1], value: match[2] });
        }
        for (var c = 0; c < conversions.length; c++) {
            var declaration = new RegExp("const\\s+(?:lowp\\s+|mediump\\s+|highp\\s+)?int\\s+" + escapeRegExp(conversions[c].name) + "\\s*=\\s*" + conversions[c].value + "\\s*;");
            text = text.replace(declaration, "const float " + conversions[c].name + " = " + conversions[c].value + ".0;");
        }

        // 1b. Object-like macros used in float expressions: promote integer
        //     literals in their bodies (`#define TWO_PI PI*2` -> `PI*2.0`),
        //     since the preprocessor expansion is what the compiler sees.
        var floatMacro = {};
        var macroFloatNameRe = null;
        var macroNames = Object.keys(names);
        if (macroNames.length) macroFloatNameRe = new RegExp("\\b(?:" + macroNames.map(escapeRegExp).join("|") + ")\\b");
        text = text.replace(/^([ \t]*#\s*define[ \t]+)([A-Za-z_]\w+)([ \t]+)([^\n]*)$/gm, function (macroMatch, head, name, gap, bodyText) {
            var floatish = /(?:\d+\.\d*|\.\d+)/.test(bodyText) || !!(macroFloatNameRe && macroFloatNameRe.test(bodyText));
            if (!floatish && /\b[A-Za-z_]\w*\b/.test(bodyText)) {
                var identifierRe = /\b([A-Za-z_]\w*)\b/g;
                var identifier;
                while ((identifier = identifierRe.exec(bodyText))) {
                    if (names[identifier[1]] || floatMacro[identifier[1]]) { floatish = true; break; }
                }
            }
            if (!floatish) return macroMatch;
            floatMacro[name] = true;
            return head + name + gap + bodyText.replace(/(^|[^\w.])(\d+)(?![\w.])(?!\.\d)/g, "$1$2.0");
        });


        // 2. Scope tracking: for every line, the int and float names visible
        //    in its scope.
        var scopes = analyzeDeclarationScopes(text, integers, names);
        var intVectorDims = {};
        var intVectorRe = /\b([iu]vec([234]))\s+([A-Za-z_]\w*)/g;
        var intVectorMatch;
        while ((intVectorMatch = intVectorRe.exec(text))) intVectorDims[intVectorMatch[3]] = Number(intVectorMatch[2]);

        // 3. Regexes per name set, cached: the same scope typically repeats.
        var patternCache = {};
        function patternsFor(intsObj, floatsObj) {
            var intList = Object.keys(intsObj).sort();
            var floatList = Object.keys(floatsObj).sort();
            var cacheKey = intList.join(",") + "##" + floatList.join(",");
            var cached = patternCache[cacheKey];
            if (cached) return cached;
            var patterns = {
                ints: intsObj,
                floats: floatsObj,
                intKeys: intList,
                intAssignRe: intList.length
                    ? new RegExp("(^|[^A-Za-z0-9_])(?:" + intList.map(escapeRegExp).join("|") + ")\\s*(?:[+\\-*\\/%]?=(?!=)|\\+\\+|--)")
                    : null,
                nameRe: floatList.length
                    ? new RegExp("(^|[^A-Za-z0-9_])(?:" + floatList.map(escapeRegExp).join("|") + ")([^A-Za-z0-9_]|$)")
                    : null
            };
            patternCache[cacheKey] = patterns;
            return patterns;
        }
        var promotionRe = /(^|[^\w.])(\d+)(?![\w.])(?!\.\d)/g;

        function insideBrackets(text, offset) {
            var depth = 0;
            for (var k = 0; k < offset && k < text.length; k++) {
                if (text.charAt(k) === "[") depth++;
                else if (text.charAt(k) === "]") depth--;
            }
            return depth > 0;
        }

        // Bare identifiers passed to int parameters of user functions keep
        // their int type even in an otherwise float expression.
        var intParamRe = intParamPositions && Object.keys(intParamPositions).length
            ? new RegExp("\\b(?:" + Object.keys(intParamPositions).map(escapeRegExp).join("|") + ")\\b")
            : null;

        // Innermost enclosing call of a position (name + opening paren index).
        function enclosingCall(fragment, offset) {
            var depth = 0;
            for (var k = offset - 1; k >= 0; k--) {
                var ch = fragment.charAt(k);
                if (ch === ")") depth++;
                else if (ch === "(") {
                    if (depth === 0) {
                        var before = fragment.slice(0, k).replace(/[ \t]+$/, "");
                        var nameMatch = /([A-Za-z_]\w*)$/.exec(before);
                        if (nameMatch) return { name: nameMatch[1], open: k };
                        // Grouping paren: keep looking for the enclosing call.
                        continue;
                    }
                    depth--;
                }
            }
            return null;
        }

        // True when a position sits inside a function/constructor call. In an
        // int declaration, expressions inside calls are usually float-typed
        // (`int(floor(f * mat_nX))`), while bare int arithmetic stays int.
        function insideAnyCall(fragment, offset) {
            var depth = 0;
            for (var k = offset - 1; k >= 0; k--) {
                var ch = fragment.charAt(k);
                if (ch === ")") depth++;
                else if (ch === "(") {
                    if (depth === 0) {
                        var before = fragment.slice(0, k).replace(/[ \t]+$/, "");
                        return /[A-Za-z_]\w*$/.test(before);
                    }
                    depth--;
                }
            }
            return false;
        }

        // Balanced `int(x)` wrapping: nested calls (`int(fract(abs(v))*100.)`)
        // are invisible to a simple regex.
        function wrapIntCasts(fragment, intDeclaration) {
            var re = /\b(int|uint)\s*\(/g;
            var out = [];
            var cursor = 0;
            var match;
            while ((match = re.exec(fragment))) {
                var open = re.lastIndex - 1;
                var depth = 0;
                var close = -1;
                for (var k = open; k < fragment.length; k++) {
                    var ch = fragment.charAt(k);
                    if (ch === "(") depth++;
                    else if (ch === ")") {
                        depth--;
                        if (depth === 0) { close = k; break; }
                    }
                }
                if (close === -1) continue;
                if (insideBrackets(fragment, match.index)) continue;
                var before = fragment.slice(Math.max(0, match.index - 6), match.index);
                if (/float\($/.test(before)) continue;
                if (intDeclaration && !insideAnyCall(fragment, match.index)) continue;
                out.push(fragment.slice(cursor, match.index));
                out.push("float(" + fragment.slice(match.index, close + 1) + ")");
                cursor = close + 1;
                re.lastIndex = close + 1;
            }
            if (out.length) {
                out.push(fragment.slice(cursor));
                return out.join("");
            }
            return fragment;
        }
        function protectedCallArguments(line) {
            if (!intParamRe || !intParamRe.test(line)) return null;
            var tokens = tokenizeGLSL(line);
            var protectedNames = null;
            var protectedLiterals = {};
            for (var t = 0; t < tokens.length; t++) {
                var token = tokens[t];
                if (token.type !== "ident") continue;
                var positions = intParamPositions[token.text];
                if (!positions) continue;
                var openIndex = -1;
                for (var o = t + 1; o < tokens.length; o++) {
                    if (tokens[o].type === "space" || tokens[o].type === "comment") continue;
                    if (tokens[o].type === "op" && tokens[o].text === "(") openIndex = o;
                    break;
                }
                if (openIndex === -1) continue;
                var call = callArgumentTexts(tokens, openIndex);
                if (!call) continue;
                for (var p = 0; p < positions.length; p++) {
                    var argument = call.args[positions[p]];
                    var bare = argument && argument.trim();
                    if (!bare) continue;
                    var identifier = /^([A-Za-z_]\w*)$/.exec(bare);
                    if (identifier) {
                        if (!protectedNames) protectedNames = {};
                        protectedNames[identifier[1]] = true;
                        continue;
                    }
                    var literal = /^\d+$/.exec(bare);
                    if (literal) protectedLiterals[literal[0]] = true;
                }
            }
            return { names: protectedNames, literals: protectedLiterals };
        }

        // `cellId%4 * 2.0` is int*float in GLSL; float the whole modulo. The
        // left operand may also be a call to an int-returning helper.
        function wrapModuloExpressions(text, active, inlineInts, intReturnFunctions) {
            var extra = inlineInts ? Object.keys(inlineInts) : [];
            var nameKeys = active.intKeys.concat(extra);
            var out = [];
            var cursor = 0;
            var i = 0;
            while (i < text.length) {
                if (text.charAt(i) !== "%") { i++; continue; }
                if (insideBrackets(text, i)) { i++; continue; }
                // Right operand: an integer literal or an int name.
                var j = i + 1;
                while (j < text.length && /[ \t]/.test(text.charAt(j))) j++;
                var rightMatch = /^(\d+|[A-Za-z_]\w*)/.exec(text.slice(j));
                if (!rightMatch) { i++; continue; }
                if (!/^\d+$/.test(rightMatch[1]) && nameKeys.indexOf(rightMatch[1]) === -1) { i++; continue; }
                var rightEnd = j + rightMatch[0].length;
                // Left operand: an int name or a call to an int-returning function.
                var k = i - 1;
                while (k >= 0 && /[ \t]/.test(text.charAt(k))) k--;
                var leftStart = -1;
                if (k >= 0 && /[A-Za-z0-9_]/.test(text.charAt(k))) {
                    var wordEnd = k + 1;
                    while (k >= 0 && /[A-Za-z0-9_]/.test(text.charAt(k))) k--;
                    leftStart = k + 1;
                    if (nameKeys.indexOf(text.slice(leftStart, wordEnd)) === -1) { i++; continue; }
                } else if (k >= 0 && text.charAt(k) === ")") {
                    var depth = 0, m = k;
                    for (; m >= 0; m--) {
                        var ch = text.charAt(m);
                        if (ch === ")") depth++;
                        else if (ch === "(") {
                            depth--;
                            if (depth === 0) break;
                        }
                    }
                    if (m < 0) { i++; continue; }
                    var callEnd = m;
                    var nameStart = m - 1;
                    while (nameStart >= 0 && /[A-Za-z0-9_]/.test(text.charAt(nameStart))) nameStart--;
                    var callName = text.slice(nameStart + 1, m);
                    if (callName && intReturnFunctions && intReturnFunctions[callName]) {
                        leftStart = nameStart + 1;
                    } else if (!callName) {
                        leftStart = m;
                    } else {
                        i++;
                        continue;
                    }
                } else {
                    i++;
                    continue;
                }
                var before = text.slice(0, leftStart).replace(/[ \t]+$/, "");
                if (/(?:float|int|uint)\s*\($/.test(before)) { i++; continue; }
                out.push(text.slice(cursor, leftStart));
                out.push("float(" + text.slice(leftStart, rightEnd) + ")");
                cursor = rightEnd;
                i = rightEnd;
            }
            if (out.length) {
                out.push(text.slice(cursor));
                return out.join("");
            }
            return text;
        }

        function castAndPromote(fragment, declaredName, equalIndex, force, extraInts, patterns, intDeclaration, protectedNames, inlineInts, extraFloats) {
            // True when the identifier is a parameter (or local) declaration
            // name in a signature such as `float octaves,` or `inout int n)`:
            // promoting an int-typed input there would emit `float
            // float(octaves)`, which is a syntax error.
            function inParameterList(text, at) {
                var before = text.slice(0, at);
                var typed = /(?:(?:lowp|mediump|highp|const|in|out|inout|uniform)\s+)*(?:void|float|int|uint|bool|[biu]vec[234]|mat[234](?:x[234])?)\s+$/.exec(before);
                if (!typed) return false;
                var head = before.slice(0, typed.index).replace(/[ \t]+$/, "");
                return head === "" || /[(,]$/.test(head);
            }
            var code = fragment;
            var active = patterns || patternsFor(integers, names);
            var floatContext = /(\d+\.\d*|\.\d+|\b(float|vec[234]|mat[234])\b)/.test(code) ||
                /\b(TIME|TIMEDELTA|RENDERSIZE|DATE|isf_FragNormCoord|gl_FragCoord|_isfMouse)\b/.test(code) ||
                /\b(?:int|uint)\s*\(/.test(code) ||
                !!(active.nameRe && active.nameRe.test(code)) ||
                !!(extraFloats && extraFloats.length && code.indexOf(extraFloats[0]) !== -1);
            if (!floatContext && !force) return fragment;
            var intDeclFloat = intDeclaration ? intDeclarationHasFloat(code, active) : false;
            code = wrapIntCasts(code, intDeclaration);
            if (active.intKeys.length || (extraInts && extraInts.length)) {
                var castNames = extraInts && extraInts.length ? active.intKeys.concat(extraInts) : active.intKeys;
                var castRe = new RegExp("\\b(" + castNames.map(escapeRegExp).join("|") + ")((?:\\.[A-Za-z_]\\w*)*)(\\+\\+|--)?(?![\\w.])", "g");
                code = code.replace(castRe, function (match, name, fields, postfix, offset, whole) {
                    if (insideBrackets(whole, offset)) return match;
                    if (offset > 0 && whole.charAt(offset - 1) === ".") return match;
                    if (noCast[name]) return match;
                    if (protectedNames && protectedNames.names && protectedNames.names[name]) {
                        var bareBefore = whole.slice(0, offset).replace(/[ \t]+$/, "");
                        var bareAfter = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                        if (/[(,]$/.test(bareBefore) && /^[,)]/.test(bareAfter)) return match;
                    }
                    if (inParameterList(whole, offset)) return match;
                    if (declaredName && name === declaredName && (equalIndex === -1 || offset < equalIndex)) return match;
                    var enclosing = enclosingCall(whole, offset);
                    if (enclosing && /^(?:float|int|uint)$/.test(enclosing.name)) {
                        if (!intDeclarationHasFloat(whole.slice(enclosing.open + 1, offset), active, false)) return match;
                    }
                    if (intDeclaration && !insideAnyCall(whole, offset) && !intDeclFloat) return match;
                    var after = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                    if (/^(?:%|\[|\+\+|--|[+\-*\/%]?=(?!=))/.test(after)) return match;
                    if (fields) {
                        // `ivecVar.y - x`: cast the field selection, not the vector;
                        // but `ivecVar.x = …` is an l-value and must stay.
                        if (/^\s*(?:[+\-*\/%]?=(?!=)|\+\+|--)/.test(after)) return match;
                        var lastField = fields.slice(fields.lastIndexOf(".") + 1);
                        var fieldDim = lastField.length >= 2 && lastField.length <= 4 ? lastField.length : 1;
                        return (fieldDim === 1 ? "float(" : "vec" + fieldDim + "(") + name + fields + ")";
                    }
                    var before = whole.slice(Math.max(0, offset - 6), offset);
                    if (/%\s*$/.test(before)) return match;
                    if (postfix) return "float(" + name + postfix + ")";
                    if (intVectorDims[name]) return "vec" + intVectorDims[name] + "(" + name + ")";
                    return "float(" + name + ")";
                });
            }
            code = wrapModuloExpressions(code, active, inlineInts, intReturnFunctions);
            code = code.replace(promotionRe, function (match, prefix, digits, offset, whole) {
                if (insideBrackets(whole, offset + prefix.length)) return match;
                var head = whole.slice(0, offset + prefix.length);
                if (/[\d.][eE][+-]?$/.test(head)) return match;
                var tail = whole.slice(offset + match.length);
                if (/%\s*$/.test(head) || /^\s*%/.test(tail)) return match;
                if (protectedNames && protectedNames.literals && protectedNames.literals[digits]) {
                    var literalHead = whole.slice(0, offset + prefix.length).replace(/[ \t]+$/, "");
                    var literalTail = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                    if (/[(,]$/.test(literalHead) && /^[,)]/.test(literalTail)) return match;
                }
                // In an int declaration, only literals inside calls are float
                // operands (`int(y) = int(f * 2)`); bare int arithmetic stays.
                if (intDeclaration && !insideAnyCall(whole, offset + prefix.length)) return match;
                var literalCall = enclosingCall(whole, offset + prefix.length);
                if (literalCall && /^(?:float|int|uint)$/.test(literalCall.name) &&
                    !intDeclarationHasFloat(whole.slice(literalCall.open + 1, offset + prefix.length), active, false)) {
                    return match;
                }
                // Keep integers compared against (or assigned to) a known int
                // name: the original int context was valid, int/float is not.
                var assignment = /([A-Za-z_]\w*)\s*(?:[+\-*\/%]?=(?!=)|\+\+|--)\s*$/.exec(head);
                if (assignment && (active.ints[assignment[1]] || (inlineInts && inlineInts[assignment[1]]) || (intDeclaration && assignment[1] === declaredName))) return match;
                var previous = /([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*\s*(?:==|!=|<=|>=|<|>)\s*$/.exec(head);
                var next = /^\s*(?:==|!=|<=|>=|<|>)\s*([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*/.exec(tail);
                if ((previous && (active.ints[previous[1]] || (inlineInts && inlineInts[previous[1]]))) || (next && (active.ints[next[1]] || (inlineInts && inlineInts[next[1]])))) return match;
                return prefix + digits + ".0";
            });
            return coerceBuiltinArguments(code, active, inlineInts);
        }

        var lines = text.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            // Generated overload shims must not be rewritten by the promotion
            // pass: `int(x)` casts inside them select the int overload.
            if (line.indexOf("docsify-isf-shim") !== -1) continue;
            var code = line.replace(/\/\/[^\n]*/g, "");
            if (/^[ \t]*#/.test(code)) continue;
            // A standalone integer literal continuing a call from the previous
            // line (`mix(a, b,\n 0,\n step(...))`) is a float argument.
            if (/^\s*\d+\s*[,)]?\s*$/.test(code) && i > 0 && /[,($]\s*$/.test(lines[i - 1])) {
                lines[i] = line.replace(/(\d+)/, "$1.0");
                continue;
            }
            // Bitwise operators are an int context, but logical `&&`/`||` are not.
            if (/[&|^]/.test(code.replace(/&&/g, "").replace(/\|\|/g, ""))) continue;
            var patterns = patternsFor(scopes[i].ints, scopes[i].floats);
            var protectedNames = protectedCallArguments(code);
            // `for`/`while` headers: only the condition is an expression to fix.
            // Inline loops after other code fall through to the general path.
            if (/\bfor\b/.test(code)) {
                var forMatched = false;
                var forLine = line.replace(/^([ \t]*for[ \t]*\(([^;]*);)([^;]*)(;)/, function (match, head, init, condition, tail) {
                    forMatched = true;
                    var loopVars = [];
                    var floatVars = [];
                    var loopRe = /\b(int|float)\s+([A-Za-z_]\w*)\s*=/g;
                    var loopMatch;
                    while ((loopMatch = loopRe.exec(init))) (loopMatch[1] === "int" ? loopVars : floatVars).push(loopMatch[2]);
                    // `for (float j = -1; …)`: promote literals in the initialiser.
                    var newInit = init;
                    var floatInit = /^([ \t]*float[ \t]+([A-Za-z_]\w*)[ \t]*=(?!=))([\s\S]*)$/.exec(init);
                    if (floatInit) {
                        newInit = floatInit[1] + castAndPromote(floatInit[3], floatInit[2], -1, true, null, patterns, false, protectedNames, null);
                    }
                    return head.replace(init, newInit) + castAndPromote(condition, null, -1, false, loopVars, patterns, false, protectedNames, null, floatVars) + tail;
                });
                if (forMatched) {
                    lines[i] = forLine;
                    continue;
                }
            }
            if (/\bwhile\b/.test(code)) {
                var whileLine = line.replace(/^([ \t]*while[ \t]*\()([^)]*)(\))/, function (match, head, condition, tail) {
                    return head + castAndPromote(condition, null, -1, false, null, patterns, false, protectedNames) + tail;
                });
                if (whileLine !== line) {
                    lines[i] = whileLine;
                    continue;
                }
            }
            // `int x = <expr>;`: cast int identifiers used in float expressions
            // on the right-hand side, but leave bare int() casts and literals alone.
            var intDeclarationMatch = /^[ \t]*(?:(?:const|lowp|mediump|highp)[ \t]+)*(?:int|uint|ivec[234]|uvec[234]|bvec[234])[ \t]+([A-Za-z_]\w*)/.exec(code);
            if (intDeclarationMatch) {
                lines[i] = castAndPromote(line, intDeclarationMatch[1], -1, false, null, patterns, true, protectedNames);
                continue;
            }
            if (/\b(switch|case|default)\b/.test(code)) continue;
            // Assignments to int identifiers are an integer context.
            if (patterns.intAssignRe && patterns.intAssignRe.test(code)) continue;
            if (/<<|>>/.test(code)) continue;
            if (patterns.intAssignRe && patterns.intAssignRe.test(code)) continue;
            // An int-returning function's expression is an integer context
            // (`return (land < .15 ? 1 : 0);`).
            if (!intDeclarationMatch && /\breturn\b/.test(code) && /^(?:int|uint|[iub]vec[234])$/.test(scopes[i].returnType || "")) continue;
            // `return 0;` in a float-returning function: force the literal.
            if (!intDeclarationMatch && /\breturn\b/.test(code) && /^(?:float|vec[234]|mat[234])$/.test(scopes[i].returnType || "")) {
                lines[i] = castAndPromote(line, null, -1, true, null, patterns, false, protectedNames, null);
                continue;
            }
            var declarationMatch = /^[ \t]*(?:(?:const|lowp|mediump|highp)[ \t]+)*(?:float|vec[234]|mat[234]|bool)[ \t]+([A-Za-z_]\w*)[ \t]*(?:=|;|,|\[)/.exec(code);
            var declaredName = declarationMatch ? declarationMatch[1] : null;
            var intDeclarationInline = false;
            var inlineIntNames = null;
            if (!declarationMatch) {
                // `for (int i = 0; …)` and friends: protect the initialiser
                // literal from promotion even when the line also contains
                // floats (inline loop bodies).
                var inlineRe = /\b(?:int|uint|ivec[234]|uvec[234])\s+([A-Za-z_]\w*)\s*=(?!=)/g;
                var inlineMatch;
                while ((inlineMatch = inlineRe.exec(code))) {
                    if (!inlineIntNames) inlineIntNames = {};
                    inlineIntNames[inlineMatch[1]] = true;
                    if (!intDeclarationInline) {
                        declaredName = inlineMatch[1];
                        intDeclarationInline = true;
                    }
                }
            }
            var equalIndex = code.indexOf("=");
            lines[i] = castAndPromote(line, declaredName, equalIndex, !!declarationMatch, null, patterns, intDeclarationInline, protectedNames, inlineIntNames);
        }
        return lines.join("\n");
    }

    // Comment stripper that preserves line numbers (block comments become
    // whitespace), so brace depth and declarations are not fooled by prose
    // inside multi-line comment blocks.
    function stripCommentsPreservingLines(source) {
        var text = String(source || "");
        var out = "";
        var i = 0;
        var block = false;
        while (i < text.length) {
            if (block) {
                if (text.charAt(i) === "*" && text.charAt(i + 1) === "/") { block = false; out += "  "; i += 2; continue; }
                out += text.charAt(i) === "\n" ? "\n" : " ";
                i++;
                continue;
            }
            if (text.charAt(i) === "/" && text.charAt(i + 1) === "*") { block = true; out += "  "; i += 2; continue; }
            if (text.charAt(i) === "/" && text.charAt(i + 1) === "/") {
                while (i < text.length && text.charAt(i) !== "\n") { out += " "; i++; }
                continue;
            }
            out += text.charAt(i);
            i++;
        }
        return out;
    }

    function hasTopLevelComma(text) {
        var depth = 0;
        for (var i = 0; i < String(text).length; i++) {
            var ch = text.charAt(i);
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            else if (ch === "," && depth === 0) return true;
        }
        return false;
    }

    function hoistGlobalInitializers(source) {
        var lines = String(source || "").split("\n");
        var cleanLines = stripCommentsPreservingLines(source).split("\n");
        var out = [];
        var assignments = [];
        var depth = 0;
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var withoutComment = cleanLines[i] || "";
            var declaration = /^([ \t]*)((?:(?:const|uniform|varying|attribute|lowp|mediump|highp)[ \t]+)*)([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*([^;]+);[ \t]*$/.exec(withoutComment);
            var isConst = declaration && /\bconst\b/.test(declaration[2]);
            var isUniform = declaration && /\buniform\b/.test(declaration[2]);
            var isSampler = declaration && /\bsampler/.test(declaration[3]);
            if (depth === 0 && declaration && !isConst && !isSampler && !hasTopLevelComma(declaration[5])) {
                assignments.push(declaration[4] + " = " + declaration[5] + ";");
                var qualifiers = isUniform ? declaration[2].replace(/\buniform[ \t]+/, "") : declaration[2];
                out.push(declaration[1] + qualifiers + declaration[3] + " " + declaration[4] + ";");
                continue;
            }
            out.push(line);
            var opens = (withoutComment.match(/\{/g) || []).length;
            var closes = (withoutComment.match(/\}/g) || []).length;
            depth = Math.max(0, depth + opens - closes);
        }
        return { body: out.join("\n"), assignments: assignments };
    }

    // Optional WebGL2 / GLSL ES 3.00 variant of an assembled ES 1.00 shader.
    // Used as a second compile attempt when the legacy source is rejected
    // (dynamic indexing, non-constant loops, texture functions, …).
    function toES3Fragment(source) {
        var body = String(source || "")
            .replace(/^[ \t]*#extension\s+GL_OES_standard_derivatives[^\n]*\n?/gm, "")
            .replace(/^[ \t]*#extension\s+GL_EXT_shader_texture_lod[^\n]*\n?/gm, "")
            .replace(/^[ \t]*#extension\s+GL_EXT_frag_depth[^\n]*\n?/gm, "")
            // Desktop-only extensions: core or irrelevant in ES 3.00.
            .replace(/^[ \t]*#extension\s+GL_(?:ARB|NV|AMD|ATI|INTEL)_[^\n]*\n?/gm, "");
        return [
            "#version 300 es",
            "#ifdef GL_FRAGMENT_PRECISION_HIGH",
            "precision highp float;",
            "precision highp int;",
            "#else",
            "precision mediump float;",
            "precision mediump int;",
            "#endif",
            "#define varying in",
            "#define texture2D texture",
            "#define texture2DProj textureProj",
            "#define texture2DLod textureLod",
            "#define textureCube texture",
            "#define textureCubeLod textureLod",
            "#define gl_FragColor _isfFragColor",
            "out vec4 _isfFragColor;",
            body
        ].join("\n") + "\n";
    }

    function toES3Vertex(source) {
        var body = String(source || "").replace(/^[ \t]*#version[^\n]*\n?/, "");
        return [
            "#version 300 es",
            "precision highp float;",
            "precision highp int;",
            "#define attribute in",
            "#define varying out",
            body
        ].join("\n") + "\n";
    }

    function buildVertexShader(userVertexShader, uniformDeclarations) {
        if (!userVertexShader) return { source: defaultVertexShader(), preludeLines: 0 };
        var body = stripVersionDirective(userVertexShader);
        body = body.replace(/\bvv_vertShaderInit\b/g, "isf_vertShaderInit");
        body = body.replace(/\bvv_FragNormCoord\b/g, "isf_FragNormCoord");
        var prefixLines = [
            "precision highp float;",
            "precision highp int;",
            "attribute vec2 isf_position;",
            "uniform int PASSINDEX;",
            "uniform vec2 RENDERSIZE;",
            "varying vec2 isf_FragNormCoord;"
        ];
        if (uniformDeclarations) prefixLines.push(uniformDeclarations);
        prefixLines.push("void isf_vertShaderInit(void);");
        var prefix = prefixLines.join("\n");
        var preludeLines = (prefix.match(/\n/g) || []).length;
        var suffix = [
            "void isf_vertShaderInit(void) {",
            "    gl_Position = vec4(isf_position, 0.0, 1.0);",
            "    isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5;",
            "}"
        ].join("\n");
        return { source: prefix + "\n" + body + "\n" + suffix + "\n", preludeLines: preludeLines };
    }

    /* ==================================================================
     * MadMapper dialect: HLSL aliases and original-name -> ported mm_*
     *
     * The bundled isf/glsl ports expose one prefixed name per signature
     * (mm_fill3, mm_circle2, …) while materials call the original overloaded
     * names (fill, circle, …). The Lua engine performs the same rewrite
     * (modules/src/isf-source/isf/dialect.lua); this is its browser sibling.
     * ================================================================== */

    var HLSL_ALIASES = {
        saturate: "#define saturate(x) clamp(x, 0.0, 1.0)",
        frac: "#define frac(x) fract(x)",
        lerp: "#define lerp(a, b, t) mix(a, b, t)",
        rsqrt: "#define rsqrt(x) inversesqrt(x)",
        ddx: "#define ddx(x) dFdx(x)",
        ddy: "#define ddy(x) dFdy(x)",
        tex2D: "#define tex2D(s, c) texture2D(s, c)"
    };

    var LIBRARY_ARITY = {
        mod289: { 1: "mm_mod289" },
        mod7: { 1: "mm_mod7" },
        permute: { 1: "mm_permute" },
        rgrad2: { 2: "mm_rgrad2" },
        hash: { 1: "mm_hash2" },
        cosNoise: { 1: "mm_cosnoise" },
        fillDist: { 1: "mm_fill_dist" },
        strokeDist: { 2: "mm_stroke_dist" },
        circle: { 2: "mm_circle2", 3: "mm_circle3" },
        roundedRectangle: { 3: "mm_rrect3", 4: "mm_rrect4" },
        triangle: { 2: "mm_triangle2", 3: "mm_triangle3" },
        hexagon: { 2: "mm_hexagon2", 3: "mm_hexagon3" },
        line: { 4: "mm_line4" },
        arc: { 4: "mm_arc4" },
        translate: { 2: "mm_translate" },
        rotate: { 2: "mm_rotate" },
        repeat: { 2: "mm_repeat2", 3: "mm_repeat3", 4: "mm_repeat4", 5: "mm_repeat5" },
        blend: { 2: "mm_blend" },
        smin: { 3: "mm_smin" },
        smoothBlend: { 3: "mm_smoothblend" },
        subtract: { 2: "mm_subtract" },
        intersect: { 2: "mm_intersect" }
    };

    var LIBRARY_DIM = {
        noise: ["mm_noise2", "mm_noise3"],
        vnoise: ["mm_vnoise2", "mm_vnoise3"],
        worleyNoise: ["mm_worley2", "mm_worley3"],
        billowedNoise: ["mm_billowed2", "mm_billowed3"]
    };

    // Every original name resolveLibraryRename() can handle.
    var LIBRARY_NAMES = {};
    (function () {
        var name;
        for (name in LIBRARY_ARITY) if (Object.prototype.hasOwnProperty.call(LIBRARY_ARITY, name)) LIBRARY_NAMES[name] = true;
        for (name in LIBRARY_DIM) if (Object.prototype.hasOwnProperty.call(LIBRARY_DIM, name)) LIBRARY_NAMES[name] = true;
        [
            "fill", "stroke", "glow", "rectangle", "repeatRadial",
            "fBm", "dfBm", "ridgedNoise", "dRidgedNoise", "dnoise", "dvnoise",
            "dWorleyNoise", "dBillowedNoise", "dBillowyTurbulence", "billowyTurbulence",
            "ridgedMF", "dRidgedMF", "curlNoise", "flowNoise", "dFlowNoise"
        ].forEach(function (entry) { LIBRARY_NAMES[entry] = true; });
    })();

    function collectUserFunctions(source) {
        var names = {};
        var re = /\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g;
        var match;
        var text = stripComments(String(source || ""));
        while ((match = re.exec(text))) names[match[1]] = true;
        return names;
    }

    function collectDeclaredTypes(source) {
        var types = {};
        var re = /\b(vec[234]|float|int|mat[234])\s+([A-Za-z_]\w*)/g;
        var match;
        while ((match = re.exec(String(source || "")))) types[match[2]] = match[1];
        return types;
    }

    function valueDim(text, types) {
        var value = String(text || "");
        var swizzledConstructor = /\b[iu]?vec[234]\s*\([^()]*\)\s*\.([xyzwrgba]{1,4})\b/.exec(value);
        if (swizzledConstructor) return swizzledConstructor[1].length;
        var constructor = /\b([iu]?vec[234])\s*\(/.exec(value);
        if (constructor) return Number(constructor[1].charAt(constructor[1].length - 1));
        var identifierRe = /\b([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)/g;
        var identifier;
        while ((identifier = identifierRe.exec(value))) {
            var declared = types[identifier[1]];
            if (declared && /^vec[234]$/.test(declared)) {
                var fields = identifier[2].split(".").filter(function (field) { return field; });
                var last = fields.length ? fields[fields.length - 1] : "";
                if (/^[xyzwrgba]{1,4}$/.test(last)) return last.length;
                return Number(declared.slice(3));
            }
        }
        return 0;
    }

    // Returns the top-level argument texts of the call starting at `openIndex`.
    function callArgumentTexts(tokens, openIndex) {
        var depth = 0;
        var close = -1;
        for (var d = openIndex; d < tokens.length; d++) {
            var token = tokens[d];
            if (token.type !== "op") continue;
            if (token.text === "(") depth++;
            else if (token.text === ")") {
                depth--;
                if (depth === 0) { close = d; break; }
            }
        }
        if (close === -1) return null;
        var args = [];
        var current = [];
        var parens = 0, brackets = 0, braces = 0;
        for (var a = openIndex + 1; a < close; a++) {
            var at = tokens[a];
            if (at.type === "op") {
                if (at.text === "(") parens++;
                else if (at.text === ")") parens--;
                else if (at.text === "[") brackets++;
                else if (at.text === "]") brackets--;
                else if (at.text === "{") braces++;
                else if (at.text === "}") braces--;
                else if (at.text === "," && parens === 0 && brackets === 0 && braces === 0) {
                    args.push(current);
                    current = [];
                    continue;
                }
            }
            current.push(at);
        }
        if (current.length || args.length) args.push(current);
        return {
            close: close,
            args: args.map(function (list) {
                return list.map(function (x) { return x.text; }).join("").trim();
            })
        };
    }

    function resolveLibraryRename(name, args, types) {
        if (LIBRARY_ARITY[name]) return LIBRARY_ARITY[name][args.length] || null;
        if (LIBRARY_DIM[name]) {
            var dim = valueDim(args[0] || "", types);
            return LIBRARY_DIM[name][dim === 3 ? 1 : 0] || null;
        }
        // Noise families: dimension-suffixed ports, arity-dependent suffixes.
        var firstDim = valueDim(args[0] || "", types);
        var noiseDim = firstDim === 3 ? 3 : 2;
        switch (name) {
            case "fBm": return args.length === 4 ? "mm_fbm" + noiseDim + "o" : "mm_fbm" + noiseDim;
            case "dfBm": return args.length === 4 ? "mm_dfbm" + noiseDim + "o" : "mm_dfbm" + noiseDim;
            case "ridgedNoise": return args.length === 2 ? "mm_ridged" + noiseDim + "r" : "mm_ridged" + noiseDim;
            case "dRidgedNoise": return args.length === 2 ? "mm_dridged" + noiseDim + "r" : "mm_dridged" + noiseDim;
            case "dnoise": return "mm_dnoise" + noiseDim;
            case "dvnoise": return "mm_dvnoise" + noiseDim;
            case "dWorleyNoise": return "mm_dworley" + noiseDim;
            case "dBillowedNoise": return "mm_dbillowed" + noiseDim;
            case "dBillowyTurbulence": return args.length === 4 ? "mm_dturb" + noiseDim + "o" : "mm_dturb" + noiseDim;
            case "billowyTurbulence": return args.length === 4 ? "mm_turb" + noiseDim + "o" : "mm_turb" + noiseDim;
            case "ridgedMF":
                return args.length === 1 ? "mm_ridgedmf" + noiseDim : args.length === 2 ? "mm_ridgedmf" + noiseDim + "r" : "mm_ridgedmf" + noiseDim + "o";
            case "dRidgedMF":
                return args.length === 1 ? "mm_dridgedmf" + noiseDim : args.length === 2 ? "mm_dridgedmf" + noiseDim + "r" : "mm_dridgedmf" + noiseDim + "o";
            case "curlNoise": return args.length === 2 ? "mm_curl2t" : "mm_curl2";
            case "flowNoise": return "mm_flow2";
            case "dFlowNoise": return "mm_dflow2";
            default: break;
        }
        if (name === "fill") return valueDim(args[0] || "", types) === 4 ? "mm_fill4" : "mm_fill3";
        if (name === "stroke") return valueDim(args[0] || "", types) === 4 ? "mm_stroke4" : "mm_stroke3";
        if (name === "glow") return valueDim(args[0] || "", types) === 4 ? "mm_glow4" : "mm_glow3";
        if (name === "rectangle") {
            if (args.length === 2) return valueDim(args[1] || "", types) === 2 ? "mm_rect_s" : "mm_rect_r";
            if (args.length === 3) return valueDim(args[2] || "", types) === 2 ? "mm_rect_cs" : "mm_rect_cr";
            return null;
        }
        if (name === "repeatRadial") {
            if (args.length === 2) return "mm_repeat_radial2";
            if (args.length === 3) return valueDim(args[2] || "", types) === 2 ? "mm_repeat_radial3" : "mm_repeat_radial4";
            if (args.length === 4) return "mm_repeat_radial5";
            return null;
        }
        return null;
    }

    function rewriteLibraryCalls(source, options) {
        var text = String(source || "");
        var tokens = tokenizeGLSL(text);
        var userFunctions = (options && options.userFunctions) || {};
        var types = (options && options.types) || {};
        var out = [];
        var cursor = 0;
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token.type !== "ident") continue;
            var name = token.text;
            if (userFunctions[name]) continue;
            if (!LIBRARY_NAMES[name]) continue;
            var openIndex = -1;
            for (var j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === "space" || tokens[j].type === "newline" || tokens[j].type === "comment") continue;
                if (tokens[j].type === "op" && tokens[j].text === "(") openIndex = j;
                break;
            }
            if (openIndex === -1) continue;
            var call = callArgumentTexts(tokens, openIndex);
            if (!call) continue;
            var replacement = resolveLibraryRename(name, call.args, types);
            if (!replacement || replacement === name) continue;
            // The ported mm_* helpers take float vectors; convert i/uvec
            // constructors passed straight in (starfield passes ivec2).
            var fixedArgs = [];
            var changed = false;
            for (var argIndex = 0; argIndex < call.args.length; argIndex++) {
                var originalArg = call.args[argIndex];
                var fixedArg = originalArg.replace(/\b([iu])vec([234])\s*\(/g, "vec$2(");
                if (fixedArg !== originalArg) changed = true;
                fixedArgs.push(fixedArg);
            }
            out.push(text.slice(cursor, token.start));
            if (changed) {
                out.push(replacement + "(" + fixedArgs.join(", ") + ")");
                cursor = tokens[call.close].end;
                i = call.close;
            } else {
                out.push(replacement);
                cursor = token.end;
            }
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    function aliasPreludeLines(userFunctions) {
        var lines = [];
        for (var name in HLSL_ALIASES) {
            if (!Object.prototype.hasOwnProperty.call(HLSL_ALIASES, name)) continue;
            if (userFunctions && userFunctions[name]) continue;
            lines.push(HLSL_ALIASES[name]);
        }
        return lines;
    }

    // `#ifndef GL_ES … #endif` blocks are compiled out on WebGL; signatures
    // and shadows inside them must not influence the assembled shader.
    function isInsideESGuardedBlock(source, index) {
        var text = String(source || "");
        var ifndef = text.slice(0, index).lastIndexOf("#ifndef GL_ES");
        if (ifndef === -1) return false;
        var endif = text.indexOf("#endif", ifndef);
        return endif === -1 || endif > index;
    }

    function collectFunctionSignatures(source) {
        var signatures = [];
        var re = /\b(void|float|int|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
        var match;
        var text = stripComments(String(source || ""));
        while ((match = re.exec(text))) {
            if (isInsideESGuardedBlock(text, match.index)) continue;
            var rawParams = match[3].split(",").map(function (text) { return trim(text); }).filter(function (text) { return text; });
            var params = [];
            var ok = true;
            var hasOut = false;
            for (var i = 0; i < rawParams.length; i++) {
                var raw = rawParams[i];
                var isOut = /\b(out|inout)\b/.test(raw);
                var nameMatch = /([A-Za-z_]\w*)\s*$/.exec(raw);
                var typeMatch = /\b(int|uint|ivec[234]|uvec[234]|bvec[234]|float|vec[234]|mat[234]|bool)\b/.exec(raw);
                if (!nameMatch || !typeMatch) { ok = false; break; }
                params.push({ type: typeMatch[1], name: nameMatch[1], text: raw, out: isOut });
                if (isOut) hasOut = true;
            }
            if (ok) signatures.push({ returnType: match[1], name: match[2], params: params, hasOut: hasOut });
        }
        return signatures;
    }

    function promoteTypeToFloat(type) {
        if (type === "int" || type === "uint") return "float";
        if (/^[iu]vec[234]$/.test(type)) return "vec" + type.slice(4);
        return type;
    }

    function castToOriginalType(type, expression) {
        if (type === "int" || type === "uint") return "int(" + expression + ")";
        if (/^[iub]vec[234]$/.test(type)) return type + "(" + expression + ")";
        return expression;
    }

    // Float-overload shims for functions declared with int parameters: the
    // literal-promotion layer may pass floats where the original expects int,
    // so emit `float f(float x) { return f(int(x)); }` next to a prototype.
    // Shims are only generated when no such overload already exists.
    function buildOverloadShims(source) {
        var signatures = collectFunctionSignatures(source);
        var existing = {};
        var i, j;
        for (i = 0; i < signatures.length; i++) {
            var key = signatures[i].name + "(" + signatures[i].params.map(function (param) { return param.type; }).join(",") + ")";
            existing[key] = true;
        }
        var prototypes = [];
        var definitions = [];
        var emitted = {};
        var declared = {};
        // Forward prototypes for every user function: the corpus has plenty of
        // call-before-definition helpers (apollian, GetSceneDistance, hash…).
        for (i = 0; i < signatures.length; i++) {
            var declaredKey = signatures[i].name + "(" + signatures[i].params.map(function (param) { return param.type; }).join(",") + ")";
            if (declared[declaredKey]) continue;
            declared[declaredKey] = true;
            prototypes.push(signatures[i].returnType + " " + signatures[i].name + "(" +
                signatures[i].params.map(function (param) { return param.text; }).join(", ") + ");");
        }
        for (i = 0; i < signatures.length; i++) {
            var signature = signatures[i];
            if (signature.hasOut) continue;
            var hasInt = false;
            for (j = 0; j < signature.params.length; j++) {
                if (/^(int|uint|[iub]vec[234])$/.test(signature.params[j].type)) hasInt = true;
            }
            if (!hasInt) continue;
            // Emit the all-float overload plus one overload per int parameter
            // (a call may already pass some arguments as floats).
            var variants = [signature.params.map(function () { return true; })];
            for (j = 0; j < signature.params.length; j++) {
                if (!/^(int|uint|[iub]vec[234])$/.test(signature.params[j].type)) continue;
                variants.push(signature.params.map(function (param, index) {
                    return index !== j;
                }));
            }
            for (var v = 0; v < variants.length; v++) {
                var floatMask = variants[v];
                var floatTypes = signature.params.map(function (param, index) {
                    return floatMask[index] ? promoteTypeToFloat(param.type) : param.type;
                });
                var shimKey = signature.name + "(" + floatTypes.join(",") + ")";
                if (existing[shimKey] || emitted[shimKey]) continue;
                emitted[shimKey] = true;
                var shimParams = signature.params.map(function (param, index) {
                    return floatTypes[index] + " " + param.name;
                }).join(", ");
                var args = signature.params.map(function (param, index) {
                    return floatMask[index] ? castToOriginalType(param.type, param.name) : param.name;
                }).join(", ");
                var body = signature.returnType === "void"
                    ? signature.name + "(" + args + ");"
                    : "return " + signature.name + "(" + args + ");";
                definitions.push(signature.returnType + " " + signature.name + "(" + shimParams + ") { " + body + " } // docsify-isf-shim");
            }
        }
        // Out/inout int parameters must never be floated: they are written
        // back through the out parameter (iter, layer, …).
        var outIntNames = {};
        for (i = 0; i < signatures.length; i++) {
            if (!signatures[i].hasOut) continue;
            for (j = 0; j < signatures[i].params.length; j++) {
                var outParam = signatures[i].params[j];
                if (outParam.out && /^(int|uint|[iu]vec[234])$/.test(outParam.type)) outIntNames[outParam.name] = true;
            }
        }
        // Positions of int parameters per user function: bare int arguments
        // passed there must keep their type (the float-overload shim would
        // otherwise turn a recursive call into a shim cycle).
        var intParamPositions = {};
        for (i = 0; i < signatures.length; i++) {
            var intPositions = [];
            for (j = 0; j < signatures[i].params.length; j++) {
                if (/^(int|uint|[iub]vec[234])$/.test(signatures[i].params[j].type)) intPositions.push(j);
            }
            if (intPositions.length) intParamPositions[signatures[i].name] = intPositions;
        }
        var intReturnFunctions = {};
        for (i = 0; i < signatures.length; i++) {
            if (/^(?:int|uint|[iub]vec[234])$/.test(signatures[i].returnType)) intReturnFunctions[signatures[i].name] = true;
        }
        return { prototypes: prototypes, definitions: definitions, outIntNames: outIntNames, intParamPositions: intParamPositions, intReturnFunctions: intReturnFunctions };
    }

    // Dialect type keywords: `long`, `half`, `double`, float2/… constructors.
    var TYPE_KEYWORDS = {
        long: "int",
        uint: "int",
        float2: "vec2",
        float3: "vec3",
        float4: "vec4",
        int2: "ivec2",
        int3: "ivec3",
        int4: "ivec4",
        uint2: "ivec2",
        uint3: "ivec3",
        uint4: "ivec4",
        uvec2: "ivec2",
        uvec3: "ivec3",
        uvec4: "ivec4",
        bool2: "bvec2",
        bool3: "bvec3",
        bool4: "bvec4",
        half: "float",
        half2: "vec2",
        half3: "vec3",
        half4: "vec4",
        double: "float",
        dvec2: "vec2",
        dvec3: "vec3",
        dvec4: "vec4",
        mat2x2: "mat2",
        mat3x3: "mat3",
        mat4x4: "mat4"
    };

    function replaceIdentifiers(source, replacements) {
        var text = String(source || "");
        var tokens = tokenizeGLSL(text);
        var out = [];
        var cursor = 0;
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token.type !== "ident") continue;
            var replacement = replacements[token.text];
            if (!replacement) continue;
            // A dialect type keyword is only a type when it introduces a
            // declaration (`half2 v`) or a constructor (`half2(…)`). A user
            // variable that happens to be named `half2` stays untouched.
            var rest = text.slice(token.end).replace(/^[ \t]+/, "");
            if (!/^[A-Za-z_(\[]/.test(rest)) continue;
            out.push(text.slice(cursor, token.start));
            out.push(replacement);
            cursor = token.end;
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    function normalizeTypeKeywords(source) {
        return replaceIdentifiers(source, TYPE_KEYWORDS);
    }

    // HLSL/desktop suffixes: `15731U` -> `15731`, `1.5f` -> `1.5`.
    function normalizeNumericSuffixes(source) {
        return String(source || "").replace(/(0[xX][0-9a-fA-F]+|\d*\.?\d+)([fFuU])\b/g, function (match, digits, suffix) {
            if (/^0[xX]/.test(digits)) return /[uU]/.test(suffix) ? digits : match;
            return digits;
        });
    }

    // Constants the Lua/desktop dialects provide that GLSL ES does not.
    var MATH_CONSTANTS = {
        M_PI: "3.14159265358979323846",
        M_2PI: "6.28318530717958647692",
        M_TWO_PI: "6.28318530717958647692",
        M_PI_2: "1.57079632679489661923",
        M_PI_4: "0.78539816339744830962",
        M_1_PI: "0.31830988618379067154",
        M_2_SQRTPI: "1.12837916709551257390",
        M_E: "2.71828182845904523536",
        M_SQRT2: "1.41421356237309504880",
        TWO_PI: "6.28318530717958647692",
        HALF_PI: "1.57079632679489661923"
    };

    function constantPreludeLines(source, inputNames) {
        var lines = [];
        var text = stripComments(String(source || ""));
        for (var name in MATH_CONSTANTS) {
            if (!Object.prototype.hasOwnProperty.call(MATH_CONSTANTS, name)) continue;
            if (inputNames && inputNames[name]) continue;
            var declared = new RegExp("#\\s*define\\s+" + name + "\\b").test(text) ||
                new RegExp("\\b(?:const\\s+)?(?:float|int|vec[234]|mat[234])\\s+" + name + "\\b").test(text);
            if (declared) continue;
            lines.push("#define " + name + " " + MATH_CONSTANTS[name]);
        }
        return lines;
    }

    // GLSL forbids user functions that shadow built-ins (sign, round, …).
    // Such shaders cannot compile anywhere, so rename the definition and all
    // its calls to a `usr_` name.
    function renameBuiltinShadows(source) {
        var text = String(source || "");
        var userFunctions = collectUserFunctions(text);
        var renames = {};
        for (var name in userFunctions) {
            if (!Object.prototype.hasOwnProperty.call(userFunctions, name)) continue;
            if (!GLSL_BUILTINS[name]) continue;
            // `#ifndef GL_ES float distance(…) #endif`: on WebGL the builtin is
            // intended and the shadowing definition is preprocessed away.
            if (isInsideESGuardedBlock(text, text.search(new RegExp("\\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])\\s+" + escapeRegExp(name) + "\\s*\\(")))) continue;
            var candidate = "usr_" + name;
            var suffix = 1;
            while (userFunctions[candidate] || text.indexOf(candidate) !== -1) candidate = "usr_" + name + "_" + suffix++;
            renames[name] = candidate;
        }
        if (!Object.keys(renames).length) return text;
        return replaceIdentifiers(text, renames);
    }

    // Some desktop shaders write to their own uniforms; WebGL forbids that.
    // Drop the qualifier when the body assigns to the name.
    function demoteAssignedUniforms(source) {
        var text = String(source || "");
        return text.replace(/\buniform\s+((?:lowp\s+|mediump\s+|highp\s+)?(?:float|int|bool|vec[234]|ivec[234]|uvec[234]|mat[234]|sampler2D|samplerCube))\s+([A-Za-z_]\w*)\s*;/g, function (match, type, name) {
            var assigned = new RegExp("(^|[^A-Za-z0-9_.])" + escapeRegExp(name) + "\\s*(?:[+\\-*\\/%]?=(?!=)|\\+\\+|--)").test(text);
            return assigned ? type + " " + name + ";" : match;
        });
    }

    function buildShader(parsed, options) {
        options = options || {};
        var warnings = [];
        var meta = parsed && parsed.valid ? parsed.metadata : {};
        var inputs = normalizeInputs(meta.INPUTS, warnings);
        var passes = normalizePasses(meta.PASSES, warnings);
        // MadMapper binds `mm_LastFrame` to an implicit persistent ping-pong
        // buffer whenever a shader samples it (isf/effect.lua does the same).
        if (/\bmm_LastFrame\b/.test(parsed.body || "")) {
            var lastFramePass = -1;
            for (var lf = 0; lf < passes.length; lf++) {
                if (passes[lf].target === "mm_LastFrame") lastFramePass = lf;
            }
            if (lastFramePass === -1) {
                if (passes.length === 1 && !passes[0].target) {
                    // Single-shader feedback: render into the persistent buffer,
                    // which is also what gets painted to the screen.
                    passes[0].target = "mm_LastFrame";
                    passes[0].persistent = true;
                } else {
                    passes.push({
                        index: passes.length,
                        target: "mm_LastFrame",
                        persistent: true,
                        float: false,
                        width: "$WIDTH",
                        height: "$HEIGHT"
                    });
                }
            }
        }
        var generators = normalizeGenerators(meta.GENERATORS, inputs, warnings);
        var imports = options.imports === false ? [] : normalizeImports(meta.IMPORTED, warnings);

        var imageNames = [];
        var imageInfo = [];
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") {
                imageNames.push(input.name);
                imageInfo.push({ name: input.name, kind: input.type === "image" ? "input" : "audio", input: input });
            }
        }
        for (var p = 0; p < passes.length; p++) {
            if (passes[p].target) {
                imageNames.push(passes[p].target);
                imageInfo.push({ name: passes[p].target, kind: "pass", pass: passes[p] });
            }
        }
        for (var m = 0; m < imports.length; m++) {
            imageNames.push(imports[m].name);
            imageInfo.push({ name: imports[m].name, kind: "import", import: imports[m] });
        }

        // Known float identifiers for the last-resort literal promotion.
        var floatNames = { PI: true, TIME: true, TIMEDELTA: true, RENDERSIZE: true, DATE: true, isf_FragNormCoord: true, gl_FragCoord: true, _isfMouse: true };
        var intNames = {};
        for (var fn = 0; fn < inputs.length; fn++) {
            if (/^(float|vec[234])$/.test(inputs[fn].uniform)) floatNames[inputs[fn].name] = true;
            else if (/^(int|uint|long)$/.test(inputs[fn].uniform)) intNames[inputs[fn].name] = true;
        }
        for (var fg = 0; fg < generators.length; fg++) {
            if (generators[fg].uniform === "float") floatNames[generators[fg].name] = true;
        }

        var body = stripVersionDirective(parsed.body || "");
        body = expandIncludes(body, options.includes, warnings);
        body = demoteAssignedUniforms(renameBuiltinShadows(normalizeNumericSuffixes(normalizeTypeKeywords(body))));
        var userFunctions = collectUserFunctions(body);
        var declaredTypes = collectDeclaredTypes(body);
        for (var dt = 0; dt < inputs.length; dt++) {
            declaredTypes[inputs[dt].name] = inputs[dt].uniform;
        }
        body = rewriteLibraryCalls(body, { userFunctions: userFunctions, types: declaredTypes });
        var shims = buildOverloadShims(body);
        var rewritten = rewriteSpecialFunctions(body, imageNames);
        rewritten.source = lowerIntegerPowers(rewritten.source);
        var bodyOffset = (parsed.bodyStartLine || 1) - 1;
        var rewriteWarnings = rewritten.warnings || [];
        for (var w = 0; w < rewriteWarnings.length; w++) {
            if (rewriteWarnings[w].line) rewriteWarnings[w].line += bodyOffset;
        }
        warnings = warnings.concat(rewriteWarnings);
        var unresolved = rewritten.unresolved || [];
        for (var ur = 0; ur < unresolved.length; ur++) {
            if (unresolved[ur].line) unresolved[ur].line += bodyOffset;
        }

        // MadMapper materials use materialColorForPixel() instead of main(),
        // and both entry points may need hoisted global initialisers.
        var cleaned = stripComments(rewritten.source);
        var hasMain = /\bvoid\s+main\s*\(/.test(cleaned);
        var isMadMapper = /\bmaterialColorForPixel\s*\(/.test(cleaned);
        var hoisted = hoistGlobalInitializers(rewritten.source);
        var finalBody = hoisted.body;
        if (isMadMapper && !hasMain) {
            var preludeAssignments = hoisted.assignments.length ? "    " + hoisted.assignments.join("\n    ") + "\n" : "";
            finalBody += "\n\nvoid main() {\n" + preludeAssignments + "    gl_FragColor = materialColorForPixel(isf_FragNormCoord);\n}\n";
        } else if (hasMain && hoisted.assignments.length) {
            finalBody = finalBody.replace(/void\s+main\s*\([^)]*\)\s*\{/, function (match) {
                return match + "\n    " + hoisted.assignments.join("\n    ");
            });
        }

        var uniformLines = [];
        var inputNameMap = {};
        for (var inputIndex = 0; inputIndex < inputs.length; inputIndex++) inputNameMap[inputs[inputIndex].name] = true;
        var constantLines = constantPreludeLines(finalBody, inputNameMap);
        var aliasLines = aliasPreludeLines(userFunctions);
        var shimLines = shims.prototypes.concat(shims.definitions);
        for (var u = 0; u < inputs.length; u++) {
            if (BUILTIN_NAMES[inputs[u].name]) {
                warnings.push({ message: "Input " + inputs[u].name + " shadows an ISF built-in and was ignored" });
                continue;
            }
            if (inputs[u].uniform === "sampler2D") continue; // declared with the image helpers below
            if (inputs[u].define) {
                var defineValue = null;
                if (inputs[u].values && inputs[u].values.length) {
                    var defineIndex = inputs[u].values.indexOf(inputs[u].defaultValue);
                    defineValue = String(defineIndex === -1 ? 0 : defineIndex);
                } else if (inputs[u].type === "bool" || inputs[u].type === "event") {
                    defineValue = inputs[u].default ? "true" : "false";
                } else if (inputs[u].type === "float" || inputs[u].type === "long") {
                    defineValue = String(inputs[u].default == null ? 0 : inputs[u].default);
                }
                if (defineValue !== null) {
                    uniformLines.push("#define " + inputs[u].name + " " + defineValue);
                    continue;
                }
            }
            uniformLines.push("uniform " + inputs[u].uniform + " " + inputs[u].name + ";");
        }
        for (var gg = 0; gg < generators.length; gg++) {
            if (BUILTIN_NAMES[generators[gg].name]) continue;
            uniformLines.push("uniform " + generators[gg].uniform + " " + generators[gg].name + ";");
        }
        for (var n = 0; n < imageInfo.length; n++) {
            uniformLines.push("uniform sampler2D " + imageInfo[n].name + ";");
            uniformLines.push("uniform vec2 _" + imageInfo[n].name + "_imgSize;");
            uniformLines.push("uniform vec4 _" + imageInfo[n].name + "_imgRect;");
            uniformLines.push("uniform bool _" + imageInfo[n].name + "_flip;");
        }

        var prelude = FRAGMENT_PRELUDE + (uniformLines.length ? uniformLines.join("\n") + "\n" : "") + (aliasLines.length ? aliasLines.join("\n") + "\n" : "") + (shimLines.length ? shimLines.join("\n") + "\n" : "") + (constantLines.length ? constantLines.join("\n") + "\n" : "");
        var fragment = prelude + finalBody;
        var preludeLines = (prelude.match(/\n/g) || []).length;

        var vertexSource = options.vertexShader;
        if (vertexSource) {
            vertexSource = renameBuiltinShadows(normalizeNumericSuffixes(normalizeTypeKeywords(expandIncludes(vertexSource, options.includes, warnings))));
            var vertexPrelude = aliasLines.concat(constantLines).concat(shimLines);
            if (vertexPrelude.length) vertexSource = vertexPrelude.join("\n") + "\n" + vertexSource;
        }
        var vertexInfo = buildVertexShader(vertexSource, uniformLines.join("\n"));
        var vertex = vertexInfo.source;

        return {
            ok: true,
            fragment: fragment,
            vertex: vertex,
            fragmentES3: toES3Fragment(fragment),
            vertexES3: toES3Vertex(vertex),
            // Literal-only promotion (the core's safe transform): no int
            // names, no shim positions, so only numeric literals and the
            // mm_* call coercions change.
            fragmentPromoted: promoteIntegerLiterals(fragment, assign({}, floatNames), {}, {}, {}, {}),
            vertexPromoted: promoteIntegerLiterals(vertex, assign({}, floatNames), {}, {}, {}, {}),
            fragmentES3Promoted: promoteIntegerLiterals(toES3Fragment(fragment), assign({}, floatNames), {}, {}, {}, {}),
            vertexES3Promoted: promoteIntegerLiterals(toES3Vertex(vertex), assign({}, floatNames), {}, {}, {}, {}),
            fragmentLoose: promoteIntegerLiterals(fragment, assign({}, floatNames), assign({}, intNames), shims.outIntNames, shims.intParamPositions, shims.intReturnFunctions),
            vertexLoose: promoteIntegerLiterals(vertex, assign({}, floatNames), assign({}, intNames), shims.outIntNames, shims.intParamPositions, shims.intReturnFunctions),
            fragmentES3Loose: promoteIntegerLiterals(toES3Fragment(fragment), assign({}, floatNames), assign({}, intNames), shims.outIntNames, shims.intParamPositions, shims.intReturnFunctions),
            vertexES3Loose: promoteIntegerLiterals(toES3Vertex(vertex), assign({}, floatNames), assign({}, intNames), shims.outIntNames, shims.intParamPositions, shims.intReturnFunctions),
            inputs: inputs,
            passes: passes,
            generators: generators,
            imports: imports,
            images: imageInfo,
            includes: options.includes || {},
            warnings: warnings,
            unresolved: unresolved,
            preludeLines: preludeLines,
            vertexPreludeLines: vertexInfo.preludeLines,
            bodyStartLine: parsed.bodyStartLine || 1,
            lineMap: function (generatedLine) {
                if (generatedLine <= preludeLines) return null;
                return (parsed.bodyStartLine || 1) + (generatedLine - preludeLines - 1);
            },
            vertexLineMap: function (generatedLine) {
                if (!vertexInfo.preludeLines || generatedLine <= vertexInfo.preludeLines) return null;
                return generatedLine - vertexInfo.preludeLines;
            }
        };
    }

    /* ==================================================================
     * Shadertoy / GLSL Sandbox → ISF conversion
     *
     * Mirrors the import feature of the official ISF Editor (VVISF-GL
     * ShadertoyConverter / GLSLSandboxConverter): map the well-known
     * uniforms and texture helpers onto ISF, wrap mainImage() in main() and
     * generate the metadata block. The docsify-isf pointer extension
     * `_isfMouse` (vec4, Shadertoy semantics) replaces iMouse/mouse.
     * ================================================================== */

    function detectShaderDialect(source) {
        var text = String(source == null ? "" : source);
        if (/\bvoid\s+mainImage\s*\(/.test(text)) return "shadertoy";
        if (/\buniform\s+float\s+time\b/.test(text) || /\bresolution\b/.test(text) && /\bgl_FragColor\b/.test(text)) return "glslsandbox";
        return "isf";
    }

    function convertToISF(source) {
        var text = String(source == null ? "" : source).replace(/\r\n?/g, "\n");
        var dialect = detectShaderDialect(text);
        var warnings = [];
        var inputLines = [];
        var body = text;
        var description;

        function replaceIdentifier(name, replacement) {
            var re = new RegExp("(^|[^A-Za-z0-9_])" + name + "(?![A-Za-z0-9_])", "g");
            body = body.replace(re, "$1" + replacement);
        }

        // Shadertoy / GLSL Sandbox code often declares its environment
        // uniforms; ISF hosts declare them, so the stale lines must go.
        function stripBuiltinUniforms() {
            body = body.replace(/^[ \t]*uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(?:float|vec2|vec3|vec4|int|bool)\s+(?:TIME|TIMEDELTA|RENDERSIZE|DATE|FRAMEINDEX|PASSINDEX|_isfMouse)\s*;[ \t]*$/gm, "");
        }

        if (dialect === "shadertoy") {
            description = "Converted from a Shadertoy mainImage() shader.";

            replaceIdentifier("iGlobalTime", "TIME");
            replaceIdentifier("iTimeDelta", "TIMEDELTA");
            replaceIdentifier("iTime", "TIME");
            replaceIdentifier("iResolution", "RENDERSIZE");
            replaceIdentifier("iFrame", "FRAMEINDEX");
            replaceIdentifier("iDate", "DATE");
            body = body.replace(/iChannelTime\s*\[\s*\d+\s*\]/g, "TIME");

            body = body.replace(/\btextureLod\s*\(([^,]+),([^,]+),[^)]+\)/g, "texture2D($1,$2)");
            body = body.replace(/\btextureGrad\s*\(([^,]+),([^,]+),[^)]+,[^)]+\)/g, "texture2D($1,$2)");
            body = body.replace(/\btexelFetch\s*\(([^,]+),\s*([^,]+),\s*[^)]+\)/g, "IMG_PIXEL($1, vec2($2))");
            body = body.replace(/\btexture\s*\(/g, "texture2D(");

            var channels = {};
            body.replace(/\biChannel([0-9])\b/g, function (match, index) { channels[index] = true; return match; });
            Object.keys(channels).sort().forEach(function (index) {
                inputLines.push('        { "NAME": "iChannel' + index + '", "TYPE": "image", "LABEL": "Channel ' + index + '" }');
            });
            body = body.replace(/iChannelResolution\s*\[\s*([0-9]+)\s*\]/g, function (match, index) {
                return "IMG_SIZE(iChannel" + index + ")";
            });

            var prelude = ["#define HW_PERFORMANCE 1"];
            if (/\biMouse\b/.test(body)) {
                prelude.push("#define iMouse _isfMouse");
                warnings.push("iMouse is fed from the pointer (xy = position, zw = click state).");
            }
            body = prelude.join("\n") + "\n\n" + body;
            body += "\n\nvoid main() {\n    mainImage(gl_FragColor, gl_FragCoord.xy);\n}\n";
        } else if (dialect === "glslsandbox") {
            description = "Converted from a GLSL Sandbox shader.";
            replaceIdentifier("time", "TIME");
            replaceIdentifier("resolution", "RENDERSIZE");
            if (/\bmouse\b/.test(body)) {
                body = body.replace(/(^|[^A-Za-z0-9_.])mouse(?![A-Za-z0-9_])/g, "$1_isfMouse.xy");
                warnings.push("mouse is fed from the pointer (pixels, origin bottom-left).");
            }
            if (/\bbackbuffer\b/.test(body)) warnings.push("backbuffer feedback is not supported in the browser viewer.");
        } else {
            return {
                ok: false,
                format: dialect,
                source: text,
                warnings: [],
                error: "This source already looks like ISF; only Shadertoy mainImage() and GLSL Sandbox shaders need conversion."
            };
        }

        stripBuiltinUniforms();
        var header = [
            "/*{",
            '    "DESCRIPTION": "' + description.replace(/"/g, '\\"') + '",',
            '    "CREDIT": "Converted to ISF by docsify-isf",',
            '    "ISFVSN": "2",',
            '    "CATEGORIES": [ "Converted" ],',
            '    "INPUTS": [',
            inputLines.join(",\n"),
            "    ]",
            "}*/",
            ""
        ].join("\n");

        return {
            ok: true,
            format: dialect,
            source: header + body,
            warnings: warnings,
            error: null
        };
    }

    /* ==================================================================
     * URLs, routes and fetching
     * ================================================================== */

    function currentRoutePath(vm) {
        try {
            if (vm && vm.route) {
                if (typeof vm.route.path === "string" && vm.route.path) return vm.route.path;
                if (typeof vm.route.file === "string" && vm.route.file) return vm.route.file;
            }
        } catch (err) { /* ignore */ }
        if (typeof window !== "undefined") {
            var hash = window.location.hash || "";
            if (hash.indexOf("#/") === 0) return hash.slice(1);
        }
        return "";
    }

    function normalizeRouteDir(routePath) {
        var clean = String(routePath || "").split("?")[0].split("#")[0];
        if (!clean) return "";
        if (clean.charAt(0) === "/") clean = clean.slice(1);
        if (/\.(md|markdown)$/i.test(clean)) clean = dirname(clean);
        if (clean && clean.charAt(clean.length - 1) !== "/") clean += "/";
        return clean;
    }

    function normalizePath(path) {
        var parts = String(path).replace(/\\/g, "/").split("/");
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (!part || part === ".") continue;
            if (part === "..") out.pop();
            else out.push(part);
        }
        return out.join("/");
    }

    function resolveAssetUrl(href, routePath) {
        var raw = String(href == null ? "" : href);
        if (/^(https?:)?\/\//i.test(raw)) return raw;
        if (/^(mailto:|tel:|data:|blob:|javascript:)/i.test(raw)) return raw;
        var base = (typeof document !== "undefined" && document.baseURI)
            ? document.baseURI
            : (typeof location !== "undefined" ? location.href : "");
        var siteDir = base ? dirname(base) : "";
        try {
            if (raw.indexOf("#/") === 0) {
                return new URL(normalizePath(raw.slice(2)), siteDir).toString();
            }
            if (raw.charAt(0) === "#") {
                var target = raw.slice(1);
                if (!target) return base;
                return new URL(normalizePath(target), siteDir).toString();
            }
            if (raw.charAt(0) === "/") {
                return new URL(normalizePath(raw), siteDir).toString();
            }
            var routeDir = normalizeRouteDir(routePath);
            var joined = normalizePath(routeDir + raw);
            return new URL(joined, siteDir).toString();
        } catch (err) {
            return raw;
        }
    }

    function resolveCandidates(href, routePath) {
        var primary = resolveAssetUrl(href, routePath);
        var candidates = [primary];
        var base = (typeof document !== "undefined" && document.baseURI)
            ? document.baseURI
            : (typeof location !== "undefined" ? location.href : "");
        var sameOrigin = true;
        try { sameOrigin = !base || new URL(primary).origin === new URL(base).origin; } catch (err) { sameOrigin = false; }
        if (/^https?:/i.test(primary) && sameOrigin) {
            // Legacy generated links look like `../<slug>.fs` while the file
            // actually lives at `<slug>/<slug>.fs` (and the page route is the
            // directory). Probe the sibling path on 404.
            var routeDir = normalizeRouteDir(routePath);
            var fallback = resolveAssetUrl(normalizePath(routeDir + basename(primary)), "");
            if (fallback !== primary) candidates.push(fallback);
        }
        var unique = [];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] && unique.indexOf(candidates[i]) === -1) unique.push(candidates[i]);
        }
        return unique;
    }

    function fetchText(url) {
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timer = null;
        if (controller) timer = setTimeout(function () { try { controller.abort(); } catch (err) { /* ignore */ } }, 20000);
        return fetch(url, { credentials: "same-origin", signal: controller ? controller.signal : undefined }).then(function (response) {
            if (!response.ok) {
                var error = new Error("HTTP " + response.status + " for " + url);
                error.status = response.status;
                throw error;
            }
            return response.text();
        }).then(function (text) {
            if (timer) clearTimeout(timer);
            return text;
        }, function (error) {
            if (timer) clearTimeout(timer);
            throw error;
        });
    }

    function fetchFirst(urls) {
        var index = 0;
        function attempt(lastError) {
            if (index >= urls.length) return Promise.reject(lastError || new Error("Nothing to fetch"));
            var url = urls[index++];
            return fetchText(url).catch(attempt);
        }
        return attempt(null);
    }

    function loadShaderText(urls) {
        var index = 0;
        function attempt(lastError) {
            if (index >= urls.length) {
                var message = "Unable to load shader" + (lastError && lastError.status ? " (HTTP " + lastError.status + ")" : "") + ": " + urls.join(", ");
                return Promise.reject(lastError || new Error(message));
            }
            var url = urls[index++];
            return fetchText(url).then(function (text) {
                return { text: text, url: url };
            }).catch(attempt);
        }
        return attempt(null);
    }

    // Resolve `#include` files recursively: first next to the .fs file, then in
    // each configured includePaths directory. Fetched text is cached for the
    // session so navigating between materials only downloads each helper once.
    var INCLUDE_CACHE = {};

    function fetchInclude(url) {
        if (!INCLUDE_CACHE[url]) {
            INCLUDE_CACHE[url] = fetchText(url).catch(function (error) {
                delete INCLUDE_CACHE[url];
                throw error;
            });
        }
        return INCLUDE_CACHE[url];
    }

    function loadIncludes(names, fromUrl, config, result, visited) {
        var list = names || [];
        if (!list.length) return Promise.resolve(result);
        var tasks = [];
        for (var i = 0; i < list.length; i++) {
            (function (name) {
                if (visited[name]) return;
                visited[name] = true;
                var candidates = [];
                var variants = includeNameVariants(name);
                for (var v = 0; v < variants.length; v++) {
                    var variant = variants[v];
                    candidates.push(new URL(variant, fromUrl).toString());
                    (config.includePaths || []).forEach(function (base) {
                        var root = resolveAssetUrl(String(base).replace(/\/?$/, "/") + variant, "");
                        if (candidates.indexOf(root) === -1) candidates.push(root);
                    });
                }
                tasks.push((function tryCandidate(index) {
                    if (index >= candidates.length) return Promise.resolve(null);
                    return fetchInclude(candidates[index]).then(function (text) {
                        result[name] = text;
                        if (variants[0] !== name) result[variants[0]] = text;
                        return loadIncludes(collectIncludes(text), new URL(name, fromUrl), config, result, visited);
                    }).catch(function () {
                        return tryCandidate(index + 1);
                    });
                })(0).catch(function () { /* reported as a missing include when expanded */ }));
            })(list[i]);
        }
        return Promise.all(tasks).then(function () { return result; });
    }

    /* ==================================================================
     * Styles
     * ================================================================== */

    var STYLE_ID = "docsify-isf-style";

    function ensureStyle() {
        if (typeof document === "undefined") return;
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = [
            ".isf-block{--isf-bg:#fff;--isf-drawer-bg:#fbfbfc;--isf-surface:#f6f7f9;--isf-surface-2:#eceef2;--isf-border:#e2e4e9;--isf-text:#1c1e22;--isf-muted:#6b7280;--isf-accent:var(--theme-color,#d374d6);--isf-accent-contrast:#fff;--isf-danger:#e5484d;--isf-code-bg:#16181d;--isf-code-text:#c8ccd4;--isf-code-com:#6b7280;--isf-code-kw:#c678dd;--isf-code-type:#e5c07b;--isf-code-fn:#61afef;--isf-code-isf:#56b6c2;--isf-code-num:#d19a66;--isf-code-str:#98c379;--isf-code-var:#e06c75;position:relative;margin:1.1rem 0;border:1px solid var(--isf-border);border-radius:12px;background:var(--isf-bg);overflow:hidden;box-shadow:0 10px 30px rgba(15,18,25,.09);contain:content}",
            "@media (prefers-color-scheme:dark){.isf-block{--isf-bg:#1e1f22;--isf-drawer-bg:#1b1c21;--isf-surface:#24262b;--isf-surface-2:#2b2d33;--isf-border:#34373e;--isf-text:#f0f1f3;--isf-muted:#9aa0a6;--isf-danger:#ff6369;--isf-code-bg:#131418}}",
            ".isf-block *{box-sizing:border-box}",
            ".isf-header{display:flex;align-items:center;gap:.5rem;padding:.42rem max(.55rem,env(safe-area-inset-left)) .42rem max(.55rem,env(safe-area-inset-right));border-bottom:1px solid color-mix(in srgb,var(--isf-border) 74%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--isf-surface) 93%,#fff 7%),var(--isf-surface));box-shadow:inset 0 1px 0 rgba(255,255,255,.035);position:relative;z-index:7}",
            ".isf-title{flex:1 1 auto;min-width:0;color:var(--isf-text);font-weight:600;font-size:.92rem;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
            ".isf-title:hover{text-decoration:underline;color:var(--isf-accent)}",
            ".isf-icon{display:block;width:15px;height:15px;fill:currentColor}",
            ".isf-actions{display:flex;align-items:center;gap:.25rem;flex-wrap:wrap;min-width:0;scrollbar-width:none}",
            ".isf-actions::-webkit-scrollbar{display:none}",
            ".isf-btn{display:inline-flex;align-items:center;justify-content:center;gap:.3rem;border:1px solid var(--isf-border);background:var(--isf-bg);color:var(--isf-text);border-radius:7px;padding:.25rem .4rem;font-size:.75rem;line-height:1;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background .12s ease,border-color .12s ease}",
            ".isf-btn:hover{background:var(--isf-surface-2)}",
            ".isf-pui-header{flex:1 1 auto;min-width:0;display:flex}",
            ".isf-pui-header .pui{width:100%;min-width:0;padding:0;background:transparent;border-radius:0;font-family:inherit;font-size:.92rem;color:var(--isf-text)}",
            ".isf-pui-header .pui-panel,.isf-pui-header .pui-page,.isf-pui-header .pui-section,.isf-pui-header .pui-fields{padding:0;margin:0;border:0;background:transparent;display:block}",
            ".isf-pui-header .pui-toolbar{border:0;background:transparent;padding:0;min-height:0;gap:.3rem;flex-wrap:nowrap;align-items:center;width:100%;min-width:0;max-width:100%}",
            ".isf-pui-header .pui-toolbar-link[data-pui-item=title]{display:flex;align-items:center;justify-content:flex-start;text-align:left;flex:1 1 auto;min-width:0;background:transparent;border-color:transparent;color:var(--isf-text);font-weight:650;font-size:.95rem;letter-spacing:-.01em;padding:0 .08rem;min-height:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}",
            ".isf-pui-header .pui-toolbar-link[data-pui-item=title]:hover{color:var(--isf-accent);text-decoration:underline}",
            ".isf-pui-header .pui-toolbar > .pui-button,.isf-pui-header .pui-toolbar > .pui-menu > .pui-menu-trigger{min-width:30px;min-height:30px;padding:.2rem .28rem;background:transparent;border-color:transparent;color:var(--isf-text);box-shadow:none;font-size:.75rem;border-radius:8px;transition:background .12s ease,border-color .12s ease,color .12s ease}",
            ".isf-pui-header .pui-toolbar > .pui-button:hover,.isf-pui-header .pui-toolbar > .pui-menu > .pui-menu-trigger:hover{background:var(--isf-surface-2);border-color:var(--isf-border)}",
            ".isf-pui-header .pui-toolbar > .pui-button[aria-pressed=true],.isf-pui-header .pui-toolbar > .pui-menu > .pui-menu-trigger[aria-expanded=true]{background:var(--isf-accent);border-color:var(--isf-accent);color:var(--isf-accent-contrast)}",
            ".isf-pui-header .pui-toolbar-separator{width:1px;height:18px;background:color-mix(in srgb,var(--isf-border) 80%,transparent);margin:0 .12rem;align-self:center}",
            ".isf-pui-header .pui-menu-popup{inset-inline-start:auto;inset-inline-end:0;min-width:240px;max-width:min(280px,calc(100vw - 24px));padding:6px;border-radius:10px;background:var(--isf-surface);border-color:var(--isf-border);box-shadow:0 18px 44px rgba(0,0,0,.4);z-index:80}",
            ".isf-pui-header .pui-menu-popup .pui-button{display:flex;align-items:center;gap:.55rem;width:100%;min-height:34px;padding:.38rem .55rem;border:0;border-radius:6px;background:transparent;color:var(--isf-text);font-size:.78rem;text-align:left}",
            ".isf-pui-header .pui-menu-popup .pui-button:hover{background:var(--isf-surface-2);border-color:transparent}",
            ".isf-pui-header .pui-menu-popup .pui-toolbar-icon{min-width:18px}",
            ".isf-pui-header .pui-menu-popup .pui-toolbar-icon svg{width:16px;height:16px}",
            ".isf-pui-header .pui-menu-popup .pui-toolbar-label{display:block;color:var(--isf-text);font-size:.78rem;font-weight:500;padding:0;white-space:nowrap}",
            ".isf-pui-header .pui-menu-popup .pui-toolbar-link{text-decoration:none}",
            ".isf-pui-header .pui-toolbar-link[data-pui-item=title] .pui-toolbar-badge{background:transparent;border:1px solid var(--isf-border);color:var(--isf-muted);border-radius:999px;padding:0 .32rem;margin-inline-start:.4rem;font-size:.58rem;letter-spacing:.05em;line-height:1.5;vertical-align:middle}",
            ".isf-pui-header .pui-toolbar-icon{min-width:16px}",
            ".isf-pui-header .pui-toolbar-icon svg{width:16px;height:16px;display:block}",
            ".isf-pui-header .pui-toolbar-badge{min-width:1.1em;padding:0 4px;border-radius:999px;background:var(--isf-accent);color:var(--isf-accent-contrast);font-size:.6rem;line-height:1.5;text-align:center}",
            ".isf-pui-header .pui-toolbar-readout[data-pui-item=stats]{display:inline-flex;padding:.12rem .5rem;border:1px solid var(--isf-border);border-radius:999px;background:var(--isf-surface-2);color:var(--isf-muted);font-size:.68rem;font-variant-numeric:tabular-nums;white-space:nowrap}",
            ".isf-pui-header .pui-toolbar-readout[data-pui-item=stats][hidden]{display:none}",
            ".isf-pui-header .pui-toolbar-readout-label{display:none}",
            ".isf-pui-header .pui-toolbar-readout-value{color:inherit;font-weight:400}",
            ".isf-pui-header .pui-toolbar.is-overflow-auto .pui-toolbar-link[data-pui-item=title]{flex:1 1 0;min-width:0}",
            "@media (max-width:600px){.isf-pui-header .pui-toolbar.is-overflow-auto .pui-toolbar-link[data-pui-item=title]{flex:1 1 0;order:0;font-size:.9rem}}",
            "@media (pointer:coarse){.isf-pui-header .pui-toolbar > .pui-button,.isf-pui-header .pui-toolbar > .pui-menu > .pui-menu-trigger{min-width:36px;min-height:36px}.isf-pui-header .pui-menu-popup .pui-button{min-height:36px}.isf-view select,.isf-view .isf-btn{min-height:36px}}",
            ".isf-btn[aria-pressed=true]{background:var(--isf-accent);border-color:var(--isf-accent);color:var(--isf-accent-contrast)}",
            ".isf-btn.is-active{background:var(--isf-accent);border-color:var(--isf-accent);color:var(--isf-accent-contrast)}",
            ".isf-count{font-variant-numeric:tabular-nums;font-size:.68rem;opacity:.75}",
            ".isf-body{position:relative;display:grid;grid-template-columns:minmax(0,1fr)}",
            ".isf-stage{position:relative;background:#0b0c10;min-height:110px;overflow:hidden}",
            ".isf-canvas{display:block;width:100%;height:100%}",
            ".isf-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:1rem;text-align:center;background:rgba(10,11,14,.72);color:#f5f6f8;font-size:.82rem;z-index:7}",
            ".isf-overlay-inner{max-width:34rem}",
            ".isf-overlay strong{display:block;margin-bottom:.3rem;font-size:.92rem}",
            ".isf-overlay code{background:rgba(255,255,255,.12);padding:.1rem .3rem;border-radius:4px;font-size:.78rem;word-break:break-all}",
            ".isf-overlay-btn{margin-top:.6rem;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:7px;padding:.35rem .7rem;font-size:.8rem;cursor:pointer}",
            ".isf-overlay-btn:hover{background:rgba(255,255,255,.2)}",
            ".isf-badge{display:inline-flex;align-items:center;flex:0 0 auto;background:var(--isf-surface-2);color:var(--isf-muted);border:1px solid var(--isf-border);border-radius:999px;padding:.12rem .5rem;font-size:.68rem;font-variant-numeric:tabular-nums;pointer-events:none;letter-spacing:.01em;white-space:nowrap}",
            ".isf-drawer{position:absolute;top:8px;bottom:8px;z-index:5;display:flex;flex-direction:column;width:min(352px,46%);max-width:calc(92% - 8px);background:var(--isf-drawer-bg);-webkit-backdrop-filter:blur(18px) saturate(135%);backdrop-filter:blur(18px) saturate(135%);border:1px solid var(--isf-border);border-radius:12px;overflow:hidden;transition:transform .18s ease,opacity .18s ease;box-shadow:0 18px 46px rgba(0,0,0,.34)}",
            ".isf-drawer-left{left:8px}",
            ".isf-drawer-right{right:8px}",
            ".isf-drawer.isf-drawer-closed{opacity:0;visibility:hidden;pointer-events:none}",
            ".isf-drawer-left.isf-drawer-closed{transform:translateX(-12px)}",
            ".isf-drawer-right.isf-drawer-closed{transform:translateX(12px)}",
            ".isf-drawer-inner{flex:1 1 auto;min-height:0;overflow:auto}",
            ".isf-drawer .isf-panel{background:transparent;border-bottom:1px solid var(--isf-border)}",
            ".isf-drawer .isf-editor-wrap{background:rgba(0,0,0,.12)}",
            ".isf-panel{display:flex;flex-direction:column;border-bottom:1px solid var(--isf-border)}",
            ".isf-panel:last-child{border-bottom:0}",
            ".isf-panel-title{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.55rem .75rem;font-size:.84rem;font-weight:600;color:var(--isf-text);background:color-mix(in srgb,var(--isf-surface) 92%,transparent);border-bottom:1px solid var(--isf-border);position:sticky;top:0;z-index:2;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
            ".isf-params-list{padding:0 .75rem .6rem}",
            ".isf-panel-intro{padding:.65rem .75rem .55rem;border-bottom:1px solid color-mix(in srgb,var(--isf-border) 70%,transparent);background:color-mix(in srgb,var(--isf-surface) 45%,transparent)}",
            ".isf-panel-intro-desc{margin:0;color:var(--isf-muted);font-size:.74rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
            ".isf-panel-intro-meta{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem .5rem;margin-top:.42rem;font-size:.66rem;color:var(--isf-muted)}",
            ".isf-panel-credit{color:var(--isf-muted)}",
            ".isf-panel-tag{border:1px solid color-mix(in srgb,var(--isf-border) 85%,transparent);border-radius:999px;padding:0 .4rem;font-size:.6rem;letter-spacing:.03em;color:var(--isf-muted);background:var(--isf-surface-2)}",
            ".isf-pui-note{padding:.5rem .65rem;font-size:.78rem;color:var(--isf-muted)}",
            ".isf-pui-note strong{display:block;margin-bottom:.2rem;color:var(--isf-text);font-size:.8rem}",
            ".isf-pui-note p{margin:0 0 .45rem}",
            ".isf-status{padding:.3rem .65rem;font-size:.74rem;color:var(--isf-muted);border-top:1px solid var(--isf-border);background:var(--isf-surface);white-space:pre-wrap}",
            ".isf-status.is-error{color:var(--isf-danger)}",
            ".isf-status.is-warn{color:#b7791f}",
            ".isf-status.is-pui{padding:0;border:0;background:transparent;white-space:normal}",
            ".isf-pui-statusbar{background:var(--isf-surface);border-top:1px solid var(--isf-border)}",
            ".isf-pui-statusbar .pui{width:100%;padding:0;background:transparent;border-radius:0;font-size:.74rem;color:var(--isf-muted)}",
            ".isf-pui-statusbar .pui-panel,.isf-pui-statusbar .pui-page,.isf-pui-statusbar .pui-section,.isf-pui-statusbar .pui-fields{padding:0;margin:0;border:0;background:transparent;display:block}",
            ".isf-pui-statusbar .pui-statusbar{border:0;background:transparent;padding:.3rem .65rem;min-height:0;gap:.5rem;font-size:.74rem;color:var(--isf-muted)}",
            ".isf-pui-statusbar .pui-statusbar-label{display:none}",
            ".isf-pui-statusbar .pui-statusbar-value{white-space:pre-wrap;font-weight:400;text-align:start;color:inherit}",
            ".isf-pui-statusbar .pui-statusbar-item{display:inline-flex;align-items:center;gap:.42rem}",
            ".isf-pui-statusbar .pui-statusbar-item::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--isf-muted);flex:0 0 auto}",
            ".isf-pui-statusbar .pui-statusbar-item[data-tone=success]::before{background:#3fb950;box-shadow:0 0 0 3px rgba(63,185,80,.13)}",
            ".isf-pui-statusbar .pui-statusbar-item[data-tone=warning]::before{background:#d29922}",
            ".isf-pui-statusbar .pui-statusbar-item[data-tone=error]::before{background:var(--isf-danger)}",
            ".isf-pui-statusbar .pui-statusbar-item[data-tone=info]::before{background:var(--isf-accent)}",
            ".isf-editor-wrap{display:flex;flex-direction:column;min-height:0;height:100%}",
            ".isf-editor-toolbar{display:flex;align-items:center;gap:.4rem;padding:.35rem .55rem;border-bottom:1px solid var(--isf-border);background:var(--isf-surface);flex-wrap:wrap;position:sticky;top:0;z-index:2}",
            ".isf-editor-status{flex:1 1 auto;min-width:0;font-size:.74rem;color:var(--isf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
            ".isf-editor-status.is-error{color:var(--isf-danger)}",
            ".isf-editor-status.is-ok{color:#3f9142}",
            ".isf-editor-actions{display:flex;flex-wrap:wrap;gap:.25rem;min-width:0}",
            ".isf-editor-folded-summary{display:none;flex:1 1 auto;min-width:0;font-size:.74rem;color:var(--isf-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
            ".isf-fold-btn{flex:0 0 auto;padding:.15rem .25rem}",
            ".isf-fold-btn .isf-icon{width:13px;height:13px;transition:transform .15s ease}",
            ".isf-editor-wrap.isf-toolbar-folded .isf-fold-btn .isf-icon{transform:rotate(-90deg)}",
            ".isf-editor-wrap.isf-toolbar-folded .isf-editor-toolbar{padding:.15rem .3rem;gap:.3rem;flex-wrap:nowrap}",
            ".isf-editor-wrap.isf-toolbar-folded .isf-editor-tabs,.isf-editor-wrap.isf-toolbar-folded .isf-editor-status,.isf-editor-wrap.isf-toolbar-folded .isf-editor-pos,.isf-editor-wrap.isf-toolbar-folded .isf-editor-actions{display:none}",
            ".isf-editor-wrap.isf-toolbar-folded .isf-editor-folded-summary{display:block}",
            ".isf-editor-actions .isf-btn{padding:.2rem .45rem}",
            ".isf-editor{position:relative;display:flex;flex:1 1 auto;min-height:160px;background:var(--isf-code-bg);color:var(--isf-code-text);overflow:hidden;font-size:12px}",
            ".isf-gutter{flex:0 0 auto;width:3em;padding:8px 4px 8px 0;text-align:right;overflow:hidden;background:rgba(255,255,255,.03);color:#565c66;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:inherit;line-height:1.55;white-space:pre;user-select:none}",
            ".isf-gutter-error{color:#ff7b72;font-weight:700}",
            ".isf-code{position:relative;flex:1 1 auto;min-width:0;overflow:hidden}",
            ".isf-editor .isf-highlight,.isf-editor .isf-input{position:absolute;inset:0;margin:0;border:0;padding:8px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:inherit;line-height:1.55;tab-size:2;-moz-tab-size:2;white-space:pre;word-wrap:normal;overflow:auto;background:transparent}",
            ".isf-editor .isf-highlight{pointer-events:none;color:var(--isf-code-text);z-index:1;overflow:hidden}",
            ".isf-editor .isf-highlight code{display:block;padding:0;margin:0;border:0;background:transparent;color:inherit;font:inherit;line-height:inherit;white-space:inherit}",
            ".isf-editor .isf-input{z-index:2;color:transparent;caret-color:#f0f1f3;resize:none;outline:none;box-shadow:none}",
            ".isf-editor .isf-input::selection{background:rgba(97,175,239,.35)}",
            ".isf-tok-com{color:var(--isf-code-com);font-style:italic}",
            ".isf-tok-pre{color:var(--isf-code-kw)}",
            ".isf-tok-str{color:var(--isf-code-str)}",
            ".isf-tok-num{color:var(--isf-code-num)}",
            ".isf-tok-kw{color:var(--isf-code-kw)}",
            ".isf-tok-type{color:var(--isf-code-type)}",
            ".isf-tok-fn{color:var(--isf-code-fn)}",
            ".isf-tok-isf{color:var(--isf-code-isf)}",
            ".isf-tok-var{color:var(--isf-code-var)}",
            ".isf-tok-op{color:var(--isf-code-text)}",
            ".isf-hidden{display:none!important}",
            ".isf-block:fullscreen{position:fixed;inset:0;margin:0;border:0;border-radius:0;display:flex;flex-direction:column;background:#0b0c10;contain:none}",
            ".isf-block:fullscreen .isf-header{background:rgba(20,22,26,.92);border-color:rgba(255,255,255,.1);flex:0 0 auto;position:relative;z-index:6}",
            ".isf-block:fullscreen .isf-header{padding-top:max(.5rem,env(safe-area-inset-top))}",
            ".isf-block:fullscreen .isf-title{color:#f0f1f3}",
            ".isf-block:fullscreen .isf-header .isf-btn{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.16);color:#f0f1f3}",
            ".isf-block:fullscreen .isf-body{flex:1 1 auto;display:grid;grid-template-columns:minmax(0,1fr)!important;min-height:0}",
            ".isf-block:fullscreen .isf-stage{height:100%;min-height:0}",
            ".isf-block:fullscreen .isf-stage{height:100%!important;min-height:0}",
            ".isf-block:fullscreen .isf-drawer{top:0;bottom:0;width:min(480px,44vw)}",
            ".isf-block:fullscreen .isf-editor{min-height:220px}",
            ".isf-block:fullscreen .isf-status{color:var(--isf-muted);background:rgba(20,22,26,.92);border-color:rgba(255,255,255,.1);flex:0 0 auto}",
            ".isf-block:fullscreen .isf-pui-statusbar,.isf-block.isf-fullscreen .isf-pui-statusbar{background:rgba(20,22,26,.92);border-top-color:rgba(255,255,255,.1)}",
            ".isf-block:fullscreen .isf-pui-statusbar .pui-statusbar-value,.isf-block.isf-fullscreen .isf-pui-statusbar .pui-statusbar-value{color:var(--isf-muted)}",
            ".isf-pui-toolbar{display:none}",
            ".isf-block:fullscreen.isf-has-pui-toolbar .isf-header,.isf-block.isf-fullscreen.isf-has-pui-toolbar .isf-header{display:none}",
            ".isf-block:fullscreen.isf-has-pui-toolbar .isf-pui-toolbar,.isf-block.isf-fullscreen.isf-has-pui-toolbar .isf-pui-toolbar{display:block}",
            ".isf-pui-toolbar .pui{padding:0;background:transparent;border-radius:0;font-family:inherit;font-size:.8rem;color:var(--isf-text)}",
            ".isf-pui-toolbar .pui-drawer-trigger{position:fixed;top:max(10px,env(safe-area-inset-top));left:50%;right:auto;transform:translateX(-50%);z-index:2147483001;min-height:34px;padding:.38rem .8rem;border:1px solid color-mix(in srgb,var(--isf-border) 80%,transparent);border-radius:999px;background:var(--isf-drawer-bg);color:var(--isf-text);font-size:.74rem;font-weight:600;letter-spacing:.02em;box-shadow:0 8px 22px rgba(0,0,0,.28);-webkit-backdrop-filter:blur(14px) saturate(150%);backdrop-filter:blur(14px) saturate(150%);transition:background .12s ease,border-color .12s ease}",
            ".isf-pui-toolbar .pui-drawer.is-open .pui-drawer-trigger{display:none}",
            "@media (max-width:760px){.isf-block.isf-drawer-open .isf-pui-toolbar .pui-drawer-trigger{display:none}}",
            ".isf-pui-toolbar .pui-drawer-panel{background:var(--isf-drawer-bg);color:var(--isf-text);border-color:var(--isf-border);-webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%)}",
            ".isf-pui-toolbar .pui-drawer-panel.is-top{top:max(10px,env(safe-area-inset-top));left:50%;right:auto;transform:translateX(-50%);width:min(760px,calc(100vw - 24px));border:1px solid var(--isf-border);border-radius:12px;overflow:hidden;box-shadow:0 18px 46px rgba(0,0,0,.42)}",
            ".isf-pui-toolbar .pui-drawer-head{border-color:var(--isf-border);padding:.45rem .7rem}",
            ".isf-pui-toolbar .pui-drawer-head h4{font-size:.8rem;color:var(--isf-text)}",
            ".isf-pui-toolbar .pui-drawer-close{color:var(--isf-muted);font-size:1rem}",
            ".isf-pui-toolbar .pui-drawer-body{padding:.55rem .7rem}",
            ".isf-pui-toolbar .pui-toolbar{border-bottom:0;background:transparent;padding:0;min-height:0}",
            ".isf-pui-toolbar .pui-actions{gap:.4rem}",
            ".isf-pui-toolbar .pui-button{font-size:.75rem;background:var(--isf-surface);border-color:var(--isf-border);color:var(--isf-text)}",
            ".isf-pui-toasts{position:fixed;inset:0;z-index:2147483002;pointer-events:none}",
            ".isf-pui-toasts .pui{padding:0;background:transparent;border-radius:0;pointer-events:none}",
            ".isf-pui-toasts .pui-toast-region{pointer-events:none}",
            ".isf-pui-toasts .pui-toast{pointer-events:auto;background:var(--isf-surface)}",


            "/* bare mode: a self-contained fullscreen viewer for OBS browser sources */",
            ".isf-block.isf-bare{position:fixed;inset:0;margin:0;border:0;border-radius:0;z-index:2147483000;background:#000;display:flex;flex-direction:column;contain:none;box-shadow:none}",
            ".isf-bare:not(.isf-revealed) .isf-header,.isf-bare:not(.isf-revealed) .isf-status,.isf-bare:not(.isf-revealed) .isf-drawer{display:none!important}",
            ".isf-bare .isf-body{flex:1 1 auto;display:grid;grid-template-columns:minmax(0,1fr)!important;min-height:0}",
            ".isf-bare .isf-stage{height:100%!important;min-height:0;aspect-ratio:auto!important}",
            ".isf-reveal-btn{position:absolute;right:10px;bottom:10px;z-index:2147483002;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:rgba(12,13,16,.55);color:#e7e9ee;opacity:0;cursor:pointer;transition:opacity .16s ease;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}",
            ".isf-reveal-btn .isf-icon{width:18px;height:18px}",
            ".isf-bare:hover .isf-reveal-btn,.isf-bare .isf-reveal-btn:focus-visible{opacity:.45}",
            ".isf-bare .isf-reveal-btn:hover{opacity:1}",
            ".isf-bare.isf-revealed .isf-reveal-btn{opacity:.85}",

            "/* audit: focus, resizers, caret line, touch and reduced motion */",
            ".isf-block :focus-visible{outline:2px solid var(--isf-accent);outline-offset:2px;border-radius:4px}",
            ".isf-btn:focus-visible{outline-offset:1px}",
            ".isf-canvas:focus-visible{outline:2px solid var(--isf-accent);outline-offset:-2px}",
            ".isf-resize-y{position:relative;flex:0 0 auto;height:9px;cursor:ns-resize;touch-action:none;background:var(--isf-surface);border-bottom:1px solid var(--isf-border);z-index:3}",
            ".isf-resize-y::after{content:'';position:absolute;left:50%;top:3px;width:34px;height:2px;transform:translateX(-50%);border-radius:2px;background:var(--isf-border)}",
            ".isf-resize-y:hover::after,.isf-resize-y:focus-visible::after,.isf-resize-y.is-dragging::after{background:var(--isf-accent)}",
            ".isf-resize-x{position:absolute;top:0;bottom:0;width:8px;cursor:ew-resize;touch-action:none;z-index:6;display:block}",
            ".isf-resize-left{left:auto;right:-4px}",
            ".isf-resize-right{left:-4px;right:auto}",
            ".isf-resize-x::after{content:'';position:absolute;top:50%;left:3px;width:2px;height:36px;transform:translateY(-50%);border-radius:2px;background:var(--isf-border)}",
            ".isf-resize-x:hover::after,.isf-resize-x:focus-visible::after,.isf-resize-x.is-dragging::after{background:var(--isf-accent)}",
            ".isf-active-line{position:absolute;left:0;right:0;top:0;height:0;background:rgba(255,255,255,.055);pointer-events:none;z-index:0;border-radius:2px}",
            ".isf-gutter-error{color:#ff7b72;font-weight:700}",
            ".isf-editor-pos{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--isf-muted);font-size:.7rem;white-space:nowrap}",
            ".isf-editor-tabs{display:flex;gap:.2rem;flex:0 0 auto}",
            ".isf-tab{opacity:.75}",
            ".isf-tab.is-active{opacity:1;background:var(--isf-accent);border-color:var(--isf-accent);color:var(--isf-accent-contrast)}",
            ".isf-template-select{border:1px solid var(--isf-border);border-radius:6px;background:var(--isf-bg);color:var(--isf-text);font-size:.72rem;padding:.18rem .25rem;max-width:9.5rem}",
            ".isf-editor-actions .isf-template-menu{display:inline-flex;flex:0 0 auto}",
            ".isf-editor-actions .isf-template-menu .pui-menu-trigger{display:inline-flex;align-items:center;gap:.25rem;min-height:26px;padding:.2rem .5rem;border:1px solid var(--isf-border);border-radius:6px;background:var(--isf-bg);color:var(--isf-text);font-size:.72rem;font-weight:500;line-height:1}",
            ".isf-editor-actions .isf-template-menu .pui-menu-trigger:hover{background:var(--isf-surface-2)}",
            ".isf-editor-actions .isf-template-menu .pui-toolbar-label{color:inherit;font-size:.72rem;font-weight:500;padding:0}",
            ".isf-editor-actions .isf-template-menu .pui-toolbar-icon{min-width:12px}",
            ".isf-editor-actions .isf-template-menu .pui-toolbar-icon svg{width:12px;height:12px}",
            ".isf-editor-actions .isf-template-menu .pui-menu-popup{inset-inline-start:auto;inset-inline-end:0;min-width:200px;max-height:220px;overflow:auto;padding:5px;border:1px solid var(--isf-border);border-radius:8px;background:var(--isf-surface);box-shadow:0 14px 32px rgba(0,0,0,.38);z-index:30}",
            ".isf-editor-actions .isf-template-menu .pui-menu-popup .pui-button{display:flex;align-items:center;min-height:30px;padding:.35rem .5rem;border:0;border-radius:5px;background:transparent;color:var(--isf-text);font-size:.74rem;text-align:left}",
            ".isf-editor-actions .isf-template-menu .pui-menu-popup .pui-button:hover{background:var(--isf-surface-2)}",
            ".isf-editor-actions .isf-template-menu .pui-menu-popup .pui-toolbar-label{color:var(--isf-text);font-size:.74rem;font-weight:400;padding:0;white-space:nowrap}",
            ".isf-editor-actions .isf-template-menu .pui-menu-label{padding:.3rem .5rem;color:var(--isf-muted);font-size:.6rem;letter-spacing:.05em;text-transform:uppercase}",
            ".isf-view{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem .6rem;padding:.55rem .75rem .6rem;border-top:1px solid color-mix(in srgb,var(--isf-border) 70%,transparent);background:color-mix(in srgb,var(--isf-surface) 35%,transparent)}",
            ".isf-view-heading{flex:1 1 100%;font-size:.62rem;text-transform:uppercase;letter-spacing:.07em;color:var(--isf-muted);font-weight:650;margin-bottom:.05rem}",
            ".isf-view-row{display:inline-flex;align-items:center;gap:.35rem;font-size:.75rem;color:var(--isf-muted)}",
            ".isf-view-label{text-transform:uppercase;letter-spacing:.04em;font-size:.62rem;color:var(--isf-muted)}",
            ".isf-view select{border:1px solid var(--isf-border);border-radius:6px;background:var(--isf-surface-2);color:var(--isf-text);font-size:.75rem;padding:.24rem .35rem;max-width:10rem;min-height:28px}",
            ".isf-view select:focus-visible{outline:2px solid var(--isf-accent);outline-offset:1px}",
            ".isf-view-value{font-variant-numeric:tabular-nums;font-size:.72rem;color:var(--isf-muted);min-width:3.6rem;text-align:right}",
            ".isf-view .isf-btn{background:var(--isf-surface-2);border-color:var(--isf-border);border-radius:6px;padding:.3rem .55rem;font-size:.75rem}",
            ".isf-view .isf-btn:hover{background:color-mix(in srgb,var(--isf-surface-2) 80%,var(--isf-text) 8%)}",
            ".isf-time-range{flex:1 1 7rem;min-width:0;max-width:12rem;accent-color:var(--isf-accent)}",
            ".isf-stage.isf-dragover::after{content:'Drop image here';position:absolute;inset:8px;display:flex;align-items:center;justify-content:center;border:2px dashed var(--isf-accent);border-radius:10px;background:rgba(0,0,0,.45);color:#fff;font-size:.9rem;z-index:4;pointer-events:none}",
            ".isf-error-list{margin:.5rem 0 0;font-size:.76rem;text-align:left}",
            ".isf-error-list summary{cursor:pointer;color:#f5c2c7}",
            ".isf-error-list ul{margin:.3rem 0 0;padding-left:1.1rem}",
            ".isf-error-list li{margin:.15rem 0}",
            ".isf-error-jump{border:1px solid rgba(255,255,255,.3);background:rgba(255,255,255,.12);color:#fff;border-radius:5px;padding:.05rem .3rem;font-size:.7rem;cursor:pointer;margin-right:.25rem}",
            ".isf-shortcuts{display:grid;gap:.3rem;margin:.6rem 0 0;text-align:left;max-height:12rem;overflow:auto}",
            ".isf-shortcut{display:flex;gap:.5rem;align-items:baseline;font-size:.78rem}",
            ".isf-shortcut kbd{flex:0 0 auto;min-width:8.5rem;text-align:right;color:#f5c2c7;font-family:inherit}",
            ".isf-shortcut span{color:#e7e9ee}",
            ".isf-import{display:flex;flex-direction:column;gap:.4rem;padding:.5rem .65rem}",
            ".isf-import textarea{width:100%;min-height:140px;resize:vertical;border:1px solid var(--isf-border);border-radius:8px;background:var(--isf-code-bg);color:var(--isf-code-text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;padding:.5rem;white-space:pre;overflow:auto}",
            ".isf-import-actions{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap}",
            ".isf-import-status{flex:1 1 auto;font-size:.72rem;color:var(--isf-muted)}",
            ".isf-panel-close{padding:.18rem .4rem;font-size:.85rem;line-height:1}",
            ".isf-keys-btn{padding:.18rem .4rem;font-weight:700}",
            ".isf-overlay-actions{display:flex;gap:.4rem;justify-content:center;flex-wrap:wrap;margin-top:.6rem}",
            ".isf-overlay pre{margin:.5rem 0 0;padding:.5rem .6rem;border-radius:6px;background:rgba(0,0,0,.35);color:#ffb4b8;text-align:left;font-size:.74rem;max-height:8rem;overflow:auto;white-space:pre-wrap}",
            ".isf-spinner{width:22px;height:22px;margin:0 auto .5rem;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:isf-spin .8s linear infinite}",
            "@keyframes isf-spin{to{transform:rotate(360deg)}}",
            "@media (pointer:coarse){.isf-import textarea,.isf-template-select{font-size:16px}.isf-btn{min-width:36px;min-height:36px;padding:.42rem .55rem}.isf-btn .isf-icon{width:17px;height:17px}.isf-panel-close{min-width:36px;min-height:36px;display:inline-flex;align-items:center;justify-content:center}}",
            "@media (prefers-reduced-motion:reduce){.isf-spinner{animation:none}.isf-btn{transition:none}.isf-block *{scroll-behavior:auto}}",
            "@media (max-width:600px){.isf-header{flex-wrap:wrap;row-gap:.35rem;padding:.45rem max(.5rem,env(safe-area-inset-left)) .45rem max(.5rem,env(safe-area-inset-right))}.isf-pui-header{flex:1 1 100%}.isf-pui-header .pui-toolbar{flex-wrap:wrap;row-gap:.3rem}.isf-pui-header .pui-toolbar-link[data-pui-item=title]{flex:1 1 100%;order:-1;font-size:.95rem}.isf-pui-header .pui-toolbar-spacer{display:none}.isf-pui-header .pui-toolbar-readout[data-pui-item=stats]{order:2;margin-inline-start:auto}.isf-drawer{top:0;bottom:0;left:0;right:0;width:100%!important;max-width:100vw;border-radius:0;border:0}.isf-resize-x{display:none}.isf-editor{min-height:0}.isf-template-select{max-width:100%}.isf-editor-status{flex:1 1 100%}.isf-editor-pos{display:none}.isf-panel-title{padding:.45rem .6rem}}",
            // Auto-overflow headers stay on one measured row; the title may
            // shrink, while the stats pill and the More trigger stay inline.
            ".isf-pui-header .pui-toolbar.is-overflow-auto{flex-wrap:nowrap;row-gap:0}",
            ".isf-pui-header .pui-toolbar.is-overflow-auto .pui-toolbar-link[data-pui-item=title]{flex:0 1 auto;order:0;min-width:0;max-width:50%;font-size:.9rem}",
            ".isf-pui-header .pui-toolbar.is-overflow-auto .pui-toolbar-spacer{display:none}",
            ".isf-pui-header .pui-toolbar.is-overflow-auto .pui-toolbar-readout[data-pui-item=stats]{order:0;margin-inline-start:0;flex:0 0 auto}",
            /* PUI bridge: loaded on demand, but the host palette is always
               available once the renderer mounts. */
            ".isf-pui{font-size:.8rem;line-height:1.35}",
            ".isf-pui .pui{--pui-font:inherit;--pui-bg:transparent;--pui-surface:transparent;--pui-surface-2:var(--isf-surface-2);--pui-text:var(--isf-text);--pui-muted:var(--isf-muted);--pui-border:var(--isf-border);--pui-accent:var(--isf-accent);--pui-accent-text:var(--isf-accent-contrast);--pui-danger:var(--isf-danger);--pui-radius:7px;font-family:inherit;font-size:.8rem}",
            ".isf-pui .pui output{display:inline;padding:0;margin:0;border:0;border-radius:0;position:static;background:none}",
            ".isf-pui .pui-caption{color:var(--isf-muted)}",
            ".isf-pui .pui-caption:hover{color:var(--isf-text)}",
            ".isf-pui .pui-number-input{max-width:4.2em}",
            "@container (min-width:301px){.isf-pui .pui-field{grid-template-columns:minmax(84px,32%) minmax(0,1fr) auto;align-items:center}.isf-pui .pui-caption,.isf-pui .pui-control-row,.isf-pui .pui-switch{grid-column:auto}.isf-pui .pui-field>.pui-button{grid-column:1/-1;justify-self:start}.isf-pui .pui-actions{grid-column:1/-1}.isf-pui .pui-field-help,.isf-pui .pui-status{margin-inline-start:0}}",
            ".isf-pui .pui-actions{justify-content:flex-start}",
            ".isf-pui .pui-button{font-size:.75rem;font-weight:500}",
            ".isf-pui .pui-field{padding:.4rem 0}",
            ".isf-pui .pui-scrub{display:none}",
            ".isf-pui .pui-caption{font-size:.76rem;font-weight:500}",
            ".isf-pui .pui-switch input[type=checkbox]{appearance:none;-webkit-appearance:none;inline-size:36px;block-size:20px;border-radius:999px;border:1px solid var(--isf-border);background:var(--isf-surface-2);position:relative;cursor:pointer;transition:background .15s ease,border-color .15s ease}",
            ".isf-pui .pui-switch input[type=checkbox]::before{content:'';position:absolute;inline-size:14px;block-size:14px;border-radius:50%;background:var(--isf-muted);inset-block-start:2px;inset-inline-start:2px;transition:transform .15s ease,background .15s ease}",
            ".isf-pui .pui-switch input[type=checkbox]:checked{background:var(--isf-accent);border-color:var(--isf-accent)}",
            ".isf-pui .pui-switch input[type=checkbox]:checked::before{transform:translateX(16px);background:var(--isf-accent-contrast)}",
            "@media (pointer:coarse){.isf-pui .pui input,.isf-pui .pui select,.isf-pui .pui button{font-size:16px}}"
        ].join("\n");
        document.head.appendChild(style);
    }

    /* ==================================================================
     * DOM helpers and icons
     * ================================================================== */

    function h(tag, className, attrs) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        if (attrs) {
            for (var key in attrs) {
                if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
                if (key === "text") el.textContent = attrs[key];
                else if (key === "html") el.innerHTML = attrs[key];
                else if (key === "style") el.style.cssText = attrs[key];
                else if (key === "dataset") { for (var d in attrs[key]) el.dataset[d] = attrs[key][d]; }
                else el.setAttribute(key, attrs[key]);
            }
        }
        for (var i = 3; i < arguments.length; i++) {
            var child = arguments[i];
            if (child == null) continue;
            el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
        }
        return el;
    }

    var ICONS = {
        params: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M4 12h6M14 12h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="16" cy="7" r="2" fill="currentColor"/><circle cx="10" cy="17" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>',
        editor: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6 2 12l6 6M16 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        play: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5 19.5 12 7 19.5z" fill="currentColor"/></svg>',
        pause: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>',
        reset: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        fullscreen: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
        source: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10m0 0 4-4m-4 4-4-4M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        share: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
        copy: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9h10v10H9zM5 15V5h10" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
        check: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 12 5 5L20 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        eye: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
        chevron: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
        more: '<svg class="isf-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>'
    };

    var HEADER_ICON_NAMES = ["editor", "params", "play", "pause", "reset", "fullscreen", "source", "share", "more"];
    var HEADER_ICONS = {};
    HEADER_ICON_NAMES.forEach(function (name) {
        HEADER_ICONS[name] = function () {
            var markup = ICONS[name];
            if (!markup) return null;
            var wrap = document.createElement("span");
            wrap.innerHTML = markup;   // host-owned constants, never document data
            return wrap.firstChild || null;
        };
    });

    function iconButton(action, icon, title, extraClass) {
        var button = h("button", "isf-btn" + (extraClass ? " " + extraClass : ""), {
            type: "button",
            title: title,
            "aria-label": title,
            dataset: { isfAction: action, puiItem: action }
        });
        button.innerHTML = ICONS[icon] || "";
        return button;
    }

    /* ==================================================================
     * Test images (default sources for image inputs)
     * ================================================================== */

    function createTestPattern(width, height, variant) {
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        var hueBase = variant === "b" ? 190 : 280;
        var gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "hsl(" + hueBase + ",70%,32%)");
        gradient.addColorStop(0.5, "hsl(" + ((hueBase + 60) % 360) + ",65%,45%)");
        gradient.addColorStop(1, "hsl(" + ((hueBase + 140) % 360) + ",70%,22%)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Colour bars along the top.
        var bars = ["#ffffff", "#ffff00", "#00ffff", "#00ff00", "#ff00ff", "#ff0000", "#0000ff", "#000000"];
        var barWidth = width / bars.length;
        for (var b = 0; b < bars.length; b++) {
            ctx.fillStyle = bars[b];
            ctx.fillRect(b * barWidth, 0, barWidth, height * 0.14);
        }

        // Grid.
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.lineWidth = 1;
        var step = Math.max(24, Math.round(width / 12));
        for (var x = step; x < width; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (var y = step; y < height; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }

        // Centre circles.
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.lineWidth = Math.max(2, width / 160);
        for (var r = width * 0.12; r < width * 0.42; r += width * 0.12) {
            ctx.beginPath();
            ctx.arc(width * 0.5, height * 0.55, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Corner swatches.
        var swatch = width * 0.16;
        var corners = [
            [0, height - swatch, "rgba(255,255,255,.9)"],
            [width - swatch, height - swatch, "rgba(0,0,0,.6)"],
            [width - swatch, height * 0.14, "rgba(255,120,0,.85)"],
            [0, height * 0.14, "rgba(0,160,255,.85)"]
        ];
        for (var c = 0; c < corners.length; c++) {
            ctx.fillStyle = corners[c][2];
            ctx.fillRect(corners[c][0], corners[c][1], swatch, swatch);
        }

        // Label.
        ctx.fillStyle = "rgba(255,255,255,.92)";
        ctx.font = "bold " + Math.round(width / 12) + "px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(variant === "b" ? "ISF B" : "ISF A", width / 2, height * 0.55);
        ctx.font = Math.round(width / 26) + "px system-ui, sans-serif";
        ctx.fillText("docsify-isf test pattern", width / 2, height * 0.68);
        return canvas;
    }

    /* ==================================================================
     * Colour helpers
     * ================================================================== */

    function clamp01(value) { return clamp(value, 0, 1); }

    function colorToHex(rgba) {
        function channel(value) {
            var v = Math.round(clamp01(value) * 255);
            var hex = v.toString(16);
            return hex.length < 2 ? "0" + hex : hex;
        }
        return "#" + channel(rgba[0]) + channel(rgba[1]) + channel(rgba[2]);
    }

    function hexToColor(hex) {
        var match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
        if (!match) return null;
        var value = parseInt(match[1], 16);
        return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
    }

    // Clamp a parameter value to the constraints declared by the ISF metadata.
    // The controls already constrain their widgets, but programmatic calls
    // (console, DocsifyISF API, restored layout state) must respect MIN/MAX too.
    function clampInputValue(input, value) {
        if (!input) return value;
        switch (input.type) {
            case "float":
            case "animator":
            case "shaper":
            case "incrementer":
            case "damper":
            case "pass_thru":
            case "linear_filter":
            case "adsr": {
                var lower = input.boundedMin === true ? input.min : -Infinity;
                var upper = input.boundedMax === true ? input.max : Infinity;
                return clamp(numberOr(value, input.default), lower, upper);
            }
            case "floatRange": {
                var range = Array.isArray(value) ? value : input.default;
                return [
                    clamp(numberOr(range[0], input.default[0]), input.min[0], input.max[0]),
                    clamp(numberOr(range[1], input.default[1]), input.min[1], input.max[1])
                ];
            }
            case "long": {
                if (input.values && input.values.length) {
                    // The shader uniform is the 0-based *index* for label sets
                    // (`["Red","Green",…]` compared with `== 0`) and the
                    // numeric entry for value sets (`[1..9]`); the panel's
                    // <select> also stores the index. Resolve both shapes to
                    // the shader value (isf/header.lua's long_shader_value).
                    var longLabels = input.labels && input.labels.length ? input.labels : input.values.map(String);
                    var longValue = value;
                    if (typeof longValue === "string") {
                        var labelIndex = longLabels.indexOf(longValue);
                        if (labelIndex !== -1) {
                            var mapped = input.values[labelIndex];
                            return typeof mapped === "number" && isFinite(mapped) ? mapped : labelIndex;
                        }
                        var parsedLabel = Number(longValue);
                        longValue = isFinite(parsedLabel) ? parsedLabel : 0;
                    }
                    var numericLong = Number(longValue);
                    if (!isFinite(numericLong)) numericLong = 0;
                    var hasNumericValues = false;
                    for (var valueIndex = 0; valueIndex < input.values.length; valueIndex++) {
                        if (isFinite(Number(input.values[valueIndex]))) hasNumericValues = true;
                    }
                    if (hasNumericValues) {
                        var bestLong = Number(input.values[0]);
                        var bestLongDistance = Infinity;
                        for (var longIndex = 0; longIndex < input.values.length; longIndex++) {
                            var candidate = Number(input.values[longIndex]);
                            if (!isFinite(candidate)) continue;
                            var longDistance = Math.abs(candidate - numericLong);
                            if (longDistance < bestLongDistance) { bestLongDistance = longDistance; bestLong = candidate; }
                        }
                        return bestLong;
                    }
                    return Math.max(0, Math.min(input.values.length - 1, Math.round(numericLong)));
                }
                var integer = Math.round(numberOr(value, input.defaultValue));
                if (input.min != null) integer = Math.max(input.min, integer);
                if (input.max != null) integer = Math.min(input.max, integer);
                return integer;
            }
            case "point2D": {
                var point = Array.isArray(value) ? value : input.default;
                return [
                    clamp(numberOr(point[0], input.default[0]), input.min[0], input.max[0]),
                    clamp(numberOr(point[1], input.default[1]), input.min[1], input.max[1])
                ];
            }
            case "color": {
                var color = Array.isArray(value) ? value : input.default;
                return [
                    clamp(numberOr(color[0], 0), 0, 1),
                    clamp(numberOr(color[1], 0), 0, 1),
                    clamp(numberOr(color[2], 0), 0, 1),
                    clamp(numberOr(color[3], 1), 0, 1)
                ];
            }
            case "bool":
            case "event":
                return !!value;
            default:
                return value;
        }
    }

    /* ==================================================================
     * On-demand PUI assets
     *
     * docsify pages without an ISF viewer should not download the common UI
     * renderer. The first viewer with parameters loads the renderer, adapter
     * and CSS from the sibling vendor directory; legacy rows remain the
     * fallback if that request fails.
     * ================================================================== */

    function puiBase() {
        if (PUI_BASE) return PUI_BASE;
        var configured = getConfig().puiBase;
        if (configured) {
            PUI_BASE = String(configured).replace(/\/?$/, "/");
            return PUI_BASE;
        }
        var src = SCRIPT_SRC;
        if (!src && typeof document !== "undefined" && document.currentScript) {
            src = document.currentScript.src || "";
        }
        try {
            PUI_BASE = new URL("vendor/pupitre-ui/", src || (typeof location !== "undefined" ? location.href : "")).toString();
        } catch (error) {
            PUI_BASE = "vendor/pupitre-ui/";
        }
        return PUI_BASE;
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error("Could not load " + src)); };
            document.head.appendChild(script);
        });
    }

    function loadPUI() {
        if (puiAvailable()) return Promise.resolve();
        if (puiLoading) return puiLoading;
        puiLoading = new Promise(function (resolve, reject) {
            var base = puiBase();
            var css = document.createElement("link");
            css.rel = "stylesheet";
            css.href = base + "pupitre-ui.css";
            document.head.appendChild(css);
            loadScript(base + "pupitre-ui.js")
                .then(function () { return loadScript(base + "isf.js"); })
                .then(resolve, reject);
        }).catch(function (error) {
            puiLoading = null;
            throw error;
        });
        return puiLoading;
    }

    /* ==================================================================
     * Parameter controls
     * ================================================================== */

    function isTransitionShader(inputs) {
        var has = {};
        for (var i = 0; i < inputs.length; i++) has[inputs[i].name] = true;
        return !!(has.startImage && has.endImage && has.progress);
    }

    function puiAvailable() {
        return typeof PupitreUI !== "undefined" && !!PupitreUI &&
            typeof PupitreISF !== "undefined" && !!PupitreISF;
    }

    /** Visible fallback when the on-demand PUI assets are missing: a
     * diagnostic and a retry, not a second control implementation. */
    function renderPUIStatus(container, viewer, loading) {
        container.innerHTML = "";
        var note = h("div", "isf-pui-note", { role: loading ? "status" : "alert" });
        note.appendChild(h("strong", null, { text: loading ? "Loading parameter controls…" : "Parameter controls unavailable" }));
        note.appendChild(h("p", null, {
            text: loading
                ? "The shared Pupitre UI renderer is loading."
                : "The shared Pupitre UI assets could not load. Deploy vendor/pupitre-ui/ next to docsify-isf.js, or set isf.puiBase; the shader still renders."
        }));
        if (!loading) {
            var retry = h("button", "isf-btn", { type: "button", text: "Retry" });
            retry.addEventListener("click", function () {
                viewer.puiLoadError = false;
                viewer.rebuildParams();
            });
            note.appendChild(retry);
        }
        container.appendChild(note);
    }

    function toastLevel(level) {
        var value = String(level || "info").toLowerCase();
        return value === "success" || value === "warning" || value === "error" ? value : "info";
    }

    function ensureToastUI() {
        if (toastUI || typeof document === "undefined" || !puiAvailable()) return;
        var host = h("div", "isf-pui isf-pui-toasts");
        document.body.appendChild(host);
        var adapter = {
            getValue: function (path) { return path === "/isf/ui/notices" ? TOASTS : undefined; },
            setValue: function () { return false; },
            callAction: function (name, args) {
                if (name === "isf.notice_dismiss") return dismissNotice(args && args.id);
                return false;
            },
            getPathMeta: function () { return {}; }
        };
        var ui = PupitreUI.create({
            mount: host,
            density: "compact",
            getValue: adapter.getValue,
            setValue: adapter.setValue,
            callAction: adapter.callAction,
            getPathMeta: adapter.getPathMeta,
            translate: function (key, fallback) { return fallback; }
        });
        var doc = {
            format: "pupitre-ui", version: 1, host: "docsify-isf",
            panels: [{id: "isf-toasts", title: "Notifications", embedded: true, pages: [{id: "toasts", title: "Notifications", sections: [{
                id: "toasts", title: "Notifications", blocks: [{
                    kind: "toast", id: "isf-toasts", bind: "/isf/ui/notices",
                    placement: "bottom-end",
                    dismiss: {id: "isf-notice-dismiss", label: "Dismiss", call: "isf.notice_dismiss"}
                }]
            }]}]}]
        };
        try {
            ui.render(doc);
        } catch (error) {
            try { ui.destroy(); } catch (destroyError) { /* ignore */ }
            if (host.parentNode) host.parentNode.removeChild(host);
            return;
        }
        toastUI = {ui: ui, host: host};
        toastHost = host;
    }

    function dismissNotice(id) {
        var index = -1;
        for (var i = 0; i < TOASTS.length; i++) {
            if (String(TOASTS[i].id) === String(id)) { index = i; break; }
        }
        if (index < 0) return false;
        TOASTS.splice(index, 1);
        if (toastTimers[id]) { clearTimeout(toastTimers[id]); delete toastTimers[id]; }
        try { if (toastUI) toastUI.ui.apply(); } catch (error) { /* ignore */ }
        return true;
    }

    function notify(level, text) {
        var message = String(text === undefined || text === null ? "" : text);
        if (!message || typeof document === "undefined" || !puiAvailable()) return false;
        ensureToastUI();
        if (!toastUI) return false;
        var id = "n" + (++TOAST_SEQ);
        TOASTS.push({id: id, text: message, level: toastLevel(level)});
        try { toastUI.ui.apply(); } catch (error) { /* ignore */ }
        toastTimers[id] = setTimeout(function () { dismissNotice(id); }, 4200);
        return true;
    }

    function destroyToastUI() {
        for (var id in toastTimers) {
            if (Object.prototype.hasOwnProperty.call(toastTimers, id)) clearTimeout(toastTimers[id]);
        }
        toastTimers = {};
        TOASTS = [];
        if (toastUI) {
            try { toastUI.ui.destroy(); } catch (error) { /* ignore */ }
            toastUI = null;
        }
        if (toastHost && toastHost.parentNode) toastHost.parentNode.removeChild(toastHost);
        toastHost = null;
    }

    function buildControls(container, inputs, viewer) {
        container.innerHTML = "";
        if (viewer.puiLoadError) {
            renderPUIStatus(container, viewer, false);
            return [];
        }
        if (puiAvailable()) {
            try {
                return buildPUIParams(container, inputs, viewer);
            } catch (error) {
                if (viewer.pui) {
                    try { viewer.pui.ui.destroy(); } catch (destroyError) { /* ignore */ }
                    viewer.pui = null;
                }
                container.innerHTML = "";
                viewer.warn("PUI controls failed: " + (error && error.message ? error.message : error));
                renderPUIStatus(container, viewer, false);
                return [];
            }
        }
        renderPUIStatus(container, viewer, true);
        loadPUI().then(function () {
            if (!viewer.disposed) viewer.rebuildParams();
        }, function (error) {
            viewer.puiLoadError = true;
            viewer.warn("PUI assets unavailable: " + (error && error.message ? error.message : error));
            if (!viewer.disposed) viewer.rebuildParams();
        });
        return [];
    }

    /* ==================================================================
     * Pupitre UI parameters (shared toolkit)
     *
     * The parameter drawer is a PUI document generated from the normalised
     * ISF inputs by the vendored PupitreISF adapter; the renderer is the
     * vendored PupitreUI. The host (this plugin) keeps values, clamping,
     * media and events. PUI is the only parameter renderer; the on-demand
     * assets must be deployed next to the plugin (see README `puiBase`).
     * ================================================================== */

    function chooseImageFor(viewer, name) {
        viewer.pendingImageName = name || "";
        if (viewer.puiFileInput) viewer.puiFileInput.click();
    }

    function markPUIParams(container, viewer) {
        // `data-pui-bind` is the public renderer hook. Keep the smoke/test
        // marker on the enclosing row; never depend on PUI's private classes.
        var nodes = container.querySelectorAll("[data-pui-bind]");
        var marked = [];
        for (var i = 0; i < nodes.length; i++) {
            var path = nodes[i].getAttribute("data-pui-bind") || "";
            if (path.indexOf("/isf/") !== 0) continue;
            var row = nodes[i].closest ? nodes[i].closest(".pui-field") : null;
            if (!row) continue;
            var name = path.slice(5).split("/")[0];
            if (!name || row.getAttribute("data-isf-param") === name) continue;
            row.setAttribute("data-isf-param", name);
            (function (node, inputName) {
                node.addEventListener("dblclick", function (event) {
                    if (event.target && event.target.closest && event.target.closest("button, select")) return;
                    event.preventDefault();
                    viewer.resetParameter(inputName);
                });
            })(row, name);
            marked.push(row);
        }
        return marked;
    }

    function buildPUIParams(container, inputs, viewer) {
        if (viewer.pui) {
            try { viewer.pui.ui.destroy(); } catch (error) { /* ignore */ }
            viewer.pui = null;
        }
        if (!viewer.puiHost) {
            viewer.puiHost = {
                getValue: function (name) {
                    var input = viewer.inputByName && viewer.inputByName[name];
                    if (input && input.type === "event") return undefined;
                    return viewer.values ? viewer.values[name] : undefined;
                },
                setValue: function (name, value) { return viewer.setParameter(name, value); },
                triggerEvent: function (name) { viewer.triggerEvent(name); },
                chooseImage: function (name) { chooseImageFor(viewer, name); },
                toggleMicrophone: function () {
                    if (viewer.audioState) viewer.disableMicrophone();
                    else viewer.enableMicrophone();
                },
                audioActive: function () { return !!viewer.audioState; }
            };
        }
        var adapter = PupitreISF.createAdapter({
            inputs: inputs,
            host: viewer.puiHost,
            rev: (viewer.puiRev = (viewer.puiRev || 0) + 1),
            // Embedded panels keep only their accessible name; give every
            // viewer's parameter region a unique one.
            title: (viewer.title ? viewer.title + " inputs" : "Inputs"),
            sectionTitle: "Inputs"
        });
        var mount = h("div", "isf-pui");
        container.appendChild(mount);
        var fileInput = h("input", "isf-hidden", { type: "file", accept: "image/*" });
        fileInput.addEventListener("change", function () {
            var name = viewer.pendingImageName;
            if (name && fileInput.files && fileInput.files[0] && viewer.setInputImage) {
                viewer.setInputImage(name, fileInput.files[0]);
            }
            fileInput.value = "";
        });
        container.appendChild(fileInput);
        viewer.puiFileInput = fileInput;
        var ui = PupitreUI.create({
            mount: mount,
            density: "compact",
            // The pass/quality/time/export row is docsify chrome, not an ISF
            // input. It runs as a host block inside the normal PUI flow, so
            // the whole drawer is one renderer without inventing a portable
            // block kind or moving host state into the document.
            blocks: {
                "isf.view": function () {
                    try {
                        return viewer.buildViewControls(inputs);
                    } catch (error) {
                        viewer.warn("View controls unavailable: " + (error && error.message ? error.message : error));
                        return null;
                    }
                }
            },
            getValue: function (path) { return adapter.getValue(path); },
            setValue: function (path, value) { return adapter.setValue(path, value); },
            callAction: function (name, args) { return adapter.callAction(name, args); },
            getPathMeta: function (path) { return adapter.getPathMeta(path); },
            translate: function (key, fallback) { return fallback; },
            announce: function (level, message) {
                if (level === "error") viewer.warn(message);
                else viewer.setState(message, level === "success" ? "ok" : "");
            }
        });
        viewer.pui = { ui: ui, adapter: adapter, mount: mount, host: viewer.puiHost };
        var document = adapter.document();
        document.panels[0].pages[0].sections.push({
            id: "view",
            title: "View",
            blocks: [{kind: "isf.view", id: "view", label: "View"}]
        });
        ui.render(document);
        return markPUIParams(container, viewer);
    }

    /* ==================================================================
     * Editor templates and snippets
     * ================================================================== */

    var VERTEX_STARTER = [
        "varying vec2 vUV;",
        "",
        "void main()",
        "{",
        "    isf_vertShaderInit();",
        "    vUV = isf_FragNormCoord;",
        "}"
    ].join("\n") + "\n";

    var INPUT_TEMPLATES = {
        float: '        {\n            "NAME": "amount",\n            "TYPE": "float",\n            "LABEL": "Amount",\n            "DEFAULT": 0.5,\n            "MIN": 0.0,\n            "MAX": 1.0\n        }',
        bool: '        {\n            "NAME": "toggle",\n            "TYPE": "bool",\n            "LABEL": "Toggle",\n            "DEFAULT": false\n        }',
        color: '        {\n            "NAME": "tint",\n            "TYPE": "color",\n            "LABEL": "Tint",\n            "DEFAULT": [1.0, 1.0, 1.0, 1.0]\n        }',
        point2D: '        {\n            "NAME": "center",\n            "TYPE": "point2D",\n            "LABEL": "Center",\n            "DEFAULT": [0.5, 0.5],\n            "MIN": [0.0, 0.0],\n            "MAX": [1.0, 1.0]\n        }',
        event: '        {\n            "NAME": "trigger",\n            "TYPE": "event",\n            "LABEL": "Trigger"\n        }',
        long: '        {\n            "NAME": "mode",\n            "TYPE": "long",\n            "LABEL": "Mode",\n            "DEFAULT": 0,\n            "VALUES": [0, 1, 2],\n            "LABELS": ["One", "Two", "Three"]\n        }',
        image: '        {\n            "NAME": "inputImage",\n            "TYPE": "image",\n            "LABEL": "Input image"\n        }',
        audioFFT: '        {\n            "NAME": "spectrum",\n            "TYPE": "audioFFT",\n            "LABEL": "Audio FFT",\n            "MAX": 512\n        }'
    };

    var SHADER_TEMPLATES = {
        generator: [
            "/*{",
            '    "DESCRIPTION": "Starter generator.",',
            '    "CREDIT": "by You",',
            '    "ISFVSN": "2",',
            '    "CATEGORIES": [ "Generator" ],',
            '    "INPUTS": [',
            '        {',
            '            "NAME": "speed", "TYPE": "float", "LABEL": "Speed",',
            '            "DEFAULT": 0.5, "MIN": 0.0, "MAX": 4.0',
            "        }",
            "    ]",
            "}*/",
            "",
            "void main()",
            "{",
            "    vec2 uv = isf_FragNormCoord;",
            "    float t = TIME * speed;",
            "    vec3 color = 0.5 + 0.5 * cos(6.28318 * (uv.xyx * 2.0 + t + vec3(0.0, 0.33, 0.66)));",
            "    gl_FragColor = vec4(color, 1.0);",
            "}",
            ""
        ].join("\n"),
        filter: [
            "/*{",
            '    "DESCRIPTION": "Starter image filter.",',
            '    "CREDIT": "by You",',
            '    "ISFVSN": "2",',
            '    "CATEGORIES": [ "Filter" ],',
            '    "INPUTS": [',
            '        { "NAME": "inputImage", "TYPE": "image", "LABEL": "Input image" }',
            "    ]",
            "}*/",
            "",
            "void main()",
            "{",
            "    gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord);",
            "}",
            ""
        ].join("\n"),
        transition: [
            "/*{",
            '    "DESCRIPTION": "Starter transition.",',
            '    "CREDIT": "by You",',
            '    "ISFVSN": "2",',
            '    "CATEGORIES": [ "Transition" ],',
            '    "INPUTS": [',
            '        { "NAME": "startImage", "TYPE": "image", "LABEL": "Start" },',
            '        { "NAME": "endImage", "TYPE": "image", "LABEL": "End" },',
            '        { "NAME": "progress", "TYPE": "float", "LABEL": "Progress", "DEFAULT": 0.0, "MIN": 0.0, "MAX": 1.0 }',
            "    ]",
            "}*/",
            "",
            "void main()",
            "{",
            "    vec4 start = IMG_NORM_THIS_PIXEL(startImage);",
            "    vec4 end = IMG_NORM_THIS_PIXEL(endImage);",
            "    gl_FragColor = mix(start, end, clamp(progress, 0.0, 1.0));",
            "}",
            ""
        ].join("\n"),
        multipass: [
            "/*{",
            '    "DESCRIPTION": "Starter multi-pass shader (bufferA then output).",',
            '    "CREDIT": "by You",',
            '    "ISFVSN": "2",',
            '    "CATEGORIES": [ "Multi-pass" ],',
            '    "INPUTS": [',
            '        { "NAME": "inputImage", "TYPE": "image", "LABEL": "Input image" }',
            "    ],",
            '    "PASSES": [',
            '        { "TARGET": "bufferA", "PERSISTENT": true, "FLOAT": true },',
            '        {}',
            "    ]",
            "}*/",
            "",
            "void main()",
            "{",
            "    if (PASSINDEX == 0) {",
            "        gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord);",
            "    } else {",
            "        gl_FragColor = IMG_NORM_THIS_PIXEL(bufferA);",
            "    }",
            "}",
            ""
        ].join("\n")
    };

    /* ==================================================================
     * GLSL editor (textarea over a syntax-highlighted layer)
     * ================================================================== */

    function createEditor(viewer, config) {
        var wrap = h("div", "isf-panel isf-editor-wrap");
        var toolbar = h("div", "isf-editor-toolbar");
        var tabs = h("span", "isf-editor-tabs");
        var fragmentTab = h("button", "isf-btn isf-tab is-active", { type: "button", text: "Fragment", "aria-pressed": "true" });
        var vertexTab = h("button", "isf-btn isf-tab", { type: "button", text: "Vertex", "aria-pressed": "false" });
        tabs.appendChild(fragmentTab);
        tabs.appendChild(vertexTab);
        if (config.vertexShader === false) vertexTab.classList.add("isf-hidden");
        var status = h("span", "isf-editor-status", { text: "Ready", "aria-live": "polite" });
        var posLabel = h("span", "isf-editor-pos", { text: "Ln 1, Col 1" });
        var actions = h("span", "isf-editor-actions");
        var applyButton = h("button", "isf-btn", { type: "button", text: "Apply", title: "Apply (Ctrl/Cmd+Enter)" });
        var revertButton = h("button", "isf-btn", { type: "button", text: "Revert", title: "Revert to the original file" });
        var copyButton = h("button", "isf-btn", { type: "button", text: "Copy", title: "Copy source" });
        var importButton = h("button", "isf-btn", { type: "button", text: "Import", title: "Import from Shadertoy / GLSL Sandbox" });
        var templateMenuHost = h("span", "isf-template-menu isf-pui isf-hidden");
        var templateSelect = h("select", "isf-template-select", {
            "aria-label": "Insert a snippet or start from a template",
            title: "Insert an input snippet or start from a template"
        });
        templateSelect.appendChild(h("option", null, { value: "", text: "Templates…" }));
        var inputGroup = document.createElement("optgroup");
        inputGroup.label = "Insert input";
        [
            ["float", "float"], ["bool", "bool"], ["color", "color"], ["point2D", "point2D"],
            ["event", "event"], ["long", "long"], ["image", "image"], ["audioFFT", "audioFFT"]
        ].forEach(function (entry) {
            inputGroup.appendChild(h("option", null, { value: "input:" + entry[0], text: entry[1] + " input" }));
        });
        templateSelect.appendChild(inputGroup);
        var newGroup = document.createElement("optgroup");
        newGroup.label = "New shader";
        [
            ["generator", "Generator"], ["filter", "Filter"], ["transition", "Transition"], ["multipass", "Multi-pass"]
        ].forEach(function (entry) {
            newGroup.appendChild(h("option", null, { value: "template:" + entry[0], text: entry[1] }));
        });
        templateSelect.appendChild(newGroup);
        var editorClose = h("button", "isf-btn isf-panel-close", { type: "button", "aria-label": "Close editor", title: "Close", text: "×" });
        var editorTitle = h("div", "isf-panel-title isf-editor-head");
        editorTitle.appendChild(h("span", null, { text: "Source editor" }));
        editorTitle.appendChild(editorClose);
        actions.appendChild(applyButton);
        actions.appendChild(revertButton);
        actions.appendChild(copyButton);
        actions.appendChild(importButton);
        actions.appendChild(templateMenuHost);
        actions.appendChild(templateSelect);
        var keysButton = h("button", "isf-btn isf-keys-btn", { type: "button", text: "?", title: "Keyboard shortcuts", "aria-label": "Keyboard shortcuts" });
        actions.appendChild(keysButton);
        keysButton.addEventListener("click", function () { if (viewer.showShortcuts) viewer.showShortcuts(); });
        editorClose.addEventListener("click", function () { if (viewer.toggleEditor) viewer.toggleEditor(); });
        importButton.addEventListener("click", function () { if (viewer.openImport) viewer.openImport(); });
        var foldButton = h("button", "isf-btn isf-fold-btn", {
            type: "button", html: ICONS.chevron,
            title: "Collapse the editor toolbar", "aria-label": "Collapse the editor toolbar",
            "aria-expanded": "true", "aria-controls": "isf-editor-toolbar-content"
        });
        var foldedSummary = h("span", "isf-editor-folded-summary", { "aria-hidden": "true" });
        toolbar.appendChild(foldButton);
        toolbar.appendChild(tabs);
        toolbar.appendChild(status);
        toolbar.appendChild(posLabel);
        toolbar.appendChild(foldedSummary);
        toolbar.appendChild(actions);
        var editor = h("div", "isf-editor");
        var activeLine = h("div", "isf-active-line", { "aria-hidden": "true" });
        var gutter = h("div", "isf-gutter", { "aria-hidden": "true", text: "1" });
        var codeWrap = h("div", "isf-code");
        var highlight = h("pre", "isf-highlight", { "aria-hidden": "true" });
        var code = h("code");
        highlight.appendChild(code);
        var textarea = h("textarea", "isf-input", {
            spellcheck: "false", autocapitalize: "off", autocomplete: "off",
            autocorrect: "off", wrap: "off", "aria-label": "ISF source editor"
        });
        codeWrap.appendChild(activeLine);
        codeWrap.appendChild(highlight);
        codeWrap.appendChild(textarea);
        editor.appendChild(gutter);
        editor.appendChild(codeWrap);
        var resizeY = h("div", "isf-resize-y", {
            role: "separator", "aria-orientation": "horizontal",
            "aria-label": "Resize the editor pane", tabindex: "0",
            title: "Drag to resize the editor — double-click to reset"
        });
        wrap.appendChild(editorTitle);
        wrap.appendChild(toolbar);
        wrap.appendChild(resizeY);
        wrap.appendChild(editor);

        var highlightScheduled = false;
        var caretScheduled = false;
        var liveTimer = null;
        var errorLine = 0;
        var gutterLineCount = 0;
        var gutterErrorLine = 0;
        var lineHeight = 18.6;
        var paddingTop = 8;
        var caretCache = { pos: 0, line: 1, column: 1 };
        var indentSize = numberOr(config.editorIndent, 2);
        var indentUnit = indentSize <= 0 ? "\t" : new Array(Math.max(1, Math.round(indentSize)) + 1).join(" ");
        var buffers = { fragment: "", vertex: viewer.vertexSource || null };
        var activeBuffer = "fragment";
        var vertexEnabled = !!viewer.vertexSource;
        var fontSize = clamp(numberOr(viewer.layout && viewer.layout.editorFontSize, 12), 9, 28);

        function lineCount(text) {
            var count = 1;
            for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
            return count;
        }

        // Line height and padding are measured, never assumed: the error scroll
        // and the active-line marker stay aligned at any font size / zoom.
        function measureMetrics() {
            try {
                var style = window.getComputedStyle(textarea);
                var measured = parseFloat(style.lineHeight);
                lineHeight = (isFinite(measured) && measured > 0) ? measured : (parseFloat(style.fontSize) || 12) * 1.55;
                paddingTop = parseFloat(style.paddingTop) || 0;
            } catch (err) { /* ignore */ }
            scheduleCaret();
        }

        function renderGutter(text) {
            var count = lineCount(text);
            if (count === gutterLineCount && errorLine === gutterErrorLine) return;
            gutterLineCount = count;
            gutterErrorLine = errorLine;
            if (!errorLine || errorLine > count) {
                var plain = [];
                for (var p = 1; p <= count; p++) plain.push(p);
                gutter.textContent = plain.join("\n");
                return;
            }
            var html = [];
            for (var line = 1; line <= count; line++) {
                if (line === errorLine) html.push('<span class="isf-gutter-error">' + line + "</span>");
                else html.push(String(line));
            }
            gutter.innerHTML = html.join("\n");
        }

        function renderHighlight() {
            highlightScheduled = false;
            var text = textarea.value;
            if (text.length > 400000) {
                code.textContent = text;
            } else {
                code.innerHTML = highlightGLSL(text) + "\n";
            }
            renderGutter(text);
        }

        function scheduleHighlight() {
            if (highlightScheduled) return;
            highlightScheduled = true;
            requestAnimationFrame(renderHighlight);
        }

        function caretInfo(pos) {
            if (pos === caretCache.pos) return caretCache;
            var text = textarea.value;
            var line = 1, column = 1, i;
            if (pos > caretCache.pos && pos - caretCache.pos < 4000) {
                line = caretCache.line;
                column = caretCache.column;
                for (i = caretCache.pos; i < pos; i++) {
                    if (text.charCodeAt(i) === 10) { line++; column = 1; } else column++;
                }
            } else {
                for (i = 0; i < pos && i < text.length; i++) {
                    if (text.charCodeAt(i) === 10) { line++; column = 1; } else column++;
                }
            }
            caretCache = { pos: pos, line: line, column: column };
            return caretCache;
        }

        function renderCaret() {
            caretScheduled = false;
            var info = caretInfo(textarea.selectionStart);
            posLabel.textContent = "Ln " + info.line + ", Col " + info.column;
            activeLine.style.transform = "translateY(" + (paddingTop + (info.line - 1) * lineHeight - textarea.scrollTop) + "px)";
            activeLine.style.height = lineHeight + "px";
            activeLine.classList.remove("isf-hidden");
        }

        function scheduleCaret() {
            if (caretScheduled) return;
            caretScheduled = true;
            requestAnimationFrame(renderCaret);
        }

        function syncScroll() {
            highlight.scrollTop = textarea.scrollTop;
            highlight.scrollLeft = textarea.scrollLeft;
            gutter.scrollTop = textarea.scrollTop;
            scheduleCaret();
        }

        function setStatus(message, kind) {
            status.textContent = message || "";
            status.className = "isf-editor-status" + (kind ? " is-" + kind : "");
            updateFoldedSummary();
        }

        function setValue(text, options) {
            options = options || {};
            buffers.fragment = String(text == null ? "" : text);
            activeBuffer = "fragment";
            textarea.value = buffers.fragment;
            updateTabs();
            try { textarea.setSelectionRange(0, 0); } catch (err) { /* ignore */ }
            errorLine = 0;
            caretCache = { pos: 0, line: 1, column: 1 };
            scheduleHighlight();
            scheduleCaret();
            if (!options.keepScroll) {
                textarea.scrollTop = 0;
                textarea.scrollLeft = 0;
                syncScroll();
            }
        }

        function markError(line, buffer) {
            if (buffer && buffer !== activeBuffer) {
                if (buffer === "vertex" && buffers.vertex === null) buffers.vertex = VERTEX_STARTER;
                setActiveBuffer(buffer);
            }
            errorLine = line || 0;
            renderGutter(textarea.value);
            if (errorLine > 0) {
                textarea.scrollTop = Math.max(0, paddingTop + (errorLine - 3) * lineHeight);
                syncScroll();
            }
        }

        function insertText(text) {
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var value = textarea.value;
            textarea.value = value.slice(0, start) + text + value.slice(end);
            textarea.selectionStart = textarea.selectionEnd = start + text.length;
            scheduleHighlight();
            scheduleCaret();
            notifyInput();
        }

        // Enter keeps the current indentation and adds one level after an
        // opening bracket — the behaviour every code editor is expected to have.
        function autoIndentNewline() {
            var start = textarea.selectionStart;
            var value = textarea.value;
            var lineStart = value.lastIndexOf("\n", start - 1) + 1;
            var prefix = value.slice(lineStart, start);
            var indent = /^[ \t]*/.exec(prefix)[0];
            var extra = /[{[(]\s*$/.test(prefix) ? indentUnit : "";
            insertText("\n" + indent + extra);
        }

        function indentSelection(shift) {
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var value = textarea.value;
            var lineStart = value.lastIndexOf("\n", start - 1) + 1;
            var lineEnd = value.indexOf("\n", end);
            if (lineEnd === -1) lineEnd = value.length;
            var block = value.slice(lineStart, lineEnd);
            var changed;
            if (shift) {
                var dedent = indentUnit === "\t" ? /^\t/gm : new RegExp("^ {1," + indentUnit.length + "}", "gm");
                changed = block.replace(dedent, "");
            } else {
                changed = block.replace(/^/gm, indentUnit);
            }
            textarea.value = value.slice(0, lineStart) + changed + value.slice(lineEnd);
            textarea.selectionStart = lineStart;
            textarea.selectionEnd = lineStart + changed.length;
            scheduleHighlight();
            scheduleCaret();
            notifyInput();
        }

        function notifyInput() {
            if (activeBuffer === "vertex") vertexEnabled = true;
            viewer.onEditorInput();
        }

        function updateTabs() {
            fragmentTab.classList.toggle("is-active", activeBuffer === "fragment");
            fragmentTab.setAttribute("aria-pressed", activeBuffer === "fragment" ? "true" : "false");
            vertexTab.classList.toggle("is-active", activeBuffer === "vertex");
            vertexTab.setAttribute("aria-pressed", activeBuffer === "vertex" ? "true" : "false");
            updateFoldedSummary();
        }

        function setActiveBuffer(name) {
            if (name === activeBuffer) return;
            buffers[activeBuffer] = textarea.value;
            activeBuffer = name;
            textarea.value = buffers[name] || "";
            errorLine = 0;
            caretCache = { pos: 0, line: 1, column: 1 };
            try { textarea.setSelectionRange(0, 0); } catch (err) { /* ignore */ }
            updateTabs();
            scheduleHighlight();
            scheduleCaret();
            syncScroll();
        }

        // Ctrl/Cmd+/ comments or uncomments the selected lines.
        function toggleComment() {
            var value = textarea.value;
            var start = textarea.selectionStart;
            var end = textarea.selectionEnd;
            var lineStart = value.lastIndexOf("\n", start - 1) + 1;
            var lineEnd = value.indexOf("\n", end);
            if (lineEnd === -1) lineEnd = value.length;
            var block = value.slice(lineStart, lineEnd);
            var lines = block.split("\n");
            var allCommented = lines.every(function (line) { return !line.trim() || /^\s*\/\//.test(line); });
            var changed = lines.map(function (line) {
                if (!line.trim()) return line;
                return allCommented ? line.replace(/^(\s*)\/\/ ?/, "$1") : line.replace(/^(\s*)/, "$1// ");
            }).join("\n");
            textarea.value = value.slice(0, lineStart) + changed + value.slice(lineEnd);
            textarea.selectionStart = lineStart;
            textarea.selectionEnd = lineStart + changed.length;
            scheduleHighlight();
            scheduleCaret();
            notifyInput();
        }

        // Ctrl/Cmd +/-/0 zooms the editor (persisted with the pane sizes).
        function applyFontSize(size, persist) {
            fontSize = clamp(size, 9, 28);
            editor.style.fontSize = fontSize + "px";
            measureMetrics();
            if (persist) viewer.saveLayout({ editorFontSize: fontSize });
        }

        function insertInputTemplate(type) {
            var snippet = INPUT_TEMPLATES[type];
            if (!snippet) return;
            insertText(snippet);
            setStatus("Inserted a " + type + " input — place it inside INPUTS, then Apply", "");
        }

        function applyShaderTemplate(name) {
            var template = SHADER_TEMPLATES[name];
            if (!template) return;
            if (textarea.value.trim() && typeof window !== "undefined" && !window.confirm("Replace the current source with the " + name + " template?")) return;
            buffers.fragment = template;
            activeBuffer = "fragment";
            textarea.value = template;
            errorLine = 0;
            caretCache = { pos: 0, line: 1, column: 1 };
            updateTabs();
            scheduleHighlight();
            scheduleCaret();
            syncScroll();
            setStatus(name + " template loaded — press Apply", "");
        }

        textarea.addEventListener("input", function () {
            scheduleHighlight();
            scheduleCaret();
            setStatus("Modified — " + (config.editorLive ? "applying…" : "press Apply"), "");
            notifyInput();
        });
        textarea.addEventListener("scroll", syncScroll);
        textarea.addEventListener("click", scheduleCaret);
        textarea.addEventListener("keyup", scheduleCaret);
        textarea.addEventListener("keydown", function (event) {
            if (event.key === "Tab") {
                event.preventDefault();
                indentSelection(event.shiftKey);
                return;
            }
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                autoIndentNewline();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                viewer.applySource();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && (event.key === "/" || event.key === "?")) {
                event.preventDefault();
                toggleComment();
                return;
            }
            if ((event.ctrlKey || event.metaKey) && (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "0")) {
                event.preventDefault();
                if (event.key === "0") applyFontSize(12, true);
                else applyFontSize(fontSize + (event.key === "-" ? -1 : 1), true);
                return;
            }
            if ((event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S")) {
                event.preventDefault();
                viewer.applySource();
            }
        });
        fragmentTab.addEventListener("click", function () { setActiveBuffer("fragment"); });
        vertexTab.addEventListener("click", function () {
            if (buffers.vertex === null) buffers.vertex = VERTEX_STARTER;
            vertexEnabled = true;
            setActiveBuffer("vertex");
        });
        templateSelect.addEventListener("change", function () {
            var choice = templateSelect.value;
            templateSelect.value = "";
            if (!choice) return;
            if (choice.indexOf("input:") === 0) insertInputTemplate(choice.slice(6));
            else if (choice.indexOf("template:") === 0) applyShaderTemplate(choice.slice(9));
        });

        // PUI menu adoption with the native select as the pre-load fallback.
        var templateMenuMounted = false;
        var templateMenuUI = null;
        function mountEditorTemplateMenu() {
            if (templateMenuMounted || viewer.disposed || !puiAvailable()) return;
            var insertPrefix = "isf.editor.insert.";
            var templatePrefix = "isf.editor.template.";
            var menuItems = [{kind: "label", text: "Insert input"}];
            Object.keys(INPUT_TEMPLATES).forEach(function (type) {
                menuItems.push({id: "input." + type, label: type + " input", call: insertPrefix + type});
            });
            menuItems.push({kind: "separator"});
            menuItems.push({kind: "label", text: "New shader"});
            Object.keys(SHADER_TEMPLATES).forEach(function (name) {
                menuItems.push({id: "template." + name, label: name.charAt(0).toUpperCase() + name.slice(1), call: templatePrefix + name});
            });
            var menuDoc = {
                format: "pupitre-ui", version: 1, host: "docsify-isf",
                panels: [{id: "isf-editor-menu", title: "Editor templates", embedded: true, pages: [{id: "menu", title: "Templates", sections: [{
                    id: "menu", title: "Templates", blocks: [{
                        kind: "menu", id: "templates", label: "Templates", icon: "chevron", items: menuItems
                    }]
                }]}]}]
            };
            var ui;
            try {
                ui = PupitreUI.create({
                    mount: templateMenuHost,
                    density: "compact",
                    icons: {chevron: function () {
                        var wrap = document.createElement("span");
                        wrap.innerHTML = ICONS.chevron;
                        return wrap.firstChild || null;
                    }},
                    getValue: function () { return undefined; },
                    setValue: function () { return false; },
                    callAction: function (name) {
                        if (name.indexOf(insertPrefix) === 0) { insertInputTemplate(name.slice(insertPrefix.length)); return true; }
                        if (name.indexOf(templatePrefix) === 0) { applyShaderTemplate(name.slice(templatePrefix.length)); return true; }
                        return false;
                    },
                    getPathMeta: function () { return {}; },
                    translate: function (key, fallback) { return fallback; }
                });
                ui.render(menuDoc);
            } catch (error) {
                if (ui) { try { ui.destroy(); } catch (destroyError) { /* ignore */ } }
                templateMenuHost.classList.add("isf-hidden");
                return;
            }
            templateMenuMounted = true;
            templateMenuUI = ui;
            templateMenuHost.classList.remove("isf-hidden");
            if (templateSelect.parentNode) templateSelect.parentNode.removeChild(templateSelect);
            viewer.listeners.push(function () {
                if (templateMenuUI) { try { templateMenuUI.destroy(); } catch (error) { /* ignore */ } }
            });
        }
        loadPUI().then(mountEditorTemplateMenu, function () { /* keep the native select */ });
        var selectionHandler = function () {
            if (document.activeElement === textarea) scheduleCaret();
        };
        document.addEventListener("selectionchange", selectionHandler);
        viewer.listeners.push(function () { document.removeEventListener("selectionchange", selectionHandler); });
        var metricsHandler = function () { measureMetrics(); };
        window.addEventListener("resize", metricsHandler);
        viewer.listeners.push(function () { window.removeEventListener("resize", metricsHandler); });

        // Editor pane resize: drag, keyboard (↑/↓/Home/End) and double-click
        // reset, persisted globally so the choice survives navigation.
        function maxEditorHeight() {
            return Math.max(160, Math.min(window.innerHeight * 0.85, 1400));
        }
        var toolbarCollapsed = false;
        var collapsedToolbarExtra = 0;
        var editorBaseHeight = null;
        function refreshEditorHeight() {
            var extra = toolbarCollapsed ? collapsedToolbarExtra : 0;
            if (editorBaseHeight == null) {
                // no manual height: the CSS flex fill uses every available
                // vertical pixel of the drawer, and follows window resizes
                editor.style.height = "";
                editor.style.flex = "";
            } else {
                editor.style.height = (editorBaseHeight + extra) + "px";
                editor.style.flex = "0 0 auto";
            }
            measureMetrics();
        }
        function applyEditorHeight(px, persist) {
            editorBaseHeight = clamp(px, 120, maxEditorHeight());
            refreshEditorHeight();
            if (persist) viewer.saveLayout({ editorHeight: editorBaseHeight });
            return editorBaseHeight;
        }
        var dragStartY = 0;
        var dragStartHeight = 0;
        resizeY.addEventListener("pointerdown", function (event) {
            event.preventDefault();
            dragStartY = event.clientY;
            var startExtra = toolbarCollapsed ? collapsedToolbarExtra : 0;
            dragStartHeight = editorBaseHeight == null
                ? Math.max(0, editor.getBoundingClientRect().height - startExtra)
                : editorBaseHeight;
            resizeY.classList.add("is-dragging");
            try { resizeY.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
        });
        resizeY.addEventListener("pointermove", function (event) {
            if (!resizeY.classList.contains("is-dragging")) return;
            applyEditorHeight(dragStartHeight + (dragStartY - event.clientY), false);
        });
        var endEditorDrag = function (event) {
            if (!resizeY.classList.contains("is-dragging")) return;
            resizeY.classList.remove("is-dragging");
            try { resizeY.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
            viewer.saveLayout({ editorHeight: editor.getBoundingClientRect().height });
        };
        resizeY.addEventListener("pointerup", endEditorDrag);
        resizeY.addEventListener("pointercancel", endEditorDrag);
        resizeY.addEventListener("dblclick", function () {
            editorBaseHeight = null;
            refreshEditorHeight();
            viewer.saveLayout({ editorHeight: null });
        });
        resizeY.addEventListener("keydown", function (event) {
            var keyExtra = toolbarCollapsed ? collapsedToolbarExtra : 0;
            var current = editorBaseHeight == null
                ? Math.max(0, editor.getBoundingClientRect().height - keyExtra)
                : editorBaseHeight;
            var delta = event.shiftKey ? 64 : 16;
            if (event.key === "ArrowUp") { event.preventDefault(); applyEditorHeight(current + delta, true); }
            else if (event.key === "ArrowDown") { event.preventDefault(); applyEditorHeight(current - delta, true); }
            else if (event.key === "Home") { event.preventDefault(); applyEditorHeight(160, true); }
            else if (event.key === "End") { event.preventDefault(); applyEditorHeight(maxEditorHeight(), true); }
        });
        function updateFoldedSummary() {
            if (!foldedSummary) return;
            var label = activeBuffer === "vertex" ? "Vertex" : "Fragment";
            var text = status.textContent || "";
            foldedSummary.textContent = text ? label + " · " + text : label;
        }

        // Folding hides the tabs/actions/status rows and grows the code pane by
        // exactly the height they occupied.
        function measureCollapsedExtra() {
            var wasFolded = wrap.classList.contains("isf-toolbar-folded");
            if (wasFolded) wrap.classList.remove("isf-toolbar-folded");
            var expanded = toolbar.getBoundingClientRect().height;
            wrap.classList.add("isf-toolbar-folded");
            var folded = toolbar.getBoundingClientRect().height;
            if (!wasFolded) wrap.classList.remove("isf-toolbar-folded");
            return Math.max(0, expanded - folded);
        }
        function refreshFold() {
            if (!toolbarCollapsed) { updateFoldedSummary(); return; }
            // Re-measure on every fold: the toolbar wraps differently per
            // viewport, and a delta cached from another width would free the
            // wrong number of pixels.
            collapsedToolbarExtra = measureCollapsedExtra();
            if (editorBaseHeight == null) {
                var current = editor.getBoundingClientRect().height;
                if (current > 0) editorBaseHeight = clamp(current, 120, maxEditorHeight());
            }
            refreshEditorHeight();
            updateFoldedSummary();
        }
        function setToolbarCollapsed(collapsed, persist) {
            toolbarCollapsed = collapsed;
            if (collapsed) refreshFold();
            else refreshEditorHeight();
            wrap.classList.toggle("isf-toolbar-folded", collapsed);
            foldButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
            var label = collapsed ? "Expand the editor toolbar" : "Collapse the editor toolbar";
            foldButton.title = label;
            foldButton.setAttribute("aria-label", label);
            updateFoldedSummary();
            if (persist) viewer.saveLayout({ editorToolbar: collapsed ? "folded" : null });
        }
        foldButton.addEventListener("click", function () { setToolbarCollapsed(!toolbarCollapsed, true); });
        if (typeof MutationObserver !== "undefined") {
            var statusObserver = new MutationObserver(updateFoldedSummary);
            statusObserver.observe(status, { childList: true, characterData: true, subtree: true });
            viewer.listeners.push(function () { statusObserver.disconnect(); });
        }

        var storedEditorHeight = viewer.layout && viewer.layout.editorHeight;
        if (storedEditorHeight && config.persistLayout !== false) applyEditorHeight(storedEditorHeight, false);
        var storedFold = viewer.layout && viewer.layout.editorToolbar;
        if (storedFold === "folded" && config.persistLayout !== false) setToolbarCollapsed(true, false);
        applyFontSize(fontSize, false);
        requestAnimationFrame(measureMetrics);
        applyButton.addEventListener("click", function () { viewer.applySource(); });
        revertButton.addEventListener("click", function () { viewer.revertSource(); });
        copyButton.addEventListener("click", function () {
            var text = textarea.value;
            var done = function () {
                copyButton.innerHTML = ICONS.check;
                setTimeout(function () { copyButton.textContent = "Copy"; }, 900);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
            } else {
                fallbackCopy(text);
                done();
            }
        });

        function fallbackCopy(text) {
            try {
                var temp = document.createElement("textarea");
                temp.value = text;
                temp.style.position = "fixed";
                temp.style.opacity = "0";
                document.body.appendChild(temp);
                temp.select();
                document.execCommand("copy");
                document.body.removeChild(temp);
            } catch (err) { /* ignore */ }
        }

        return {
            el: wrap,
            setValue: setValue,
            setVertex: function (text) {
                buffers.vertex = text || null;
                vertexEnabled = !!text;
                if (activeBuffer === "vertex") textarea.value = text || VERTEX_STARTER;
                updateTabs();
            },
            getFragment: function () {
                buffers[activeBuffer] = textarea.value;
                return buffers.fragment;
            },
            getVertex: function () {
                buffers[activeBuffer] = textarea.value;
                return vertexEnabled ? buffers.vertex : null;
            },
            activeBuffer: function () { return activeBuffer; },
            setBuffer: setActiveBuffer,
            toggleComment: toggleComment,
            applyFontSize: applyFontSize,
            value: function () { return textarea.value; },
            setStatus: setStatus,
            toggleToolbar: function () { setToolbarCollapsed(!toolbarCollapsed, true); },
            folded: function () { return toolbarCollapsed; },
            refreshFold: refreshFold,
            markError: markError,
            focus: function () {
                try { textarea.focus({ preventScroll: true }); } catch (err) { textarea.focus(); }
                measureMetrics();
                syncScroll();
            },
            scheduleHighlight: scheduleHighlight,
            measure: measureMetrics
        };
    }

    /* ==================================================================
     * WebGL helpers
     * ================================================================== */

    function createGL(canvas) {
        var attrs = {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: "default",
            failIfMajorPerformanceCaveat: false
        };
        var names = ["webgl2", "webgl", "experimental-webgl"];
        for (var i = 0; i < names.length; i++) {
            try {
                var gl = canvas.getContext(names[i], attrs);
                if (gl) { gl.__isfContextName = names[i]; return gl; }
            } catch (err) { /* try the next one */ }
        }
        return null;
    }

    function parseGLCompileLog(log) {
        var messages = [];
        var lines = String(log || "").split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var match = /^(ERROR|WARNING)\s*:\s*\d+\s*:\s*(\d+)\s*:\s*(.*)$/.exec(line);
            if (match) {
                messages.push({ severity: match[1].toLowerCase(), line: Number(match[2]), message: trim(match[3]) });
                continue;
            }
            match = /^\d+\s*\((\d+)\)\s*:\s*(error|warning)\s*[A-Za-z0-9]*\s*:\s*(.*)$/i.exec(line);
            if (match) {
                messages.push({ severity: match[2].toLowerCase(), line: Number(match[1]), message: trim(match[3]) });
            }
        }
        return messages;
    }

    function detectFloatRenderable(gl, isGL2) {
        try {
            if (isGL2) {
                if (!gl.getExtension("EXT_color_buffer_float")) return false;
            } else {
                if (!gl.getExtension("OES_texture_float")) return false;
            }
            var texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texImage2D(gl.TEXTURE_2D, 0, isGL2 ? gl.RGBA32F : gl.RGBA, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
            var fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            gl.deleteTexture(texture);
            return status === gl.FRAMEBUFFER_COMPLETE;
        } catch (err) {
            return false;
        }
    }

    /* ==================================================================
     * K2 runtime: the shared ISF core behind the plugin's UI
     *
     * `ISFRuntimeCore` keeps the surface the viewer/editor consume (time,
     * playing, events, inputSources, previewTarget, qualityScale, snapshot,
     * stats) but delegates parsing, compiling, the pass loop, buffers, image
     * upload and the snapshot buffer to `ISFCore.render.createRenderer`.
     * ================================================================== */

    function ISFRuntimeCore(viewer, gl) {
        this.viewer = viewer;
        this.config = viewer.config;
        this.gl = gl;
        this.isGL2 = gl.__isfContextName === "webgl2";
        this.renderer = ISFCore.render.createRenderer({ canvas: gl.canvas, gl: gl, colorSpace: "raw" });
        this.floatSupported = detectFloatRenderable(gl, this.isGL2);
        this.compiled = false;
        this.inputs = [];
        this.passes = [];
        this.generators = [];
        this.images = [];
        this.inputSources = {};
        this.uploaded = {};
        this.audioCanvases = {};
        this.values = viewer.values;
        this.events = {};
        this.time = 0;
        this.lastNow = performance.now();
        this.frameIndex = 0;
        this.transitionTime = 0;
        this.playing = !!this.config.autoplay && (!!this.config.forcePlay || !prefersReducedMotion());
        this.visible = true;
        this.needsRender = true;
        this.running = false;
        this.destWidth = 1;
        this.destHeight = 1;
        this.frameCount = 0;
        this.statsAt = 0;
        this.fps = 0;
        this.maxFps = Math.max(0, Number(this.config.maxFps) || 0);
        this._lastDrawAt = 0;
        this.previewTarget = null;
        this.qualityScale = null;
        this.maxResolution = viewer.resolutionChoice || this.config.maxResolution || "sd";
        this.mouse = [0, 0, 0, 0];
        this.pointerDown = false;
        this.fixedDate = null;
        this.compatibilityLabel = "";
        var self = this;
        this._tick = function (now) { self.tick(now); };
        this._contextLost = function (event) { event.preventDefault(); self.handleContextLost(); };
        gl.canvas.addEventListener("webglcontextlost", this._contextLost, false);
        this.bindPointer();
        this.resize(true);
    }

    ISFRuntimeCore.prototype.compile = function (shader) {
        var source = (this.viewer.parse && this.viewer.parse.raw) || (shader && shader.source) || "";
        if (!source) return { message: "The material source is not available" };
        this.resize(false);
        var state = this.renderer.setSource(source, { width: this.destWidth, height: this.destHeight }, {
            includes: this.viewer.includes || null,
            vs: this.viewer.vertexSource || null,
        });
        this.inputs = shader.inputs || (state.parsed && state.parsed.inputs) || [];
        this.passes = shader.passes || (state.parsed && state.parsed.passes) || [];
        this.generators = shader.generators || (state.parsed && state.parsed.generators) || [];
        this.images = shader.images || [];
        this.uploaded = {};
        this.needsRender = true;
        if (!state.ok) {
            this.compiled = false;
            return this.compileError(state);
        }
        this.compiled = true;
        // The plugin's convention: an ISF material targets ES 1.00, so
        // rendering it through ES 3.00 on WebGL2 is itself compatibility mode;
        // the core only warns when it needed a retry.
        var warning = "";
        var warnings = state.warnings || [];
        for (var wi = 0; wi < warnings.length; wi++) {
            if (/compatibility mode/i.test(warnings[wi].message || "")) warning = warnings[wi].message;
        }
        if (state.api === "es3") {
            this.compatibilityLabel = warning
                ? (/int casts/i.test(warning) ? "Compatibility mode · ES 3.00 + int casts"
                    : /literal promotion/i.test(warning) ? "Compatibility mode · ES 3.00 + literal promotion"
                        : "Compatibility mode · WebGL2 / GLSL ES 3.00")
                : "Compatibility mode · WebGL2 / GLSL ES 3.00";
        } else {
            this.compatibilityLabel = warning
                ? (/int casts/i.test(warning) ? "Compatibility mode · int casts" : "Compatibility mode · literal promotion")
                : "";
        }
        return null;
    };

    /** The viewer's error UI expects the old compiler's message shape. */
    ISFRuntimeCore.prototype.compileError = function (state) {
        var errs = state.errors || [];
        if (!errs.length) return { message: (state.error && state.error.message) || "The material did not compile" };
        var first = errs[0];
        return {
            log: errs.map(function (e) { return e.message; }).join("\n"),
            message: first.message,
            label: first.pass === 'vertex' ? "vertex shader" : "fragment shader",
            context: this.compatibilityLabel || "compile",
            messages: errs.map(function (e) {
                return { severity: e.severity || "error", line: e.line || 1, message: e.message };
            }),
            fileLine: first.fileLine,
        };
    };

    ISFRuntimeCore.prototype.resize = function (force) {
        this.baseResize(force);
        var canvas = this.gl && this.gl.canvas;
        if (canvas && (canvas.width !== this.destWidth || canvas.height !== this.destHeight)) {
            canvas.width = this.destWidth;
            canvas.height = this.destHeight;
        }
        this.renderer.resize(this.destWidth, this.destHeight);
    };

    ISFRuntimeCore.prototype.updateInputTextures = function () {
        for (var i = 0; i < this.images.length; i++) {
            var image = this.images[i];
            if (image.kind === "pass" || image.kind === "audio") continue;
            var source = this.inputSources[image.name];
            if (!source && image.kind === "input") source = this.defaultImageSource(image.input);
            if (!source || this.uploaded[image.name] === source) continue;
            var hints = image.import
                ? { wrap: image.import.wrap, minFilter: image.import.minFilter, magFilter: image.import.magFilter }
                : undefined;
            try {
                this.renderer.setImage(image.name, source, hints);
                this.uploaded[image.name] = source;
            } catch (err) { /* a missing imported asset stays unbound */ }
        }
    };

    ISFRuntimeCore.prototype.updateAudioTextures = function () {
        var analyser = this.viewer.audioState ? this.viewer.audioState.analyser : null;
        var buffer = this.viewer.audioState ? this.viewer.audioState.data : null;
        for (var i = 0; i < this.images.length; i++) {
            var image = this.images[i];
            if (image.kind !== "audio" || !image.input) continue;
            var input = image.input;
            var samples = input.samples || 512;
            var canvas = this.audioCanvases[input.name];
            if (!canvas) {
                canvas = document.createElement("canvas");
                canvas.width = samples;
                canvas.height = 1;
                this.audioCanvases[input.name] = canvas;
            }
            var context = canvas.getContext("2d");
            var pixels = context.createImageData(samples, 1);
            var data = pixels.data;
            var time = this.time;
            if (analyser && buffer) {
                if (buffer.length !== analyser.frequencyBinCount) {
                    buffer = new Uint8Array(analyser.frequencyBinCount);
                    this.viewer.audioState.data = buffer;
                }
                if (input.type === "audio") analyser.getByteTimeDomainData(buffer);
                else analyser.getByteFrequencyData(buffer);
                var binCount = buffer.length;
                for (var m = 0; m < samples; m++) {
                    var bin = Math.min(binCount - 1, Math.round(m / samples * binCount));
                    var byte = buffer[bin];
                    data[m * 4] = byte; data[m * 4 + 1] = byte; data[m * 4 + 2] = byte; data[m * 4 + 3] = 255;
                }
            } else {
                for (var x = 0; x < samples; x++) {
                    var t = x / samples;
                    var value;
                    if (input.type === "audio") {
                        var envelope = Math.sin(Math.PI * t);
                        value = 0.5 + 0.42 * envelope * Math.sin((t * 6.0 - time * 1.7) * Math.PI * 2) * (0.7 + 0.3 * Math.sin(time * 0.7));
                    } else {
                        var falloff = Math.pow(1 - t, 1.7);
                        value = falloff * (0.55 + 0.45 * Math.sin(time * 2.1 + t * 14.0)) * 0.9;
                    }
                    var synth = Math.max(0, Math.min(255, Math.round(value * 255)));
                    data[x * 4] = synth; data[x * 4 + 1] = synth; data[x * 4 + 2] = synth; data[x * 4 + 3] = 255;
                }
            }
            context.putImageData(pixels, 0, 0);
            try { this.renderer.setImage(input.name, canvas); } catch (err) { /* ignore */ }
        }
    };

    // the core integrates generators against its own clock, and rewinds them
    // when a frozen capture goes back in time
    ISFRuntimeCore.prototype.resetGenerators = function () {};
    ISFRuntimeCore.prototype.updateGenerators = function () {};

    ISFRuntimeCore.prototype.draw = function (delta) {
        if (!this.compiled) return;
        this.resize(false);
        if (this.destWidth <= 1 || this.destHeight <= 1) return;
        this.updateInputTextures();
        this.updateAudioTextures();
        if (this.viewer.transition && this.config.loopTransition && this.playing) {
            var duration = Math.max(0.5, Number(this.config.transitionDuration) || 4);
            this.transitionTime += delta || 0;
            var cycle = this.transitionTime % (duration * 2);
            if (cycle < 0) cycle += duration * 2;
            var progress = cycle <= duration ? cycle / duration : 2 - cycle / duration;
            this.values.progress = progress;
            if (this.viewer.syncParameterControl) this.viewer.syncParameterControl("progress", progress);
        }
        var params = assign({}, this.values);
        for (var i = 0; i < this.inputs.length; i++) {
            var input = this.inputs[i];
            if (input.type === "event") params[input.name] = !!this.events[input.name];
        }
        this.renderer.setParams(params);
        var now = this.fixedDate || new Date();
        this.renderer.setTime(this.time);
        this.renderer.setMouse(this.mouse);
        this.renderer.setDate([now.getFullYear(), now.getMonth() + 1, now.getDate(),
            now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()]);
        this.renderer.render();
        if (this.previewTarget && this.renderer.presentTarget) this.renderer.presentTarget(this.previewTarget);
        this.events = {};
        this.frameIndex++;
        this.frameCount++;
        var nowMs = performance.now();
        if (!this.statsAt) this.statsAt = nowMs;
        if (nowMs - this.statsAt >= 500) {
            this.fps = Math.round(this.frameCount * 1000 / (nowMs - this.statsAt));
            this.frameCount = 0;
            this.statsAt = nowMs;
            this.viewer.updateBadge(this.fps + " fps · " + this.destWidth + "×" + this.destHeight + (this.passes.length > 1 ? " · " + this.passes.length + " passes" : ""));
            if (this.viewer.syncClock) this.viewer.syncClock(this.time, this.playing);
        }
    };

    ISFRuntimeCore.prototype.snapshot = function (options) {
        if (!this.compiled || !this.gl) return null;
        try {
            if (!options || options.render !== false) this.draw(0);
            var source = this.gl.canvas;
            // The drawing buffer is already in display orientation (top-down),
            // which is the ISF frame and the OBS `_cover.png` orientation.
            // `flipY: true` is the opt-in raw bottom-up buffer.
            if (!(options && options.flipY)) return source.toDataURL("image/png");
            var canvas = document.createElement("canvas");
            canvas.width = source.width;
            canvas.height = source.height;
            var context = canvas.getContext("2d");
            context.translate(0, canvas.height);
            context.scale(1, -1);
            context.drawImage(source, 0, 0);
            return canvas.toDataURL("image/png");
        } catch (err) {
            return null;
        }
    };

    ISFRuntimeCore.prototype.dispose = function () {
        this.stop();
        try {
            var stage = this.viewer.dom.stage;
            if (this._onPointerMove) stage.removeEventListener("pointermove", this._onPointerMove);
            if (this._onPointerDown) stage.removeEventListener("pointerdown", this._onPointerDown);
            if (this._onPointerLeave) stage.removeEventListener("pointerleave", this._onPointerLeave);
            if (this._onPointerUp) window.removeEventListener("pointerup", this._onPointerUp);
        } catch (err) { /* ignore */ }
        try { this.gl.canvas.removeEventListener("webglcontextlost", this._contextLost, false); } catch (err) { /* ignore */ }
        try { if (this.renderer) this.renderer.destroy(); } catch (err) { /* ignore */ }
        this.renderer = null;
        if (this.paint) { try { this.gl.deleteProgram(this.paint.program); } catch (err) { /* ignore */ } this.paint = null; }
        if (this.vertexBuffer) { try { this.gl.deleteBuffer(this.vertexBuffer); } catch (err) { /* ignore */ } this.vertexBuffer = null; }
        try {
            var lose = this.gl.getExtension("WEBGL_lose_context");
            if (lose && this.gl.canvas === this.viewer.dom.canvas) lose.loseContext();
        } catch (err) { /* ignore */ }
        this.gl = null;
    };

    ISFRuntimeCore.prototype.bindPointer = function () {
        var self = this;
        var stage = this.viewer.dom.stage;
        // Only feed the pointer extension from the render surface; UI events
        // (sliders, selects, the editor) must keep their native behaviour.
        function isRenderTarget(target) {
            return target === self.viewer.dom.canvas;
        }
        function point(event) {
            var canvas = self.viewer.dom.canvas;
            var rect = canvas.getBoundingClientRect();
            var width = Math.max(1, rect.width);
            var height = Math.max(1, rect.height);
            var x = (event.clientX - rect.left) / width * self.destWidth;
            var y = (1 - (event.clientY - rect.top) / height) * self.destHeight;
            return [clamp(x, 0, self.destWidth), clamp(y, 0, self.destHeight)];
        }
        this._onPointerMove = function (event) {
            if (!isRenderTarget(event.target)) return;
            var p = point(event);
            self.mouse[0] = p[0];
            self.mouse[1] = p[1];
            self.mouse[2] = self.pointerDown ? self._clickX : -Math.abs(self._clickX);
            self.mouse[3] = self._clickY;
            self.needsRender = true;
        };
        this._onPointerDown = function (event) {
            if (!isRenderTarget(event.target)) return;
            var p = point(event);
            self.pointerDown = true;
            self._clickX = p[0];
            self._clickY = p[1];
            self.mouse = [p[0], p[1], p[0], p[1]];
            self.needsRender = true;
            event.preventDefault();
        };
        this._onPointerUp = function () {
            self.pointerDown = false;
            self.mouse[2] = -Math.abs(self._clickX);
            self.needsRender = true;
        };
        this._onPointerLeave = function () {
            self.pointerDown = false;
            self.mouse[2] = -Math.abs(self._clickX);
        };
        stage.addEventListener("pointermove", this._onPointerMove);
        stage.addEventListener("pointerdown", this._onPointerDown);
        stage.addEventListener("pointerleave", this._onPointerLeave);
        window.addEventListener("pointerup", this._onPointerUp);
    };

    ISFRuntimeCore.prototype.handleContextLost = function () {
        this.running = false;
        if (this.viewer) this.viewer.handleContextLost();
    };

    ISFRuntimeCore.prototype.start = function () {
        if (this.running) return;
        this.running = true;
        this.lastNow = performance.now();
        this.raf = requestAnimationFrame(this._tick);
    };

    ISFRuntimeCore.prototype.stop = function () {
        this.running = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = null;
    };

    ISFRuntimeCore.prototype.tick = function (now) {
        if (!this.running) return;
        var self = this;
        this.raf = requestAnimationFrame(this._tick);
        if (!this.visible || (typeof document !== "undefined" && document.hidden)) {
            this.lastNow = now;
            return;
        }
        if (!this.playing && !this.needsRender) return;
        if (this.playing && this.maxFps > 0 && this._lastDrawAt && now - this._lastDrawAt < 1000 / this.maxFps) {
            return; // capped frame rate; lastNow keeps the elapsed time for the next draw
        }
        this._lastDrawAt = now;
        var delta = 0;
        if (this.playing) {
            delta = Math.max(0, Math.min(0.1, (now - this.lastNow) / 1000));
            this.time += delta;
        }
        this.lastNow = now;
        this.needsRender = false;
        try {
            this.draw(delta);
        } catch (err) {
            this.running = false;
            this.viewer.runtimeError(err);
        }
    };

    ISFRuntimeCore.prototype.setPlaying = function (playing) {
        this.playing = !!playing;
        if (this.playing) this.lastNow = performance.now();
        this.needsRender = true;
    };

    ISFRuntimeCore.prototype.defaultImageSource = function (input) {
        var self = this;
        var name = input.name;
        if (this.inputSources[name]) return this.inputSources[name];
        var variant = /end/i.test(name) ? "b" : "a";
        var canvas = createTestPattern(512, 512, variant);
        this.inputSources[name] = canvas;
        if (this.config.imageUrl) {
            var image = new Image();
            image.crossOrigin = "anonymous";
            image.onload = function () {
                self.inputSources[name] = image;
                self.viewer.needsRender = true;
                self.needsRender = true;
            };
            image.onerror = function () { self.viewer.warn("Could not load imageUrl for " + name); };
            image.src = this.config.imageUrl;
        }
        return canvas;
    };

    ISFRuntimeCore.prototype.baseResize = function (force) {
        var canvas = this.gl.canvas;
        var rect;
        try { rect = canvas.getBoundingClientRect(); } catch (err) { rect = null; }
        var cssWidth = Math.max(1, Math.round((rect && rect.width) || canvas.clientWidth || 1));
        var cssHeight = Math.max(1, Math.round((rect && rect.height) || canvas.clientHeight || 1));
        var dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
        var resolution = this.qualityScale !== null && this.qualityScale !== undefined ? this.qualityScale : this.config.resolution;
        var scale;
        if (resolution === "auto") scale = Math.min(dpr, Number(this.config.maxPixelRatio) || 2);
        else scale = Number(resolution) || 1;
        if (!isFinite(scale) || scale <= 0) scale = 1;
        // Cap the drawing buffer to the configured max resolution, preserving
        // the CSS aspect ratio (SD by default: large/high-DPR viewers render
        // at ~480p and are upscaled by the browser).
        var preset = RESOLUTION_PRESETS[resolutionPreset(this.maxResolution)];
        if (preset) scale = Math.min(scale, preset.width / cssWidth, preset.height / cssHeight);
        var maxSize = 0;
        try { maxSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 4096; } catch (err) { maxSize = 4096; }
        var width = clamp(Math.round(cssWidth * scale), 1, Math.min(maxSize, 8192));
        var height = clamp(Math.round(cssHeight * scale), 1, Math.min(maxSize, 8192));
        if (force || canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            this.needsRender = true;
        }
        this.destWidth = width;
        this.destHeight = height;
    };

    /* ==================================================================
     * GPU context budget
     * ================================================================== */

    var BUDGET = {
        max: 8,
        active: [],
        waiting: [],
        _pumpTimer: null,
        setMax: function (max) {
            max = Math.max(1, Math.round(Number(max) || 8));
            this.max = max;
            while (this.active.length > max) {
                var victim = this.active[0];
                if (victim === undefined) break;
                victim.releaseContext();
                if (this.active[0] === victim) this.active.shift();
            }
            this.schedulePump();
        },
        acquire: function (viewer) {
            var index = this.active.indexOf(viewer);
            if (index !== -1) { this.touch(viewer); this.dequeue(viewer); return true; }
            if (this.active.length >= this.max) {
                var victim = this.pickVictim(viewer);
                if (victim) victim.releaseContext();
            }
            if (this.active.length < this.max) {
                this.active.push(viewer);
                viewer.lastUsed = performance.now();
                this.dequeue(viewer);
                return true;
            }
            this.enqueue(viewer);
            return false;
        },
        release: function (viewer) {
            var index = this.active.indexOf(viewer);
            if (index !== -1) this.active.splice(index, 1);
            this.schedulePump();
        },
        enqueue: function (viewer) {
            if (this.waiting.indexOf(viewer) === -1) this.waiting.push(viewer);
        },
        dequeue: function (viewer) {
            var index = this.waiting.indexOf(viewer);
            if (index !== -1) this.waiting.splice(index, 1);
        },
        schedulePump: function () {
            if (this._pumpTimer) return;
            var self = this;
            this._pumpTimer = setTimeout(function () {
                self._pumpTimer = null;
                self.pump();
            }, 250);
        },
        pump: function () {
            while (this.waiting.length && this.active.length < this.max) {
                var viewer = this.waiting.shift();
                if (viewer && !viewer.disposed) viewer.initRuntime();
            }
        },
        touch: function (viewer) {
            viewer.lastUsed = performance.now();
        },
        pickVictim: function (except) {
            var candidate = null;
            for (var i = 0; i < this.active.length; i++) {
                var viewer = this.active[i];
                if (viewer === except) continue;
                if (!candidate) { candidate = viewer; continue; }
                if ((viewer.visible ? 0 : 1) > (candidate.visible ? 0 : 1)) candidate = viewer;
                else if (viewer.visible === candidate.visible && viewer.lastUsed < candidate.lastUsed) candidate = viewer;
            }
            return candidate;
        }
    };

    /* ==================================================================
     * Viewer
     * ================================================================== */

    function isShaderHref(href, config) {
        if (!href) return false;
        if (/^(mailto:|tel:|javascript:|data:|blob:)/i.test(href)) return false;
        var clean = String(href).replace(/^#/, "").split("#")[0].split("?")[0];
        var match = /\.([A-Za-z0-9]+)$/.exec(clean);
        if (!match) return false;
        return config.extensions.indexOf(match[1].toLowerCase()) !== -1;
    }

    function viewerOverlay(block) {
        return block.querySelector(".isf-overlay");
    }

    function createViewer(anchor, title, config, routePath) {
        var viewer = {};
        viewer.config = config;
        viewer.href = anchor.getAttribute("href") || "";
        viewer.routePath = routePath || "";
        viewer.title = title || basename(viewer.href);
        viewer.state = "idle";
        // A viewer released by the context budget rebuilds its controls when it
        // resumes; the auto-open decision must not override a drawer the user
        // already toggled.
        viewer.drawerTouched = false;
        viewer.visible = false;
        viewer.lastUsed = performance.now();
        viewer.values = {};
        viewer.events = {};
        viewer.listeners = [];
        viewer.disposed = false;
        viewer.url = resolveAssetUrl(viewer.href, viewer.routePath);
        viewer.candidates = resolveCandidates(viewer.href, viewer.routePath);
        viewer.rawSource = "";
        viewer.source = "";
        viewer.lastErrorText = "";
        viewer.audioState = null;
        viewer.layout = loadLayout();
        viewer.urlFlags = readUrlFlags();
        viewer.resolutionChoice = (viewer.urlFlags && viewer.urlFlags.resolution) ||
            (viewer.layout && resolutionPreset(viewer.layout.resolutionCap)) || "";
        viewer.qualityChoice = (viewer.urlFlags && viewer.urlFlags.quality) ||
            (viewer.layout && viewer.layout.quality) || config.resolution || "auto";
        viewer.includes = {};
        VIEWERS.push(viewer);
        viewer.saveLayout = function (patch) {
            if (config.persistLayout === false) return;
            for (var key in patch) {
                if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
                if (patch[key] === null || patch[key] === undefined) delete viewer.layout[key];
                else viewer.layout[key] = patch[key];
            }
            saveLayout(viewer.layout);
        };

        ensureStyle();

        // Header + stage + overlay drawers
        var block = h("div", "isf-block", { dataset: { isfUrl: viewer.url, isfTitle: viewer.title } });
        var header = h("div", "isf-header");
        var titleEl = h("a", "isf-title", {
            href: viewer.url,
            target: "_blank",
            rel: "noopener",
            title: "Open " + viewer.title + " source",
            text: viewer.title,
            dataset: { puiItem: "title" }
        });
        var uid = "isf-" + (++VIEWER_SEQ);
        var actions = h("div", "isf-actions");
        var paramsButton = iconButton("params", "params", "Parameters");
        paramsButton.setAttribute("aria-controls", uid + "-params");
        var paramsCount = h("span", "isf-count");
        paramsButton.appendChild(paramsCount);
        var editorButton = config.editor ? iconButton("editor", "editor", "Source editor") : null;
        if (editorButton) editorButton.setAttribute("aria-controls", uid + "-editor");
        var playButton = iconButton("play", "play", "Pause");
        var resetButton = iconButton("reset", "reset", "Reset parameters and time");
        var fullscreenButton = iconButton("fullscreen", "fullscreen", "Fullscreen");
        var sourceButton = config.showSource ? h("a", "isf-btn", {
            href: viewer.url,
            target: "_blank",
            rel: "noopener",
            title: "Open source file",
            "aria-label": "Open source file"
        }) : null;
        if (sourceButton) {
            sourceButton.innerHTML = ICONS.source;
            sourceButton.setAttribute("data-pui-item", "source");
        }
        var shareButton = config.share !== false ? iconButton("share", "share", "Copy a fullscreen link for OBS (current parameters)") : null;
        if (editorButton) actions.appendChild(editorButton);
        actions.appendChild(paramsButton);
        actions.appendChild(playButton);
        actions.appendChild(resetButton);
        actions.appendChild(fullscreenButton);
        if (sourceButton) actions.appendChild(sourceButton);
        if (shareButton) actions.appendChild(shareButton);
        header.appendChild(titleEl);
        header.appendChild(actions);
        var headerPUIHost = h("div", "isf-pui isf-pui-header isf-hidden");
        header.appendChild(headerPUIHost);

        var body = h("div", "isf-body");
        var stage = h("div", "isf-stage");
        var canvas = h("canvas", "isf-canvas", { tabindex: "0", role: "img", "aria-label": "ISF shader preview" });
        var overlay = h("div", "isf-overlay");
        var overlayInner = h("div", "isf-overlay-inner");
        overlay.appendChild(overlayInner);
        overlay.style.display = "none";
        var badge = h("div", "isf-badge isf-hidden");
        // the stats pill lives in the top bar, never over the shader
        header.insertBefore(badge, actions);
        stage.appendChild(canvas);
        stage.appendChild(overlay);

        var paramsPanel = h("div", "isf-panel isf-params", {
            id: uid + "-params", role: "region", "aria-label": "Parameters"
        });
        var paramsTitle = h("div", "isf-panel-title");
        paramsTitle.appendChild(h("span", null, { text: "Parameters" }));
        var paramsClose = h("button", "isf-btn isf-panel-close", { type: "button", "aria-label": "Close parameters", title: "Close", text: "×" });
        paramsTitle.appendChild(paramsClose);
        paramsPanel.appendChild(paramsTitle);
        var paramsIntro = h("div", "isf-panel-intro isf-hidden");
        paramsPanel.appendChild(paramsIntro);
        var paramsList = h("div", "isf-params-list");
        paramsPanel.appendChild(paramsList);
        var rightResize = h("div", "isf-resize-x isf-resize-right", {
            role: "separator", "aria-orientation": "vertical",
            "aria-label": "Resize the parameters drawer", tabindex: "0",
            title: "Drag to resize the parameters drawer — double-click to reset"
        });
        var rightInner = h("div", "isf-drawer-inner");
        rightInner.appendChild(paramsPanel);
        var rightDrawer = h("div", "isf-drawer isf-drawer-right isf-drawer-closed");
        rightDrawer.appendChild(rightResize);
        rightDrawer.appendChild(rightInner);

        var leftResize = h("div", "isf-resize-x isf-resize-left", {
            role: "separator", "aria-orientation": "vertical",
            "aria-label": "Resize the code drawer", tabindex: "0",
            title: "Drag to resize the code drawer — double-click to reset"
        });
        var leftInner = h("div", "isf-drawer-inner");
        var editor = null;
        if (config.editor) {
            editor = createEditor(viewer, config);
            editor.el.id = uid + "-editor";
            editor.el.classList.add("isf-hidden");
            leftInner.appendChild(editor.el);
        }
        var importPanel = h("div", "isf-panel isf-import isf-hidden", { id: uid + "-import", role: "region", "aria-label": "Import Shadertoy or GLSL Sandbox" });
        var importTitle = h("div", "isf-panel-title");
        importTitle.appendChild(h("span", null, { text: "Import Shadertoy / GLSL Sandbox" }));
        var importClose = h("button", "isf-btn isf-panel-close", { type: "button", "aria-label": "Close import", title: "Close", text: "×" });
        importTitle.appendChild(importClose);
        var importArea = h("textarea", null, {
            spellcheck: "false",
            placeholder: "Paste a Shadertoy mainImage() shader or a GLSL Sandbox shader…",
            "aria-label": "Shader source to import"
        });
        var importStatus = h("span", "isf-import-status", { "aria-live": "polite" });
        var importActions = h("div", "isf-import-actions");
        var importConvert = h("button", "isf-btn", { type: "button", text: "Convert & Load" });
        importActions.appendChild(importConvert);
        importActions.appendChild(importStatus);
        importPanel.appendChild(importTitle);
        importPanel.appendChild(importArea);
        importPanel.appendChild(importActions);
        leftInner.appendChild(importPanel);
        var leftDrawer = h("div", "isf-drawer isf-drawer-left isf-drawer-closed");
        leftDrawer.appendChild(leftResize);
        leftDrawer.appendChild(leftInner);

        stage.appendChild(leftDrawer);
        stage.appendChild(rightDrawer);
        updateDrawerButtons();
        body.appendChild(stage);
        var status = h("div", "isf-status isf-hidden", { "aria-live": "polite" });
        var statusText = h("span", "isf-status-text");
        status.appendChild(statusText);
        var statusPUIHost = h("div", "isf-pui isf-pui-statusbar");
        status.appendChild(statusPUIHost);
        block.appendChild(header);
        block.appendChild(body);
        block.appendChild(status);

        viewer.dom = {
            block: block,
            header: header,
            title: titleEl,
            actions: actions,
            stage: stage,
            canvas: canvas,
            overlay: overlay,
            overlayInner: overlayInner,
            badge: badge,
            leftDrawer: leftDrawer,
            rightDrawer: rightDrawer,
            leftResize: leftResize,
            rightResize: rightResize,
            body: body,
            paramsPanel: paramsPanel,
            paramsIntro: paramsIntro,
            paramsList: paramsList,
            paramsCount: paramsCount,
            paramsButton: paramsButton,
            editorButton: editorButton,
            editorPanel: editor ? editor.el : null,
            importPanel: importPanel,
            playButton: playButton,
            resetButton: resetButton,
            fullscreenButton: fullscreenButton,
            sourceButton: sourceButton,
            shareButton: shareButton,
            status: status,
            statusText: statusText,
            statusPUIHost: statusPUIHost,
            headerPUIHost: headerPUIHost
        };
        viewer.editor = editor;
        viewer.runtime = null;
        viewer.gl = null;

        // Bare viewers (the share/OBS URL) hide every control by default but
        // keep the whole editing experience one gesture away: hover or focus
        // the corner button, press H, or click it; Escape hides it back.
        if (config.bare) {
            block.classList.add("isf-bare");
            var revealButton = h("button", "isf-reveal-btn", {
                type: "button", html: ICONS.eye,
                title: "Show controls (H)", "aria-label": "Show controls", "aria-pressed": "false"
            });
            block.appendChild(revealButton);
            var setRevealed = function (revealed) {
                block.classList.toggle("isf-revealed", !!revealed);
                revealButton.title = revealed ? "Hide controls (H)" : "Show controls (H)";
                revealButton.setAttribute("aria-label", revealed ? "Hide controls" : "Show controls");
                revealButton.setAttribute("aria-pressed", revealed ? "true" : "false");
                if (viewer.runtime) viewer.runtime.needsRender = true;
            };
            viewer.setRevealed = setRevealed;
            viewer.dom.revealButton = revealButton;
            revealButton.addEventListener("click", function () {
                setRevealed(!block.classList.contains("isf-revealed"));
            });
            var revealKeyHandler = function (event) {
                if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
                var target = event.target;
                if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" || target.isContentEditable)) return;
                if (event.key === "h" || event.key === "H") {
                    event.preventDefault();
                    setRevealed(!block.classList.contains("isf-revealed"));
                } else if (event.key === "Escape" && block.classList.contains("isf-revealed")) {
                    setRevealed(false);
                }
            };
            document.addEventListener("keydown", revealKeyHandler);
            viewer.listeners.push(function () { document.removeEventListener("keydown", revealKeyHandler); });
        }

        /* ------------------------------------------------------- layout */

        function isFullscreenActive() {
            var fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            return fullscreenElement === block;
        }

        function applyStageLayout() {
            if (config.aspectRatio) {
                stage.style.aspectRatio = String(config.aspectRatio).replace(":", "/");
                stage.style.height = "auto";
            } else {
                stage.style.aspectRatio = "";
                stage.style.height = config.height || "360px";
            }
            if (config.width && config.width !== "100%") block.style.maxWidth = config.width;
        }

        function maxDrawerWidth() {
            var stageWidth = stage.getBoundingClientRect().width || (typeof window !== "undefined" ? window.innerWidth : 1200);
            // One open drawer may take more room; two must leave the render visible.
            var fraction = openDrawerCount() >= 2 ? 0.46 : 0.64;
            return Math.max(240, Math.min(820, stageWidth * fraction));
        }

        function isDrawerClosed(drawer) {
            return drawer.classList.contains("isf-drawer-closed");
        }

        function openDrawerCount() {
            return (isDrawerClosed(leftDrawer) ? 0 : 1) + (isDrawerClosed(rightDrawer) ? 0 : 1);
        }

        function clampDrawerWidths() {
            var limit = maxDrawerWidth();
            if (leftDrawer.style.width) leftDrawer.style.width = clamp(parseFloat(leftDrawer.style.width) || 380, 240, limit) + "px";
            if (rightDrawer.style.width) rightDrawer.style.width = clamp(parseFloat(rightDrawer.style.width) || 380, 240, limit) + "px";
        }

        function setDrawerWidth(drawer, px, key, persist) {
            var width = clamp(px, 240, maxDrawerWidth());
            drawer.style.width = width + "px";
            if (persist) {
                var patch = {};
                patch[key] = width;
                viewer.saveLayout(patch);
            }
            return width;
        }

        // Drawers overlay the canvas on both edges; resizing them never
        // changes the render size. The handle on the inner edge of each
        // drawer drags it wider, and is keyboard-operable.
        function bindDrawerResize(handle, drawer, key, direction) {
            var startX = 0;
            var startWidth = 0;
            handle.addEventListener("pointerdown", function (event) {
                event.preventDefault();
                startX = event.clientX;
                startWidth = drawer.getBoundingClientRect().width;
                handle.classList.add("is-dragging");
                try { handle.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
            });
            handle.addEventListener("pointermove", function (event) {
                if (!handle.classList.contains("is-dragging")) return;
                setDrawerWidth(drawer, startWidth + (event.clientX - startX) * direction, key, false);
            });
            var endDrag = function (event) {
                if (!handle.classList.contains("is-dragging")) return;
                handle.classList.remove("is-dragging");
                try { handle.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
                var patch = {};
                patch[key] = drawer.getBoundingClientRect().width;
                viewer.saveLayout(patch);
            };
            handle.addEventListener("pointerup", endDrag);
            handle.addEventListener("pointercancel", endDrag);
            handle.addEventListener("dblclick", function () {
                drawer.style.width = "";
                var patch = {};
                patch[key] = null;
                viewer.saveLayout(patch);
            });
            handle.addEventListener("keydown", function (event) {
                var current = drawer.getBoundingClientRect().width;
                var delta = event.shiftKey ? 64 : 16;
                if (event.key === "ArrowRight") { event.preventDefault(); setDrawerWidth(drawer, current + delta * direction, key, true); }
                else if (event.key === "ArrowLeft") { event.preventDefault(); setDrawerWidth(drawer, current - delta * direction, key, true); }
                else if (event.key === "Home") { event.preventDefault(); setDrawerWidth(drawer, 240, key, true); }
                else if (event.key === "End") { event.preventDefault(); setDrawerWidth(drawer, maxDrawerWidth(), key, true); }
            });
        }

        applyStageLayout();
        bindDrawerResize(leftResize, leftDrawer, "leftWidth", 1);
        bindDrawerResize(rightResize, rightDrawer, "paramsWidth", -1);
        var storedLeft = viewer.layout.leftWidth || viewer.layout.editorWidth || viewer.layout.sideWidth;
        var storedRight = viewer.layout.paramsWidth || viewer.layout.sideWidth;
        if (storedLeft && config.persistLayout !== false) setDrawerWidth(leftDrawer, storedLeft, "leftWidth", false);
        if (storedRight && config.persistLayout !== false) setDrawerWidth(rightDrawer, storedRight, "paramsWidth", false);
        var drawerMetricsHandler = function () {
            clampDrawerWidths();
        };
        window.addEventListener("resize", drawerMetricsHandler);
        viewer.listeners.push(function () { window.removeEventListener("resize", drawerMetricsHandler); });
        paramsClose.addEventListener("click", function () { viewer.toggleParams(); });
        stage.addEventListener("dblclick", function (event) {
            if (event.target === canvas) viewer.toggleFullscreen();
        });
        canvas.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                viewer.toggleFullscreen();
            }
        });
        block.addEventListener("keydown", function (event) {
            if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "b" || event.key === "B")) {
                event.preventDefault();
                if (viewer.editor) viewer.editor.toggleToolbar();
            } else if ((event.ctrlKey || event.metaKey) && (event.key === "b" || event.key === "B")) {
                event.preventDefault();
                viewer.toggleEditor();
            } else if ((event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "K")) {
                event.preventDefault();
                viewer.toggleParams();
            }
        });
        function imageDropTarget() {
            if (!viewer.built) return null;
            var names = viewer.built.inputs.filter(function (input) { return input.type === "image"; }).map(function (input) { return input.name; });
            if (!names.length) return null;
            return names.indexOf("inputImage") !== -1 ? "inputImage" : names[0];
        }
        stage.addEventListener("dragover", function (event) {
            if (!imageDropTarget()) return;
            event.preventDefault();
            stage.classList.add("isf-dragover");
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        });
        stage.addEventListener("dragleave", function () { stage.classList.remove("isf-dragover"); });
        stage.addEventListener("drop", function (event) {
            stage.classList.remove("isf-dragover");
            var name = imageDropTarget();
            if (!name) { viewer.warn("This shader has no image input"); return; }
            event.preventDefault();
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (!file || !/^image\//.test(file.type)) { viewer.warn("Drop a PNG, JPEG or WebP image"); return; }
            viewer.setInputImage(name, file);
            viewer.setState("Loaded " + (file.name || "image") + " into " + name, "ok");
        });

        /* ---------------------------------------------------------- UI */

        viewer.notify = function (level, message) {
            if (notify(level, message)) return true;
            viewer.setState(message, level === "error" ? "error" : level === "warning" ? "warn" : "");
            return false;
        };
        viewer.setState = function (message, kind) {
            viewer.statusText = message ? String(message) : "";
            viewer.statusKind = kind ? String(kind) : "";
            status.className = "isf-status" + (viewer.statusText ? "" : " isf-hidden") +
                (kind ? " is-" + kind : "") + (viewer.puiStatus ? " is-pui" : "");
            if (viewer.puiStatus) {
                statusText.textContent = "";
                try { viewer.puiStatus.ui.apply(); } catch (error) { /* ignore */ }
            } else {
                statusText.textContent = viewer.statusText;
            }
        };
        viewer.warn = function (message) {
            debugLog(config, message);
            viewer.setState(message, "warn");
        };
        viewer.updateBadge = function (text) {
            if (!config.showStats) return;
            viewer.badgeText = text ? String(text) : "";
            badge.textContent = viewer.badgeText;
            badge.classList.toggle("isf-hidden", !viewer.badgeText);
            if (viewer.applyPUIHeader) viewer.applyPUIHeader();
        };
        viewer.showOverlay = function (html, show) {
            overlayInner.innerHTML = html || "";
            overlay.style.display = show ? "flex" : "none";
        };
        function showEditorPanel() {
            importPanel.classList.add("isf-hidden");
            if (viewer.editor) viewer.editor.el.classList.remove("isf-hidden");
            if (viewer.editor && viewer.editor.refreshFold) requestAnimationFrame(viewer.editor.refreshFold);
        }
        viewer.openImport = function () {
            importPanel.classList.remove("isf-hidden");
            if (viewer.editor) viewer.editor.el.classList.add("isf-hidden");
            viewer.setDrawer(leftDrawer, true);
            try { importArea.focus(); } catch (err) { /* ignore */ }
        };
        viewer.exportPng = function () {
            if (!viewer.runtime) { viewer.warn("The shader is not running yet"); return; }
            var data = viewer.runtime.snapshot();
            if (!data) { viewer.warn("Could not export the current frame"); return; }
            var link = document.createElement("a");
            link.href = data;
            link.download = (viewer.title.replace(/[^A-Za-z0-9._-]+/g, "_") || "shader") + ".png";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            viewer.notify("success", "Frame exported as " + link.download);
        };
        viewer.copyLink = function () {
            // A self-contained fullscreen URL for OBS browser sources: it names
            // the shader, its current parameters and the bare viewer mode, so
            // the capture does not depend on the page's links or local storage.
            var url = new URL(window.location.href);
            var shaderUrl = new URL(viewer.url, window.location.href).href;
            url.search = "";
            url.searchParams.set("isf-shader", shaderUrl);
            url.searchParams.set("isf-fullscreen", "1");
            url.searchParams.set("isf-res", viewer.resolutionChoice || config.maxResolution || "sd");
            url.searchParams.set("isf-quality", String(viewer.qualityChoice != null ? viewer.qualityChoice : "auto"));
            var values = {};
            if (viewer.built) {
                for (var i = 0; i < viewer.built.inputs.length; i++) {
                    var input = viewer.built.inputs[i];
                    if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") continue;
                    var value = viewer.values ? viewer.values[input.name] : undefined;
                    if (value === undefined) continue;
                    values[input.name] = value;
                }
            }
            if (Object.keys(values).length) {
                var payload = {};
                payload[shaderUrl] = values;
                url.searchParams.set("isf-values", encodeBase64Url(JSON.stringify(payload)));
            } else {
                url.searchParams.delete("isf-values");
            }
            var link = url.toString();
            var done = function () { viewer.notify("success", "Fullscreen OBS link copied"); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(done, function () { window.prompt("Copy this link", link); });
            } else {
                window.prompt("Copy this link", link);
            }
        };
        if (shareButton) shareButton.addEventListener("click", function () { viewer.copyLink(); });
        importClose.addEventListener("click", function () { showEditorPanel(); });
        importConvert.addEventListener("click", function () {
            var result = convertToISF(importArea.value);
            if (!result.ok) {
                importStatus.textContent = result.error || "Could not convert this source.";
                importStatus.className = "isf-import-status is-error";
                return;
            }
            importStatus.textContent = "";
            importStatus.className = "isf-import-status";
            viewer.editor.setValue(result.source);
            showEditorPanel();
            viewer.editor.setStatus("Imported " + result.format + (result.warnings.length ? " — " + result.warnings.join(" ") : ""), result.warnings.length ? "" : "ok");
            viewer.applySource(false);
        });
        viewer.errorOverlay = function (title, message, rawLine, items) {
            viewer.lastErrorText = String(message || "");
            viewer.lastErrorItems = items || [];
            var html = "<strong>" + escapeHtml(title || "Shader error") + "</strong>";
            html += "<pre>" + escapeHtml(viewer.lastErrorText) + "</pre>";
            if (items && items.length > 1) {
                html += '<details class="isf-error-list"><summary>' + (items.length - 1) + " more message(s)</summary><ul>";
                for (var i = 1; i < items.length; i++) {
                    html += "<li>" + (items[i].rawLine ? '<button class="isf-error-jump" type="button" data-isf-overlay="goto" data-index="' + i + '">line ' + items[i].rawLine + "</button> " : "") + escapeHtml(items[i].message) + "</li>";
                }
                html += "</ul></details>";
            }
            html += '<div class="isf-overlay-actions">';
            html += '<a class="isf-overlay-btn" href="' + escapeHtml(viewer.url) + '" target="_blank" rel="noopener">Open source</a>';
            if (viewer.editor) {
                html += '<button class="isf-overlay-btn" type="button" data-isf-overlay="editor">' +
                    (rawLine ? "Fix at line " + rawLine : "Fix in editor") + "</button>";
            }
            html += '<button class="isf-overlay-btn" type="button" data-isf-overlay="copy">Copy error</button>';
            html += "</div>";
            viewer.showOverlay(html, true);
        };
        viewer.showShortcuts = function () {
            var rows = [
                ["Ctrl/Cmd + Enter / S", "Apply the shader"],
                ["Ctrl/Cmd + /", "Comment / uncomment"],
                ["Ctrl/Cmd + + / - / 0", "Zoom the editor"],
                ["Tab / Shift+Tab", "Indent / dedent"],
                ["Enter", "Auto-indent"],
                ["Ctrl/Cmd + B", "Show / hide the editor"],
                ["Ctrl/Cmd + Shift + B", "Fold / unfold the editor toolbar"],
                ["Ctrl/Cmd + K", "Show / hide the parameters"],
                ["Enter / Space", "Fullscreen the preview"],
                ["Drag the dividers", "Resize the editor and panel"]
            ];
            var html = "<strong>Keyboard shortcuts</strong><div class=\"isf-shortcuts\">";
            rows.forEach(function (row) {
                html += '<div class="isf-shortcut"><kbd>' + escapeHtml(row[0]) + "</kbd><span>" + escapeHtml(row[1]) + "</span></div>";
            });
            html += '</div><div class="isf-overlay-actions"><button class="isf-overlay-btn" type="button" data-isf-overlay="close">Close</button></div>';
            viewer.showOverlay(html, true);
        };
        function isNarrowLayout() {
            var width = stage.getBoundingClientRect().width || (typeof window !== "undefined" ? window.innerWidth : 1200);
            return width > 0 && width <= 600;
        }

        // The toolbar buttons are the single control surface for the drawers;
        // keep their pressed/expanded state in sync wherever a drawer changes.
        function updateDrawerButtons() {
            var rightOpen = !isDrawerClosed(rightDrawer);
            paramsButton.setAttribute("aria-pressed", rightOpen ? "true" : "false");
            paramsButton.setAttribute("aria-expanded", rightOpen ? "true" : "false");
            paramsButton.classList.toggle("is-active", rightOpen);
            if (editorButton) {
                var leftOpen = !isDrawerClosed(leftDrawer);
                editorButton.setAttribute("aria-pressed", leftOpen ? "true" : "false");
                editorButton.setAttribute("aria-expanded", leftOpen ? "true" : "false");
                editorButton.classList.toggle("is-active", leftOpen);
            }
            if (viewer.applyPUIHeader) viewer.applyPUIHeader();
        }
        viewer.updateDrawerButtons = updateDrawerButtons;

        viewer.setDrawer = function (drawer, open) {
            if (open && isNarrowLayout()) {
                // Phones: one drawer at a time, so the render stays reachable.
                var other = drawer === leftDrawer ? rightDrawer : leftDrawer;
                if (!isDrawerClosed(other)) other.classList.add("isf-drawer-closed");
            }
            drawer.classList.toggle("isf-drawer-closed", !open);
            block.classList.toggle("isf-drawer-open", !isDrawerClosed(leftDrawer) || !isDrawerClosed(rightDrawer));
            clampDrawerWidths();
            updateDrawerButtons();
        };
        viewer.isDrawerOpen = function (drawer) {
            return !isDrawerClosed(drawer);
        };
        viewer.setPanel = function (panel, open) {
            if (panel === viewer.dom.paramsPanel) viewer.setDrawer(rightDrawer, open);
            else if (panel === viewer.dom.editorPanel) {
                viewer.setDrawer(leftDrawer, open);
                if (open) showEditorPanel();
            } else {
                panel.classList.toggle("isf-hidden", !open);
            }
        };
        viewer.toggleParams = function () {
            viewer.drawerTouched = true;
            viewer.setDrawer(rightDrawer, !viewer.isDrawerOpen(rightDrawer));
        };
        viewer.toggleEditor = function () {
            if (!viewer.dom.editorPanel) return;
            viewer.drawerTouched = true;
            var open = !viewer.isDrawerOpen(leftDrawer);
            viewer.setDrawer(leftDrawer, open);
            if (open) showEditorPanel();
            if (open && viewer.editor) viewer.editor.focus();
        };
        viewer.togglePlay = function () {
            var runtime = viewer.runtime;
            if (!runtime) return;
            var playing = !runtime.playing;
            runtime.setPlaying(playing);
            viewer.dom.playButton.innerHTML = playing ? ICONS.pause : ICONS.play;
            viewer.dom.playButton.title = playing ? "Pause" : "Play";
            viewer.updateBadge(playing ? "" : "paused");
            if (viewer.applyPUIHeader) viewer.applyPUIHeader();
            if (viewer.refreshPUIFullscreenToolbar) viewer.refreshPUIFullscreenToolbar();
        };
        viewer.resetAll = function () {
            viewer.resetParameters();
            if (viewer.runtime) {
                viewer.runtime.time = 0;
                viewer.runtime.needsRender = true;
            }
            if (viewer.notify) viewer.notify("info", "Parameters reset");
        };
        viewer.toggleFullscreen = function () {
            var fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
            if (fullscreenElement === block) {
                var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
                if (exit) { var p = exit.call(document); if (p && p.catch) p.catch(function () { }); }
                return;
            }
            var request = block.requestFullscreen || block.webkitRequestFullscreen || block.msRequestFullscreen;
            if (!request) { viewer.warn("Fullscreen is not supported by this browser"); return; }
            var promise = request.call(block);
            if (promise && promise.catch) promise.catch(function () { });
        };
        viewer.syncFullscreen = function () {
            var active = isFullscreenActive();
            block.classList.toggle("isf-fullscreen", active);
            viewer.dom.fullscreenButton.setAttribute("aria-pressed", active ? "true" : "false");
            applyStageLayout();
            if (viewer.runtime) viewer.runtime.resize(true);
            if (active) viewer.setState("");
            else if (viewer.toolbarOpen) viewer.setToolbarOpen(false);
            if (viewer.applyPUIHeader) viewer.applyPUIHeader();
        };

        paramsButton.addEventListener("click", viewer.toggleParams);
        if (editorButton) editorButton.addEventListener("click", viewer.toggleEditor);
        playButton.addEventListener("click", viewer.togglePlay);
        resetButton.addEventListener("click", viewer.resetAll);
        fullscreenButton.addEventListener("click", viewer.toggleFullscreen);
        var fullscreenHandler = function () { viewer.syncFullscreen(); };
        var fullscreenKeyHandler = function (event) {
            if (!isFullscreenActive() || !viewer.puiToolbar) return;
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
            var target = event.target;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
                target.tagName === "SELECT" || target.isContentEditable)) return;
            if (event.key === "h" || event.key === "H") {
                event.preventDefault();
                viewer.setToolbarOpen(!viewer.toolbarOpen);
            } else if (event.key === "Escape" && viewer.toolbarOpen) {
                event.preventDefault();
                viewer.setToolbarOpen(false);
            }
        };
        document.addEventListener("keydown", fullscreenKeyHandler);
        viewer.listeners.push(function () { document.removeEventListener("keydown", fullscreenKeyHandler); });
        document.addEventListener("fullscreenchange", fullscreenHandler);
        document.addEventListener("webkitfullscreenchange", fullscreenHandler);
        viewer.listeners.push(function () {
            document.removeEventListener("fullscreenchange", fullscreenHandler);
            document.removeEventListener("webkitfullscreenchange", fullscreenHandler);
        });

        /* ------------------------------------------------- parameter APIs */

        viewer.defaultValues = function () {
            var defaults = {};
            if (!viewer.built) return defaults;
            for (var i = 0; i < viewer.built.inputs.length; i++) {
                var input = viewer.built.inputs[i];
                if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") continue;
                var value = clampInputValue(input, input.default);
                if (Array.isArray(value)) value = value.slice();
                defaults[input.name] = value;
            }
            return defaults;
        };
        viewer.nonDefaultValues = function () {
            var defaults = viewer.defaultValues();
            var out = {};
            for (var name in viewer.values) {
                if (!Object.prototype.hasOwnProperty.call(viewer.values, name)) continue;
                if (defaults[name] === undefined) continue;
                if (JSON.stringify(viewer.values[name]) !== JSON.stringify(defaults[name])) out[name] = viewer.values[name];
            }
            return out;
        };
        viewer.mergeValues = function () {
            var next = viewer.defaultValues();
            for (var name in next) {
                if (!Object.prototype.hasOwnProperty.call(next, name)) continue;
                if (viewer.values[name] !== undefined) next[name] = viewer.values[name];
            }
            viewer.values = next;
        };
        viewer.syncClock = function (time, playing) {
            if (!viewer.dom.timeRange || viewer._clockDragging) return;
            var shown = time % 60;
            viewer.dom.timeRange.value = shown;
            if (viewer.dom.timeLabel) viewer.dom.timeLabel.textContent = (playing ? "▶ " : "⏸ ") + shown.toFixed(1) + " s";
        };
        viewer.randomizeParameters = function () {
            if (!viewer.built) return;
            for (var i = 0; i < viewer.built.inputs.length; i++) {
                var input = viewer.built.inputs[i];
                var value = null;
                if (input.type === "float") {
                    value = input.min + Math.random() * (input.max - input.min);
                } else if (input.type === "bool") {
                    value = Math.random() < 0.5;
                } else if (input.type === "event") {
                    continue;
                } else if (input.type === "long") {
                    if (input.values && input.values.length) {
                        value = input.values[Math.floor(Math.random() * input.values.length)];
                    } else {
                        var lo = input.min != null ? input.min : 0;
                        var hi = input.max != null ? input.max : lo + 10;
                        value = Math.round(lo + Math.random() * (hi - lo));
                    }
                } else if (input.type === "color") {
                    value = [Math.random(), Math.random(), Math.random(), 1];
                } else if (input.type === "point2D") {
                    value = [
                        input.min[0] + Math.random() * (input.max[0] - input.min[0]),
                        input.min[1] + Math.random() * (input.max[1] - input.min[1])
                    ];
                } else {
                    continue;
                }
                viewer.setParameter(input.name, value);
            }
            viewer.refreshParamControls();
            viewer.notify("info", "Parameters randomized");
        };
        viewer.setParameter = function (name, value) {
            var input = viewer.inputByName && viewer.inputByName[name];
            var applied = input ? clampInputValue(input, value) : value;
            viewer.values[name] = Array.isArray(applied) ? applied.slice() : applied;
            if (viewer.runtime) {
                viewer.runtime.needsRender = true;
                if (name === "progress") {
                    var duration = Math.max(0.5, Number(config.transitionDuration) || 4);
                    viewer.runtime.transitionTime = clamp(applied, 0, 1) * duration;
                }
                BUDGET.touch(viewer);
                clearTimeout(viewer._storeTimer);
                viewer._storeTimer = setTimeout(function () { storeValues(viewer); }, 400);
            }
            return applied;
        };
        viewer.syncParameterControl = function () {
            // The transition animates the host value; PUI reads it back.
            if (viewer.pui) viewer.pui.ui.apply();
        };
        // Repaint the parameter panel from host values: PUI patches in place
        // (focus-safe); without a renderer there is nothing to patch.
        viewer.refreshParamControls = function () {
            if (viewer.pui) {
                try { viewer.pui.ui.apply(); return; } catch (error) { /* fall through */ }
            }
            viewer.rebuildParams();
        };
        viewer.getParameter = function (name) { return viewer.values[name]; };
        viewer.resetParameter = function (name) {
            var defaults = viewer.defaultValues();
            if (defaults[name] !== undefined) {
                viewer.setParameter(name, defaults[name]);
                viewer.refreshParamControls();
            }
        };
        viewer.resetParameters = function () {
            viewer.values = viewer.defaultValues();
            viewer.refreshParamControls();
            if (viewer.runtime) viewer.runtime.needsRender = true;
        };
        viewer.triggerEvent = function (name) {
            if (viewer.runtime) {
                viewer.runtime.events[name] = true;
                viewer.runtime.needsRender = true;
            }
        };
        viewer.setInputImage = function (name, file) {
            if (!file || !viewer.runtime) return;
            var url = URL.createObjectURL(file);
            var image = new Image();
            image.onload = function () {
                viewer.runtime.inputSources[name] = image;
                viewer.runtime.needsRender = true;
                URL.revokeObjectURL(url);
            };
            image.onerror = function () {
                URL.revokeObjectURL(url);
                viewer.warn("Could not load " + (file.name || "image"));
            };
            image.src = url;
        };
        viewer.enableMicrophone = function () {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                viewer.warn("Microphone capture is not available in this browser");
                return;
            }
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
                if (viewer.disposed) {
                    stream.getTracks().forEach(function (track) { track.stop(); });
                    return;
                }
                var Context = window.AudioContext || window.webkitAudioContext;
                if (!Context) {
                    stream.getTracks().forEach(function (track) { track.stop(); });
                    viewer.warn("Web Audio is not available in this browser");
                    return;
                }
                var context = new Context();
                var analyser = context.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.75;
                context.createMediaStreamSource(stream).connect(analyser);
                viewer.audioState = { context: context, stream: stream, analyser: analyser, data: new Uint8Array(analyser.frequencyBinCount) };
                viewer.rebuildParams();
                if (viewer.runtime) { viewer.runtime.needsRender = true; BUDGET.touch(viewer); }
                viewer.notify("success", "Microphone input enabled");
            }).catch(function (error) {
                viewer.warn("Microphone unavailable: " + (error && error.message ? error.message : error));
            });
        };
        viewer.disableMicrophone = function () {
            if (!viewer.audioState) return;
            try {
                viewer.audioState.stream.getTracks().forEach(function (track) { track.stop(); });
                viewer.audioState.context.close();
            } catch (err) { /* ignore */ }
            viewer.audioState = null;
            viewer.rebuildParams();
            if (viewer.runtime) viewer.runtime.needsRender = true;
            viewer.notify("info", "Synthetic audio");
        };

        /* -------------------------------------------------- params panel */

        viewer.buildViewControls = function (inputs) {
            var section = h("div", "isf-view");
            section.appendChild(h("div", "isf-view-heading", { text: "View" }));
            var targets = viewer.built ? viewer.built.passes.filter(function (pass) { return !!pass.target; }).map(function (pass) { return pass.target; }) : [];
            if (targets.length) {
                var passRow = h("label", "isf-view-row");
                passRow.appendChild(h("span", "isf-view-label", { text: "View" }));
                var passSelect = h("select", null, { "aria-label": "Preview a render pass" });
                passSelect.appendChild(h("option", null, { value: "", text: "Output" }));
                targets.forEach(function (name) { passSelect.appendChild(h("option", null, { value: name, text: name })); });
                if (viewer.runtime && viewer.runtime.previewTarget && targets.indexOf(viewer.runtime.previewTarget) !== -1) {
                    passSelect.value = viewer.runtime.previewTarget;
                }
                passSelect.addEventListener("change", function () {
                    if (viewer.runtime) {
                        viewer.runtime.previewTarget = passSelect.value || null;
                        viewer.runtime.needsRender = true;
                    }
                });
                passRow.appendChild(passSelect);
                section.appendChild(passRow);
                viewer.dom.passSelect = passSelect;
            } else {
                viewer.dom.passSelect = null;
            }
            var qualityRow = h("label", "isf-view-row");
            qualityRow.appendChild(h("span", "isf-view-label", { text: "Scale" }));
            var qualitySelect = h("select", null, { "aria-label": "Render scale" });
            [["auto", "Auto"], ["1", "1×"], ["0.5", "0.5×"], ["0.25", "0.25×"], ["2", "2×"]].forEach(function (entry) {
                qualitySelect.appendChild(h("option", null, { value: entry[0], text: entry[1] }));
            });
            qualitySelect.value = viewer.qualityChoice != null ? String(viewer.qualityChoice) : "auto";
            qualitySelect.addEventListener("change", function () {
                viewer.qualityChoice = qualitySelect.value;
                viewer.saveLayout({ quality: qualitySelect.value });
                if (viewer.runtime) {
                    viewer.runtime.qualityScale = qualitySelect.value;
                    viewer.runtime.resize(true);
                    viewer.runtime.needsRender = true;
                }
            });
            qualityRow.appendChild(qualitySelect);
            section.appendChild(qualityRow);
            var resolutionRow = h("label", "isf-view-row");
            resolutionRow.appendChild(h("span", "isf-view-label", { text: "Resolution" }));
            var resolutionSelect = h("select", null, { "aria-label": "Render resolution" });
            [["default", "Default (" + resolutionLabel(config.maxResolution) + ")"],
                ["sd", "SD 480p"], ["hd", "HD 720p"], ["fhd", "FHD 1080p"], ["native", "Native"]].forEach(function (entry) {
                resolutionSelect.appendChild(h("option", null, { value: entry[0], text: entry[1] }));
            });
            resolutionSelect.value = viewer.resolutionChoice || "default";
            resolutionSelect.addEventListener("change", function () {
                var value = resolutionSelect.value;
                viewer.resolutionChoice = value === "default" ? "" : resolutionPreset(value);
                viewer.saveLayout({ resolutionCap: viewer.resolutionChoice || null });
                if (viewer.runtime) {
                    viewer.runtime.maxResolution = viewer.resolutionChoice || config.maxResolution || "sd";
                    viewer.runtime.resize(true);
                    viewer.runtime.needsRender = true;
                }
            });
            resolutionRow.appendChild(resolutionSelect);
            section.appendChild(resolutionRow);
            var timeRow = h("label", "isf-view-row isf-time-row");
            timeRow.appendChild(h("span", "isf-view-label", { text: "Time" }));
            var timeRange = h("input", "isf-time-range", {
                type: "range", min: 0, max: 60, step: 0.05, value: 0,
                "aria-label": "Scrub time", title: "Scrub the shader clock (0–60 s)"
            });
            var timeLabel = h("span", "isf-view-value", { text: "0.0 s" });
            timeRange.addEventListener("input", function () {
                viewer._clockDragging = true;
                if (viewer.runtime) {
                    viewer.runtime.time = Number(timeRange.value);
                    viewer.runtime.needsRender = true;
                }
                timeLabel.textContent = Number(timeRange.value).toFixed(1) + " s";
            });
            timeRange.addEventListener("change", function () { viewer._clockDragging = false; });
            timeRow.appendChild(timeRange);
            timeRow.appendChild(timeLabel);
            section.appendChild(timeRow);
            viewer.dom.timeRange = timeRange;
            viewer.dom.timeLabel = timeLabel;
            var randomButton = h("button", "isf-btn", { type: "button", text: "Randomize", title: "Randomize every parameter within its declared range" });
            randomButton.addEventListener("click", function () { viewer.randomizeParameters(); });
            section.appendChild(randomButton);
            var exportButton = h("button", "isf-btn", { type: "button", text: "Export PNG", title: "Download the current frame as a PNG" });
            exportButton.addEventListener("click", function () { viewer.exportPng(); });
            section.appendChild(exportButton);
            return section;
        };

        /* -------------------------------------- PUI fullscreen toolbar */

        // In native fullscreen the header would take layout space; PUI owns a
        // non-modal top drawer instead so the shader gets the whole viewport.
        viewer.buildPUIFullscreenToolbarDocument = function () {
            var items = [];
            if (config.editor) items.push({id: "editor", label: "Source editor", call: "isf.editor"});
            if (config.controls && viewer.built && viewer.built.inputs && viewer.built.inputs.length) {
                items.push({id: "params", label: "Parameters", call: "isf.params"});
            }
            items.push({kind: "separator", label: ""});
            items.push({id: "play", label: viewer.runtime && !viewer.runtime.playing ? "Play" : "Pause", call: "isf.play"});
            items.push({id: "reset", label: "Reset parameters", call: "isf.reset"});
            items.push({kind: "separator", label: ""});
            items.push({id: "fullscreen", label: "Exit fullscreen", call: "isf.fullscreen"});
            items.push({id: "source", label: "Open source", call: "isf.source"});
            if (config.share) items.push({id: "share", label: "Copy OBS link", call: "isf.share"});
            return {
                format: "pupitre-ui",
                version: 1,
                host: "docsify-isf",
                panels: [{
                    id: "isf-toolbar",
                    title: "Controls",
                    embedded: true,
                    pages: [{id: "toolbar", title: "Controls", sections: [{
                        id: "toolbar",
                        title: "Controls",
                        blocks: [{
                            kind: "drawer",
                            id: "isf-toolbar",
                            label: "Controls",
                            trigger: "Controls",
                            side: "top",
                            modal: false,
                            height: 320,
                            open_bind: "/isf/ui/toolbarOpen",
                            blocks: [{kind: "toolbar", label: "Fullscreen controls", align: "start", items: items}]
                        }]
                    }]}]
                }]
            };
        };
        viewer.refreshPUIFullscreenToolbar = function () {
            if (!viewer.puiToolbar) return;
            try { viewer.puiToolbar.ui.render(viewer.buildPUIFullscreenToolbarDocument()); } catch (error) { /* ignore */ }
        };
        viewer.setToolbarOpen = function (open, fromPUI) {
            viewer.toolbarOpen = !!open;
            if (open) {
                if (!isDrawerClosed(leftDrawer)) viewer.setDrawer(leftDrawer, false);
                if (!isDrawerClosed(rightDrawer)) viewer.setDrawer(rightDrawer, false);
            }
            if (!fromPUI && viewer.puiToolbar) viewer.puiToolbar.ui.apply();
        };
        viewer.mountPUIStatusbar = function () {
            if (viewer.puiStatus || viewer.disposed || !puiAvailable()) return;
            var host = viewer.dom.statusPUIHost;
            if (!host) return;
            var adapter = {
                getValue: function (path) {
                    if (path === "/isf/status") return viewer.statusText || "";
                    if (path === "/isf/statusTone") {
                        var kind = String(viewer.statusKind || "");
                        if (/error/i.test(kind)) return "error";
                        if (/warn/i.test(kind)) return "warning";
                        if (/ok|success/i.test(kind)) return "success";
                        return "info";
                    }
                    return undefined;
                },
                setValue: function () { return false; },
                getPathMeta: function () { return {}; }
            };
            var ui = PupitreUI.create({
                mount: host,
                density: "compact",
                getValue: adapter.getValue,
                setValue: adapter.setValue,
                getPathMeta: adapter.getPathMeta,
                translate: function (key, fallback) { return fallback; }
            });
            var document = {
                format: "pupitre-ui", version: 1, host: "docsify-isf",
                panels: [{id: "isf-status", title: "Status", embedded: true, pages: [{id: "status", title: "Status", sections: [{
                    id: "status", title: "Status", blocks: [{
                        kind: "statusbar", label: "Status",
                        a11y: {name: "Status", live: "off"},
                        items: [{bind: "/isf/status", label: "Status", tone_bind: "/isf/statusTone"}]
                    }]
                }]}]}]
            };
            try {
                ui.render(document);
            } catch (error) {
                try { ui.destroy(); } catch (destroyError) { /* ignore */ }
                if (host.parentNode) host.parentNode.removeChild(host);
                viewer.warn("Status bar unavailable: " + (error && error.message ? error.message : error));
                return;
            }
            viewer.puiStatus = {ui: ui, host: host};
            viewer.setState(viewer.statusText, viewer.statusKind);
        };

        viewer.mountPUIFullscreenToolbar = function () {
            if (viewer.puiToolbar || viewer.disposed || !block || !puiAvailable()) return;
            var host = h("div", "isf-pui isf-pui-toolbar");
            block.appendChild(host);
            var adapter = {
                getValue: function (path) {
                    return path === "/isf/ui/toolbarOpen" ? !!viewer.toolbarOpen : undefined;
                },
                setValue: function (path, value) {
                    if (path !== "/isf/ui/toolbarOpen") return false;
                    viewer.setToolbarOpen(!!value, true);
                    return true;
                },
                callAction: function (name) {
                    // Opening a side drawer closes the top toolbar so the drawer
                    // header/close is never covered by the top panel.
                    if (name === "isf.editor") { viewer.toggleEditor(); viewer.setToolbarOpen(false); return true; }
                    if (name === "isf.params") { viewer.toggleParams(); viewer.setToolbarOpen(false); return true; }
                    if (name === "isf.play") { viewer.togglePlay(); return true; }
                    if (name === "isf.reset") { viewer.resetAll(); return true; }
                    if (name === "isf.fullscreen") { viewer.toggleFullscreen(); return true; }
                    if (name === "isf.source") {
                        try { window.open(viewer.url, "_blank", "noopener"); } catch (error) { /* ignore */ }
                        return true;
                    }
                    if (name === "isf.share") { viewer.copyLink(); return true; }
                    return false;
                },
                getPathMeta: function () { return {}; },
                announce: function (level, message) {
                    if (level === "error") viewer.warn(message);
                    else viewer.setState(message, level === "success" ? "ok" : "");
                }
            };
            var ui = PupitreUI.create({
                mount: host,
                density: "compact",
                getValue: adapter.getValue,
                setValue: adapter.setValue,
                callAction: adapter.callAction,
                getPathMeta: adapter.getPathMeta,
                announce: adapter.announce,
                translate: function (key, fallback) { return fallback; }
            });
            try {
                ui.render(viewer.buildPUIFullscreenToolbarDocument());
            } catch (error) {
                try { ui.destroy(); } catch (destroyError) { /* ignore */ }
                if (host.parentNode) host.parentNode.removeChild(host);
                viewer.warn("Fullscreen toolbar unavailable: " + (error && error.message ? error.message : error));
                return;
            }
            viewer.puiToolbar = {ui: ui, host: host};
            block.classList.add("isf-has-pui-toolbar");
        };

        /* --------------------------------------- PUI header toolbar */

        viewer.buildPUIHeaderDocument = function () {
            var items = [{
                kind: "link",
                id: "title",
                href: viewer.url || "#",
                target: "_blank",
                rel: "noopener",
                label: String(viewer.title || "ISF viewer"),
                title: "Open " + String(viewer.title || "shader") + " source",
                badge: "ISF",
                collapse: false
            }, {kind: "spacer"}, {
                kind: "readout", id: "stats", bind: "/isf/ui/badge", hide_empty: true,
                a11y: {name: "Render statistics"},
                collapse: false
            }, {kind: "separator"}];
            if (config.editor) {
                items.push({
                    id: "editor", label: "Source editor", icon: "editor", icon_only: true,
                    title: "Source editor", call: "isf.editor", pressed_bind: "/isf/ui/editorOpen",
                    aria_controls: uid + "-editor", priority: 100
                });
            }
            if (config.controls && viewer.built && viewer.built.inputs && viewer.built.inputs.length) {
                items.push({
                    id: "params", label: "Parameters", icon: "params", icon_only: true,
                    title: "Parameters", call: "isf.params", pressed_bind: "/isf/ui/paramsOpen",
                    badge_bind: "/isf/ui/inputCount", aria_controls: uid + "-params", priority: 100
                });
            }
            items.push({kind: "separator"});
            items.push({
                id: "play", label_bind: "/isf/ui/playLabel", icon_bind: "/isf/ui/playIcon",
                title_bind: "/isf/ui/playLabel", icon_only: true, call: "isf.play", priority: 80
            });
            items.push({
                id: "fullscreen", label: "Fullscreen", icon: "fullscreen", icon_only: true,
                title: "Fullscreen", call: "isf.fullscreen", pressed_bind: "/isf/ui/fullscreen", priority: 70
            });
            if (config.share !== false) {
                items.push({
                    id: "share", label: "Copy a fullscreen link for OBS (current parameters)",
                    icon: "share", icon_only: true,
                    title: "Copy a fullscreen link for OBS (current parameters)", call: "isf.share", priority: 20
                });
            }
            items.push({
                id: "reset", label: "Reset parameters and time", icon: "reset", icon_only: true,
                title: "Reset parameters and time", call: "isf.reset", priority: 30
            });
            if (config.showSource) {
                items.push({
                    kind: "link", id: "source", href: viewer.url || "#", target: "_blank", rel: "noopener",
                    label: "Open source file", icon: "source", icon_only: true, title: "Open source file", priority: 20
                });
            }
            return {
                format: "pupitre-ui", version: 1, host: "docsify-isf",
                panels: [{id: "isf-header", title: String(viewer.title || "ISF viewer"), embedded: true, pages: [{id: "header", title: "Header", sections: [{
                    id: "header", title: "Header", blocks: [{
                        kind: "toolbar", id: "isf-header", label: "ISF viewer controls", align: "start",
                        overflow: "auto", overflow_label: "More", items: items
                    }]
                }]}]}]
            };
        };
        viewer.applyPUIHeader = function () {
            if (!viewer.puiHeader) return;
            try { viewer.puiHeader.ui.apply(); } catch (error) { /* ignore */ }
        };
        viewer.refreshPUIHeader = function () {
            if (!viewer.puiHeader) return;
            try { viewer.puiHeader.ui.render(viewer.buildPUIHeaderDocument()); } catch (error) { /* ignore */ }
        };
        viewer.mountPUIHeader = function () {
            if (viewer.puiHeader || viewer.disposed || !puiAvailable()) return;
            var host = viewer.dom.headerPUIHost;
            if (!host) return;
            var adapter = {
                getValue: function (path) {
                    if (path === "/isf/ui/editorOpen") return viewer.isDrawerOpen(leftDrawer);
                    if (path === "/isf/ui/paramsOpen") return viewer.isDrawerOpen(rightDrawer);
                    if (path === "/isf/ui/fullscreen") return isFullscreenActive();
                    if (path === "/isf/ui/inputCount") return viewer.built ? String(viewer.built.inputs.length) : "";
                    if (path === "/isf/ui/playLabel") return viewer.runtime && !viewer.runtime.playing ? "Play" : "Pause";
                    if (path === "/isf/ui/playIcon") return viewer.runtime && !viewer.runtime.playing ? "play" : "pause";
                    if (path === "/isf/ui/badge") return viewer.badgeText || "";
                    return undefined;
                },
                setValue: function () { return false; },
                callAction: function (name) {
                    if (name === "isf.editor") { viewer.toggleEditor(); return true; }
                    if (name === "isf.params") { viewer.toggleParams(); return true; }
                    if (name === "isf.play") { viewer.togglePlay(); return true; }
                    if (name === "isf.reset") { viewer.resetAll(); return true; }
                    if (name === "isf.fullscreen") { viewer.toggleFullscreen(); return true; }
                    if (name === "isf.share") { viewer.copyLink(); return true; }
                    return false;
                },
                getPathMeta: function () { return {}; },
                announce: function (level, message) {
                    if (level === "error") viewer.warn(message);
                    else viewer.setState(message, level === "success" ? "ok" : "");
                }
            };
            var ui = PupitreUI.create({
                mount: host,
                density: "compact",
                icons: HEADER_ICONS,
                getValue: adapter.getValue,
                setValue: adapter.setValue,
                callAction: adapter.callAction,
                getPathMeta: adapter.getPathMeta,
                announce: adapter.announce,
                translate: function (key, fallback) { return fallback; }
            });
            try {
                ui.render(viewer.buildPUIHeaderDocument());
            } catch (error) {
                try { ui.destroy(); } catch (destroyError) { /* ignore */ }
                viewer.warn("PUI header unavailable: " + (error && error.message ? error.message : error));
                return;
            }
            viewer.puiHeader = {ui: ui, host: host};
            host.classList.remove("isf-hidden");
            if (viewer.dom.title && viewer.dom.title.parentNode) viewer.dom.title.parentNode.removeChild(viewer.dom.title);
            if (viewer.dom.badge && viewer.dom.badge.parentNode) viewer.dom.badge.parentNode.removeChild(viewer.dom.badge);
            if (viewer.dom.actions && viewer.dom.actions.parentNode) viewer.dom.actions.parentNode.removeChild(viewer.dom.actions);
            viewer.applyPUIHeader();
        };

        viewer.updateParamsIntro = function () {
            var meta = viewer.parse && viewer.parse.metadata ? viewer.parse.metadata : {};
            var desc = String(meta.DESCRIPTION || "").trim();
            var credit = String(meta.CREDIT || "").trim();
            var categories = Array.isArray(meta.CATEGORIES) ? meta.CATEGORIES : [];
            paramsIntro.innerHTML = "";
            if (!desc && !credit && !categories.length) {
                paramsIntro.classList.add("isf-hidden");
                return;
            }
            paramsIntro.classList.remove("isf-hidden");
            if (desc) paramsIntro.appendChild(h("p", "isf-panel-intro-desc", { text: desc }));
            var metaRow = h("div", "isf-panel-intro-meta");
            if (credit) metaRow.appendChild(h("span", "isf-panel-credit", { text: credit }));
            categories.forEach(function (category) {
                metaRow.appendChild(h("span", "isf-panel-tag", { text: String(category) }));
            });
            if (metaRow.childNodes.length) paramsIntro.appendChild(metaRow);
        };

        viewer.rebuildParams = function () {
            viewer.updateParamsIntro();
            var inputs = viewer.built ? viewer.built.inputs : [];
            viewer.inputByName = {};
            for (var ii = 0; ii < inputs.length; ii++) viewer.inputByName[inputs[ii].name] = inputs[ii];
            paramsList.innerHTML = "";
            var controlsHost = h("div", "isf-params-controls");
            paramsList.appendChild(controlsHost);
            buildControls(controlsHost, inputs, viewer);
            if (puiAvailable()) {
                viewer.mountPUIFullscreenToolbar();
                viewer.mountPUIStatusbar();
                viewer.mountPUIHeader();
            }
            // PUI renders the view row as an `isf.view` host block inside the
            // panel; while the assets load (or if they fail) it stays a sibling
            // so pass/quality/time remain usable.
            if (!viewer.pui) paramsList.insertBefore(viewer.buildViewControls(inputs), controlsHost);
            viewer.dom.paramsCount.textContent = inputs.length ? String(inputs.length) : "";
            if (viewer.puiHeader) viewer.refreshPUIHeader();
            var open;
            if (!config.controls) open = false;
            else if (config.params === "open") open = true;
            else if (config.params === "closed") open = false;
            else open = inputs.length > 0 && inputs.length <= config.paramsOpenLimit;
            if (viewer.urlFlags && viewer.urlFlags.controls) open = true;
            if (!viewer.drawerTouched) viewer.setDrawer(rightDrawer, open);
            var hasControls = config.controls && inputs.length > 0;
            paramsButton.classList.toggle("isf-hidden", !hasControls);
        };

        /* ----------------------------------------------------- loading */

        viewer.load = function () {
            if (viewer.state === "loading" || viewer.state === "live") return;
            viewer.state = "loading";
            viewer.showOverlay('<div class="isf-spinner"></div><strong>Loading shader…</strong><code>' + escapeHtml(basename(viewer.url)) + "</code>", true);
            viewer.setState("Loading " + viewer.url);
            var candidates = viewer.candidates.slice();
            loadShaderText(candidates).then(function (result) {
                if (viewer.disposed) return;
                viewer.url = result.url;
                viewer.rawSource = result.text;
                if (viewer.dom.title) viewer.dom.title.href = result.url;
                if (viewer.dom.sourceButton) viewer.dom.sourceButton.href = result.url;
                var parsed = parseISF(result.text);
                if (!parsed.valid) {
                    var error = new Error(parsed.error && parsed.error.message ? parsed.error.message : "Invalid ISF header");
                    error.isfLine = parsed.error && (parsed.error.fileLine || parsed.error.line);
                    throw error;
                }
                viewer.parse = parsed;
                viewer.originalSource = result.text;
                var vertexUrl = null;
                var vertexPromise = Promise.resolve(null);
                if (config.vertexShader !== false) {
                    vertexUrl = result.url.replace(/\.fs(\?|#|$)/i, ".vs$1");
                    if (vertexUrl !== result.url) {
                        vertexPromise = fetchText(vertexUrl).catch(function () { return null; });
                    }
                }
                var includeMap = {};
                var includePromise = loadIncludes(collectIncludes(result.text), result.url, config, includeMap, {});
                return Promise.all([vertexPromise, includePromise]).then(function (values) {
                    viewer.vertexSource = values[0];
                    viewer.includes = includeMap;
                    if (viewer.editor) viewer.editor.setVertex(values[0]);
                    if (viewer.vertexSource && vertexUrl) {
                        return loadIncludes(collectIncludes(viewer.vertexSource), vertexUrl, config, includeMap, {});
                    }
                    return null;
                });
            }).then(function () {
                if (viewer.disposed) return;
                var built;
                try {
                    built = buildShader(viewer.parse, { vertexShader: viewer.vertexSource, imports: config.imports, includes: viewer.includes });
                } catch (buildError) {
                    var error2 = new Error(buildError && buildError.message ? buildError.message : "Unable to build shader");
                    error2.isfLine = buildError && buildError.line;
                    throw error2;
                }
                viewer.built = built;
                viewer.transition = isTransitionShader(built.inputs);
                viewer.source = viewer.rawSource;
                viewer.values = viewer.defaultValues();
                var restoreInput = null;
                var stored = loadStoredValues(viewer.url);
                if (stored) {
                    for (var storedName in stored) {
                        restoreInput = null;
                        for (var si = 0; si < built.inputs.length; si++) if (built.inputs[si].name === storedName) restoreInput = built.inputs[si];
                        if (restoreInput) viewer.values[storedName] = clampInputValue(restoreInput, stored[storedName]);
                    }
                }
                if (viewer.urlFlags && viewer.urlFlags.values && viewer.urlFlags.values[viewer.url]) {
                    var flagged = viewer.urlFlags.values[viewer.url];
                    for (var flagName in flagged) {
                        restoreInput = null;
                        for (var fi = 0; fi < built.inputs.length; fi++) if (built.inputs[fi].name === flagName) restoreInput = built.inputs[fi];
                        if (restoreInput) viewer.values[flagName] = clampInputValue(restoreInput, flagged[flagName]);
                    }
                }
                if (built.unresolved && built.unresolved.length) {
                    var first = built.unresolved[0];
                    var unresolvedError = new Error(first.name + "(" + first.image + ") at line " + first.line + ": " + first.reason);
                    unresolvedError.isfLine = first.line;
                    throw unresolvedError;
                }
                viewer.rebuildParams();
                if (viewer.editor) {
                    viewer.editor.setValue(viewer.rawSource);
                    viewer.editor.setStatus("Loaded · " + built.inputs.length + " input(s)", "ok");
                }
                viewer.initRuntime();
                if (config.editorOpen || (viewer.urlFlags && viewer.urlFlags.editor)) viewer.toggleEditor();
            }).catch(function (error) {
                if (viewer.disposed) return;
                viewer.state = "error";
                var message = error && error.message ? error.message : String(error);
                viewer.setState("Error: " + message, "error");
                viewer.errorOverlay("Shader could not be loaded", message, error && error.isfLine);
                if (viewer.editor && error && error.isfLine) {
                    viewer.editor.setValue(viewer.rawSource || viewer.source);
                    viewer.editor.setStatus(message, "error");
                    viewer.editor.markError(error.isfLine);
                }
                debugLog(config, "load failed", error);
            });
        };

        /* ------------------------------------------------------ runtime */

        viewer.initRuntime = function () {
            if (viewer.disposed) return;
            if (!BUDGET.acquire(viewer)) {
                viewer.state = "released";
                viewer.updateBadge("");
                viewer.showOverlay("<strong>Waiting for a GPU context</strong>Too many viewers are active at once. This one starts automatically as soon as another viewer releases its context.", true);
                return;
            }
            if (!viewer.gl) {
                canvas = h("canvas", "isf-canvas");
                stage.replaceChild(canvas, viewer.dom.canvas);
                viewer.dom.canvas = canvas;
            }
            viewer.gl = createGL(viewer.dom.canvas);
            if (!viewer.gl) {
                viewer.state = "error";
                viewer.setState("WebGL is not available in this browser", "error");
                viewer.showOverlay("<strong>WebGL is not available</strong>This browser or GPU cannot render ISF shaders.", true);
                return;
            }
            viewer.runtime = new ISFRuntimeCore(viewer, viewer.gl);
            var compileError = viewer.runtime.compile(viewer.built);
            if (compileError) {
                viewer.runtimeError(compileError, viewer.built);
                return;
            }
            viewer.runtime.qualityScale = viewer.qualityChoice;
            viewer.runtime.visible = viewer.visible;
            viewer.runtime.start();
            viewer.state = "live";
            viewer.showOverlay("", false);
            var warnings = (viewer.built.warnings || []).slice();
            if (!viewer.runtime.floatSupported && viewer.built.passes.some(function (pass) { return pass.float; })) {
                warnings.push({ message: "Float buffers are not supported here; byte buffers are used instead" });
            }
            if (warnings.length) viewer.setState(warnings.map(function (w) { return w.message + (w.line ? " (line " + w.line + ")" : ""); }).join("\n"), "warn");
            else if (viewer.runtime.compatibilityLabel) viewer.setState(viewer.runtime.compatibilityLabel, "");
            else viewer.setState("");
            viewer.updateBadge(viewer.runtime.playing ? "" : "paused");
            viewer.dom.playButton.innerHTML = viewer.runtime.playing ? ICONS.pause : ICONS.play;
            viewer.dom.playButton.title = viewer.runtime.playing ? "Pause" : "Play";
            if (viewer.editor && viewer.built.warnings && viewer.built.warnings.length) {
                viewer.editor.setStatus(viewer.built.warnings.length + " warning(s) — see status", "");
            }
            if (config.imports && viewer.built.imports && viewer.built.imports.length) {
                for (var m = 0; m < viewer.built.imports.length; m++) {
                    (function (spec) {
                        try {
                            var imported = new Image();
                            imported.crossOrigin = "anonymous";
                            imported.onload = function () {
                                if (viewer.runtime) { viewer.runtime.inputSources[spec.name] = imported; viewer.runtime.needsRender = true; }
                            };
                            imported.onerror = function () { viewer.warn("Could not load imported image " + spec.path); };
                            imported.src = new URL(spec.path, viewer.url).toString();
                        } catch (err) { /* ignore */ }
                    })(viewer.built.imports[m]);
                }
            }
        };

        viewer.runtimeError = function (error, built) {
            built = built || viewer.built;
            var message = typeof error === "string" ? error : (error && error.log) || (error && error.message) || "Shader error";
            var rawLine = null;
            var firstMessage = null;
            if (error && error.messages && error.messages.length) {
                var isVertexError = error.label === "vertex shader";
                var lineMap = built ? (isVertexError ? built.vertexLineMap : built.lineMap) : null;
                var items = [];
                for (var mi = 0; mi < error.messages.length; mi++) {
                    var msg = error.messages[mi];
                    var mapped = msg.line && lineMap ? lineMap(msg.line) : null;
                    items.push({
                        message: msg.severity + " at line " + msg.line + ": " + msg.message,
                        rawLine: mapped,
                        buffer: isVertexError ? "vertex" : null
                    });
                }
                firstMessage = error.messages[0];
                rawLine = items[0].rawLine;
                message = (error.context ? error.context + " — " : "") + (error.label ? error.label + ": " : "") + items[0].message;
                if (rawLine) message += " (file line " + rawLine + ")";
                viewer.lastErrorItems = items;
            }
            viewer.state = "error";
            viewer.setState(message, "error");
            viewer.errorOverlay("Shader error", message, rawLine, viewer.lastErrorItems);
            if (viewer.editor) {
                viewer.editor.setStatus(message, "error");
                viewer.editor.markError(rawLine || null, error && error.label === "vertex shader" ? "vertex" : null);
            }
            debugLog(config, "compile failed", error);
        };

        /* --------------------------------------------------- source edit */

        viewer.onEditorInput = function () {
            if (!config.editorLive || !viewer.editor) return;
            clearTimeout(viewer._liveTimer);
            viewer._liveTimer = setTimeout(function () { viewer.applySource(true); }, Math.max(120, Number(config.editorDebounce) || 600));
        };

        viewer.applySource = function (live) {
            if (!viewer.editor || !viewer.runtime) return false;
            var text = viewer.editor.getFragment();
            var parsed = parseISF(text);
            if (!parsed.valid) {
                var headerMessage = parsed.error && parsed.error.message ? parsed.error.message : "Invalid ISF header";
                viewer.editor.setStatus(headerMessage, "error");
                viewer.editor.markError(parsed.error && (parsed.error.fileLine || parsed.error.line));
                if (!live) viewer.setState(headerMessage, "error");
                return false;
            }
            var built;
            try {
                built = buildShader(parsed, { vertexShader: viewer.editor.getVertex(), imports: config.imports, includes: viewer.includes });
            } catch (buildError) {
                viewer.editor.setStatus(buildError.message, "error");
                return false;
            }
            if (built.unresolved && built.unresolved.length) {
                var first = built.unresolved[0];
                var message = first.name + "(" + first.image + ") at line " + first.line + ": " + first.reason;
                viewer.editor.setStatus(message, "error");
                viewer.editor.markError(first.line);
                if (!live) viewer.setState(message, "error");
                return false;
            }
            var compileStarted = performance.now();
            var compileError = viewer.runtime.compile(built);
            if (compileError) {
                viewer.runtimeError(compileError, built);
                return false;
            }
            var compileMs = Math.max(1, Math.round(performance.now() - compileStarted));
            viewer.vertexSource = viewer.editor.getVertex();
            viewer.parse = parsed;
            viewer.built = built;
            viewer.transition = isTransitionShader(built.inputs);
            viewer.mergeValues();
            viewer.rebuildParams();
            if (!viewer.runtime.running) viewer.runtime.start();
            viewer.editor.markError(0);
            viewer.editor.setStatus("Applied · " + built.inputs.length + " input(s) · " + compileMs + " ms", "ok");
            viewer.runtime.visible = viewer.visible;
            viewer.runtime.needsRender = true;
            viewer.showOverlay("", false);
            viewer.state = "live";
            if (built.warnings && built.warnings.length) {
                viewer.setState(built.warnings.map(function (w) { return w.message + (w.line ? " (line " + w.line + ")" : ""); }).join("\n"), "warn");
            } else if (viewer.runtime && viewer.runtime.compatibilityLabel) {
                viewer.setState(viewer.runtime.compatibilityLabel, "");
            } else {
                viewer.setState("");
            }
            return true;
        };

        viewer.revertSource = function () {
            if (!viewer.editor || !viewer.originalSource) return;
            viewer.editor.setValue(viewer.originalSource);
            viewer.editor.setVertex(viewer.vertexSource);
            viewer.editor.setStatus("Reverted — press Apply", "");
            viewer.applySource(false);
        };

        /* -------------------------------------------------- context budget */

        viewer.releaseContext = function () {
            if (viewer.runtime) { viewer.runtime.dispose(); viewer.runtime = null; }
            viewer.gl = null;
            BUDGET.release(viewer);
            if (viewer.state === "live") {
                viewer.state = "released";
                viewer.updateBadge("");
                viewer.showOverlay("<strong>GPU context released</strong>Too many viewers are active at once. Scroll back or click to render this shader again.", true);
            }
        };

        viewer.resume = function () {
            if (viewer.disposed) return;
            if (viewer.state === "idle") viewer.load();
            else if (viewer.state === "released") viewer.initRuntime();
        };

        viewer.handleContextLost = function () {
            viewer.runtime = null;
            viewer.gl = null;
            BUDGET.release(viewer);
            viewer.state = "released";
            viewer.updateBadge("");
            viewer.showOverlay("<strong>WebGL context lost</strong>Click to render again.", true);
        };

        /* --------------------------------------------------- visibility */

        var observer = null;
        if (typeof IntersectionObserver !== "undefined") {
            observer = new IntersectionObserver(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    viewer.visible = !!entry.isIntersecting;
                    if (viewer.runtime) viewer.runtime.visible = viewer.visible;
                    if (viewer.visible) {
                        BUDGET.touch(viewer);
                        if (config.lazy === "visible") viewer.resume();
                    }
                }
            }, { rootMargin: "240px" });
            observer.observe(block);
        } else {
            viewer.visible = true;
        }
        viewer.observer = observer;

        if (config.lazy === "click") {
            var clickHandler = function () {
                block.removeEventListener("click", clickHandler);
                viewer.showOverlay("", false);
                viewer.resume();
            };
            block.addEventListener("click", clickHandler);
            viewer.listeners.push(function () { block.removeEventListener("click", clickHandler); });
        } else if (config.lazy === "none") {
            viewer.visible = true;
            setTimeout(function () { viewer.resume(); }, 0);
        }

        /* -------------------------------------------------------- dispose */

        viewer.dispose = function () {
            viewer.disposed = true;
            if (viewer.pui) {
                try { viewer.pui.ui.destroy(); } catch (error) { /* ignore */ }
                viewer.pui = null;
            }
            if (viewer.puiToolbar) {
                try { viewer.puiToolbar.ui.destroy(); } catch (error) { /* ignore */ }
                viewer.puiToolbar = null;
                block.classList.remove("isf-has-pui-toolbar");
            }
            if (viewer.puiStatus) {
                try { viewer.puiStatus.ui.destroy(); } catch (error) { /* ignore */ }
                viewer.puiStatus = null;
            }
            if (viewer.puiHeader) {
                try { viewer.puiHeader.ui.destroy(); } catch (error) { /* ignore */ }
                viewer.puiHeader = null;
            }
            clearTimeout(viewer._liveTimer);
            clearTimeout(viewer._storeTimer);
            if (viewer.audioState) {
                try {
                    viewer.audioState.stream.getTracks().forEach(function (track) { track.stop(); });
                    viewer.audioState.context.close();
                } catch (err) { /* ignore */ }
                viewer.audioState = null;
            }
            var viewerIndex = VIEWERS.indexOf(viewer);
            if (viewerIndex !== -1) VIEWERS.splice(viewerIndex, 1);
            if (observer) observer.disconnect();
            if (viewer.runtime) { viewer.runtime.dispose(); viewer.runtime = null; }
            BUDGET.release(viewer);
            for (var i = 0; i < viewer.listeners.length; i++) {
                try { viewer.listeners[i](); } catch (err) { /* ignore */ }
            }
            viewer.listeners = [];
        };

        // Keep the overlay in sync when a released/click-lazy viewer is clicked.
        overlay.addEventListener("click", function (event) {
            var action = event.target && event.target.closest ? event.target.closest("[data-isf-overlay]") : null;
            if (action) {
                var kind = action.getAttribute("data-isf-overlay");
                if (kind === "editor") {
                    viewer.showOverlay("", false);
                    viewer.toggleEditor();
                } else if (kind === "goto") {
                    var item = viewer.lastErrorItems && viewer.lastErrorItems[Number(action.getAttribute("data-index"))];
                    if (item) {
                        viewer.showOverlay("", false);
                        showEditorPanel();
                        viewer.setDrawer(leftDrawer, true);
                        if (viewer.editor) viewer.editor.markError(item.rawLine, item.buffer);
                    }
                } else if (kind === "close") {
                    viewer.showOverlay("", false);
                } else if (kind === "copy") {
                    var text = viewer.lastErrorText || "";
                    var markCopied = function () { action.textContent = "Copied"; };
                    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(markCopied, markCopied);
                    else markCopied();
                }
                return;
            }
            var button = event.target && event.target.closest ? event.target.closest(".isf-overlay-btn") : null;
            if (button && button.getAttribute("href")) return; // real links keep working
            if (viewer.state === "released") viewer.initRuntime();
            else if (viewer.state === "idle" && config.lazy !== "visible") viewer.load();
        });

        if (config.lazy === "click") {
            viewer.showOverlay("<strong>" + escapeHtml(viewer.title) + "</strong>Click to render this ISF shader.", true);
        } else {
            // Offscreen viewers are lazy; they show a loading message only once
            // the intersection observer actually starts them.
            viewer.showOverlay("", false);
        }

        return viewer;
    }

    /* ==================================================================
     * Docsify plugin
     * ================================================================== */

    function processContainer(container, config, routePath, instances) {
        if (!container) return;
        ensureStyle();
        BUDGET.setMax(config.maxContexts);
        var anchors = container.querySelectorAll("a[href]");
        for (var i = 0; i < anchors.length; i++) {
            var anchor = anchors[i];
            if (anchor.dataset && anchor.dataset.isfProcessed === "true") continue;
            if (anchor.closest && anchor.closest(".isf-block")) continue;
            var href = anchor.getAttribute("href");
            if (!isShaderHref(href, config)) continue;
            anchor.dataset.isfProcessed = "true";
            var title = trim(anchor.textContent) || basename(href);
            var viewer = createViewer(anchor, title, config, routePath);
            instances.push(viewer);
            if (config.mode === "augment") {
                anchor.setAttribute("target", "_blank");
                anchor.setAttribute("rel", "noopener");
                if (anchor.parentNode) anchor.parentNode.insertBefore(viewer.dom.block, anchor.nextSibling);
            } else if (anchor.parentNode) {
                anchor.parentNode.replaceChild(viewer.dom.block, anchor);
            }
        }
    }

    /**
     * `isf-shader=<url>&isf-fullscreen=1`: the share button's self-contained
     * viewer. It mounts one bare viewer (no header, drawers or status) that
     * fills the viewport, which is what an OBS browser source captures; the
     * `isf-values` flag carries the parameters, so nothing depends on the
     * page's links or on local storage.
     */
    function mountFullscreenViewer(flags, config, vm, instances) {
        ensureStyle();
        var routePath = currentRoutePath(vm);
        var bareConfig = assign({}, config, {
            mode: "replace", lazy: "none", params: "closed",
            editor: true, editorOpen: false, controls: true,
            share: true, showStats: true, showSource: true,
            autoplay: true, forcePlay: true, loopTransition: true,
            persistLayout: false, persistValues: false, resolution: 1, maxPixelRatio: 1,
            aspectRatio: null, height: "100%", width: "100%", bare: true
        });
        try {
            document.documentElement.style.overflow = "hidden";
            document.body.style.margin = "0";
            var content = document.querySelector(".content") || document.getElementById("main");
            if (content) content.style.display = "none";
            var sidebar = document.querySelector(".sidebar");
            if (sidebar) sidebar.style.display = "none";
            var nav = document.querySelector(".app-nav");
            if (nav) nav.style.display = "none";
        } catch (err) { /* ignore */ }
        var holder = document.createElement("div");
        holder.className = "isf-fullscreen-host";
        holder.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:#000";
        var anchor = document.createElement("a");
        anchor.setAttribute("href", flags.shader);
        holder.appendChild(anchor);
        document.body.appendChild(holder);
        var viewer = createViewer(anchor, basename(flags.shader), bareConfig, routePath);
        holder.replaceChild(viewer.dom.block, anchor);
        instances.push(viewer);
    }

    function cleanupAll(instances) {
        for (var i = 0; i < instances.length; i++) {
            try { instances[i].dispose(); } catch (err) { /* ignore */ }
        }
        destroyToastUI();
    }

    function plugin(hook, vm) {
        var instances = [];
        hook.beforeEach(function (content) {
            cleanupAll(instances);
            instances.length = 0;
            return content;
        });
        hook.doneEach(function () {
            var config = getConfig();
            if (!config.enabled) return;
            var flags = readUrlFlags();
            if (flags.fullscreen && flags.shader) {
                mountFullscreenViewer(flags, config, vm, instances);
                return;
            }
            var container = document.querySelector(".content") || document.getElementById("main") || document.body;
            var routePath = currentRoutePath(vm);
            processContainer(container, config, routePath, instances);
        });
    }

    /* ==================================================================
     * Headless frame rendering
     *
     * DocsifyISF.renderFrame() mounts a viewer off-screen, freezes the
     * shader at a deterministic time/size/inputs and returns a PNG data URL;
     * DocsifyISF.compareFrames() diffs two PNG data URLs with the same
     * metric the project's cover comparison uses (mean absolute per-channel
     * error). Both are browser-only and dependency-free.
     * ================================================================== */

    function frameImageFrom(src) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            image.onload = function () { resolve(image); };
            image.onerror = function () { reject(new Error("Could not decode frame image")); };
            image.src = src;
        });
    }

    function firstImageInput(viewer) {
        var inputs = (viewer.built && viewer.built.inputs) || [];
        for (var i = 0; i < inputs.length; i++) {
            if (inputs[i].type === "image") return inputs[i].name;
        }
        return null;
    }

    // Deterministic frame at options.time: the runtime is paused and the
    // shader time, generators and buffer history are stepped from zero.
    function snapshotFrame(viewer, options, width, height) {
        var runtime = viewer.runtime;
        if (!runtime) throw new Error("renderFrame: the shader is not running");
        runtime.setPlaying(false);
        runtime.qualityScale = 1;
        runtime.fixedDate = options.date === "now" ? null : new Date(options.date || "2020-01-01T00:00:00Z");
        runtime.mouse = [0, 0, 0, 0];
        runtime.events = {};
        runtime.frameIndex = 0;
        runtime.resize(true);
        if (runtime.destWidth !== width || runtime.destHeight !== height) {
            // The stage is sized explicitly, so this only guards against odd
            // viewport scaling (e.g. a zoomed page).
            runtime.destWidth = width;
            runtime.destHeight = height;
            runtime.gl.canvas.width = width;
            runtime.gl.canvas.height = height;
        }
        var time = options.time === undefined || options.time === null ? 1.5 : Number(options.time);
        if (!isFinite(time)) time = 1.5;
        var steps = Math.max(1, Math.round(numberOr(options.steps, 1)));
        runtime.resetGenerators();
        if (steps === 1) {
            runtime.time = time;
            runtime.updateGenerators(time, time);
            runtime.draw(0);
        } else {
            for (var step = 1; step <= steps; step++) {
                runtime.time = time * step / steps;
                runtime.draw(time / steps);
            }
        }
        // The frame is already drawn (`steps` frames end on FRAMEINDEX
        // steps-1, the OBS frozen-capture convention); snapshot() only reads
        // the buffer and flips it to screen orientation.
        var dataUrl = runtime.snapshot({ render: false });
        if (!dataUrl) throw new Error("renderFrame: the shader did not produce a frame");
        // ISF output is straight RGBA; OBS composites it over the source
        // behind (black for a generator). Flatten by default so headless
        // frames match the cover captures, with `background: null` to keep
        // the alpha channel.
        var background = options.background === undefined ? "#000" : options.background;
        if (background) {
            // drawImage reads the canvas in display orientation, the same
            // orientation as snapshot(); no extra flip here.
            var flat = document.createElement("canvas");
            flat.width = width;
            flat.height = height;
            var context = flat.getContext("2d");
            context.fillStyle = background;
            context.fillRect(0, 0, flat.width, flat.height);
            context.drawImage(runtime.gl.canvas, 0, 0, width, height);
            dataUrl = flat.toDataURL("image/png");
        }
        return {
            dataUrl: dataUrl,
            width: runtime.destWidth,
            height: runtime.destHeight,
            time: runtime.time,
            steps: steps,
            background: background || null,
            mode: runtime.compatibilityLabel || (runtime.isGL2 ? "ES 3.00" : "ES 1.00"),
            warnings: (viewer.built && viewer.built.warnings) || []
        };
    }

    function renderFrame(options) {
        options = options || {};
        if (typeof document === "undefined") {
            return Promise.reject(new Error("renderFrame needs a document (run it in a browser)"));
        }
        if (!options.url) {
            return Promise.reject(new Error("renderFrame: options.url is required"));
        }
        var width = clamp(Math.round(numberOr(options.width, 320)), 1, 4096);
        var height = clamp(Math.round(numberOr(options.height, 180)), 1, 4096);
        var timeout = Math.max(1000, numberOr(options.timeout, 30000));
        var includePaths = options.includePaths || (getConfig() && getConfig().includePaths) || [];
        var config = assign({}, DEFAULTS, options.config, {
            enabled: true,
            mode: "replace",
            lazy: "none",
            width: width + "px",
            height: height + "px",
            resolution: 1,
            maxPixelRatio: 1,
            controls: false,
            params: "closed",
            editor: false,
            editorOpen: false,
            showStats: false,
            showSource: false,
            share: false,
            autoplay: false,
            persistLayout: false,
            persistValues: false,
            loopTransition: false,
            includePaths: includePaths
        });

        var holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-100000px;top:0;width:" + width + "px;height:" + height +
            "px;overflow:hidden;pointer-events:none;contain:strict";
        var anchor = document.createElement("a");
        anchor.setAttribute("href", options.url);
        holder.appendChild(anchor);
        document.body.appendChild(holder);

        var viewer = createViewer(anchor, options.title || basename(options.url), config, options.routePath || "");
        holder.replaceChild(viewer.dom.block, anchor);
        if (viewer.dom.header) viewer.dom.header.style.display = "none";
        if (viewer.dom.status) viewer.dom.status.style.display = "none";
        viewer.dom.block.style.margin = "0";
        viewer.dom.block.style.border = "0";
        viewer.dom.block.style.borderRadius = "0";
        viewer.dom.stage.style.width = width + "px";
        viewer.dom.stage.style.height = height + "px";
        viewer.dom.stage.style.minHeight = "0";
        viewer.visible = true;

        var settled = false;
        function cleanup() {
            if (settled) return;
            settled = true;
            try { viewer.dispose(); } catch (err) { /* ignore */ }
            if (holder.parentNode) holder.parentNode.removeChild(holder);
        }

        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () {
                cleanup();
                reject(new Error("renderFrame timed out after " + timeout + "ms"));
            }, timeout);
            function fail(error) {
                clearTimeout(timer);
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
            function ready() {
                var inputs = options.inputs || {};
                var applied = {};
                if (!viewer.inputByName && viewer.built) {
                    viewer.inputByName = {};
                    for (var i = 0; i < viewer.built.inputs.length; i++) viewer.inputByName[viewer.built.inputs[i].name] = viewer.built.inputs[i];
                }
                for (var name in inputs) {
                    if (Object.prototype.hasOwnProperty.call(inputs, name)) applied[name] = viewer.setParameter(name, inputs[name]);
                }
                var pending = [];
                if (options.parentFrame) {
                    pending.push(frameImageFrom(options.parentFrame));
                } else if (options.parent) {
                    pending.push(renderFrame({
                        url: options.parent,
                        width: width,
                        height: height,
                        time: options.time,
                        steps: options.steps,
                        date: options.date,
                        includePaths: includePaths
                    }).then(function (parentFrame) {
                        return frameImageFrom(parentFrame.dataUrl);
                    }));
                }
                Promise.all(pending).then(function (images) {
                    if (images.length) {
                        var imageName = options.imageName || firstImageInput(viewer);
                        if (!imageName) throw new Error("renderFrame: a parent frame was given but the shader has no image input");
                        viewer.runtime.inputSources[imageName] = images[0];
                    }
                    var extraImages = options.images || {};
                    var imageLoads = [];
                    for (var key in extraImages) {
                        if (!Object.prototype.hasOwnProperty.call(extraImages, key)) continue;
                        (function (name, source) {
                            imageLoads.push(frameImageFrom(source).then(function (image) {
                                viewer.runtime.inputSources[name] = image;
                            }));
                        })(key, extraImages[key]);
                    }
                    return Promise.all(imageLoads);
                }).then(function () {
                    var frame = snapshotFrame(viewer, options, width, height);
                    frame.inputs = applied;
                    frame.mode = frame.mode || "ES 1.00";
                    clearTimeout(timer);
                    var result = frame;
                    cleanup();
                    resolve(result);
                }).catch(fail);
            }
            (function poll() {
                if (settled) return;
                if (viewer.disposed) return fail(new Error("renderFrame: viewer disposed"));
                if (viewer.state === "live") return ready();
                if (viewer.state === "error") return fail(new Error(viewer.lastErrorText || "renderFrame: shader error"));
                setTimeout(poll, 40);
            })();
            try { viewer.resume(); } catch (err) { fail(err); }
        });
    }

    function compareFrames(a, b, options) {
        options = options || {};
        var threshold = Math.max(0, numberOr(options.threshold, 2));
        if (typeof document === "undefined") {
            return Promise.reject(new Error("compareFrames needs a document (run it in a browser)"));
        }
        return Promise.all([frameImageFrom(a), frameImageFrom(b)]).then(function (images) {
            var width = Math.min(images[0].naturalWidth || images[0].width, images[1].naturalWidth || images[1].width);
            var height = Math.min(images[0].naturalHeight || images[0].height, images[1].naturalHeight || images[1].height);
            if (!width || !height) throw new Error("compareFrames: could not read the image sizes");
            function pixels(image) {
                var canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                var context = canvas.getContext("2d", { willReadFrequently: true });
                context.drawImage(image, 0, 0, width, height);
                return context.getImageData(0, 0, width, height).data;
            }
            var first = pixels(images[0]);
            var second = pixels(images[1]);
            var sum = 0;
            var maxDiff = 0;
            var changed = 0;
            var count = width * height;
            for (var pixel = 0; pixel < count; pixel++) {
                var index = pixel * 4;
                var dr = Math.abs(first[index] - second[index]);
                var dg = Math.abs(first[index + 1] - second[index + 1]);
                var db = Math.abs(first[index + 2] - second[index + 2]);
                sum += dr + dg + db;
                var worst = Math.max(dr, dg, db);
                if (worst > maxDiff) maxDiff = worst;
                if (worst > threshold) changed++;
            }
            var sizeMismatch = images[0].naturalWidth !== images[1].naturalWidth ||
                images[0].naturalHeight !== images[1].naturalHeight;
            return {
                width: width,
                height: height,
                sizeMismatch: sizeMismatch,
                mae: sizeMismatch ? null : +(sum / (count * 3)).toFixed(2),
                maxDiff: maxDiff,
                diffRatio: sizeMismatch ? null : +(changed / count).toFixed(4),
                identical: sizeMismatch ? false : sum === 0,
                threshold: threshold
            };
        });
    }

    var api = {
        VERSION: VERSION,
        plugin: plugin,
        DEFAULTS: DEFAULTS,
        getConfig: getConfig,
        // The shared UI toolkit (vendor/pupitre-ui) loads on demand: expose
        // the loader and read the instances at call time, not at script load.
        loadPUI: loadPUI,
        createParamsDocument: function (inputs, options) {
            return typeof PupitreISF !== "undefined" && PupitreISF
                ? PupitreISF.createDocument(inputs, options)
                : null;
        },
        parseISF: parseISF,
        parseISFMetadata: parseISFMetadata,
        parseJSONTolerant: parseJSONTolerant,
        evalExpression: evalExpression,
        buildShader: buildShader,
        normalizeInputs: normalizeInputs,
        normalizePasses: normalizePasses,
        normalizeImports: normalizeImports,
        detectShaderDialect: detectShaderDialect,
        convertToISF: convertToISF,
        rewriteSpecialFunctions: rewriteSpecialFunctions,
        tokenizeGLSL: tokenizeGLSL,
        highlightGLSL: highlightGLSL,
        clampInputValue: clampInputValue,
        prefersReducedMotion: prefersReducedMotion,
        resolveAssetUrl: resolveAssetUrl,
        resolveCandidates: resolveCandidates,
        isShaderHref: isShaderHref,
        renderFrame: typeof document !== "undefined" ? renderFrame : null,
        compareFrames: typeof document !== "undefined" ? compareFrames : null,
        setMaxContexts: function (max) { BUDGET.setMax(max); },
        createTestPattern: typeof document !== "undefined" ? createTestPattern : null
    };
    Object.defineProperty(api, "PupitreUI", {
        enumerable: true,
        get: function () { return typeof PupitreUI !== "undefined" ? PupitreUI : null; }
    });
    Object.defineProperty(api, "PupitreISF", {
        enumerable: true,
        get: function () { return typeof PupitreISF !== "undefined" ? PupitreISF : null; }
    });
    return api;
});
