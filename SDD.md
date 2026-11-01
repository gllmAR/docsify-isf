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

### 5.6 Shadertoy / GLSL Sandbox importer

`convertToISF()` mirrors the official ISF Editor's converter:

| Source | Mapping |
|---|---|
| Shadertoy | `iTime`/`iGlobalTime`, `iChannelTime[n]`→`TIME`; `iTimeDelta`→`TIMEDELTA`; `iResolution`→`RENDERSIZE`; `iFrame`→`FRAMEINDEX`; `iDate`→`DATE`; `iChannelResolution[n]`→`IMG_SIZE(iChannelN)`; `textureLod`/`textureGrad`/`texture`→`texture2D`; `texelFetch`→`IMG_PIXEL`; used `iChannelN` become image inputs; the body is wrapped with `void main(){ mainImage(gl_FragColor, gl_FragCoord.xy); }` |
| GLSL Sandbox | `time`→`TIME`; `resolution`→`RENDERSIZE`; `mouse`→`_isfMouse.xy`; environment `uniform` declarations that collide with ISF built-ins are removed |
| Either | a fresh `/*{ … }*/` metadata block (credit, ISFVSN 2, `Converted` category, generated `INPUTS`); already-ISF sources are refused with an explanation |

`iMouse` is mapped to the **docsify-isf pointer extension**: the fragment
prelude always declares `uniform vec4 _isfMouse` and the runtime feeds it from
pointer events with Shadertoy semantics (`xy` position in pixels, origin
bottom-left; `zw` click position; `z` negative while the button is up).
Imported shaders are therefore interactive without an input control, and
`.xy`/`.zw` both work.

### 5.7 Pass preview, quality and export

`runtime.previewTarget` makes the paint program blit any pass target instead
of the final output (the official editor's per-pass debug view); the
parameters panel builds a `View` selector whenever the shader has targets.
`runtime.qualityScale` overrides the render multiplier (Auto/1×/0.5×/0.25×/2×)
and `runtime.snapshot()` draws synchronously and returns a PNG data URL in
canvas/display orientation (the orientation OBS covers use) for
the export button.

### 5.8 Compatibility layers

The body goes through a sequence of increasingly permissive transforms; each
later one only runs when the previous compile attempts failed, so a shader
that already works is never rewritten:

| Layer | What it does |
|---|---|
| ES 1.00 | the assembled shader |
| WebGL2 / ES 3.00 | `#version 300 es` + macros (`varying`→`in`, `texture2D`→`texture`, `gl_FragColor`→`_isfFragColor`); enables dynamic indexing and non-constant loops |
| Dialect rewrite | HLSL/MadMapper aliases (`saturate`, `frac`, `lerp`, `rsqrt`, `ddx`, `ddy`) and original-name → ported `mm_*` renames (`fill`→`mm_fill3/4`, `circle`→`mm_circle2/3`, the `fBm`/`ridgedNoise`/`flowNoise`/derivative noise families, …), resolved by dimension/arity/swizzle and shadowed by user-defined names; dialect type keywords (`long`, `uint`, `float2`, `uvec2`, …) are normalised and user functions shadowing GLSL built-ins (`sign`, `round`, `distance`) are renamed when not guarded out by `#ifndef GL_ES` |
| Overload shims & prototypes | forward prototypes for every user function (call-before-definition helpers) plus all-float and single-parameter float shims for every function declared with `int` parameters, so promoted calls still resolve; bare int arguments at int-parameter positions and `out`/`inout` int parameters are protected from floating |
| Literal promotion | scope-aware: each line sees only the int/float names of its lexical scope (the corpus reuses `i`/`p` across functions), integer literals in float contexts become floats (`TIME * 2` → `TIME * 2.0`), int identifiers/`int()` casts and `ivec` fields are floated per context, `long`/`int` inputs and `generate_as_define` inputs are seeded, `%` expressions and `mm_*`/builtin call arguments are coerced, integer-only lines, array indices, cast arguments, int comparisons/initialisers and bitwise contexts are left alone |

Besides those, `buildShader`/the loader implement:

- **`#include "file.glsl"`** — `collectIncludes()` finds them, the loader fetches
them relative to the `.fs` file and then from `config.includePaths` (recursive,
cycle-safe); `expandIncludes()` inlines them. Missing includes become comments
and warnings.
- **MadMapper** — `materialColorForPixel()` gets a generated `main()`;
non-constant global initialisers are hoisted into the entry point; `GENERATORS`
(`time_base`, `incrementer`, `pass_thru`, `multiplier`, `linear_filter`,
`damper`, pass-through easing/animator/adsr) are evaluated CPU-side every frame
and bound as uniforms.
- **Legacy helpers** — `_<image>_imgRect` / `_<image>_flip` are declared and
set next to `_<image>_imgSize` for shaders ported from the reference JS host.

Measured against the bundled library after the include/generator/dialect work
(`npm run test:coverage`): every material in the bundled library compiles —
ES 1.00 natively, GLSL ES 3.00 or ES 3.00 with literal promotion otherwise
(the exact split depends on the corpus, currently ~413/67/396 of 876) —
filters, transitions and sources all at 100 %.

### 5.9 Live controls and media

- **Resolution** (Default/SD/HD/FHD/Native) and **Scale** (0.25×–2×/auto),
  both persisted, the **inspector transport** (play/seek), **Randomize** (constraint-respecting)
  and **Export PNG** live in the Parameters tab.
- **Microphone** capture for `audio`/`audioFFT` inputs (`getUserMedia` +
  `AnalyserNode`, time-domain and FFT data resampled to the declared `MAX`),
  with the synthetic source as fallback.
- **Drag & drop** an image onto the preview fills `inputImage` (or the first
  image input).
- The error overlay lists every compiler message with click-to-line; a
  shortcut overlay documents the keyboard map.

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
- Image textures upload with `UNPACK_FLIP_Y_WEBGL` so `v=0` is the image
  bottom: `isf_FragNormCoord` is bottom-left (ISF), so
  `IMG_NORM_PIXEL(image, isf_FragNormCoord)` is upright on the canvas, matching
  the reference ISF-JS-Renderer. `_<image>_flip` stays 0.
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
mode. It is then capped to the `maxResolution` preset (`sd` 854×480,
`hd` 1280×720, `fhd` 1920×1080, `native` no cap) by lowering `scale` uniformly,
so the aspect ratio never changes; the browser upscales the buffer to the CSS
size. The default is `sd`, which keeps retina and 4K fullscreen viewers cheap.
The canvas resizes in `draw()`, so fullscreen and layout changes need no extra
observer. `maxResolution` comes from the Resolution menu (stored in the layout),
the URL `isf-res` flag, or the document config (in that precedence).
`isf-quality` overrides the Scale multiplier the same way. The Resolution
menu's **Default** clears the stored override and returns to the site config.

## 7. User interface

### 7.1 Block anatomy

```
.isf-block.isf-workbench-mode
└── .isf-workbench                    PUI workbench, fills the sized block
    ├── .pui-workbench-toolbar
    │   ├── title + ISF description + collapse control
    │   ├── Header menu (fullscreen/reset/randomize/export/share/help/source)
    │   └── Source | Parameters | Playback pane toggles
    ├── .pui-workbench-body
    │   ├── left Source pane      host editor + import custom slots
    │   ├── stage pane            .isf-stage (canvas + loading/error overlay)
    │   └── right Parameters pane Parameters | View | Log tabs
    │       ├── Parameters        PUI fields generated from INPUTS
    │       ├── View              pass/scale/resolution/randomize/export
    │       └── Log               status/render/input/pass readouts/actions
    └── bottom Playback pane      PUI transport + PUI statusbar
```

`.isf-fallback` carries the same stage, the host header and the host status
until the PUI workbench is mounted, and stays as the error surface when the
header cannot be parsed. The workbench takes over document height once ready;
the fallback is removed.

The native fullscreen button (or a canvas double-click) puts the block in
`requestFullscreen`; the `:fullscreen` rules fill the viewport and keep the
workbench titlebar. Source and Parameters close when entering fullscreen;
reopen them from the titlebar, **Ctrl/Cmd+B** (Source) or **H** (Parameters).
**Escape** closes the active pane. Menu → **Exit fullscreen** leaves. The
Resolution/Scale cap still applies.

### 7.2 Workbench, titlebar and panes

The viewer is a PUI workbench page with named regions:

- **Source** left: the host GLSL editor and import surface, mounted through
  custom slots. It has its own compact title bar, splitter and fold control.
- **Preview** stage: the host WebGL canvas and overlay, `fit:contain`.
- **Parameters** right: a PUI tab set. **Parameters** renders the normalised
  `INPUTS`; **View** owns pass/scale/resolution/randomize/export; **Log** owns
  status/render/input/pass readouts and quick actions.
- **Playback** bottom: a native PUI `transport` bound to `/isf/transport`,
  followed by a PUI `statusbar` bound to status and render readouts.

The titlebar carries the shader title and ISF `DESCRIPTION` (plus credit when
present), a labeled collapse chevron and the function buttons. Collapsing
hides only the heading/title/description; the Menu, Source, Parameters and
Playback buttons remain. This is PUI 1.9.0's `layout.titlebar` contract; the
host only supplies the title/description and the page's workbench document.
The buttons are the show/hide controls for the Source and Parameters sections.

Panes are contextual: both start closed; the in-view viewer auto-opens
Parameters (`params:"auto|open|closed"`), never stealing another open
Parameters pane. Source opens via its button or Ctrl/Cmd+B. On wide screens
both side panes can coexist with the render between them; narrow screens turn
them into mutually exclusive overlays and give the stage the full width. PUI
persists pane widths/collapse state and the titlebar collapse state.

| Surface | Control | Keys | Persisted |
|---|---|---|---|
| Parameters pane | titlebar Parameters button / tab | H, Escape (fullscreen) | runtime + PUI width/collapse |
| Source pane | titlebar Source button / editor close | Ctrl-Cmd+B, Escape | runtime + PUI width/collapse |
| Title bar | collapse chevron | — | PUI localStorage |
| Parameters fields | PUI document | — | runtime values |
| Editor height | rail above the editor | ↑/↓, Home/End; double-click resets | `editorHeight` |
| Editor toolbar | chevron / Ctrl-Cmd+Shift+B | — | `editorToolbar` |
| Import | Import action | Escape returns to Source | — |
| Playback | bottom PUI transport | — | — |
| View/Log | Parameters pane tabs | — | PUI localStorage |

The Menu actions call back into the viewer. Only one Parameters pane is open
across viewers. The host pane-toggle listener mirrors PUI's state so host
shortcuts/fullscreen and PUI clicks agree. The right pane's View/Log tabs keep
the render settings and diagnostics out of the primary parameter flow.

### 7.2.1 PUI responsibilities

The parameter editor, Source/Parameters pane shell, titlebar, transport,
statusbar, toast stack and the workbench layout are PUI surfaces. PUI is loaded
on demand from `vendor/pupitre-ui/`; the host keeps the stage/header/status
fallback until it mounts and a diagnostic if it cannot. The PUI document is
embedded (no panel header/implicit titles), themed through the `--isf-*` CSS
bridge, and generated from the normalised ISF inputs by the vendored ISF
adapter. PUI owns widget behaviour, resets, a11y and focus handling; the host
owns values, clamping, media/events, the renderer and the editor.

The PUI document maps every normalised ISF input:

| ISF type | PUI control |
|---|---|
| `float`, controller types | `range` (range + exact number field) |
| `bool` | `switch` |
| `long`/`int` | `select` for numeric/label `VALUES`, `number` otherwise |
| `event` | momentary `button` |
| `color` | `color` + alpha percent (RGBA, edited as `#RRGGBBAA`) |
| `point2D` | two per-axis ranges (`…/x`, `…/y`) |
| `floatRange` | two per-axis ranges (`…/min`, `…/max`) |
| `image` | “Choose image…” action + drag & drop on the stage |
| `audio`/`audioFFT` | source readout + one microphone action for all audio inputs |
| `generate_as_define` | read-only readout (the shader already baked the value) |

Reset is PUI's per-field reset button (shown when the value differs from the
metadata default) and double-clicking a row still resets it. Every value path
(`setParameter`, controls, API callers, restored state) goes through
`clampInputValue()`, so `MIN`/`MAX` are respected for `float`, `long`/`int`
and both `point2D` axes, `color` stays in 0…1, and `long` values snap to the
declared `VALUES`.

The View controls are host widgets mounted in the right **View** tab. The host
builds pass target, Resolution, Scale, Randomize and Export PNG; PUI owns the
tab and scroll/focus semantics. The **Parameters** tab's shader
description/credit is carried by the titlebar, not duplicated in the pane. Time
is not in the View row: the bottom PUI `transport` owns play/pause/stop and
shader-time seek. The host adapter maps intents to the ISF clock; loop and rate
are reported unsupported. `viewer.updateBadge()` calls the workbench `apply()`
so the transport time and status readouts follow the clock without rebuilds.

The bottom statusbar is a PUI `statusbar` block bound to `/isf/status` with
`tone_bind` (`/isf/statusTone` → info/success/warning/error), kept live by
`viewer.setState()` → `ui.apply()`. Transient feedback goes to the shared
body-level PUI `toast` stack. When PUI is unavailable the plain host status
line remains.

The titlebar and pane toggles are PUI workbench controls. The host sets
`layout.titlebar` with the page title/description; PUI renders the heading,
collapse control and function buttons. Pane toggles carry
`aria-expanded`/`aria-controls`; the host mirrors their clicks into its
`inspectorOpen`/`editorOpen` state and enforces the one-open Parameters rule.
Icon-only controls keep `aria-label`/`title`. The main header, floating
overlay, drawer heads and the old fullscreen hint are gone; the workbench
toolbar owns the title and controls.

### 7.3 Editor

The editor is a `<textarea>` over a highlighted `<pre><code>` layer (the
Prism-Live/react-simple-code-editor approach) with a line-number gutter and an
absolutely positioned active-line marker. It is dependency-free;
`highlightGLSL()` classifies tokens as
comment/preprocessor/string/number/keyword/type/builtin/ISF/operator.

- Enter auto-indents (current indentation, plus one level after an opening
  bracket); Tab/Shift+Tab indent and dedent the selection; Ctrl/Cmd+Enter or
  **Apply** compiles; **Revert** restores the fetched file; **Copy** copies
  the buffer. Indentation follows `editorIndent`.
- **Fragment/Vertex tabs**: a fetched `.vs` lands in the Vertex tab; an empty
  Vertex tab prefills `VERTEX_STARTER` and becomes the applied vertex shader.
  `buildShader()` returns `vertexLineMap`, so vertex compile errors switch to
  that tab and highlight the right line.
- **Shortcuts**: Ctrl/Cmd+Enter or Ctrl/Cmd+S apply, Ctrl/Cmd+/ toggles
  comments, Ctrl/Cmd +/-/0 zooms (persisted), Enter auto-indents, Tab indents.
- **Templates menu**: a PUI `menu` block in the editor toolbar inserts
  `INPUTS` snippets (float, bool, color, point2D, event, long, image,
  audioFFT) at the caret or replaces the buffer with a starter
  generator/filter/transition/multi-pass shader. The native select is only the
  fallback until the toolkit assets load.
- **Import** opens the Shadertoy/GLSL Sandbox paste box (5.6).
- `editorLive` recompiles after `editorDebounce` ms of inactivity and the
  status line reports the measured compile time.
- The gutter is rebuilt only when the line count or the error line changes;
  line height and padding are measured from the computed style (never
  assumed), so the active-line marker, error scroll and gutter stay aligned
  at any font size/zoom. The caret line/column is derived incrementally and
  shown as `Ln x, Col y`.
- The caret/text are transparent, selection and caret stay visible; scroll is
  mirrored to the highlight layer and gutter.

### 7.4 Error mapping and recovery

`buildShader()` records `preludeLines` (lines inserted before the user body)
and `bodyStartLine` (raw-file line of the body). A WebGL log line `0:L` maps
back with

```
rawLine = bodyStartLine + (L - preludeLines - 1)
```

so compile errors point into the original `.fs` file; the editor scrolls to and
highlights that gutter line. Header errors already carry a file line from the
tolerant parser. The overlay is actionable: **Open source**, **Fix at line N**
(closes the overlay and focuses the editor) and **Copy error**. Errors never
blank an existing render: `compile()` swaps the program only after a
successful link.

### 7.5 Accessibility and motion

The preview canvas is focusable and toggles fullscreen on Enter/Space or
double-click. Controls expose `aria-pressed`/`aria-expanded`/
`aria-controls`, panels are `role="region"` with labels, status regions are
`aria-live="polite"`, and all interactive elements use `:focus-visible`.
`prefers-reduced-motion: reduce` starts viewers paused and disables the
loading animation and transitions; coarse pointers get larger hit areas.

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
`maxPixelRatio`, `resolution`, `maxResolution`, `puiBase`, `vertexShader`,
`imports`.

## 11. Testing strategy

| Layer | File | What it proves |
|---|---|---|
| Unit | `tests/run.js` | tolerant JSON (comments, trailing commas, quotes, escapes, leading comments), expression evaluator, `IMG_*`/`vv_*` rewriting (nesting, comments, `#define`), shader assembly (uniforms, passes, `#version`, line mapping), highlighting/escaping, URL resolution/fallback, link detection |
| Self-test | `tests/run.js` | every link in `README.md` points at a committed `samples/*.fs`; every sample parses and assembles with no unresolved images |
| Corpus | `node tests/run.js --corpus` | all bundled `.fs` materials parse and assemble cleanly |
| Frames | `tests/frame-tool.mjs` | `renderFrame`/`compareFrames` are deterministic (byte-identical PNGs), time/inputs/steps/parent frames change the output, the MAE metric behaves, and strict mode fails above the threshold |
| Browser | `tests/browser-smoke.mjs` | headless Chrome: every viewer mounts the PUI workbench with Source left, Parameters right, Preview stage and Playback/status; the titlebar shows the shader title and ISF description and keeps its buttons when collapsed; Source/Parameters buttons show/hide the panes; the Parameters tabs expose Parameters/View/Log; the Menu drives reset/randomize/export/share/help/fullscreen/source; a real slider drag reaches the host; the editor opens in Source, highlights, reports the caret, applies, folds and inserts a template; View randomize and Log readouts work; the PUI transport plays/seeks; fullscreen keeps the workbench and fills the stage; only one Parameters pane is open across viewers; a budget-released viewer recovers; phones swap Source/Parameters/View as overlays; the OBS bare viewer reveals the full workbench; broken headers keep a visible fallback error; no unexpected console errors |

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
- **PUI assets are on-demand.** Deploy `vendor/pupitre-ui/` next to
  `docsify-isf.js` (or set `isf.puiBase`); the plain host fallback remains usable while the workbench reports the
  missing toolkit. There is no second parameter renderer.
- Future: WebGL2 GLSL ES 3.00 transpilation for the dynamic-indexing family,
  `requestVideoFrameCallback` video inputs, `<input type=range>` keyboard
  accessibility pass, per-link option overrides, CodeMirror adapter.

## 13. File map

```
docsify-plugins/docsify-isf/
├── docsify-isf.js        single-file plugin core (UMD, no dependencies)
├── index.html            Docsify self-test host
├── README.md             feature gallery / self-test / configuration
├── SDD.md                this document
├── samples/*.fs|.vs|.png self-test shaders, covers every feature
├── src/plugin.src.js     Docsify/WebGL/UI layer (the artifact source)
├── src/kernel-adapter.js compiler adapter over the vendored ISF core
├── vendor/isf-core/      vendored ISF compiler kernel + SOURCE.json
├── vendor/pupitre-ui/    PUI renderer, ISF adapter, CSS + SOURCE.json
│                         (loaded on demand next to the artifact, not bundled)
├── tools/build.mjs       injects both vendors into docsify-isf.js (--check)
├── tools/sync-pupitre-ui.mjs sync/verify the PUI snapshot
├── tests/run.js          Node unit + sample tests
├── tests/pui-params.test.js PUI document/adapter/vendor checks
├── tests/browser-smoke.mjs headless Chrome end-to-end test
├── package.json          npm test scripts + puppeteer-core dev dependency
└── LICENSE               MIT
```
