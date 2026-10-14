/* ============================================================================
 * PM UI toolkit — ISF core (Interactive Shader Format)
 *
 * The shared, dependency-free ISF layer every browser renderer in this repo
 * uses (the ISF editor today; the docsify viewer and the patch browser kernel
 * can converge on it). It parses the header, normalises INPUTS/PASSES and
 * assembles WebGL1 shaders faithful to OBS's ISF host:
 *
 *   - RENDERSIZE / TIME / TIMEDELTA / PASSINDEX / FRAMEINDEX / DATE
 *   - isf_FragNormCoord (= gl_FragCoord.xy / RENDERSIZE, bottom-left)
 *   - IMG_PIXEL / IMG_NORM_PIXEL / IMG_THIS_PIXEL / IMG_NORM_THIS_PIXEL /
 *     IMG_THIS_NORM_PIXEL / IMG_SIZE with per-image size uniforms
 *   - INPUTS: float, bool, long, event, color, point2D, image, audio, audioFFT
 *   - PASSES with TARGET / PERSISTENT / WIDTH / HEIGHT
 *
 * The semantics mirror `docsify-plugins/docsify-isf` (MIT, same repository),
 * which is the reference implementation; this module is the compact core a
 * live editor can embed, and the place the two paths should converge.
 * ========================================================================= */

import {
  normalizeTypeKeywords, normalizeNumericSuffixes, renameBuiltinShadows,
  rewriteLibraryCalls as rewriteLibraryCallsCompat,
  collectUserFunctions as collectCompatUserFunctions,
  collectDeclaredTypes as collectCompatDeclaredTypes,
  buildOverloadShims, constantPreludeLines, lowerIntegerPowers,
} from './compat.js';

/* ── tolerant header JSON ───────────────────────────────────────────────── */

/**
 * ISF headers are JSON inside a `/* … *​/` comment, and hand-written ones
 * sometimes carry trailing commas or `//` comments. Returns `{ ok, value,
 * error }`; `error` carries a rough line/column for the editor.
 */
/** Line number (1-based) of an offset; used by tolerant-JSON diagnostics. */
function lineOfOffset(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

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

/** Parse the ISF header JSON with the same tolerance as the docsify kernel. */
export function parseISFJSON(text) {
  return parseJSONTolerant(text);
}

/**
 * Locate the ISF header: a block comment whose content starts with `{` (or
 * names ISF keys — license comments above the header are common). Candidates
 * are tried in order and the first that parses wins.
 */
function findHeader(text) {
  const re = /\/\*([\s\S]*?)\*\//g;
  let match;
  let hinted = null;
  while ((match = re.exec(text)) !== null) {
    const content = match[1];
    const looksLikeHeader = /^\s*\{/.test(content) || /"\s*(ISFVSN|INPUTS|PASSES|DESCRIPTION|VSN)\s*"/.test(content);
    if (!looksLikeHeader) continue;
    const result = parseISFJSON(content);
    if (result.ok) return { ok: true, data: result.value, end: match.index + match[0].length, error: null };
    if (!hinted) hinted = result.error;
  }
  return {
    ok: false,
    data: null,
    end: 0,
    error: hinted || { message: 'No ISF header found (expected /*{ … }*/)' },
  };
}

/**
 * Expand `#include "name.glsl"` from a caller-provided map. The browser has
 * no filesystem, so the editor (http) or the comparison CLI (Node) loads the
 * maps; missing/cyclic includes are reported and left commented out.
 */
export function expandIncludes(source, includes, warnings, stack) {
  const map = includes || {};
  const seen = stack || {};
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  return String(source == null ? '' : source)
    .replace(/^[ \t]*#include[ \t]+["']([^"']+)["'][ \t]*(?:\/\/[^\n]*)?$/gm, (match, name) => {
      const key = String(name).trim();
      if (seen[key]) { warn('Cyclic include "' + key + '" was skipped'); return '// cyclic include: ' + key; }
      let text = map[key];
      if (!text) {
        const lower = key.toLowerCase();
        const found = Object.keys(map).find((k) => k.toLowerCase() === lower);
        text = found ? map[found] : null;
      }
      if (!text) { warn('Missing include "' + key + '"'); return '// missing include: ' + key; }
      seen[key] = true;
      const expanded = expandIncludes(text, map, warnings, seen);
      delete seen[key];
      return '// ---- ' + key + ' ----\n' + expanded + '\n// ---- end ' + key + ' ----';
    });
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

/* ── INPUTS / PASSES ────────────────────────────────────────────────────── */

export const INPUT_TYPES = {
  float: { uniform: 'float' },
  bool: { uniform: 'bool' },
  long: { uniform: 'int' },
  event: { uniform: 'bool' },
  color: { uniform: 'vec4' },
  point2D: { uniform: 'vec2' },
  image: { uniform: 'sampler2D' },
  audio: { uniform: 'sampler2D' },
  audioFFT: { uniform: 'sampler2D' },
  // MadMapper extensions: controller/generator inputs surface as scalars,
  // floatRange as a min/max pair.
  floatRange: { uniform: 'vec2' },
  animator: { uniform: 'float' },
  shaper: { uniform: 'float' },
  incrementer: { uniform: 'float' },
  damper: { uniform: 'float' },
  pass_thru: { uniform: 'float' },
  linear_filter: { uniform: 'float' },
  adsr: { uniform: 'float' },
};

const TYPE_ALIASES = {
  float: 'float', bool: 'bool', long: 'long', int: 'long', event: 'event',
  color: 'color', point2d: 'point2D', image: 'image', audio: 'audio', audiofft: 'audioFFT',
  floatrange: 'floatRange', animator: 'animator', shaper: 'shaper', incrementer: 'incrementer',
  damper: 'damper', pass_thru: 'pass_thru', linear_filter: 'linear_filter', adsr: 'adsr',
};

const first = (...values) => values.find((v) => v !== undefined && v !== null);
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const pair = (v, fallback) => (Array.isArray(v)
  ? [num(v[0], fallback), num(v.length > 1 ? v[1] : v[0], num(v[0], fallback))]
  : [num(v, fallback), num(v, fallback)]);
const quad = (v, fallback) => (Array.isArray(v)
  ? [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2]), num(v[3], fallback[3])]
  : (Number.isFinite(Number(v)) ? [Number(v), Number(v), Number(v), 1] : fallback.slice()));

/**
 * The integer a `long` input hands to the shader for a selection. A numeric
 * VALUES entry keeps its value; a label entry falls back to its 0-based
 * index. MadMapper materials use both shapes: `["Linear","Circular"]`
 * labels compared with `== 0`, and `[1..9]` counts used as numbers. The
 * plugin does the same in `isf/header.lua` (`long_shader_value`).
 */
export function longUniformValue(input, value) {
  const values = input && Array.isArray(input.values) ? input.values : null;
  let raw = value;
  let foundIndex = -1;
  if (typeof raw === 'string' && values) {
    const labels = Array.isArray(input.labels) && input.labels.length
      ? input.labels : values.map(String);
    const found = labels.indexOf(raw);
    if (found >= 0) {
      foundIndex = found;
      raw = values[found];
    } else {
      const parsed = Number(raw);
      raw = Number.isFinite(parsed) ? parsed : 0;
    }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  if (foundIndex >= 0) return foundIndex;
  const index = Number(input && input.defaultIndex);
  return Number.isFinite(index) ? index : 0;
}

/**
 * Normalise `INPUTS` into the shape the renderer and the parameter panel use.
 * @returns array of inputs; every entry has `name,label,type,uniform,default`.
 */
export function normalizeInputs(raw, warnings) {
  const out = [];
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const name = String(first(entry.NAME, entry.Name, '')).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      warn('Input #' + (i + 1) + ' has an invalid NAME');
      return;
    }
    const rawType = String(first(entry.TYPE, entry.Type, 'float')).trim().toLowerCase();
    const type = TYPE_ALIASES[rawType];
    const info = type && INPUT_TYPES[type];
    if (!info) {
      warn('Input ' + name + ' has unsupported TYPE \'' + rawType + '\'');
      return;
    }
    const input = {
      name,
      label: String(first(entry.LABEL, entry.Label, name)).trim() || name,
      type,
      uniform: info.uniform,
      min: null,
      max: null,
      default: null,
    };
    input.define = /\bgenerate_as_define\b/.test(String(first(entry.FLAGS, entry.Flags, '')));
    if (type === 'float' || type === 'animator' || type === 'shaper' || type === 'incrementer'
      || type === 'damper' || type === 'pass_thru' || type === 'linear_filter' || type === 'adsr') {
      const rawMin = first(entry.MIN, entry.Min);
      const rawMax = first(entry.MAX, entry.Max);
      // The 0…1 pair is the *control* range for materials without MIN/MAX;
      // values must not be clamped to it (the plugin's clampInputValue reads
      // these flags).
      input.boundedMin = rawMin !== undefined && rawMin !== null;
      input.boundedMax = rawMax !== undefined && rawMax !== null;
      input.min = num(rawMin, 0);
      input.max = num(rawMax, 1);
      if (input.min > input.max) [input.min, input.max] = [input.max, input.min];
      if (input.min === input.max) { input.min -= 0.5; input.max += 0.5; }
      input.default = num(first(entry.DEFAULT, entry.Default, 0), 0);
      input.step = Number.isFinite(Number(entry.STEP)) ? Number(entry.STEP) : null;
    } else if (type === 'bool' || type === 'event') {
      input.default = !!first(entry.DEFAULT, entry.Default, false);
      input.defineValue = input.default ? 'true' : 'false';
    } else if (type === 'long') {
      const values = Array.isArray(entry.VALUES) ? entry.VALUES.slice() : null;
      let labels = Array.isArray(entry.LABELS) ? entry.LABELS.slice() : null;
      const def = first(entry.DEFAULT, entry.Default, 0);
      if (values && values.length) {
        labels = labels && labels.length ? labels : values.map(String);
        input.values = values;
        input.labels = labels;
        let index = 0;
        if (typeof def === 'string') index = Math.max(0, labels.indexOf(def));
        else if (values.every((v) => typeof v === 'number')) {
          // numeric VALUES: DEFAULT is the value itself
          const found = values.indexOf(def);
          index = found >= 0 ? found : 0;
        } else if (Number.isInteger(def) && def >= 0 && def < values.length) index = def;
        else index = Math.max(0, values.indexOf(def));
        input.default = values[index];
        input.defaultIndex = index;
        input.defineValue = String(longUniformValue(input, values[index]));
      } else {
        input.min = num(first(entry.MIN, entry.Min), null);
        input.max = num(first(entry.MAX, entry.Max), null);
        input.default = num(def, 0);
      }
    } else if (type === 'floatRange') {
      // a min/max pair: the DEFAULT is the [min, max] the control initializes
      input.default = pair(first(entry.DEFAULT, entry.Default), 0);
      input.min = pair(first(entry.MIN, entry.Min), 0);
      input.max = pair(first(entry.MAX, entry.Max), 1);
      input.defineValue = null;
    } else if (type === 'color') {
      input.default = quad(first(entry.DEFAULT, entry.Default), [0, 0, 0, 1]);
      input.min = quad(first(entry.MIN, entry.Min), [0, 0, 0, 0]);
      input.max = quad(first(entry.MAX, entry.Max), [1, 1, 1, 1]);
    } else if (type === 'point2D') {
      input.default = pair(first(entry.DEFAULT, entry.Default), 0);
      input.min = pair(first(entry.MIN, entry.Min), 0);
      input.max = pair(first(entry.MAX, entry.Max), 1);
      for (let a = 0; a < 2; a += 1) {
        if (input.min[a] === input.max[a]) { input.min[a] -= 0.5; input.max[a] += 0.5; }
      }
    } else if (type === 'image') {
      input.default = undefined;
    } else {
      input.samples = Math.max(1, Math.round(num(first(entry.MAX, entry.Max), 512)));
      input.default = undefined;
    }
    out.push(input);
  });
  return out;
}

/** Normalise `PASSES` (`NAME`, `TARGET`, `PERSISTENT`, `WIDTH`, `HEIGHT`). */
export function normalizePasses(raw, warnings) {
  const out = [];
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  if (!Array.isArray(raw)) return out;
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const target = String(first(entry.TARGET, entry.Target, '')).trim();
    // a pass without TARGET renders to the output (the displayed pass)
    if (target && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
      warn('Pass #' + (i + 1) + ' has an invalid TARGET');
      return;
    }
    out.push({
      name: String(first(entry.NAME, entry.Name, target || 'pass' + (i + 1))).trim() || ('pass' + (i + 1)),
      target: target || null,
      persistent: !!(first(entry.PERSISTENT, entry.Persistent, false)),
      float: !!(first(entry.FLOAT, entry.Float, false)),
      widthExpr: first(entry.WIDTH, entry.Width, null),
      heightExpr: first(entry.HEIGHT, entry.Height, null),
    });
  });
  return out;
}

/**
 * Normalise the MadMapper `GENERATORS` extension. A generator is a
 * CPU-computed uniform (see `generators.js`), fed from `TIME` and the INPUTS;
 * a name that collides with an input is ignored (the input wins).
 */
export function normalizeGenerators(raw, inputs, warnings) {
  const out = [];
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  if (!Array.isArray(raw)) return out;
  const byName = new Map((inputs || []).map((i) => [i.name, i]));
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') return;
    const name = String(first(entry.NAME, entry.Name, '')).trim();
    if (!/^[A-Za-z_]\w*$/.test(name)) { warn('Generator #' + (i + 1) + ' has an invalid NAME'); return; }
    if (byName.has(name)) { warn('Generator ' + name + ' collides with an input and was ignored'); return; }
    const type = String(first(entry.TYPE, entry.Type, 'pass_thru')).trim().toLowerCase();
    const params = (entry.PARAMS && typeof entry.PARAMS === 'object') ? entry.PARAMS : {};
    // pass_thru/multiplier may carry a boolean through as a bool uniform
    let uniform = 'float';
    if (type === 'pass_thru' || type === 'multiplier') {
      const reference = String(first(params.value, params.input, params.input1, '')).trim();
      const input = reference && byName.get(reference);
      if (input && input.uniform === 'bool') uniform = 'bool';
    }
    out.push({ name, type, params, uniform });
  });
  return out;
}

/* ── pass size expressions ──────────────────────────────────────────────── */

const EXPR_FUNCS = {
  floor: Math.floor, ceil: Math.ceil, round: Math.round, abs: Math.abs,
  sqrt: Math.sqrt, pow: Math.pow, min: Math.min, max: Math.max,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
};

/**
 * Evaluate an ISF PASSES `WIDTH`/`HEIGHT` expression (`$WIDTH / 2.0`,
 * `max($HEIGHT / 27.0, 1.0)`, `floor($WIDTH/2)`). Returns `fallback` for
 * anything unparseable. Pure, no `eval`.
 */
export function evalSizeExpression(expression, vars, fallback) {
  const src = String(expression == null ? '' : expression);
  const scope = vars || {};
  let i = 0;
  const skip = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };
  const peek = () => src[i];
  function parsePrimary() {
    skip();
    if (peek() === '(') {
      i += 1;
      const v = parseAdditive();
      skip();
      if (peek() === ')') i += 1;
      return v;
    }
    if (peek() === '-') { i += 1; return -parsePrimary(); }
    if (peek() === '+') { i += 1; return parsePrimary(); }
    if (/[0-9.]/.test(peek())) {
      let j = i;
      while (j < src.length && /[0-9.eE+-]/.test(src[j]) && !(j > i && /[+-]/.test(src[j]) && !/[eE]/.test(src[j - 1]))) j += 1;
      const v = Number(src.slice(i, j));
      i = j;
      return Number.isFinite(v) ? v : NaN;
    }
    if (/[A-Za-z_$]/.test(peek())) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const name = src.slice(i, j);
      i = j;
      skip();
      if (peek() === '(') {
        i += 1;
        const args = [];
        skip();
        if (peek() !== ')') {
          for (;;) {
            args.push(parseAdditive());
            skip();
            if (peek() === ',') { i += 1; continue; }
            break;
          }
        }
        skip();
        if (peek() === ')') i += 1;
        const fn = EXPR_FUNCS[name];
        return fn ? fn(...args) : NaN;
      }
      return name in scope ? Number(scope[name]) : NaN;
    }
    return NaN;
  }
  function parseMultiplicative() {
    let v = parsePrimary();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '*' && op !== '/' && op !== '%') return v;
      i += 1;
      const r = parsePrimary();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
  }
  function parseAdditive() {
    let v = parseMultiplicative();
    for (;;) {
      skip();
      const op = peek();
      if (op !== '+' && op !== '-') return v;
      i += 1;
      const r = parseMultiplicative();
      v = op === '+' ? v + r : v - r;
    }
  }
  const value = parseAdditive();
  skip();
  if (i !== src.length || !Number.isFinite(value)) return fallback;
  return value;
}

/**
 * Normalise `IMPORTED` textures. Accepts the object form
 * (`{"name": {"PATH": "file.png"}}`), the array form
 * (`[{"NAME": …, "PATH": …}]`) and bare paths. Filter/wrap hints are kept so
 * the renderer can honour them.
 */
export function normalizeImports(raw, warnings) {
  const out = [];
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  const add = (fallbackName, entry) => {
    if (typeof entry === 'string') entry = { PATH: entry };
    if (!entry || typeof entry !== 'object') return;
    const filePath = String(first(entry.PATH, entry.path, '')).trim();
    if (!filePath) return;
    const name = String(first(entry.NAME, entry.Name, fallbackName)).trim();
    if (!/^[A-Za-z_]\w*$/.test(name)) { warn('IMPORTED entry \'' + fallbackName + '\' has an invalid texture name'); return; }
    out.push({
      name,
      path: filePath,
      minFilter: first(entry.GL_TEXTURE_MIN_FILTER, entry.minFilter, null),
      magFilter: first(entry.GL_TEXTURE_MAG_FILTER, entry.magFilter, null),
      wrap: first(entry.GL_TEXTURE_WRAP, entry.wrap, null),
    });
  };
  if (Array.isArray(raw)) {
    raw.forEach((item, i) => {
      if (typeof item === 'string') {
        const base = item.split('/').pop().replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
        add(base || 'import' + i, item);
      } else {
        add('import' + i, item);
      }
    });
  } else if (raw && typeof raw === 'object') {
    for (const [key, entry] of Object.entries(raw)) add(key, entry);
  }
  return out;
}

/* ── source parsing ─────────────────────────────────────────────────────── */

/**
 * @returns {{valid:boolean, metadata:object, inputs:Array, passes:Array,
 *            body:string, bodyStartLine:number, error:object|null,
 *            warnings:Array}}
 */
export function parseISF(source) {
  const text = String(source == null ? '' : source);
  const warnings = [];
  const header = findHeader(text);
  if (!header.ok) {
    return { valid: false, metadata: {}, inputs: [], generators: [], imports: [], passes: [], body: '', bodyStartLine: 1, error: header.error, warnings };
  }
  const metadata = header.data || {};
  const inputs = normalizeInputs(metadata.INPUTS, warnings);
  const passes = normalizePasses(metadata.PASSES, warnings);
  const body = text.slice(header.end);
  // MadMapper binds `mm_LastFrame` to an implicit persistent ping-pong buffer
  // whenever a shader samples it (isf/effect.lua does the same); the core's
  // pass targets are double-buffered, which is exactly the needed history.
  if (/\bmm_LastFrame\b/.test(body) && !passes.some((pass) => pass.target === 'mm_LastFrame')) {
    if (passes.length === 1 && !passes[0].target) {
      passes[0].target = 'mm_LastFrame';
      passes[0].persistent = true;
      passes[0].name = 'mm_LastFrame';
    } else {
      passes.push({ name: 'mm_LastFrame', target: 'mm_LastFrame', persistent: true, widthExpr: null, heightExpr: null });
    }
  }
  return {
    valid: true,
    metadata,
    inputs,
    generators: normalizeGenerators(metadata.GENERATORS, inputs, warnings),
    imports: normalizeImports(metadata.IMPORTED, warnings),
    passes,
    body,
    bodyStartLine: lineOf(text, header.end),
    error: null,
    warnings,
  };
}

/** Fresh default parameter map for a parsed material. */
export function defaultParams(inputs) {
  const params = {};
  for (const input of inputs || []) {
    if (input.default === undefined) continue;
    params[input.name] = Array.isArray(input.default) ? input.default.slice() : input.default;
  }
  return params;
}

/* ── MadMapper library call rewriting ───────────────────────────────────── */

/* The bundled `isf/glsl` ports expose one name per signature (`mm_circle2`,
   `mm_fbm3o`, …) while the materials call the original overloaded names. This
   is the browser sibling of the Lua dialect's library resolution. */
const LIBRARY_ARITY = {
  mod289: { 1: 'mm_mod289' },
  mod7: { 1: 'mm_mod7' },
  permute: { 1: 'mm_permute' },
  rgrad2: { 2: 'mm_rgrad2' },
  hash: { 1: 'mm_hash2' },
  cosNoise: { 1: 'mm_cosnoise' },
  fillDist: { 1: 'mm_fill_dist' },
  strokeDist: { 2: 'mm_stroke_dist' },
  circle: { 2: 'mm_circle2', 3: 'mm_circle3' },
  roundedRectangle: { 3: 'mm_rrect3', 4: 'mm_rrect4' },
  triangle: { 2: 'mm_triangle2', 3: 'mm_triangle3' },
  hexagon: { 2: 'mm_hexagon2', 3: 'mm_hexagon3' },
  line: { 4: 'mm_line4' },
  arc: { 4: 'mm_arc4' },
  translate: { 2: 'mm_translate' },
  rotate: { 2: 'mm_rotate' },
  repeat: { 2: 'mm_repeat2', 3: 'mm_repeat3', 4: 'mm_repeat4', 5: 'mm_repeat5' },
  blend: { 2: 'mm_blend' },
  smin: { 3: 'mm_smin' },
  smoothBlend: { 3: 'mm_smoothblend' },
  subtract: { 2: 'mm_subtract' },
  intersect: { 2: 'mm_intersect' },
};

const LIBRARY_DIM = {
  noise: ['mm_noise2', 'mm_noise3'],
  vnoise: ['mm_vnoise2', 'mm_vnoise3'],
  worleyNoise: ['mm_worley2', 'mm_worley3'],
  billowedNoise: ['mm_billowed2', 'mm_billowed3'],
};

const LIBRARY_EXTRA = ['fill', 'stroke', 'glow', 'rectangle', 'repeatRadial',
  'fBm', 'dfBm', 'ridgedNoise', 'dRidgedNoise', 'dnoise', 'dvnoise',
  'dWorleyNoise', 'dBillowedNoise', 'dBillowyTurbulence', 'billowyTurbulence',
  'ridgedMF', 'dRidgedMF', 'curlNoise', 'flowNoise', 'dFlowNoise'];

const LIBRARY_NAMES = new Set([...Object.keys(LIBRARY_ARITY), ...Object.keys(LIBRARY_DIM), ...LIBRARY_EXTRA]);

/** Declared vector dimensions in a body (`vec3 p` → p: 3), for overload picks. */
export function collectDeclaredTypes(source) {
  const types = {};
  const re = /\b(vec|ivec|uvec|bvec|mat)([234])\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(String(source || '')))) types[m[3]] = Number(m[2]);
  return types;
}

/** Best-effort component count of an expression (2/3/4; default 2). */
export function valueDim(expression, types) {
  const text = String(expression || '').trim();
  let m = /\b[biu]?vec([234])\s*\(/.exec(text);
  if (m) return Number(m[1]);
  m = /^\s*([A-Za-z_]\w*)\s*$/.exec(text);
  if (m && types && types[m[1]]) return types[m[1]];
  m = /\.(xyzw|rgba|stpq)([\d]*)\s*$/.exec(text);
  if (m) return m[2] ? m[2].length : m[1].length === 1 ? 1 : m[1].length;
  if (/^-?\d*\.?\d+$/.test(text)) return 1;
  return 2;
}

function resolveLibraryRename(name, args, types) {
  if (LIBRARY_ARITY[name]) return LIBRARY_ARITY[name][args.length] || null;
  if (LIBRARY_DIM[name]) {
    const dim = valueDim(args[0] || '', types);
    return LIBRARY_DIM[name][dim === 3 ? 1 : 0] || null;
  }
  const dim = valueDim(args[0] || '', types) === 3 ? 3 : 2;
  switch (name) {
    case 'fBm': return args.length === 4 ? 'mm_fbm' + dim + 'o' : 'mm_fbm' + dim;
    case 'dfBm': return args.length === 4 ? 'mm_dfbm' + dim + 'o' : 'mm_dfbm' + dim;
    case 'ridgedNoise': return args.length === 2 ? 'mm_ridged' + dim + 'r' : 'mm_ridged' + dim;
    case 'dRidgedNoise': return args.length === 2 ? 'mm_dridged' + dim + 'r' : 'mm_dridged' + dim;
    case 'dnoise': return 'mm_dnoise' + dim;
    case 'dvnoise': return 'mm_dvnoise' + dim;
    case 'dWorleyNoise': return 'mm_dworley' + dim;
    case 'dBillowedNoise': return 'mm_dbillowed' + dim;
    case 'dBillowyTurbulence': return args.length === 4 ? 'mm_dturb' + dim + 'o' : 'mm_dturb' + dim;
    case 'billowyTurbulence': return args.length === 4 ? 'mm_turb' + dim + 'o' : 'mm_turb' + dim;
    case 'ridgedMF':
      return args.length === 1 ? 'mm_ridgedmf' + dim : args.length === 2 ? 'mm_ridgedmf' + dim + 'r' : 'mm_ridgedmf' + dim + 'o';
    case 'dRidgedMF':
      return args.length === 1 ? 'mm_dridgedmf' + dim : args.length === 2 ? 'mm_dridgedmf' + dim + 'r' : 'mm_dridgedmf' + dim + 'o';
    case 'curlNoise': return args.length === 2 ? 'mm_curl2t' : 'mm_curl2';
    case 'flowNoise': return 'mm_flow2';
    case 'dFlowNoise': return 'mm_dflow2';
    default: break;
  }
  if (name === 'fill') return valueDim(args[0] || '', types) === 4 ? 'mm_fill4' : 'mm_fill3';
  if (name === 'stroke') return valueDim(args[0] || '', types) === 4 ? 'mm_stroke4' : 'mm_stroke3';
  if (name === 'glow') return valueDim(args[0] || '', types) === 4 ? 'mm_glow4' : 'mm_glow3';
  if (name === 'rectangle') {
    if (args.length === 2) return valueDim(args[1] || '', types) === 2 ? 'mm_rect_s' : 'mm_rect_r';
    if (args.length === 3) return valueDim(args[2] || '', types) === 2 ? 'mm_rect_cs' : 'mm_rect_cr';
    return null;
  }
  if (name === 'repeatRadial') {
    if (args.length === 2) return 'mm_repeat_radial2';
    if (args.length === 3) return valueDim(args[2] || '', types) === 2 ? 'mm_repeat_radial3' : 'mm_repeat_radial4';
    if (args.length === 4) return 'mm_repeat_radial5';
    return null;
  }
  return null;
}

/** Rewrite original library names into their ported `mm_*` equivalents. */
export function rewriteLibraryCalls(source, options) {
  const opts = options || {};
  const text = String(source == null ? '' : source);
  const types = opts.types || {};
  const userFunctions = new Set(opts.userFunctions || []);
  let out = '';
  let i = 0;
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  while (i < text.length) {
    const c = text[i];
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < text.length && isWord(text[j])) j += 1;
      const name = text.slice(i, j);
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (LIBRARY_NAMES.has(name) && !userFunctions.has(name) && text[k] === '(') {
        const call = callArgs(text, k);
        if (call) {
          const replacement = resolveLibraryRename(name, call.args.map((a) => a.trim()), types);
          if (replacement && replacement !== name) {
            // nested calls inside the arguments must be rewritten too, and
            // the ported helpers take float vectors (ivec2 args are cast)
            const args = call.args.map((a) => rewriteLibraryCalls(
              a.trim().replace(/\b([iu])vec([234])\s*\(/g, 'vec$2('), opts));
            // the `*o` helpers take an int octaves parameter; ISF materials
            // pass a float number, so coerce it (ES rejects the implicit cast)
            if (/^mm_(?:d)?(?:fbm|turb)[23]o$/.test(replacement) && args.length >= 2) {
              args[1] = 'int(' + args[1] + ')';
            } else if (/^mm_(?:d)?ridgedmf[23]o$/.test(replacement) && args.length >= 3) {
              args[2] = 'int(' + args[2] + ')';
            }
            out += replacement + '(' + args.join(', ') + ')';
            i = call.end + 1;
            continue;
          }
        }
      }
      out += name;
      i = j;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Names defined by the material itself (never rewritten to `mm_*`). */
export function collectUserFunctions(source) {
  const names = [];
  const re = /\b(?:void|float|int|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(String(source || '')))) names.push(m[1]);
  return names;
}

/* ── special-function rewriting ─────────────────────────────────────────── */

const SPECIALS = new Set(['IMG_PIXEL', 'IMG_NORM_PIXEL', 'IMG_THIS_PIXEL',
  'IMG_NORM_THIS_PIXEL', 'IMG_THIS_NORM_PIXEL', 'IMG_SIZE']);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Split `<name>(a, (b), c)` arguments; returns null when unbalanced. */
function callArgs(src, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) { args.push(src.slice(start, i)); return { args, end: i }; }
      depth -= 1;
    } else if (ch === ',' && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/**
 * Rewrite ISF special functions into plain GLSL. Only calls whose first
 * argument is a known image/pass name are rewritten; anything else is left
 * alone (the compiler error names it) and reported as a warning.
 */
export function rewriteSpecials(source, imageNames, warnings) {
  const known = new Set(imageNames || []);
  const src = stripComments(String(source == null ? '' : source));
  const warn = (message) => { if (warnings) warnings.push({ message }); };
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (SPECIALS.has(word) && src[j] === '(') {
        const call = callArgs(src, j);
        if (call) {
          const args = call.args.map((a) => a.trim());
          const image = args[0];
          if (known.has(image)) {
            if (word === 'IMG_PIXEL') out += 'texture2D(' + image + ', (' + args[1] + ') / _' + image + '_imgSize)';
            else if (word === 'IMG_NORM_PIXEL') out += 'texture2D(' + image + ', ' + args[1] + ')';
            // RENDERSIZE-relative: the current pixel of the *output*, matching
            // the Lua host (`.Sample(sampler, isf_FragNormCoord)`). Using the
            // image size is only equivalent when input and output match.
            else if (word === 'IMG_THIS_PIXEL') out += 'texture2D(' + image + ', gl_FragCoord.xy / RENDERSIZE)';
            else if (word === 'IMG_NORM_THIS_PIXEL' || word === 'IMG_THIS_NORM_PIXEL') out += 'texture2D(' + image + ', isf_FragNormCoord)';
            else out += '_' + image + '_imgSize';
            i = call.end + 1;
            continue;
          }
          if (word !== 'IMG_SIZE') warn(word + '(' + image + ', …) refers to an unknown image; left as-is');
        }
      }
      out += word;
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * GLSL ES requires global initializers to be constant expressions; desktop and
 * MadMapper shaders commonly write `float t = mat_time_source;` at file scope.
 * Split those into a declaration plus an assignment hoisted into the entry
 * point (the reference implementation does the same).
 */
/** Comma that is not nested in a call/array: marks a multi-declarator line. */
function hasTopLevelComma(text) {
  let depth = 0;
  for (let i = 0; i < String(text).length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth === 0) return true;
  }
  return false;
}

/** Blank out comments without moving any token to another line. */
function stripCommentsPreservingLines(source) {
  const text = String(source || '');
  let out = '';
  let i = 0;
  let block = false;
  while (i < text.length) {
    if (block) {
      if (text.charAt(i) === '*' && text.charAt(i + 1) === '/') { block = false; out += '  '; i += 2; continue; }
      out += text.charAt(i) === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (text.charAt(i) === '/' && text.charAt(i + 1) === '*') { block = true; out += '  '; i += 2; continue; }
    if (text.charAt(i) === '/' && text.charAt(i + 1) === '/') {
      while (i < text.length && text.charAt(i) !== '\n') { out += ' '; i += 1; }
      continue;
    }
    out += text.charAt(i);
    i += 1;
  }
  return out;
}

export function hoistGlobalInitializers(source) {
  const lines = String(source == null ? '' : source).split('\n');
  const cleanLines = stripCommentsPreservingLines(source).split('\n');
  const out = [];
  const assignments = [];
  let depth = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const withoutComment = cleanLines[i] || '';
    const declaration = /^([ \t]*)((?:(?:const|uniform|varying|attribute|lowp|mediump|highp)[ \t]+)*)([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*([^;]+);[ \t]*$/.exec(withoutComment);
    const isConst = declaration && /\bconst\b/.test(declaration[2]);
    const isUniform = declaration && /\buniform\b/.test(declaration[2]);
    const isSampler = declaration && /\bsampler/.test(declaration[3]);
    if (depth === 0 && declaration && !isConst && !isSampler && !hasTopLevelComma(declaration[5])) {
      assignments.push(declaration[4] + ' = ' + declaration[5] + ';');
      const qualifiers = isUniform ? declaration[2].replace(/\buniform[ \t]+/, '') : declaration[2];
      out.push(declaration[1] + qualifiers + declaration[3] + ' ' + declaration[4] + ';');
      continue;
    }
    out.push(line);
    const opens = (withoutComment.match(/\{/g) || []).length;
    const closes = (withoutComment.match(/\}/g) || []).length;
    depth = Math.max(0, depth + opens - closes);
  }
  return { body: out.join('\n'), assignments };
}

/**
 * Last-resort compatibility transform: GLSL ES is stricter than desktop GLSL
 * about mixing integer literals with floats (`2*PI`). Promote bare integer
 * literals to floats on lines that are clearly in a float context. Used only
 * as a retry after a shader has already failed to compile, so working shaders
 * are never touched (same policy as the reference viewer).
 *
 * Conservative by design: a line is left alone when it mentions a known int
 * identifier, an int cast, `%`, a `for(…)` header, a `#` directive or an
 * array subscript.
 */
export function promoteIntegerLiterals(source, opts) {
  const o = opts || {};
  const floats = new Set(o.floatNames || []);
  const ints = new Set(o.intNames || []);
  ['PI', 'TIME', 'TIMEDELTA', 'DATE', 'RENDERSIZE', 'FRAMEINDEX', 'isf_FragNormCoord', 'gl_FragCoord']
    .forEach((n) => floats.add(n));
  const names = (set) => [...set].filter((n) => /^[A-Za-z_]\w*$/.test(n)).join('|') || '\\b\\B';
  const floatRe = new RegExp('\\b(?:' + names(floats) + ')\\b');
  const intRe = new RegExp('\\b(?:' + names(ints) + ')\\b');
  const intNameRe = new RegExp('(?<![\\w.])(?:' + names(ints) + ')(?!\\s*\\()', 'g');

  // `vec4 * quality`: a long input participating in float arithmetic
  const castIntNames = (part) => part.replace(intNameRe, (match, offset) => {
    const before = part.slice(0, offset);
    return /float\(\s*$/.test(before) ? match : 'float(' + match + ')';
  });
  // `2*PI` -> `2.0*PI`; never touch exponents, hex or existing floats
  const promoteLiterals = (part) => part.replace(
    /(?<![\w.])(?<![eE][+-])(?<![eE])(\d+)(?![.\w])/g, '$1.0');
  // `mat_sides < 3.` / `count > uProgress`: cast only the int side of a
  // genuinely mixed comparison, never an int == int test (`mode == 1`)
  const castMixedComparisons = (part) => part.replace(
    /([A-Za-z_]\w*)\s*(<=|>=|==|!=|<|>)\s*([A-Za-z_]\w*|\d+\.\d*|\d*\.\d)/g,
    (m, l, op, r) => {
      const isFloat = (x) => floats.has(x) || /^\d/.test(x);
      const isInt = (x) => ints.has(x);
      if (isInt(l) && isFloat(r)) return 'float(' + l + ') ' + op + ' ' + r;
      if (isFloat(l) && isInt(r)) return l + ' ' + op + ' float(' + r + ')';
      return m;
    });

  return String(source == null ? '' : source).split('\n').map((line) => {
    const code = line.replace(/\/\/[^\n]*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!code.trim() || /^\s*#/.test(code)) return line;
    // a `for` header keeps its int loop variable; only a mixed condition
    // (`i < floatN`) needs the int side promoted
    if (/\bfor\s*\(/.test(code)) {
      const at = code.search(/\bfor\s*\(/);
      const open = code.indexOf('(', at);
      let depth = 0;
      let close = -1;
      for (let k = open; k < code.length; k += 1) {
        if (code[k] === '(') depth += 1;
        else if (code[k] === ')') { depth -= 1; if (depth === 0) { close = k; break; } }
      }
      if (close < 0) return line;
      const header = code.slice(open + 1, close);
      const parts = header.split(';');
      if (parts.length === 3) {
        const cond = parts[1];
        // the loop variable may be declared float in the init
        const initFloat = /\bfloat\s+([A-Za-z_]\w*)/.exec(parts[0]);
        const floatVar = initFloat && new RegExp('\\b' + initFloat[1] + '\\b').test(cond);
        const condFloat = floatVar || floatRe.test(cond) || /\d+\.\d*|\d*\.\d/.test(cond);
        const condInt = intRe.test(cond) || /\bint\s*\(/.test(cond);
        if (condInt && condFloat) {
          let castCond = cond.replace(intNameRe, (x) => 'float(' + x + ')');
          // an `int(expr)` operand is an int too; make it float
          castCond = castCond.replace(/\bint\s*\(([^()]*)\)/g, (m, inner) => 'float(int(' + inner + '))');
          return line.slice(0, open + 1) + [parts[0], castCond, parts[2]].join(';') + line.slice(close);
        }
      }
      return line;
    }
    if (/\bint\s*\(/.test(code) || /%/.test(code)) return line;
    const hasFloat = floatRe.test(code) || /\d+\.\d*|\d*\.\d/.test(code);
    const hasInt = intRe.test(code);
    if (!hasFloat && !hasInt) return line;
    // Identifier casts are context-sensitive: never on comparisons or
    // assignment targets/increments (the literal pass below is safe there).
    const comparison = /(==|!=|<=|>=|<|>)/.test(code);
    const assignTarget = hasInt && new RegExp('(?:' + names(ints)
      + ')\\s*(?:=[^=]|\\+=|-=|\\*=|/=|%=|\\+\\+|--)').test(code);
    // never touch declarations (uniform/precision/parameter lines)
    const declaration = /^\s*(?:uniform|varying|attribute|const|in|out|flat|lowp|mediump|highp)\b/.test(code)
      || new RegExp('\\b(?:int|uint|ivec[234]|uvec[234])\\s+(?:' + names(ints) + ')\\b').test(code);
    // an int comparison with an int literal must stay integer (`mode == 1`)
    const comparisonWithInt = hasInt && comparison;
    const rewrite = (part) => {
      const out = hasFloat && !comparisonWithInt ? promoteLiterals(part) : part;
      const castable = hasInt && !assignTarget && !declaration && !comparison;
      let res = castable ? castIntNames(out) : out;
      if (hasInt && hasFloat && comparison && !assignTarget && !declaration) {
        res = castMixedComparisons(res);
      }
      return res;
    };
    return line.split(/(\[[^\]]*\])/).map((part, i) => (i % 2 === 1 ? part : rewrite(part))).join('');
  }).join('\n');
}

/* ── shader assembly ────────────────────────────────────────────────────── */

export const VERTEX_SHADER = [
  'attribute vec2 isf_position;',
  'varying vec2 isf_FragNormCoord;',
  'void main() {',
  '  gl_Position = vec4(isf_position, 0.0, 1.0);',
  '  isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5;',
  '}',
].join('\n');

/** The same quad in GLSL ES 3.00 (WebGL2), where `attribute`/`varying` moved. */
export const VERTEX_SHADER_ES3 = [
  '#version 300 es',
  'precision highp float;',
  'precision highp int;',
  'in vec2 isf_position;',
  'out vec2 isf_FragNormCoord;',
  'void main() {',
  '  gl_Position = vec4(isf_position, 0.0, 1.0);',
  '  isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5;',
  '}',
].join('\n');

/* ES 3.00 compatibility preamble: the corpus is written against GLSL ES 1.00
   (as OBS/ISF are), so keep the shader body untouched and map the removed
   keywords instead. Dynamic array indexing — rejected by strict ES 1.00
   drivers, and used by shipped materials like color-bars — is legal in ES 3.00,
   which is why the second compile attempt exists. */
const ES3_PREAMBLE = [
  '#version 300 es',
  '#ifdef GL_FRAGMENT_PRECISION_HIGH',
  'precision highp float;',
  'precision highp int;',
  '#else',
  'precision mediump float;',
  'precision mediump int;',
  '#endif',
  '#define varying in',
  '#define texture2D texture',
  '#define texture2DProj textureProj',
  '#define texture2DLod textureLod',
  '#define textureCube texture',
  '#define textureCubeLod textureLod',
  '#define gl_FragColor _isfFragColor',
  'out vec4 _isfFragColor;',
];

const UNIFORM_DECL = {
  float: 'uniform float ', bool: 'uniform bool ', int: 'uniform int ',
  vec2: 'uniform vec2 ', vec4: 'uniform vec4 ',
};

/**
 * Non-host uniform declarations shared by the fragment shader and a custom
 * vertex shader (`.vs`): inputs (including samplers), generators and the
 * remaining host uniforms. `exclude` skips names the caller's prefix already
 * declares.
 */
export function buildUniformDeclarations(parsed, exclude) {
  const skip = new Set(exclude || []);
  const lines = [];
  const add = (name) => !skip.has(name);
  if (add('PASSINDEX')) lines.push('uniform int PASSINDEX;');
  // Documented extension: the mouse/touch state is a host uniform, not an
  // INPUT (the docsify kernel declares and sets it the same way).
  if (add('_isfMouse')) lines.push('uniform vec4 _isfMouse;');
  for (const imported of (parsed.imports || [])) {
    if (skip.has(imported.name)) continue;
    lines.push('uniform sampler2D ' + imported.name + ';');
    lines.push('uniform vec2 _' + imported.name + '_imgSize;');
    lines.push('uniform vec4 _' + imported.name + '_imgRect;');
    lines.push('uniform bool _' + imported.name + '_flip;');
  }
  if (add('TIME')) lines.push('uniform float TIME;');
  if (add('TIMEDELTA')) lines.push('uniform float TIMEDELTA;');
  if (add('FRAMEINDEX')) lines.push('uniform int FRAMEINDEX;');
  if (add('DATE')) lines.push('uniform vec4 DATE;');
  for (const input of parsed.inputs || []) {
    if (input.define) {
      // `FLAGS: generate_as_define` inputs are compile-time constants, not
      // uniforms (the plugin does the same; MadMapper materials gate code on
      // them with #if)
      const value = input.defineValue !== undefined && input.defineValue !== null
        ? input.defineValue
        : String(input.default);
      lines.push('#define ' + input.name + ' ' + value);
    } else if (input.type === 'image' || input.type === 'audio' || input.type === 'audioFFT') {
      lines.push('uniform sampler2D ' + input.name + ';');
      lines.push('uniform vec2 _' + input.name + '_imgSize;');
      lines.push('uniform vec4 _' + input.name + '_imgRect;');
      lines.push('uniform bool _' + input.name + '_flip;');
    } else {
      lines.push(UNIFORM_DECL[input.uniform] + input.name + ';');
    }
  }
  for (const generator of parsed.generators || []) {
    lines.push((generator.uniform === 'bool' ? 'uniform bool ' : 'uniform float ') + generator.name + ';');
  }
  return lines;
}

/**
 * Build a vertex shader from a companion `.vs` source (ISF's custom vertex
 * path): the host prefix declares `isf_position`/`isf_FragNormCoord`, the
 * material body follows and `isf_vertShaderInit` is appended (the body calls
 * it). `vv_*` names are the MadMapper aliases.
 */
export function buildVertexShader(userSource, opts) {
  const o = opts || {};
  let body = String(userSource == null ? '' : userSource)
    .replace(/^[ \t]*#version[^\n]*\n?/m, '')
    .replace(/\bvv_vertShaderInit\b/g, 'isf_vertShaderInit')
    .replace(/\bvv_FragNormCoord\b/g, 'isf_FragNormCoord');
  const decls = buildUniformDeclarations(o.parsed || { inputs: [], generators: [] }, ['RENDERSIZE', 'PASSINDEX']);
  const prefix = o.api === 'es3'
    ? ['#version 300 es',
      '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', 'precision highp int;',
      '#else', 'precision mediump float;', 'precision mediump int;', '#endif',
      '#define attribute in', '#define varying out',
      'in vec2 isf_position;', 'uniform int PASSINDEX;', 'uniform vec2 RENDERSIZE;',
      'out vec2 isf_FragNormCoord;', ...decls, 'void isf_vertShaderInit(void);']
    : ['precision highp float;', 'precision highp int;',
      'attribute vec2 isf_position;', 'uniform int PASSINDEX;', 'uniform vec2 RENDERSIZE;',
      'varying vec2 isf_FragNormCoord;', ...decls, 'void isf_vertShaderInit(void);'];
  const suffix = [
    'void isf_vertShaderInit(void) {',
    '    gl_Position = vec4(isf_position, 0.0, 1.0);',
    '    isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5;',
    '}',
  ];
  return prefix.join('\n') + '\n' + body + '\n' + suffix.join('\n') + '\n';
}

/**
 * Assemble the fragment shader for one pass.
 * @returns {{fs:string, preludeLines:number, uniforms:Array, images:Array,
 *            warnings:Array}}
 */
export function assembleFragmentShader(parsed, options) {
  const opts = options || {};
  const warnings = (parsed.warnings || []).slice();
  const inputs = parsed.inputs || [];
  const passes = parsed.passes || [];
  const pass = opts.pass || null;

  const lines = [];
  if (opts.api === 'es3') lines.push(...ES3_PREAMBLE);
  else lines.push(
    '#extension GL_OES_standard_derivatives : enable',
    '#extension GL_EXT_shader_texture_lod : enable',
    'precision highp float;', 'precision highp int;');
  lines.push('uniform vec2 RENDERSIZE;');
  lines.push('varying vec2 isf_FragNormCoord;');
  lines.push('#define vv_FragNormCoord isf_FragNormCoord');
  lines.push('#define isf_vertShaderInit()');
  // HLSL/MadMapper helpers the spec host provides but WebGL does not; the
  // `#ifndef` guards keep a material's own definition when it has one
  lines.push('#ifndef saturate');
  lines.push('#define saturate(x) clamp(x, 0.0, 1.0)');
  lines.push('#endif');
  lines.push('#ifndef lerp');
  lines.push('#define lerp(a, b, t) mix(a, b, t)');
  lines.push('#endif');
  lines.push('#ifndef frac');
  lines.push('#define frac(x) fract(x)');
  lines.push('#endif');
  lines.push('#ifndef rsqrt');
  lines.push('#define rsqrt(x) inversesqrt(x)');
  lines.push('#endif');
  lines.push('#ifndef ddx');
  lines.push('#define ddx(x) dFdx(x)');
  lines.push('#endif');
  lines.push('#ifndef ddy');
  lines.push('#define ddy(x) dFdy(x)');
  lines.push('#endif');
  lines.push(...buildUniformDeclarations(parsed, ['RENDERSIZE']));

  const images = [];
  for (const input of inputs) {
    if (input.type === 'image' || input.type === 'audio' || input.type === 'audioFFT') images.push(input.name);
  }
  for (const imported of parsed.imports || []) images.push(imported.name);
  for (const p of passes) { if (p.target) images.push(p.target); }

  for (const p of passes) {
    if (!p.target) continue;
    lines.push('uniform sampler2D ' + p.target + ';');
    lines.push('uniform vec2 _' + p.target + '_imgSize;');
  }

  // Drop host-owned declarations from the material body, then rewrite the
  // special functions; the header itself is already gone.
  let body = String(parsed.body || '')
    .replace(/^\s*#version[^\n]*\n?/m, '')
    .replace(/^[ \t]*uniform\s+(?:lowp\s+|mediump\s+|highp\s+)?(?:float|vec2|vec3|vec4|int|bool)\s+(?:RENDERSIZE|TIME|TIMEDELTA|DATE|FRAMEINDEX|PASSINDEX)\s*;[ \t]*$/gm, '');
  if (opts.api === 'es3') {
    // ES 1.00 extension directives are invalid under ES 3.00 (derivatives and
    // texture LOD are core there); desktop-only extensions are meaningless.
    body = body.replace(/^[ \t]*#extension\s+GL_(?:OES_standard_derivatives|EXT_shader_texture_lod|EXT_frag_depth)[^\n]*\n?/gm, '');
    body = body.replace(/^[ \t]*#extension\s+GL_(?:ARB|NV|AMD|ATI|INTEL)_[^\n]*\n?/gm, '');
  }
  body = expandIncludes(body, opts.includes, warnings);
  // K1 (docs/isf-kernel-consolidation.md): the docsify kernel's compiler
  // compatibility layer — dialect type keywords, built-in shadow renames and
  // the full library-call rewrite (noise families, swizzle dimensions, ivec
  // argument casts) — then the int-parameter overload shims.
  body = renameBuiltinShadows(normalizeNumericSuffixes(normalizeTypeKeywords(body)));
  const compatUserFunctions = collectCompatUserFunctions(body);
  const compatTypes = collectCompatDeclaredTypes(body);
  for (const input of inputs) compatTypes[input.name] = input.uniform === 'int' ? 'int' : input.uniform;
  body = rewriteLibraryCallsCompat(body, { userFunctions: compatUserFunctions, types: compatTypes });
  const shims = buildOverloadShims(body);
  body = rewriteSpecials(body, images, warnings);
  body = lowerIntegerPowers(body);
  if (pass && pass.widthExpr == null && pass.heightExpr == null) { /* sizes come from RENDERSIZE */ }

  // MadMapper-style materials expose materialColorForPixel() instead of main()
  const hoisted = hoistGlobalInitializers(body);
  body = hoisted.body;
  const preludeAssignments = hoisted.assignments.length
    ? '\n    ' + hoisted.assignments.join('\n    ') : '';
  const clean = stripComments(body);
  const hasMain = /\bvoid\s+main\s*\(/.test(clean);
  const isMadMapper = /\bmaterialColorForPixel\s*\(/.test(clean);
  if (!hasMain && isMadMapper) {
    body += '\n\nvoid main() {' + preludeAssignments
      + '\n    gl_FragColor = materialColorForPixel(isf_FragNormCoord);\n}\n';
  } else if (hasMain && hoisted.assignments.length) {
    body = body.replace(/void\s+main\s*\([^)]*\)\s*\{/, (match) => match + preludeAssignments);
  } else if (!hasMain) {
    warnings.push({ message: 'no main() found; the material will fail to render' });
  }

  const inputNameMap = {};
  for (const input of inputs) inputNameMap[input.name] = true;
  lines.push(...constantPreludeLines(body, inputNameMap));
  lines.push(...shims.prototypes, ...shims.definitions);
  lines.push('');
  const preludeLines = lines.length;   // shader lines before the material body
  lines.push(body);
  return {
    fs: lines.join('\n'), preludeLines, uniforms: inputs, images, warnings,
    promoteOptions: {
      noCastInts: shims.outIntNames,
      intParamPositions: shims.intParamPositions,
      intReturnFunctions: shims.intReturnFunctions,
    },
  };
}

/** Build every pass program source for a parsed material. */
export function assembleShaders(parsed, options) {
  const opts = options || {};
  const passes = parsed.passes && parsed.passes.length
    ? parsed.passes.map((pass, index) => ({ pass, index }))
    : [{ pass: null, index: 0 }];
  const customVertex = opts.vs
    ? buildVertexShader(opts.vs, { api: opts.api, parsed })
    : null;
  return passes.map(({ pass, index }) => ({
    pass,
    index,
    customVertex: !!customVertex,
    vertex: customVertex || (opts.api === 'es3' ? VERTEX_SHADER_ES3 : VERTEX_SHADER),
    ...assembleFragmentShader(parsed, { pass: pass || undefined, index, api: opts.api, includes: opts.includes }),
  }));
}
