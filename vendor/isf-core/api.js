/* ============================================================================
 * Vendored ISF core — public API surface for the plugin bundle.
 *
 * Re-exports the canonical kernel as namespaced modules so the adapter can
 * use `ISFCore.parse.*`, `ISFCore.compat.*`, `ISFCore.generators.*` and
 * without flat-name collisions (parse.js and compat.js
 * both export `rewriteLibraryCalls`, `collectUserFunctions`, …).
 *
 * Generated/curated by hand; the files next to it are synced from the parent
 * repository with `node scripts/isf-plugin-sync.mjs`.
 * ========================================================================= */
import * as parse from './parse.js';
import * as compat from './compat.js';
import * as generators from './generators.js';
import * as render from './render.js';

const api = { parse, compat, generators, render };
export default api;
