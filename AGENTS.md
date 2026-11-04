# AGENTS.md — docsify-isf

This repository is the **single-file docsify plugin** that turns ISF links into
an interactive WebGL workbench. It is also the reference consumer of the
vendored Pupitre UI toolkit.

Start with the root [`../AGENTS.md`](../AGENTS.md), then:

1. `README.md` — consumer/config/API documentation.
2. `SDD.md` — architecture and invariants.
3. `docs/UI_ERGONOMICS.md` — the committed UI audit and design decisions.
4. `vendor/pupitre-ui/` — the pinned PUI snapshot; **never edit vendored files**.
5. `spec/` in the sibling `pupitre-ui` repo — the toolkit contract.

## Golden rules

- **PUI upstream first.** If the workbench needs a generic layout/toolbar/pane
  capability, implement it in `../../../_codeberg/gllm/pupitre-ui`, add tests,
  spec/schema/fixture updates, tag the release and then re-sync the vendor here.
  Host-specific ISF behavior stays in `src/plugin.src.js`.
- **One workbench, one renderer.** `docsify-isf.js` is generated from
  `src/plugin.src.js`; never edit the bundle directly. PUI owns the workbench
  chrome; the host owns WebGL, ISF values, the code editor, imports and file IO.
- **No dead chrome.** The old PUI header/drawer/status implementations have
  been retired. Keep the fallback host header/status/stage until the workbench
  mounts, and for error states.
- **One Parameters pane / contextual panes.** At most one Parameters pane is
  open across viewers; Source is independent; auto-open only happens for the
  in-view viewer and never steals.
- **Space is a feature.** Prefer icon actions with accessible names/tooltips,
  one-row toolbars, compact transport strips and hidden unavailable controls.
- **Command palette is host-scoped.** One document shortcut resolves the active
  viewer and opens that PUI workbench palette; never enable a global PUI palette
  shortcut on every viewer instance.
- **Keep chrome work coalesced.** Workbench `apply()` runs at most once per
  animation frame; lazy-mount the editor More menu and avoid per-tick duplicate
  applies. Space defaults: one-line description, compact playback strip.
- **Adaptive by default.** The same workbench must work with mouse, keyboard and
  touch at desktop and phone widths. Workbench/controls need 32px+ targets.
  Phones use **one full-width side drawer at a time**; never leave the stage as
  a thin sliver or stack both side drawers. The selected pane tab must be
  visibly selected.
- **Overlays stay in their surface.** Keyboard help is a workbench-level modal,
  not a stage popover; the editor More menu must anchor inside the Source pane.
  Menu/More test queries are scoped to the current workbench, never global
  `.pui-actions` lookups on a multi-viewer docsify page.
- **Focus follows the opened surface.** When opening one pane closes another,
  cancel the closed pane's deferred toggle focus. Auto-open never resets a
  user-selected tab and never steals from an already-open Source/Parameters
  pane.
- **Presets use PUI’s storage contract.** The host stores non-media values per
  shader URL and owns save/recall/delete semantics; PUI owns the preset list,
  name form and delete confirmation. Never persist media/event inputs in a
  preset. Presets must stay titled/confirmed, support rename, and survive both
  viewers of the same shader.
- **The Source editor fills and scrolls.** Never pin the folded editor to a
  captured width/height; it must follow pane resizes and scroll its textarea.
  The Source toolbar is one row with tabs + Apply; secondary actions live in
  the Source header. Regression checks cover fold, width and scroll.
- **Popover geometry is a contract.** Anchor host popovers to their trigger and
  keep them inside their pane/viewport. Tests that measure pane-relative
  geometry must first assert the pane is open with non-zero width; CI can enter
  the narrow one-pane mode.
- **Tooltips are PUI-owned.** Flag icon-only controls with
  `data-pui-tooltip`; PUI 1.18.14 provides hover/focus/long-press labels, touch
  click suppression, theme-token copying and document/fullscreen hosting. Never
  add a second tooltip manager per viewer. A long press must not activate the
  control, and a following mouse/pen press must not stay suppressed.
- **Stage HUD complements, never duplicates, Playback.** The HUD is available
  only while the Playback strip is closed (including Focus preview); it carries
  play/pause, time, stats, capture and fullscreen. Keep it keyboard reachable,
  auto-hiding during pointer playback, stats-free below 440 px, and hidden in
  OBS/bare mode. HUD buttons must stop stage double-click propagation.
- **Verify the whole use.** `npm test` for the contract, `npm run test:coverage`
  for ES1→ES3 compilation, `npm run test:smoke` for mounting/features,
  `npm run test:frame` for deterministic off-screen captures, and
  `npm run test:interaction` for the full click/touch trace plus screenshots. `node tools/ui-audit.mjs` refreshes the committed review
  captures.
- **Update the record.** Version bumps, README/SDD, UI audit, CHANGELOG where
  present and the PUI consumer record must agree. `SOURCE.json` records the
  release tag and commit; `npm run test:vendor` verifies the tag matches the
  vendored version.

## Commands

```bash
npm test                       # unit/adapter/PUI document checks
npm run test:coverage          # committed samples + bundled OBS corpus in ES1/ES3
npm run test:smoke             # browser smoke
npm run test:frame             # deterministic headless frame capture/compare
npm run test:interaction       # full workbench action trace
node tools/ui-audit.mjs        # docs/ui-audit captures
npm run build:check            # bundle is current
npm run test:vendor            # PUI snapshot matches SOURCE.json
PUPITRE_UI_DIR=/tmp/pui-<version> npm run test:vendor
```

Sync is **only** from a clean PUI release tag; the sync script rejects a dirty
worktree or a HEAD that is not exactly the `v<VERSION>` tag:

```bash
cd ../../../_codeberg/gllm/pupitre-ui
git worktree add --detach /tmp/pui-release vX.Y.Z
cd ../../../_github/gllmar/docsify-isf
PUPITRE_UI_DIR=/tmp/pui-release node tools/sync-pupitre-ui.mjs
PUPITRE_UI_DIR=/tmp/pui-release node tools/sync-pupitre-ui.mjs --check
npm run build
```

## Tests that matter

- `tests/run.js` — parser/evaluator/compiler/importers/samples.
- `tests/pui-params.test.js` — ISF → PUI adapter and vendored snapshot.
- `tests/browser-smoke.mjs` — all viewers, auto-open, filter, tabs, menu,
  transport, fullscreen, phone overlays, OBS bare and fallback errors.
- `tests/browser-interaction.mjs` — complete desktop/mobile workbench trace:
  every pane/tab, menu/direct action, parameter family, filter, editor
  actions/More/Templates, transport, presets, focus/HUD controls, tooltips,
  fullscreen and touch taps.
- Interaction screenshots are written to `tests/artifacts/interaction/` and
  uploaded by CI.
