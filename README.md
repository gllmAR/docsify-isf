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
  color, point2D, image, audio, audioFFT),
- a live text/shader editor with GLSL syntax highlighting and error mapping,
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

### Negative tests — error reporting

[Broken shader](./samples/broken.fs) · [Broken header](./samples/broken-header.fs)

Both must show a readable error (`caption`/line number) instead of a blank
canvas or a silent failure. Open the editor to see the offending line
highlighted.

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
| `persistLayout` | `true` | Remember editor height / side width across viewers and pages. |
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
- **Ctrl/Cmd + Enter** (or **Apply**) compiles; with `editorLive` the shader
  recompiles shortly after you stop typing and the status bar reports the
  compile time.
- **Enter auto-indents** (keeps the current indentation, adds one level after
  an opening bracket); **Tab / Shift+Tab** indent and dedent the selection;
  indentation width follows `editorIndent`.
- Compile errors are mapped back to the original `.fs` file line — the gutter
  highlights it, the status bar explains it, and the error overlay offers
  **Fix at line N**, **Copy error** and **Open source**.
- **Revert** returns to the file on disk; **Copy** puts the source on the
  clipboard.
- **Drag the handle above the editor** to resize it (double-click to reset,
  or focus it and use ↑/↓/Home/End). The panel width has the same handle on
  its left edge. Both sizes persist in `localStorage` when `persistLayout` is
  on.

## UI/UX notes

- Every control respects the ISF constraints: sliders, pickers and typed
  values are clamped to `MIN`/`MAX`, `long` values snap to `VALUES`, and
  `point2D`/`color` components stay in range. Out-of-range typing is corrected
  on change and flagged with `aria-invalid` while editing.
- `width`, `height` and `aspectRatio` actually size the preview; the panel
  stacks below the canvas on narrow screens and docks beside it from 900 px
  (and in fullscreen, resizable).
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
| Vertex | default generated vertex shader, or a same-name `.vs` |
| ISF v1 | `vv_FragNormCoord`, `vv_vertShaderInit` aliases |

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

- WebGL renders GLSL ES 1.00 shaders. Desktop GLSL features that WebGL 1
  rejects (dynamic array indexing, non-constant loop bounds, `texture2DProj`,
  geometry/3D textures) fail with a compile error instead of rendering.
- `STARTIMAGE`/media from cameras and real audio capture are not wired up; audio
  inputs receive a synthetic waveform/spectrum.
- Vertex shaders only get the standard `isf_position` attribute; custom extra
  attributes are not supported.
- Cross-origin `.fs` URLs must send CORS headers, and imported images must be
  same-origin or CORS-enabled, because of WebGL texture security rules.

## Development and tests

```bash
# unit tests: header parser, expression evaluator, IMG_* rewriting, URL
# resolution, highlighting, shader assembly and every sample in samples/
node tests/run.js

# also parse and assemble the whole bundled OBS ISF corpus (when checked out
# inside obs-lua-projection-mapping)
node tests/run.js --corpus

# optional browser smoke test (needs Chrome + puppeteer-core)
npm install
npm run test:smoke

# serve this repository as the demo Docsify site
npx docsify serve .
```

The Node tests load every `samples/*.fs`, build it and assert the README links
point at committed files, so the self-test cannot rot silently.

## License

MIT — see [LICENSE](./LICENSE).
