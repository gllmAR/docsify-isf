# docsify-isf — Software Design Document

Status: **implemented (v1.0.0)** — self-tested by the README and by
`tests/run.js` / `tests/browser-smoke.mjs`.
Audience: whoever maintains the plugin, the OBS Lua Projection Mapping docs
site, or another Docsify host that wants to embed ISF files.

---

## 1. Problem

The OBS Lua Projection Mapping documentation is a Docsify site generated from
Markdown that also has to read well on Codeberg/GitHub. The bundled ISF
materials live next to their pages:

```
modules/fx/isf-filter/library/kaleidoscope/
├── README.md          <- rendered by Docsify and by Codeberg
├── kaleidoscope.fs    <- the shader source
└── _cover.png
```

A plain link to the `.fs` file is the only form that works everywhere: on
Codeberg it opens the source file, in a Docsify page it previously did
nothing useful (or routed to a 404). The goal is to keep exactly one Markdown
form:

```md
[Kaleidoscope](./kaleidoscope.fs)
```

and make it render an interactive, editable WebGL view on Docsify while
staying a file link everywhere else.

## 2. Scope and references

Official specification and documentation used for the implementation:

- ISF 2.0 spec — <https://github.com/mrRay/ISF_Spec>
- ISF reference docs — <https://docs.isf.video/> (`ref_json`, `ref_variables`,
  `ref_functions`, `ref_multipass`)
- Reference WebGL host (behaviour cross-check) —
  <https://github.com/msfeldstein/interactive-shader-format-js>
- The repository's own ISF engine (`modules/src/isf-source/isf/`) for the
  header dialect observed in the shipped corpus.

**In scope (v1):** ISF v2 metadata, all input types, `IMG_*` functions,
multi-pass with `TARGET`/`PERSISTENT`/`FLOAT`/size equations, `IMPORTED`
textures, generated or paired `.vs` vertex shaders, the v1 `vv_*` aliases, the
built-in uniforms (`RENDERSIZE`, `TIME`, `TIMEDELTA`, `DATE`, `FRAMEINDEX`,
`PASSINDEX`, `isf_FragNormCoord`).

**Out of scope (v1):** MadMapper-only extensions that are not ISF
(`materialColorForPixel`, `GENERATORS`, laser materials), live camera/mic
capture, geometry/3D textures, GPU-accelerated 16/32-bit image inputs, and any
desktop GLSL feature WebGL rejects.

## 3. Link conversion

### 3.1 Detection

After every Docsify render (`hook.doneEach`), anchors under `.content` are
scanned. A link is eligible when:

- its URL (after stripping a leading `#`, query and fragment) ends in one of
  `config.extensions` (default `fs`), and
- it is not `mailto:`/`tel:`/`javascript:`/`data:`/`blob:`.

`#/modules/.../x.fs` (Docsify's rewritten hash route) and `./x.fs` both work.
Anchors already processed carry `data-isf-processed`, and anchors inside an
existing `.isf-block` are skipped.

### 3.2 URL resolution

`resolveAssetUrl(href, routePath)`:

| Input | Result |
|---|---|
| `https://…/x.fs` | unchanged |
| `#/modules/a/b.fs` | `baseURI` + `modules/a/b.fs` |
| `/modules/a/b.fs` | `baseURI` + `modules/a/b.fs` |
| `../a.fs` + route `/x/y/` | `baseURI` + `x/a.fs` |

The route directory is derived from `vm.route.path`/`vm.route.file` (falling
back to the location hash), stripped of a trailing `README.md`/`index.md`, so
Docsify's `relativePath` rewriting and untouched relative links both resolve.

### 3.3 Legacy sibling fallback

The historical generator wrote `[file.fs](../file.fs)` from
`library/<slug>/README.md`, which resolves to `library/<slug>.fs` while the
actual file is `library/<slug>/<slug>.fs`. `resolveCandidates()` therefore
returns the resolved URL **and** `routeDir + basename(url)`. The loader tries
them in order and keeps the URL that answered, so both the old and the fixed
Markdown work. The generator itself was corrected separately
(`scripts/library-docs.lua`), but the fallback stays for already-deployed
copies.

### 3.4 Insertion modes

- `mode: "replace"` (default): the anchor is replaced by the viewer block; the
  block header carries a source link to the resolved file.
- `mode: "augment"`: the anchor stays (opened with `target="_blank"`) and the
  viewer is inserted after it.

Plain Markdown hosts never run the plugin, so the same file renders as a
normal link there.

## 4. Metadata parsing

ISF headers are “JSON with comments and habits”. The parser is a small
recursive-descent reader (`parseJSONTolerant`) rather than `JSON.parse` plus
regex surgery, because comments can contain characters that would otherwise
need escaping and strings can contain `//`.

Tolerated by design:

| Dialect | Example |
|---|---|
| line/block comments | `"ISFVSN": "2", // version` |
| nested block comments | `/* see /* inner */ here */` |
| trailing commas | `[ …, ]` and `{ …, }` |
| single quotes | `'2'` |
| bare keys | `ISFVSN: 2` |
| leading/trailing dot numbers | `.5`, `360.` |
| hex numbers | `0x1f` |
| unknown escapes | `"a\Mb"` → `aMb` |
| `NaN` / `Infinity` | accepted as numbers |
| a leading non-header comment | `/* ported from … */` before `/*{…}*/` |

`scanBlockComments()` finds comments with a nesting counter, so an inner
`/* … */` inside the header does not truncate it. The first comment whose
content matches a known ISF key (`INPUTS`, `ISFVSN`, `PASSES`, …) and parses
is the header; otherwise the first parseable object comment is used; otherwise
the parse error is reported with a **file line/column** computed from the
comment start offset.

`parseISF()` returns `{ valid, metadata, body, bodyStart, bodyStartLine }`.
`bodyStartLine` is the raw-file line of the first body character and is the
basis for compile-error mapping (§7.4).

## 5. GLSL translation

The fragment body is rewritten with a token stream (`tokenizeGLSL`) that marks
comments, strings and preprocessor lines, so rewrite rules never touch text
inside a comment or string. The translation is textual and applied to the
token stream, not with naive regexes, which makes nested parentheses,
`#define`-wrapped calls and comma-separated expressions correct.

### 5.1 Built-in prologue

The generated fragment shader always declares:

```glsl
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float; precision highp int;
#else
precision mediump float; precision mediump int;
#endif
uniform int PASSINDEX;      uniform vec2 RENDERSIZE;
uniform float TIME;         uniform float TIMEDELTA;
uniform int FRAMEINDEX;     uniform vec4 DATE;
varying vec2 isf_FragNormCoord;
```

then one uniform per input and, per image (input, pass target, import):

```glsl
uniform sampler2D <name>;
uniform vec2 _<name>_imgSize;
```

### 5.2 `IMG_*` mapping

| Call | Replacement |
|---|---|
| `IMG_NORM_PIXEL(img, c)` | `texture2D(img, c)` |
| `IMG_PIXEL(img, c)` | `texture2D(img, (c) / _img_imgSize)` |
| `IMG_THIS_PIXEL(img)` | `texture2D(img, gl_FragCoord.xy / _img_imgSize)` |
| `IMG_NORM_THIS_PIXEL(img)` / `IMG_THIS_NORM_PIXEL(img)` | `texture2D(img, isf_FragNormCoord)` |
| `IMG_SIZE(img)` | `_img_imgSize` |

`img` must be a declared image uniform; anything else is reported as an
unresolved call with its file line instead of producing a cryptic compile
error. HTML images/FBO targets are uploaded with `UNPACK_FLIP_Y_WEBGL` so
`isf_FragNormCoord` keeps the ISF bottom-left origin; pass targets are
sampled directly and stay in the same space.

### 5.3 Inputs and passes

`normalizeInputs()` canonicalises `TYPE` (case-insensitive; `int` → `long`,
`audioFFT` alias) and produces defaults, ranges and enum values. `long`
supports both numeric `VALUES` and MadMapper-style string `VALUES`/`LABELS`,
including `DEFAULT` given as a label or as an index.

`normalizePasses()` applies the spec defaults (`$WIDTH`, `$HEIGHT`, no target,
non-persistent, byte buffer) and keeps `PERSISTENT`, `FLOAT`, `WIDTH`,
`HEIGHT`. `normalizeImports()` accepts the spec map, `{name: "path"}` and the
MadMapper array form.

### 5.4 Size equations

`WIDTH`/`HEIGHT` are evaluated by `evalExpression()`, a small recursive-descent
evaluator (no `eval`) supporting numbers, `+ - * / % ^`, parentheses, `$WIDTH`,
`$HEIGHT`, input names as `$name`, and the function subset used by the corpus
(`floor`, `ceil`, `round`, `min`, `max`, `abs`, `pow`, `sqrt`, `mod`, `fract`,
`clamp`, `mix`, `step`, `smoothstep`, trig, `length`, …). An unsupported
expression warns once and falls back to the destination size.

### 5.5 Vertex shaders

The default vertex shader defines `isf_position`, computes
`isf_FragNormCoord = gl_Position.xy * 0.5 + 0.5` and calls
`isf_vertShaderInit()` from `main()`. When `vertexShader: "auto"`, the loader
probes the same base name with `.vs`; if it exists, its `main()` is spliced
into the same skeleton (with `vv_vertShaderInit`/`vv_FragNormCoord` aliased).
The probe 404 is expected and silent.

## 6. WebGL runtime

### 6.1 Context

`webgl2` preferred, `webgl`/`experimental-webgl` fallback, with
`antialias:false`, `depth:false`, `stencil:false`, `alpha:true`,
`preserveDrawingBuffer:false`. GLSL ES 1.00 is emitted in both cases.
Float FBO support is probed with a real `checkFramebufferStatus` on a 4×4
float texture in `detectFloatRenderable()`; without it a `FLOAT` pass silently
degrades to bytes (with a warning in the status bar).

### 6.2 Geometry and passes

One buffer holds a fullscreen triangle (`-1,-1 3,-1 -1,3`). Each `PASSES`
entry with a `TARGET` owns a `PassBuffer`:

- two textures (ping-pong) + one FBO,
- `readTexture()` is bound as the sampler, `writeTexture()` is attached as
  `COLOR_ATTACHMENT0`, then `flip()`,
- sizes come from the evaluated equations, clamped to `MAX_TEXTURE_SIZE`.

A pass without a target renders to the default framebuffer. If the final pass
wrote to a target, a tiny paint program copies it to the canvas. `PASSINDEX`,
`RENDERSIZE` and every `_img_imgSize` are set per pass; `TIME`, `TIMEDELTA`,
`DATE`, `FRAMEINDEX` once per frame. `event` inputs are true for exactly one
frame (`runtime.events` is cleared after the pass loop).

### 6.3 Images and audio

- `image` inputs get a 512×512 canvas test pattern (two variants, `endImage`
  gets the B pattern), the `imageUrl` config, or a user file (button / drag &
  drop). The canvas is uploaded once and re-uploaded when replaced.
- `IMPORTED` paths are resolved against the **answering** `.fs` URL and loaded
  with `crossOrigin="anonymous"`.
- `audio`/`audioFFT` receive a synthetic 1×N byte texture updated every frame
  (waveform / spectrum), so shaders keep animating without a microphone.

### 6.4 Frame loop

One `requestAnimationFrame` loop per live viewer:

- skip entirely when `viewer.visible` is false or `document.hidden`,
- `TIME` advances only while playing, capped at 100 ms per frame,
- paused viewers still draw once when `needsRender` is set by a parameter,
  editor or resize change,
- the badge is updated twice a second with `fps · WxH · N passes`.

### 6.5 Sizing

The backing store is `cssSize × scale`, where `scale` is either the fixed
`resolution` multiplier or `min(devicePixelRatio, maxPixelRatio)` in `auto`
mode, clamped to `MAX_TEXTURE_SIZE`. The canvas resizes in `draw()`, so
fullscreen and layout changes need no extra observer.

## 7. User interface

### 7.1 Block anatomy

```
.isf-block
├── .isf-header    title (source link) + params/editor/play/reset/fullscreen/source
├── .isf-body
│   ├── .isf-stage  canvas, overlay (loading/error/released), fps badge
│   └── .isf-side   .isf-params and .isf-editor panels
└── .isf-status     warnings / errors / info
```

Panels start collapsed according to `params: auto|open|closed` (auto opens up
to `paramsOpenLimit` inputs). At ≥900 px viewport width the side panel sits
next to the render; in fullscreen it becomes an overlay drawer.

### 7.2 Controls

| ISF type | Control |
|---|---|
| `float` | range + exact number field |
| `bool` | checkbox |
| `long`/`int` | `<select>` for `VALUES`/`LABELS`, number field otherwise |
| `event` | momentary “Trigger” button |
| `color` | colour input + alpha slider (RGBA uniform) |
| `point2D` | two axis sliders with min/max arrays |
| `image` | “Choose image…” file picker + drag & drop |
| `audio`/`audioFFT` | synthetic-source indicator |

Double-clicking a parameter row resets it to the metadata default.

### 7.3 Editor

The editor is a `<textarea>` over a highlighted `<pre><code>` layer (the
Prism-Live/react-simple-code-editor approach) with a line-number gutter. It is
dependency-free; `highlightGLSL()` classifies tokens as
comment/preprocessor/string/number/keyword/type/builtin/ISF/operator.

- Tab/Shift+Tab indent and dedent; Ctrl/Cmd+Enter or **Apply** compiles;
  **Revert** restores the fetched file; **Copy** copies the buffer.
- `editorLive` recompiles after `editorDebounce` ms of inactivity.
- The caret/text are transparent, selection and caret stay visible; scroll is
  mirrored to the highlight layer and gutter.

### 7.4 Error mapping

`buildShader()` records `preludeLines` (lines inserted before the user body)
and `bodyStartLine` (raw-file line of the body). A WebGL log line `0:L` maps
back with

```
rawLine = bodyStartLine + (L - preludeLines - 1)
```

so compile errors point into the original `.fs` file; the editor scrolls to and
highlights that gutter line. Header errors already carry a file line from the
tolerant parser. Errors never blank an existing render: `compile()` swaps the
program only after a successful link.

## 8. Performance and GPU context budget

Browsers cap the number of live WebGL contexts; the docs intentionally embed
many shaders. `BUDGET` (default `maxContexts: 8`) therefore owns every
context:

1. `initRuntime()` calls `BUDGET.acquire(viewer)`.
2. If full, the worst candidate is evicted — non-visible before visible,
   then least-recently-used. The victim deletes its program/buffers/textures
   and calls `WEBGL_lose_context.loseContext()`.
3. If there is still no room, the requester is queued and shows a “waiting for
   a GPU context” overlay; `BUDGET.pump()` revives the queue 250 ms after a
   release.
4. Released viewers keep their parsed shader and parameter values, so resuming
   is a rebuild, not a re-fetch.

Intersection observers with a 240 px margin start lazy viewers and pause
offscreen rendering; a released viewer resumes automatically when scrolled
back into view or on click.

## 9. Robustness and security

- No `eval`/`new Function`; the only expression engine is the small parser.
- All generated HTML passes through `escapeHtml` (error messages, titles,
  overlay content).
- Fetches use same-origin credentials and plain `fetch`; failures degrade to a
  readable message plus the source link, never a silent blank.
- CORS: cross-origin `.fs` and imported images must be CORS-enabled because of
  WebGL's texture rules; otherwise a warning/overlay is shown.
- The plugin does not write cookies/storage and never modifies the Markdown
  source.

## 10. Configuration

All options live under `window.$docsify.isf`; the reference table is in
[README.md](README.md#configuration). The most important ones:
`mode`, `lazy`, `params`, `editor`, `editorLive`, `maxContexts`,
`maxPixelRatio`, `resolution`, `vertexShader`, `imports`.

## 11. Testing strategy

| Layer | File | What it proves |
|---|---|---|
| Unit | `tests/run.js` | tolerant JSON (comments, trailing commas, quotes, escapes, leading comments), expression evaluator, `IMG_*`/`vv_*` rewriting (nesting, comments, `#define`), shader assembly (uniforms, passes, `#version`, line mapping), highlighting/escaping, URL resolution/fallback, link detection |
| Self-test | `tests/run.js` | every link in `README.md` points at a committed `samples/*.fs`; every sample parses and assembles with no unresolved images |
| Corpus | `node tests/run.js --corpus` | all 758 bundled `.fs` materials parse and assemble cleanly |
| Browser | `tests/browser-smoke.mjs` | headless Chrome: 10 viewers get a WebGL context and controls, positive samples reach a non-error state, negative samples show mapped errors, the editor opens and highlights, a released viewer resumes via the budget, no unexpected console errors |

`npm test` runs the unit/self-test layer; `npm run test:smoke` the browser
layer (skips with a message when Chrome or puppeteer-core is unavailable).

## 12. Limitations and future work

- **GLSL ES 1.00 only.** Desktop GLSL constructs that WebGL 1 rejects
  (dynamic array indexing, non-constant loop bounds, `texture2DProj`, 3D
  textures) fail with a compile error. The corpus coverage is measured in
  `docs/isf-status.md` for the OBS engine; the browser viewer is intentionally
  narrower.
- **No live media.** Camera/microphone inputs, video textures and real FFT
  capture are not wired; audio is synthesised.
- **Vertex attributes.** Only `isf_position` exists; shaders needing more
  attributes cannot run.
- **Cross-origin assets** need CORS.
- Future: WebGL2 GLSL ES 3.00 transpilation for the dynamic-indexing family,
  `requestVideoFrameCallback` video inputs, `<input type=range>` keyboard
  accessibility pass, per-link option overrides, CodeMirror adapter.

## 13. File map

```
docsify-plugins/docsify-isf/
├── docsify-isf.js        single-file plugin (UMD, no dependencies)
├── index.html            Docsify self-test host
├── README.md             feature gallery / self-test / configuration
├── SDD.md                this document
├── samples/*.fs|.vs|.png self-test shaders, covers every feature
├── tests/run.js          Node unit + sample tests
├── tests/browser-smoke.mjs headless Chrome end-to-end test
├── package.json          npm test scripts + puppeteer-core dev dependency
└── LICENSE               MIT
```
