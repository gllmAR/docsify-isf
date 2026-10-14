/* ============================================================================
 * Toolkit — module bundler
 *
 * PM editors are written as ES modules (clean imports, unit-testable under
 * Node). Browsers refuse ES modules from file://, and the editors must keep
 * working by double-clicking index.html — so this script concatenates the
 * modules into one classic script that the page loads. Each editor has a tiny
 * tools/bundle.mjs that calls `runBundleCli({...})`; tests check the committed
 * bundle is up to date (`--check`).
 *
 * Deliberately tiny, for our own module style:
 *   - imports are top-level and relative
 *   - re-exports (`export { a } from './x.js'`) are supported
 *   - exports are `export function/const/class NAME` or `export default X`
 *   - an optional classic "core" script can be injected as the `core` module
 *
 *   import { runBundleCli } from '../ui/tools/bundle.mjs';
 *   runBundleCli({
 *     root: path.dirname(fileURLToPath(import.meta.url)) + '/..',
 *     core: { file: 'pm-mpcdi-core.js', global: 'PMMpcdiCore' },
 *     modules: ['ui/ui.js', 'app/main.js'],
 *     out: 'pm-mpcdi-editor.bundle.js',
 *     header: 'PM MPCDI editor — generated bundle. Do not edit; run: node tools/bundle.mjs',
 *     start: 'app/main.js',          // auto-started when #app exists
 *     expose: 'PMUI',                // window.<name> for demos/console
 *   });
 * ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';

/* ── module transform ───────────────────────────────────────────────────── */

function makeResolver(core) {
  const coreBase = core ? path.posix.basename(core.file) : null;
  return (fromId, spec) => {
    // any spec pointing at the classic core script maps to the 'core' module,
    // whatever the relative depth (./, ../, bare name)
    if (coreBase && path.posix.basename(spec) === coreBase) return 'core';
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec));
  };
}

function transform(id, source, resolveId) {
  // collapse multi-line import/export lists onto one line
  source = source.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (m, names, spec) => `import {${names.replace(/\s+/g, ' ')}} from '${spec}';`);
  source = source.replace(/export\s*\{([\s\S]*?)\}\s*;?/g,
    (m, names) => `export {${names.replace(/\s+/g, ' ')}};`);
  const exports = new Set();
  const declared = new Set(); // locals already bound (imports), so re-exports don't redeclare
  const lines = source.split('\n');
  const out = [];

  for (const line of lines) {
    const imp = line.match(/^\s*import\s+(.+?)\s+from\s+['"](.+?)['"];?\s*$/);
    if (imp) {
      const target = resolveId(id, imp[2]);
      const clause = imp[1].trim();
      if (/^\*\s+as\s+/.test(clause)) {
        const local = clause.replace(/^\*\s+as\s+/, '').trim();
        declared.add(local);
        out.push(`  const ${local} = __modules['${target}'];`);
        continue;
      }
      if (clause.startsWith('{')) {
        const names = clause.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
          .map((s) => (s.includes(' as ') ? s.split(' as ').map((x) => x.trim()).join(': ') : s));
        for (const n of names) declared.add(n.includes(':') ? n.split(':').pop().trim() : n);
        out.push(`  const { ${names.join(', ')} } = __modules['${target}'];`);
      } else {
        declared.add(clause);
        out.push(`  const ${clause} = __modules['${target}'].default !== undefined ? __modules['${target}'].default : __modules['${target}'];`);
      }
      continue;
    }
    if (/^\s*import\s+['"]/.test(line)) continue;

    // re-export: `export { a, b as c } from './x.js';` — bind the names the
    // module has not imported itself, then register them as bundle exports
    const reexp = line.match(/^\s*export\s*\{([^}]*)\}\s*;?\s*from\s*['"]([^'"]+)['"];?\s*$/);
    if (reexp) {
      const target = resolveId(id, reexp[2]);
      const names = reexp[1].split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => (s.includes(' as ') ? s.split(' as ').map((x) => x.trim()).join(': ') : s));
      const local = (n) => n.split(':').pop().trim();
      const need = names.filter((n) => !declared.has(local(n)));
      if (need.length) out.push(`  const { ${need.join(', ')} } = __modules['${target}'];`);
      for (const n of names) { declared.add(local(n)); exports.add(local(n)); }
      continue;
    }

    const def = line.match(/^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/);
    if (def) { out.push(`  const __default = ${def[1]};`); continue; }

    const named = line.match(/^\s*export\s+(?:async\s+)?(function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/);
    if (named) {
      exports.add(named[2]);
      out.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    const list = line.match(/^\s*export\s*\{([^}]*)\}\s*;?\s*$/);
    if (list) {
      for (const n of list[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        exports.add(n.split(' as ').pop().trim());
      }
      continue;
    }
    out.push(line);
  }

  const exportList = [...exports];
  const body = out.join('\n');
  const returns = [];
  if (exportList.length) returns.push(`    ${exportList.join(', ')}`);
  if (/__default/.test(body)) returns.push('    default: __default');
  return `__modules['${id}'] = (function () {\n${body}\n  return {\n${returns.join(',\n')}\n  };\n})();\n`;
}

/* ── build ──────────────────────────────────────────────────────────────── */

export function buildBundle(opts) {
  const { root, modules } = opts;
  const core = opts.core || null;
  const resolveId = makeResolver(core);
  const parts = [];
  const NL = String.fromCharCode(10);

  // Fail loudly on imports that are not in the module list: silently emitting
  // `__modules['missing']` produces a bundle that crashes at runtime, and the
  // byte-for-byte drift check cannot see it.
  const ids = new Set(modules);
  for (const id of modules) {
    const source = fs.readFileSync(path.join(root, id), 'utf8');
    const specs = [];
    // only real import statements: `import … from '…'` and `import '…'`.
    // Matching a bare `from '…'` also caught string concatenation such as
    // `'Remove "' + name + '" from ' + scene + '?'`.
    for (const m of source.matchAll(/^\s*import\s+(?:[\w*\s{},$]*?)\s*from\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
    for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.push(m[1]);
    for (const spec of specs) {
      const target = resolveId(id, spec);
      if (target !== 'core' && !ids.has(target)) {
        throw new Error('bundle: ' + id + ' imports ' + spec + ' (' + target
          + ') which is not in the modules list');
      }
      // dependencies must be listed before their importer: the bundle
      // executes the module IIFEs in order, so a later dependency is
      // undefined at destructuring time (a runtime-only failure)
      if (target !== 'core' && modules.indexOf(target) > modules.indexOf(id)) {
        throw new Error('bundle: ' + id + ' imports ' + spec + ' (' + target
          + ') which is listed after it; move it earlier in the modules list');
      }
    }
  }

  parts.push([
    `/* ${opts.header || 'generated bundle — do not edit'} */`,
    '(function () {',
    "  'use strict';",
    '  var __modules = {};',
    '',
  ].join(NL));

  if (core) {
    parts.push([
      '  // classic core script: the page loads it, the bundle only defines it',
      '  // when missing (Node tests)',
      `  if (typeof ${core.global} === 'undefined') {`,
      fs.readFileSync(path.join(root, core.file), 'utf8')
        .replace(`var ${core.global} =`, `${core.global} =`)
        .split(NL).map((l) => '  ' + l).join(NL),
      '  }',
      `  __modules['core'] = ${core.global};`,
      '',
    ].join(NL));
  }

  for (const id of modules) {
    const source = fs.readFileSync(path.join(root, id), 'utf8');
    parts.push(`\n  // ── ${id} ${'─'.repeat(Math.max(0, 60 - id.length))}\n`);
    parts.push(transform(id, source, resolveId));
  }

  // single-module classic artifact: expose the module's exports under one
  // global (used by the no-build pages, e.g. ui/theme.classic.js)
  const exposeModule = opts.exposeModule
    ? `  if (typeof window !== 'undefined') { window.${opts.exposeModule.name} = __modules['${opts.exposeModule.module}']; }${NL}`
    : '';

  // window.<name> for demos/console: resolve each key to the module id that
  // actually registered it (paths differ per editor)
  const findId = (suffix) => modules.find((id) => id.endsWith(suffix));
  const expose = opts.expose
    ? `  if (typeof window !== 'undefined') { window.${opts.expose} = {
    ui: __modules['${findId('ui/ui.js')}'],
    controls: __modules['${findId('ui/controls.js')}'],
    canvas: __modules['${findId('ui/canvas.js')}'],
    obs: {
      client: __modules['${findId('obs/client.js')}'],
      discover: __modules['${findId('obs/discover.js')}'],
      bar: __modules['${findId('obs/bar.js')}'],
    },
  }; }\n`
    : '';

  const autoStart = opts.start
    ? `  // auto-start (index.html has #app)${NL}  if (typeof document !== 'undefined' && document.getElementById('app')) {${NL}    __modules['${opts.start}'].start();${NL}  }${NL}`
    : '';
  parts.push(NL + expose + exposeModule + autoStart + '})();');
  return parts.join('');
}

/* ── CLI ────────────────────────────────────────────────────────────────── */

export function runBundleCli(opts, argv = process.argv) {
  const target = path.join(opts.root, opts.out);
  const bundle = buildBundle(opts);
  if (argv.includes('--check')) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== bundle) {
      console.error(opts.out + ' is stale — run: node tools/bundle.mjs');
      process.exit(1);
    }
    console.log('bundle is up to date (' + bundle.length + ' bytes)');
    return false;
  }
  fs.writeFileSync(target, bundle);
  console.log('wrote ' + path.relative(process.cwd(), target) + ' (' + bundle.length + ' bytes)');
  return true;
}
