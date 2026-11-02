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
- **Adaptive by default.** The same workbench must work with mouse, keyboard and
  touch at desktop and phone widths. Workbench/controls need 32px+ targets.
- **Verify the whole use.** `npm test` for the contract, `npm run test:smoke`
  for mounting/features, and `npm run test:interaction` for the full click/touch
  trace plus screenshots. `node tools/ui-audit.mjs` refreshes the committed
  review captures.
- **Update the record.** Version bumps, README/SDD, UI audit, CHANGELOG where
  present and the PUI consumer record must agree.

## Commands

```bash
npm test                       # unit/adapter/PUI document checks
npm run test:smoke             # browser smoke
npm run test:interaction       # full workbench action trace
node tools/ui-audit.mjs        # docs/ui-audit captures
npm run build:check            # bundle is current
npm run test:vendor            # PUI snapshot matches SOURCE.json
PUPITRE_UI_DIR=/tmp/pui-<sha> npm run test:vendor
```

Sync is **only** from a clean PUI worktree/tag:

```bash
cd ../../../_codeberg/gllm/pupitre-ui
git worktree add --detach /tmp/pui-release <clean-sha>
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
  actions/More/Templates, transport, focus, fullscreen and touch taps.
- Interaction screenshots are written to `tests/artifacts/interaction/` and
  uploaded by CI.
