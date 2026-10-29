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
  both persisted, the **time scrubber**, **Randomize** (constraint-respecting)
  and **Export PNG** live in the parameters drawer.
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
.isf-block
├── .isf-header    host fallback (title + actions, removed after PUI mounts)
│   └── .isf-pui-header  PUI toolbar: title + ISF chip, stats readout,
│                        editor/params/play/fullscreen/share, More menu
├── .isf-body
│   └── .isf-stage  canvas, overlay (loading/error/released), fps badge
│       ├── .isf-drawer-left   editor + import panel (overlay, translucent)
│       └── .isf-drawer-right  parameters (overlay, translucent)
└── .isf-status     PUI statusbar (host warnings / errors / info)
```

The native fullscreen button (or a canvas double-click) puts the block in
`requestFullscreen`; the `:fullscreen` rules make it fill the viewport. When
the PUI assets are loaded the header is hidden and a PUI **non-modal top
drawer** (`side:"top"`, `modal:false`, trigger "Controls", **H**) carries the
toolbar actions (Source editor, Parameters, Play/Pause, Reset, Exit
fullscreen, Open source, Copy OBS link). The trigger sits at the top centre,
hides while its panel is open and, on narrow fullscreens, while a side drawer
covers the top edge; the Editor/Parameters actions close the top drawer so the
side drawer header stays accessible. Escape closes it and the stage gets the
whole height. Without PUI the header stays as the fallback. The
Resolution/Scale cap still applies, so fullscreen does not silently quadruple
the pixel cost.

Below/over the canvas sit two **overlay drawers**: code on the left, the
parameters on the right. They never resize the render — the canvas keeps its
full size underneath — and they use a translucent, backdrop-blurred
background so the shader stays visible. They start closed according to
`params: auto|open|closed` (auto opens up to `paramsOpenLimit` inputs).
`width`, `height` and `aspectRatio` size the preview (`aspectRatio` wins over
`height`), and the block is capped at `width` when it is not `100%`.

| Drawer | Toggle | Handle | Keys | Reset | Persisted |
|---|---|---|---|---|---|
| Code (left) | `</>` in the toolbar / Ctrl-Cmd+B | rail on its right edge | ←/→ (Shift = ×4), Home/End | double-click | `leftWidth` in `docsify-isf:layout` |
| Parameters (right) | sliders button in the toolbar / Ctrl-Cmd+K | rail on its left edge | ←/→, Home/End | double-click | `paramsWidth` |
| Editor height | — | rail above the editor | ↑/↓, Home/End | double-click | `editorHeight` |
| Editor toolbar | chevron / Ctrl-Cmd+Shift+B | — | — | — | `editorToolbar` |

Drawers are opened from the top-bar buttons only (there are no lateral tabs);
the buttons keep `aria-pressed`/`aria-expanded` in sync with the drawer state
and the panels' × buttons. Widths are clamped to 240 px…64 % of the stage for
a single drawer and 46 % when both are open (two drawers always leave the
render visible), the editor height to 120 px…85 vh. On viewports up to 600 px
narrow each drawer takes the full stage, opening one closes the other, and the
horizontal resize rails are hidden. The editor toolbar folds to a single row
(a chevron button or Ctrl-Cmd+Shift+B) showing `Fragment/Vertex · status`; the
code pane grows by exactly the height the hidden rows occupied, and the state
is persisted with the rest of the layout. Handles are
`role="separator"` with `aria-orientation`; persistence is opt-out via
`persistLayout: false`. The drawer scrolls its own `.isf-drawer-inner`, so the
rail never scrolls away. In fullscreen the drawers stay as overlays over the
full-viewport render; on narrow screens they take nearly the full width and
the rails are hidden.

### 7.2 Controls

The parameter inspector is a **Pupitre UI (PUI)** document generated from the
normalised `INPUTS` by the vendored ISF adapter (`vendor/pupitre-ui/isf.js`)
and rendered by the shared `vendor/pupitre-ui/pupitre-ui.js` renderer. Both
assets are loaded only when the first viewer needs controls, so a Docsify page
without shader viewers does not pay the PUI download cost. `puiBase` can point
at another asset location; if the assets cannot load, the drawer shows a
diagnostic with Retry while the shader keeps rendering. The
drawer is an **embedded** PUI panel (`embedded: true`): it carries no panel
header or implicit titles, uses the viewer's `--isf-*` theme tokens through a
small CSS bridge, and stacks labels above controls when the drawer is narrow
(a container query, not a viewport breakpoint). PUI owns the widget
behaviour, reset affordance, a11y and focus handling; the plugin owns values,
clamping, media and events. PUI is the only parameter/actions renderer: the
code editor and stage canvas stay host surfaces (a code editor is
engine-specific, like a canvas); the main header is a PUI `toolbar` (the host
title/actions are its fallback until it mounts); the status line is a PUI
`statusbar` block, with a plain-text fallback until the on-demand assets
load.

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

The parameter inspector is one PUI surface. Its header, shader description/
credit/categories intro and floating card frame are host chrome; the fields
are PUI. The plugin-owned view row (a **View** selector for pass targets, a
**Resolution** preset and a **Scale** multiplier persisted with the layout, the
**Time** scrub and **Randomize** / **Export PNG**) is mounted as a PUI **host
block** (`isf.view`, registered with `ui.registerBlock`) in the **last** section,
after the parameter fields: render settings are secondary to the controls that
define the look. While the on-demand assets load (or if they fail), the row
stays a sibling of the panel. The view row uses PUI's control target sizes and
palette. The
global status line is a third PUI surface: a `statusbar` block bound to
`/isf/status` with `tone_bind` (`/isf/statusTone` → info/success/warning/error),
kept live by `viewer.setState()` → `ui.apply()` (the outer `.isf-status`
region announces; the PUI bar's own live region is off to avoid double
announcements). The plain-text fallback keeps load/compile errors visible
before the assets arrive. Docsify's theme styles `output` as a code block, so
the PUI bridge resets `output` paddings/margins inside `.isf-pui`; that also
fixes PUI readout values in the parameter drawer.

Transient action feedback (copy link, reset, export, randomize, microphone)
goes to a fourth PUI surface: a body-level `toast` stack. `viewer.notify(level,
text)` pushes bounded `{id,text,level}` notices, auto-dismisses after 4.2 s and
removes them through the dismiss action; the stack is shared by all viewers and
cleared with the page instances. When PUI is unavailable the message falls
back to the status line.

The main header is another PUI surface: a `toolbar` block built once the
normalised inputs are known. It carries the source-link title and an ISF chip,
the live FPS/size `readout`, and grouped icon actions. Editor, parameters,
play, fullscreen and share stay visible; reset and the source link live in a
`kind:"menu"` More item. Drawer and fullscreen `pressed_bind`s reflect the host
state, the parameters action carries the input-count badge, and play swaps its
label and icon through the adapter. Every action calls back into the viewer;
icon-only actions keep an `aria-label` and a native `title` tooltip, and the
stats readout carries `a11y.name: "Render statistics"`. The host
title/actions/stats badge are removed after a successful mount and remain as
the fallback before the assets arrive or if the toolbar fails; the toolbar is
refreshed when a source reload changes the available inputs.

The fullscreen toolbox is another PUI surface: a floating top, non-modal
`drawer` block holding a native PUI `toolbar` block, whose `open_bind` maps to
`viewer.toolbarOpen`. Opening it closes any side inspector, so the Controls
card and the parameters/editor card never overlap; the host block boundary only
applies to the editor/stage themselves.

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
| Browser | `tests/browser-smoke.mjs` | headless Chrome: 10 viewers get a WebGL context and controls, positive samples reach a non-error state, negative samples show mapped errors, the editor opens, highlights, reports `Ln x, Col y`, shows the active line, closes from its × button, the editor and side panes resize from the keyboard and persist, an out-of-range typed parameter clamps to `MAX`, transition progress animates, a released viewer resumes via the budget, the Shadertoy importer converts/applies/reverts and the pointer extension compiles, the vertex tab applies, Ctrl+/ comments and Ctrl+= zooms, the View/Resolution/Scale/Export controls work, the default buffer is capped at SD (aspect preserved), the main header is a PUI toolbar whose icon actions open the drawers/editor, expose pressed states and the input-count badge, drive play/reset/fullscreen/share, and expose an accessible name on the stats readout; fullscreen hides the header and opens the non-modal PUI Controls drawer (top, no backdrop, H/Escape, actions, exit, header returns), HD is selectable/persisted/cleared by Default, the share URL carries values + resolution + scale, the bare OBS URL honours `isf-res`, reset returns to the shader defaults, the status line is a PUI statusbar with a tone and no docsify `output` box styling, and transient actions use a dismissible PUI toast stack, structural PUI re-renders keep focus on the same item hook, the editor Templates picker is a PUI menu with a native fallback, no unexpected console errors |

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
  `docsify-isf.js` (or set `isf.puiBase`); the drawer shows a diagnostic with
  Retry if they cannot load. There is no second parameter renderer.
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
