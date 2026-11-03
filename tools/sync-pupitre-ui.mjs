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
 * Sync requires a clean worktree checked out exactly at `v<VERSION>`; the
 * SOURCE.json record names that tag and the tagged commit. The check also
 * accepts a clean main checkout when the release tag is an ancestor.
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

function git(dir, args) {
    return execFileSync('git', ['-C', dir].concat(args), {encoding: 'utf8'}).trim();
}

function gitRevision(dir) {
    try {
        return {
            commit: git(dir, ['rev-parse', '--short', 'HEAD']),
            dirty: git(dir, ['status', '--porcelain']).length > 0,
            tags: git(dir, ['tag', '--points-at', 'HEAD']).split('\n').filter(Boolean)
        };
    } catch {
        return null;
    }
}

function tagCommit(dir, tag) {
    try {
        return git(dir, ['rev-parse', '--short', 'refs/tags/' + tag + '^{commit}']);
    } catch {
        return null;
    }
}

function readSource() {
    const source = findSource();
    if (!source) return null;
    const version = fs.readFileSync(path.join(source, 'VERSION'), 'utf8').trim();
    const revision = gitRevision(source);
    return {
        dir: source,
        version: version,
        releaseTag: 'v' + version,
        tagCommit: tagCommit(source, 'v' + version),
        commit: revision ? revision.commit : '',
        dirty: revision ? revision.dirty : false,
        tags: revision ? revision.tags : []
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
        tag: source ? source.releaseTag : previous.tag,
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

function verifyVendored(source) {
    if (!fs.existsSync(SOURCE_FILE)) return ['missing vendor/pupitre-ui/SOURCE.json'];
    const record = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
    const problems = [];
    if (record.tag !== 'v' + record.version) {
        problems.push('SOURCE.json must name the release tag v' + record.version + ' (found ' + JSON.stringify(record.tag) + ')');
    }
    if (!/^[0-9a-f]{7,40}$/.test(record.commit || '')) {
        problems.push('SOURCE.json must record the tagged commit');
    }
    for (const entry of FILES) {
        const file = path.join(VENDOR, entry.vendored);
        if (!fs.existsSync(file)) { problems.push('missing ' + entry.vendored); continue; }
        if (record.files[entry.vendored] !== sha256(file)) problems.push(entry.vendored + ': hash does not match SOURCE.json');
    }
    if (source) {
        if (source.version !== record.version) {
            problems.push('source VERSION ' + source.version + ' does not match SOURCE.json ' + record.version);
        }
        if (!source.tagCommit) {
            problems.push('source has no ' + source.releaseTag + ' tag');
        } else if (!record.commit.startsWith(source.tagCommit) && !source.tagCommit.startsWith(record.commit)) {
            problems.push('SOURCE.json commit ' + record.commit + ' does not match ' + source.releaseTag + ' -> ' + source.tagCommit);
        }
    }
    return problems;
}

if (CHECK) {
    const source = readSource();
    const problems = verifyVendored(source);
    if (source) {
        for (const entry of FILES) {
            const upstream = path.join(source.dir, entry.upstream);
            if (!fs.existsSync(upstream)) { problems.push('upstream missing ' + entry.upstream); continue; }
            if (sha256(upstream) !== sha256(path.join(VENDOR, entry.vendored))) {
                problems.push(entry.vendored + ': differs from ' + source.dir + ' — run node tools/sync-pupitre-ui.mjs');
            }
        }
    }
    if (problems.length) {
        console.log('sync-pupitre-ui --check: FAIL\n  ' + problems.join('\n  '));
        process.exit(1);
    }
    const label = source ? source.releaseTag : JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8')).tag;
    console.log('sync-pupitre-ui --check: vendored snapshot is current (' + label + ')');
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

if (source.dirty) {
    console.log('sync-pupitre-ui: source worktree is dirty — commit/stash before syncing');
    process.exit(1);
}
if (!source.tags.includes(source.releaseTag)) {
    console.log('sync-pupitre-ui: source is not checked out at ' + source.releaseTag +
        ' (HEAD ' + source.commit + ') — use a clean tag worktree');
    process.exit(1);
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
