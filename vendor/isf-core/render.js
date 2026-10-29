/* ============================================================================
 * PM UI toolkit — ISF renderer
 *
 * A small WebGL1 renderer for parsed ISF materials, faithful to OBS's host:
 * TIME/RENDERSIZE/isf_FragNormCoord, image inputs as textures with size
 * uniforms, PASSES with TARGET/PERSISTENT and a final present, and PNG
 * capture for the cover-comparison tooling.
 *
 *   const r = createRenderer({ canvas });
 *   r.setSource(fsText, { width: 320, height: 180 });   // parse + compile
 *   r.setParams({ inputColor: [1, 0, 0, 1] });
 *   r.setTime(1.5); r.render();
 *   const dataUrl = r.capture();
 *
 * The GL context can be injected (`opts.gl`) so the flow is testable under
 * Node with a stub, and so a future WebGL2/offscreen path can share the code.
 * ========================================================================= */
import {
  parseISF, defaultParams, assembleShaders, VERTEX_SHADER, VERTEX_SHADER_ES3,
  promoteIntegerLiterals, evalSizeExpression, longUniformValue,
} from './parse.js';
import { createGenerators } from './generators.js';
import { promoteIntegerLiterals as promoteIntegerLiteralsCompat } from './compat.js';

const CONTEXT_ATTRS = {
  alpha: false, depth: false, stencil: false, antialias: false,
  premultipliedAlpha: false, preserveDrawingBuffer: true,
};

/** `ERROR: 0:123: message` → `{ line, message }`; line is body-relative. */
function parseShaderLog(log, preludeLines, bodyStartLine) {
  const errors = [];
  const warnings = [];
  for (const raw of String(log || '').split('\n')) {
    const m = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(raw.trim());
    if (!m) continue;
    const shaderLine = Number(m[2]);
    const bodyLine = shaderLine - preludeLines;
    const entry = {
      severity: m[1].toLowerCase(),
      shaderLine,
      bodyLine: bodyLine > 0 ? bodyLine : null,
      fileLine: bodyLine > 0 ? bodyLine + (bodyStartLine || 1) - 1 : null,
      message: m[3] || raw.trim(),
    };
    (entry.severity === 'error' ? errors : warnings).push(entry);
  }
  if (!errors.length && !warnings.length && String(log || '').trim()) {
    warnings.push({ severity: 'warning', shaderLine: null, bodyLine: null, fileLine: null, message: String(log).trim() });
  }
  return { errors, warnings };
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  const ok = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  const log = gl.getShaderInfoLog(shader) || '';
  if (!ok) gl.deleteShader(shader);
  return { shader, ok, log };
}

function createProgram(gl, vs, fs) {
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
  const log = gl.getProgramInfoLog(program) || '';
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!ok) gl.deleteProgram(program);
  return { program, ok, log };
}

/**
 * ISF PASSES dimensions: `$WIDTH`/`$HEIGHT` and the documented functions
 * (`floor`, `max`, …), evaluated safely (see `evalSizeExpression`).
 */
function evalSize(expr, fallback, width, height) {
  if (expr == null || expr === '') return fallback;
  const value = evalSizeExpression(expr, {
    $WIDTH: width, $HEIGHT: height, WIDTH: width, HEIGHT: height, width, height,
  }, NaN);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.round(value));
}

export function createRenderer(opts) {
  const options = opts || {};
  const canvas = options.canvas || null;
  const gl = options.gl || ((canvas && typeof canvas.getContext === 'function')
    ? (canvas.getContext('webgl2', CONTEXT_ATTRS)
      || canvas.getContext('webgl', CONTEXT_ATTRS)
      || canvas.getContext('experimental-webgl', CONTEXT_ATTRS))
    : null);
  // WebGL2 compiles GLSL ES 3.00: a strict ES 1.00 driver rejects the dynamic
  // array indexing several shipped materials use, so the dialect follows.
  const api = options.api || (gl && gl.__isfApi) || (gl && typeof WebGL2RenderingContext !== 'undefined'
    && gl instanceof WebGL2RenderingContext ? 'es3' : 'es1');
  let activeApi = api;   // the dialect the accepted attempt compiled with
  const state = {
    ok: false, error: null, errors: [], warnings: [], api,
    colorSpace: (options.colorSpace === 'raw' || (options.colorSpace !== 'obs')) ? 'raw' : 'obs',
    parsed: null, params: {}, width: 320, height: 180,
    time: 0, delta: 0, frame: 0, passCount: 0, sources: [],
    date: null,   // [year, month(1-12), day, secondsOfDay] or null (zeros)
    mouse: [0, 0, 0, 0],   // _isfMouse: x, y (0…1), down, click
  };

  // FLOAT PASSES targets need renderable float textures; probe once. When
  // linear filtering of float textures is unavailable (WebGL1 without
  // OES_texture_float_linear), the target must use NEAREST or sampling is
  // undefined (an incomplete texture reads as opaque black).
  const isGL2 = !!(gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
  const floatRenderable = (() => {
    if (!gl) return false;
    try {
      if (isGL2) { if (!gl.getExtension('EXT_color_buffer_float')) return false; }
      else if (!gl.getExtension('OES_texture_float')) return false;
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, isGL2 ? gl.RGBA32F : gl.RGBA, 4, 4, 0, gl.RGBA, gl.FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(texture);
      return status === gl.FRAMEBUFFER_COMPLETE;
    } catch (error) {
      return false;
    }
  })();
  const floatLinear = (() => {
    try { return !!(gl && gl.getExtension('OES_texture_float_linear')); } catch (error) { return false; }
  })();

  let generators = null;         // CPU generator instance (MadMapper GENERATORS)
  let quad = null;
  const textures = new Map();   // name → { texture, width, height }
  let present = null;           // lazily built "present the last target" program
  let encode = null;            // lazily built sRGB encode blit (OBS filter path)
  let outTarget = null;         // offscreen output for the encode path
  let lastTime = null;
  let raf = 0;
  let onFrame = null;

  if (gl) gl.disable(gl.DEPTH_TEST);
  // OBS evaluates filters in linear space and re-encodes on output. With
  // WebGL2 we can model that in hardware: sRGB textures decode on sample,
  // and the linear drawing buffer lets the browser encode on present. Set
  // `colorSpace: 'raw'` for the spec-native (no colour management) path.
  // OBS's pipeline: sources/generators write sRGB values through untouched;
  // filter stages sample the source *decoded to linear*, run the material, and
  // encode the result back to sRGB for display. `colorSpace: 'obs'` models the
  // filter stage (sRGB image textures + an encode blit); 'raw' is the
  // spec-native path the docsify viewer uses.
  const srgb = () => api === 'es3' && state.colorSpace === 'obs';
  const srgbImageFormat = () => (srgb() && gl.SRGB8_ALPHA8) || null;

  function ensureQuad() {
    if (quad || !gl) return quad;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    quad = { buffer };
    return quad;
  }

  function bindQuad(program) {
    ensureQuad();
    // custom vertex shaders (`.vs`) use the ISF attribute name
    let loc = gl.getAttribLocation(program, 'isf_position');
    if (loc < 0) loc = gl.getAttribLocation(program, 'aPos');
    if (loc >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, quad.buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    return loc >= 0;
  }

  const wrapMode = (value, fallback) => {
    const text = String(value == null ? '' : value).toUpperCase();
    if (text.indexOf('MIRROR') >= 0) return gl.MIRRORED_REPEAT;
    if (text.indexOf('REPEAT') >= 0) return gl.REPEAT;
    if (text.indexOf('CLAMP') >= 0) return gl.CLAMP_TO_EDGE;
    return fallback;
  };
  const filterMode = (value, fallback) => {
    const text = String(value == null ? '' : value).toUpperCase();
    if (text.indexOf('NEAREST') >= 0) return gl.NEAREST;
    if (text.indexOf('LINEAR') >= 0) return gl.LINEAR;
    return fallback;
  };

  function textureFor(name, width, height, opts) {
    const o = opts || {};
    const existing = textures.get(name);
    const sameOpts = existing && existing.wrap === o.wrap && existing.minFilter === o.minFilter && existing.magFilter === o.magFilter;
    if (existing && existing.width === width && existing.height === height && sameOpts) return existing;
    if (existing) gl.deleteTexture(existing.texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const wrap = wrapMode(o.wrap, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode(o.minFilter, gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode(o.magFilter, gl.LINEAR));
    // render-target storage: pass targets keep linear values (the shaders
    // operate in linear space), sRGB decoding happens on image inputs
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const entry = { texture, width, height, source: null,
      wrap: o.wrap, minFilter: o.minFilter, magFilter: o.magFilter };
    textures.set(name, entry);
    return entry;
  }

  /**
   * A PASSES target is ping-ponged like OBS/ISF: the pass samples the read
   * texture (the previous content) and writes the other one, then they swap,
   * so a pass reading its own target is defined behaviour.
   */
  function createPassTarget(name, width, height, opts) {
    const o = opts || {};
    const useFloat = !!(o.float && floatRenderable);
    const filter = useFloat && !floatLinear ? gl.NEAREST : gl.LINEAR;
    const make = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texImage2D(gl.TEXTURE_2D, 0, useFloat && isGL2 ? gl.RGBA32F : gl.RGBA, width, height, 0, gl.RGBA,
        useFloat ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { texture, fbo };
    };
    const entry = {
      name, width, height, pair: [make(), make()], read: 0,
      readTexture() { return entry.pair[entry.read].texture; },
      readFbo() { return entry.pair[entry.read].fbo; },
      writeFbo() { return entry.pair[1 - entry.read].fbo; },
      flip() { entry.read = 1 - entry.read; },
    };
    textures.set(name, entry);
    return entry;
  }

  /**
   * Upload a TexImageSource (canvas/image/video) into a sampler uniform:
   * image inputs and `IMPORTED` textures. `opts` carries the import's
   * `GL_TEXTURE_WRAP` / filter hints.
   */
  /** Read a PASSES target back (debugging: inspect the chain stage by stage). */
  function readTarget(name) {
    if (!gl) return null;
    const entry = textures.get(name);
    if (!entry) return null;
    const fbo = entry.readFbo ? entry.readFbo() : entry.fbo;
    if (!fbo) return null;
    const width = entry.width;
    const height = entry.height;
    const data = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width, height, data: Array.from(data) };
  }

  function setImage(name, source, opts) {
    if (!gl || !name) return null;
    const width = source.width || source.videoWidth || 1;
    const height = source.height || source.videoHeight || 1;
    const entry = textureFor(name, width, height, opts);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    // ISF samples images with `isf_FragNormCoord`, whose origin is the
    // bottom-left (spec); a TexImageSource is top-down. Upload flipped so
    // v=0 is the image bottom and `IMG_NORM_PIXEL(image, uv)` is upright on
    // the canvas, exactly like the reference ISF-JS-Renderer. `_<image>_flip`
    // stays 0 because the texture is already in ISF orientation.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const imageFormat = srgbImageFormat();
    if (imageFormat) gl.texImage2D(gl.TEXTURE_2D, 0, imageFormat, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    entry.source = source;
    return entry;
  }

  function setParams(params) {
    state.params = Object.assign({}, state.params, params || {});
    return state.params;
  }

  function setParam(name, value) {
    state.params[name] = value;
    return value;
  }

  function setTime(seconds) {
    state.time = Number(seconds) || 0;
    return state.time;
  }

  /**
   * The DATE uniform as [year, month(1-12), day, seconds-of-day] — the shape
   * the docsify kernel's `renderFrame` uses. A Date or ISO string is accepted;
   * null (the default) keeps OBS's zeros.
   */
  /** _isfMouse: [x, y (0…1), down, click] — the host pointer extension. */
  function setMouse(value) {
    if (Array.isArray(value) && value.length >= 4) state.mouse = value.slice(0, 4).map((part) => Number(part) || 0);
    return state.mouse;
  }

  function setDate(value) {
    if (value == null) { state.date = null; return null; }
    if (Array.isArray(value) && value.length >= 4) {
      state.date = value.slice(0, 4).map((part) => Number(part) || 0);
      return state.date;
    }
    const date = value instanceof Date ? value : new Date(value);
    state.date = Number.isFinite(date.getTime())
      ? [date.getFullYear(), date.getMonth() + 1, date.getDate(),
        date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()]
      : null;
    return state.date;
  }

  function applyUniform(program, name, setter) {
    const loc = gl.getUniformLocation(program, name);
    if (loc == null) return;
    setter(loc);
  }

  /** Compile (or recompile) all passes from ISF source text. */
  function setSource(source, size, opts2) {
    state.parsed = parseISF(source);
    state.errors = [];
    state.warnings = state.parsed.warnings.slice();
    state.params = {};
    state.ok = false;
    state.error = state.parsed.error || null;
    if (!state.parsed.valid) return state;
    if (!gl) { state.error = { message: 'No WebGL context' }; return state; }

    const width = Math.max(1, Math.round((size && size.width) || state.width));
    const height = Math.max(1, Math.round((size && size.height) || state.height));
    state.width = width;
    state.height = height;

    // Compatibility retries: compile as written first; only on failure try
    // integer-literal promotion and the other GLSL dialect — working shaders
    // are never touched (the reference viewer's policy).
    // Safe transforms first: the as-written shader, then literal promotion in
    // both dialects. Identifier casts can compile while silently changing the
    // maths, so they are the last resort.
    const order = api === 'es3' ? ['es3', 'es1'] : ['es1', 'es3'];
    const vsSource = (opts2 && opts2.vs) || null;
    const attempts = [];
    for (const dialect of order) {
      attempts.push({ api: dialect, promote: false, identifiers: false });
      attempts.push({ api: dialect, promote: true, identifiers: false });
    }
    for (const dialect of order) {
      attempts.push({ api: dialect, promote: true, identifiers: true });
    }
    // Inputs, generators and the ISF built-ins are the only names seeded
    // globally; the K1 promotion layer tracks declarations per lexical scope,
    // so a `vec2 i` in one function is not cast because another function has
    // an `int i`.
    const namesFor = (source) => {
      const floats = new Set(['PI', 'TIME', 'TIMEDELTA', 'RENDERSIZE', 'DATE',
        'isf_FragNormCoord', 'gl_FragCoord', '_isfMouse']);
      const ints = new Set();
      // Mirror the docsify kernel's seeding exactly: float/vec inputs are
      // float names, int/uint/long inputs are int names (a `long` input is a
      // `uniform int` in the shader), and only float generators are seeded.
      for (const input of state.parsed.inputs) {
        if (/^(float|vec[234])$/.test(input.uniform)) floats.add(input.name);
        else if (/^(int|uint|long)$/.test(input.uniform)) ints.add(input.name);
      }
      for (const generator of state.parsed.generators || []) {
        if (generator.uniform === 'float') floats.add(generator.name);
      }
      return { floatNames: [...floats], intNames: [...ints] };
    };

    let programs = [];
    let attemptErrors = [];
    let lastAttemptErrors = [];
    const attemptReports = [];
    for (let a = 0; a < attempts.length; a += 1) {
      const attempt = attempts[a];
      let shaders = assembleShaders(state.parsed, {
        api: attempt.api, includes: (opts2 && opts2.includes) || null, vs: vsSource,
      });
      if (attempt.promote) {
        shaders = shaders.map((entry) => {
          const names = namesFor(entry.fs);
          return {
            ...entry,
            fs: promoteIntegerLiteralsCompat(entry.fs, attempt.identifiers
              ? Object.assign({}, names, entry.promoteOptions, { identifiers: true })
              : { floatNames: names.floatNames, intNames: [], identifiers: false }),
          };
        });
      }
      const compiled = [];
      const errors = [];
      const warnings = [];
      for (const entry of shaders) {
        const vertexSource = entry.vertex || (attempt.api === 'es3' ? VERTEX_SHADER_ES3 : VERTEX_SHADER);
        const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
        const fs = compile(gl, gl.FRAGMENT_SHADER, entry.fs);
        const vsLog = parseShaderLog(vs.log, 0, 1);
        const fsLog = parseShaderLog(fs.log, entry.preludeLines, state.parsed.bodyStartLine);
        const before = errors.length;
        errors.push(...vsLog.errors.map((e) => ({ ...e, pass: entry.index })), ...fsLog.errors.map((e) => ({ ...e, pass: entry.index })));
        warnings.push(...vsLog.warnings.map((e) => ({ ...e, pass: entry.index })), ...fsLog.warnings.map((e) => ({ ...e, pass: entry.index })));
        if (!vs.ok || !fs.ok) {
          if (errors.length === before) errors.push({ severity: 'error', pass: entry.index, message: 'shader did not compile' });
          continue;
        }
        const linked = createProgram(gl, vs.shader, fs.shader);
        if (!linked.ok) { errors.push({ severity: 'error', pass: entry.index, message: linked.log || 'Program link failed' }); continue; }
        compiled.push({ entry, program: linked.program });
      }
      if (compiled.length === shaders.length && shaders.length) {
        state.attemptErrors = attemptReports;
        state.sources = shaders;
        state.api = attempt.api;
        activeApi = attempt.api;
        state.errors = [];
        state.warnings.push(...warnings);
        if (a > 0) {
          state.warnings.push({ message: 'compiled with compatibility mode: '
            + (attempt.api === 'es3' ? 'ES 3.00' : 'ES 1.00')
            + (attempt.promote ? ' + literal promotion' : '')
            + (attempt.identifiers ? ' + int casts' : '') });
        }
        programs = compiled.map(({ entry, program }) => {
          const pass = entry.pass;
          let target = null;
          if (pass) {
            target = createPassTarget(pass.target,
              pass.widthExpr ? evalSize(pass.widthExpr, width, width, height) : width,
              pass.heightExpr ? evalSize(pass.heightExpr, height, width, height) : height,
              { float: pass.float });
          }
          return { pass, program, target, images: entry.images };
        });
        break;
      }
      // diagnostics describe the shader as written, not the transformed retry;
      // the last attempt's errors are kept separately for the compatibility
      // report (they name what the fallbacks still could not fix)
      if (a === 0) attemptErrors = errors;
      lastAttemptErrors = errors.map((e) => ({ ...e,
        attempt: a, api: attempt.api, promote: attempt.promote, identifiers: attempt.identifiers }));
      attemptReports.push({
        attempt: a, api: attempt.api, promote: attempt.promote, identifiers: attempt.identifiers,
        messages: errors.map((e) => e.message),
      });
    }
    if (!programs.length) {
      state.attemptErrors = attemptReports;
      state.errors = attemptErrors;
      state.compatErrors = lastAttemptErrors;
      state.sources = state.sources || [];
    }
    state.programs = programs;
    state.passCount = programs.length;
    state.params = defaultParams(state.parsed.inputs);
    generators = createGenerators(state.parsed.generators || []);
    state.generatorTime = 0;
    state.generatorValues = {};
    state.ok = state.errors.length === 0 && programs.length > 0;
    if (!state.ok && !state.errors.length) state.error = { message: 'The material has no renderable pass' };
    return state;
  }

  /**
   * Integrate the CPU generators up to `upto` and publish their outputs.
   * A frozen capture rewinds to 0 and integrates in fixed 1/60 s steps, the
   * same deterministic simulation the Lua engine runs while capturing.
   */
  function applyGenerators(upto) {
    if (!generators) return;
    const step = 1 / 60;
    if (upto + 1e-9 < state.generatorTime) {
      generators = createGenerators(state.parsed.generators || []);
      state.generatorTime = 0;
    }
    let t = state.generatorTime;
    let guard = 0;
    while (t < upto - 1e-9 && guard < 60000) {
      const dt = Math.min(step, upto - t);
      t += dt;
      generators.advance(dt, t, state.params);
      guard += 1;
    }
    state.generatorTime = t;
    state.generatorValues = Object.assign({}, generators.outputs);
  }

  function uniformValue(input) {
    const value = state.params[input.name];
    if (value === undefined) return input.default;
    return value;
  }

  function renderPass(entry, index, framebuffer) {
    const { program, target, pass } = entry;
    gl.useProgram(program);
    bindQuad(program);
    const [w, h] = target ? [target.width, target.height] : [state.width, state.height];
    gl.viewport(0, 0, w, h);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.writeFbo ? target.writeFbo() : (target.fbo || null));
      // ISF PERSISTENT targets keep their contents across frames (feedback);
      // the pair is cleared once at creation, and clearing every frame
      // destroyed the accumulation (circular-feedback-mask)
      if (!(pass && pass.persistent)) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer || null);
    }

    applyUniform(program, 'RENDERSIZE', (loc) => gl.uniform2f(loc, w, h));
    applyUniform(program, 'TIME', (loc) => gl.uniform1f(loc, state.time));
    applyUniform(program, 'TIMEDELTA', (loc) => gl.uniform1f(loc, state.delta));
    applyUniform(program, 'PASSINDEX', (loc) => gl.uniform1i(loc, index));
    applyUniform(program, 'FRAMEINDEX', (loc) => gl.uniform1i(loc, state.frame));
    const date = state.date || [0, 0, 0, 0];
    applyUniform(program, 'DATE', (loc) => gl.uniform4f(loc, date[0], date[1], date[2], date[3]));
    applyUniform(program, '_isfMouse', (loc) => gl.uniform4f(loc, state.mouse[0], state.mouse[1], state.mouse[2], state.mouse[3]));

    for (const generator of state.parsed.generators || []) {
      const value = state.generatorValues[generator.name];
      applyUniform(program, generator.name, (loc) => {
        if (generator.uniform === 'bool') gl.uniform1i(loc, value ? 1 : 0);
        else gl.uniform1f(loc, Number(value) || 0);
      });
    }

    for (const input of state.parsed.inputs) {
      const value = uniformValue(input);
      applyUniform(program, input.name, (loc) => {
        if (input.type === 'image' || input.type === 'audio' || input.type === 'audioFFT') return;
        if (input.type === 'float') gl.uniform1f(loc, Number(value) || 0);
        else if (input.type === 'bool' || input.type === 'event') gl.uniform1i(loc, value ? 1 : 0);
        else if (input.type === 'long') gl.uniform1i(loc, longUniformValue(input, value));
        else if (input.type === 'color') gl.uniform4f(loc, value[0], value[1], value[2], value[3]);
        else if (input.type === 'point2D') gl.uniform2f(loc, value[0], value[1]);
      });
    }

    // Every image gets its own texture unit: a pass commonly samples an input
    // image *and* one or more pass targets, and binding them all to unit 0
    // made every sampler read whichever was bound last.
    const maxUnits = (gl.getParameter && gl.MAX_TEXTURE_IMAGE_UNITS
      ? gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) : 0) || 8;
    let unit = 0;
    for (const name of entry.images || []) {
      const source = textures.get(name);
      if (!source || unit >= maxUnits) continue;
      const texture = source.readTexture ? source.readTexture() : source.texture;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      applyUniform(program, name, (loc) => gl.uniform1i(loc, unit));
      applyUniform(program, '_' + name + '_imgSize', (loc) => gl.uniform2f(loc, source.width, source.height));
      // full-image rect, no flip: the ISF host convention the docsify kernel
      // also implements (materials read these uniforms directly)
      applyUniform(program, '_' + name + '_imgRect', (loc) => gl.uniform4f(loc, 0, 0, 1, 1));
      applyUniform(program, '_' + name + '_flip', (loc) => gl.uniform1i(loc, 0));
      unit += 1;
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (target && target.flip) target.flip();
    if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { pass, target, width: w, height: h };
  }

  /** sRGB-encode the linear filter output (OBS's filter stage). */
  function ensureEncode() {
    if (encode || !gl) return encode;
    const vs = compile(gl, gl.VERTEX_SHADER, activeApi === 'es3' ? VERTEX_SHADER_ES3 : VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, [
      activeApi === 'es3' ? '#version 300 es' : 'precision highp float;',
      activeApi === 'es3' ? 'precision highp float;' : '',
      activeApi === 'es3' ? 'in vec2 isf_FragNormCoord;' : 'varying vec2 isf_FragNormCoord;',
      'uniform sampler2D uSrc;',
      activeApi === 'es3' ? 'out vec4 _isfFragColor;' : '',
      'vec3 linearToSrgb(vec3 c) {',
      '  vec3 lo = c * 12.92;',
      '  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;',
      '  return mix(lo, hi, step(vec3(0.0031308), c));',
      '}',
      'void main() {',
      activeApi === 'es3' ? '  _isfFragColor' : '  gl_FragColor',
      ' = vec4(linearToSrgb((' + (activeApi === 'es3' ? 'texture(uSrc, isf_FragNormCoord)' : 'texture2D(uSrc, isf_FragNormCoord)') + ').rgb), 1.0);',
      '}',
    ].filter(Boolean).join('\n'));
    const linked = createProgram(gl, vs.shader, fs.shader);
    if (!linked.ok) {
      state.errors.push({ severity: 'error', pass: 'encode', message: linked.log || 'encode blit failed' });
      state.ok = false;
    }
    encode = linked.ok ? { program: linked.program } : null;
    return encode;
  }

  function ensureOutputTarget(width, height) {
    if (outTarget && outTarget.width === width && outTarget.height === height) return outTarget;
    if (outTarget && outTarget.fbo) gl.deleteFramebuffer(outTarget.fbo);
    if (outTarget) gl.deleteTexture(outTarget.texture);
    const entry = textureFor('__isf_output', width, height);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, entry.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    entry.fbo = fbo;
    outTarget = entry;
    return entry;
  }

  function blitEncode(source) {
    const p = ensureEncode();
    if (!p || !source) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, state.width, state.height);
    gl.useProgram(p.program);
    bindQuad(p.program);
    applyUniform(p.program, 'uSrc', (loc) => gl.uniform1i(loc, 0));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function ensurePresent() {
    if (present || !gl) return present;
    // ES3-aware, like ensureEncode: on a WebGL2 canvas (the editors and the
    // cover-compare harness page) an ES2-style program needs `#version 300 es`,
    // `in` and an `out` variable. Without this the shader fails to compile and
    // `presentTarget()` draws nothing — the per-pass preview went black there,
    // which is exactly the path the pass picker uses.
    const vs = compile(gl, gl.VERTEX_SHADER, activeApi === 'es3' ? VERTEX_SHADER_ES3 : VERTEX_SHADER);
    const fs = compile(gl, gl.FRAGMENT_SHADER, [
      activeApi === 'es3' ? '#version 300 es' : 'precision highp float;',
      activeApi === 'es3' ? 'precision highp float;' : '',
      activeApi === 'es3' ? 'in vec2 isf_FragNormCoord;' : 'varying vec2 isf_FragNormCoord;',
      'uniform sampler2D inputImage;',
      activeApi === 'es3' ? 'out vec4 _isfFragColor;' : '',
      'void main() {',
      activeApi === 'es3'
        ? '  _isfFragColor = texture(inputImage, isf_FragNormCoord);'
        : '  gl_FragColor = texture2D(inputImage, isf_FragNormCoord);',
      '}',
    ].filter(Boolean).join('\n'));
    const linked = createProgram(gl, vs.shader, fs.shader);
    present = linked.ok ? { program: linked.program } : null;
    return present;
  }

  /**
   * Resize the canvas and the pass targets without recompiling: container and
   * quality-scale changes hit this instead of a full setSource().
   */
  function resize(width, height) {
    const w = Math.max(1, Math.round(width || state.width));
    const h = Math.max(1, Math.round(height || state.height));
    if (w === state.width && h === state.height) return { width: w, height: h };
    state.width = w;
    state.height = h;
    if (!gl) return { width: w, height: h };
    for (const entry of state.programs || []) {
      const pass = entry.pass;
      if (!pass) continue;   // the canvas pass has no target
      if (entry.target && entry.target.pair) {
        for (const side of entry.target.pair) {
          gl.deleteTexture(side.texture);
          gl.deleteFramebuffer(side.fbo);
        }
      }
      entry.target = createPassTarget(pass.target,
        pass.widthExpr ? evalSize(pass.widthExpr, w, w, h) : w,
        pass.heightExpr ? evalSize(pass.heightExpr, h, w, h) : h,
        { float: pass.float });
    }
    return { width: w, height: h };
  }

  /**
   * Draw a PASSES target to the canvas: the per-pass preview the plugin's
   * pass picker offers, without a readback.
   */
  function presentTarget(name) {
    if (!gl) return false;
    const entry = textures.get(name);
    if (!entry) return false;
    const target = entry.readTexture ? { texture: entry.readTexture() } : entry;
    const p = target.texture && ensurePresent();
    if (!p || !target.texture) return false;
    gl.useProgram(p.program);
    bindQuad(p.program);
    gl.viewport(0, 0, state.width, state.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    applyUniform(p.program, 'inputImage', (loc) => gl.uniform1i(loc, 0));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Draw one frame. Returns the render size. */
  function render() {
    if (!state.ok || !gl) return null;
    const dt = lastTime == null ? 0 : Math.max(0, state.time - lastTime);
    state.delta = dt;
    lastTime = state.time;
    applyGenerators(state.time);
    const filterPath = srgb();
    let presented = false;
    let output = null;
    for (let i = 0; i < state.programs.length; i += 1) {
      const last = i === state.programs.length - 1;
      const offscreen = filterPath && last && !state.programs[i].target
        ? ensureOutputTarget(state.width, state.height)
        : null;
      const out = renderPass(state.programs[i], i, offscreen ? offscreen.fbo : null);
      if (offscreen) output = offscreen;
      if (!out.target) presented = true;
    }
    if (filterPath) {
      // the last stage is linear: encode it to sRGB for the canvas
      const last = state.programs.length ? state.programs[state.programs.length - 1].target : null;
      const source = output || (last && last.readTexture ? { texture: last.readTexture() } : last);
      blitEncode(source);
    } else if (!presented && state.programs.length) {
      // every pass rendered to a target: show the last one
      const lastTarget = state.programs[state.programs.length - 1].target;
      const target = lastTarget && lastTarget.readTexture
        ? { texture: lastTarget.readTexture() } : lastTarget;
      const p = target && ensurePresent();
      if (p && target) {
        gl.useProgram(p.program);
        bindQuad(p.program);
        gl.viewport(0, 0, state.width, state.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        applyUniform(p.program, 'inputImage', (loc) => gl.uniform1i(loc, 0));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, target.texture);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    state.frame += 1;
    return { width: state.width, height: state.height };
  }

  function start(callback) {
    onFrame = callback || null;
    if (!gl || raf) return;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      render();
      if (onFrame) onFrame({ time: state.time, frame: state.frame, width: state.width, height: state.height });
    };
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * PNG data URL of the current frame. `flipY` is for hosts that store the
   * frame bottom-up; the ISF comparison uses the canvas as displayed (both
   * OBS's compiled effect and this kernel render ISF's bottom-left space).
   */
  function capture(opts) {
    // A frozen capture has already rendered its target frame: `render: false`
    // captures the current drawing buffer instead of advancing the clock and
    // FRAMEINDEX one more time (the context preserves the buffer).
    if (!(opts && opts.render === false)) render();
    if (!canvas || !canvas.toDataURL) return null;
    if (!(opts && opts.flipY)) return canvas.toDataURL('image/png');
    if (typeof document === 'undefined') return canvas.toDataURL('image/png');
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    ctx.translate(0, out.height);
    ctx.scale(1, -1);
    ctx.drawImage(canvas, 0, 0);
    return out.toDataURL('image/png');
  }

  return {
    gl, canvas, state,
    available: !!gl,   // false when the canvas has no WebGL (tests, old hosts)
    setSource, setParams, setParam, setImage, setTime, setDate, setMouse, resize, render, presentTarget,
    start, stop, capture, readTarget,
    targetNames: () => Array.from(textures.keys()),
    get programs() { return state.programs || []; },
    destroy() {
      stop();
      if (!gl) return;
      for (const entry of textures.values()) {
        if (entry.pair) entry.pair.forEach((side) => { gl.deleteTexture(side.texture); gl.deleteFramebuffer(side.fbo); });
        else gl.deleteTexture(entry.texture);
      }
      textures.clear();
      if (quad) gl.deleteBuffer(quad.buffer);
    },
  };
}
