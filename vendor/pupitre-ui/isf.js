/* SPDX-FileCopyrightText: 2026 gllm
 * SPDX-License-Identifier: MIT
 *
 * ISF (Interactive Shader Format) → PUI adapter.
 *
 * ISF materials declare their controls in the header (`INPUTS`): float,
 * bool, long, event, color, point2D, floatRange, image, audio, audioFFT and
 * the MadMapper controller types. This adapter turns the *normalised* input
 * list of any ISF host into a PUI v1 document and implements the PUI host
 * seam over a small host object. The host keeps the values, the GL/WebGL
 * runtime and media access; PUI owns the controls.
 *
 * Normalised input shape (see spec/ISF.md):
 *   {name, label, type, min, max, default, step?, boundedMin?, boundedMax?,
 *    values?, labels?, defaultValue?, defaultIndex?}
 *
 *   var built = PupitreISF.createDocument(inputs, {valueOf: fn});
 *   var ui = PupitreUI.create({mount, ...built.adapter});
 *   ui.render(built.document);
 *
 * No DOM, no framework, no dependency.
 */
(function (root) {
  "use strict";

  var PREFIX = "/isf";

  function isArray(value) { return Array.isArray(value); }
  function isObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
  function slug(value) { return String(value || "").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "input"; }
  function num(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }
  function clamp(value, lower, upper) {
    return Math.min(upper, Math.max(lower, Number(value)));
  }
  function hex2(number) { return Math.max(0, Math.min(255, Math.round(Number(number) * 255))).toString(16).padStart(2, "0"); }

  /** [r,g,b,a] (0…1) → "#RRGGBBAA" (the PUI colour wire value). */
  function rgbaToHex(value) {
    var color = isArray(value) ? value : [0, 0, 0, 1];
    return "#" + hex2(color[0]) + hex2(color[1]) + hex2(color[2]) + hex2(color.length > 3 ? color[3] : 1);
  }

  /** "#RGB" / "#RRGGBB" / "#RRGGBBAA" → [r,g,b,a] (0…1). */
  function hexToRgba(value) {
    var hex = String(value || "").replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map(function (c) { return c + c; }).join("");
    if (hex.length === 6) hex += "ff";
    if (hex.length !== 8 || /[^0-9a-fA-F]/.test(hex)) return [0, 0, 0, 1];
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
      parseInt(hex.slice(6, 8), 16) / 255
    ];
  }

  function controllerTypes() {
    return /^(animator|shaper|incrementer|damper|pass_thru|linear_filter|adsr)$/;
  }

  /** True when a `long` VALUES list is numeric (the shader uniform is the
   * value) instead of a label list (the shader uniform is the zero-based
   * index). Mirrors the ISF clamp semantics. */
  function numericValues(input) {
    if (!isArray(input.values) || !input.values.length) return false;
    for (var i = 0; i < input.values.length; i++) {
      if (!isFinite(Number(input.values[i]))) return false;
    }
    return true;
  }

  function defaultValue(input) {
    if (input.type === "bool" || input.type === "event") return !!input.default;
    if (input.type === "color") return isArray(input.default) ? input.default.slice() : [0, 0, 0, 1];
    if (input.type === "point2D" || input.type === "floatRange") {
      return isArray(input.default) ? input.default.slice() : [0, 0];
    }
    if (input.type === "image" || input.type === "audio" || input.type === "audioFFT") return undefined;
    return input.default;
  }

  function rangeBounds(input, current) {
    var lo = num(input.min, 0);
    var hi = num(input.max, 1);
    var value = num(current, num(input.default, lo));
    // Materials without MIN/MAX still need a usable slider: widen the
    // 0…1 control range so it covers the material's current/default value.
    if (input.boundedMin !== true) lo = Math.min(lo, value);
    if (input.boundedMax !== true) hi = Math.max(hi, value);
    if (hi <= lo) hi = lo + 1;
    return {min: lo, max: hi};
  }

  function rangeStep(lo, hi, declared) {
    if (isFinite(Number(declared)) && Number(declared) > 0) return Number(declared);
    return Math.max((hi - lo) / 1000, 1e-6);
  }

  function scalarBlock(input, bind, label, value) {
    var bounds = rangeBounds(input, num(value, num(input.default, 0)));
    return {
      kind: "field",
      id: "isf-" + slug(input.name),
      bind: bind,
      label: label,
      type: "f",
      widget: "range",
      min: bounds.min,
      max: bounds.max,
      step: rangeStep(bounds.min, bounds.max, input.step),
      default: num(input.default, bounds.min)
    };
  }

  /** Two scalar fields for a pair input: per-axis ranges, labels and resets
   * are exact (PUI's `vector` widget only supports a shared range). */
  function pairBlocks(input, labels, value) {
    var out = [];
    var current = isArray(value) ? value : defaultValue(input);
    var axes = input.type === "floatRange" ? ["min", "max"] : ["x", "y"];
    var mins = isArray(input.min) ? input.min : [num(input.min, 0), num(input.min, 0)];
    var maxes = isArray(input.max) ? input.max : [num(input.max, 1), num(input.max, 1)];
    var defaults = defaultValue(input);
    for (var i = 0; i < 2; i++) {
      var lo = num(mins[i], 0);
      var hi = num(maxes[i], 1);
      if (hi <= lo) hi = lo + 1;
      out.push({
        kind: "field",
        id: "isf-" + slug(input.name) + "-" + axes[i],
        bind: PREFIX + "/" + input.name + "/" + axes[i],
        label: String(labels[i] || axes[i]),
        type: "f",
        widget: "range",
        min: lo,
        max: hi,
        step: rangeStep(lo, hi, input.step),
        default: isArray(defaults) ? num(defaults[i], lo) : lo
      });
      current[i] = num(current[i], num(defaults[i], lo));
    }
    return out;
  }

  /**
   * Build blocks + the path resolver for one normalised ISF input.
   * `value` is the host's current value (falls back to the header default).
   */
  function inputBlocks(input, value, options) {
    var blocks = [];
    var color = options.color !== false;
    var type = String(input.type || "float");
    var label = String(input.label || input.name);
    if (type === "float" || type === "double" || controllerTypes().test(type)) {
      blocks.push(scalarBlock(input, PREFIX + "/" + input.name, label, value));
    } else if (type === "bool" || type === "boolean") {
      blocks.push({
        kind: "field",
        id: "isf-" + slug(input.name),
        bind: PREFIX + "/" + input.name,
        label: label,
        type: "T",
        widget: "switch",
        default: !!input.default
      });
    } else if (type === "event") {
      blocks.push({
        kind: "field",
        id: "isf-" + slug(input.name),
        bind: PREFIX + "/" + input.name,
        label: label,
        type: "N",
        widget: "button",
        help: String(input.label || input.name) + " — one-shot event"
      });
    } else if (type === "long" || type === "int" || type === "integer") {
      if (isArray(input.values) && input.values.length) {
        var numeric = numericValues(input);
        var labels = isArray(input.labels) && input.labels.length ? input.labels : input.values.map(String);
        blocks.push({
          kind: "field",
          id: "isf-" + slug(input.name),
          bind: PREFIX + "/" + input.name,
          label: label,
          type: "i",
          widget: "select",
          options: input.values.map(function (entry, index) {
            return {value: numeric ? Number(entry) : index, label: String(labels[index] !== undefined ? labels[index] : entry)};
          }),
          // Numeric VALUES write the value; label VALUES write the index.
          default: numeric ? num(input.default, num(input.values[0], 0)) : Math.max(0, Number(input.defaultIndex) || 0)
        });
      } else {
        var integer = {
          kind: "field",
          id: "isf-" + slug(input.name),
          bind: PREFIX + "/" + input.name,
          label: label,
          type: "i",
          widget: "number",
          step: 1,
          default: Math.round(num(input.defaultValue !== undefined ? input.defaultValue : input.default, 0))
        };
        if (input.min !== null && input.min !== undefined) integer.min = Number(input.min);
        if (input.max !== null && input.max !== undefined) integer.max = Number(input.max);
        blocks.push(integer);
      }
    } else if (type === "color" && color) {
      blocks.push({
        kind: "field",
        id: "isf-" + slug(input.name),
        bind: PREFIX + "/" + input.name,
        label: label,
        type: "r",
        widget: "color",
        default: rgbaToHex(defaultValue(input))
      });
    } else if (type === "point2D") {
      blocks = blocks.concat(pairBlocks(input, [label + " X", label + " Y"], value));
    } else if (type === "floatRange") {
      blocks = blocks.concat(pairBlocks(input, [label + " min", label + " max"], value));
    } else if (type === "image" || type === "audio" || type === "audioFFT") {
      // Media is host-owned: the adapter emits actions/readouts below.
    } else {
      // Unknown ISF extension type: keep it visible and read-only rather than
      // silently dropping the control.
      blocks.push({
        kind: "field",
        id: "isf-" + slug(input.name),
        bind: PREFIX + "/" + input.name,
        label: label,
        type: "s",
        widget: "readout",
        help: "Unsupported ISF input type: " + type
      });
    }
    return blocks;
  }

  /** Media controls for image/audio inputs, appended after the fields. */
  function mediaBlocks(inputs, media) {
    var actions = [];
    var readouts = [];
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      var label = String(input.label || input.name);
      if (input.type === "image" && media.image !== false) {
        actions.push({
          id: "isf-choose-" + slug(input.name),
          label: "Choose image…",
          help: "Load a local image for " + label,
          call: "isf.choose_image",
          args: {name: input.name}
        });
      } else if ((input.type === "audio" || input.type === "audioFFT") && media.audio !== false) {
        readouts.push({
          kind: "readout",
          id: "isf-source-" + slug(input.name),
          bind: PREFIX + "/" + input.name + "/source",
          label: label,
          type: "s",
          help: "Synthetic " + (input.type === "audio" ? "waveform" : "spectrum") + " or microphone"
        });
        actions.push({
          id: "isf-mic-" + slug(input.name),
          label: "Use mic",
          help: "Capture audio from the microphone for all audio inputs",
          call: "isf.toggle_microphone",
          args: {name: input.name}
        });
      }
    }
    return {readouts: readouts, actions: actions};
  }

  /**
   * @param {Array<Object>} inputs normalised ISF inputs
   * @param {Object} [options]
   * @param {(input: Object) => any} [options.valueOf] current host value
   * @param {boolean} [options.audioActive] microphone enabled
   * @param {boolean|Object} [options.media] false or {image:false, audio:false}
   * @param {string} [options.title] panel title
   * @param {string} [options.sectionTitle]
   * @param {number} [options.rev]
   * @param {string} [options.host]
   * @param {string} [options.lang]
   * @param {string} [options.dir]
   * @param {Object} [options.theme]
   * @returns {{document: Object, bindings: Object, fields: Object}}
   */
  function createDocument(inputs, options) {
    options = options || {};
    var valueOf = (Object.prototype.hasOwnProperty.call(options, "valueOf") && typeof options.valueOf === "function")
      ? options.valueOf
      : function () { return undefined; };
    var audioActive = !!options.audioActive;
    var media = options.media === false ? {image: false, audio: false} : (isObject(options.media) ? options.media : {});
    var list = isArray(inputs) ? inputs : [];
    var blocks = [];
    var bindings = {};

    function register(block, input, component, kind) {
      bindings[block.bind] = {block: block, input: input, component: component, kind: kind};
      return block;
    }

    for (var i = 0; i < list.length; i++) {
      var input = list[i];
      if (!input || !input.name) continue;
      var current = valueOf(input);
      if (current === undefined) current = defaultValue(input);
      var built = inputBlocks(input, current, options);
      for (var b = 0; b < built.length; b++) {
        var block = built[b];
        var component = null;
        if (block.bind.indexOf(PREFIX + "/" + input.name + "/") === 0) {
          var axis = block.bind.slice((PREFIX + "/" + input.name + "/").length);
          component = axis === "x" || axis === "min" ? 0 : axis === "y" || axis === "max" ? 1 : null;
        }
        register(block, input, component, input.type);
        blocks.push(block);
      }
    }

    var extras = mediaBlocks(list, media);
    // Readouts have no bind to a scalar value but still resolve through the
    // adapter (e.g. the audio source line).
    for (var r = 0; r < extras.readouts.length; r++) {
      var readout = extras.readouts[r];
      var audioInput = null;
      for (var a = 0; a < list.length; a++) {
        if (PREFIX + "/" + list[a].name + "/source" === readout.bind) audioInput = list[a];
      }
      register(readout, audioInput, null, audioInput ? audioInput.type : "readout");
      blocks.push(readout);
    }

    var actionItems = extras.actions.map(function (item) {
      if (item.call === "isf.toggle_microphone" && audioActive) {
        return Object.assign({}, item, {label: "Microphone on", help: "Switch audio inputs back to the synthetic source"});
      }
      if (item.call === "isf.choose_image") {
        var imageInput = null;
        for (var m = 0; m < list.length; m++) if (list[m].name === item.args.name) imageInput = list[m];
        if (imageInput && typeof options.imageName === "function") {
          var name = options.imageName(imageInput);
          if (name) return Object.assign({}, item, {label: "Choose image…", help: "Current: " + name});
        }
      }
      return item;
    });
    if (actionItems.length) blocks.push({kind: "actions", id: "isf-media-actions", items: actionItems});

    var document = {
      format: "pupitre-ui",
      version: 1,
      rev: Number(options.rev) || 1,
      host: String(options.host || "isf"),
      lang: String(options.lang || "en"),
      dir: String(options.dir || "ltr"),
      panels: [{
        id: "isf",
        title: String(options.title || options.sectionTitle || "Inputs"),
        embedded: true,
        pages: [{
          id: "parameters",
          title: String(options.pageTitle || "Parameters"),
          layout: {columns: 1},
          sections: [{
            id: "inputs",
            title: String(options.sectionTitle || "Inputs"),
            blocks: blocks
          }]
        }]
      }]
    };
    if (options.theme && (options.theme.mode || options.theme.tokens)) document.theme = options.theme;
    return {document: document, bindings: bindings, inputs: list.slice()};
  }

  /**
   * @param {Object} options
   * @param {Array<Object>} options.inputs normalised ISF inputs
   * @param {Object} options.host
   * @param {(name: string) => any} options.host.getValue current value
   * @param {(name: string, value: any) => any} options.host.setValue write, returns applied value
   * @param {(name: string) => void} [options.host.triggerEvent]
   * @param {(name: string) => void} [options.host.chooseImage]
   * @param {() => void} [options.host.toggleMicrophone]
   * @param {() => boolean} [options.host.audioActive]
   * @param {(input: Object) => string} [options.host.imageName]
   * @param {number} [options.rev]
   * @returns {Object} PUI host adapter plus `document()`, `bindings()`
   */
  function createAdapter(options) {
    options = options || {};
    var inputs = isArray(options.inputs) ? options.inputs : [];
    var host = options.host || {};
    var current = null;

    function build() {
      current = createDocument(inputs, Object.assign({}, options, {
        valueOf: function (input) {
          if (typeof host.getValue !== "function") return undefined;
          var value = host.getValue(input.name);
          return value === undefined ? undefined : value;
        },
        audioActive: typeof host.audioActive === "function" ? !!host.audioActive() : false,
        imageName: typeof host.imageName === "function" ? host.imageName : undefined
      }));
      return current;
    }

    function binding(path) {
      if (!current) build();
      return current.bindings[String(path)] || null;
    }

    var adapter = {
      document: function () { return build().document; },
      getDocument: function () { return build().document; },
      bindings: function () { return (current || build()).bindings; },
      inputs: function () { return inputs.slice(); },

      getValue: function (path) {
        var info = binding(path);
        if (!info) return undefined;
        var name = info.input.name;
        if (info.kind === "audio" || info.kind === "audioFFT") {
          return typeof host.audioActive === "function" && host.audioActive() ? "microphone" : "synthetic";
        }
        if (typeof host.getValue !== "function") return undefined;
        var raw = host.getValue(name);
        if (info.kind === "color") return rgbaToHex(raw);
        if (info.component !== null && info.component !== undefined) {
          var pair = isArray(raw) ? raw : defaultValue(info.input);
          return num(pair[info.component], 0);
        }
        return raw;
      },

      setValue: function (path, value) {
        var info = binding(path);
        if (!info) return false;
        var input = info.input;
        var name = input.name;
        if (info.kind === "event" || info.block.widget === "button") {
          if (typeof host.triggerEvent === "function") host.triggerEvent(name);
          return true;
        }
        if (info.kind === "color") {
          var color = hexToRgba(value);
          if (typeof host.setValue === "function") host.setValue(name, color);
          return true;
        }
        if (info.component !== null && info.component !== undefined) {
          var source = typeof host.getValue === "function" ? host.getValue(name) : undefined;
          var pair = isArray(source) ? source.slice() : defaultValue(input).slice();
          pair[info.component] = Number(value);
          if (typeof host.setValue === "function") host.setValue(name, pair);
          return true;
        }
        if (typeof host.setValue === "function") host.setValue(name, value);
        return true;
      },

      getPathMeta: function (path) {
        var info = binding(path);
        if (!info) return {};
        var block = info.block;
        return {
          type: block.type,
          min: block.min,
          max: block.max,
          step: block.step,
          options: block.options,
          label: block.label
        };
      },

      callAction: function (name, args) {
        args = args || {};
        if (name === "isf.choose_image") {
          if (typeof host.chooseImage === "function") host.chooseImage(args.name);
          return !!host.chooseImage;
        }
        if (name === "isf.toggle_microphone") {
          if (typeof host.toggleMicrophone === "function") host.toggleMicrophone();
          return !!host.toggleMicrophone;
        }
        return false;
      },

      // Rebuild the document after the input list or media state changed.
      refresh: function (nextInputs) {
        if (isArray(nextInputs)) inputs = nextInputs;
        build();
        return current.document;
      }
    };
    return adapter;
  }

  root.PupitreISF = {
    PREFIX: PREFIX,
    createDocument: createDocument,
    createAdapter: createAdapter,
    rgbaToHex: rgbaToHex,
    hexToRgba: hexToRgba,
    numericValues: numericValues
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.PupitreISF;
  }
})(typeof window !== "undefined" ? window : globalThis);
