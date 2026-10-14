/* ============================================================================
 * docsify-isf — K4 compiler adapter
 *
 * The compiler kernel (header parsing, dialect compatibility, promotion,
 * overload shims, generators, assembled shader variants) is the canonical
 * `editors/ui/isf/` kernel, vendored under `vendor/isf-core/` and injected by
 * `tools/build.mjs` as `ISFCore`. This file keeps the plugin's kernel API
 * (`parseISF`, `buildShader`, …) working on top of it so the Docsify/UI layer
 * does not change.
 *
 * The build tool removes the old copies of these functions from
 * `src/plugin.src.js`; everything below is the only implementation in the
 * artifact.
 * ========================================================================= */

    /* ── header parsing ─────────────────────────────────────────────────── */

    function parseISF(source) {
        var text = String(source == null ? "" : source);
        var parsed = ISFCore.parse.parseISF(text);
        parsed.raw = text;
        return parsed;
    }

    function parseJSONTolerant(text) {
        return ISFCore.parse.parseISFJSON(text);
    }

    function parseISFMetadata(source) {
        var text = String(source == null ? "" : source);
        var comments = scanBlockComments(text);
        var parseable = null;
        var hinted = null;
        for (var c = 0; c < comments.length; c++) {
            var match = comments[c];
            var content = match.content;
            var looksLikeHeader = HEADER_HINT.test(content) || /^\s*\{/.test(content);
            var result = parseJSONTolerant(content);
            if (result.ok && isObject(result.value)) {
                var candidate = {
                    ok: true,
                    data: result.value,
                    error: null,
                    start: match.start,
                    end: match.end,
                    content: content
                };
                if (HEADER_HINT.test(content)) return candidate;
                if (!parseable) parseable = candidate;
            } else if (!hinted && looksLikeHeader) {
                hinted = {
                    ok: false,
                    data: null,
                    error: result.error,
                    start: match.start,
                    end: match.end,
                    content: content
                };
            }
        }
        if (parseable) return parseable;
        if (hinted) {
            if (hinted.error) {
                var fileLine = lineOfOffset(text, hinted.start + 2) + (hinted.error.line - 1);
                hinted.error.fileLine = fileLine;
                hinted.error.fileColumn = hinted.error.column;
                hinted.error.message = "Invalid ISF header JSON: " + hinted.error.message;
            }
            return hinted;
        }
        return {
            ok: false,
            data: null,
            error: { message: "No ISF metadata comment found (expected /*{ ... }*/ at the top of the file)", line: 1, column: 1, fileLine: 1 },
            start: -1,
            end: -1,
            content: ""
        };
    }

    /* ── normalisation (core shapes; the plugin's panel code consumes them) */

    function normalizeInputs(raw, warnings) {
        var inputs = ISFCore.parse.normalizeInputs(raw, warnings);
        // The panel's long select and clampInputValue read `defaultValue`
        // (the VALUES entry a DEFAULT maps to); the core keeps the same
        // information as `default`/`defaultIndex`.
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            if (input.type === "long" && input.values && input.values.length) {
                if (input.defaultValue === undefined) {
                    input.defaultValue = input.default !== undefined ? input.default : input.values[input.defaultIndex || 0];
                }
                if (input.defaultIndex === undefined) input.defaultIndex = 0;
            }
        }
        return inputs;
    }
    function normalizePasses(raw, warnings) { return ISFCore.parse.normalizePasses(raw, warnings); }
    function normalizeGenerators(raw, inputs, warnings) { return ISFCore.parse.normalizeGenerators(raw, inputs, warnings); }
    function normalizeImports(raw, warnings) { return ISFCore.parse.normalizeImports(raw, warnings); }

    function createGenerators(defs, options) {
        return ISFCore.generators.createGenerators(defs, options);
    }

    /* ── assembled shader variants ──────────────────────────────────────── */

    // The core's renderer seeds exactly these built-ins as float names.
    var CORE_FLOAT_NAMES = ["PI", "TIME", "TIMEDELTA", "RENDERSIZE", "DATE", "isf_FragNormCoord", "gl_FragCoord", "_isfMouse"];

    function buildShader(parsed, options) {
        options = options || {};
        var coreParsed = parsed;
        if (options.imports === false) coreParsed = assign({}, parsed, { imports: [] });

        var inputs = coreParsed.inputs || [];
        var passes = (coreParsed.passes || []).map(function (pass, index) {
            return {
                index: index,
                name: pass.name,
                target: pass.target,
                persistent: !!pass.persistent,
                float: !!pass.float,
                width: pass.widthExpr != null ? pass.widthExpr : "$WIDTH",
                height: pass.heightExpr != null ? pass.heightExpr : "$HEIGHT"
            };
        });
        // A material without PASSES renders through one implicit output pass;
        // the runtime iterates `passes` to draw, so the default must exist.
        if (!passes.length) {
            passes = [{ index: 0, name: "pass1", target: null, persistent: false, float: false, width: "$WIDTH", height: "$HEIGHT" }];
        }
        var generators = coreParsed.generators || [];
        var imports = coreParsed.imports || [];

        var imageNames = [];
        var imageInfo = [];
        for (var i = 0; i < inputs.length; i++) {
            var input = inputs[i];
            if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") {
                imageNames.push(input.name);
                imageInfo.push({ name: input.name, kind: input.type === "image" ? "input" : "audio", input: input });
            }
        }
        for (var p = 0; p < passes.length; p++) {
            if (passes[p].target) {
                imageNames.push(passes[p].target);
                imageInfo.push({ name: passes[p].target, kind: "pass", pass: passes[p] });
            }
        }
        for (var m = 0; m < imports.length; m++) {
            imageNames.push(imports[m].name);
            imageInfo.push({ name: imports[m].name, kind: "import", import: imports[m] });
        }

        var assembleOptions = { includes: options.includes || null, vs: options.vertexShader || null };
        var entryES1 = ISFCore.parse.assembleShaders(coreParsed, assign({ api: "es1" }, assembleOptions))[0];
        var entryES3 = ISFCore.parse.assembleShaders(coreParsed, assign({ api: "es3" }, assembleOptions))[0];

        var floatNames = CORE_FLOAT_NAMES.slice();
        var intNames = [];
        for (var fn = 0; fn < inputs.length; fn++) {
            if (/^(float|vec[234])$/.test(inputs[fn].uniform)) floatNames.push(inputs[fn].name);
            else if (/^(int|uint|long)$/.test(inputs[fn].uniform)) intNames.push(inputs[fn].name);
        }
        for (var fg = 0; fg < generators.length; fg++) {
            if (generators[fg].uniform === "float") floatNames.push(generators[fg].name);
        }
        function promote(source, identifiers, entry) {
            return ISFCore.compat.promoteIntegerLiterals(source, identifiers
                ? assign({}, entry.promoteOptions, { floatNames: floatNames, intNames: intNames, identifiers: true })
                : { floatNames: floatNames, intNames: [], identifiers: false });
        }

        var fragment = entryES1.fs;
        var fragmentES3 = entryES3.fs;
        var preludeLines = entryES1.preludeLines;
        var bodyStartLine = coreParsed.bodyStartLine || 1;
        var warnings = (coreParsed.warnings || []).concat(entryES1.warnings || []);

        // Vertex error mapping: the user vertex body starts after the
        // generated prelude (0 lines for the default vertex shader).
        var vertexPreludeLines = 0;
        if (options.vertexShader) {
            var vertexBody = String(options.vertexShader)
                .replace(/^[ \t]*#version[^\n]*\n?/m, "")
                .replace(/\bvv_vertShaderInit\b/g, "isf_vertShaderInit")
                .replace(/\bvv_FragNormCoord\b/g, "isf_FragNormCoord");
            var bodyAt = entryES1.vertex.indexOf(vertexBody);
            if (bodyAt >= 0) vertexPreludeLines = entryES1.vertex.slice(0, bodyAt).split("\n").length - 1;
        }

        return {
            ok: true,
            fragment: fragment,
            vertex: entryES1.vertex,
            fragmentES3: fragmentES3,
            vertexES3: entryES3.vertex,
            // Literal-only promotion is the safe transform (the core tries it
            // before the identifier casts); the vertex shaders are never
            // promoted, exactly like the core's attempt chain.
            fragmentPromoted: promote(fragment, false, entryES1),
            vertexPromoted: entryES1.vertex,
            fragmentES3Promoted: promote(fragmentES3, false, entryES3),
            vertexES3Promoted: entryES3.vertex,
            fragmentLoose: promote(fragment, true, entryES1),
            vertexLoose: entryES1.vertex,
            fragmentES3Loose: promote(fragmentES3, true, entryES3),
            vertexES3Loose: entryES3.vertex,
            inputs: inputs,
            passes: passes,
            generators: generators,
            imports: imports,
            images: imageInfo,
            includes: options.includes || {},
            warnings: warnings,
            unresolved: [],
            preludeLines: preludeLines,
            bodyStartLine: bodyStartLine,
            lineMap: function (generatedLine) {
                if (!generatedLine || generatedLine <= preludeLines) return null;
                return bodyStartLine + (generatedLine - preludeLines - 1);
            },
            vertexPreludeLines: vertexPreludeLines,
            vertexLineMap: function (generatedLine) {
                if (!generatedLine || generatedLine <= vertexPreludeLines) return null;
                return generatedLine - vertexPreludeLines;
            }
        };
    }
