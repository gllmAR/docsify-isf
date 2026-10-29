#!/usr/bin/env node
/* ============================================================================
 * docsify-isf — pupitre-ui vendor sync
 *
 * Copies the build-free PUI renderer and the ISF→PUI adapter from a
 * pupitre-ui checkout into vendor/pupitre-ui/, and records their hashes in
 * vendor/pupitre-ui/SOURCE.json so drift is detectable without the sibling
 * checkout.
 *
 *   node tools/sync-pupitre-ui.mjs                 # copy from ../pupitre-ui
 *   PUPITRE_UI_DIR=/path/to/pupitre-ui node tools/...
 *   node tools/sync-pupitre-ui.mjs --check         # verify vendored snapshot
 *
 * Do not edit the vendored files: change pupitre-ui, re-run this script, and
 * rebuild the artifact (node tools/build.mjs).
 * ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'pupitre-ui');
const SOURCE_FILE = path.join(VENDOR, 'SOURCE.json');
const CHECK = process.argv.includes('--check');

const FILES = [
    {vendored: 'pupitre-ui.js', upstream: 'dist/pupitre-ui.js'},
    {vendored: 'pupitre-ui.css', upstream: 'dist/pupitre-ui.css'},
    {vendored: 'isf.js', upstream: 'examples/adapters/isf.js'}
];

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findSource() {
    const candidates = [
        process.env.PUPITRE_UI_DIR,
        path.join(ROOT, '..', 'pupitre-ui'),
        path.join(ROOT, '..', '..', '..', '_codeberg', 'gllm', 'pupitre-ui')
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, 'VERSION')) && fs.existsSync(path.join(candidate, 'dist', 'pupitre-ui.js'))) {
            return path.resolve(candidate);
        }
    }
    return null;
}

function gitRevision(dir) {
    try {
        return {
            commit: execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).trim(),
            dirty: execFileSync('git', ['-C', dir, 'status', '--porcelain'], {encoding: 'utf8'}).trim().length > 0
        };
    } catch {
        return null;
    }
}

function readSource() {
    const source = findSource();
    if (!source) return null;
    const revision = gitRevision(source);
    return {
        dir: source,
        version: fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim(),
        commit: revision ? revision.commit : '',
        dirty: revision ? revision.dirty : false
    };
}

function snapshot(source) {
    const files = {};
    for (const entry of FILES) files[entry.vendored] = sha256(path.join(VENDOR, entry.vendored));
    const previous = source ? null : JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
    const record = {
        note: 'Vendored from pupitre-ui by tools/sync-pupitre-ui.mjs — never edit these files; re-sync and rebuild instead.',
        source: 'https://codeberg.org/gllm/pupitre-ui',
        version: source ? source.version : previous.version,
        files
    };
    if (source && source.commit) {
        record.commit = source.commit;
        if (source.dirty) record.dirty = true;
    } else if (previous && previous.commit) {
        record.commit = previous.commit;
        if (previous.dirty) record.dirty = true;
    }
    return record;
}

function verifyVendored() {
    if (!fs.existsSync(SOURCE_FILE)) return ['missing vendor/pupitre-ui/SOURCE.json'];
    const record = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
    const problems = [];
    for (const entry of FILES) {
        const file = path.join(VENDOR, entry.vendored);
        if (!fs.existsSync(file)) { problems.push('missing ' + entry.vendored); continue; }
        if (record.files[entry.vendored] !== sha256(file)) problems.push(entry.vendored + ': hash does not match SOURCE.json');
    }
    return problems;
}

if (CHECK) {
    const problems = verifyVendored();
    if (!problems.length) {
        const source = readSource();
        if (source) {
            for (const entry of FILES) {
                const upstream = path.join(source.dir, entry.upstream);
                if (!fs.existsSync(upstream)) { problems.push('upstream missing ' + entry.upstream); continue; }
                if (sha256(upstream) !== sha256(path.join(VENDOR, entry.vendored))) {
                    problems.push(entry.vendored + ': differs from ' + source.dir + ' — run node tools/sync-pupitre-ui.mjs');
                }
            }
        }
    }
    if (problems.length) {
        console.log('sync-pupitre-ui --check: FAIL\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    console.log('sync-pupitre-ui --check: vendored snapshot is current');
    process.exit(0);
}

const source = readSource();
if (!source) {
    console.log('sync-pupitre-ui: no pupitre-ui checkout found (set PUPITRE_UI_DIR) — vendored files left untouched');
    const problems = verifyVendored();
    if (problems.length) {
        console.log('  ' + problems.join('\n  '));
        process.exit(1);
    }
    process.exit(0);
}

fs.mkdirSync(VENDOR, {recursive: true});
for (const entry of FILES) {
    const upstream = path.join(source.dir, entry.upstream);
    if (!fs.existsSync(upstream)) {
        console.log('sync-pupitre-ui: missing ' + upstream);
        process.exit(1);
    }
    fs.copyFileSync(upstream, path.join(VENDOR, entry.vendored));
}
fs.writeFileSync(SOURCE_FILE, JSON.stringify(snapshot(source), null, 2) + '\n');
console.log('sync-pupitre-ui: vendored pupitre-ui v' + source.version + ' from ' + source.dir);
