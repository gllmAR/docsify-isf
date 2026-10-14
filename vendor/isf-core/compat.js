/* ============================================================================
 * editors/ui/isf/compat.js — ISF compiler compatibility layer
 *
 * Ported from the docsify kernel (`docsify-plugins/docsify-isf/docsify-isf.js`)
 * as phase K1 of docs/isf-kernel-consolidation.md: the MadMapper/HLSL dialect,
 * built-in constants, scope-aware integer/float promotion and overload shims.
 * The two kernels are pixel-identical wherever both compile
 * (scripts/isf-kernel-conformance.mjs); this module closes the editor core's
 * remaining compile gaps so the conformance sample reaches zero gaps.
 *
 * Browser/Node-safe, no DOM access.
 * ==========================================================================*/

    function clamp(value, lo, hi) {
        value = Number(value);
        if (!isFinite(value)) return lo;
        return Math.min(hi, Math.max(lo, value));
    }

    function trim(value) {
        return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
    }

    function escapeRegExp(text) {
        return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    var GLSL_IDENT_START = /[A-Za-z_]/;

    var GLSL_IDENT_PART = /[A-Za-z0-9_]/;

    var GLSL_DIGIT = /[0-9]/;

    var OPS3 = { "<<=": 1, ">>=": 1, "...": 1 }

    var OPS2 = {
        "==": 1, "!=": 1, "<=": 1, ">=": 1, "&&": 1, "||": 1, "++": 1, "--": 1,
        "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "&=": 1, "|=": 1, "^=": 1,
        "<<": 1, ">>": 1, "->": 1, "##": 1
    }

    function tokenizeGLSL(source, options) {
        var src = String(source == null ? "" : source);
        var noPreproc = !!(options && options.noPreproc);
        var tokens = [];
        var i = 0, n = src.length, lineStart = true;

        function push(type, start, end) {
            tokens.push({ type: type, text: src.slice(start, end), start: start, end: end });
            i = end;
        }

        while (i < n) {
            var c = src.charAt(i);
            if (c === "\n") { push("newline", i, i + 1); lineStart = true; continue; }
            if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\u00a0") {
                var spaceStart = i;
                while (i < n && /[ \t\r\f\u00a0]/.test(src.charAt(i))) i++;
                push("space", spaceStart, i);
                continue;
            }
            if (c === "/" && src.charAt(i + 1) === "/") {
                var lineStartPos = i;
                while (i < n && src.charAt(i) !== "\n") i++;
                push("comment", lineStartPos, i);
                continue;
            }
            if (c === "/" && src.charAt(i + 1) === "*") {
                var blockStart = i;
                i += 2;
                while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) i++;
                i = Math.min(n, i + 2);
                push("comment", blockStart, i);
                continue;
            }
            if (c === "#" && lineStart && !noPreproc) {
                var preStart = i;
                while (i < n) {
                    if (src.charAt(i) === "\\" && (src.charAt(i + 1) === "\n" || src.charAt(i + 1) === "\r")) {
                        i += 2;
                        if (src.charAt(i - 1) === "\r" && src.charAt(i) === "\n") i++;
                        continue;
                    }
                    if (src.charAt(i) === "\n") break;
                    i++;
                }
                push("preproc", preStart, i);
                continue;
            }
            if (c === "\"" || c === "'") {
                var quote = c;
                var strStart = i;
                i++;
                while (i < n && src.charAt(i) !== quote) {
                    if (src.charAt(i) === "\\") i++;
                    i++;
                }
                i = Math.min(n, i + 1);
                push("string", strStart, i);
                continue;
            }
            if (GLSL_DIGIT.test(c) || (c === "." && GLSL_DIGIT.test(src.charAt(i + 1)))) {
                if (c === "0" && (src.charAt(i + 1) === "x" || src.charAt(i + 1) === "X")) {
                    i += 2;
                    while (i < n && /[0-9a-fA-F]/.test(src.charAt(i))) i++;
                    push("number", i - 2, i);
                    continue;
                }
                var numStart = i;
                while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                if (src.charAt(i) === ".") {
                    i++;
                    while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                }
                if (src.charAt(i) === "e" || src.charAt(i) === "E") {
                    var j = i + 1;
                    if (src.charAt(j) === "+" || src.charAt(j) === "-") j++;
                    if (GLSL_DIGIT.test(src.charAt(j))) {
                        i = j;
                        while (i < n && GLSL_DIGIT.test(src.charAt(i))) i++;
                    }
                }
                push("number", numStart, i);
                continue;
            }
            if (GLSL_IDENT_START.test(c)) {
                var identStart = i;
                i++;
                while (i < n && GLSL_IDENT_PART.test(src.charAt(i))) i++;
                push("ident", identStart, i);
                continue;
            }
            var three = src.substr(i, 3);
            if (OPS3[three]) { push("op", i, i + 3); continue; }
            var two = src.substr(i, 2);
            if (OPS2[two]) { push("op", i, i + 2); continue; }
            push("op", i, i + 1);
        }
        return tokens;
    }

    var GLSL_BUILTINS = words("radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt inversesqrt abs sign floor trunc round ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D texture2DProj texture2DLod textureCube textureCubeLod dFdx dFdy fwidth");

    function words(list) {
        var out = {};
        var parts = String(list).split(/\s+/);
        for (var i = 0; i < parts.length; i++) if (parts[i]) out[parts[i]] = true;
        return out;
    }

    function stripComments(source) {
        return String(source || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    }

    function analyzeDeclarationScopes(text, seedInts, seedFloats) {
        var lines = String(text == null ? "" : text).split("\n");
        var frames = [{ ints: {}, floats: {} }];
        var key;
        if (seedInts) for (key in seedInts) if (Object.prototype.hasOwnProperty.call(seedInts, key)) frames[0].ints[key] = true;
        if (seedFloats) for (key in seedFloats) if (Object.prototype.hasOwnProperty.call(seedFloats, key)) frames[0].floats[key] = true;
        var intDeclRe = /\b(?:int|uint|ivec[234]|uvec[234])\s+([A-Za-z_]\w*)/g;
        var floatDeclRe = /\b(?:float|vec[234]|mat[234])\s+([A-Za-z_]\w*)/g;
        var defineRe = /#\s*define\s+([A-Za-z_]\w*)\s+[-+]?(?:\d+\.\d*|\.\d+)/g;
        var intDefineRe = /#\s*define\s+([A-Za-z_]\w*)\s+[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?![\d.]))/g;
        var result = [];
        var pendingParams = null;
        var returnTypes = [null];
        var pendingReturnType = null;
        for (var i = 0; i < lines.length; i++) {
            var raw = lines[i];
            var code = raw.replace(/\/\/[^\n]*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
            var active = { ints: {}, floats: {}, returnType: returnTypes[returnTypes.length - 1] };
            for (var f = 0; f < frames.length; f++) {
                var frame = frames[f];
                for (key in frame.ints) if (Object.prototype.hasOwnProperty.call(frame.ints, key)) active.ints[key] = true;
                for (key in frame.floats) if (Object.prototype.hasOwnProperty.call(frame.floats, key)) active.floats[key] = true;
            }
            result[i] = active;
            defineRe.lastIndex = 0;
            var defineMatch;
            while ((defineMatch = defineRe.exec(code))) {
                frames[0].floats[defineMatch[1]] = true;
                delete frames[0].ints[defineMatch[1]];
            }
            intDefineRe.lastIndex = 0;
            while ((defineMatch = intDefineRe.exec(code))) {
                if (!frames[0].floats[defineMatch[1]]) frames[0].ints[defineMatch[1]] = true;
            }
            // Function signatures: parameters of a definition belong to the
            // body scope (which may open on the next line), parameters of a
            // prototype must not leak anywhere.
            var signatureMatch = /^[ \t]*(void|float|int|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(code);
            var signatureTail = signatureMatch ? code.slice(signatureMatch[0].length) : "";
            var isPrototype = !!(signatureMatch && /^\s*;/.test(signatureTail));
            var isDefinition = !!(signatureMatch && /^\s*\{/.test(signatureTail));
            var isPendingSignature = !!(signatureMatch && !isPrototype && !isDefinition);
            var declSource = code;
            if (signatureMatch) declSource = isPrototype ? "" : signatureMatch[2];
            var lineInts = {};
            var lineFloats = {};
            var match;
            intDeclRe.lastIndex = 0;
            while ((match = intDeclRe.exec(declSource))) {
                if (declSource.charAt(intDeclRe.lastIndex) === "(") continue;
                lineInts[match[1]] = true;
            }
            floatDeclRe.lastIndex = 0;
            while ((match = floatDeclRe.exec(declSource))) lineFloats[match[1]] = true;
            // `int x = 1, y = 2;` / `float a, b;`: learn every declarator.
            var multiDecl = /^[ \t]*(?:(?:const|lowp|medium|highp)[ \t]+)*(int|uint|ivec[234]|uvec[234]|bvec[234]|float|vec[234]|mat[234])[ \t]+([A-Za-z_]\w*)((?:[ \t]*(?:=[^,]*)?,)[\s\S]*)$/.exec(declSource);
            if (!signatureMatch && multiDecl && declSource.indexOf("(") === -1) {
                var declarators = splitTopLevelArguments(multiDecl[1] + " " + multiDecl[2] + multiDecl[3]);
                var isIntType = /^(?:int|uint|ivec[234]|uvec[234]|bvec[234])$/.test(multiDecl[1]);
                for (var dec = 1; dec < declarators.length; dec++) {
                    var decName = /^[ \t]*([A-Za-z_]\w*)/.exec(declarators[dec]);
                    if (!decName) continue;
                    if (isIntType) lineInts[decName[1]] = true;
                    else lineFloats[decName[1]] = true;
                }
            }
            var opens = (code.match(/\{/g) || []).length;
            var closes = (code.match(/\}/g) || []).length;
            var net = opens - closes;
            // Declarations on a line that opens a block (function parameters,
            // for-counters) belong to the new scope. A one-line function
            // definition gets its own frame too, popped at the end of the line.
            if (isDefinition || net > 0) {
                frames.push({ ints: {}, floats: {} });
                returnTypes.push(isDefinition ? signatureMatch[1] : null);
            }
            var target = frames[frames.length - 1];
            if (isPendingSignature) {
                // `float foo(int n)` with the opening brace on the next line:
                // hold the parameters until that brace arrives.
                pendingParams = { ints: lineInts, floats: lineFloats };
                pendingReturnType = signatureMatch[1];
            } else {
                if (pendingParams && (isDefinition || net > 0)) {
                    for (key in pendingParams.ints) if (Object.prototype.hasOwnProperty.call(pendingParams.ints, key)) target.ints[key] = true;
                    for (key in pendingParams.floats) if (Object.prototype.hasOwnProperty.call(pendingParams.floats, key)) target.floats[key] = true;
                    returnTypes[returnTypes.length - 1] = pendingReturnType;
                    pendingParams = null;
                    pendingReturnType = null;
                }
                for (key in lineInts) if (Object.prototype.hasOwnProperty.call(lineInts, key)) target.ints[key] = true;
                for (key in lineFloats) if (Object.prototype.hasOwnProperty.call(lineFloats, key)) target.floats[key] = true;
            }
            if (isDefinition && net <= 0) {
                for (var popDefinition = 0; popDefinition < 1 - net && frames.length > 1; popDefinition++) {
                    frames.pop();
                    returnTypes.pop();
                }
            } else if (net < 0) {
                for (var pop = 0; pop < -net && frames.length > 1; pop++) {
                    frames.pop();
                    returnTypes.pop();
                }
            }
        }
        return result;
    }

    var INT_ARG_POSITIONS = {
        texelFetch: [2],
        textureSize: [1]
    }

    var COERCE_BUILTINS = {
        mix: true, clamp: true, step: true, smoothstep: true, min: true, max: true,
        pow: true, mod: true, atan: true, distance: true, dot: true, reflect: true,
        refract: true, faceforward: true, hypot: true
    }

    function findMatchingParen(text, open) {
        var depth = 0;
        for (var i = open; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch === "(") depth++;
            else if (ch === ")") {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    function intDeclarationHasFloat(fragment, active, countLiterals) {
        var stripped = fragment;
        var re = /\b(?:int|uint)\s*\(/g;
        var match;
        while ((match = re.exec(stripped))) {
            var open = re.lastIndex - 1;
            var close = findMatchingParen(stripped, open);
            if (close === -1) break;
            stripped = stripped.slice(0, match.index) + stripped.slice(close + 1);
            re.lastIndex = 0;
        }
        if (/(?:\d+\.\d*|\.\d+)/.test(stripped)) return true;
        if (countLiterals && /\d+/.test(stripped)) return true;
        var identifiers = stripped.match(/[A-Za-z_]\w*/g) || [];
        for (var i = 0; i < identifiers.length; i++) {
            if (active.floats[identifiers[i]]) return true;
        }
        return false;
    }

    function splitTopLevelArguments(text) {
        var args = [];
        var current = "";
        var depth = 0;
        for (var i = 0; i < text.length; i++) {
            var ch = text.charAt(i);
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") depth--;
            if (ch === "," && depth === 0) {
                args.push(current);
                current = "";
                continue;
            }
            current += ch;
        }
        args.push(current);
        return args;
    }

    function argumentLooksFloat(argument, active) {
        if (/(?:\d+\.\d*|\.\d+)/.test(argument)) return true;
        if (/\b(?:float|vec[234]|mat[234])\s*\(/.test(argument)) return true;
        var identifiers = argument.match(/[A-Za-z_]\w*/g) || [];
        for (var i = 0; i < identifiers.length; i++) {
            if (active.floats[identifiers[i]]) return true;
        }
        return false;
    }

    function argumentLooksInt(argument, active, inlineInts) {
        if (/(?:\d+\.\d*|\.\d+)/.test(argument)) return false;
        if (/^\s*\d+\s*$/.test(argument)) return true;
        if (/\bfloat\s*\(/.test(argument)) return false;
        if (/\b(?:float|vec[234]|mat[234])\s*\(/.test(argument)) return false;
        var identifiers = argument.match(/[A-Za-z_]\w*/g) || [];
        var found = false;
        for (var i = 0; i < identifiers.length; i++) {
            var name = identifiers[i];
            if (active.floats[name]) return false;
            if (active.ints[name] || (inlineInts && inlineInts[name])) {
                found = true;
                continue;
            }
            return false;
        }
        return found;
    }

    function coerceBuiltinArguments(text, active, inlineInts) {
        var re = /\b([A-Za-z_]\w*)\s*\(/g;
        var out = [];
        var cursor = 0;
        var match;
        while ((match = re.exec(text))) {
            if (!COERCE_BUILTINS[match[1]] && !INT_ARG_POSITIONS[match[1]] && !/^mm_/.test(match[1])) continue;
            var open = match.index + match[0].length - 1;
            var close = findMatchingParen(text, open);
            if (close === -1) continue;
            var inner = text.slice(open + 1, close);
            var args = splitTopLevelArguments(inner);
            if (args.length < 2) { re.lastIndex = close + 1; continue; }
            var anyFloat = false;
            var intFlags = [];
            for (var a = 0; a < args.length; a++) {
                if (argumentLooksFloat(args[a], active)) anyFloat = true;
                intFlags.push(argumentLooksInt(args[a], active, inlineInts));
            }
            var intPositions = INT_ARG_POSITIONS[match[1]];
            if (!anyFloat && !intPositions) { re.lastIndex = close + 1; continue; }
            var changed = false;
            var coerced = args.map(function (argument, index) {
                var trimmed = argument.trim();
                if (intPositions && intPositions.indexOf(index) !== -1 && !/^(?:int|uint|ivec[234])\s*\(/.test(trimmed) && !/^\d+$/.test(trimmed)) {
                    changed = true;
                    return "int(" + trimmed + ")";
                }
                if (!intFlags[index]) return argument;
                changed = true;
                return "float(" + trimmed + ")";
            });
            if (!changed) { re.lastIndex = close + 1; continue; }
            out.push(text.slice(cursor, open + 1));
            out.push(coerced.join(", "));
            cursor = close;
            re.lastIndex = close + 1;
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    function promoteIntegerLiteralsCore(source, floatNames, intNames, noCastInts, intParamPositions, intReturnFunctions) {
        var text = String(source == null ? "" : source);
        var names = floatNames || {};
        var integers = intNames || {};
        var noCast = noCastInts || {};

        // 1. Float `const int` declarations whose name is only used in
        //    arithmetic (never as an array index, loop bound or bit operand).
        function constantUsedInBitwise(source, name) {
            var lines = String(source).split("\n");
            for (var li = 0; li < lines.length; li++) {
                var line = lines[li];
                if (line.indexOf(name) === -1) continue;
                var withoutLogical = line.replace(/&&/g, "").replace(/\|\|/g, "");
                if (/[&|^]|<<|>>/.test(withoutLogical)) return true;
            }
            return false;
        }

        var intConstRe = /const\s+(?:lowp\s+|mediump\s+|highp\s+)?int\s+([A-Za-z_]\w*)\s*=\s*([0-9]+)\s*;/g;
        var match;
        var conversions = [];
        while ((match = intConstRe.exec(text))) {
            var constantName = escapeRegExp(match[1]);
            var risky = new RegExp("\\[\\s*" + constantName + "\\b|\\b" + constantName + "\\s*]|[%]\\s*" + constantName + "\\b|\\b" + constantName + "\\s*[%]").test(text)
                || new RegExp("\\b(for|while)\\s*\\([^)]*\\b" + constantName + "\\b").test(text);
            if (!risky && !constantUsedInBitwise(text, match[1])) conversions.push({ name: match[1], value: match[2] });
        }
        for (var c = 0; c < conversions.length; c++) {
            var declaration = new RegExp("const\\s+(?:lowp\\s+|mediump\\s+|highp\\s+)?int\\s+" + escapeRegExp(conversions[c].name) + "\\s*=\\s*" + conversions[c].value + "\\s*;");
            text = text.replace(declaration, "const float " + conversions[c].name + " = " + conversions[c].value + ".0;");
        }

        // 1b. Object-like macros used in float expressions: promote integer
        //     literals in their bodies (`#define TWO_PI PI*2` -> `PI*2.0`),
        //     since the preprocessor expansion is what the compiler sees.
        var floatMacro = {};
        var macroFloatNameRe = null;
        var macroNames = Object.keys(names);
        if (macroNames.length) macroFloatNameRe = new RegExp("\\b(?:" + macroNames.map(escapeRegExp).join("|") + ")\\b");
        text = text.replace(/^([ \t]*#\s*define[ \t]+)([A-Za-z_]\w+)([ \t]+)([^\n]*)$/gm, function (macroMatch, head, name, gap, bodyText) {
            var floatish = /(?:\d+\.\d*|\.\d+)/.test(bodyText) || !!(macroFloatNameRe && macroFloatNameRe.test(bodyText));
            if (!floatish && /\b[A-Za-z_]\w*\b/.test(bodyText)) {
                var identifierRe = /\b([A-Za-z_]\w*)\b/g;
                var identifier;
                while ((identifier = identifierRe.exec(bodyText))) {
                    if (names[identifier[1]] || floatMacro[identifier[1]]) { floatish = true; break; }
                }
            }
            if (!floatish) return macroMatch;
            floatMacro[name] = true;
            return head + name + gap + bodyText.replace(/(^|[^\w.])(\d+)(?![\w.])(?!\.\d)/g, "$1$2.0");
        });


        // 2. Scope tracking: for every line, the int and float names visible
        //    in its scope.
        var scopes = analyzeDeclarationScopes(text, integers, names);
        var intVectorDims = {};
        var intVectorRe = /\b([iu]vec([234]))\s+([A-Za-z_]\w*)/g;
        var intVectorMatch;
        while ((intVectorMatch = intVectorRe.exec(text))) intVectorDims[intVectorMatch[3]] = Number(intVectorMatch[2]);

        // 3. Regexes per name set, cached: the same scope typically repeats.
        var patternCache = {};
        function patternsFor(intsObj, floatsObj) {
            var intList = Object.keys(intsObj).sort();
            var floatList = Object.keys(floatsObj).sort();
            var cacheKey = intList.join(",") + "##" + floatList.join(",");
            var cached = patternCache[cacheKey];
            if (cached) return cached;
            var patterns = {
                ints: intsObj,
                floats: floatsObj,
                intKeys: intList,
                intAssignRe: intList.length
                    ? new RegExp("(^|[^A-Za-z0-9_])(?:" + intList.map(escapeRegExp).join("|") + ")\\s*(?:[+\\-*\\/%]?=(?!=)|\\+\\+|--)")
                    : null,
                nameRe: floatList.length
                    ? new RegExp("(^|[^A-Za-z0-9_])(?:" + floatList.map(escapeRegExp).join("|") + ")([^A-Za-z0-9_]|$)")
                    : null
            };
            patternCache[cacheKey] = patterns;
            return patterns;
        }
        var promotionRe = /(^|[^\w.])(\d+)(?![\w.])(?!\.\d)/g;

        function insideBrackets(text, offset) {
            var depth = 0;
            for (var k = 0; k < offset && k < text.length; k++) {
                if (text.charAt(k) === "[") depth++;
                else if (text.charAt(k) === "]") depth--;
            }
            return depth > 0;
        }

        // Bare identifiers passed to int parameters of user functions keep
        // their int type even in an otherwise float expression.
        var intParamRe = intParamPositions && Object.keys(intParamPositions).length
            ? new RegExp("\\b(?:" + Object.keys(intParamPositions).map(escapeRegExp).join("|") + ")\\b")
            : null;

        // Innermost enclosing call of a position (name + opening paren index).
        function enclosingCall(fragment, offset) {
            var depth = 0;
            for (var k = offset - 1; k >= 0; k--) {
                var ch = fragment.charAt(k);
                if (ch === ")") depth++;
                else if (ch === "(") {
                    if (depth === 0) {
                        var before = fragment.slice(0, k).replace(/[ \t]+$/, "");
                        var nameMatch = /([A-Za-z_]\w*)$/.exec(before);
                        if (nameMatch) return { name: nameMatch[1], open: k };
                        // Grouping paren: keep looking for the enclosing call.
                        continue;
                    }
                    depth--;
                }
            }
            return null;
        }

        // True when a position sits inside a function/constructor call. In an
        // int declaration, expressions inside calls are usually float-typed
        // (`int(floor(f * mat_nX))`), while bare int arithmetic stays int.
        function insideAnyCall(fragment, offset) {
            var depth = 0;
            for (var k = offset - 1; k >= 0; k--) {
                var ch = fragment.charAt(k);
                if (ch === ")") depth++;
                else if (ch === "(") {
                    if (depth === 0) {
                        var before = fragment.slice(0, k).replace(/[ \t]+$/, "");
                        return /[A-Za-z_]\w*$/.test(before);
                    }
                    depth--;
                }
            }
            return false;
        }

        // Balanced `int(x)` wrapping: nested calls (`int(fract(abs(v))*100.)`)
        // are invisible to a simple regex.
        function wrapIntCasts(fragment, intDeclaration) {
            var re = /\b(int|uint)\s*\(/g;
            var out = [];
            var cursor = 0;
            var match;
            while ((match = re.exec(fragment))) {
                var open = re.lastIndex - 1;
                var depth = 0;
                var close = -1;
                for (var k = open; k < fragment.length; k++) {
                    var ch = fragment.charAt(k);
                    if (ch === "(") depth++;
                    else if (ch === ")") {
                        depth--;
                        if (depth === 0) { close = k; break; }
                    }
                }
                if (close === -1) continue;
                if (insideBrackets(fragment, match.index)) continue;
                var before = fragment.slice(Math.max(0, match.index - 6), match.index);
                if (/float\($/.test(before)) continue;
                if (intDeclaration && !insideAnyCall(fragment, match.index)) continue;
                out.push(fragment.slice(cursor, match.index));
                out.push("float(" + fragment.slice(match.index, close + 1) + ")");
                cursor = close + 1;
                re.lastIndex = close + 1;
            }
            if (out.length) {
                out.push(fragment.slice(cursor));
                return out.join("");
            }
            return fragment;
        }
        function protectedCallArguments(line) {
            if (!intParamRe || !intParamRe.test(line)) return null;
            var tokens = tokenizeGLSL(line);
            var protectedNames = null;
            var protectedLiterals = {};
            for (var t = 0; t < tokens.length; t++) {
                var token = tokens[t];
                if (token.type !== "ident") continue;
                var positions = intParamPositions[token.text];
                if (!positions) continue;
                var openIndex = -1;
                for (var o = t + 1; o < tokens.length; o++) {
                    if (tokens[o].type === "space" || tokens[o].type === "comment") continue;
                    if (tokens[o].type === "op" && tokens[o].text === "(") openIndex = o;
                    break;
                }
                if (openIndex === -1) continue;
                var call = callArgumentTexts(tokens, openIndex);
                if (!call) continue;
                for (var p = 0; p < positions.length; p++) {
                    var argument = call.args[positions[p]];
                    var bare = argument && argument.trim();
                    if (!bare) continue;
                    var identifier = /^([A-Za-z_]\w*)$/.exec(bare);
                    if (identifier) {
                        if (!protectedNames) protectedNames = {};
                        protectedNames[identifier[1]] = true;
                        continue;
                    }
                    var literal = /^\d+$/.exec(bare);
                    if (literal) protectedLiterals[literal[0]] = true;
                }
            }
            return { names: protectedNames, literals: protectedLiterals };
        }

        // `cellId%4 * 2.0` is int*float in GLSL; float the whole modulo. The
        // left operand may also be a call to an int-returning helper.
        function wrapModuloExpressions(text, active, inlineInts, intReturnFunctions) {
            var extra = inlineInts ? Object.keys(inlineInts) : [];
            var nameKeys = active.intKeys.concat(extra);
            var out = [];
            var cursor = 0;
            var i = 0;
            while (i < text.length) {
                if (text.charAt(i) !== "%") { i++; continue; }
                if (insideBrackets(text, i)) { i++; continue; }
                // Right operand: an integer literal or an int name.
                var j = i + 1;
                while (j < text.length && /[ \t]/.test(text.charAt(j))) j++;
                var rightMatch = /^(\d+|[A-Za-z_]\w*)/.exec(text.slice(j));
                if (!rightMatch) { i++; continue; }
                if (!/^\d+$/.test(rightMatch[1]) && nameKeys.indexOf(rightMatch[1]) === -1) { i++; continue; }
                var rightEnd = j + rightMatch[0].length;
                // Left operand: an int name or a call to an int-returning function.
                var k = i - 1;
                while (k >= 0 && /[ \t]/.test(text.charAt(k))) k--;
                var leftStart = -1;
                if (k >= 0 && /[A-Za-z0-9_]/.test(text.charAt(k))) {
                    var wordEnd = k + 1;
                    while (k >= 0 && /[A-Za-z0-9_]/.test(text.charAt(k))) k--;
                    leftStart = k + 1;
                    if (nameKeys.indexOf(text.slice(leftStart, wordEnd)) === -1) { i++; continue; }
                } else if (k >= 0 && text.charAt(k) === ")") {
                    var depth = 0, m = k;
                    for (; m >= 0; m--) {
                        var ch = text.charAt(m);
                        if (ch === ")") depth++;
                        else if (ch === "(") {
                            depth--;
                            if (depth === 0) break;
                        }
                    }
                    if (m < 0) { i++; continue; }
                    var callEnd = m;
                    var nameStart = m - 1;
                    while (nameStart >= 0 && /[A-Za-z0-9_]/.test(text.charAt(nameStart))) nameStart--;
                    var callName = text.slice(nameStart + 1, m);
                    if (callName && intReturnFunctions && intReturnFunctions[callName]) {
                        leftStart = nameStart + 1;
                    } else if (!callName) {
                        leftStart = m;
                    } else {
                        i++;
                        continue;
                    }
                } else {
                    i++;
                    continue;
                }
                var before = text.slice(0, leftStart).replace(/[ \t]+$/, "");
                if (/(?:float|int|uint)\s*\($/.test(before)) { i++; continue; }
                out.push(text.slice(cursor, leftStart));
                out.push("float(" + text.slice(leftStart, rightEnd) + ")");
                cursor = rightEnd;
                i = rightEnd;
            }
            if (out.length) {
                out.push(text.slice(cursor));
                return out.join("");
            }
            return text;
        }

        function castAndPromote(fragment, declaredName, equalIndex, force, extraInts, patterns, intDeclaration, protectedNames, inlineInts, extraFloats) {
            // True when the identifier is a parameter (or local) declaration
            // name in a signature such as `float octaves,` or `inout int n)`:
            // promoting an int-typed input there would emit `float
            // float(octaves)`, which is a syntax error.
            function inParameterList(text, at) {
                var before = text.slice(0, at);
                var typed = /(?:(?:lowp|mediump|highp|const|in|out|inout|uniform)\s+)*(?:void|float|int|uint|bool|[biu]vec[234]|mat[234](?:x[234])?)\s+$/.exec(before);
                if (!typed) return false;
                var head = before.slice(0, typed.index).replace(/[ \t]+$/, "");
                return head === "" || /[(,]$/.test(head);
            }
            var code = fragment;
            var active = patterns || patternsFor(integers, names);
            var floatContext = /(\d+\.\d*|\.\d+|\b(float|vec[234]|mat[234])\b)/.test(code) ||
                /\b(TIME|TIMEDELTA|RENDERSIZE|DATE|isf_FragNormCoord|gl_FragCoord|_isfMouse)\b/.test(code) ||
                /\b(?:int|uint)\s*\(/.test(code) ||
                !!(active.nameRe && active.nameRe.test(code)) ||
                !!(extraFloats && extraFloats.length && code.indexOf(extraFloats[0]) !== -1);
            if (!floatContext && !force) return fragment;
            var intDeclFloat = intDeclaration ? intDeclarationHasFloat(code, active) : false;
            code = wrapIntCasts(code, intDeclaration);
            if (active.intKeys.length || (extraInts && extraInts.length)) {
                var castNames = extraInts && extraInts.length ? active.intKeys.concat(extraInts) : active.intKeys;
                var castRe = new RegExp("\\b(" + castNames.map(escapeRegExp).join("|") + ")((?:\\.[A-Za-z_]\\w*)*)(\\+\\+|--)?(?![\\w.])", "g");
                code = code.replace(castRe, function (match, name, fields, postfix, offset, whole) {
                    if (insideBrackets(whole, offset)) return match;
                    if (offset > 0 && whole.charAt(offset - 1) === ".") return match;
                    if (noCast[name]) return match;
                    if (protectedNames && protectedNames.names && protectedNames.names[name]) {
                        var bareBefore = whole.slice(0, offset).replace(/[ \t]+$/, "");
                        var bareAfter = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                        if (/[(,]$/.test(bareBefore) && /^[,)]/.test(bareAfter)) return match;
                    }
                    if (inParameterList(whole, offset)) return match;
                    if (declaredName && name === declaredName && (equalIndex === -1 || offset < equalIndex)) return match;
                    var enclosing = enclosingCall(whole, offset);
                    if (enclosing && /^(?:float|int|uint)$/.test(enclosing.name)) {
                        if (!intDeclarationHasFloat(whole.slice(enclosing.open + 1, offset), active, false)) return match;
                    }
                    if (intDeclaration && !insideAnyCall(whole, offset) && !intDeclFloat) return match;
                    var after = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                    if (/^(?:%|\[|\+\+|--|[+\-*\/%]?=(?!=))/.test(after)) return match;
                    if (fields) {
                        // `ivecVar.y - x`: cast the field selection, not the vector;
                        // but `ivecVar.x = …` is an l-value and must stay.
                        if (/^\s*(?:[+\-*\/%]?=(?!=)|\+\+|--)/.test(after)) return match;
                        var lastField = fields.slice(fields.lastIndexOf(".") + 1);
                        var fieldDim = lastField.length >= 2 && lastField.length <= 4 ? lastField.length : 1;
                        return (fieldDim === 1 ? "float(" : "vec" + fieldDim + "(") + name + fields + ")";
                    }
                    var before = whole.slice(Math.max(0, offset - 6), offset);
                    if (/%\s*$/.test(before)) return match;
                    if (postfix) return "float(" + name + postfix + ")";
                    if (intVectorDims[name]) return "vec" + intVectorDims[name] + "(" + name + ")";
                    return "float(" + name + ")";
                });
            }
            code = wrapModuloExpressions(code, active, inlineInts, intReturnFunctions);
            code = code.replace(promotionRe, function (match, prefix, digits, offset, whole) {
                if (insideBrackets(whole, offset + prefix.length)) return match;
                var head = whole.slice(0, offset + prefix.length);
                if (/[\d.][eE][+-]?$/.test(head)) return match;
                var tail = whole.slice(offset + match.length);
                if (/%\s*$/.test(head) || /^\s*%/.test(tail)) return match;
                if (protectedNames && protectedNames.literals && protectedNames.literals[digits]) {
                    var literalHead = whole.slice(0, offset + prefix.length).replace(/[ \t]+$/, "");
                    var literalTail = whole.slice(offset + match.length).replace(/^[ \t]+/, "");
                    if (/[(,]$/.test(literalHead) && /^[,)]/.test(literalTail)) return match;
                }
                // In an int declaration, only literals inside calls are float
                // operands (`int(y) = int(f * 2)`); bare int arithmetic stays.
                if (intDeclaration && !insideAnyCall(whole, offset + prefix.length)) return match;
                var literalCall = enclosingCall(whole, offset + prefix.length);
                if (literalCall && /^(?:float|int|uint)$/.test(literalCall.name) &&
                    !intDeclarationHasFloat(whole.slice(literalCall.open + 1, offset + prefix.length), active, false)) {
                    return match;
                }
                // Keep integers compared against (or assigned to) a known int
                // name: the original int context was valid, int/float is not.
                var assignment = /([A-Za-z_]\w*)\s*(?:[+\-*\/%]?=(?!=)|\+\+|--)\s*$/.exec(head);
                if (assignment && (active.ints[assignment[1]] || (inlineInts && inlineInts[assignment[1]]) || (intDeclaration && assignment[1] === declaredName))) return match;
                var previous = /([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*\s*(?:==|!=|<=|>=|<|>)\s*$/.exec(head);
                var next = /^\s*(?:==|!=|<=|>=|<|>)\s*([A-Za-z_]\w*)(?:\.[A-Za-z_]\w*)*/.exec(tail);
                if ((previous && (active.ints[previous[1]] || (inlineInts && inlineInts[previous[1]]))) || (next && (active.ints[next[1]] || (inlineInts && inlineInts[next[1]])))) return match;
                return prefix + digits + ".0";
            });
            return coerceBuiltinArguments(code, active, inlineInts);
        }

        var lines = text.split("\n");
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            // Generated overload shims must not be rewritten by the promotion
            // pass: `int(x)` casts inside them select the int overload.
            if (line.indexOf("docsify-isf-shim") !== -1) continue;
            var code = line.replace(/\/\/[^\n]*/g, "");
            if (/^[ \t]*#/.test(code)) continue;
            // A standalone integer literal continuing a call from the previous
            // line (`mix(a, b,\n 0,\n step(...))`) is a float argument.
            if (/^\s*\d+\s*[,)]?\s*$/.test(code) && i > 0 && /[,($]\s*$/.test(lines[i - 1])) {
                lines[i] = line.replace(/(\d+)/, "$1.0");
                continue;
            }
            // Bitwise operators are an int context, but logical `&&`/`||` are not.
            if (/[&|^]/.test(code.replace(/&&/g, "").replace(/\|\|/g, ""))) continue;
            var patterns = patternsFor(scopes[i].ints, scopes[i].floats);
            var protectedNames = protectedCallArguments(code);
            // `for`/`while` headers: only the condition is an expression to fix.
            // Inline loops after other code fall through to the general path.
            if (/\bfor\b/.test(code)) {
                var forMatched = false;
                var forLine = line.replace(/^([ \t]*for[ \t]*\(([^;]*);)([^;]*)(;)/, function (match, head, init, condition, tail) {
                    forMatched = true;
                    var loopVars = [];
                    var floatVars = [];
                    var loopRe = /\b(int|float)\s+([A-Za-z_]\w*)\s*=/g;
                    var loopMatch;
                    while ((loopMatch = loopRe.exec(init))) (loopMatch[1] === "int" ? loopVars : floatVars).push(loopMatch[2]);
                    // `for (float j = -1; …)`: promote literals in the initialiser.
                    var newInit = init;
                    var floatInit = /^([ \t]*float[ \t]+([A-Za-z_]\w*)[ \t]*=(?!=))([\s\S]*)$/.exec(init);
                    if (floatInit) {
                        newInit = floatInit[1] + castAndPromote(floatInit[3], floatInit[2], -1, true, null, patterns, false, protectedNames, null);
                    }
                    return head.replace(init, newInit) + castAndPromote(condition, null, -1, false, loopVars, patterns, false, protectedNames, null, floatVars) + tail;
                });
                if (forMatched) {
                    lines[i] = forLine;
                    continue;
                }
            }
            if (/\bwhile\b/.test(code)) {
                var whileLine = line.replace(/^([ \t]*while[ \t]*\()([^)]*)(\))/, function (match, head, condition, tail) {
                    return head + castAndPromote(condition, null, -1, false, null, patterns, false, protectedNames) + tail;
                });
                if (whileLine !== line) {
                    lines[i] = whileLine;
                    continue;
                }
            }
            // `int x = <expr>;`: cast int identifiers used in float expressions
            // on the right-hand side, but leave bare int() casts and literals alone.
            var intDeclarationMatch = /^[ \t]*(?:(?:const|lowp|mediump|highp)[ \t]+)*(?:int|uint|ivec[234]|uvec[234]|bvec[234])[ \t]+([A-Za-z_]\w*)/.exec(code);
            if (intDeclarationMatch) {
                lines[i] = castAndPromote(line, intDeclarationMatch[1], -1, false, null, patterns, true, protectedNames);
                continue;
            }
            if (/\b(switch|case|default)\b/.test(code)) continue;
            // Assignments to int identifiers are an integer context.
            if (patterns.intAssignRe && patterns.intAssignRe.test(code)) continue;
            if (/<<|>>/.test(code)) continue;
            if (patterns.intAssignRe && patterns.intAssignRe.test(code)) continue;
            // An int-returning function's expression is an integer context
            // (`return (land < .15 ? 1 : 0);`).
            if (!intDeclarationMatch && /\breturn\b/.test(code) && /^(?:int|uint|[iub]vec[234])$/.test(scopes[i].returnType || "")) continue;
            // `return 0;` in a float-returning function: force the literal.
            if (!intDeclarationMatch && /\breturn\b/.test(code) && /^(?:float|vec[234]|mat[234])$/.test(scopes[i].returnType || "")) {
                lines[i] = castAndPromote(line, null, -1, true, null, patterns, false, protectedNames, null);
                continue;
            }
            var declarationMatch = /^[ \t]*(?:(?:const|lowp|mediump|highp)[ \t]+)*(?:float|vec[234]|mat[234]|bool)[ \t]+([A-Za-z_]\w*)[ \t]*(?:=|;|,|\[)/.exec(code);
            var declaredName = declarationMatch ? declarationMatch[1] : null;
            var intDeclarationInline = false;
            var inlineIntNames = null;
            if (!declarationMatch) {
                // `for (int i = 0; …)` and friends: protect the initialiser
                // literal from promotion even when the line also contains
                // floats (inline loop bodies).
                var inlineRe = /\b(?:int|uint|ivec[234]|uvec[234])\s+([A-Za-z_]\w*)\s*=(?!=)/g;
                var inlineMatch;
                while ((inlineMatch = inlineRe.exec(code))) {
                    if (!inlineIntNames) inlineIntNames = {};
                    inlineIntNames[inlineMatch[1]] = true;
                    if (!intDeclarationInline) {
                        declaredName = inlineMatch[1];
                        intDeclarationInline = true;
                    }
                }
            }
            var equalIndex = code.indexOf("=");
            lines[i] = castAndPromote(line, declaredName, equalIndex, !!declarationMatch, null, patterns, intDeclarationInline, protectedNames, inlineIntNames);
        }
        return lines.join("\n");
    }

    var LIBRARY_ARITY = {
        mod289: { 1: "mm_mod289" },
        mod7: { 1: "mm_mod7" },
        permute: { 1: "mm_permute" },
        rgrad2: { 2: "mm_rgrad2" },
        hash: { 1: "mm_hash2" },
        cosNoise: { 1: "mm_cosnoise" },
        fillDist: { 1: "mm_fill_dist" },
        strokeDist: { 2: "mm_stroke_dist" },
        circle: { 2: "mm_circle2", 3: "mm_circle3" },
        roundedRectangle: { 3: "mm_rrect3", 4: "mm_rrect4" },
        triangle: { 2: "mm_triangle2", 3: "mm_triangle3" },
        hexagon: { 2: "mm_hexagon2", 3: "mm_hexagon3" },
        line: { 4: "mm_line4" },
        arc: { 4: "mm_arc4" },
        translate: { 2: "mm_translate" },
        rotate: { 2: "mm_rotate" },
        repeat: { 2: "mm_repeat2", 3: "mm_repeat3", 4: "mm_repeat4", 5: "mm_repeat5" },
        blend: { 2: "mm_blend" },
        smin: { 3: "mm_smin" },
        smoothBlend: { 3: "mm_smoothblend" },
        subtract: { 2: "mm_subtract" },
        intersect: { 2: "mm_intersect" }
    }

    var LIBRARY_DIM = {
        noise: ["mm_noise2", "mm_noise3"],
        vnoise: ["mm_vnoise2", "mm_vnoise3"],
        worleyNoise: ["mm_worley2", "mm_worley3"],
        billowedNoise: ["mm_billowed2", "mm_billowed3"]
    }

    var LIBRARY_NAMES = {};
    (function () {
        var name;
        for (name in LIBRARY_ARITY) if (Object.prototype.hasOwnProperty.call(LIBRARY_ARITY, name)) LIBRARY_NAMES[name] = true;
        for (name in LIBRARY_DIM) if (Object.prototype.hasOwnProperty.call(LIBRARY_DIM, name)) LIBRARY_NAMES[name] = true;
        [
            "fill", "stroke", "glow", "rectangle", "repeatRadial",
            "fBm", "dfBm", "ridgedNoise", "dRidgedNoise", "dnoise", "dvnoise",
            "dWorleyNoise", "dBillowedNoise", "dBillowyTurbulence", "billowyTurbulence",
            "ridgedMF", "dRidgedMF", "curlNoise", "flowNoise", "dFlowNoise"
        ].forEach(function (entry) { LIBRARY_NAMES[entry] = true; });
    })();

    function collectUserFunctions(source) {
        var names = {};
        var re = /\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(/g;
        var match;
        var text = stripComments(String(source || ""));
        while ((match = re.exec(text))) names[match[1]] = true;
        return names;
    }

    function collectDeclaredTypes(source) {
        var types = {};
        var re = /\b(vec[234]|float|int|mat[234])\s+([A-Za-z_]\w*)/g;
        var match;
        while ((match = re.exec(String(source || "")))) types[match[2]] = match[1];
        return types;
    }

    function valueDim(text, types) {
        var value = String(text || "");
        var swizzledConstructor = /\b[iu]?vec[234]\s*\([^()]*\)\s*\.([xyzwrgba]{1,4})\b/.exec(value);
        if (swizzledConstructor) return swizzledConstructor[1].length;
        var constructor = /\b([iu]?vec[234])\s*\(/.exec(value);
        if (constructor) return Number(constructor[1].charAt(constructor[1].length - 1));
        var identifierRe = /\b([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)/g;
        var identifier;
        while ((identifier = identifierRe.exec(value))) {
            var declared = types[identifier[1]];
            if (declared && /^vec[234]$/.test(declared)) {
                var fields = identifier[2].split(".").filter(function (field) { return field; });
                var last = fields.length ? fields[fields.length - 1] : "";
                if (/^[xyzwrgba]{1,4}$/.test(last)) return last.length;
                return Number(declared.slice(3));
            }
        }
        return 0;
    }

    function callArgumentTexts(tokens, openIndex) {
        var depth = 0;
        var close = -1;
        for (var d = openIndex; d < tokens.length; d++) {
            var token = tokens[d];
            if (token.type !== "op") continue;
            if (token.text === "(") depth++;
            else if (token.text === ")") {
                depth--;
                if (depth === 0) { close = d; break; }
            }
        }
        if (close === -1) return null;
        var args = [];
        var current = [];
        var parens = 0, brackets = 0, braces = 0;
        for (var a = openIndex + 1; a < close; a++) {
            var at = tokens[a];
            if (at.type === "op") {
                if (at.text === "(") parens++;
                else if (at.text === ")") parens--;
                else if (at.text === "[") brackets++;
                else if (at.text === "]") brackets--;
                else if (at.text === "{") braces++;
                else if (at.text === "}") braces--;
                else if (at.text === "," && parens === 0 && brackets === 0 && braces === 0) {
                    args.push(current);
                    current = [];
                    continue;
                }
            }
            current.push(at);
        }
        if (current.length || args.length) args.push(current);
        return {
            close: close,
            args: args.map(function (list) {
                return list.map(function (x) { return x.text; }).join("").trim();
            })
        };
    }

    function resolveLibraryRename(name, args, types) {
        if (LIBRARY_ARITY[name]) return LIBRARY_ARITY[name][args.length] || null;
        if (LIBRARY_DIM[name]) {
            var dim = valueDim(args[0] || "", types);
            return LIBRARY_DIM[name][dim === 3 ? 1 : 0] || null;
        }
        // Noise families: dimension-suffixed ports, arity-dependent suffixes.
        var firstDim = valueDim(args[0] || "", types);
        var noiseDim = firstDim === 3 ? 3 : 2;
        switch (name) {
            case "fBm": return args.length === 4 ? "mm_fbm" + noiseDim + "o" : "mm_fbm" + noiseDim;
            case "dfBm": return args.length === 4 ? "mm_dfbm" + noiseDim + "o" : "mm_dfbm" + noiseDim;
            case "ridgedNoise": return args.length === 2 ? "mm_ridged" + noiseDim + "r" : "mm_ridged" + noiseDim;
            case "dRidgedNoise": return args.length === 2 ? "mm_dridged" + noiseDim + "r" : "mm_dridged" + noiseDim;
            case "dnoise": return "mm_dnoise" + noiseDim;
            case "dvnoise": return "mm_dvnoise" + noiseDim;
            case "dWorleyNoise": return "mm_dworley" + noiseDim;
            case "dBillowedNoise": return "mm_dbillowed" + noiseDim;
            case "dBillowyTurbulence": return args.length === 4 ? "mm_dturb" + noiseDim + "o" : "mm_dturb" + noiseDim;
            case "billowyTurbulence": return args.length === 4 ? "mm_turb" + noiseDim + "o" : "mm_turb" + noiseDim;
            case "ridgedMF":
                return args.length === 1 ? "mm_ridgedmf" + noiseDim : args.length === 2 ? "mm_ridgedmf" + noiseDim + "r" : "mm_ridgedmf" + noiseDim + "o";
            case "dRidgedMF":
                return args.length === 1 ? "mm_dridgedmf" + noiseDim : args.length === 2 ? "mm_dridgedmf" + noiseDim + "r" : "mm_dridgedmf" + noiseDim + "o";
            case "curlNoise": return args.length === 2 ? "mm_curl2t" : "mm_curl2";
            case "flowNoise": return "mm_flow2";
            case "dFlowNoise": return "mm_dflow2";
            default: break;
        }
        if (name === "fill") return valueDim(args[0] || "", types) === 4 ? "mm_fill4" : "mm_fill3";
        if (name === "stroke") return valueDim(args[0] || "", types) === 4 ? "mm_stroke4" : "mm_stroke3";
        if (name === "glow") return valueDim(args[0] || "", types) === 4 ? "mm_glow4" : "mm_glow3";
        if (name === "rectangle") {
            if (args.length === 2) return valueDim(args[1] || "", types) === 2 ? "mm_rect_s" : "mm_rect_r";
            if (args.length === 3) return valueDim(args[2] || "", types) === 2 ? "mm_rect_cs" : "mm_rect_cr";
            return null;
        }
        if (name === "repeatRadial") {
            if (args.length === 2) return "mm_repeat_radial2";
            if (args.length === 3) return valueDim(args[2] || "", types) === 2 ? "mm_repeat_radial3" : "mm_repeat_radial4";
            if (args.length === 4) return "mm_repeat_radial5";
            return null;
        }
        return null;
    }

    function rewriteLibraryCalls(source, options) {
        var text = String(source || "");
        var tokens = tokenizeGLSL(text);
        var userFunctions = (options && options.userFunctions) || {};
        var types = (options && options.types) || {};
        var out = [];
        var cursor = 0;
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token.type !== "ident") continue;
            var name = token.text;
            if (userFunctions[name]) continue;
            if (!LIBRARY_NAMES[name]) continue;
            var openIndex = -1;
            for (var j = i + 1; j < tokens.length; j++) {
                if (tokens[j].type === "space" || tokens[j].type === "newline" || tokens[j].type === "comment") continue;
                if (tokens[j].type === "op" && tokens[j].text === "(") openIndex = j;
                break;
            }
            if (openIndex === -1) continue;
            var call = callArgumentTexts(tokens, openIndex);
            if (!call) continue;
            var replacement = resolveLibraryRename(name, call.args, types);
            if (!replacement || replacement === name) continue;
            // The ported mm_* helpers take float vectors; convert i/uvec
            // constructors passed straight in (starfield passes ivec2).
            var fixedArgs = [];
            var changed = false;
            for (var argIndex = 0; argIndex < call.args.length; argIndex++) {
                var originalArg = call.args[argIndex];
                var fixedArg = originalArg.replace(/\b([iu])vec([234])\s*\(/g, "vec$2(");
                if (fixedArg !== originalArg) changed = true;
                fixedArgs.push(fixedArg);
            }
            out.push(text.slice(cursor, token.start));
            if (changed) {
                out.push(replacement + "(" + fixedArgs.join(", ") + ")");
                cursor = tokens[call.close].end;
                i = call.close;
            } else {
                out.push(replacement);
                cursor = token.end;
            }
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    function isInsideESGuardedBlock(source, index) {
        var text = String(source || "");
        var ifndef = text.slice(0, index).lastIndexOf("#ifndef GL_ES");
        if (ifndef === -1) return false;
        var endif = text.indexOf("#endif", ifndef);
        return endif === -1 || endif > index;
    }

    function collectFunctionSignatures(source) {
        var signatures = [];
        var re = /\b(void|float|int|bool|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234])\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
        var match;
        var text = stripComments(String(source || ""));
        while ((match = re.exec(text))) {
            if (isInsideESGuardedBlock(text, match.index)) continue;
            var rawParams = match[3].split(",").map(function (text) { return trim(text); }).filter(function (text) { return text; });
            var params = [];
            var ok = true;
            var hasOut = false;
            for (var i = 0; i < rawParams.length; i++) {
                var raw = rawParams[i];
                var isOut = /\b(out|inout)\b/.test(raw);
                var nameMatch = /([A-Za-z_]\w*)\s*$/.exec(raw);
                var typeMatch = /\b(int|uint|ivec[234]|uvec[234]|bvec[234]|float|vec[234]|mat[234]|bool)\b/.exec(raw);
                if (!nameMatch || !typeMatch) { ok = false; break; }
                params.push({ type: typeMatch[1], name: nameMatch[1], text: raw, out: isOut });
                if (isOut) hasOut = true;
            }
            if (ok) signatures.push({ returnType: match[1], name: match[2], params: params, hasOut: hasOut });
        }
        return signatures;
    }

    function promoteTypeToFloat(type) {
        if (type === "int" || type === "uint") return "float";
        if (/^[iu]vec[234]$/.test(type)) return "vec" + type.slice(4);
        return type;
    }

    function castToOriginalType(type, expression) {
        if (type === "int" || type === "uint") return "int(" + expression + ")";
        if (/^[iub]vec[234]$/.test(type)) return type + "(" + expression + ")";
        return expression;
    }

    function buildOverloadShims(source) {
        var signatures = collectFunctionSignatures(source);
        var existing = {};
        var i, j;
        for (i = 0; i < signatures.length; i++) {
            var key = signatures[i].name + "(" + signatures[i].params.map(function (param) { return param.type; }).join(",") + ")";
            existing[key] = true;
        }
        var prototypes = [];
        var definitions = [];
        var emitted = {};
        var declared = {};
        // Forward prototypes for every user function: the corpus has plenty of
        // call-before-definition helpers (apollian, GetSceneDistance, hash…).
        for (i = 0; i < signatures.length; i++) {
            var declaredKey = signatures[i].name + "(" + signatures[i].params.map(function (param) { return param.type; }).join(",") + ")";
            if (declared[declaredKey]) continue;
            declared[declaredKey] = true;
            prototypes.push(signatures[i].returnType + " " + signatures[i].name + "(" +
                signatures[i].params.map(function (param) { return param.text; }).join(", ") + ");");
        }
        for (i = 0; i < signatures.length; i++) {
            var signature = signatures[i];
            if (signature.hasOut) continue;
            var hasInt = false;
            for (j = 0; j < signature.params.length; j++) {
                if (/^(int|uint|[iub]vec[234])$/.test(signature.params[j].type)) hasInt = true;
            }
            if (!hasInt) continue;
            // Emit the all-float overload plus one overload per int parameter
            // (a call may already pass some arguments as floats).
            var variants = [signature.params.map(function () { return true; })];
            for (j = 0; j < signature.params.length; j++) {
                if (!/^(int|uint|[iub]vec[234])$/.test(signature.params[j].type)) continue;
                variants.push(signature.params.map(function (param, index) {
                    return index !== j;
                }));
            }
            for (var v = 0; v < variants.length; v++) {
                var floatMask = variants[v];
                var floatTypes = signature.params.map(function (param, index) {
                    return floatMask[index] ? promoteTypeToFloat(param.type) : param.type;
                });
                var shimKey = signature.name + "(" + floatTypes.join(",") + ")";
                if (existing[shimKey] || emitted[shimKey]) continue;
                emitted[shimKey] = true;
                var shimParams = signature.params.map(function (param, index) {
                    return floatTypes[index] + " " + param.name;
                }).join(", ");
                var args = signature.params.map(function (param, index) {
                    return floatMask[index] ? castToOriginalType(param.type, param.name) : param.name;
                }).join(", ");
                var body = signature.returnType === "void"
                    ? signature.name + "(" + args + ");"
                    : "return " + signature.name + "(" + args + ");";
                definitions.push(signature.returnType + " " + signature.name + "(" + shimParams + ") { " + body + " } // docsify-isf-shim");
            }
        }
        // Out/inout int parameters must never be floated: they are written
        // back through the out parameter (iter, layer, …).
        var outIntNames = {};
        for (i = 0; i < signatures.length; i++) {
            if (!signatures[i].hasOut) continue;
            for (j = 0; j < signatures[i].params.length; j++) {
                var outParam = signatures[i].params[j];
                if (outParam.out && /^(int|uint|[iu]vec[234])$/.test(outParam.type)) outIntNames[outParam.name] = true;
            }
        }
        // Positions of int parameters per user function: bare int arguments
        // passed there must keep their type (the float-overload shim would
        // otherwise turn a recursive call into a shim cycle).
        var intParamPositions = {};
        for (i = 0; i < signatures.length; i++) {
            var intPositions = [];
            for (j = 0; j < signatures[i].params.length; j++) {
                if (/^(int|uint|[iub]vec[234])$/.test(signatures[i].params[j].type)) intPositions.push(j);
            }
            if (intPositions.length) intParamPositions[signatures[i].name] = intPositions;
        }
        var intReturnFunctions = {};
        for (i = 0; i < signatures.length; i++) {
            if (/^(?:int|uint|[iub]vec[234])$/.test(signatures[i].returnType)) intReturnFunctions[signatures[i].name] = true;
        }
        return { prototypes: prototypes, definitions: definitions, outIntNames: outIntNames, intParamPositions: intParamPositions, intReturnFunctions: intReturnFunctions };
    }

    var TYPE_KEYWORDS = {
        long: "int",
        uint: "int",
        float2: "vec2",
        float3: "vec3",
        float4: "vec4",
        int2: "ivec2",
        int3: "ivec3",
        int4: "ivec4",
        uint2: "ivec2",
        uint3: "ivec3",
        uint4: "ivec4",
        uvec2: "ivec2",
        uvec3: "ivec3",
        uvec4: "ivec4",
        bool2: "bvec2",
        bool3: "bvec3",
        bool4: "bvec4",
        half: "float",
        half2: "vec2",
        half3: "vec3",
        half4: "vec4",
        double: "float",
        dvec2: "vec2",
        dvec3: "vec3",
        dvec4: "vec4",
        mat2x2: "mat2",
        mat3x3: "mat3",
        mat4x4: "mat4"
    }

    function replaceIdentifiers(source, replacements) {
        var text = String(source || "");
        var tokens = tokenizeGLSL(text);
        var out = [];
        var cursor = 0;
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token.type !== "ident") continue;
            var replacement = replacements[token.text];
            if (!replacement) continue;
            // A dialect type keyword is only a type when it introduces a
            // declaration (`half2 v`) or a constructor (`half2(…)`). A user
            // variable that happens to be named `half2` stays untouched.
            var rest = text.slice(token.end).replace(/^[ \t]+/, "");
            if (!/^[A-Za-z_(\[]/.test(rest)) continue;
            out.push(text.slice(cursor, token.start));
            out.push(replacement);
            cursor = token.end;
        }
        if (out.length) {
            out.push(text.slice(cursor));
            return out.join("");
        }
        return text;
    }

    function normalizeTypeKeywords(source) {
        return replaceIdentifiers(source, TYPE_KEYWORDS);
    }

    function normalizeNumericSuffixes(source) {
        return String(source || "").replace(/(0[xX][0-9a-fA-F]+|\d*\.?\d+)([fFuU])\b/g, function (match, digits, suffix) {
            if (/^0[xX]/.test(digits)) return /[uU]/.test(suffix) ? digits : match;
            return digits;
        });
    }

    var MATH_CONSTANTS = {
        M_PI: "3.14159265358979323846",
        M_2PI: "6.28318530717958647692",
        M_TWO_PI: "6.28318530717958647692",
        M_PI_2: "1.57079632679489661923",
        M_PI_4: "0.78539816339744830962",
        M_1_PI: "0.31830988618379067154",
        M_2_SQRTPI: "1.12837916709551257390",
        M_E: "2.71828182845904523536",
        M_SQRT2: "1.41421356237309504880",
        TWO_PI: "6.28318530717958647692",
        HALF_PI: "1.57079632679489661923"
    }

    function constantPreludeLines(source, inputNames) {
        var lines = [];
        var text = stripComments(String(source || ""));
        for (var name in MATH_CONSTANTS) {
            if (!Object.prototype.hasOwnProperty.call(MATH_CONSTANTS, name)) continue;
            if (inputNames && inputNames[name]) continue;
            var declared = new RegExp("#\\s*define\\s+" + name + "\\b").test(text) ||
                new RegExp("\\b(?:const\\s+)?(?:float|int|vec[234]|mat[234])\\s+" + name + "\\b").test(text);
            if (declared) continue;
            lines.push("#define " + name + " " + MATH_CONSTANTS[name]);
        }
        return lines;
    }

    function renameBuiltinShadows(source) {
        var text = String(source || "");
        var userFunctions = collectUserFunctions(text);
        var renames = {};
        for (var name in userFunctions) {
            if (!Object.prototype.hasOwnProperty.call(userFunctions, name)) continue;
            if (!GLSL_BUILTINS[name]) continue;
            // `#ifndef GL_ES float distance(…) #endif`: on WebGL the builtin is
            // intended and the shadowing definition is preprocessed away.
            if (isInsideESGuardedBlock(text, text.search(new RegExp("\\b(?:void|float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])\\s+" + escapeRegExp(name) + "\\s*\\(")))) continue;
            var candidate = "usr_" + name;
            var suffix = 1;
            while (userFunctions[candidate] || text.indexOf(candidate) !== -1) candidate = "usr_" + name + "_" + suffix++;
            renames[name] = candidate;
        }
        if (!Object.keys(renames).length) return text;
        return replaceIdentifiers(text, renames);
    }

function promoteIntegerLiterals(source, options) {
    const o = options || {};
    const floats = {};
    const ints = {};
    for (const name of o.floatNames || []) floats[name] = true;
    for (const name of o.intNames || []) ints[name] = true;
    // `identifiers: false` is the core's safe transform: only literals are
    // promoted. A catch-all noCast set keeps the identifier casts (and the
    // int()/modulo rewrites) for the last-resort attempt.
    const noCast = o.identifiers === false
        ? new Proxy({}, { get: () => true, has: () => true })
        : (o.noCastInts || {});
    return promoteIntegerLiteralsCore(source, floats, ints, noCast,
        o.intParamPositions || {}, o.intReturnFunctions || {});
}

/* OBS's shader compiler lowers `pow(x, <positive integer>)` to repeated
 * multiplication, so a negative base keeps its sign (`pow(-2.0, 3.0)` is
 * -8.0). GLSL leaves `pow` undefined for a negative base, and SwiftShader
 * turns it into NaN (written as black), which is why materials such as the
 * `tuto-damper` line (`1 - pow(dist, 3)`) render white in OBS and black in
 * the browser. Emulate the lowering so the browser preview matches OBS.
 * Comments are copied verbatim; only literal exponents 2…8 are rewritten. */
function lowerIntegerPowers(source) {
    const src = String(source == null ? "" : source);
    const isIdent = (c) => /[A-Za-z0-9_]/.test(c || "");
    let out = "";
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === "/" && src[i + 1] === "/") {
            const nl = src.indexOf("\n", i);
            const end = nl < 0 ? src.length : nl;
            out += src.slice(i, end);
            i = end;
            continue;
        }
        if (c === "/" && src[i + 1] === "*") {
            const close = src.indexOf("*/", i + 2);
            const end = close < 0 ? src.length : close + 2;
            out += src.slice(i, end);
            i = end;
            continue;
        }
        if (c === "p" && src.startsWith("pow", i) && !isIdent(src[i - 1]) && !isIdent(src[i + 3])) {
            let j = i + 3;
            while (j < src.length && /\s/.test(src[j])) j += 1;
            if (src[j] === "(") {
                let depth = 0;
                let comma = -1;
                let k = j;
                for (; k < src.length; k += 1) {
                    const ch = src[k];
                    if (ch === "(") depth += 1;
                    else if (ch === ")") { depth -= 1; if (depth === 0) break; }
                    else if (ch === "," && depth === 1) { comma = k; break; }
                }
                if (comma > 0) {
                    depth = 1;
                    let m = comma + 1;
                    for (; m < src.length; m += 1) {
                        if (src[m] === "(") depth += 1;
                        else if (src[m] === ")") { depth -= 1; if (depth === 0) break; }
                    }
                    if (m < src.length) {
                        const first = lowerIntegerPowers(src.slice(j + 1, comma).trim());
                        const second = src.slice(comma + 1, m);
                        const literal = /^\s*([2-8])(?:\.0*)?\s*$/.exec(second);
                        if (first && literal) {
                            const part = "(" + first + ")";
                            out += "(" + new Array(Number(literal[1])).fill(part).join(" * ") + ")";
                            i = m + 1;
                            continue;
                        }
                    }
                }
            }
        }
        out += c;
        i += 1;
    }
    return out;
}

export {
    normalizeTypeKeywords,
    normalizeNumericSuffixes,
    renameBuiltinShadows,
    rewriteLibraryCalls,
    buildOverloadShims,
    constantPreludeLines,
    promoteIntegerLiterals,
    lowerIntegerPowers,
    collectFunctionSignatures,
    collectUserFunctions,
    collectDeclaredTypes
};
