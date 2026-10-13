#!/usr/bin/env node
/*
 * docsify-isf unit tests — no dependencies.
 *
 *   node tests/run.js            parser, evaluator, rewriting, build, samples
 *   node tests/run.js --corpus   additionally assemble the bundled ISF corpus
 *                                (758 files) when this repo is checked out
 *                                inside obs-lua-projection-mapping
 *
 * The tests deliberately keep the pure library parts (parser, expression
 * evaluator, GLSL rewriter, shader assembly, URL resolution) separate from the
 * DOM/WebGL parts, so they run in plain Node.
 */
"use strict";

const path = require("path");
const fs = require("fs");

const isf = require(path.join(__dirname, "..", "docsify-isf.js"));

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
        failures.push({ name, error });
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

function throws(fn, match) {
    try {
        fn();
    } catch (error) {
        if (match && !match.test(error.message)) {
            throw new Error("Error message did not match " + match + ": " + error.message);
        }
        return error;
    }
    throw new Error("Expected an error");
}

const samplesDir = path.join(__dirname, "..", "samples");

/* ------------------------------------------------------------------ parser */

console.log("\n# Tolerant ISF header parser");

test("strict JSON header", () => {
    const result = isf.parseISFMetadata('/*{"ISFVSN":"2","INPUTS":[{"NAME":"a","TYPE":"float"}]}*/');
    assert(result.ok, result.error && result.error.message);
    equal(result.data.ISFVSN, "2");
    equal(result.data.INPUTS[0].NAME, "a");
});

test("trailing commas, line and block comments inside the header", () => {
    const source = [
        "/*{",
        '  "ISFVSN": "2", // version',
        '  "INPUTS": [',
        "    {",
        '      "NAME": "level", /* the level */',
        '      "TYPE": "float",',
        "    },",
        "  ],",
        "}*/"
    ].join("\n");
    const result = isf.parseISFMetadata(source);
    assert(result.ok, result.error && result.error.message);
    equal(result.data.INPUTS.length, 1);
    equal(result.data.INPUTS[0].NAME, "level");
});

test("single quotes, bare keys, .5 / 360. numbers and unknown escapes", () => {
    const source = "/*{ ISFVSN: '2', INPUTS: [ { NAME: 'x', TYPE: 'float', MIN: .5, MAX: 360., LABEL: 'a\\Mb' } ] }*/";
    const result = isf.parseISFMetadata(source);
    assert(result.ok, result.error && result.error.message);
    equal(result.data.INPUTS[0].MIN, 0.5);
    equal(result.data.INPUTS[0].MAX, 360);
    equal(result.data.INPUTS[0].LABEL, "aMb");
});

test("leading non-JSON comment before the real header", () => {
    const source = [
        "/* Ported from somewhere (not the header) */",
        '/*{ "ISFVSN": "2", "INPUTS": [] }*/',
        "void main(){}"
    ].join("\n");
    const result = isf.parseISFMetadata(source);
    assert(result.ok, result.error && result.error.message);
    equal(result.data.ISFVSN, "2");
});

test("malformed header reports a file line", () => {
    const source = "/*{\n  \"ISFVSN\": \"2\",\n  \"INPUTS\": [ broken ]\n}*/\nvoid main(){}";
    const result = isf.parseISFMetadata(source);
    assert(!result.ok, "expected the header to fail");
    assert(/broken/.test(result.error.message), result.error.message);
    equal(result.error.fileLine, 3);
});

test("parseISF keeps the body and its starting line", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[]}*/\nvoid main() {}\n';
    const parsed = isf.parseISF(source);
    assert(parsed.valid);
    assert(parsed.body.indexOf("void main()") !== -1);
    equal(parsed.bodyStartLine, 1);
    const built = isf.buildShader(parsed, {});
    // body line 2 is "void main()", which is file line 2
    equal(built.lineMap(built.preludeLines + 2), 2);
});

/* ------------------------------------------------------- expression parser */

console.log("\n# Pass size expression evaluator");

test("operators and precedence", () => {
    equal(isf.evalExpression("1 + 2 * 3", {}).value, 7);
    equal(isf.evalExpression("(1 + 2) * 3", {}).value, 9);
    equal(isf.evalExpression("2 ^ 3", {}).value, 8);
    equal(isf.evalExpression("-4 + 1", {}).value, -3);
});

test("$WIDTH / $HEIGHT and input variables", () => {
    equal(isf.evalExpression("$WIDTH/2.0", { WIDTH: 1920 }).value, 960);
    equal(isf.evalExpression("floor($HEIGHT/1.0)", { "$HEIGHT": 1080 }).value, 1080);
    equal(isf.evalExpression("$blurAmount * 100.0", { blurAmount: 0.5 }).value, 50);
});

test("functions", () => {
    equal(isf.evalExpression("min($WIDTH,$HEIGHT)*0.5", { WIDTH: 1920, HEIGHT: 1080 }).value, 540);
    equal(isf.evalExpression("clamp($x, 0.0, 1.0)", { x: 2 }).value, 1);
    equal(isf.evalExpression("smoothstep(0.0, 1.0, 0.5)", {}).value, 0.5);
    equal(isf.evalExpression("mix(0.0, 10.0, 0.25)", {}).value, 2.5);
});

test("unknown identifiers fail instead of evaluating", () => {
    assert(!isf.evalExpression("$width / 2.0", {}).ok);
    assert(!isf.evalExpression("window", {}).ok);
    assert(!isf.evalExpression("1 +", {}).ok);
});

/* --------------------------------------------------------------- rewriter */

console.log("\n# IMG_* and vv_* rewriting");

test("IMG_NORM_PIXEL / IMG_PIXEL / IMG_THIS_PIXEL / IMG_SIZE", () => {
    const result = isf.rewriteSpecialFunctions([
        "vec4 a = IMG_NORM_PIXEL(tex, uv);",
        "vec4 b = IMG_PIXEL(tex, vec2(x, y));",
        "vec4 c = IMG_THIS_PIXEL(tex);",
        "vec4 d = IMG_NORM_THIS_PIXEL(tex);",
        "vec2 s = IMG_SIZE(tex);"
    ].join("\n"), ["tex"]);
    equal(result.unresolved.length, 0);
    assert(result.source.indexOf("texture2D(tex, uv)") !== -1, result.source);
    assert(result.source.indexOf("texture2D(tex, (vec2(x, y)) / _tex_imgSize)") !== -1, result.source);
    assert(result.source.indexOf("texture2D(tex, gl_FragCoord.xy / _tex_imgSize)") !== -1, result.source);
    assert(result.source.indexOf("texture2D(tex, isf_FragNormCoord)") !== -1, result.source);
    assert(result.source.indexOf("_tex_imgSize") !== -1, result.source);
});

test("nested parentheses in IMG_PIXEL arguments", () => {
    const result = isf.rewriteSpecialFunctions("IMG_PIXEL(tex, vec2(mix(a, b, 0.5), max(c, d)))", ["tex"]);
    equal(result.unresolved.length, 0);
    assert(result.source.indexOf("texture2D(tex, (vec2(mix(a, b, 0.5), max(c, d))) / _tex_imgSize)") !== -1, result.source);
});

test("calls inside comments are not rewritten, unknown images are reported", () => {
    const result = isf.rewriteSpecialFunctions("// IMG_A(inputImage, uv)\nIMG_PIXEL(mystery, uv)", ["inputImage"]);
    assert(result.source.indexOf("// IMG_A(inputImage, uv)") !== -1);
    equal(result.unresolved.length, 1);
    equal(result.unresolved[0].image, "mystery");
});

test("vv_* v1 aliases", () => {
    const result = isf.rewriteSpecialFunctions("vec2 p = vv_FragNormCoord; vv_vertShaderInit();", []);
    assert(result.source.indexOf("isf_FragNormCoord") !== -1);
    assert(result.source.indexOf("isf_vertShaderInit()") !== -1);
});

test("IMG_* calls inside #define lines", () => {
    const source = "#define SAMPLE(c) IMG_NORM_PIXEL(tex, c)\nSAMPLE(uv)";
    const result = isf.rewriteSpecialFunctions(source, ["tex"]);
    assert(result.source.indexOf("#define SAMPLE(c) texture2D(tex, c)") !== -1, result.source);
});

/* --------------------------------------------------------------- assembly */

console.log("\n# Shader assembly");

test("fragment prelude declares built-ins, inputs and image helpers", () => {
    const source = [
        '/*{ "ISFVSN": "2", "INPUTS": [',
        '  { "NAME": "inputImage", "TYPE": "image" },',
        '  { "NAME": "level", "TYPE": "float" },',
        '  { "NAME": "toggle", "TYPE": "bool" },',
        '  { "NAME": "hue", "TYPE": "color" }',
        '] }*/',
        "void main(){ gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord) * level; }"
    ].join("\n");
    const built = isf.buildShader(isf.parseISF(source), {});
    assert(built.fragment.indexOf("uniform sampler2D inputImage;") !== -1);
    assert(built.fragment.indexOf("uniform vec2 _inputImage_imgSize;") !== -1);
    assert(built.fragment.indexOf("uniform float level;") !== -1);
    assert(built.fragment.indexOf("uniform bool toggle;") !== -1);
    assert(built.fragment.indexOf("uniform vec4 hue;") !== -1);
    assert(built.fragment.indexOf("void main(){") !== -1);
});

test("pass targets become samplers and WIDTH/HEIGHT are kept", () => {
    const source = [
        '/*{ "ISFVSN": "2", "INPUTS": [{ "NAME": "inputImage", "TYPE": "image" }],',
        '  "PASSES": [ { "TARGET": "accum", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/2.0" }, {} ] }*/',
        "void main(){ if (PASSINDEX == 0) gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord); else gl_FragColor = IMG_NORM_PIXEL(accum, isf_FragNormCoord); }"
    ].join("\n");
    const built = isf.buildShader(isf.parseISF(source), {});
    equal(built.passes.length, 2);
    equal(built.passes[0].target, "accum");
    equal(built.passes[0].persistent, true);
    equal(built.passes[0].float, true);
    equal(built.passes[0].width, "$WIDTH/2.0");
    equal(built.passes[0].height, "$HEIGHT");
    assert(built.fragment.indexOf("uniform sampler2D accum;") !== -1);
});

test("body #version directives are stripped", () => {
    const built = isf.buildShader(isf.parseISF('/*{"ISFVSN":"2","INPUTS":[]}*/\n#version 150\nvoid main(){}'), {});
    assert(built.fragment.indexOf("#version 150") === -1);
});

test("compile error lines map back to the raw file", () => {
    const raw = '/*{\n"ISFVSN": "2",\n"INPUTS": []\n}*/\nvoid main()\n{\n    gl_FragColor = vec4(1.0);\n}\n';
    const built = isf.buildShader(isf.parseISF(raw), {});
    const bodyLine = built.preludeLines + 3; // the "{" line of the body
    equal(built.lineMap(bodyLine), 6);
    equal(built.lineMap(1), null); // inside the generated prelude
});

test("input type aliases and defaults", () => {
    const inputs = isf.normalizeInputs([
        { NAME: "p", TYPE: "point2d", DEFAULT: [0.5, 0.5], MIN: [0, 0], MAX: [1, 1] },
        { NAME: "i", TYPE: "int", DEFAULT: 3 },
        { NAME: "m", TYPE: "long", DEFAULT: "B", VALUES: [0, 1], LABELS: ["A", "B"] },
        { NAME: "f", TYPE: "float", DEFAULT: 0.25, MIN: 0, MAX: 1 },
        { NAME: "c", TYPE: "color", DEFAULT: [1, 0, 0, 1] }
    ], []);
    equal(inputs.length, 5);
    equal(inputs[0].type, "point2D");
    equal(inputs[0].default, [0.5, 0.5]);
    equal(inputs[1].type, "long");
    equal(inputs[2].defaultValue, 1);
    equal(inputs[3].uniform, "float");
    equal(inputs[4].default, [1, 0, 0, 1]);
});

test("clampInputValue respects declared MIN/MAX/VALUES", () => {
    const inputs = isf.normalizeInputs([
        { NAME: "f", TYPE: "float", DEFAULT: 0.5, MIN: 0, MAX: 1 },
        { NAME: "m", TYPE: "long", DEFAULT: 1, VALUES: [0, 1, 2], LABELS: ["A", "B", "C"] },
        { NAME: "i", TYPE: "int", DEFAULT: 3, MIN: 0, MAX: 10 },
        { NAME: "p", TYPE: "point2D", DEFAULT: [0.5, 0.5], MIN: [0, 0], MAX: [1, 1] },
        { NAME: "c", TYPE: "color", DEFAULT: [0.5, 0.5, 0.5, 1] }
    ], []);
    equal(isf.clampInputValue(inputs[0], 2), 1);
    equal(isf.clampInputValue(inputs[0], -3), 0);
    equal(isf.clampInputValue(inputs[1], 2), 2);
    equal(isf.clampInputValue(inputs[1], 99), 2);
    equal(isf.clampInputValue(inputs[2], 42), 10);
    equal(isf.clampInputValue(inputs[2], -1), 0);
    equal(isf.clampInputValue(inputs[3], [2, 2]), [1, 1]);
    equal(isf.clampInputValue(inputs[3], [-1, 2]), [0, 1]);
    equal(isf.clampInputValue(inputs[4], [1.5, -0.2, 0.5, 2]), [1, 0, 0.5, 1]);
});

test("prefersReducedMotion is a boolean helper", () => {
    equal(typeof isf.prefersReducedMotion(), "boolean");
});

/* ------------------------------------------------------------ highlighting */

console.log("\n# Syntax highlighting");

test("tokens are classified and HTML-escaped", () => {
    const html = isf.highlightGLSL("void main() { <tag> // comment\n float x = IMG_SIZE(tex); }");
    assert(html.indexOf("isf-tok-type") !== -1);
    assert(html.indexOf("isf-tok-com") !== -1);
    assert(html.indexOf("isf-tok-isf") !== -1);
    assert(html.indexOf("&lt;") !== -1);
    assert(html.indexOf("&gt;") !== -1);
    assert(html.indexOf("<tag>") === -1);
});

/* ------------------------------------------------------------------- URLs */

console.log("\n# URL resolution");

global.location = { href: "https://example.com/docs/" };

test("relative, root and hash routes", () => {
    equal(
        isf.resolveAssetUrl("./samples/plasma.fs", ""),
        "https://example.com/docs/samples/plasma.fs"
    );
    equal(
        isf.resolveAssetUrl("../kaleidoscope.fs", "/modules/fx/isf-filter/library/kaleidoscope/"),
        "https://example.com/docs/modules/fx/isf-filter/library/kaleidoscope.fs"
    );
    equal(
        isf.resolveAssetUrl("#/modules/a/b.fs", "/x/"),
        "https://example.com/docs/modules/a/b.fs"
    );
    equal(
        isf.resolveAssetUrl("/abs/c.fs", ""),
        "https://example.com/docs/abs/c.fs"
    );
    equal(
        isf.resolveAssetUrl("https://other.test/e.fs", ""),
        "https://other.test/e.fs"
    );
});

test("legacy sibling fallback candidates", () => {
    const candidates = isf.resolveCandidates(
        "../kaleidoscope.fs",
        "/modules/fx/isf-filter/library/kaleidoscope/"
    );
    equal(candidates, [
        "https://example.com/docs/modules/fx/isf-filter/library/kaleidoscope.fs",
        "https://example.com/docs/modules/fx/isf-filter/library/kaleidoscope/kaleidoscope.fs"
    ]);
});

test("link detection", () => {
    const config = { extensions: ["fs"] };
    assert(isf.isShaderHref("./a.fs", config));
    assert(isf.isShaderHref("#/a/b.fs?x=1", config));
    assert(isf.isShaderHref("./A.FS", config));
    assert(!isf.isShaderHref("./a.glsl", config));
    assert(!isf.isShaderHref("mailto:a.fs", config));
    assert(!isf.isShaderHref("./a.fs/", config));
});

/* -------------------------------------------------------------- self-test */

console.log("\n# Self-test samples (README links)");

const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
const linked = new Set();
const linkPattern = /\]\(\.\/(samples\/[^)\s]+)\)/g;
let linkMatch;
while ((linkMatch = linkPattern.exec(readme))) linked.add(linkMatch[1]);

test("README links only point at committed sample files", () => {
    assert(linked.size >= 8, "expected the self-test gallery in README.md, found " + linked.size + " links");
    for (const relative of linked) {
        const file = path.join(__dirname, "..", relative);
        assert(fs.existsSync(file), "missing " + relative);
    }
});

test("every committed sample has valid ISF metadata", () => {
    const files = fs.readdirSync(samplesDir).filter((name) => /\.fs$/.test(name));
    assert(files.length >= 8, "expected samples/*.fs files");
    for (const name of files) {
        const source = fs.readFileSync(path.join(samplesDir, name), "utf8");
        const parsed = isf.parseISF(source);
        if (name === "broken-header.fs") {
            assert(!parsed.valid, name + " should fail to parse");
            continue;
        }
        assert(parsed.valid, name + ": " + (parsed.error && parsed.error.message));
    }
});

test("every buildable sample assembles with no unresolved images", () => {
    const files = fs.readdirSync(samplesDir).filter((name) => /\.fs$/.test(name));
    for (const name of files) {
        if (name === "broken-header.fs") continue;
        const source = fs.readFileSync(path.join(samplesDir, name), "utf8");
        const parsed = isf.parseISF(source);
        let vertex = null;
        const vertexPath = path.join(samplesDir, name.replace(/\.fs$/, ".vs"));
        if (fs.existsSync(vertexPath)) vertex = fs.readFileSync(vertexPath, "utf8");
        const built = isf.buildShader(parsed, { vertexShader: vertex, imports: true });
        equal(built.unresolved, [], name + " has unresolved image calls");
        assert(built.fragment.length > 100, name + " produced an empty shader");
    }
});

test("custom vertex shader is paired", () => {
    const source = fs.readFileSync(path.join(samplesDir, "vertex-shader.fs"), "utf8");
    const vertex = fs.readFileSync(path.join(samplesDir, "vertex-shader.vs"), "utf8");
    const built = isf.buildShader(isf.parseISF(source), { vertexShader: vertex });
    assert(built.vertex.indexOf("vUV = isf_FragNormCoord") !== -1);
    assert(built.vertex.indexOf("void main()") !== -1);
});

/* ------------------------------------------------------------ importer */

console.log("\n# Shadertoy / GLSL Sandbox importer");

test("detectShaderDialect", () => {
    equal(isf.detectShaderDialect("void mainImage(out vec4 o, in vec2 p) {}"), "shadertoy");
    equal(isf.detectShaderDialect("uniform float time;\nvoid main(){ gl_FragColor = vec4(1.0); }"), "glslsandbox");
    equal(isf.detectShaderDialect('/*{"ISFVSN":"2"}*/ void main(){}'), "isf");
});

test("Shadertoy conversion maps uniforms, textures and wraps mainImage", () => {
    const source = [
        "void mainImage(out vec4 fragColor, in vec2 fragCoord)",
        "{",
        "    vec2 uv = fragCoord / iResolution.xy;",
        "    vec4 tex = texture(iChannel0, uv) + textureLod(iChannel1, uv, 0.0);",
        "    tex += IMG_PIXEL_NEVER_USED;",
        "    fragColor = tex * (0.5 + 0.5 * sin(iTime)) + iMouse.x;",
        "}"
    ].join("\n");
    const result = isf.convertToISF(source);
    assert(result.ok, result.error);
    equal(result.format, "shadertoy");
    assert(result.source.indexOf('"NAME": "iChannel0"') !== -1);
    assert(result.source.indexOf('"NAME": "iChannel1"') !== -1);
    assert(result.source.indexOf("#define iMouse _isfMouse") !== -1);
    assert(result.source.indexOf("texture2D(iChannel0, uv)") !== -1);
    assert(result.source.indexOf("texture2D(iChannel1, uv)") !== -1);
    assert(result.source.indexOf("fragCoord / RENDERSIZE.xy") !== -1);
    assert(result.source.indexOf("sin(TIME)") !== -1);
    assert(result.source.indexOf("mainImage(gl_FragColor, gl_FragCoord.xy)") !== -1);
    const parsed = isf.parseISF(result.source);
    assert(parsed.valid, parsed.error && parsed.error.message);
    const built = isf.buildShader(parsed, {});
    equal(built.unresolved, []);
    equal(built.inputs.map((input) => input.name), ["iChannel0", "iChannel1"]);
});

test("Shadertoy output parameter naming does not matter", () => {
    const source = "void mainImage(out vec4 O, in vec2 p) { O = vec4(p / iResolution.xy, 0.0, 1.0); }";
    const result = isf.convertToISF(source);
    assert(result.source.indexOf("mainImage(gl_FragColor, gl_FragCoord.xy)") !== -1);
});

test("Shadertoy channel resolution and texelFetch conversions", () => {
    const source = "void mainImage(out vec4 o, in vec2 p) { vec2 s = iChannelResolution[0].xy; o = texelFetch(iChannel0, ivec2(p), 0) + vec4(s, 0.0, 1.0); }";
    const result = isf.convertToISF(source);
    assert(result.source.indexOf("IMG_SIZE(iChannel0)") !== -1);
    assert(result.source.indexOf("IMG_PIXEL(iChannel0, vec2(ivec2(p)))") !== -1);
});

test("GLSL Sandbox conversion strips the environment uniforms", () => {
    const source = [
        "uniform float time;",
        "uniform vec2 resolution;",
        "void main() { gl_FragColor = vec4(gl_FragCoord.xy / resolution, sin(time + mouse.x), 1.0); }"
    ].join("\n");
    const result = isf.convertToISF(source);
    assert(result.ok, result.error);
    equal(result.format, "glslsandbox");
    assert(result.source.indexOf("uniform float TIME") === -1);
    assert(result.source.indexOf("uniform vec2 RENDERSIZE") === -1);
    assert(result.source.indexOf("sin(TIME") !== -1);
    assert(result.source.indexOf("_isfMouse.xy") !== -1);
    const parsed = isf.parseISF(result.source);
    assert(parsed.valid, parsed.error && parsed.error.message);
    equal(isf.buildShader(parsed, {}).unresolved, []);
});

test("already-ISF sources are refused with an explanation", () => {
    const result = isf.convertToISF('/*{"ISFVSN":"2","INPUTS":[]}*/\nvoid main(){ gl_FragColor = vec4(1.0); }');
    assert(!result.ok);
    assert(/already looks like ISF/.test(result.error));
});

test("vertex line map points into the user vertex shader", () => {
    const vertex = "varying vec2 vUV;\nvoid main() { isf_vertShaderInit(); vUV = isf_FragNormCoord; }\n";
    const built = isf.buildShader(isf.parseISF('/*{"ISFVSN":"2","INPUTS":[]}*/\nvoid main(){}'), { vertexShader: vertex });
    equal(built.vertexLineMap(built.vertexPreludeLines + 1), 1);
    equal(built.vertexLineMap(built.vertexPreludeLines + 2), 2);
    equal(built.vertexLineMap(1), null);
});

test("literal promotion learns float constants from includes", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[]}*/\nconst float PI = 3.14159;\nvoid main(){\n    float t = 2*PI*TIME / 360;\n    gl_FragColor = vec4(t);\n}';
    const built = isf.buildShader(isf.parseISF(source), {});
    assert(built.fragmentLoose.indexOf("2.0*PI*TIME / 360.0") !== -1, built.fragmentLoose);
});

test("ES3 variants are generated for the WebGL2 fallback", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[{"NAME":"a","TYPE":"float"}]}*/\nvoid main(){ float p[2]; p[0]=a; gl_FragColor=vec4(p[int(gl_FragCoord.x)%2]); }';
    const built = isf.buildShader(isf.parseISF(source), {});
    equal(built.fragmentES3.indexOf("#version 300 es"), 0);
    assert(built.fragmentES3.indexOf("#define varying in") !== -1);
    assert(built.fragmentES3.indexOf("#define gl_FragColor _isfFragColor") !== -1);
    assert(built.fragmentES3.indexOf("out vec4 _isfFragColor;") !== -1);
    equal(built.vertexES3.indexOf("#version 300 es"), 0);
    assert(built.vertexES3.indexOf("#define attribute in") !== -1);
    assert(built.vertexES3.indexOf("#define varying out") !== -1);
});

test("literal promotion leaves floats, exponents and int contexts alone", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[]}*/\nvoid main(){\n    float t = TIME * 2 + 1e-3 + 2E+4;\n    int i = 0;\n    gl_FragColor = vec4(t + float(i));\n}';
    const built = isf.buildShader(isf.parseISF(source), {});
    assert(built.fragmentLoose.indexOf("TIME * 2.0") !== -1, built.fragmentLoose);
    assert(built.fragmentLoose.indexOf("1e-3") !== -1, built.fragmentLoose);
    assert(built.fragmentLoose.indexOf("2E+4") !== -1, built.fragmentLoose);
    assert(built.fragmentLoose.indexOf("int i = 0;") !== -1, built.fragmentLoose);
});

test("#include expansion reports missing files", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[]}*/\n#include "helper.glsl"\nvoid main(){ gl_FragColor = vec4(helperFn(0.5)); }';
    const built = isf.buildShader(isf.parseISF(source), { includes: { "helper.glsl": "float helperFn(float x){ return x; }" } });
    assert(built.fragment.indexOf("float helperFn(float x)") !== -1);
    equal(built.warnings, []);
    const missing = isf.buildShader(isf.parseISF(source), {});
    assert(missing.warnings.some((warning) => /Missing include "helper.glsl"/.test(warning.message)));
});

test("#include aliases and trailing comments resolve recursively", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[]}*/\n#include "MadNOISE.glsl" // helpers\nvoid main(){ gl_FragColor = vec4(madNoiseFn(0.5)); }';
    const includes = {
        "MadNoise.glsl": '#include "MadCommon.glsl"\nfloat madNoiseFn(float x){ return commonFn(x); }',
        "MadCommon.glsl": "float commonFn(float x){ return x * 2.0; }"
    };
    const built = isf.buildShader(isf.parseISF(source), { includes: includes });
    assert(built.fragment.indexOf("float commonFn(float x)") !== -1);
    assert(built.fragment.indexOf("float madNoiseFn(float x)") !== -1);
    equal(built.warnings, []);
});

test("materialColorForPixel gets a generated main()", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/\nvec4 materialColorForPixel(vec2 p){ return IMG_NORM_PIXEL(inputImage, p); }';
    const built = isf.buildShader(isf.parseISF(source), {});
    assert(built.fragment.indexOf("gl_FragColor = materialColorForPixel(isf_FragNormCoord);") !== -1);
});

test("image uniforms declare _imgRect and _flip", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/\nvoid main(){ gl_FragColor = IMG_NORM_PIXEL(inputImage, isf_FragNormCoord) + vec4(_inputImage_imgRect.xy, _inputImage_imgSize); }';
    const built = isf.buildShader(isf.parseISF(source), {});
    assert(built.fragment.indexOf("uniform vec4 _inputImage_imgRect;") !== -1);
    assert(built.fragment.indexOf("uniform bool _inputImage_flip;") !== -1);
});

test("MadMapper GENERATORS are declared and exposed", () => {
    const source = '/*{"ISFVSN":"2","INPUTS":[{"NAME":"mat_speed","TYPE":"float","DEFAULT":1,"MIN":0,"MAX":4}],"GENERATORS":[{"NAME":"mat_time_source","TYPE":"time_base","PARAMS":{"speed":"mat_speed"}}]}*/\nvoid main(){ gl_FragColor = vec4(mat_time_source); }';
    const built = isf.buildShader(isf.parseISF(source), {});
    equal(built.generators.length, 1);
    equal(built.generators[0].name, "mat_time_source");
    equal(built.generators[0].type, "time_base");
    assert(built.fragment.indexOf("uniform float mat_time_source;") !== -1);
    // The runtime state machine is pure enough to unit-test through the
    // exported helpers only in the browser; the smoke test covers the render.
});

/* ------------------------------------------------------------ corpus test */

const corpusRoots = [
    path.join(__dirname, "..", "..", "..", "modules", "fx", "isf-filter", "library"),
    path.join(__dirname, "..", "..", "..", "modules", "src", "isf-source", "library"),
    path.join(__dirname, "..", "..", "..", "modules", "src", "isf-transition", "library")
];

if (process.argv.indexOf("--corpus") !== -1 && corpusRoots.every((root) => fs.existsSync(root))) {
    console.log("\n# Bundled ISF corpus (--corpus)");
    test("every bundled .fs parses and assembles", () => {
        function walk(dir, out) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full, out);
                else if (/\.fs$/.test(entry.name)) out.push(full);
            }
            return out;
        }
        const files = corpusRoots.reduce((all, root) => walk(root, all), []);
        let parsed = 0;
        let assembled = 0;
        const problems = [];
        for (const file of files) {
            const source = fs.readFileSync(file, "utf8");
            const result = isf.parseISF(source);
            if (!result.valid) { problems.push(file + ": " + result.error.message); continue; }
            parsed++;
            const built = isf.buildShader(result, {});
            if (built.unresolved.length) { problems.push(file + ": " + JSON.stringify(built.unresolved[0])); continue; }
            assembled++;
        }
        assert(problems.length === 0, problems.slice(0, 5).join("\n"));
        assert(assembled === files.length, "assembled " + assembled + "/" + files.length);
    });
} else if (process.argv.indexOf("--corpus") !== -1) {
    console.log("\n# Bundled ISF corpus (skipped: parent repository not found)");
}

/* ------------------------------------------------------------------ report */

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) {
    for (const failure of failures) {
        console.log("\n--- " + failure.name + "\n" + failure.error.stack);
    }
    process.exitCode = 1;
}
