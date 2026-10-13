#!/usr/bin/env node
/*
 * Headless frame renderer test.
 *
 *   node tests/frame-tool.mjs
 *
 * Proves that tools/render-frame.mjs is deterministic (same options →
 * byte-identical PNG), that time/inputs/parent frames actually change the
 * output, and that the comparison metric behaves (identical → MAE 0,
 * different → MAE > 0). Requires Chrome/Chromium and `npm install`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderSession, renderFrames } from "../tools/render-frame.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "isf-frames-"));

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
    if (ok) {
        passed++;
        process.stdout.write("  ok  " + name + "\n");
    } else {
        failed++;
        process.stdout.write("FAIL  " + name + (detail ? " — " + detail : "") + "\n");
    }
}

function pngSize(file) {
    const buffer = fs.readFileSync(file);
    if (buffer.slice(1, 4).toString() !== "PNG") return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), bytes: buffer.length };
}

const plasma = path.join(ROOT, "samples", "plasma.fs");
const kaleidoscope = path.join(ROOT, "samples", "kaleidoscope.fs");
const session = await createRenderSession({});
try {
    const base = {
        session,
        targets: [{ file: plasma, slug: "plasma", kind: null }],
        outDir: OUT,
        width: 160,
        height: 90,
        time: 1.5,
        quiet: true
    };

    const first = await renderFrames(Object.assign({}, base, { out: path.join(OUT, "plasma-1.5.png") }));
    const second = await renderFrames(base);
    check("same options render byte-identical frames", first.entries[0].sha256 === second.entries[0].sha256,
        first.entries[0].sha256 + " vs " + second.entries[0].sha256);
    const size = pngSize(first.entries[0].png);
    check("frame is a 160x90 PNG", !!size && size.width === 160 && size.height === 90,
        size ? size.width + "x" + size.height : "not a PNG");
    check("checksum is reported", /^[0-9a-f]{64}$/.test(first.entries[0].sha256 || ""));

    const later = await renderFrames(Object.assign({}, base, { time: 3.0, out: path.join(OUT, "plasma-3.0.png") }));
    check("a different time changes the frame", later.entries[0].sha256 !== first.entries[0].sha256);

    // Feedback shaders keep buffer history, so the number of virtual steps
    // matters for them (and must still be deterministic).
    const feedback = path.join(ROOT, "samples", "feedback.fs");
    const feedbackBase = Object.assign({}, base, { targets: [{ file: feedback, slug: "feedback", kind: null }] });
    const oneStep = await renderFrames(Object.assign({}, feedbackBase, { steps: 1 }));
    const manySteps = await renderFrames(Object.assign({}, feedbackBase, { steps: 5 }));
    const manyStepsAgain = await renderFrames(Object.assign({}, feedbackBase, { steps: 5 }));
    check("stepped renders are deterministic", manySteps.entries[0].sha256 === manyStepsAgain.entries[0].sha256);
    check("stepping changes a feedback shader's history",
        oneStep.entries[0].sha256 !== manySteps.entries[0].sha256,
        oneStep.entries[0].error || manySteps.entries[0].error || "");

    const inputFrame = await renderFrames(Object.assign({}, base, { inputs: { speed: 0.1 } }));
    check("input overrides reach the shader", inputFrame.entries[0].sha256 !== first.entries[0].sha256 &&
        inputFrame.entries[0].inputs && inputFrame.entries[0].inputs.speed === 0.1,
        JSON.stringify(inputFrame.entries[0].inputs));

    const sameCompare = await renderFrames(Object.assign({}, base, { compare: first.entries[0].png }));
    check("comparing a frame with itself is MAE 0", sameCompare.entries[0].compare.mae === 0 &&
        sameCompare.entries[0].compare.identical === true, JSON.stringify(sameCompare.entries[0].compare));

    const diffCompare = await renderFrames(Object.assign({}, base, { compare: later.entries[0].png }));
    check("comparing different frames reports MAE > 0", diffCompare.entries[0].compare.mae > 0 &&
        diffCompare.entries[0].compare.diffRatio > 0, JSON.stringify(diffCompare.entries[0].compare));

    const strictFail = await renderFrames(Object.assign({}, base, {
        compare: later.entries[0].png, strict: true, maxMae: 0.01
    }));
    check("strict mode fails above max MAE", strictFail.exitCode === 1 && strictFail.summary.strictFailures === 1);

    const filterBase = {
        session,
        targets: [{ file: kaleidoscope, slug: "kaleidoscope", kind: null }],
        outDir: OUT,
        width: 160,
        height: 90,
        time: 1.5,
        quiet: true
    };
    const filterDefault = await renderFrames(filterBase);
    const parentFrame = "data:image/png;base64," + fs.readFileSync(first.entries[0].png).toString("base64");
    const filterParent = await renderFrames(Object.assign({}, filterBase, { parentFrame }));
    const filterParentAgain = await renderFrames(Object.assign({}, filterBase, { parentFrame }));
    check("filters render with the built-in image", !filterDefault.entries[0].error);
    check("a parent frame changes the filter output",
        !filterParent.entries[0].error && filterParent.entries[0].sha256 !== filterDefault.entries[0].sha256,
        filterParent.entries[0].error || "");
    check("parent-frame renders are deterministic",
        filterParent.entries[0].sha256 === filterParentAgain.entries[0].sha256);

    const report = await renderFrames(Object.assign({}, base, { dryRun: true }));
    check("dry runs render without writing", !report.entries[0].png && report.entries[0].sha256 === first.entries[0].sha256);
} finally {
    await session.close();
}

fs.rmSync(OUT, { recursive: true, force: true });
if (failed) {
    process.stdout.write("\nframe-tool: " + failed + " failure(s), " + passed + " passed\n");
    process.exit(1);
}
process.stdout.write("\nframe-tool: " + passed + " passed, 0 failed\n");
