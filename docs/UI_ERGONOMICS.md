# UI ergonomics audit — ISF workbench

**Scope:** docsify-isf viewer workbench · **Updated:** 2026-11-03 · **PUI:** 1.18.24 · **docsify-isf:** 1.45.29
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
| Desktop, saved preset | ![desktop presets](ui-audit/desktop-presets.png) |
| Desktop, command palette | ![desktop palette](ui-audit/desktop-palette.png) |
| Desktop, title bar compact (default) | ![desktop default](ui-audit/desktop-default.png) |
| Desktop, light theme | ![desktop light](ui-audit/desktop-light.png) |
| Desktop, forced colors | ![desktop forced colors](ui-audit/desktop-forced-colors.png) |
| Desktop, RGBA picker | ![desktop color picker](ui-audit/desktop-color-picker.png) |
| Desktop, Source More menu | ![desktop editor more](ui-audit/desktop-editor-more.png) |
| Desktop, title bar expanded | ![desktop expanded](ui-audit/desktop-expanded.png) |
| Desktop, shortcuts help | ![desktop help](ui-audit/desktop-help.png) |
| Desktop, Focus preview | ![desktop focus](ui-audit/desktop-focus.png) |
| Desktop, fullscreen | ![desktop fullscreen](ui-audit/desktop-fullscreen.png) |
| Tablet, Parameters | ![tablet default](ui-audit/tablet-default.png) |
| Phone, Parameters | ![mobile parameters](ui-audit/mobile-parameters.png) |
| Phone, RGBA picker | ![mobile color picker](ui-audit/mobile-color-picker.png) |
| Phone, Source More menu | ![mobile editor more](ui-audit/mobile-editor-more.png) |
| Phone, Source | ![mobile source](ui-audit/mobile-source.png) |
| Phone, stage HUD | ![mobile stage](ui-audit/mobile-stage.png) |
| Phone, long-press tooltip | ![mobile tooltip](ui-audit/mobile-tooltip.png) |
| Phone, shortcuts help | ![mobile help](ui-audit/mobile-help.png) |
| Phone, command palette | ![mobile palette](ui-audit/mobile-palette.png) |

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
- Phone side drawers use the full workbench width below 520 px; host
  `open_bind` updates obey the same one-drawer-at-a-time rule as the toggles.
- The selected Parameters/View/Log tab has an accent underline instead of
  blending into the inactive tabs.
- Command palette: visible `Commands` title, keyboard hint, only real favorites
  get a star, and filtering to zero results is safe.
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
- Shortcuts help is a workbench-level modal (always visible on phone), and the
  editor More menu opens inside the Source pane instead of off its left edge.
- The Menu and More tests scope their item queries to the current workbench;
  selecting an item closes the Menu and executes that viewer's action.
- Fullscreen keeps the compatibility status; auto-open never resets a selected
  tab or steals from an already-open Source pane; pending pane focus is
  cancelled when another pane opens.
- Closing Playback (including Focus preview) reveals a content-first **stage
  HUD** with play/pause, time, resolution/fps, capture and fullscreen. It stays
  for keyboard focus/pause, auto-hides during pointer playback, drops stats
  below 440 px of stage width, and is suppressed for OBS/bare viewers.
- Icon-only chrome now has **hover/focus/long-press tooltips** (PUI 1.15.3):
  titlebar toggles/actions, PUI menus, the host HUD and the fold control. A
  touch long-press shows the label without firing the button; the next pointer
  gesture clears suppression. Tooltips are hosted outside contained PUI roots
  and copy the active theme tokens, so they position correctly in fullscreen.

### Measured result

- Desktop title bar: **41 px compact by default**, **~98 px** expanded with
  the one-line description and eyebrow; section/action controls are 32 px high
  and icon-only.
- Phone title bar: **~121 px** with identity + one icon row (previously ~192 px
  with stacked text controls).
- Phone side pane: **full workbench width** in a one-drawer layout; the stage
  is no longer reduced to a ~30 px sliver. With drawers closed the stage owns
  the workbench body (~457 px at 390×844).
- Source at 280–300 px keeps a `Ln x, Col y` and compile-status indicator
  without spending a full status row.
- Playback strip: **~80 px** desktop / **112 px** phone including the two-line
  statusbar. The Source toolbar is **one 34 px row**: fold, Fragment/Vertex,
  Apply; secondary More is in the Source header. The folded editor fills the
  pane, follows pane resizes and scrolls its textarea. PUI compact fields use
  one label/control/value row (~47 px), and custom slots stretch to their pane.
- Stage HUD: **32 px** controls (36 px coarse pointer) over the preview; the
  desktop Focus HUD shows time + `width×height · fps`, while a phone stage
  (356 px) keeps only time + play/capture/fullscreen because stats would
  truncate.

---

## 4.1 Screenshot audit findings (1.41.0)

The second full capture review found and fixed:

1. **Phone panes left a stage sliver** — side panes were 84vw drawers; at 390
   px the remaining stage was ~30 px. PUI now uses 100% width on phones and
   enforces one side drawer for host-driven `open_bind` changes too.
2. **The Playback strip could disappear** — mobile taps were not reliably
   landing and the pane state was not asserted. The touch trace now scrolls
   each toggle into view, taps it, and checks pane width, exclusivity, the
   bottom strip and its `aria-expanded`.
3. **The Focus capture never focused** — the audit clicked a non-existent
   header-menu item. It now invokes the direct titlebar focus action.
4. **The editor More menu ran off the left edge** — its popup was right-aligned
   to a 30 px trigger; it now opens into the pane, scoped and measured.
5. **Help was trapped in the stage** — the shortcut grid was clipped in a
   270 px stage. Help is now a scrollable workbench modal at both widths.
6. **The menu test clicked another viewer's items** — global `.pui-actions`
   queries were replaced with block-scoped queries; help opens and the menu
   closes after the action.
7. **Selected pane tabs were nearly invisible** — PUI now draws an accent
   underline and stronger weight on the active tab.
8. **Fullscreen showed a blank `Status` label** — the compatibility status is
   retained.
9. **Focus could be stolen by a pane closing as a side effect** — pending
   toggle focus is cancelled when the newly opened pane takes focus.
10. **Auto-open could reset a user-selected tab** — it now no-ops when the
    inspector or Source is already open.
11. **Stale drawer/inspector/template CSS** was removed after the workbench
    migration.

## 4.2 Stage HUD (1.42.0)

- The HUD appears only while Playback is closed, so it never duplicates the
  full transport. Focus preview closes Playback and peeks the HUD for 1.7 s.
- Controls: play/pause, elapsed/total time, resolution/fps, PNG capture,
  fullscreen. All buttons stop the stage double-click handler.
- Pointer movement/enter/down reveals it; a 1.9 s timer hides it during
  playback. It stays while the stage or HUD has keyboard focus and whenever
  playback is paused.
- It is hidden until the runtime is live, unavailable with Playback open, and
  suppressed in bare/OBS mode. The stats are hidden by a stage container query
  under 440 px so phone buttons do not truncate.

## 4.4 Parameter presets

- PUI's existing `presets`/`storage` contract is adopted for named looks. The
  host owns the values and localStorage; PUI owns the list, Save/Rename name
  forms, Select-to-recall and Delete confirmation.
- Stored at `docsify-isf:presets:<shader-url>` as
  `{presets:[{id,label,values}],selected}`. Media, audio and event inputs are
  intentionally excluded. `persistValues:false` (OBS/bare) disables the store;
  `presets:false` hides the feature.
- Two mounted viewers of the same shader receive a synchronized preset list
  (not each other's live values) without a reload.
- Captures: `desktop-presets.png`; the interaction trace covers the save name
  form, value change, recall, rename name form and label update, delete
  confirmation and removal.

## 4.7 Density pass (1.45.0)

- Title bar starts compact at 41 px; expanding restores the ISF eyebrow and
  description. The page heading remains the document context.
- Parameters: compact PUI rows put labels beside controls; Presets stays above
  the fields. Source slot padding was removed, returning 18 px to the editor.
- Source: one-row tabs + Apply; More moved to the header; compact caret/dot
  title. Folding keeps the editor full-height/width and scrollable. Invalid
  unquoted `data-pui-slot` selectors were fixed.
- PUI upstream 1.16.0/1.16.1 stretches custom slots, compacts inspector density
  and flips menu popovers at the viewport edge.

## 4.6 CI popover geometry (1.44.3)

- A CI-only failure exposed that the editor More popover could be measured
  while the Source drawer was collapsed (zero width). The popover is now
  anchored to its trigger (`position:relative`), and the interaction trace
  asserts the Source pane is open before measuring its bounds.
- Rule: pane-relative bounds are only meaningful when the pane is open; tests
  must check the host state first, especially in narrow one-pane layouts.

## 4.5 Tooltips (1.15.2)

- One delegated manager per PUI mount; flagged controls carry
  `data-pui-tooltip`. Hover 320 ms, focus immediate, touch long-press 450 ms.
- A long press suppresses the release click; the next non-touch pointer press
  clears suppression so a mouse/pen click after a touch tooltip is not
  swallowed.
- Tooltips are hosted on the document body, or the fullscreen element while
  fullscreen is active, and copy the active PUI surface/text/font tokens.
  Position is viewport-clamped and above/below the trigger.
- Escape, scroll, focus-out and a 1.6 s touch timeout dismiss; the original
  `title` is restored.
- Captured at phone width on the titlebar Parameters toggle; the HUD variant is
  covered by the interaction trace.

## 4.8 Parameter groups (1.45.4)

- Large input sets are grouped into PUI disclosures by type: **Media**,
  **Color**, **Geometry**, **Values**, **Constants**. Groups open by default,
  persist through `isf.group.<type>`, and every field keeps its host bind.
- `paramGroups:"auto"` groups at six or more inputs; `"always"` groups every
  material; `false`/`"never"` keeps the flat list. `GROUP`/`input.group` wins
  over the type fallback.
- The smoke test now scrolls the grouped row into view and asserts the pointer
  actually hits the speed slider before dragging; the previous test could grab
  the Playback scrubber when the Parameters pane was scrolled.

## 4.9 Workbench audit (1.45.10)

- The Source header's More trigger is absolutely anchored inside the pane and
  the caret/status leaves room for it; the phone layout hit-tests the trigger
  before opening the menu.
- The keyboard-shortcuts overlay escapes the block's containment while open,
  so it is fixed to the viewport, its Close button is reachable and focused,
  and any stale tooltip is dismissed before the modal appears.
- PUI 1.18.5 gives body-hosted dialogs an opaque surface fallback when the host
  uses transparent embedded surfaces; the mobile command palette is no longer
  see-through.
- PUI 1.18.6 orders preset storage actions **Save, Rename, Delete** and the
  compact single row keeps the destructive action last.
- Added tablet (820 px) and light-theme captures alongside the desktop and
  phone matrix.

## 4.10 Widget geometry on narrow surfaces (PUI 1.18.7)

- XY-pad fields place the pad on its own row with both axis inputs sharing the
  next row; action-like fields and XY-pad rows span the full field grid.
- Multiline textarea/JSON captions align to the top of the control instead of
  centering against a tall block.
- PUI 1.18.7 adds forced-colors token overrides and a committed widget-geometry
  audit. Docsify's desktop/tablet/phone captures were refreshed against it.

## 4.11 Touch targets and switch surfaces (1.45.14)

- The phone audit now checks every visible control against the 32 px target
  floor. The Source More trigger grows from 24 to 32 px, the transport buttons
  from 30 to 32 px, and the transport seek from 20 to 32 px on coarse pointers.
- PUI 1.18.9 keeps compact preset chips at `--pui-touch` size on coarse
  pointers instead of collapsing them to 26 px.
- PUI 1.18.8 modernizes checkbox, radio and switch surfaces; the desktop,
  tablet and phone captures were refreshed against those styles.
- The native colour input is intentionally hidden and excluded from the target
  audit; the swatch button is the measured target.
- The audit now emulates `forced-colors: active` through CDP (Puppeteer does not
  expose it) and captures the desktop workbench with system colours. Host chrome,
  Source/Parameters tabs, presets, transport and PUI fields remain legible.

## 4.12 RGBA picker and Source menu (1.45.15)

- The ISF colour swatch opens PUI's RGBA popover with independent R/G/B/A
  ranges and number inputs, a hex field and a preview button that invokes the
  native system picker. PUI 1.18.10 hosts it on the document/fullscreen top
  layer, fixing the old container-relative position that opened it off-screen.
- The field popover's live channel edits update the swatch immediately; the
  close action commits one host value.
- The Source More menu is raised above the editor, given an opaque surface and
  PUI's bounded scrolling. Its first item and every row are hit-testable while
  the menu scrolls.
- Added desktop and phone captures for both states.

## 4.13 Upstream PUI surfaces and stacking (1.45.16)

- The host no longer re-implements PUI menu backgrounds, borders, shadows,
  scroll bounds or stacking. `.isf-pui .pui` maps `--pui-surface` to the opaque
  docsify surface, so PUI menus use their own tokenized surface.
- PUI 1.18.11/1.18.12 owns workbench pane-title stacking above pane content;
  the Source More menu remains hit-testable over the editor without host
  z-index rules.
- Only docsify-specific alignment and trigger sizing remain in the host.
- Refreshed the audit against PUI 1.18.12.

## 4.14 Body-hosted PUI token scope (1.45.17)

- PUI 1.18.13 gives the RGBA popover the `.pui` style scope and resolves
  host `var(--host-*)` colour tokens before copying them to body-hosted
  surfaces. The picker now uses docsify's accent, PUI range styling and 32 px
  touch targets instead of native blue controls.
- The popover still lives on the document/fullscreen top layer after 1.18.10;
  only the styling scope moved with it.
- Refreshed desktop/phone colour-picker captures.

## 4.15 Camera and microphone media inputs (1.45.18)

- Image inputs now expose **Choose image…** and **Use camera** actions. The
  camera binds a live stream to the selected image input, including transition
  `startImage`/`endImage`, and is re-uploaded as a video texture each draw.
- Microphone actions use real `getUserMedia` + `AnalyserNode` data for
  `audio`/`audioFFT`; the synthetic waveform/spectrum remains the fallback.
- Camera streams stop on toggle, file replacement and viewer disposal. Media
  actions require a secure context (HTTPS or localhost) and browser permission.
- Permission denial, insecure-origin, missing-device and device-in-use failures
  are shown as actionable PUI toasts; the action remains available for retry.

## 4.3 Runtime cost controls

- Workbench state changes are **coalesced to one PUI apply per animation frame**;
  the badge and transport no longer trigger separate applies.
- The editor **More menu is mounted lazily** when Source first opens; a page
  with many viewers otherwise pays for hidden PUI menus.
- Pane state is host-bound through PUI `open_bind`, removing click-listener
  mirroring and its extra state work.
- PUI palette shortcuts are host-scoped to one active viewer, so a page with
  many workbenches never opens multiple palettes.
- Bare/OBS viewers opt out of parameter persistence entirely.
- Initial lazy mount measured **2 PUI workbenches / 4 PUI roots**, with no open
  More menus; off-screen viewers mount only when scrolled into view.

## 5. Remaining opportunities

- **Dockable layout**: Dockview-style docking is unnecessary for the current
  two-pane model; PUI's split panes and focus mode cover it. Revisit only if
  third panes or user-arranged layouts become a requirement.
- **Group-level actions** (collapse/expand all) are not needed at current
  material sizes; the persisted disclosure state and parameter filter cover
  the 8–20 input range.

---

## 6. Reproduce

```bash
node tools/ui-audit.mjs
# captures are written to docs/ui-audit/
```

The script uses Puppeteer/Chrome from `node_modules`; pass `--chrome PATH` or
set `CHROME_PATH` when Chrome is not in the default macOS location.
