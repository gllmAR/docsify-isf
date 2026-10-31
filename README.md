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
- auto-generated controls for every `INPUTS` entry, rendered by the shared
  Pupitre UI toolkit (float, bool, long, event,
  color, point2D, image, audio, audioFFT, plus the MadMapper `floatRange`
  min/max pair and the animator/shaper/incrementer/damper/pass_thru/
  linear_filter/adsr controllers as sliders; `generate_as_define` inputs are
  shown read-only, since the shader already baked them),
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

Keep `docsify-isf.js` next to its `vendor/pupitre-ui/` folder: the parameter
inspector/transport loads the shared toolkit on demand from that sibling directory. Both
are in the npm package and the Pages build. If you host the script elsewhere,
point `isf.puiBase` at the folder; if the assets cannot load, the inspector shows
a diagnostic with a Retry button and the shader still renders.

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
| `puiBase` | `null` | URL prefix of the on-demand PUI assets (`pupitre-ui.js`, `isf.js`, `pupitre-ui.css`). Defaults to `vendor/pupitre-ui/` next to `docsify-isf.js`; set it when the plugin is copied without the vendor folder (CDN, unusual layouts). If the assets fail to load, the inspector shows a diagnostic and Retry. |
| `params` | `"auto"` | `"auto"`, `"open"`, `"closed"`. |
| `paramsOpenLimit` | `6` | `auto` opens when the input count is ≤ this. |
| `autoplay` | `true` | Start playing on load. |
| `loopTransition` | `true` | Animate `progress` on transitions. |
| `transitionDuration` | `4.0` | Seconds per transition sweep. |
| `resolution` | `"auto"` | Scale multiplier for the drawing buffer: `"auto"` (`min(devicePixelRatio, maxPixelRatio)`) or a fixed multiplier (`0.5`, `1`, `2`). Further capped by `maxResolution`. |
| `maxPixelRatio` | `2` | Upper bound for `auto` rendering scale. |
| `maxResolution` | `"sd"` | Render-buffer cap, preserving the stage aspect ratio: `"sd"` (≤854×480), `"hd"` (≤1280×720), `"fhd"` (≤1920×1080), `"native"` (no cap). The browser upscales the buffer to the CSS size. |
| `maxContexts` | `8` | Live WebGL contexts; the least visible viewer is released past this. |
| `editor` | `true` | Show the source-editor button. |
| `editorOpen` | `false` | Open the editor on load. |
| `editorLive` | `true` | Recompile while typing (debounced). |
| `editorDebounce` | `600` | Live recompile debounce in ms. |
| `editorIndent` | `2` | Spaces per indent level; `0` uses a hard tab. |
| `persistLayout` | `true` | Remember editor height, folded toolbar, inspector width, Scale and Resolution across viewers and pages. |
| `persistValues` | `true` | Remember parameter values per shader URL. |
| `share` | `true` | Show the share button: it copies a self-contained fullscreen URL for OBS browser sources (shader + current parameters + Resolution/Scale). |
| `imageUrl` | `null` | Default image for image inputs (otherwise a built-in test pattern). |
| `vertexShader` | `"auto"` | Fetch a same-name `.vs`; `false` disables. |
| `imports` | `true` | Load `IMPORTED` textures. |
| `showStats` | `true` | Show `fps · resolution · passes`. |
| `showSource` | `true` | Source link (title and inspector More menu). |
| `debug` | `false` | Console diagnostics. |

Every viewer also exposes `DocsifyISF` on `window` for scripting
(`parseISF`, `buildShader`, `highlightGLSL`, `createParamsDocument`, …).
`PupitreUI`/`PupitreISF` become available once the first inspector or
transport mounts; `await DocsifyISF.loadPUI()` loads the toolkit explicitly.
The viewer is a **studio shell** built around a PUI inspector drawer anchored
inside the shader stage. The header is a PUI `toolbar` with one inspector
toggle, the source-link title/ISF chip and the live FPS/size readout. The
inspector is a PUI `drawer` titled with the shader name; its toolbar owns the
**Parameters | Source** view switcher and a **More** menu (fullscreen, reset,
share, help, open source), followed by the active parameters/editor surface and
a native PUI **transport** (play/pause/stop and shader-time seek). The
Parameters view is a PUI document generated from the normalised `INPUTS` by the
vendored ISF adapter; the Source view is the host GLSL editor mounted as a PUI
custom slot. Only one shader inspector is open at a time, so multiple viewers
never stack drawers on top of each other. The bottom status line is a PUI
statusbar with a tone, and transient feedback uses a dismissible PUI toast
stack.

The host header remains only as the pre-load/failure fallback; the code editor
and stage remain host surfaces. The header toggle exposes `aria-pressed`; the
drawer owns focus, Escape and close; the transport is driven through PUI
bindings. `params:"auto"` only auto-opens the inspector for the viewer in view,
and never steals it from another open viewer.

## OBS / fullscreen link

The share button copies a URL shaped like

```
https://site/page/?isf-shader=<shader-url>&isf-fullscreen=1
  &isf-res=sd&isf-quality=auto&isf-values=<base64url>
```

`isf-shader` names the shader, `isf-values` carries its current parameters,
`isf-res` carries the Resolution preset and `isf-quality` the Scale multiplier
(self-contained: no local storage or page links are needed).
`isf-fullscreen=1` mounts one bare viewer — no header, inspector, transport or status — that
fills the viewport and always plays. That is the capture an OBS **Browser**
source wants: paste the URL, set the source size, done.

The flags are hand-editable: `isf-res=sd|hd|fhd|native` and
`isf-quality=auto|2|1|0.5|0.25` override the stored/cookie-free defaults for
that load. SD is the performance default; use `isf-res=fhd` (or `native`) for
a sharper OBS capture. The normal page viewer also accepts the same flags
(`isf-editor=1`, `isf-controls=1` still work). The share button copies the
source viewer's current Resolution/Scale, so set Resolution to FHD/Native
before sharing when you want a high-resolution capture.

The bare viewer keeps the whole editing experience one gesture away: hover
the bottom-right corner and click the eye button (or press **H**) to reveal
the toolbar, parameters and editor; **Escape** (or the same button/key) hides
everything back to the clean capture. OBS's *Interact* window forwards both
the mouse and the keyboard. The revealed toolbar's reset button returns the
parameters to the shader defaults; the Resolution menu's **Default** returns
the cap to the site default. The bare viewer never writes local storage.

The in-page fullscreen button (or double-clicking the canvas) makes the whole
viewer block fill the display. The header and status line are hidden and the
inspector starts closed, so the shader gets the whole viewport. A subtle
inspector pill sits at the top-left (32 px, low opacity); it fades after about
2.2 s of inactivity and reappears on pointer/keyboard activity. Click it (or
press **H**) to open the contextual PUI drawer for this shader; **Escape**
closes it and brings the hint back. There is no second fullscreen toolbox:
**Exit fullscreen**, Reset, Share and Open source live in the inspector’s More
menu, and play/seek remain in its transport. The same Resolution/Scale cap
applies, so a 4K fullscreen still renders at SD by default until you pick
HD/FHD/Native. If the PUI assets cannot load, the normal header falls back.

## Editor

The Source view fills the inspector drawer; dragging its splitter pins a manual
height (double-click resets it), and folding the editor toolbar grows the pane
by exactly the freed rows. The Parameters/Source switcher, More actions and
transport live in the PUI drawer around the host editor. On phones the drawer
takes the full viewport, the caret readout is hidden and the editor status is
visually hidden but still announced, so compile feedback survives while the
code pane keeps most of the height.

Open **Source** from the inspector toolbar (or press Ctrl/Cmd+B):

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
- A compact **Templates** PUI menu inserts ready-made `INPUTS` snippets
  (float, bool, color, point2D, event, long, image, audioFFT) or starts a new
  generator, filter, transition or multi-pass shader. The native select
  remains only as the pre-load fallback if the toolkit assets are unavailable.
- Compile errors are mapped back to the original `.fs` file line — the gutter
  highlights it, the status bar explains it, and the error overlay offers
  **Fix at line N**, **Copy error** and **Open source**.
- **Revert** returns to the file on disk; **Copy** puts the source on the
  clipboard.
- **Drag the handle above the editor** to resize it (double-click to reset,
  or focus it and use ↑/↓/Home/End). The **inspector** is one floating card on
  the right with Parameters/Source tabs; it overlays the preview and never
  resizes the canvas. Drag its inner edge to resize it (or focus the rail and
  use ←/→/Home/End; double-click resets). Sizes persist when `persistLayout`
  is on.

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
selector in the parameters panel previews any render-pass target; `Resolution`
caps the render buffer (Default/SD/HD/FHD/Native), `Scale` multiplies it
(0.25×–2× or auto), and **Export PNG** downloads the current frame. Both
persist with the layout and can be overridden from the URL (`isf-res`,
`isf-quality`).

## UI/UX notes

- Every control respects the ISF constraints: sliders, pickers and typed
  values are clamped to `MIN`/`MAX`, `long` values snap to `VALUES`, and
  `point2D`/`color` components stay in range. Out-of-range typing is corrected
  on change and flagged with `aria-invalid` while editing.
- `width`, `height` and `aspectRatio` size the preview. The **inspector** is
  a PUI drawer anchored inside the shader stage, so it stays visually tied to
  the preview and one shader inspector is open at a time. Its toolbar switches
  Parameters/Source, its More menu carries view actions, and its native PUI
  transport owns play/seek. It never changes the render size.
- The header is responsive: on narrow screens it keeps the inspector toggle
  and title (the stats readout is hidden), while view actions stay in the
  inspector More menu; controls stay at least 32–36 px tall on touch devices
  and the drawer tabs, transport and form fields respect the notch safe areas
  and coarse-pointer sizing.
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
  a fixed multiplier; the fps/size/pass stats live in the top bar, never over
  the shader.
- Browsers only allow a limited number of live WebGL contexts. When more than
  `maxContexts` viewers want a context, the least-recently-visible one is
  released (its GPU resources are deleted) and resumes automatically when
  scrolled back into view.
- The canvas is capped to the configured max resolution (SD by default) and
  scaled to the CSS size, so large/high-DPI and fullscreen viewers stay cheap;
  `RENDERSIZE` is the render-buffer size, so ISF filters that read it stay
  resolution-independent. Raise it per viewer (Resolution menu), per site
  (`maxResolution`), or per URL (`isf-res`).

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
Frames are captured in canvas/display orientation — the same orientation as
the live viewer and the OBS `_cover.png` captures (the raw bottom-up OBS
source screenshot is flipped by the cover tool, not by this capture) — and
composited over black because ISF output is straight RGBA while OBS covers are
opaque; pass `background: null` to keep the alpha channel. `Export PNG` uses
the same capture. Image inputs upload bottom-up so `IMG_NORM_PIXEL()` is
upright with the bottom-left `isf_FragNormCoord`, like the reference renderer.

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
# build the single-file artifact from the vendored canonical kernel
# (vendor/isf-core/, synced from obs-lua-projection-mapping with
#  scripts/isf-plugin-sync.mjs) — edit src/plugin.src.js, never docsify-isf.js
node tools/build.mjs          # writes docsify-isf.js
node tools/build.mjs --check  # CI: fails when the artifact is out of date

# the parameter panel is the shared Pupitre UI toolkit (vendor/pupitre-ui):
# sync it from a pupitre-ui checkout and verify the pinned snapshot
node tools/sync-pupitre-ui.mjs          # PUPITRE_UI_DIR=... when not a sibling
node tools/sync-pupitre-ui.mjs --check  # CI: vendored files match SOURCE.json

# unit tests: header parser, expression evaluator, IMG_* rewriting, URL
# resolution, highlighting, shader assembly and every sample in samples/
node tests/run.js

# PUI parameter document, adapter round-trip and vendor integrity
node tests/pui-params.test.js

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
