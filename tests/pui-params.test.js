#!/usr/bin/env node
/*
 * docsify-isf — PUI parameter panel checks (no browser, no dependencies).
 *
 * The parameter drawer is generated through the vendored Pupitre UI toolkit:
 * this suite proves the vendored snapshot is intact, that every normalised ISF
 * input maps to a PUI control for every committed sample, and that the adapter
 * round-trips values (pairs, colour, events, media).
 *
 *   node tests/pui-params.test.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const isf = require(path.join(__dirname, "..", "docsify-isf.js"));
const {VERSION, PupitreUI, PupitreISF} = isf;

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        process.stdout.write("  ok  " + name + "\n");
    } catch (error) {
        failed++;
        failures.push({name, error});
        process.stdout.write("FAIL  " + name + "\n");
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || "Assertion failed");
}

function equal(actual, expected, message) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) throw new Error((message || "Values differ") + "\n  actual:   " + a + "\n  expected: " + b);
}

const root = path.join(__dirname, "..");
const samplesDir = path.join(root, "samples");
const puiDir = path.join(root, "vendor", "pupitre-ui");

/* --------------------------------------------------------- vendored toolkit */

console.log("\n# Vendored Pupitre UI");

test("the vendored snapshot is present and hashed", () => {
    const record = JSON.parse(fs.readFileSync(path.join(puiDir, "SOURCE.json"), "utf8"));
    assert(/^\d+\.\d+\.\d+$/.test(record.version), "SOURCE.json version");
    for (const [name, expected] of Object.entries(record.files)) {
        const file = path.join(puiDir, name);
        assert(fs.existsSync(file), "missing " + name);
        const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        equal(actual, expected, name + " hash (run node tools/sync-pupitre-ui.mjs)");
    }
});

test("the artifact exposes the shared renderer and ISF adapter", () => {
    assert(PupitreUI && typeof PupitreUI.create === "function", "PupitreUI");
    assert(PupitreISF && typeof PupitreISF.createDocument === "function", "PupitreISF");
    equal(PupitreUI.version, JSON.parse(fs.readFileSync(path.join(puiDir, "SOURCE.json"), "utf8")).version);
});

test("PUI is the default parameter panel and legacy stays selectable", () => {
    const config = isf.getConfig();
    equal(config.ui, "pui");
    const previous = global.window;
    global.window = {$docsify: {isf: {ui: "legacy"}}};
    try {
        equal(isf.getConfig().ui, "legacy");
        global.window.$docsify.isf.ui = false;
        equal(isf.getConfig().ui, "legacy", "ui:false selects the legacy panel");
        global.window.$docsify.isf.ui = true;
        equal(isf.getConfig().ui, "pui", "ui:true selects PUI");
        global.window.$docsify.isf.ui = "bogus";
        equal(isf.getConfig().ui, "pui", "unknown ui values fall back to pui");
    } finally {
        if (previous === undefined) delete global.window;
        else global.window = previous;
    }
});

/* ----------------------------------------------- sample → PUI document */

function blocksOf(document) {
    const section = document.panels[0].pages[0].sections[0];
    const fields = [];
    const actions = [];
    const readouts = [];
    for (const block of section.blocks) {
        if (block.kind === "field") fields.push(block);
        else if (block.kind === "readout") readouts.push(block);
        else if (block.kind === "actions") actions.push(...block.items);
    }
    return {fields, actions, readouts};
}

function sampleFiles() {
    return fs.readdirSync(samplesDir).filter((name) => name.endsWith(".fs")).sort();
}

function sampleInputs(name) {
    const parsed = isf.parseISF(fs.readFileSync(path.join(samplesDir, name), "utf8"));
    if (!parsed.valid) return null;
    const built = isf.buildShader(parsed, {});
    return built.inputs;
}

const expectations = {
    float: (input, built) => built.fields.some((field) => field.bind === "/isf/" + input.name && field.widget === "range"),
    bool: (input, built) => built.fields.some((field) => field.bind === "/isf/" + input.name && field.widget === "switch"),
    event: (input, built) => built.fields.some((field) => field.bind === "/isf/" + input.name && field.widget === "button"),
    long: (input, built) => built.fields.some((field) => field.bind === "/isf/" + input.name &&
        (field.widget === (input.values && input.values.length ? "select" : "number"))),
    color: (input, built) => built.fields.some((field) => field.bind === "/isf/" + input.name && field.widget === "color"),
    point2D: (input, built) => ["x", "y"].every((axis) => built.fields.some((field) => field.bind === "/isf/" + input.name + "/" + axis)),
    floatRange: (input, built) => ["min", "max"].every((axis) => built.fields.some((field) => field.bind === "/isf/" + input.name + "/" + axis)),
    image: (input, built) => built.actions.some((item) => item.call === "isf.choose_image" && item.args.name === input.name),
    // One microphone toggle covers every audio input; each input keeps its
    // own source readout.
    audio: (input, built) => built.actions.some((item) => item.call === "isf.toggle_microphone") &&
        built.readouts.some((block) => block.bind === "/isf/" + input.name + "/source"),
    audioFFT: (input, built) => built.actions.some((item) => item.call === "isf.toggle_microphone") &&
        built.readouts.some((block) => block.bind === "/isf/" + input.name + "/source")
};

console.log("\n# Sample headers → PUI");

test("every committed sample generates a valid PUI document", () => {
    const files = sampleFiles();
    assert(files.length >= 10, "expected the self-test corpus");
    let validated = 0;
    for (const name of files) {
        const inputs = sampleInputs(name);
        if (!inputs) continue; // the two negative samples
        const generated = isf.createParamsDocument(inputs, {valueOf: (input) => input.default});
        assert(generated, name + ": no document");
        equal(PupitreUI.validate(generated.document), [], name + ": invalid PUI");
        equal(generated.document.panels[0].embedded, true, name + ": embedded panel");
        validated++;
    }
    assert(validated >= 10, "expected at least 10 positive samples, validated " + validated);
});

test("every normalised ISF input has a PUI control", () => {
    let checked = 0;
    for (const name of sampleFiles()) {
        const inputs = sampleInputs(name);
        if (!inputs) continue;
        const built = blocksOf(isf.createParamsDocument(inputs, {}).document);
        for (const input of inputs) {
            if (input.define) {
                // generate_as_define inputs are compile-time constants.
                assert(built.readouts.some((block) => block.bind === "/isf/" + input.name),
                    name + ": define " + input.name + " is not a readout");
            } else {
                const matches = expectations[input.type];
                assert(matches, name + ": unmapped ISF type " + input.type + " (" + input.name + ")");
                assert(matches(input, built), name + ": " + input.type + " " + input.name + " has no PUI control");
            }
            checked++;
        }
    }
    assert(checked >= 20, "expected the corpus controls, checked " + checked);
});

test("generate_as_define inputs stay read-only constants", () => {
    const define = {name: "mode", label: "Mode", type: "long", values: ["before", "after"],
        labels: ["Before", "After"], defaultValue: "after", defaultIndex: 1, define: true};
    const built = blocksOf(isf.createParamsDocument([define], {}).document);
    equal(built.fields.length, 0, "no writable field");
    equal(built.readouts.length, 1, "one readout");
    assert(/generate_as_define/.test(built.readouts[0].help), "help explains the constant");
    const adapter = PupitreISF.createAdapter({inputs: [define], host: {
        getValue: () => "ignored",
        setValue: () => { throw new Error("define must not be written"); }
    }});
    equal(adapter.getValue("/isf/mode"), "After");
    equal(adapter.setValue("/isf/mode", "before"), false);
});

test("the plasma sample maps every control family it declares", () => {
    const inputs = sampleInputs("plasma.fs");
    const {fields} = blocksOf(isf.createParamsDocument(inputs, {}).document);
    const plasma = fields.find((field) => field.bind === "/isf/speed");
    assert(plasma && plasma.widget === "range", "speed slider");
    const center = fields.filter((field) => field.bind.indexOf("/isf/center/") === 0);
    equal(center.length, 2, "point2D split into two axes");
    const colour = fields.find((field) => field.widget === "color");
    assert(colour && /^#[0-9a-f]{8}$/i.test(colour.default), "colour default is hex8");
    assert(fields.some((field) => field.widget === "select"), "long VALUES select");
    assert(fields.some((field) => field.widget === "switch"), "bool switch");
    assert(fields.some((field) => field.widget === "button"), "event button");
    const media = blocksOf(isf.createParamsDocument(sampleInputs("test-card.fs"), {}).document);
    assert(media.actions.some((item) => item.call === "isf.choose_image"), "image picker action");
    assert(media.actions.filter((item) => item.call === "isf.toggle_microphone").length === 1, "one microphone action for both audio inputs");
    assert(media.readouts.length === 2, "audio/FFT source readouts");
});

/* ------------------------------------------------------------- adapter */

console.log("\n# Adapter round-trip");

const inputs = [
    {name: "amount", label: "Amount", type: "float", min: 0, max: 1, default: 0.5, boundedMin: true, boundedMax: true},
    {name: "center", label: "Center", type: "point2D", min: [0, 0], max: [1, 1], default: [0.25, 0.75]},
    {name: "tint", label: "Tint", type: "color", min: [0, 0, 0, 0], max: [1, 1, 1, 1], default: [1, 0, 0, 1]},
    {name: "shape", label: "Shape", type: "long", values: ["circle", "square"], labels: ["Circle", "Square"], default: "square", defaultIndex: 1},
    {name: "trigger", label: "Trigger", type: "event"},
    {name: "inputImage", label: "Input image", type: "image"},
    {name: "audio", label: "Audio", type: "audio"}
];
const values = {amount: 0.5, center: [0.25, 0.75], tint: [1, 0, 0, 1], shape: 1};
const writes = [];
const events = [];
const media = [];
let microphone = false;
const adapter = PupitreISF.createAdapter({
    inputs,
    host: {
        getValue: (name) => values[name],
        setValue: (name, value) => { writes.push([name, value]); values[name] = value; return value; },
        triggerEvent: (name) => events.push(name),
        chooseImage: (name) => media.push(["image", name]),
        toggleMicrophone: () => { microphone = !microphone; media.push(["mic"]); },
        audioActive: () => microphone
    }
});

test("pair components read from and write back to one isf value", () => {
    equal(adapter.getValue("/isf/center/x"), 0.25);
    adapter.setValue("/isf/center/y", 0.5);
    equal(writes.pop(), ["center", [0.25, 0.5]]);
});

test("colour wire value is hex8 and the write is rgba floats", () => {
    equal(adapter.getValue("/isf/tint"), "#ff0000ff");
    adapter.setValue("/isf/tint", "#00ff0080");
    const write = writes.pop();
    equal(write[0], "tint");
    assert(Math.abs(write[1][0]) < 0.01 && Math.abs(write[1][1] - 1) < 0.01, "green channel");
    assert(Math.abs(write[1][3] - 128 / 255) < 0.01, "alpha channel");
});

test("label longs write the shader index", () => {
    equal(adapter.getValue("/isf/shape"), 1);
    adapter.setValue("/isf/shape", 0);
    equal(writes.pop(), ["shape", 0]);
});

test("events, image pickers and microphone reach the host", () => {
    adapter.setValue("/isf/trigger", null);
    adapter.callAction("isf.choose_image", {name: "inputImage"});
    adapter.callAction("isf.toggle_microphone", {});
    equal(events, ["trigger"]);
    equal(media, [["image", "inputImage"], ["mic"]]);
});

test("media readouts follow host state", () => {
    equal(adapter.getValue("/isf/audio/source"), "microphone");
    microphone = false;
    equal(adapter.getValue("/isf/audio/source"), "synthetic");
    const document = adapter.document();
    const buttons = [];
    document.panels[0].pages[0].sections[0].blocks.forEach((block) => {
        if (block.kind === "actions") block.items.forEach((item) => buttons.push(item));
    });
    assert(buttons.some((item) => item.call === "isf.toggle_microphone" && item.label === "Use mic"), "mic off label");
    microphone = true;
    const onDocument = adapter.document();
    const onButtons = [];
    onDocument.panels[0].pages[0].sections[0].blocks.forEach((block) => {
        if (block.kind === "actions") block.items.forEach((item) => onButtons.push(item));
    });
    assert(onButtons.some((item) => item.call === "isf.toggle_microphone" && item.label === "Microphone on"), "mic on label");
});

console.log("\n" + (passed + failed) + " checks — " + passed + " passed, " + failed + " failed" +
    " (docsify-isf v" + VERSION + ", pupitre-ui v" + PupitreUI.version + ")");
if (failed) {
    for (const failure of failures) console.error("\n" + failure.name + "\n" + (failure.error && failure.error.stack || failure.error));
    process.exit(1);
}
