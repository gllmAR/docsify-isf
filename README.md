# docsify-isf

Docsify plugin that turns Markdown links to ISF (Interactive Shader Format)
files into interactive WebGL viewers with revealable parameter controls, a
syntax-highlighted live GLSL editor and fullscreen — **while the same Markdown
keeps working on Codeberg / GitHub / any plain Markdown host**, where the link
still opens the `.fs` file.

[![Live self-test](https://img.shields.io/badge/live-self--test-d374d6)](https://gllmar.github.io/docsify-isf/)

```
[name of the shader](./path-to-isf.fs)
```

becomes, on a Docsify page, a viewer with:

- a realtime WebGL render of the shader,
- auto-generated controls for every `INPUTS` entry (float, bool, long, event,
  color, point2D, image, audio, audioFFT, plus the MadMapper `floatRange`
  min/max pair and the animator/shaper/incrementer/damper/pass_thru/
  linear_filter/adsr controllers as sliders; `generate_as_define` inputs are
  compile-time constants),
- a live text/shader editor with GLSL syntax highlighting, error mapping and
  a foldable toolbar (chevron or Ctrl/Cmd+Shift+B) that hands its rows back
  to the code pane,
- multi-pass and persistent buffers, `IMPORTED` textures and `.vs` pairing,
- fullscreen, pause/reset, FPS/resolution stats and a GPU context budget.

The original link is left alone in the Markdown source, so browsing the same
README on Codeberg lands on the raw file.

## Self-test

Every link below is a real `.fs` file committed next to this README. On this
Docsify page each one becomes an interactive viewer; on Codeberg each one opens
the shader source. If a viewer renders and its controls respond, the plugin is
working.

### Generator — every scalar input type

[Plasma generator](./samples/plasma.fs)

`float` sliders, a `point2D` X/Y control, `color` picker + alpha, `long` popup
menu, `bool` toggle and an `event` trigger; uses `TIME`, `gl_FragCoord` and
`RENDERSIZE`.

### Generator — every input type, including media

[Input-type test card](./samples/test-card.fs)

Adds `image`, `audio` and `audioFFT` inputs. The image comes from the built-in
test pattern (or your own file via **Choose image…**); the audio inputs receive
a synthetic waveform/spectrum so the shader stays alive without microphone
permissions.

### Filter — `inputImage`

[Kaleidoscope filter](./samples/kaleidoscope.fs)

The standard ISF image-filter convention: an `image` input named
`inputImage`, read with `IMG_NORM_PIXEL()`.

### Transition — `startImage` / `endImage` / `progress`

[Crossfade transition](./samples/crossfade.fs)

The standard ISF transition convention. While playing, `progress` is animated
automatically; the two images default to the built-in test patterns.

### Multi-pass — `WIDTH` / `HEIGHT` equations

[Multi-pass posterizer](./samples/multi-pass.fs)

Three passes: full-resolution copy, half-resolution blur, quarter-resolution
posterize, then the final pass draws the last target to screen. Buffer sizes
come from `floor($WIDTH/2.0)`-style equations evaluated by the plugin.

### Persistent buffer — feedback

[Feedback trail](./samples/feedback.fs)

`PERSISTENT` + `FLOAT` buffer ping-ponged across frames with `PASSINDEX`
branching. Float buffers are used when the GPU supports them, with an
automatic byte-buffer fallback.

### Custom vertex shader — `.fs` + `.vs`

[Vertex shader demo](./samples/vertex-shader.fs)

A companion [`vertex-shader.vs`](./samples/vertex-shader.vs) with the same base
name is fetched automatically and paired with the fragment shader.

### Imported texture — `IMPORTED`

[Imported logo](./samples/imported.fs)

The `IMPORTED` map loads [`isf-logo.png`](./samples/isf-logo.png) relative to
the `.fs` file and samples it with `IMG_NORM_PIXEL()`.

### WebGL2 / GLSL ES 3.00 fallback

[ES3 fallback (dynamic indexing)](./samples/es3-fallback.fs)

GLSL ES 1.00 rejects `palette[index]` with a non-constant `index`; on WebGL2
the viewer automatically recompiles the shader as GLSL ES 3.00 and reports
“Compatibility mode”. On WebGL1-only browsers the viewer shows the compile
error instead (documented limitation).

### Negative tests — error reporting

[Broken shader](./samples/broken.fs) · [Broken header](./samples/broken-header.fs)

Both must show a readable error (`caption`/line number) instead of a blank
canvas or a silent failure. Open the editor to see the offending line
highlighted.

### Provided include helper

[Included helper demo](./samples/included.fs)

`#include "included-helper.glsl"` is resolved relative to the `.fs` file and
also through `$docsify.isf.includePaths` (this site points that at
`/modules/src/isf-source/isf/glsl`, so the bundled MadMapper `MadCommon`,
`MadNoise` and `MadSDF` ports resolve too). Includes are recursive, cycle-safe,
cached for the session, understood in `.vs` files as well, and known case
variants (`MadNOISE.glsl`, `MadCOMMON.glsl`) map to the shipped filenames.
Missing includes are listed in the status bar.

### MadMapper generators

[MadMapper time_base generator](./samples/madmapper-generator.fs)

MadMapper `GENERATORS` are simulated on the CPU: `time_base` clocks (plus
`pass_thru`, `multiplier`, `linear_filter`, `damper` and easing/animator
pass-throughs) become uniforms advanced every frame, so bundled materials
using `mat_time_source`-style names work in the browser. Unknown generator
types are reported once in the status bar.

### Shadertoy import — pointer extension

[Mouse ripple (converted from Shadertoy)](./samples/mouse-ripple.fs)

This file is the output of the built-in importer: open the editor, press
**Import**, paste a Shadertoy `mainImage()` shader and press **Convert &
Load**. Move the pointer over the preview to move the ripple (click for the
`iMouse.zw` state) — the importer maps `iMouse`/`mouse` to the docsify-isf
`_isfMouse` pointer extension.

## Quick start (Docsify)

```html
<script>
  window.$docsify = {
    name: "My site",
    isf: {
      // all keys optional — see Configuration below
      mode: "replace",
      editor: true,
      maxContexts: 8
    }
  };
</script>

<script src="https://cdn.jsdelivr.net/npm/docsify@5.0.0/dist/docsify.min.js"></script>
<script src="https://gllmar.github.io/docsify-isf/docsify-isf.js"></script>
```

Then write ordinary Markdown:

```md
[Kaleidoscope](./samples/kaleidoscope.fs)
```

When the Markdown is browsed outside Docsify (Codeberg, GitHub, a plain text
editor), that is still a normal link to `samples/kaleidoscope.fs`.

## How the link conversion works

1. On every Docsify render (`doneEach`) the plugin scans anchors in the content
   area.
2. An anchor whose URL ends in a configured extension (`.fs` by default) is
   resolved relative to the current Docsify route, with hash routes (`#/…`),
   site-root paths and `../` all supported.
3. If the direct URL 404s, the plugin retries the sibling `<dir>/<name>.fs`
   path — this transparently repairs the legacy `[`file.fs`](../file.fs)`
   links generated for material pages while keeping plain-file browsing
   working.
4. The anchor is replaced by a viewer block (`mode: "augment"` keeps the link
   and inserts the viewer after it).
5. The `.fs` text is fetched, the tolerant header parser extracts the metadata
   JSON, the GLSL body is translated (`IMG_*`, `vv_*` v1 aliases) and compiled
   by WebGL; every `INPUTS` entry gets a control.

## Configuration

All keys are optional and live under `window.$docsify.isf`:

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `extensions` | `["fs"]` | Link extensions to convert, case-insensitive. |
| `mode` | `"replace"` | `"replace"` the link or `"augment"` (link + viewer). |
| `lazy` | `"visible"` | `"visible"` (load near viewport), `"click"`, `"none"`. |
| `width` / `height` | `"100%"` / `"360px"` | Preview size. |
| `aspectRatio` | `null` | e.g. `"16/9"`; `null` uses `height`. |
| `maxFps` | `0` | Cap the render loop to this many frames per second (`0` = unlimited). |
| `includePaths` | `[]` | Extra directories searched for `#include "file.glsl"` after the shader's own folder. |
| `controls` | `true` | Build parameter controls. |
| `params` | `"auto"` | `"auto"`, `"open"`, `"closed"`. |
| `paramsOpenLimit` | `6` | `auto` opens when the input count is ≤ this. |
| `autoplay` | `true` | Start playing on load. |
| `loopTransition` | `true` | Animate `progress` on transitions. |
| `transitionDuration` | `4.0` | Seconds per transition sweep. |
| `resolution` | `"auto"` | `"auto"` or a fixed multiplier (`0.5`, `1`, `2`). |
| `maxPixelRatio` | `2` | Upper bound for `auto` rendering scale. |
| `maxContexts` | `8` | Live WebGL contexts; the least visible viewer is released past this. |
| `editor` | `true` | Show the source-editor button. |
| `editorOpen` | `false` | Open the editor on load. |
| `editorLive` | `true` | Recompile while typing (debounced). |
| `editorDebounce` | `600` | Live recompile debounce in ms. |
| `editorIndent` | `2` | Spaces per indent level; `0` uses a hard tab. |
| `persistLayout` | `true` | Remember editor height, folded toolbar and drawer widths across viewers and pages. |
| `persistValues` | `true` | Remember parameter values per shader URL. |
| `share` | `true` | Show the “copy link” button (parameters + panel state). |
| `imageUrl` | `null` | Default image for image inputs (otherwise a built-in test pattern). |
| `vertexShader` | `"auto"` | Fetch a same-name `.vs`; `false` disables. |
| `imports` | `true` | Load `IMPORTED` textures. |
| `showStats` | `true` | Show `fps · resolution · passes`. |
| `showSource` | `true` | Header download/source button. |
| `debug` | `false` | Console diagnostics. |

Every viewer also exposes `DocsifyISF` on `window` for scripting
(`parseISF`, `buildShader`, `highlightGLSL`, …).

## Editor

Press the `</>` button in the viewer header:

- **GLSL syntax highlighting** for keywords, types, built-ins, ISF functions
  and the ISF uniforms, with an **active-line highlight**, a **line-number
  gutter** and a live **`Ln x, Col y`** caret readout.
- **Fragment and Vertex tabs** — a companion `.vs` is loaded into the Vertex
  tab automatically; opening an empty Vertex tab prefills a working
  `isf_vertShaderInit()` starter. Compile errors are mapped to the right tab.
- **Ctrl/Cmd + Enter** (or **Apply**) compiles; with `editorLive` the shader
  recompiles shortly after you stop typing and the status bar reports the
  compile time.
- **Enter auto-indents** (keeps the current indentation, adds one level after
  an opening bracket); **Tab / Shift+Tab** indent and dedent the selection;
  **Ctrl/Cmd + /** toggles comments; **Ctrl/Cmd + +/-/0** zooms the editor;
  indentation width follows `editorIndent`.
- A **Templates…** menu inserts ready-made `INPUTS` snippets (float, bool,
  color, point2D, event, long, image, audioFFT) or starts a new generator,
  filter, transition or multi-pass shader.
- Compile errors are mapped back to the original `.fs` file line — the gutter
  highlights it, the status bar explains it, and the error overlay offers
  **Fix at line N**, **Copy error** and **Open source**.
- **Revert** returns to the file on disk; **Copy** puts the source on the
  clipboard.
- **Drag the handle above the editor** to resize it (double-click to reset,
  or focus it and use ↑/↓/Home/End). The **code and parameter drawers are
  overlays**: the code editor slides in from the left edge, the parameters
  from the right, both translucent so the render stays visible behind them,
  and neither resizes the canvas. Drag their inner edges to resize a drawer
  (or focus the rail and use ←/→/Home/End; double-click resets). Sizes persist
  when `persistLayout` is on.

## Import (Shadertoy / GLSL Sandbox)

The editor's **Import** button opens a paste box and converts the two most
common non-ISF dialects the way the official ISF Editor does:

| Source | Conversion |
|---|---|
| Shadertoy | `iTime`/`iGlobalTime`→`TIME`, `iTimeDelta`→`TIMEDELTA`, `iResolution`→`RENDERSIZE`, `iFrame`→`FRAMEINDEX`, `iDate`→`DATE`, `iChannelTime[n]`→`TIME`, `iChannelResolution[n]`→`IMG_SIZE(iChannelN)`, `texture`/`textureLod`/`textureGrad`→`texture2D`, `texelFetch`→`IMG_PIXEL`, `iChannelN`→image inputs, and a `main()` wrapper that calls `mainImage(gl_FragColor, gl_FragCoord.xy)` |
| GLSL Sandbox | `time`→`TIME`, `resolution`→`RENDERSIZE`, `mouse`→`_isfMouse.xy`, stale environment `uniform` declarations stripped |

Converted `iMouse`/`mouse` uses the docsify-isf **`_isfMouse` pointer
extension** (`vec4`: `xy` = pointer position in pixels with the origin at the
bottom-left, `zw` = click position, `z` negative when the button is up) so
imported shaders are interactive without any input control. The `View`
selector in the parameters panel previews any render-pass target, `Quality`
scales the render (0.25×–2× or auto), and **Export PNG** downloads the
current frame.

## UI/UX notes

- Every control respects the ISF constraints: sliders, pickers and typed
  values are clamped to `MIN`/`MAX`, `long` values snap to `VALUES`, and
  `point2D`/`color` components stay in range. Out-of-range typing is corrected
  on change and flagged with `aria-invalid` while editing.
- `width`, `height` and `aspectRatio` size the preview; the code and
  parameter drawers overlay the canvas (left/right) at every width and never
  change the render size. They are translucent/glassy (backdrop blur) so the
  shader stays visible and are toggled from the top bar (`</>` editor and the
  sliders button, `aria-pressed`-aware). One drawer may use up to 64 % of the
  stage, two are capped at 46 % each so the render stays visible; on phones
  each drawer fills the stage, opening one closes the other, and the resize
  rails are hidden.
- The top bar is responsive: on narrow screens the title gets its own row and
  the action buttons wrap, keeping every control visible and at least 36 px
  tall on touch devices; controls and drawers respect the notch safe areas,
  and form fields switch to 16 px on coarse pointers so iOS does not zoom.
- The preview is keyboard focusable: **Enter/Space** or a double-click toggles
  fullscreen. Buttons and inputs use `:focus-visible`, carry `aria-pressed` /
  `aria-expanded`, and the status regions are `aria-live`.
- `prefers-reduced-motion: reduce` starts viewers paused and removes the
  loading animation; coarse-pointer devices get larger touch targets.

## Supported ISF features

| Area | Support |
|---|---|
| ISF v2 metadata | `DESCRIPTION`, `CREDIT`, `CATEGORIES`, `ISFVSN`, `VSN`, `INPUTS`, `PASSES`, `IMPORTED` |
| Inputs | `float`, `bool`, `long` (VALUES/LABELS), `int`, `event`, `color`, `point2D`, `image`, `audio`, `audioFFT` |
| Built-ins | `RENDERSIZE`, `TIME`, `TIMEDELTA`, `DATE`, `FRAMEINDEX`, `PASSINDEX`, `isf_FragNormCoord`, `gl_FragCoord`, `gl_FragColor` |
| Functions | `IMG_PIXEL`, `IMG_NORM_PIXEL`, `IMG_THIS_PIXEL`, `IMG_NORM_THIS_PIXEL`, `IMG_THIS_NORM_PIXEL`, `IMG_SIZE` |
| Passes | `TARGET`, `PERSISTENT`, `FLOAT`, `WIDTH`/`HEIGHT` equations |
| Imports | `IMPORTED` map (and the MadMapper array form) |
| Includes | local `#include "file.glsl"` — relative to the shader, `includePaths`, recursive, cached, case-variant aliases, also honoured in `.vs` files |
| Generators | MadMapper `GENERATORS` (`time_base`, `incrementer`, `pass_thru`, `multiplier`, filter/damper/ease/animator/adsr) simulated CPU-side |
| Entry points | `void main()`, MadMapper `materialColorForPixel()` wrapper |
| Compatibility | WebGL2 / GLSL ES 3.00 retry, MadMapper/HLSL dialect rewrite (`fill`, `fBm`, `saturate`, …), scope-aware literal promotion, generated overload shims and forward prototypes (every material in the bundled library compiles, `npm run test:coverage`); the CPU generators and image upload orientation match the shared editor core, which is byte-identical on the cross-kernel sample (`scripts/library.sh kernels`) |
| Vertex | default generated vertex shader, or a same-name `.vs` (editable tab) |
| ISF v1 | `vv_FragNormCoord`, `vv_vertShaderInit` aliases |
| docsify-isf | `_isfMouse` pointer `vec4` (Shadertoy semantics), pass-target preview, quality scaling, PNG export |

## Performance and context budget

- One `requestAnimationFrame` loop per live viewer; offscreen viewers skip
  work and hidden tabs pause automatically.
- Rendering scale is `devicePixelRatio` capped at `maxPixelRatio` (`auto`), or
  a fixed multiplier; the size is reported in the corner badge.
- Browsers only allow a limited number of live WebGL contexts. When more than
  `maxContexts` viewers want a context, the least-recently-visible one is
  released (its GPU resources are deleted) and resumes automatically when
  scrolled back into view.
- The canvas is rendered at the shader's native resolution, so ISF filters
  that read `RENDERSIZE` stay resolution-independent.

## Limitations

- WebGL renders GLSL ES 1.00 / ES 3.00. The viewer rewrites the MadMapper/HLSL
dialect and retries progressively permissive compilations, but a small number
of materials still fail: dynamic types the heuristics cannot infer, regex-style
local helpers, or genuinely unsupported features. Compile errors show the
original file line and the attempt that failed.
- `STARTIMAGE`/media from cameras and real audio capture are not wired up; audio
  inputs receive a synthetic waveform/spectrum.
- Vertex shaders only get the standard `isf_position` attribute; custom extra
  attributes are not supported.
- Cross-origin `.fs` URLs must send CORS headers, and imported images must be
  same-origin or CORS-enabled, because of WebGL texture security rules.

## Headless frames

The plugin can render a single deterministic frame without any UI, which makes
ISF output comparable across renderers, revisions and machines:

```js
const frame = await DocsifyISF.renderFrame({
    url: "/modules/src/isf-source/library/2d-clouds/2d-clouds.fs",
    width: 320, height: 180,   // exact drawing-buffer size
    time: 1.5,                 // frozen material time (seconds)
    inputs: { mat_scale: 2 },  // input overrides, clamped like the controls
    steps: 1                   // virtual steps from 0 → time (use ~60 for feedback)
});
// frame.dataUrl  — image/png data URL
// frame.mode     — "ES 1.00" | "ES 3.00" | "Compatibility mode · …"
// frame.width, frame.height, frame.time, frame.inputs, frame.warnings

const diff = await DocsifyISF.compareFrames(a.dataUrl, b.dataUrl, { threshold: 2 });
// diff.mae       — mean absolute per-channel error (same metric as the OBS cover sweep)
// diff.maxDiff, diff.diffRatio, diff.identical, diff.sizeMismatch
```

`DATE` is frozen to `2020-01-01T00:00:00Z` by default (`date: "now"` for the
real clock), `TIME`/`TIMEDELTA`/generators/frame index are reset per frame,
and the viewer is disposed afterwards, so repeated renders are byte-identical.
Frames are captured in screen orientation (the drawing buffer is flipped, like
the editor core's captures) and composited over black because ISF output is
straight RGBA while OBS covers are opaque — pass `background: null` to keep
the alpha channel. `Export PNG` uses the same oriented capture.

The bundled CLI renders files or whole library sweeps and can diff them
against the project's OBS `_cover.png` captures:

```bash
node tools/render-frame.mjs samples/plasma.fs --out plasma.png
node tools/render-frame.mjs --kind generator --limit 20 --out-dir frames --cover --report report.json
node tools/render-frame.mjs samples/kaleidoscope.fs --parent color-bars --compare frames/color-bars.png
```

`--cover` replays the time/parameters/parent recorded in `_covers.json`
(including packed colour and split point values) and reports the MAE against
each material's `_cover.png`, so renderer differences are separated from
capture differences. `--steps N` walks the runtime from zero in N virtual
steps for feedback/multi-pass shaders; `--strict` exits non-zero above
`--max-mae`. Run `node tools/render-frame.mjs --help` for every option.

## Development and tests

```bash
# unit tests: header parser, expression evaluator, IMG_* rewriting, URL
# resolution, highlighting, shader assembly and every sample in samples/
node tests/run.js

# also parse and assemble the whole bundled OBS ISF corpus (when checked out
# inside obs-lua-projection-mapping)
node tests/run.js --corpus

# optional browser tests (need Chrome + puppeteer-core)
npm install
npm run test:smoke     # UI interactions
npm run test:frame     # headless frame renderer determinism + comparison

# serve this repository as the demo Docsify site
npx docsify serve .
```

The Node tests load every `samples/*.fs`, build it and assert the README links
point at committed files, so the self-test cannot rot silently.

## License

MIT — see [LICENSE](./LICENSE).
