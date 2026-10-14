/* ============================================================================
 * PM UI toolkit — ISF CPU generators (MadMapper extension)
 *
 * Faithful port of `modules/src/isf-source/isf/generators.lua`, the engine OBS
 * uses: changing a speed does not teleport the animation because positions are
 * integrated frame by frame, and generator parameters may reference INPUTS or
 * another generator's (same-frame) output.
 *
 *   const g = createGenerators(parsed.generators, { bpm: 0 });
 *   const outputs = g.advance(dt, now, params);   // name → number
 *
 * Handlers: time_base, animator, damper, adsr, linear_filter, ease_filter,
 * multiplier, incrementer, pass_thru. Approximations documented in the Lua
 * original (damper blend rate, BPM quantiser) are preserved exactly.
 * ========================================================================= */

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const log2 = (x) => Math.log(x) / Math.log(2);

/* deterministic 1D value noise, used by the `animator` Noise shape */
const hash1 = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smoothstep = (t) => t * t * (3 - 2 * t);
const noise1 = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash1(i);
  const b = hash1(i + 1);
  return a + (b - a) * smoothstep(f);
};

/* quantise a speed onto a power-of-two order of magnitude (BPM sync helper) */
function powerOfTwo(x) {
  if (x <= 0) return 0;
  let e = Math.floor(log2(x) + 0.5);
  if (e < -6) e = -6; else if (e > 6) e = 6;
  return Math.pow(2, e);
}

const param = (def, key, fallback) => {
  const v = def.params ? def.params[key] : undefined;
  return v === undefined ? fallback : v;
};

/* ── resolvers ──────────────────────────────────────────────────────────── */

function resolve(self, v, inputs) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const out = self.outputs[v];
    if (out !== undefined) return out;
    const p = inputs ? inputs[v] : undefined;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'number') return p;
    if (p !== undefined && p !== null) return Number(p) || 0;
    if (v === 'TIME') return self.time || 0;
    if (v === 'FRAMEINDEX') return self.frame || 0;
    return 0;
  }
  return 0;
}

function resolveBool(v, inputs) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const p = inputs ? inputs[v] : undefined;
    if (typeof p === 'boolean') return p;
    if (typeof p === 'number') return p !== 0;
    if (p !== undefined && p !== null) return p !== 0 && p !== '';
    const low = v.toLowerCase();
    return low === 'true' || low === '1';
  }
  return false;
}

/* ── handlers ───────────────────────────────────────────────────────────── */

/** time_base: out = out + speed·dt, with reverse / curve / strob / BPM. */
function timeBaseStep(self, gen, dt, inputs) {
  let speed = resolve(self, param(gen.def, 'speed', 0), inputs);
  const curve = resolve(self, param(gen.def, 'speed_curve', 1), inputs);
  const strob = resolve(self, param(gen.def, 'strob', 0), inputs);
  const reverse = resolveBool(param(gen.def, 'reverse', false), inputs);
  const bpmSync = resolveBool(param(gen.def, 'bpm_sync', false), inputs);
  const linkBpm = resolveBool(param(gen.def, 'link_speed_to_global_bpm', false), inputs);

  if (curve && curve !== 1) speed = sign(speed) * Math.pow(Math.abs(speed), curve);
  if (reverse) speed = -speed;
  if (linkBpm && self.bpm && self.bpm > 0) speed = (speed * self.bpm) / 120;
  if (bpmSync && self.bpm && self.bpm > 0) speed = (powerOfTwo(speed) * self.bpm) / 60;

  let effectiveDt = dt;
  if (strob && strob > 0) {
    gen.strobAcc = (gen.strobAcc || 0) + dt;
    if (gen.strobAcc >= strob) { effectiveDt = gen.strobAcc; gen.strobAcc = 0; }
    else effectiveDt = 0;
  }
  gen.tb = (gen.tb || 0) + speed * effectiveDt;
  return gen.tb;
}

const handlers = {
  time_base(self, gen, dt, _now, inputs) {
    gen.out = timeBaseStep(self, gen, dt, inputs);
    return gen.out;
  },

  animator(self, gen, dt, _now, inputs) {
    const t = timeBaseStep(self, gen, dt, inputs);
    let shape = param(gen.def, 'shape', 'Smooth');
    if (typeof shape !== 'string') shape = 'Smooth';
    const p = t - Math.floor(t);
    let v;
    if (shape === 'In') v = p;
    else if (shape === 'Out') v = 1 - p;
    else if (shape === 'Linear') v = 1 - Math.abs(2 * p - 1);
    else if (shape === 'Cut') v = p < 0.5 ? 0 : 1;
    else if (shape === 'Noise') v = noise1(t);
    else v = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);   // Smooth
    gen.out = v;
    return v;
  },

  damper(self, gen, dt, _now, inputs) {
    const target = resolve(self, param(gen.def, 'input_value', 0), inputs);
    const hardness = clamp(resolve(self, param(gen.def, 'hardness', 0.1), inputs), 0, 1);
    const damping = clamp(resolve(self, param(gen.def, 'damping', 0.8), inputs), 0, 1);
    let k = (1 - damping) * (0.05 + 0.95 * hardness);
    if (k <= 0) { gen.out = gen.out === undefined ? target : gen.out; return gen.out; }
    k = 1 - Math.pow(1 - k, dt * 60);
    const from = gen.out === undefined ? target : gen.out;
    gen.out = from + (target - from) * k;
    return gen.out;
  },

  adsr(self, gen, dt, _now, inputs) {
    const target = resolve(self, param(gen.def, 'input_value', 0), inputs);
    const attack = clamp(resolve(self, param(gen.def, 'attack', 0), inputs), 0, 1);
    const release = clamp(resolve(self, param(gen.def, 'release', 0), inputs), 0, 1);
    const decay = Math.max(0, resolve(self, param(gen.def, 'decay', 0), inputs));
    let out = gen.out === undefined ? 0 : gen.out;

    const maxInc = attack <= 0 ? Infinity : dt / (0.1 + 9.9 * attack);
    const maxDec = release <= 0 ? Infinity : dt / (0.1 + 9.9 * release);

    if (target > out) {
      out = Math.min(target, out + maxInc);
      gen.decayAcc = 0;
    } else if (target < out) {
      gen.decayAcc = (gen.decayAcc || 0) + dt;
      if (gen.decayAcc >= decay) out = Math.max(target, out - maxDec);
    } else {
      gen.decayAcc = 0;
    }
    gen.out = out;
    return out;
  },

  linear_filter(self, gen, dt, now, inputs) { return filterStep(self, gen, now, inputs, false); },
  ease_filter(self, gen, dt, now, inputs) { return filterStep(self, gen, now, inputs, true); },

  multiplier(self, gen, _dt, _now, inputs) {
    let v = 1;
    for (let i = 1; i <= 4; i += 1) v *= resolve(self, param(gen.def, 'value' + i, 1), inputs);
    gen.out = v;
    return v;
  },

  incrementer(self, gen, _dt, _now, inputs) {
    const inc = resolveBool(param(gen.def, 'increment', false), inputs);
    const dec = resolveBool(param(gen.def, 'decrement', false), inputs);
    if (inc && !gen.prevInc) gen.out = (gen.out || 0) + 1;
    if (dec && !gen.prevDec) gen.out = (gen.out || 0) - 1;
    gen.prevInc = inc;
    gen.prevDec = dec;
    return gen.out;
  },

  pass_thru(self, gen, _dt, _now, inputs) {
    gen.out = resolve(self, param(gen.def, 'input_value', 0), inputs);
    return gen.out;
  },
};

/** shared interpolation used by linear_filter / ease_filter */
function filterStep(self, gen, now, inputs, ease) {
  const target = resolve(self, param(gen.def, 'input_value', 0), inputs);
  const duration = Math.max(0, resolve(self, param(gen.def, 'duration', 0.5), inputs));

  if (gen.target === undefined || target !== gen.target) {
    gen.start = gen.out === undefined ? target : gen.out;
    gen.t0 = now;
    gen.target = target;
  }
  if (duration <= 0) { gen.out = target; return gen.out; }
  let p = clamp((now - (gen.t0 === undefined ? now : gen.t0)) / duration, 0, 1);
  if (ease) {
    const curve = Math.max(1, resolve(self, param(gen.def, 'curve', 2), inputs));
    const etype = param(gen.def, 'type', 'EaseInOut');
    if (etype === 'EaseIn') p = Math.pow(p, curve);
    else if (etype === 'EaseOut') p = 1 - Math.pow(1 - p, curve);
    else if (p < 0.5) p = 0.5 * Math.pow(2 * p, curve);
    else p = 1 - 0.5 * Math.pow(2 * (1 - p), curve);
  }
  gen.out = gen.start + (target - gen.start) * p;
  return gen.out;
}

/**
 * @param {Array<{name,type,params}>} defs normalised GENERATORS
 * @param {{bpm?:number}} [opts]
 */
export function createGenerators(defs, opts) {
  const options = opts || {};
  const self = {
    defs: defs || [],
    gens: [],
    outputs: {},
    bpm: options.bpm || 0,
    time: 0,
    frame: 0,
  };
  for (const def of self.defs) self.gens.push({ def, out: 0, state: {} });

  self.setBpm = (bpm) => { self.bpm = Number(bpm) || 0; };

  /** dt: seconds since the last tick; now: accumulated engine time. */
  self.advance = (dt, now, inputs) => {
    const step = dt || 0;
    self.time = now === undefined || now === null ? self.time + step : now;
    self.frame += 1;
    for (const gen of self.gens) {
      const handler = handlers[gen.def.type];
      if (!handler) continue;
      try {
        self.outputs[gen.def.name] = handler(self, gen, step, self.time, inputs || {});
      } catch (e) {
        self.outputs[gen.def.name] = gen.out || 0;
      }
    }
    return self.outputs;
  };

  self.get = (name) => self.outputs[name];
  return self;
}
