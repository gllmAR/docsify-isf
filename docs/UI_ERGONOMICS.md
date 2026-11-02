# UI ergonomics audit — ISF workbench

**Scope:** docsify-isf viewer workbench · **Date:** 2026-11-02 · **PUI:** 1.12.1
**Captures:** [`ui-audit/`](ui-audit/) · **Reproduce:** `node tools/ui-audit.mjs`

This audit covers the embedded workbench, not the surrounding Docsify page. It
was done from committed desktop/mobile captures plus DOM measurements, then
checked against established editor/workbench implementations.

---

## 1. Captures

| State | Capture |
|---|---|
| Desktop, defaults (Parameters open) | ![desktop default](ui-audit/desktop-default.png) |
| Desktop, Source + Parameters | ![desktop both panes](ui-audit/desktop-both-panes.png) |
| Desktop, View tab | ![desktop view](ui-audit/desktop-view-tab.png) |
| Desktop, title bar compact | ![desktop compact](ui-audit/desktop-compact.png) |
| Desktop, Focus preview | ![desktop focus](ui-audit/desktop-focus.png) |
| Desktop, fullscreen | ![desktop fullscreen](ui-audit/desktop-fullscreen.png) |
| Phone, Parameters | ![mobile parameters](ui-audit/mobile-parameters.png) |
| Phone, Source | ![mobile source](ui-audit/mobile-source.png) |

The captures are block-level so the workbench chrome, not the Docsify sidebar,
is the subject. The phone captures are 390×844 CSS px; desktop is 1280×1000.

---

## 2. What was hurting

1. **Three competing title levels.** The Docsify page heading, then an
   eyebrow/title/description block, then pane titles and a tab bar. On a 920 px
   content column, the stage was the first thing to lose space.
2. **Redundant labels.** `PREVIEW` above the stage, `PARAMETERS` above a
   `Parameters` tab, and `Source editor` inside a `SOURCE` pane repeated the
   same information.
3. **Mobile title bar density.** At 390 px the title/description and four
   textual controls stacked into a ~192 px header before the workbench body.
4. **Cryptic source state.** Once the editor chrome was hidden, the caret and
   compile status disappeared even though they are the two most useful editor
   signals.
5. **No-op transport controls.** Loop/rate were rendered even when the host
   reported `canLoop:false`/`canRate:false`; the bottom bar looked heavier than
   its actual capability.
6. **Weak section state.** Pane toggles were plain buttons; open/closed state
   was not obvious at a glance, especially when several panes were open.
7. **Search was absent.** Larger ISF materials (8–20 inputs) required scrolling
   instead of filtering, unlike every mature inspector.
8. **Focus was accidental.** The complexity of four panes had no one-step way
   to return to a pure preview.
9. **Toolbar keyboard order was flat.** Every action was a separate tab stop.

---

## 3. Research: what already solves this

| Reference | Technique taken |
|---|---|
| **VS Code workbench** | One compact title/toolbar row; view toggles; panel/status model; roving toolbar/tabs; command palette; content-first editor area. |
| **Blender** | Compact area headers; editor tabs; maximise-area (our Focus preview); panels as headers, not nested title bars. |
| **Figma** | Panel headers with actions; consistent 32 px icon buttons with tooltips; command palette; collapsible panels. |
| **OBS ISF editor** (projection mapping) | Left Inputs/Source, central render, right diagnostics, bottom status; the closest domain-specific layout. |
| **Ark UI / Radix UI** | Toolbar, ToggleGroup, Tabs, Splitter, Collapsible primitives; roving tab stops, `aria-controls`/`aria-expanded`, visible focus. |
| **Dockview / Golden Layout** | Resizable split panes and persisted layout; validates PUI's workbench split-pane model without requiring full docking. |
| **Leva / Theatre.js** | Dense parameter controls, quick reset, filter/search over parameters. |
| **PUI itself** | Workbench regions, collapsible title bar, titlebar eyebrow, pane icons, `search`, transport/statusbar and command palette. |

### Principles selected

- One application chrome, not three title systems.
- Content first: remove labels that the tab/header already carries.
- Progressive disclosure: keep the description, search and details available,
  but not permanently in the primary visual path.
- One primary action per surface (Apply in the editor; Play/Pause in playback).
- Show only controls the host can honour.
- Icons + labels on desktop, icons + accessible names on phones.
- Roving toolbar semantics and visible active states.
- A first-class focus/preview mode.

---

## 4. Implemented changes

### PUI upstream

- Workbench title bar keeps a compact title when collapsed; eyebrow/description
  hide first.
- Pane toggles accept decorative icons and visible labels; accessible name is
  `Toggle <pane>`.
- Active pane toggles use the accent state.
- Workbench tools are a `role="toolbar"` with one roving tab stop and
  Arrow/Home/End navigation.
- Coarse-pointer titlebar controls are at least 32 px.
- PUI's parameter filter is available to hosts; docsify enables it for
  materials with six or more inputs.

### docsify host

- Content-first chrome:
  - removed the visible `Preview` label and the duplicate right-pane title;
  - hid the Source editor head inside the Source pane;
  - moved Source caret/status into a compact title-bar dot + `Ln x, Col y`;
  - made `Apply` the editor's primary action.
- Title bar carries the ISF eyebrow, title, description, pane icons/labels and
  the command menu; collapsed state retains the title.
- Mobile title bar uses two rows: identity/description then icon-only controls.
- Playback is a compact strip; transport title and unavailable Loop/rate
  controls are hidden; the statusbar remains.
- **Filter parameters** appears for larger input sets.
- **Menu → Focus preview** closes Source, Parameters and Playback in one step.
- Only one Parameters pane is open across viewers; Source and Parameters have
  explicit show/hide state.

### Measured result

- Desktop title bar: **111 px** expanded, compact afterwards; section/action
  controls are 32 px high and icon-only.
- Phone title bar: **~121 px** with identity + one icon row (previously ~192 px
  with stacked text controls).
- Phone stage: **~415 px** tall with Parameters open (previously ~286 px).
- Source at 300 px keeps a `Ln x, Col y` and compile-status indicator without
  spending a full status row.
- Playback strip: **~96 px** including the statusbar, with no dead controls;
  editor toolbar is **one row** with Apply + More.

---

## 5. Remaining opportunities

- **Pane open-state persistence** is now host-bound through PUI
  `layout.*.open_bind`; docsify keeps the one-Parameters rule at the host
  layer while the binding mirrors open/closed state without click listeners.
- **Command palette**: PUI has one, but docsify's Ctrl+K already toggles
  Parameters. A deliberate shortcut migration would make the palette the
  primary command surface; the full interaction trace is the regression net.
- **Dockable layout**: Dockview-style docking is unnecessary for the current
  two-pane model; PUI's split panes and focus mode cover it. Revisit only if
  third panes or user-arranged layouts become a requirement.
- **Stage HUD**: fullscreen/focus still rely on the titlebar. A subtle
  auto-hiding HUD (resolution, play, capture) is the next candidate for a
  media-style preview.
- **Custom tooltips** for icon-only mobile controls; native `title` is
  functional but not first-class on touch.
- **Parameter groups** and saved parameter presets for very large materials.

---

## 6. Reproduce

```bash
node tools/ui-audit.mjs
# captures are written to docs/ui-audit/
```

The script uses Puppeteer/Chrome from `node_modules`; pass `--chrome PATH` or
set `CHROME_PATH` when Chrome is not in the default macOS location.
