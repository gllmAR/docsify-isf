/* SPDX-FileCopyrightText: 2026 gllm
 * SPDX-License-Identifier: MIT
 *
 * Pupitre UI — a build-free renderer for PUI v1 documents.
 * Classic script: include with <script src="pupitre-ui.js"></script>.
 * No bundler, no framework, works from file://.
 */
(function (global) {
  "use strict";

  var NEXT_ID = 0;

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function equal(a, b) {
    if (typeof a === "number" || typeof b === "number") {
      return Number(a) === Number(b);
    }
    if (isArray(a) && isArray(b)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
      return true;
    }
    if (isObject(a) && isObject(b)) {
      var ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (var j = 0; j < ka.length; j++) if (!equal(a[ka[j]], b[ka[j]])) return false;
      return true;
    }
    return String(a) === String(b);
  }

  function getByPath(source, path) {
    if (!source || !path) return undefined;
    var parts = String(path).split(".");
    var value = source;
    for (var i = 0; i < parts.length; i++) {
      if (value == null || typeof value !== "object") return undefined;
      value = value[parts[i]];
    }
    return value;
  }

  function setByPath(target, path, value) {
    if (!target || !path) return;
    var parts = String(path).split(".");
    var node = target;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!isObject(node[parts[i]])) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "text") node.textContent = String(value);
        else if (key === "class") node.className = String(value);
        else if (key === "hidden") node.hidden = !!value;
        else if (key === "dataset") Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
        else node.setAttribute(key, String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (isArray(child)) {
        child.forEach(function (c) { if (c !== null && c !== undefined) node.appendChild(c); });
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  function text(value) {
    return document.createTextNode(value === null || value === undefined ? "" : String(value));
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] === null || attrs[key] === undefined) return;
        node.setAttribute(key, String(attrs[key]));
      });
    }
    return node;
  }

  function caption(field, labelId) {
    var label = String(field.label || field.bind || "Parameter");
    var unit = field.unit ? String(field.unit) : "";
    if (unit && label.indexOf("(" + unit + ")") < 0) label += " (" + unit + ")";
    var node = el("label", {class: "pui-caption", id: labelId + "-label", for: labelId, text: label});
    if (field.help) node.title = label + "\n" + String(field.help);
    return node;
  }

  function valueText(value, field) {
    if (value === null || value === undefined) return "—";
    var type = String(field.type || "");
    if (type === "T" || type === "F") return value ? "on" : "off";
    if (type === "r" && typeof value === "string") return value;
    if (type === "r" && isArray(value)) {
      return "#" + value.slice(0, 4).map(function (x) {
        return Math.round(Number(x) * 255).toString(16).padStart(2, "0");
      }).join("").toUpperCase();
    }
    if (isArray(value)) return "(" + value.join(", ") + ")";
    if (isObject(value)) return JSON.stringify(value);
    if (typeof value === "number" && field.precision !== undefined) {
      var precision = Number(field.precision);
      if (isFinite(precision) && precision >= 0) return value.toFixed(precision);
    }
    if (typeof value === "number" && !Number.isInteger(value)) return String(Number(value.toFixed(3)));
    return String(value);
  }

  function isMixedValue(value) {
    return isObject(value) && (value.mixed === true || value.__pui_mixed === true);
  }

  function defaultValueOf(field) {
    if (isObject(field.reset) && Object.prototype.hasOwnProperty.call(field.reset, "value")) return field.reset.value;
    if (Object.prototype.hasOwnProperty.call(field, "default")) return field.default;
    return undefined;
  }

  function numericPrecision(field) {
    var precision = Number(field.precision);
    return isFinite(precision) && precision >= 0 ? precision : null;
  }

  function formatNumeric(value, field) {
    var number = Number(value);
    if (!isFinite(number)) return "—";
    var precision = numericPrecision(field);
    return precision === null ? String(number) : number.toFixed(precision);
  }

  function quantizeNumeric(value, field) {
    var precision = numericPrecision(field);
    var number = Number(value);
    if (precision === null || !isFinite(number)) return number;
    return Number(number.toFixed(precision));
  }

  /** Paint the filled part of a native range without replacing native
   * dragging, keyboard and AT semantics. Horizontal and vertical sliders use
   * exactly the same track/thumb/fill language. */
  function paintRangeFill(input) {
    if (!input || String(input.type || "").toLowerCase() !== "range") return;
    var min = Number(input.min), max = Number(input.max), value = Number(input.value);
    if (!isFinite(min)) min = 0;
    if (!isFinite(max) || max <= min) max = min + 1;
    if (!isFinite(value)) value = min;
    var ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    input.style.setProperty("--pui-range-fill", (ratio * 100).toFixed(2) + "%");
  }

  function componentCount(field) {
    var type = String(field.type || "");
    if (type === "ii" || type === "ff") return 2;
    if (type === "iii" || type === "fff") return 3;
    if (type === "ffff") return 4;
    return 1;
  }

  function components(value, count) {
    var out = isArray(value) ? value.slice() : [];
    while (out.length < count) out.push(0);
    return out.slice(0, count);
  }

  function normalizeOptions(entries) {
    return (entries || []).map(function (entry) {
      return isObject(entry) ? entry : {value: entry, label: String(entry)};
    });
  }

  function optionList(field) {
    return normalizeOptions(field.options);
  }

  function implicitRole(control) {
    if (control.getAttribute("role")) return control.getAttribute("role");
    var tag = control.tagName.toLowerCase();
    var type = (control.getAttribute("type") || "").toLowerCase();
    if (tag === "input") {
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "color") return "button";
      return "textbox";
    }
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "button") return "button";
    if (tag === "output") return "status";
    return "group";
  }

  function Renderer(options) {
    options = options || {};
    var self = this;
    this.mount = options.mount;
    this.blockFactories = Object.assign({}, options.blocks || {});
    this.icons = Object.assign({}, options.icons || {});
    this.debug = options.debug === true;
    this.debugOverlay = null;
    this.debugBody = null;
    this.renderMs = null;
    this.lastAnnounce = null;
    this.lastError = null;
    this._debugKeyHandler = null;
    this.adapter = {
      getValue: options.getValue || function () { return undefined; },
      setValue: options.setValue || function () { return false; },
      setValues: options.setValues || null,
      graphAction: options.graphAction || null,
      graphOnParentAction: options.graphOnParentAction || null,
      timelineAction: options.timelineAction || null,
      stageAction: options.stageAction || null,
      treeAction: options.treeAction || null,
      pageAction: options.pageAction || null,
      moveTreeNode: options.moveTreeNode || null,
      selectionAction: options.selectionAction || null,
      projectAction: options.projectAction || null,
      canvasAction: options.canvasAction || null,
      codeAction: options.codeAction || null,
      curveAction: options.curveAction || null,
      drawerAction: options.drawerAction || null,
      workflowAction: options.workflowAction || null,
      graphNodeBody: options.graphNodeBody || null,
      getValueFor: options.getValueFor || null,
      setValueFor: options.setValueFor || null,
      getIcon: options.getIcon || null,
      callAction: options.callAction || function () { return false; },
      callCustom: options.callCustom || null,
      action: options.action || null,
      getPathMeta: options.getPathMeta || function () { return {}; },
      getFieldStatus: options.getFieldStatus || function () { return null; },
      getCollection: options.getCollection || null,
      getCollectionValue: options.getCollectionValue || null,
      setCollectionItem: options.setCollectionItem || null,
      addCollectionItem: options.addCollectionItem || null,
      removeCollectionItem: options.removeCollectionItem || null,
      renameCollectionItem: options.renameCollectionItem || null,
      moveCollectionItem: options.moveCollectionItem || null,
      resolveCollectionPath: options.resolveCollectionPath || null,
      validateValue: options.validateValue || null,
      getPreferences: options.getPreferences || null,
      setPreferences: options.setPreferences || null,
      undo: options.undo || null,
      redo: options.redo || null,
      canUndo: options.canUndo || null,
      canRedo: options.canRedo || null,
      undoLabel: options.undoLabel || null,
      redoLabel: options.redoLabel || null,
      historyAction: options.historyAction || null,
      connectionAction: options.connectionAction || null,
      previewAction: options.previewAction || null,
      subscribePreview: options.subscribePreview || null,
      schemaFormAction: options.schemaFormAction || null,
      transportAction: options.transportAction || null,
      meterAction: options.meterAction || null,
      subscribeMeters: options.subscribeMeters || null,
      keyCaptureAction: options.keyCaptureAction || null,
      bindingAction: options.bindingAction || null,
      subscribeBindings: options.subscribeBindings || null,
      workspaceAction: options.workspaceAction || null,
      mediaTimelineAction: options.mediaTimelineAction || null,
      subscribeMediaTimeline: options.subscribeMediaTimeline || null,
      favoriteAction: options.favoriteAction || null,
      subscribeFavorites: options.subscribeFavorites || null,
      filePick: options.filePick || null,
      dialogAction: options.dialogAction || null,
      historyCheckpoint: options.historyCheckpoint || null,
      graphInspector: options.graphInspector || null,
      subscribe: options.subscribe || function () { return function () {}; },
      translate: options.translate || function (_key, fallback) { return fallback; },
      announce: function (level, text) {
        var message = {level: String(level || "info"), text: String(text === undefined ? "" : text), at: Date.now()};
        self.lastAnnounce = message;
        if (message.level === "error") self.lastError = message;
        (options.announce || function () {})(message.level, message.text);
        if (self.debug) self.debugRefresh();
      },
      touchTarget: options.touchTarget || 32
    };
    this.uid = "pui" + (++NEXT_ID);
    this.records = [];
    this.actions = [];
    this.pageRecords = [];
    this.panelRecords = [];
    this.sectionRecords = [];
    this.collectionRecords = [];
    this.tableRecords = [];
    this.formRecords = [];
    this.presetRecords = [];
    this.shellRecords = [];
    this.statusRecords = [];
    this.toolbarRecords = [];
    this.toolbarLayouts = [];
    this.menuRecords = [];
    this.toastRecords = [];
    this.graphRecords = [];
    this.historyRecords = [];
    this.connectionRecords = [];
    this.previewRecords = [];
    this.transportRecords = [];
    this.meterRecords = [];
    this.keyCaptureRecords = [];
    this.bindingRecords = [];
    this.workspaceRecords = [];
    this.mediaTimelineRecords = [];
    this.favoriteRecords = [];
    this.dialogRecords = [];
    this.schemaFormRecords = [];
    this.workbenches = [];
    this.commandLogRecords = [];
    this.selectionRecords = [];
    this.disclosureRecords = [];
    this.projectRecords = [];
    this.canvasRecords = [];
    this.drawerRecords = [];
    this.codeRecords = [];
    this.slots = {};
    // compatibility with the 1.7 `create({slots})` form: registerSlot() is the
    // preferred API, but an old host must not silently lose every custom slot
    if (isObject(options.slots)) {
      var initialSlots = options.slots;
      Object.keys(initialSlots).forEach(function (name) { this.slots[String(name)] = initialSlots[name]; }, this);
    }
    this.slotInstances = [];
    this.customRecords = [];
    this.doc = null;
    this.root = null;
    this.uidCounter = 0;
    this.density = options.density || "comfortable";
    this.langOption = options.lang || options.locale || "";
    this.lang = "en";
    this.dir = "ltr";
    this.searchEnabled = !!options.search;
    this.paletteEnabled = !!options.palette;
    this.searchQuery = "";
    this.searchInput = null;
    this._palette = null;
    this._paletteKeyHandler = null;
    this.shortcuts = [];
    this._shortcutHandler = null;
    this._themeTokens = [];
    this._pageRecordIndex = -1;
    this._sectionRecordIndex = -1;
    this._collectionRecordIndex = -1;
    this._routeHistory = [];
    this.currentRoute = null;
    this.preferences = {favorites: [], recent: []};
    this._historyKeyHandler = null;
  }

  Renderer.prototype.render = function (doc) {
    var renderStarted = Date.now();
    doc = expandTemplates(doc);
    // Structural re-renders replace every control. Remember the focused item
    // by its public hook so keyboard context survives a host refresh.
    var focusSnapshot = null;
    var focusInside = function (parent, node) {
      for (var walk = node; walk; walk = walk.parentNode) if (walk === parent) return true;
      return false;
    };
    if (typeof document !== "undefined" && this.mount && document.activeElement && focusInside(this.mount, document.activeElement)) {
      var focused = document.activeElement;
      var openMenu = focused.closest ? focused.closest(".pui-menu-popup") : null;
      if (openMenu) {
        var menuRoot = openMenu.closest ? openMenu.closest(".pui-menu") : null;
        var menuTrigger = menuRoot ? menuRoot.querySelector(".pui-menu-trigger") : null;
        if (menuTrigger) focused = menuTrigger;
      }
      var focusItem = focused.closest ? focused.closest("[data-pui-item]") : null;
      var focusField = focused.closest ? focused.closest("[data-pui-path]") : null;
      if (focusItem && focusItem.getAttribute("data-pui-item")) {
        focusSnapshot = {attr: "data-pui-item", value: focusItem.getAttribute("data-pui-item")};
      } else if (focusField && focusField.getAttribute("data-pui-path")) {
        focusSnapshot = {attr: "data-pui-path", value: focusField.getAttribute("data-pui-path")};
      } else if (focused.id) {
        focusSnapshot = {attr: "id", value: focused.id};
      }
    }
    this.unbindPaletteShortcut();
    if (this._palette) this._palette.close();
    for (var mr = 0; mr < this.menuRecords.length; mr++) {
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("mousedown", this.menuRecords[mr].outside, true);
      }
    }
    this.menuRecords = [];
    this.destroySlots();
    this.disconnectPreviews();
    this.disconnectMeters();
    this.disconnectToolbarLayouts();
    this.disconnectGraphBodies();
    this.doc = doc;
    this.loadPreferences();
    this.lang = this.resolveLanguage(doc);
    this.dir = String(doc.dir || (global.PupitreI18n ? global.PupitreI18n.direction(this.lang) : "ltr"));
    this.signature = structureKey(doc);
    this.records = [];
    this.actions = [];
    this.pageRecords = [];
    this.panelRecords = [];
    this.sectionRecords = [];
    this.collectionRecords = [];
    this.tableRecords = [];
    this.formRecords = [];
    this.presetRecords = [];
    this.shellRecords = [];
    this.statusRecords = [];
    this.toolbarRecords = [];
    this.toolbarLayouts = [];
    this.menuRecords = [];
    this.toastRecords = [];
    this.graphRecords = [];
    this.historyRecords = [];
    this.connectionRecords = [];
    this.previewRecords = [];
    this.transportRecords = [];
    this.meterRecords = [];
    this.keyCaptureRecords = [];
    this.bindingRecords = [];
    this.workspaceRecords = [];
    this.mediaTimelineRecords = [];
    this.favoriteRecords = [];
    this.dialogRecords = [];
    this.schemaFormRecords = [];
    this.workbenches = [];
    this.commandLogRecords = [];
    this.selectionRecords = [];
    this.disclosureRecords = [];
    this.projectRecords = [];
    this.canvasRecords = [];
    this.drawerRecords = [];
    this.codeRecords = [];
    this.customRecords = [];
    this._pageRecordIndex = -1;
    this._sectionRecordIndex = -1;
    this._collectionRecordIndex = -1;
    if (!this.mount) throw new Error("PupitreUI: mount is required");
    while (this.mount.firstChild) this.mount.removeChild(this.mount.firstChild);
    var errors = validate(doc);
    if (errors.length) {
      var warning = el("div", {class: "pui-warning", role: "alert", text: "PUI warning: " + errors.join("; ")});
      this.mount.appendChild(warning);
      return this;
    }
    this.root = el("div", {class: "pui", "data-pui-root": ""});
    this.root.setAttribute("data-density", this.density);
    this.applyDocumentRoot(doc);
    if (this.searchEnabled || this.paletteEnabled) {
      var searchBar = el("div", {class: "pui-search"});
      if (this.searchEnabled) {
        var searchInput = el("input", {type: "search", "aria-label": this.t("search.filter", "Filter parameters"), placeholder: this.t("search.filter", "Filter parameters")});
        searchInput.value = this.searchQuery;
        searchInput.addEventListener("input", function () { this.search(searchInput.value); }.bind(this));
        searchBar.appendChild(searchInput);
        this.searchInput = searchInput;
      }
      if (this.paletteEnabled) {
        var commandsButton = el("button", {type: "button", class: "pui-button", text: this.t("search.commands", "Commands"), "aria-label": this.t("search.open", "Open command palette")});
        commandsButton.addEventListener("click", this.openPalette.bind(this));
        searchBar.appendChild(commandsButton);
      }
      this.root.appendChild(searchBar);
    }
    var panels = doc.panels || [];
    for (var i = 0; i < panels.length; i++) this.root.appendChild(this.buildPanel(panels[i]));
    this.mount.appendChild(this.root);
    this.root.addEventListener("input", function (event) {
      var target = event.target;
      if (target && String(target.type || "").toLowerCase() === "range") paintRangeFill(target);
    });
    this.graphLayoutBodies();
    this.apply();
    this.bindShortcuts();
    this.bindPaletteShortcut();
    this.bindHistoryShortcut();
    this.applyRoute();
    this.renderMs = Date.now() - renderStarted;
    this.bindDebugShortcut();
    if (this.debug) this.showDebug();
    if (focusSnapshot) {
      var candidates = this.mount.querySelectorAll("[" + focusSnapshot.attr + "]");
      var focusTarget = null;
      for (var fc = 0; fc < candidates.length; fc++) {
        if (candidates[fc].getAttribute(focusSnapshot.attr) !== focusSnapshot.value) continue;
        focusTarget = candidates[fc];
        break;
      }
      if (focusTarget && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(focusTarget.tagName) && !focusTarget.hasAttribute("tabindex")) {
        focusTarget = focusTarget.querySelector("button, a[href], input, select, textarea, [tabindex]");
      }
      if (!focusTarget) {
        var toolbarFallback = this.mount.querySelector(".pui-toolbar");
        if (toolbarFallback) focusTarget = toolbarFallback.querySelector("a[href], button, input, select, textarea, [tabindex]");
      }
      if (focusTarget && typeof focusTarget.focus === "function") {
        try { focusTarget.focus({preventScroll: true}); } catch (error) { try { focusTarget.focus(); } catch (error2) { /* ignore */ } }
      }
    }
    if (typeof window !== "undefined" && window.addEventListener && !this._hashHandler) {
      this._hashHandler = function () { this.applyRoute(); }.bind(this);
      window.addEventListener("hashchange", this._hashHandler);
    }
    return this;
  };

  /** Patch a document whose public structure is unchanged. This preserves
   * focused controls and custom slots; it falls back to render() when keys or
   * collection structure change. Value-only updates should use apply(). */
  Renderer.prototype.update = function (doc) {
    doc = expandTemplates(doc);
    var key = structureKey(doc);
    if (!this.root || !this.doc || key !== this.signature || hasCollection(doc)) {
      return this.render(doc);
    }
    this.doc = doc;
    this.lang = this.resolveLanguage(doc);
    this.dir = String(doc.dir || (global.PupitreI18n ? global.PupitreI18n.direction(this.lang) : "ltr"));
    this.applyDocumentRoot(doc);
    var blocks = {};
    collectBlocks(doc, blocks);
    for (var sh = 0; sh < this.shellRecords.length; sh++) {
      var shellRec = this.shellRecords[sh];
      shellRec.visible = this.conditionOk(shellRec.block.visible_when);
      shellRec.enabled = this.conditionOk(shellRec.block.enabled_when) &&
        groupEnabled(this.pageRecords, shellRec.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, shellRec.sectionRecordIndex);
      shellRec.root.hidden = !shellRec.visible;
      if (shellRec.enabled) shellRec.root.removeAttribute("aria-disabled");
      else shellRec.root.setAttribute("aria-disabled", "true");
    }
    for (var mn = 0; mn < this.menuRecords.length; mn++) {
      var menuRec = this.menuRecords[mn];
      menuRec.visible = this.conditionOk(menuRec.block.visible_when);
      menuRec.enabled = this.conditionOk(menuRec.block.enabled_when) &&
        groupEnabled(this.pageRecords, menuRec.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, menuRec.sectionRecordIndex);
      menuRec.root.hidden = !menuRec.visible;
      menuRec.trigger.disabled = !menuRec.enabled;
    }
    for (var pr = 0; pr < this.presetRecords.length; pr++) {
      this.presetRefresh(this.presetRecords[pr]);
    }
    for (var fm = 0; fm < this.formRecords.length; fm++) {
      var formRec = this.formRecords[fm];
      formRec.visible = this.conditionOk(formRec.block.visible_when);
      formRec.enabled = this.conditionOk(formRec.block.enabled_when) &&
        groupEnabled(this.pageRecords, formRec.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, formRec.sectionRecordIndex);
      formRec.root.hidden = !formRec.visible;
      if (formRec.enabled) formRec.root.removeAttribute("aria-disabled");
      else formRec.root.setAttribute("aria-disabled", "true");
    }
    for (var tb = 0; tb < this.tableRecords.length; tb++) {
      var tableRec = this.tableRecords[tb];
      tableRec.visible = this.conditionOk(tableRec.block.visible_when);
      tableRec.enabled = this.conditionOk(tableRec.block.enabled_when) &&
        groupEnabled(this.pageRecords, tableRec.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, tableRec.sectionRecordIndex);
      tableRec.root.hidden = !tableRec.visible;
      if (tableRec.enabled) tableRec.root.removeAttribute("aria-disabled");
      else tableRec.root.setAttribute("aria-disabled", "true");
    }
    for (var cv = 0; cv < this.canvasRecords.length; cv++) {
      var canvasRec = this.canvasRecords[cv];
      var canvasBlock = blocks[canvasRec.path];
      if (canvasBlock) {
        canvasRec.block = canvasBlock;
        canvasRec.options = isObject(canvasBlock.canvas_options) ? canvasBlock.canvas_options : {};
        canvasRec.__valueSignature = null;
        this.canvasRefresh(canvasRec);
      }
    }
    for (var i = 0; i < this.records.length; i++) {
      var rec = this.records[i];
      var next = blocks[rec.path];
      if (!next) continue;
      rec.block = next;
      this.applyFieldMeta(rec, next);
      if (rec.labelTextEl) rec.labelTextEl.textContent = this.labelText(next);
      if (rec.helpEl) {
        if (next.help) rec.helpEl.textContent = String(next.help);
        rec.helpEl.hidden = !next.help;
      }
      this.a11y(rec.control, next, rec.label, rec.inputs);
    }
    var pages = [], sections = [];
    (doc.panels || []).forEach(function (panel) {
      (panel.pages || []).forEach(function (page) {
        pages.push(page);
        (page.sections || []).forEach(function (section) { sections.push(section); });
      });
    });
    for (var pr = 0; pr < this.pageRecords.length; pr++) {
      if (pages[pr]) this.pageRecords[pr].page = pages[pr];
    }
    for (var sr = 0; sr < this.sectionRecords.length; sr++) {
      var sectionRecord = this.sectionRecords[sr];
      if (!sections[sr]) continue;
      sectionRecord.block = sections[sr];
      if (sectionRecord.helpEl) {
        if (sections[sr].help) sectionRecord.helpEl.textContent = String(sections[sr].help);
        sectionRecord.helpEl.hidden = !sections[sr].help;
      }
    }
    var customBlocks = [];
    sections.forEach(function (section) {
      (section.blocks || []).forEach(function (block) { if (block && block.kind === "custom") customBlocks.push(block); });
    });
    for (var cr = 0; cr < this.customRecords.length; cr++) {
      if (customBlocks[cr]) this.customRecords[cr].block = customBlocks[cr];
    }
    for (var j = 0; j < this.actions.length; j++) {
      var action = this.actions[j];
      var block = action.block;
      if (block && block.id) {
        var found = findAction(doc, str(block.id));
        if (found) {
          action.block = found;
          action.control.textContent = String(found.label || found.id || "Action");
          action.control.disabled = !!found.disabled;
        }
      }
    }
    this.signature = key;
    this.syncPageBindings();
    this.apply();
    this.bindShortcuts();
    this.applyRoute();
    return this;
  };

  Renderer.prototype.applyFieldMeta = function (rec, field) {
    if (!rec) return;
    if (rec.widget === "range") {
      var rMin = String(field.min !== undefined ? field.min : 0);
      var rMax = String(field.max !== undefined ? field.max : 1);
      var rStep = String(field.step !== undefined ? field.step : 0.01);
      if (rec.range) { rec.range.min = rMin; rec.range.max = rMax; rec.range.step = rStep; }
      if (rec.number) { rec.number.min = rMin; rec.number.max = rMax; rec.number.step = rStep; }
    } else if (rec.widget === "number") {
      if (rec.control) {
        rec.control.min = String(field.min !== undefined ? field.min : -1e12);
        rec.control.max = String(field.max !== undefined ? field.max : 1e12);
        rec.control.step = String(field.step !== undefined ? field.step : 1);
      }
    }
    var options = this.optionsFor(field);
    if (rec.widget === "select" && rec.control && rec.control.options) {
      for (var i = 0; i < rec.control.options.length && i < options.length; i++) {
        rec.control.options[i].textContent = String(options[i].label !== undefined ? options[i].label : options[i].value);
      }
    }
    if (rec.optionLabels) {
      for (var j = 0; j < rec.optionLabels.length && j < options.length; j++) {
        rec.optionLabels[j].textContent = String(options[j].label !== undefined ? options[j].label : options[j].value);
      }
    }
  };

  Renderer.prototype.resolveLanguage = function (doc) {
    var query = "";
    try { query = String(window.location && window.location.search || "").replace(/^\?/, ""); } catch (error) {}
    var params = {};
    query.split("&").forEach(function (part) {
      var pair = part.split("=");
      if (pair[0]) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    });
    var raw = params.lang || this.langOption || (doc && doc.lang) || (global.navigator && global.navigator.language) || "en";
    return global.PupitreI18n ? global.PupitreI18n.normalize(raw) : String(raw).toLowerCase().split(/[-_]/)[0];
  };

  Renderer.prototype.t = function (key, fallback, params) {
    var translated = this.adapter.translate(String(key), fallback);
    if (translated === undefined || translated === null || translated === fallback || translated === key) {
      translated = global.PupitreI18n ? global.PupitreI18n.translate(this.lang, key, params, fallback) : fallback;
    }
    return translated === undefined || translated === null ? String(fallback !== undefined ? fallback : key) : String(translated);
  };

  Renderer.prototype.applyDocumentRoot = function (doc) {
    if (!this.root) return;
    this.root.setAttribute("lang", String(this.lang || doc.lang || "en"));
    this.root.setAttribute("dir", String(this.dir || doc.dir || "ltr"));
    try {
      if (document.documentElement) {
        document.documentElement.setAttribute("lang", String(this.lang || doc.lang || "en"));
        document.documentElement.setAttribute("dir", String(this.dir || doc.dir || "ltr"));
      }
    } catch (error) {}
    this.root.style.setProperty("--pui-touch", String(this.adapter.touchTarget) + "px");
    (this._themeTokens || []).forEach(function (key) {
      this.root.style.removeProperty("--pui-" + key);
    }, this);
    this._themeTokens = [];
    var embedded = isArray(doc.panels) && doc.panels.length > 0 && doc.panels.every(function (panel) {
      return !!(panel && panel.embedded === true);
    });
    if (embedded) this.root.setAttribute("data-embedded", "true");
    else this.root.removeAttribute("data-embedded");
    var fill = "";
    (doc.panels || []).forEach(function (panel) {
      (panel && panel.pages || []).forEach(function (page) {
        if (page && page.layout && page.layout.fill && !fill) fill = String(page.layout.fill);
      });
    });
    if (fill) this.root.setAttribute("data-pui-fill", fill);
    else this.root.removeAttribute("data-pui-fill");
    var theme = isObject(doc.theme) ? doc.theme : {};
    var htmlTheme = "";
    try { htmlTheme = document.documentElement && document.documentElement.getAttribute("data-theme") || ""; } catch (error) {}
    var mode = theme.mode || this.themeMode || htmlTheme;
    if (mode) this.root.setAttribute("data-theme", String(mode));
    else this.root.removeAttribute("data-theme");
    if (isObject(theme.tokens)) {
      Object.keys(theme.tokens).forEach(function (key) {
        this.root.style.setProperty("--pui-" + key, String(theme.tokens[key]));
        this._themeTokens.push(key);
      }, this);
    }
  };

  Renderer.prototype.setTheme = function (mode) {
    this.themeMode = mode ? String(mode) : "";
    if (this.root) {
      if (this.themeMode) this.root.setAttribute("data-theme", this.themeMode);
      else this.root.removeAttribute("data-theme");
    }
    try {
      if (document.documentElement) {
        if (this.themeMode) document.documentElement.setAttribute("data-theme", this.themeMode);
        else document.documentElement.removeAttribute("data-theme");
      }
    } catch (error) {}
  };

  Renderer.prototype.bindShortcuts = function () {
    this.unbindShortcuts();
    this.shortcuts = [];
    var self = this;
    function add(spec, entry) {
      if (!spec) return;
      entry.spec = String(spec);
      self.shortcuts.push(entry);
      if (entry.control && entry.control.setAttribute) {
        entry.control.setAttribute("aria-keyshortcuts", ariaShortcut(entry.spec));
      }
    }
    for (var i = 0; i < this.actions.length; i++) {
      var action = this.actions[i];
      if (action.block && action.block.shortcut) add(action.block.shortcut, {item: action.block, control: action.control, action: true});
    }
    for (var j = 0; j < this.records.length; j++) {
      var rec = this.records[j];
      if (rec.block && rec.block.shortcut && rec.control) add(rec.block.shortcut, {focus: rec.control, control: rec.control});
    }
    if (!this.shortcuts.length) return;
    this._shortcutHandler = function (event) {
      var target = event.target;
      var tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
      var editing = tag === "input" || tag === "textarea" || tag === "select" ||
        (target && target.isContentEditable);
      for (var k = 0; k < self.shortcuts.length; k++) {
        var entry = self.shortcuts[k];
        if (!shortcutMatches(entry.spec, event)) continue;
        if (editing && !event.ctrlKey && !event.metaKey && !event.altKey && String(event.key).toLowerCase() !== "escape") continue;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        if (entry.action) self.startAction(entry.item, entry.control);
        else if (entry.focus && entry.focus.focus) entry.focus.focus();
        return;
      }
    };
    document.addEventListener("keydown", this._shortcutHandler);
  };

  Renderer.prototype.unbindShortcuts = function () {
    if (this._shortcutHandler && typeof document !== "undefined") {
      document.removeEventListener("keydown", this._shortcutHandler);
    }
    this._shortcutHandler = null;
    this.shortcuts = [];
  };

  /** Register a host-specific block renderer for one kind. The factory
   * receives (block, context, renderer) and returns a DOM node or null to
   * fall back to the built-in renderer. This is additive: the document stays
   * data-only and the host still owns values and writes. */
  Renderer.prototype.registerBlock = function (kind, factory) {
    if (typeof kind === "string" && typeof factory === "function") this.blockFactories[kind] = factory;
    return this;
  };

  Renderer.prototype.buildPanel = function (panel) {
    this._pageRecordIndex = -1;
    this._sectionRecordIndex = -1;
    this._collectionRecordIndex = -1;
    var embedded = panel.embedded === true;
    this._pageEmbedded = embedded;
    var panelEl = el("section", {class: "pui-panel", role: "region"});
    var panelRecord = {element: panelEl, tablist: null, pages: [], active: 0, pageBind: String(panel.page_bind || "")};
    this.panelRecords.push(panelRecord);
    var title = String(panel.title || panel.id || "Pupitre");
    var headingId = this.id("panel-title");
    if (embedded) {
      // Embedded panels are placed inside host chrome (dock, drawer, sidebar):
      // the host owns the visible title, PUI keeps the accessible name.
      panelEl.setAttribute("aria-label", title);
    } else {
      var head = el("header", {class: "pui-header"});
      head.appendChild(el("h1", {id: headingId, text: title}));
      if (panel.subtitle) head.appendChild(el("p", {class: "pui-subtitle", text: panel.subtitle}));
      if (panel.version) head.appendChild(el("span", {class: "pui-version", text: panel.version}));
      panelEl.appendChild(head);
      panelEl.setAttribute("aria-labelledby", headingId);
    }
    if (isArray(panel.actions) && panel.actions.length) panelEl.appendChild(this.buildActions(panel.actions));
    var pages = panel.pages || [];
    if (!pages.length) return panelEl;
    if (panel.default_page) {
      for (var d = 0; d < pages.length; d++) if (String(pages[d].id || "") === String(panel.default_page)) panelRecord.active = d;
    }
    if (panelRecord.pageBind) {
      var bound = this.adapter.getValue(panelRecord.pageBind);
      for (var pb = 0; pb < pages.length; pb++) if (String(pages[pb].id || "") === String(bound || "")) panelRecord.active = pb;
    }
    var tablist = null;
    var panels = [];
    if (pages.length > 1) {
      tablist = el("div", {class: "pui-tabs", role: "tablist"});
      panelRecord.tablist = tablist;
      panelEl.appendChild(tablist);
    }
    for (var p = 0; p < pages.length; p++) {
      var page = pages[p];
      this._pageRecordIndex = this.pageRecords.length;
      var pageTitleId = this.id("page-title");
      var pageEl = el("div", {class: "pui-page", role: pages.length > 1 ? "tabpanel" : "region", id: this.id("page")});
      pageEl.setAttribute("aria-labelledby", pageTitleId);
      pageEl.hidden = p !== panelRecord.active;
      var pageTitle = String(page.title || page.id || ("Page " + (p + 1)));
      if (isObject(page.layout) && String(page.layout.mode || "") === "workbench") {
        pageEl.appendChild(this.buildWorkbench(page, pageTitleId, pageTitle));
        pageEl.setAttribute("aria-labelledby", pageTitleId);
      } else {
        if (!embedded) {
          pageEl.appendChild(el("h2", {class: "pui-page-title", id: pageTitleId, text: pageTitle}));
          pageEl.setAttribute("aria-labelledby", pageTitleId);
        } else {
          pageEl.setAttribute("aria-label", pageTitle);
        }
        for (var s = 0; s < (page.sections || []).length; s++) pageEl.appendChild(this.buildSection(page.sections[s], p, s));
      }
      panelEl.appendChild(pageEl);
      panels.push(pageEl);
      if (tablist) {
        var tabId = this.id("tab");
        var tab = el("button", {type: "button", role: "tab", class: "pui-tab", id: tabId, text: pageTitle});
        tab.setAttribute("aria-controls", pageEl.id);
        tab.setAttribute("aria-selected", p === panelRecord.active ? "true" : "false");
        tab.tabIndex = p === panelRecord.active ? 0 : -1;
        tab.addEventListener("click", this.selectPage.bind(this, p, tablist, panels, panelRecord));
        tab.addEventListener("keydown", this.tabKey.bind(this, p, tablist, panels, panelRecord));
        tablist.appendChild(tab);
        pageEl.setAttribute("aria-labelledby", tabId);
      }
      var pageRecord = {
        page: page, element: pageEl, tab: tablist ? tablist.querySelectorAll('[role="tab"]')[p] : null,
        index: p, localIndex: p, panel: panelRecord, visible: true, enabled: true
      };
      this.pageRecords.push(pageRecord);
      panelRecord.pages.push(pageRecord);
    }
    this.tablist = tablist;
    this.pagePanels = panels;
    return panelEl;
  };

  Renderer.prototype.selectPage = function (index, tablist, panels, panelRecord) {
    this.activatePage(panelRecord, index);
    var tabs = tablist.querySelectorAll('[role="tab"]');
    if (tabs[index]) tabs[index].focus();
    this.writePage(panelRecord, index);
    this.routePage(panelRecord.pages[index] && panelRecord.pages[index].page);
  };

  /** Host-bound page state: the panel declares `page_bind`, the host stores
   * the active page id and can switch pages without rebuilding the document. */
  Renderer.prototype.writePage = function (panelRecord, index) {
    if (!panelRecord || !panelRecord.pageBind) return false;
    var rec = panelRecord.pages[index];
    var page = rec && rec.page;
    if (!page) return false;
    var id = String(page.id || "");
    if (!id) return false;
    try { this.setPath(panelRecord.pageBind, id); }
    catch (error) { this.adapter.announce("error", "Page bind failed: " + String(error && error.message || error)); return false; }
    if (typeof this.adapter.pageAction === "function") {
      try { this.adapter.pageAction({op: "page.select", id: id, index: index, page: page}, id, panelRecord); }
      catch (error) { this.adapter.announce("error", "Page action failed: " + String(error && error.message || error)); }
    }
    return true;
  };

  Renderer.prototype.syncPageBindings = function () {
    for (var i = 0; i < this.panelRecords.length; i++) {
      var panelRecord = this.panelRecords[i];
      if (!panelRecord.pageBind) continue;
      var bound = this.adapter.getValue(panelRecord.pageBind);
      for (var p = 0; p < panelRecord.pages.length; p++) {
        if (String(panelRecord.pages[p].page && panelRecord.pages[p].page.id || "") !== String(bound || "")) continue;
        if (panelRecord.active !== p) {
          this.activatePage(panelRecord, p);
          this.routePage(panelRecord.pages[p] && panelRecord.pages[p].page);
        }
        break;
      }
    }
  };

  Renderer.prototype.activatePage = function (panelRecord, index) {
    if (!panelRecord) return;
    panelRecord.active = index;
    for (var i = 0; i < panelRecord.pages.length; i++) {
      var rec = panelRecord.pages[i];
      rec.element.hidden = i !== index || !rec.visible;
      if (rec.tab) {
        rec.tab.setAttribute("aria-selected", i === index ? "true" : "false");
        rec.tab.tabIndex = i === index ? 0 : -1;
      }
    }
    // Host graph bodies on a previously hidden page now have a layout box.
    if (this.root && this.root.parentNode) this.graphLayoutBodies();
  };

  Renderer.prototype.tabKey = function (index, tablist, panels, panelRecord, event) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));
    var next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    this.selectPage(next, tablist, panels, panelRecord);
  };

  Renderer.prototype.routePage = function (page) {
    if (!page || typeof window === "undefined" || !window.location) return;
    var id = String(page.id || "");
    if (!id) return;
    var next = "#page=" + encodeURIComponent(id);
    if (window.location.hash !== next) window.location.hash = next;
  };

  Renderer.prototype.readRoute = function () {
    if (typeof window === "undefined" || !window.location) return {};
    var raw = String(window.location.hash || "").replace(/^#/, "");
    var params = {};
    raw.split("&").forEach(function (part) {
      var pair = part.split("=");
      if (pair[0]) params[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || "");
    });
    return params;
  };

  Renderer.prototype.routeHash = function (route) {
    route = route || {};
    var parts = [];
    ["page", "section", "field", "selection", "item", "panel"].forEach(function (key) {
      if (route[key] !== undefined && route[key] !== null && String(route[key]) !== "") parts.push(key + "=" + encodeURIComponent(String(route[key])));
    });
    return "#" + (parts.join("&") || "page=");
  };

  Renderer.prototype.link = function (route) {
    return this.routeHash(route || this.currentRoute || this.readRoute());
  };

  Renderer.prototype.navigate = function (pageId, fieldBind, extra) {
    var route = isObject(pageId) ? Object.assign({}, pageId) : Object.assign({page: String(pageId || "")}, extra || {});
    if (!isObject(pageId) && fieldBind) route.field = String(fieldBind);
    if (!route.page) return false;
    var target = null;
    for (var i = 0; i < this.pageRecords.length; i++) {
      if (String(this.pageRecords[i].page.id || "") === String(route.page)) { target = this.pageRecords[i]; break; }
    }
    if (target === null) return false;
    var current = this.currentRoute || this.readRoute();
    if (current && current.page && String(current.page) !== String(route.page)) this._routeHistory.push(current);
    this.activatePage(target.panel, target.localIndex);
    if (typeof window !== "undefined" && window.location) window.location.hash = this.routeHash(route);
    this.applyRoute();
    if (!route.section && !route.field && typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
    if (route.field) this.focusPath(String(route.field));
    return true;
  };

  Renderer.prototype.back = function () {
    var previous = this._routeHistory && this._routeHistory.pop();
    if (!previous) return false;
    if (typeof window !== "undefined" && window.location) window.location.hash = this.routeHash(previous);
    this.applyRoute();
    return true;
  };

  Renderer.prototype.focusSection = function (sectionId) {
    if (!this.root || !sectionId) return false;
    var escaped = String(sectionId).replace(/"/g, '\"');
    var section = this.root.querySelector('[data-pui-section="' + escaped + '"]');
    if (!section) return false;
    if (section.scrollIntoView) section.scrollIntoView({block: "nearest"});
    if (section.focus) section.focus();
    return true;
  };

  Renderer.prototype.focusPath = function (path) {
    if (!this.root) return false;
    var escaped = String(path).replace(/"/g, '\\"');
    var control = this.root.querySelector('[data-pui-bind="' + escaped + '"]');
    if (control && control.focus) { control.focus(); return true; }
    return false;
  };

  Renderer.prototype.applyRoute = function () {
    var route = this.readRoute();
    this.currentRoute = route;
    if (!route.page) return;
    var target = null;
    for (var i = 0; i < this.pageRecords.length; i++) {
      if (String(this.pageRecords[i].page.id || "") === String(route.page)) { target = this.pageRecords[i]; break; }
    }
    if (target) this.activatePage(target.panel, target.localIndex);
    if (route.section) this.focusSection(route.section);
    if (route.field) this.focusPath(route.field);
  };


  Renderer.prototype.buildWorkbench = function (page, titleId, title) {
    var self = this;
    var layout = isObject(page.layout) ? page.layout : {};
    var pageId = String(page.id || "");
    var wb = el("div", {class: "pui-workbench", "data-pui-workbench": pageId, role: "region"});
    var stageLayout = isObject(layout.stage) ? layout.stage : {};
    var stageFit = stageLayout.fit === "scroll" ? "scroll" : "contain";
    wb.setAttribute("data-stage-fit", stageFit);
    var bottomMode = isObject(layout.bottom) && layout.bottom.mode === "statusbar" ? "statusbar" : "pane";
    var widthSpec = function (region, fallback) {
      var raw = layout[region] && layout[region].width;
      if (isObject(raw)) {
        return {
          initial: Number.isFinite(Number(raw.initial)) ? Number(raw.initial) : fallback,
          min: Number.isFinite(Number(raw.min)) ? Number(raw.min) : 140,
          max: Number.isFinite(Number(raw.max)) ? Number(raw.max) : 620
        };
      }
      var initial = Number(raw);
      return {initial: Number.isFinite(initial) ? initial : fallback, min: 140, max: 620};
    };
    var leftSpec = widthSpec("left", 250);
    var rightSpec = widthSpec("right", 300);
    var stageMin = Number(stageLayout.min_width) || 360;
    var rec = {pageId: pageId, layout: layout, element: wb, panes: {}, buttons: {}, collapsed: {},
      widths: {left: leftSpec.initial, right: rightSpec.initial},
      widthLimits: {left: leftSpec, right: rightSpec}, stageMin: stageMin,
      narrow: false, resize: null};
    this.workbenches.push(rec);
    var groups = {toolbar: [], left: [], stage: [], right: [], bottom: []};
    (page.sections || []).forEach(function (section) {
      var region = String(section && section.region || "stage");
      if (!groups[region]) region = "stage";
      groups[region].push(section);
    });
    var toolbar = el("header", {class: "pui-workbench-toolbar"});
    toolbar.appendChild(el("h2", {class: "pui-page-title", id: titleId, text: title}));
    var tools = el("div", {class: "pui-workbench-tools"});
    if (isObject(layout.header_menu)) tools.appendChild(this.buildHeaderMenu(layout.header_menu));
    toolbar.appendChild(tools);
    var toolbarBlocks = el("div", {class: "pui-workbench-toolbar-blocks"});
    groups.toolbar.forEach(function (section, index) { toolbarBlocks.appendChild(self.buildSection(section, self._pageRecordIndex, index)); });
    if (toolbarBlocks.childNodes.length) toolbar.appendChild(toolbarBlocks);
    wb.appendChild(toolbar);

    var body = el("div", {class: "pui-workbench-body"});
    var pane = function (region, elementTag) {
      var paneTitle = String((layout[region] && layout[region].title) || region);
      var paneId = self.id("workbench-pane");
      var node = el(elementTag, {class: "pui-workbench-pane is-" + region, id: paneId, "data-region": region});
      node.setAttribute("aria-labelledby", paneId + "-title");
      node.appendChild(el("div", {class: "pui-workbench-pane-title", id: paneId + "-title", text: paneTitle}));
      var content = el("div", {class: "pui-workbench-pane-content"});
      var paneTabs = isObject(layout[region]) && isArray(layout[region].tabs) ? layout[region].tabs.filter(function (tab) { return typeof tab === "string" && tab; }) : [];
      if (paneTabs.length) {
        var tabBar = el("div", {class: "pui-pane-tabs", role: "tablist", "aria-label": paneTitle});
        var tabKey = "pui.workbench." + pageId + "." + region + ".tab";
        var storedTab = null;
        try { storedTab = window.localStorage && window.localStorage.getItem(tabKey); } catch (error) { storedTab = null; }
        var activeTab = paneTabs.indexOf(storedTab) >= 0 ? storedTab : paneTabs[0];
        var tabButtons = {}, tabPanels = {};
        paneTabs.forEach(function (tabName, tabIndex) {
          var tabId = self.id("workbench-tab");
          var panelId = self.id("workbench-tabpanel");
          var tabButton = el("button", {type: "button", class: "pui-pane-tab", role: "tab", id: tabId, "aria-controls": panelId, "aria-selected": "false", tabindex: "-1", text: tabName});
          var tabPanel = el("div", {class: "pui-pane-tabpanel", role: "tabpanel", id: panelId, "aria-labelledby": tabId, hidden: true});
          tabButton.addEventListener("click", function () { setActiveTab(tabName); });
          tabButton.addEventListener("keydown", function (event) {
            var delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (delta) {
              event.preventDefault();
              var next = (tabIndex + delta + paneTabs.length) % paneTabs.length;
              setActiveTab(paneTabs[next]);
              tabButtons[paneTabs[next]].focus();
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              var edge = event.key === "Home" ? 0 : paneTabs.length - 1;
              setActiveTab(paneTabs[edge]);
              tabButtons[paneTabs[edge]].focus();
            }
          });
          tabButton.addEventListener("focus", function () { setActiveTab(tabName); });
          tabBar.appendChild(tabButton);
          tabButtons[tabName] = tabButton;
          tabPanels[tabName] = tabPanel;
        });
        var setActiveTab = function (tabName) {
          if (paneTabs.indexOf(tabName) < 0) tabName = paneTabs[0];
          paneTabs.forEach(function (name) {
            var selected = name === tabName;
            tabButtons[name].setAttribute("aria-selected", selected ? "true" : "false");
            tabButtons[name].tabIndex = selected ? 0 : -1;
            tabPanels[name].hidden = !selected;
          });
          try { if (window.localStorage) window.localStorage.setItem(tabKey, tabName); } catch (error) { /* private mode */ }
        };
        groups[region].forEach(function (section, index) {
          var tabName = paneTabs.indexOf(section.tab) >= 0 ? section.tab : paneTabs[0];
          tabPanels[tabName].appendChild(self.buildSection(section, self._pageRecordIndex, index, {
            foldable: region === "stage" ? section.foldable === true : section.foldable !== false,
            pageId: pageId,
            region: region
          }));
        });
        content.appendChild(tabBar);
        paneTabs.forEach(function (name) { content.appendChild(tabPanels[name]); });
        setActiveTab(activeTab);
      } else {
        groups[region].forEach(function (section, index) {
          content.appendChild(self.buildSection(section, self._pageRecordIndex, index, {
            foldable: region === "stage" ? section.foldable === true : section.foldable !== false,
            pageId: pageId,
            region: region
          }));
        });
      }
      node.appendChild(content);
      rec.panes[region] = node;
      return {node: node, id: paneId, title: paneTitle};
    };
    // An empty pane is not an affordance: only create a left/right region
    // when it has sections or an explicit layout entry. This keeps a tab with
    // only a stage from wasting a third of the window on an empty "LEFT".
    var hasLeft = groups.left.length > 0 || isObject(layout.left);
    var hasRight = groups.right.length > 0 || isObject(layout.right);
    var leftInfo = hasLeft ? pane("left", "aside") : null;
    var stageInfo = pane("stage", "main");
    var rightInfo = hasRight ? pane("right", "aside") : null;
    var leftResize = null;
    var rightResize = null;
    if (leftInfo) {
      body.appendChild(leftInfo.node);
      leftResize = el("div", {class: "pui-workbench-resizer is-left", role: "separator", "aria-label": "Resize left pane", tabindex: "0"});
      body.appendChild(leftResize);
    }
    body.appendChild(stageInfo.node);
    if (rightInfo) {
      rightResize = el("div", {class: "pui-workbench-resizer is-right", role: "separator", "aria-label": "Resize right pane", tabindex: "0"});
      body.appendChild(rightResize);
      body.appendChild(rightInfo.node);
    }
    rec.resizers = {left: leftResize, right: rightResize};
    wb.appendChild(body);
    var bottomInfo = null;
    if (groups.bottom.length || isObject(layout.bottom)) {
      bottomInfo = pane("bottom", "footer");
      if (bottomMode === "statusbar") {
        bottomInfo.node.classList.add("is-statusbar");
        bottomInfo.node.style.setProperty("--pui-statusbar-height", String(Number(layout.bottom && layout.bottom.height) || 32) + "px");
      }
      wb.appendChild(bottomInfo.node);
    }

    var toggle = function (region, info, shortcut) {
      if (!groups[region].length && !(layout[region] && layout[region].collapsible)) return;
      var button = el("button", {type: "button", class: "pui-workbench-toggle", text: info.title});
      button.setAttribute("aria-controls", info.id);
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-keyshortcuts", shortcut);
      button.addEventListener("click", function () { self.workbenchToggle(rec, region); });
      rec.buttons[region] = button;
      tools.appendChild(button);
    };
    if (leftInfo) toggle("left", leftInfo, "Control+Alt+L");
    if (rightInfo) toggle("right", rightInfo, "Control+Alt+R");
    if (bottomInfo) toggle("bottom", bottomInfo, "Control+Alt+B");
    rec.buttons.left && (rec.buttons.left.title = "Toggle left pane");
    rec.buttons.right && (rec.buttons.right.title = "Toggle right pane");
    rec.buttons.bottom && (rec.buttons.bottom.title = "Toggle bottom pane");

    var stored = function (region, key, fallback) {
      try {
        var raw = window.localStorage && window.localStorage.getItem("pui.workbench." + pageId + "." + region + "." + key);
        return raw === null || raw === undefined ? fallback : (key === "collapsed" ? raw === "1" : Number(raw));
      } catch (error) { return fallback; }
    };
    var save = function (region, key, value) {
      try { if (window.localStorage) window.localStorage.setItem("pui.workbench." + pageId + "." + region + "." + key, key === "collapsed" ? (value ? "1" : "0") : String(value)); } catch (error) {}
    };
    ["left", "right"].forEach(function (region) {
      var storedWidth = stored(region, "width", rec.widths[region]);
      var limits = rec.widthLimits[region];
      if (isFinite(storedWidth)) rec.widths[region] = Math.max(limits.min, Math.min(limits.max, storedWidth));
    });
    ["left", "right", "bottom"].forEach(function (region) {
      var collapsed = stored(region, "collapsed", false);
      if (collapsed && rec.panes[region]) { rec.collapsed[region] = true; rec.panes[region].classList.add("is-collapsed"); if (rec.buttons[region]) rec.buttons[region].setAttribute("aria-expanded", "false"); if (rec.resizers && rec.resizers[region]) rec.resizers[region].style.display = "none"; }
    });
    this.workbenchApplyWidths(rec);
    var resizeStart = function (region) {
      return function (event) {
        if (rec.collapsed[region]) return;
        rec.resize = {region: region, x: event.clientX || 0, width: rec.widths[region]};
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
      };
    };
    if (leftResize) leftResize.addEventListener("pointerdown", resizeStart("left"));
    if (rightResize) rightResize.addEventListener("pointerdown", resizeStart("right"));
    var resetWidth = function (region) {
      rec.widths[region] = rec.widthLimits[region].initial;
      save(region, "width", rec.widths[region]);
      self.workbenchApplyWidths(rec);
      if (rec.updateNarrow) rec.updateNarrow();
    };
    if (leftResize) leftResize.addEventListener("dblclick", function () { resetWidth("left"); });
    if (rightResize) rightResize.addEventListener("dblclick", function () { resetWidth("right"); });
    wb.addEventListener("pointermove", function (event) {
      if (!rec.resize) return;
      var dx = (event.clientX || 0) - rec.resize.x;
      var sign = rec.resize.region === "left" ? 1 : -1;
      var region = rec.resize.region;
      var limits = rec.widthLimits[region];
      var other = region === "left" ? "right" : "left";
      var otherWidth = rec.collapsed[other] ? 0 : rec.widths[other];
      var bodyWidth = wb.clientWidth || 0;
      var maxByStage = bodyWidth > 0 ? bodyWidth - otherWidth - rec.stageMin - 12 : limits.max;
      rec.widths[region] = Math.max(limits.min, Math.min(limits.max, maxByStage, rec.resize.width + sign * dx));
      self.workbenchApplyWidths(rec);
      if (rec.updateNarrow) rec.updateNarrow();
    });
    wb.addEventListener("pointerup", function () {
      if (!rec.resize) return;
      save(rec.resize.region, "width", rec.widths[rec.resize.region]);
      rec.resize = null;
    });
    wb.addEventListener("keydown", function (event) {
      if (!event.altKey || !event.ctrlKey) return;
      var key = String(event.key || "").toLowerCase();
      var region = key === "l" ? "left" : key === "r" ? "right" : key === "b" ? "bottom" : "";
      if (!region || !rec.panes[region]) return;
      if (event.preventDefault) event.preventDefault();
      self.workbenchToggle(rec, region);
    });
    var updateNarrow = function () {
      var viewportWidth = typeof window !== "undefined" ? (window.innerWidth || 1200) : 1200;
      var bodyWidth = wb.clientWidth || viewportWidth;
      var effectiveLeft = rec.collapsed.left ? 0 : rec.widths.left;
      var effectiveRight = rec.collapsed.right ? 0 : rec.widths.right;
      var availableStage = bodyWidth - effectiveLeft - effectiveRight;
      // an empty stage is not a layout: 900 px was not enough for a 360 px
      // editor pane plus a 380 px inspector, and exactly 900 px escaped the
      // old breakpoint. Use the actual remaining width, not only the viewport.
      var narrow = viewportWidth <= 900 || availableStage < rec.stageMin;
      if (narrow === rec.narrow) return;
      var enteringNarrow = narrow && !rec.narrow;
      rec.narrow = narrow;
      wb.classList.toggle("is-narrow", narrow);
      if (enteringNarrow) {
        ["left", "right"].forEach(function (region) {
          if (!rec.panes[region] || rec.collapsed[region]) return;
          rec.collapsed[region] = true;
          rec.panes[region].classList.add("is-collapsed");
          if (rec.buttons[region]) rec.buttons[region].setAttribute("aria-expanded", "false");
          if (rec.resizers && rec.resizers[region]) rec.resizers[region].style.display = "none";
        });
      }
    };
    rec.updateNarrow = updateNarrow;
    updateNarrow();
    if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", updateNarrow);
    return wb;
  };

  Renderer.prototype.workbenchApplyWidths = function (rec) {
    if (!rec || !rec.element) return;
    rec.element.style.setProperty("--pui-workbench-left", rec.widths.left + "px");
    rec.element.style.setProperty("--pui-workbench-right", rec.widths.right + "px");
  };

  /** Structured layout diagnostics for tests and dev overlays. Hidden pages
   * are omitted; stage overflow is the invariant hosts care about most. */
  Renderer.prototype.layoutReport = function () {
    var self = this;
    var out = [];
    (this.workbenches || []).forEach(function (rec) {
      if (!rec.element || rec.element.hidden) return;
      var panes = {};
      Object.keys(rec.panes || {}).forEach(function (region) {
        var pane = rec.panes[region];
        if (!pane || pane.hidden) return;
        var content = pane.querySelector(".pui-workbench-pane-content") || pane;
        panes[region] = {
          clientWidth: pane.clientWidth || 0,
          clientHeight: pane.clientHeight || 0,
          scrollHeight: content.scrollHeight || 0,
          collapsed: !!rec.collapsed[region]
        };
      });
      var stage = panes.stage || {};
      out.push({
        pageId: rec.pageId,
        narrow: !!rec.narrow,
        widths: {left: rec.widths.left, right: rec.widths.right},
        limits: rec.widthLimits,
        stageMin: rec.stageMin,
        stage,
        panes: panes,
        stageOverflow: !!stage.scrollHeight && stage.scrollHeight > stage.clientHeight + 1
      });
    });
    return {workbenches: out, overflow: out.some(function (entry) { return entry.stageOverflow; })};
  };

  Renderer.prototype.workbenchToggle = function (rec, region) {
    if (!rec || !rec.panes[region]) return false;
    var pane = rec.panes[region];
    var collapsed = !rec.collapsed[region];
    if (rec.narrow && !collapsed && (region === "left" || region === "right")) {
      var other = region === "left" ? "right" : "left";
      if (rec.collapsed[other] === false) {
        rec.collapsed[other] = true;
        rec.panes[other].classList.add("is-collapsed");
        if (rec.buttons[other]) rec.buttons[other].setAttribute("aria-expanded", "false");
      }
    }
    rec.collapsed[region] = collapsed;
    pane.classList.toggle("is-collapsed", collapsed);
    if (rec.buttons[region]) rec.buttons[region].setAttribute("aria-expanded", collapsed ? "false" : "true");
    if (rec.resizers && rec.resizers[region]) rec.resizers[region].style.display = collapsed ? "none" : "";
    try { if (window.localStorage) window.localStorage.setItem("pui.workbench." + rec.pageId + "." + region + ".collapsed", collapsed ? "1" : "0"); } catch (error) {}
    return true;
  };

  Renderer.prototype.buildSection = function (section, pageIndex, sectionIndex, options) {
    this._sectionRecordIndex = this.sectionRecords.length;
    var embedded = !!this._pageEmbedded;
    var id = this.id("section-title");
    var sectionEl = el("section", {class: "pui-section", "data-pui-section": String(section.id || ""), tabindex: "-1"});
    var sectionTitle = String(section.title || section.id || "Section");
    var foldable = !embedded && !!(options && options.foldable);
    var sectionBody = null;
    if (foldable) {
      var bodyId = this.id("section-body");
      var foldKey = "pui.workbench." + String(options.pageId || "") + "." + String(options.region || "") + ".section." + String(section.id || sectionIndex) + ".folded";
      var folded = section.default_folded === true;
      try {
        var storedFold = window.localStorage && window.localStorage.getItem(foldKey);
        if (storedFold !== null && storedFold !== undefined) folded = storedFold === "1";
      } catch (error) { /* private mode keeps the document default */ }
      var title = el("h3", {id: id});
      var toggle = el("button", {type: "button", class: "pui-section-toggle", "aria-expanded": folded ? "false" : "true", "aria-controls": bodyId});
      toggle.appendChild(el("span", {class: "pui-section-chevron", "aria-hidden": "true", text: "▾"}));
      toggle.appendChild(el("span", {text: sectionTitle}));
      title.appendChild(toggle);
      sectionEl.appendChild(title);
      sectionEl.setAttribute("aria-labelledby", id);
      sectionBody = el("div", {class: "pui-section-body", id: bodyId});
      var setFolded = function (next) {
        sectionBody.hidden = next;
        sectionEl.classList.toggle("is-folded", next);
        toggle.setAttribute("aria-expanded", next ? "false" : "true");
        try { if (window.localStorage) window.localStorage.setItem(foldKey, next ? "1" : "0"); } catch (error) { /* private mode */ }
      };
      if (folded) setFolded(true);
      toggle.addEventListener("click", function () { setFolded(!sectionBody.hidden); });
      sectionEl.appendChild(sectionBody);
    } else if (!embedded) {
      sectionEl.appendChild(el("h3", {id: id, text: sectionTitle}));
      sectionEl.setAttribute("aria-labelledby", id);
    } else {
      sectionEl.setAttribute("aria-label", sectionTitle);
    }
    var sectionHelp = null;
    if (section.help) {
      sectionHelp = el("p", {class: "pui-help", text: String(section.help)});
      (sectionBody || sectionEl).appendChild(sectionHelp);
    }
    var body = el("div", {class: "pui-fields"});
    var columns = section.layout && section.layout.columns || 1;
    body.style.setProperty("--pui-columns", String(columns));
    for (var i = 0; i < (section.blocks || []).length; i++) {
      var block = section.blocks[i];
      var blockEl = this.buildBlock(block, {section: section});
      if (blockEl && blockEl.setAttribute && block && typeof block.kind === "string") blockEl.setAttribute("data-pui-kind", block.kind);
      body.appendChild(blockEl);
    }
    (sectionBody || sectionEl).appendChild(body);
    if (isArray(section.actions) && section.actions.length) (sectionBody || sectionEl).appendChild(this.buildActions(section.actions));
    if (isArray(section.presets) && section.presets.length) (sectionBody || sectionEl).appendChild(this.buildActions(section.presets, "preset"));
    this.sectionRecords.push({element: sectionEl, block: section, helpEl: sectionHelp, pageRecordIndex: this._pageRecordIndex, visible: true, enabled: true});
    return sectionEl;
  };

  Renderer.prototype.buildBlock = function (block, context) {
    if (!isObject(block)) return el("p", {class: "pui-missing", text: "(invalid PUI block)"});
    var kind = String(block.kind || "field");
    var factory = this.blockFactories[kind];
    if (typeof factory === "function") {
      var custom = factory(block, context || {}, this);
      if (custom) return custom;
    }
    if (kind === "field") return this.buildField(block, context);
    if (kind === "readout") return this.buildReadout(block);
    if (kind === "collection") return this.buildCollection(block);
    if (kind === "table") return this.buildTable(block);
    if (kind === "form") return this.buildForm(block);
    if (kind === "toolbar") return this.buildToolbar(block);
    if (kind === "statusbar") return this.buildStatusbar(block);
    if (kind === "menu") return this.buildMenu(block);
    if (kind === "toast") return this.buildToast(block);
    if (kind === "action") return this.buildActions([block]);
    if (kind === "actions") return this.buildActions(block.items || [], kind);
    if (kind === "presets") return this.buildPresets(block);
    if (kind === "note") {
      return el("p", {class: "pui-note " + (block.level === "warning" ? "pui-warn" : ""), text: String(block.text || "")});
    }
    if (kind === "separator") return el("hr", {class: "pui-separator"});
    if (kind === "custom") return this.buildCustom(block);
    if (kind === "graph") return this.buildGraph(block);
    if (kind === "timeline") return this.buildTimeline(block);
    if (kind === "stage") return this.buildStage(block);
    if (kind === "tree") return this.buildTree(block);
    if (kind === "history") return this.buildHistory(block);
    if (kind === "connection") return this.buildConnection(block);
    if (kind === "preview") return this.buildPreview(block);
    if (kind === "schemaForm") return this.buildSchemaForm(block);
    if (kind === "transport") return this.buildTransport(block);
    if (kind === "meter") return this.buildMeter(block);
    if (kind === "keycapture") return this.buildKeyCapture(block);
    if (kind === "binding") return this.buildBinding(block);
    if (kind === "workspaces") return this.buildWorkspaces(block);
    if (kind === "mediaTimeline") return this.buildMediaTimeline(block);
    if (kind === "favorites") return this.buildFavorites(block);
    if (kind === "dialog") return this.buildDialog(block);
    if (kind === "commandlog") return this.buildCommandLog(block);
    if (kind === "selection") return this.buildSelection(block);
    if (kind === "disclosure") return this.buildDisclosure(block);
    if (kind === "project") return this.buildProject(block);
    if (kind === "canvas") return this.buildCanvas(block);
    if (kind === "workflow") return this.buildWorkflow(block);
    if (kind === "code") return this.buildCode(block);
    if (kind === "curve") return this.buildCurve(block);
    if (kind === "drawer") return this.buildDrawer(block);
    if (kind === "macros") return this.buildMacros(block);
    if (kind === "slider") return this.buildSlider(block);
    return el("p", {class: "pui-missing", text: "(unknown PUI block '" + kind + "')"});
  };

  Renderer.prototype.graphValue = function (block) {
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(String(block.bind || ""), block)
      : this.adapter.getValue(String(block.bind || ""));
    return isObject(value) ? value : null;
  };

  Renderer.prototype.graphTypes = function (block) {
    if (isArray(block.types)) return block.types;
    if (block.types_bind) {
      var types = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(String(block.types_bind), block)
        : this.adapter.getValue(String(block.types_bind));
      if (isArray(types)) return types;
    }
    return [];
  };

  /** Read-only G-2 graph renderer: DOM nodes + SVG cables + frames + outline.
   * The host owns the graph value and edits; this renderer owns geometry,
   * pan/zoom, focus and the accessible outline. */
  /** Geometry for the graph viewport. Density is a renderer profile, not a
   * document property; compact must tighten the patch itself as well as the
   * surrounding inspector. */
  Renderer.prototype.graphMetrics = function () {
    var Graph = global.PupitreGraph;
    var base = Graph && Graph.DEFAULTS ? Graph.DEFAULTS : {nodeWidth: 156, headerHeight: 26, portRowHeight: 18, pad: 8, paramRows: 2, paramRowHeight: 14};
    var metrics = Object.assign({}, base, {paramRows: 3});
    if (this.density === "compact") {
      metrics.headerHeight = 20;
      metrics.portRowHeight = 16;
      metrics.pad = 4;
      metrics.paramRowHeight = 16;
    } else {
      metrics.paramRowHeight = 18;
    }
    return metrics;
  };

  /** Node geometry includes the measured height of a host body so covers and
   * meters are not clipped by the generic node rectangle. */
  Renderer.prototype.graphNodeRect = function (rec, node, type) {
    var Graph = global.PupitreGraph;
    if (!Graph) return {x: Number(node && node.x) || 0, y: Number(node && node.y) || 0, w: 156, h: 58};
    type = type || (rec.typeMap && rec.typeMap[String(node.type)]);
    var rect = Graph.nodeRect(node, type, rec.metrics);
    var extra = Number(rec.nodeExtraHeights && rec.nodeExtraHeights[String(node.id)]) || 0;
    if (extra > 0) rect.h += extra;
    return rect;
  };

  Renderer.prototype.graphApplyNodeGeometry = function (rec, nodeId) {
    var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(nodeId); });
    var nodeEl = rec.nodeEls && rec.nodeEls[String(nodeId)];
    if (!node || !nodeEl) return;
    var rect = this.graphNodeRect(rec, node);
    if (nodeEl.setAttribute) nodeEl.setAttribute("style", "left:" + rect.x + "px;top:" + rect.y + "px;width:" + rect.w + "px;height:" + rect.h + "px;");
  };

  Renderer.prototype.graphMeasureNodeBody = function (rec, nodeId) {
    var id = String(nodeId);
    var body = rec.bodyEls && rec.bodyEls[id];
    if (!body) return;
    var height = Number(body.offsetHeight);
    if (!isFinite(height) || height < 0) height = 0;
    var extra = height > 0 ? height + 4 : 0;
    if (rec.nodeExtraHeights[id] === extra) return;
    rec.nodeExtraHeights[id] = extra;
    this.graphApplyNodeGeometry(rec, id);
  };

  Renderer.prototype.graphObserveNodeBodies = function (rec) {
    if (typeof ResizeObserver === "undefined" || !rec || !rec.bodyEls) return;
    var self = this;
    Object.keys(rec.bodyEls).forEach(function (id) {
      var body = rec.bodyEls[id];
      if (!body || (rec.bodyObservers && rec.bodyObservers[id])) return;
      var observer = new ResizeObserver(function () { self.graphMeasureNodeBody(rec, id); });
      observer.observe(body);
      rec.bodyObservers = rec.bodyObservers || {};
      rec.bodyObservers[id] = observer;
    });
  };

  Renderer.prototype.graphUnobserveGraphBodies = function (rec) {
    if (!rec || !rec.bodyObservers) return;
    Object.keys(rec.bodyObservers).forEach(function (id) {
      try { rec.bodyObservers[id].disconnect(); } catch (error) { /* cleanup */ }
    });
    rec.bodyObservers = {};
  };

  Renderer.prototype.disconnectGraphBodies = function () {
    for (var i = 0; i < this.graphRecords.length; i++) this.graphUnobserveGraphBodies(this.graphRecords[i]);
  };

  Renderer.prototype.graphLayoutGraphBodies = function (rec) {
    if (!rec || !rec.bodyEls) return;
    var self = this;
    Object.keys(rec.bodyEls).forEach(function (id) { self.graphMeasureNodeBody(rec, id); });
    this.graphObserveNodeBodies(rec);
  };

  Renderer.prototype.graphLayoutBodies = function () {
    var self = this;
    this.graphRecords.forEach(function (rec) { self.graphLayoutGraphBodies(rec); });
  };

  Renderer.prototype.graphValueTexture = function (node, type) {
    var raw = node && (node.value_texture || node.valueTexture) || type && (type.value_texture || type.valueTexture);
    if (!isObject(raw)) return null;
    var channels = [];
    if (isArray(raw.channels)) {
      raw.channels.forEach(function (entry, index) {
        if (!isObject(entry)) return;
        var id = String(entry.id || entry.key || "c" + index);
        channels.push({id: id, label: String(entry.label || entry.name || id), value: entry.value, color: entry.color, min: entry.min, max: entry.max});
      });
    } else {
      Object.keys(raw).forEach(function (key) {
        if (key === "encoding" || key === "width" || key === "height" || key === "mode") return;
        var value = raw[key];
        if (typeof value === "number" || typeof value === "string") channels.push({id: key, label: key, value: value});
      });
    }
    if (!channels.length) return null;
    return {encoding: String(raw.encoding || "luma"), channels: channels};
  };

  Renderer.prototype.graphValueTextureEl = function (node, texture) {
    var box = el("div", {class: "pui-graph-value-texture", "data-value-texture": String(node.id || ""), "data-encoding": texture.encoding, role: "group", "aria-label": "Value texture for " + String(node.label || node.id || "node")});
    var head = el("div", {class: "pui-graph-vt-head"});
    head.appendChild(el("span", {text: "Value texture"}));
    head.appendChild(el("span", {class: "pui-graph-vt-encoding", text: texture.encoding.toUpperCase()}));
    box.appendChild(head);
    var cells = el("div", {class: "pui-graph-vt-cells"});
    var summary = [];
    texture.channels.slice(0, 4).forEach(function (entry, index) {
      var value = Number(entry.value);
      var normalized = isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      var color = String(entry.color || "");
      if (!color && texture.encoding === "rgba" && isArray(entry.value)) {
        color = "rgba(" + entry.value.slice(0, 4).map(function (v) { return Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255); }).join(",") + ")";
      }
      if (!color) color = "rgb(" + Math.round(normalized * 255) + "," + Math.round(normalized * 255) + "," + Math.round(normalized * 255) + ")";
      var cell = el("span", {class: "pui-graph-vt-cell", "data-channel": entry.id, "data-value": String(isFinite(value) ? value : ""), title: entry.label + " · " + (isFinite(value) ? value : "—")});
      cell.style.background = color;
      cells.appendChild(cell);
      summary.push(entry.label + " " + (isFinite(value) ? Number(value.toFixed(3)) : "—"));
    });
    box.appendChild(cells);
    box.appendChild(el("span", {class: "pui-graph-vt-summary", text: summary.join(" · ")}));
    box.title = "Packed parameter texture · " + summary.join(" · ");
    return box;
  };

  Renderer.prototype.buildGraph = function (block, navStack) {
    var self = this;
    var Graph = global.PupitreGraph;
    var rootGraph = this.graphValue(block);
    var types = this.graphTypes(block);
    var label = String(block.label || block.id || "Graph");
    var rootPath = String(block.bind || "");
    var nav = isArray(navStack) && navStack.length ? navStack : [{path: rootPath, label: label}];
    var graphPath = String(nav[nav.length - 1] && nav[nav.length - 1].path || rootPath);
    var graph = graphPath === rootPath ? rootGraph : this.adapter.getValue(graphPath);
    if (!Graph) return el("p", {class: "pui-missing", text: "(graph model PupitreGraph is not loaded)"});
    if (!isObject(graph)) return el("p", {class: "pui-missing", text: "(graph value is missing at " + graphPath + ")"});
    var issues = Graph.validateGraph(graph, types);
    var typeMap = {};
    types.forEach(function (type) { if (isObject(type) && type.id !== undefined) typeMap[String(type.id)] = type; });
    var nodes = isArray(graph.nodes) ? graph.nodes : [];
    var cables = isArray(graph.cables) ? graph.cables : [];
    var frames = isArray(graph.frames) ? graph.frames : [];
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-graph" + (nav.length > 1 ? " is-nested" : ""), "data-pui-graph": String(block.bind || ""), "data-nav-depth": String(nav.length), role: "group"});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var head = el("div", {class: "pui-graph-head"});
    head.appendChild(el("h4", {text: label}));
    if (nav.length > 1) {
      var crumbs = el("nav", {class: "pui-graph-breadcrumbs", "aria-label": "Graph breadcrumbs"});
      nav.forEach(function (entry, index) {
        var crumb = el("button", {type: "button", class: "pui-graph-crumb", text: String(entry.label || entry.path || "Subgraph")});
        if (index === nav.length - 1) crumb.setAttribute("aria-current", "page");
        crumb.addEventListener("click", function () { self.graphNavigate(rec, index); });
        crumbs.appendChild(crumb);
        if (index < nav.length - 1) crumbs.appendChild(el("span", {class: "pui-graph-crumb-sep", "aria-hidden": "true", text: "/"}));
      });
      head.appendChild(crumbs);
    }
    if (isObject(graph.interface)) {
      var inLabels = isArray(graph.interface.inputs) ? graph.interface.inputs.map(function (port) { return String(port.label || port.id || ""); }).filter(Boolean) : [];
      var outLabels = isArray(graph.interface.outputs) ? graph.interface.outputs.map(function (port) { return String(port.label || port.id || ""); }).filter(Boolean) : [];
      head.appendChild(el("span", {class: "pui-graph-interface", text: "Boundary: " + (inLabels.length ? "in " + inLabels.join(", ") : "no inputs") + " · " + (outLabels.length ? "out " + outLabels.join(", ") : "no outputs")}));
    }
    if (!block.readonly) {
      var addButton = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Add node"});
      addButton.addEventListener("click", function () { self.openGraphAdd(rec); });
      head.appendChild(addButton);
      var addFrame = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Add frame"});
      addFrame.addEventListener("click", function () { self.graphAddFrame(rec); });
      head.appendChild(addFrame);
      var groupButton = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Group selection"});
      groupButton.addEventListener("click", function () { self.graphGroupSelection(rec); });
      head.appendChild(groupButton);
      var bookmarkButton = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Bookmark view"});
      bookmarkButton.addEventListener("click", function () { self.graphSaveBookmark(rec); });
      head.appendChild(bookmarkButton);
      var duplicateButton = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Duplicate"});
      duplicateButton.addEventListener("click", function () { self.graphDuplicate(rec); });
      head.appendChild(duplicateButton);
      if (nav.length > 1 && typeof this.adapter.graphOnParentAction === "function") {
        var setRoi = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Set parent ROI"});
        setRoi.addEventListener("click", function () { self.graphSetParentRoi(rec); });
        head.appendChild(setRoi);
        var clearRoi = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Clear ROI"});
        clearRoi.addEventListener("click", function () { self.graphClearParentRoi(rec); });
        head.appendChild(clearRoi);
        var expose = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Expose selected"});
        expose.addEventListener("click", function () { self.graphExposeSelected(rec); });
        head.appendChild(expose);
      }
    }
    if (nav.length > 1) {
      var upButton = el("button", {type: "button", class: "pui-button pui-graph-add-button pui-graph-up", text: "Up"});
      upButton.addEventListener("click", function () { self.graphNavigate(rec, nav.length - 2); });
      head.appendChild(upButton);
    }
    var fitButton = el("button", {type: "button", class: "pui-button pui-graph-add-button", text: "Fit"});
    fitButton.addEventListener("click", function () { self.graphFit(rec); });
    head.appendChild(fitButton);
    head.appendChild(el("span", {class: "pui-graph-count", text: nodes.length + " nodes · " + cables.length + " links"}));
    if (issues.length) {
      head.appendChild(el("span", {
        class: "pui-graph-issues" + (issues.some(function (i) { return i.level === "error"; }) ? " is-error" : ""),
        text: issues.length + " issue" + (issues.length === 1 ? "" : "s")
      }));
    }
    root.appendChild(head);
    var viewport = el("div", {class: "pui-graph-viewport", tabindex: "0", role: "group", "aria-label": (a11y.name || label) + " canvas", "aria-keyshortcuts": "Enter u Alt+ArrowUp"});
    var content = el("div", {class: "pui-graph-content"});
    var svg = svgEl("svg", {class: "pui-graph-cables", "aria-hidden": "true"});
    var cableGroup = svgEl("g");
    svg.appendChild(cableGroup);
    content.appendChild(svg);
    var selected = {};
    var graphOptions = isObject(block.graph_options) ? block.graph_options : {};
    var rec = {block: block, root: root, graph: graph, rootGraph: rootGraph, graphPath: graphPath,
      rootPath: rootPath, navStack: nav, types: types, typeMap: typeMap,
      nodeEls: {}, cableRefs: [], selected: selected, undo: [], redo: [], dragging: null,
      wiring: null, marquee: null, selectedCable: null, graphOptions: graphOptions,
      recentTypes: [], favoriteTypes: {}, paramEls: {}, portEls: {}, frameEls: {}, selectedFrame: null,
      viewport: viewport, content: content, cableGroup: cableGroup,
      metrics: self.graphMetrics(), nodeExtraHeights: {}, bodyEls: {}, bodyObservers: {}};
    this.graphRecords.push(rec);
    rec.head = head;
    rec.bookmarkBar = el("div", {class: "pui-graph-bookmarks", "aria-label": "Camera bookmarks"});
    head.appendChild(rec.bookmarkBar);
    rec.presetsBar = el("div", {class: "pui-graph-presets", "aria-label": "Graph presets"});
    root.appendChild(rec.presetsBar);
    rec.issues = issues;
    rec.issueEl = head.querySelector(".pui-graph-issues");
    var nodeEls = rec.nodeEls;
    if (block.selection_bind) {
      var selection = this.readSelection(String(block.selection_bind), block);
      selection.ids.forEach(function (id) { selected[String(id)] = true; });
    }
    frames.forEach(function (frame) {
      if (!isObject(frame)) return;
      var frameEl = el("div", {
        class: "pui-graph-frame" + (isArray(frame.members) ? " is-group" : ""),
        "data-frame-id": String(frame.id || ""),
        style: "left:" + (Number(frame.x) || 0) + "px;top:" + (Number(frame.y) || 0) + "px;width:" + (Number(frame.w) || 0) + "px;height:" + (Number(frame.h) || 0) + "px;"
      });
      frameEl.appendChild(el("span", {class: "pui-graph-frame-title", text: String(frame.title || "Frame") + (isArray(frame.members) ? " · " + frame.members.length : "")}));
      frameEl.addEventListener("pointerdown", function (event) {
        if (event.target && event.target.closest && event.target.closest(".pui-graph-frame-resize")) return;
        if (event.button !== undefined && event.button !== 0) return;
        event.stopPropagation();
        self.graphSelectFrame(rec, frame);
        var contained = self.graphFrameNodes(rec, frame).map(function (node) { return String(node.id); });
        rec.frameDrag = {start: deepClone(rec.graph), frame: frame, x: event.clientX || 0, y: event.clientY || 0, ids: contained, moved: false};
      });
      if (!block.readonly) {
        var resize = el("span", {class: "pui-graph-frame-resize", "aria-hidden": "true"});
        resize.addEventListener("pointerdown", function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          event.stopPropagation();
          self.graphSelectFrame(rec, frame);
          rec.frameResize = {start: deepClone(rec.graph), frame: frame, x: event.clientX || 0, y: event.clientY || 0, w: Number(frame.w) || 100, h: Number(frame.h) || 80};
        });
        frameEl.appendChild(resize);
      }
      rec.frameEls[String(frame.id || "")] = frameEl;
      content.appendChild(frameEl);
    });
    nodes.forEach(function (node) {
      if (!isObject(node)) return;
      var id = String(node.id || "");
      var type = typeMap[String(node.type)] || null;
      var rect = self.graphNodeRect(rec, node, type);
      var nodeEl = el("div", {
        class: "pui-graph-node" + (node.enabled === false ? " is-disabled" : "") + (selected[id] ? " is-selected" : ""),
        "data-node-id": id,
        role: "group",
        tabindex: "0",
        style: "left:" + rect.x + "px;top:" + rect.y + "px;width:" + rect.w + "px;height:" + rect.h + "px;"
      });
      rec.nodeEls[id] = nodeEl;
      var nodeLabel = String(node.label || (type && type.label) || node.type || id);
      nodeEl.setAttribute("aria-label", nodeLabel + (type && type.label ? ", " + type.label : "") + (node.enabled === false ? ", disabled" : ""));
      nodeEl.appendChild(el("div", {class: "pui-graph-node-head"},
        el("span", {class: "pui-graph-node-title", text: nodeLabel}),
        el("span", {class: "pui-graph-node-type", text: String((type && type.label) || node.type || "")})
      ));
      var hiddenInputs = isArray(node.hidden_inputs) ? node.hidden_inputs.map(String) : [];
      var hiddenOutputs = isArray(node.hidden_outputs) ? node.hidden_outputs.map(String) : [];
      var hiddenParams = isArray(node.hidden_params) ? node.hidden_params.map(String) : [];
      var inputs = Graph.activeInputs(node, type).filter(function (port) { return hiddenInputs.indexOf(String(port.id)) < 0; });
      var outputs = (type && isArray(type.outputs) ? type.outputs : []).filter(function (port) { return hiddenOutputs.indexOf(String(port.id)) < 0; });
      var portRows = Math.max(inputs.length, outputs.length);
      var ports = el("div", {class: "pui-graph-ports"});
      inputs.forEach(function (port, index) {
        var portType = String(port.type || "tex");
        var dotTop = rec.metrics.headerHeight + index * rec.metrics.portRowHeight + rec.metrics.portRowHeight / 2 - 5;
        var portMeta = Graph.portMeta(type, port.id, true) || port;
        var dot = el("span", {class: "pui-graph-port-dot " + portType, style: "left:-5px;top:" + dotTop + "px;", "data-node-id": id, "data-port-id": String(port.id), "data-port-kind": "input", "data-port-type": portType, "data-port-channel": String(portMeta.channel || ""), "data-port-scale": String(portMeta.scale !== undefined ? portMeta.scale : ""), tabindex: "0", role: "button"});
        dot.setAttribute("aria-label", "Input " + String(port.label || port.id) + " on " + nodeLabel + ", type " + portType + (portMeta.channel ? ", channel " + portMeta.channel : ""));
        dot.title = "Input · " + portType + (portMeta.channel ? " · " + portMeta.channel : "") + (portMeta.scale !== undefined ? " · ×" + portMeta.scale : "");
        rec.portEls[id + ":input:" + String(port.id)] = {el: dot, type: portType, isInput: true};
        dot.addEventListener("pointerdown", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          self.graphStartWire(rec, id, port.id, true, event);
        });
        dot.addEventListener("pointerup", function (event) {
          if (rec.wiring) { if (event.stopPropagation) event.stopPropagation(); self.graphFinishWire(rec, id, port.id, event); }
        });
        ports.appendChild(dot);
      });
      outputs.forEach(function (port, index) {
        var portType = String(port.type || "tex");
        var dotTop = rec.metrics.headerHeight + index * rec.metrics.portRowHeight + rec.metrics.portRowHeight / 2 - 5;
        var outMeta = Graph.portMeta(type, port.id, false) || port;
        var dot = el("span", {class: "pui-graph-port-dot " + portType, style: "right:-5px;top:" + dotTop + "px;", "data-node-id": id, "data-port-id": String(port.id), "data-port-kind": "output", "data-port-type": portType, "data-port-channel": String(outMeta.channel || ""), "data-port-scale": String(outMeta.scale !== undefined ? outMeta.scale : ""), tabindex: "0", role: "button"});
        dot.setAttribute("aria-label", "Output " + String(port.label || port.id) + " on " + nodeLabel + ", type " + portType + (outMeta.channel ? ", channel " + outMeta.channel : ""));
        dot.title = "Output · " + portType + (outMeta.channel ? " · " + outMeta.channel : "") + (outMeta.scale !== undefined ? " · ×" + outMeta.scale : "");
        rec.portEls[id + ":output:" + String(port.id)] = {el: dot, type: portType, isInput: false};
        dot.addEventListener("pointerdown", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          self.graphStartWire(rec, id, port.id, false, event);
        });
        ports.appendChild(dot);
      });
      for (var row = 0; row < portRows; row++) {
        var line = el("div", {class: "pui-graph-port-row"});
        var inLabel = inputs[row] ? el("span", {class: "pui-graph-port-in", text: String(inputs[row].label || inputs[row].id)}) : el("span");
        if (inputs[row]) inLabel.title = "in · " + String(inputs[row].type || "tex");
        var outLabel = outputs[row] ? el("span", {class: "pui-graph-port-out", text: String(outputs[row].label || outputs[row].id)}) : el("span");
        if (outputs[row]) outLabel.title = "out · " + String(outputs[row].type || "tex");
        line.appendChild(inLabel);
        line.appendChild(outLabel);
        ports.appendChild(line);
      }
      nodeEl.appendChild(ports);
      var paramDefs = type && isArray(type.params) ? type.params.filter(function (param) { return hiddenParams.indexOf(String(param.id)) < 0; }) : [];
      if (paramDefs.length) {
        var paramsEl = el("div", {class: "pui-graph-params"});
        var paramEls = [];
        paramDefs.forEach(function (param) {
          var raw = isObject(node.params) ? node.params[param.id] : undefined;
          var shown = raw === undefined ? (param.default === undefined ? "—" : param.default) : raw;
          var line = el("div", {class: "pui-graph-param-line"});
          line.appendChild(el("span", {class: "pui-graph-param-key", text: String(param.label || param.id) + ": "}));
          var numeric = ["float", "int", "f", "i"].indexOf(String(param.type || "float")) >= 0;
          var bounded = numeric && param.min !== undefined && param.max !== undefined && Number(param.max) > Number(param.min);
          var valueButton = el("button", {type: "button", class: "pui-graph-param-value" + (numeric ? " is-numeric" : "") + (bounded ? " is-bounded" : ""), "data-param-id": String(param.id)});
          if (bounded) {
            var track = el("span", {class: "pui-graph-param-track", "aria-hidden": "true"});
            track.appendChild(el("span", {class: "pui-graph-param-fill", "aria-hidden": "true"}));
            valueButton.appendChild(track);
          }
          valueButton.appendChild(el("span", {class: "pui-graph-param-number", text: String(shown)}));
          valueButton.setAttribute("aria-label", String(param.label || param.id) + " value " + String(shown));
          if (numeric) {
            valueButton.setAttribute("role", "slider");
            valueButton.setAttribute("aria-valuenow", String(Number(shown) || 0));
            if (param.min !== undefined) valueButton.setAttribute("aria-valuemin", String(param.min));
            if (param.max !== undefined) valueButton.setAttribute("aria-valuemax", String(param.max));
            valueButton.title = "Drag to adjust · Alt fine · Shift coarse · double-click reset";
            valueButton.addEventListener("pointerdown", function (event) { self.graphParamScrub(rec, node, param, event); });
            valueButton.addEventListener("keydown", function (event) { self.graphParamKey(rec, node, param, event); });
            valueButton.addEventListener("pointermove", function (event) { self.graphParamScrubMove(rec, event); });
            valueButton.addEventListener("pointerup", function (event) { self.graphParamScrubEnd(rec, event); });
            valueButton.addEventListener("pointercancel", function () { self.graphParamScrubEnd(rec, null); });
            valueButton.addEventListener("dblclick", function (event) {
              if (event.preventDefault) event.preventDefault();
              self.graphSetNodeParam(rec, node.id, param.id, param.default === undefined ? 0 : param.default);
            });
          }
          self.graphParamPaint(valueButton, param, shown);
          line.appendChild(valueButton);
          paramsEl.appendChild(line);
          paramEls.push(valueButton);
        });
        nodeEl.appendChild(paramsEl);
        rec.paramEls[id] = {defs: paramDefs, elements: paramEls};
      }
      if (typeof self.adapter.graphNodeBody === "function") {
        try {
          var customBody = self.adapter.graphNodeBody(node, type, rec.block, self);
          if (customBody && (customBody.nodeType || typeof customBody.tagName === "string")) {
            customBody.classList.add("pui-graph-node-body");
            if (self.graphOnParentSettings(node)) {
              var bodyWrap = el("div", {class: "pui-graph-node-bodies"});
              bodyWrap.appendChild(customBody);
              nodeEl.appendChild(bodyWrap);
              rec.bodyEls[id] = bodyWrap;
            } else {
              nodeEl.appendChild(customBody);
              rec.bodyEls[id] = customBody;
            }
          }
        } catch (error) {
          self.adapter.announce("error", "graph node body failed: " + String(error && error.message || error));
        }
      }
      var valueTexture = self.graphValueTexture(node, type);
      if (valueTexture) {
        nodeEl.classList.add("is-value-texture");
        var textureEl = self.graphValueTextureEl(node, valueTexture);
        var textureHost = rec.bodyEls[id] || nodeEl;
        textureHost.appendChild(textureEl);
        if (!rec.bodyEls[id]) rec.bodyEls[id] = textureEl;
      }
      var gopSettings = self.graphOnParentSettings(node);
      if (gopSettings) {
        var parentPreview = self.graphParentPreview(rec, node, gopSettings);
        if (parentPreview) {
          var bodyHost = rec.bodyEls[id] || nodeEl;
          bodyHost.appendChild(parentPreview);
          if (!rec.bodyEls[id]) rec.bodyEls[id] = parentPreview;
        }
      }
      var subgraphPath = typeof node.subgraph === "string" ? node.subgraph : "";
      if (subgraphPath) {
        nodeEl.classList.add("is-subgraph");
        nodeEl.setAttribute("data-subgraph", subgraphPath);
        nodeEl.title = "Double-click to enter subgraph";
        var openSubgraph = el("button", {type: "button", class: "pui-graph-open-subgraph", text: "Open subgraph"});
        openSubgraph.setAttribute("aria-label", "Open subgraph " + nodeLabel);
        openSubgraph.addEventListener("pointerdown", function (event) { if (event.stopPropagation) event.stopPropagation(); });
        openSubgraph.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          self.graphOpenSubgraph(rec, node);
        });
        nodeEl.appendChild(openSubgraph);
      }
      content.appendChild(nodeEl);
      nodeEls[id] = nodeEl;
      (function (nodeId, nodeElement) {
        nodeElement.addEventListener("pointerdown", function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          if (event.preventDefault) event.preventDefault();
          self.graphSelect(rec, nodeId, !!(event.shiftKey || event.metaKey || event.ctrlKey));
          rec.dragging = {start: deepClone(rec.graph), x: event.clientX || 0, y: event.clientY || 0, moved: false, ids: Object.keys(rec.selected), dx: 0, dy: 0};
          if (event.stopPropagation) event.stopPropagation();
        });
        nodeElement.addEventListener("click", function (event) {
          self.graphSelect(rec, nodeId, !!(event.shiftKey || event.metaKey || event.ctrlKey));
          if (event.stopPropagation) event.stopPropagation();
        });
        nodeElement.addEventListener("dblclick", function (event) {
          var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(nodeId); });
          if (!node || typeof node.subgraph !== "string" || !node.subgraph) return;
          if (event.target && event.target.closest && event.target.closest(".pui-graph-open-subgraph, .pui-graph-gop-enter")) return;
          if (event.preventDefault) event.preventDefault();
          self.graphOpenSubgraph(rec, node);
        });
        nodeElement.addEventListener("keydown", function (event) {
          if (String(event.key || "") !== "Enter") return;
          var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(nodeId); });
          if (!node || typeof node.subgraph !== "string" || !node.subgraph) return;
          if (event.preventDefault) event.preventDefault();
          if (event.stopPropagation) event.stopPropagation();
          self.graphOpenSubgraph(rec, node);
        });
      })(id, nodeEl);
    });
    cables.forEach(function (cable) {
      if (!isObject(cable)) return;
      var from = Graph.parseRef(cable.from);
      var to = Graph.parseRef(cable.to);
      if (!from || !to || !nodeEls[from.node] || !nodeEls[to.node]) return;
      var fromNode = nodes.find(function (node) { return String(node.id) === from.node; });
      var toNode = nodes.find(function (node) { return String(node.id) === to.node; });
      var a = Graph.portPosition(fromNode, typeMap[String(fromNode.type)], from.port, false, rec.metrics);
      var b = Graph.portPosition(toNode, typeMap[String(toNode.type)], to.port, true, rec.metrics);
      if (!a || !b) return;
      var p = Graph.cablePath(a, b);
      var cableType = Graph.portTypeOf(typeMap[String(fromNode.type)], from.port, false) || "tex";
      var crossType = Graph.crossType(cableType, Graph.portTypeOf(typeMap[String(toNode.type)], to.port, true));
      var path = svgEl("path", {
        class: "pui-graph-cable is-" + String(cableType).replace(/[^a-z0-9_-]/gi, "-") + (crossType === "pack" || crossType === "luma" ? " is-cross-type" : ""),
        "data-cable-id": String(cable.id || ""),
        "data-cable-type": String(cableType),
        "data-cross-type": crossType,
        d: "M " + p.x1 + " " + p.y1 + " C " + p.cx1 + " " + p.cy1 + " " + p.cx2 + " " + p.cy2 + " " + p.x2 + " " + p.y2
      });
      path.addEventListener("pointerdown", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        self.graphSelectCable(rec, cable);
      });
      cableGroup.appendChild(path);
      rec.cableRefs.push({el: path, cable: cable});
    });
    rec.guideLayer = el("div", {class: "pui-graph-guides"});
    content.appendChild(rec.guideLayer);
    viewport.appendChild(content);
    var bodyEl = el("div", {class: "pui-graph-body"});
    bodyEl.appendChild(viewport);
    var inspector = el("aside", {class: "pui-graph-inspector", "aria-label": "Node inspector"});
    bodyEl.appendChild(inspector);
    root.appendChild(bodyEl);
    rec.inspector = inspector;
    var minimap = el("div", {class: "pui-graph-minimap", "aria-label": "Graph minimap"});
    var minimapSvg = svgEl("svg", {viewBox: "0 0 180 120", role: "img", "aria-label": "Graph minimap"});
    minimap.appendChild(minimapSvg);
    viewport.appendChild(minimap);
    rec.minimap = {element: minimap, svg: minimapSvg};
    var view = isObject(graph.view) ? {
      zoom: Number(graph.view.zoom) > 0 ? Number(graph.view.zoom) : 1,
      panX: finiteNumber(graph.view.panX), panY: finiteNumber(graph.view.panY)
    } : {zoom: 1, panX: 0, panY: 0};
    rec.view = view;
    rec.renderMinimap = renderMinimap;
    rec.applyView = applyView;
    rec.__puiApplyBookmark = function (bookmark) {
      if (!isObject(bookmark)) return;
      view.zoom = Number(bookmark.zoom) > 0 ? Number(bookmark.zoom) : view.zoom;
      view.panX = finiteNumber(bookmark.panX);
      view.panY = finiteNumber(bookmark.panY);
      applyView();
    };
    function finiteNumber(value) { return typeof value === "number" && isFinite(value) ? value : 0; }
    function clientToGraph(event) {
      var box = viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : {left: 0, top: 0};
      return {
        x: ((event.clientX || 0) - box.left - view.panX) / view.zoom,
        y: ((event.clientY || 0) - box.top - view.panY) / view.zoom
      };
    }
    function renderMinimap() {
      if (!rec.minimap || !Graph) return;
      var bounds = Graph.graphBounds(rec.graph, rec.types);
      var pad = 32;
      var width = Math.max(180, bounds.w + pad * 2), height = Math.max(120, bounds.h + pad * 2);
      var aspect = 180 / 120;
      if (width / height > aspect) height = width / aspect;
      else width = height * aspect;
      var x1 = bounds.x1 + bounds.w / 2 - width / 2;
      var y1 = bounds.y1 + bounds.h / 2 - height / 2;
      rec.minimap.bounds = {x1: x1, y1: y1, w: width, h: height};
      rec.minimap.svg.setAttribute("viewBox", x1 + " " + y1 + " " + width + " " + height);
      rec.minimap.svg.textContent = "";
      (rec.graph.frames || []).forEach(function (frame) {
        if (!isObject(frame)) return;
        rec.minimap.svg.appendChild(svgEl("rect", {class: "pui-graph-mm-frame", x: Number(frame.x) || 0, y: Number(frame.y) || 0, width: Number(frame.w) || 0, height: Number(frame.h) || 0}));
      });
      (rec.graph.nodes || []).forEach(function (node) {
        var rect = self.graphNodeRect(rec, node);
        rec.minimap.svg.appendChild(svgEl("rect", {class: "pui-graph-mm-node", x: rect.x, y: rect.y, width: rect.w, height: rect.h}));
      });
      var vw = viewport.clientWidth || 800, vh = viewport.clientHeight || 500;
      rec.minimap.svg.appendChild(svgEl("rect", {class: "pui-graph-mm-view", x: -view.panX / view.zoom, y: -view.panY / view.zoom, width: vw / view.zoom, height: vh / view.zoom}));
      rec.minimap.svg.setAttribute("aria-label", "Graph minimap: " + (rec.graph.nodes || []).length + " nodes");
    }
    function applyView() {
      // The content layer owns the graph transform. Cables live inside it, so
      // applying the same transform to the SVG group would pan/scale them twice.
      content.style.transform = "translate(" + view.panX + "px," + view.panY + "px) scale(" + view.zoom + ")";
      if (cableGroup.getAttribute("transform")) cableGroup.removeAttribute("transform");
      if (rec.renderMinimap) rec.renderMinimap();
      self.graphCull(rec);
    }
    applyView();
    minimap.addEventListener("pointerdown", function (event) {
      if (!rec.minimap || !rec.minimap.bounds) return;
      if (event.stopPropagation) event.stopPropagation();
      var box = minimap.getBoundingClientRect ? minimap.getBoundingClientRect() : {left: 0, top: 0, width: 180, height: 120};
      var b = rec.minimap.bounds;
      var gx = b.x1 + ((event.clientX || 0) - box.left) / Math.max(1, box.width) * b.w;
      var gy = b.y1 + ((event.clientY || 0) - box.top) / Math.max(1, box.height) * b.h;
      var vw = viewport.clientWidth || 800, vh = viewport.clientHeight || 500;
      view.panX = vw / 2 - gx * view.zoom;
      view.panY = vh / 2 - gy * view.zoom;
      applyView();
    });
    var drag = null;
    viewport.addEventListener("wheel", function (event) {
      if (event.preventDefault) event.preventDefault();
      var factor = event.deltaY < 0 ? 1.1 : 0.9;
      var next = Math.max(0.2, Math.min(3, view.zoom * factor));
      var rect = viewport.getBoundingClientRect ? viewport.getBoundingClientRect() : {left: 0, top: 0};
      var sx = (event.clientX || 0) - rect.left;
      var sy = (event.clientY || 0) - rect.top;
      var gx = (sx - view.panX) / view.zoom;
      var gy = (sy - view.panY) / view.zoom;
      view.zoom = next;
      view.panX = sx - gx * next;
      view.panY = sy - gy * next;
      applyView();
    }, {passive: false});
    viewport.addEventListener("pointerdown", function (event) {
      if (event.target && event.target.closest && (event.target.closest(".pui-graph-node") || event.target.closest(".pui-graph-port-dot") || event.target.closest(".pui-graph-cable"))) return;
      if (event.shiftKey) {
        var start = clientToGraph(event);
        var box = el("div", {class: "pui-graph-marquee"});
        content.appendChild(box);
        rec.marquee = {start: start, element: box};
        if (event.preventDefault) event.preventDefault();
        return;
      }
      self.graphClearSelection(rec);
      drag = {x: event.clientX || 0, y: event.clientY || 0, panX: view.panX, panY: view.panY};
      if (viewport.setPointerCapture && event.pointerId !== undefined) viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener("pointermove", function (event) {
      if (rec.marquee) {
        var point = clientToGraph(event);
        var x1 = Math.min(rec.marquee.start.x, point.x);
        var y1 = Math.min(rec.marquee.start.y, point.y);
        var x2 = Math.max(rec.marquee.start.x, point.x);
        var y2 = Math.max(rec.marquee.start.y, point.y);
        rec.marquee.element.setAttribute("style", "left:" + x1 + "px;top:" + y1 + "px;width:" + (x2 - x1) + "px;height:" + (y2 - y1) + "px;");
        rec.marquee.box = {x1: x1, y1: y1, x2: x2, y2: y2};
        return;
      }
      if (rec.wiring) {
        var wirePoint = clientToGraph(event);
        self.graphUpdateWire(rec, wirePoint);
        return;
      }
      if (rec.frameResize) {
        var rdx = (event.clientX || 0) - rec.frameResize.x;
        var rdy = (event.clientY || 0) - rec.frameResize.y;
        var rw = Math.max(80, rec.frameResize.w + rdx);
        var rh = Math.max(60, rec.frameResize.h + rdy);
        rec.frameResize.frame.w = rw;
        rec.frameResize.frame.h = rh;
        self.updateGraphDom(rec);
        return;
      }
      if (rec.frameDrag) {
        var fdx = (event.clientX || 0) - rec.frameDrag.x;
        var fdy = (event.clientY || 0) - rec.frameDrag.y;
        if (!rec.frameDrag.moved && Math.abs(fdx) + Math.abs(fdy) < 2) return;
        rec.frameDrag.moved = true;
        var frameSnap = Number(rec.graphOptions.snap || 0);
        if (event.ctrlKey || event.metaKey) frameSnap = 0;
        var frameDx = 0, frameDy = 0;
        var startFrame = rec.frameDrag.start.frames.find(function (f) { return String(f.id) === String(rec.frameDrag.frame.id); });
        if (startFrame) {
          var frameX = (Number(startFrame.x) || 0) + fdx;
          var frameY = (Number(startFrame.y) || 0) + fdy;
          if (frameSnap > 0) {
            frameX = Math.round(frameX / frameSnap) * frameSnap;
            frameY = Math.round(frameY / frameSnap) * frameSnap;
          }
          rec.frameDrag.frame.x = frameX;
          rec.frameDrag.frame.y = frameY;
          frameDx = frameX - (Number(startFrame.x) || 0);
          frameDy = frameY - (Number(startFrame.y) || 0);
          var startNodes = rec.frameDrag.start.nodes || [];
          rec.frameDrag.ids.forEach(function (id) {
            var node = rec.graph.nodes.find(function (n) { return String(n.id) === String(id); });
            var startNode = startNodes.find(function (n) { return String(n.id) === String(id); });
            if (node && startNode) { node.x = (Number(startNode.x) || 0) + frameDx; node.y = (Number(startNode.y) || 0) + frameDy; }
          });
        }
        self.updateGraphDom(rec);
        return;
      }
      if (rec.dragging) {
        var dx = (event.clientX || 0) - rec.dragging.x;
        var dy = (event.clientY || 0) - rec.dragging.y;
        if (!rec.dragging.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
        rec.dragging.moved = true;
        rec.dragging.dx = dx;
        rec.dragging.dy = dy;
        var startNodes = rec.dragging.start.nodes || [];
        var snap = Number(rec.graphOptions.snap || 0);
        if (event.ctrlKey || event.metaKey) snap = 0;
        var aligned = self.graphAlign(rec, rec.dragging.start, rec.dragging.ids, dx, dy, 6 / Math.max(0.2, view.zoom));
        var alignedX = !!(aligned && aligned.x !== null && aligned.x !== undefined);
        var alignedY = !!(aligned && aligned.y !== null && aligned.y !== undefined);
        if (aligned) {
          dx = aligned.dx;
          dy = aligned.dy;
          rec.dragging.dx = dx;
          rec.dragging.dy = dy;
          self.graphDrawGuides(rec, aligned.x, aligned.y);
        } else {
          self.graphClearGuides(rec);
        }
        rec.dragging.ids.forEach(function (id) {
          var node = rec.graph.nodes.find(function (n) { return String(n.id) === String(id); });
          var start = startNodes.find(function (n) { return String(n.id) === String(id); });
          if (!node || !start) return;
          var x = (Number(start.x) || 0) + dx;
          var y = (Number(start.y) || 0) + dy;
          if (!alignedX && snap > 0) x = Math.round(x / snap) * snap;
          if (!alignedY && snap > 0) y = Math.round(y / snap) * snap;
          node.x = x;
          node.y = y;
        });
        self.updateGraphDom(rec);
        return;
      }
      if (!drag) return;
      view.panX = drag.panX + (event.clientX || 0) - drag.x;
      view.panY = drag.panY + (event.clientY || 0) - drag.y;
      applyView();
    });
    viewport.addEventListener("pointerup", function (event) {
      if (rec.frameResize) {
        var resized = rec.frameResize;
        rec.frameResize = null;
        self.graphPushUndo(rec, resized.start);
        self.writeGraph(rec, {op: "frame.resize", id: resized.frame.id, w: resized.frame.w, h: resized.frame.h});
        return;
      }
      if (rec.frameDrag) {
        var movedFrame = rec.frameDrag;
        rec.frameDrag = null;
        if (movedFrame.moved) {
          self.graphPushUndo(rec, movedFrame.start);
          self.writeGraph(rec, {op: "frame.move", id: movedFrame.frame.id, ids: movedFrame.ids});
        }
        return;
      }
      if (rec.marquee) {
        var box = rec.marquee.box;
        if (rec.marquee.element && rec.marquee.element.parentNode) rec.marquee.element.parentNode.removeChild(rec.marquee.element);
        rec.marquee = null;
        if (box) {
          var ids = [];
          rec.graph.nodes.forEach(function (node) {
            var rect = self.graphNodeRect(rec, node);
            if (rect.x + rect.w >= box.x1 && rect.x <= box.x2 && rect.y + rect.h >= box.y1 && rect.y <= box.y2) ids.push(String(node.id));
          });
          self.graphSetSelection(rec, ids);
        }
        return;
      }
      if (rec.wiring) {
        self.graphCancelWire(rec);
        return;
      }
      if (rec.dragging) {
        var finished = rec.dragging;
        rec.dragging = null;
        self.graphClearGuides(rec);
        if (finished.moved) {
          self.graphPushUndo(rec, finished.start);
          self.writeGraph(rec, {op: "node.move", ids: finished.ids, dx: finished.dx, dy: finished.dy});
        }
        return;
      }
      drag = null;
    });
    viewport.addEventListener("pointercancel", function () {
      if (rec.frameResize || rec.frameDrag) {
        rec.frameResize = null;
        rec.frameDrag = null;
        self.updateGraphDom(rec);
      }
      if (rec.dragging) {
        rec.graph = rec.dragging.start;
        rec.dragging = null;
        self.graphClearGuides(rec);
        self.updateGraphDom(rec);
      }
      drag = null;
    });
    viewport.addEventListener("keydown", function (event) {
      var key = String(event.key || "");
      if (key === "Enter") {
        var selectedIds = Object.keys(rec.selected || {});
        var selectedNode = selectedIds.length === 1 ? (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(selectedIds[0]); }) : null;
        if (selectedNode && typeof selectedNode.subgraph === "string" && selectedNode.subgraph) {
          event.preventDefault();
          self.graphOpenSubgraph(rec, selectedNode);
          return;
        }
      }
      if ((key === "u" || key === "U" || (event.altKey && key === "ArrowUp")) && rec.navStack.length > 1) {
        event.preventDefault();
        self.graphNavigate(rec, rec.navStack.length - 2);
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        event.preventDefault();
        self.graphDelete(rec);
      } else if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        var step = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
        var dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
        var dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
        self.graphMove(rec, dx, dy);
      } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) self.graphRedo(rec); else self.graphUndo(rec);
      } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "y") {
        event.preventDefault();
        self.graphRedo(rec);
      } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "p") {
        event.preventDefault();
        self.openGraphAdd(rec);
      } else if (key === "Escape") {
        self.graphCancelWire(rec);
        self.graphClearSelection(rec);
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey && key.toLowerCase() === "f") {
        event.preventDefault();
        self.graphFit(rec);
      } else if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "d") {
        event.preventDefault();
        self.graphDuplicate(rec);
      }
    });
    // Accessible graph outline is a first-class view, not a hidden fallback.
    var outline = el("details", {class: "pui-graph-outline"});
    outline.appendChild(el("summary", {text: "Graph outline"}));
    var list = el("ul");
    nodes.forEach(function (node) {
      if (!isObject(node)) return;
      var id = String(node.id || "");
      var type = typeMap[String(node.type)];
      var item = el("li");
      var button = el("button", {type: "button", class: "pui-graph-outline-node", text: String(node.label || (type && type.label) || id)});
      button.addEventListener("click", function () {
        if (nodeEls[id] && nodeEls[id].focus) nodeEls[id].focus();
      });
      item.appendChild(button);
      if (type) item.appendChild(el("span", {class: "pui-graph-outline-type", text: String(type.label || type.id)}));
      list.appendChild(item);
    });
    cables.forEach(function (cable) {
      if (!isObject(cable)) return;
      list.appendChild(el("li", {class: "pui-graph-outline-cable", text: String(cable.from) + " → " + String(cable.to)}));
    });
    if (!nodes.length) list.appendChild(el("li", {text: "No nodes."}));
    outline.appendChild(list);
    root.appendChild(outline);
    this.graphRenderBookmarks(rec);
    this.graphRenderPresets(rec);
    if (block.selection_bind) this.selectionRecords.push({owner: rec, refresh: function () { self.graphSelectionRefresh(rec); }});
    this.renderGraphInspector(rec);
    return root;
  };

  Renderer.prototype.graphClearGuides = function (rec) {
    if (!rec.guideLayer) return;
    rec.guideLayer.textContent = "";
  };

  Renderer.prototype.graphDrawGuides = function (rec, x, y) {
    if (!rec.guideLayer) return;
    var Graph = global.PupitreGraph;
    var bounds = Graph ? Graph.graphBounds(rec.graph, rec.types) : {x1: 0, y1: 0, h: 1000, w: 1000};
    rec.guideLayer.textContent = "";
    if (x !== null && x !== undefined) {
      rec.guideLayer.appendChild(el("span", {class: "pui-graph-guide-v", style: "left:" + x + "px;top:" + (bounds.y1 - 40) + "px;height:" + (bounds.h + 80) + "px;"}));
    }
    if (y !== null && y !== undefined) {
      rec.guideLayer.appendChild(el("span", {class: "pui-graph-guide-h", style: "top:" + y + "px;left:" + (bounds.x1 - 40) + "px;width:" + (bounds.w + 80) + "px;"}));
    }
  };

  Renderer.prototype.graphAlign = function (rec, snapshot, ids, dx, dy, threshold) {
    var self = this;
    var Graph = global.PupitreGraph;
    if (!Graph || !snapshot) return null;
    var selected = {};
    (ids || []).forEach(function (id) { selected[String(id)] = true; });
    var moving = (snapshot.nodes || []).filter(function (node) { return selected[String(node.id)]; }).map(function (node) {
      return {node: node, rect: self.graphNodeRect(rec, node)};
    });
    if (!moving.length) return null;
    var staticX = [], staticY = [];
    (rec.graph.nodes || []).forEach(function (node) {
      if (selected[String(node.id)]) return;
      var rect = self.graphNodeRect(rec, node);
      staticX.push(rect.x, rect.x + rect.w / 2, rect.x + rect.w);
      staticY.push(rect.y, rect.y + rect.h / 2, rect.y + rect.h);
    });
    (rec.graph.frames || []).forEach(function (frame) {
      staticX.push(Number(frame.x) || 0, (Number(frame.x) || 0) + (Number(frame.w) || 0) / 2, (Number(frame.x) || 0) + (Number(frame.w) || 0));
      staticY.push(Number(frame.y) || 0, (Number(frame.y) || 0) + (Number(frame.h) || 0) / 2, (Number(frame.y) || 0) + (Number(frame.h) || 0));
    });
    var bestX = null, bestY = null;
    moving.forEach(function (entry) {
      var rect = entry.rect;
      var edgesX = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
      var edgesY = [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
      staticX.forEach(function (target) {
        edgesX.forEach(function (edge) {
          var delta = target - (edge + dx);
          if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) bestX = {delta: delta, guide: target};
        });
      });
      staticY.forEach(function (target) {
        edgesY.forEach(function (edge) {
          var delta = target - (edge + dy);
          if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) bestY = {delta: delta, guide: target};
        });
      });
    });
    if (!bestX && !bestY) return null;
    return {dx: dx + (bestX ? bestX.delta : 0), dy: dy + (bestY ? bestY.delta : 0), x: bestX ? bestX.guide : null, y: bestY ? bestY.guide : null};
  };

  Renderer.prototype.graphSelectionRefresh = function (rec) {
    if (!rec || !rec.block.selection_bind || rec.dragging) return;
    var state = this.readSelection(String(rec.block.selection_bind), rec.block);
    rec.selected = {};
    state.ids.forEach(function (id) { rec.selected[id] = true; });
    rec.selectedCable = null;
    rec.selectedFrame = null;
    Object.keys(rec.frameEls || {}).forEach(function (id) { if (rec.frameEls[id].classList) rec.frameEls[id].classList.remove("is-selected"); });
    Object.keys(rec.nodeEls || {}).forEach(function (id) { if (rec.nodeEls[id].classList) rec.nodeEls[id].classList.toggle("is-selected", !!rec.selected[id]); });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphSelectFrame = function (rec, frame) {
    rec.selected = {};
    rec.selectedCable = null;
    rec.selectedFrame = frame;
    rec.nodeEls && Object.keys(rec.nodeEls).forEach(function (id) {
      if (rec.nodeEls[id] && rec.nodeEls[id].classList) rec.nodeEls[id].classList.remove("is-selected");
    });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    (Object.keys(rec.frameEls || {})).forEach(function (frameId) {
      if (rec.frameEls[frameId].classList) rec.frameEls[frameId].classList.toggle("is-selected", rec.frameEls[frameId] && String(frameId) === String(frame.id));
    });
    if (rec.block.selection_bind) this.writeSelection(rec, {ids: [], active: ""}, "frame", String(frame.title || frame.id || ""));
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphSetFrameField = function (rec, field, value) {
    if (!rec.selectedFrame) return false;
    var start = deepClone(rec.graph);
    rec.selectedFrame[field] = value;
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.writeGraph(rec, {op: "frame." + field, id: rec.selectedFrame.id, value: value});
    return true;
  };

  Renderer.prototype.graphFitFrame = function (rec) {
    var self = this;
    var frame = rec.selectedFrame;
    if (!frame) return false;
    var Graph = global.PupitreGraph;
    var nodes = this.graphFrameNodes(rec, frame);
    if (!nodes.length) return false;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    nodes.forEach(function (node) {
      var rect = self.graphNodeRect(rec, node);
      x1 = Math.min(x1, rect.x); y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.w); y2 = Math.max(y2, rect.y + rect.h);
    });
    var start = deepClone(rec.graph);
    frame.x = Math.round(x1 - 16);
    frame.y = Math.round(y1 - 32);
    frame.w = Math.round(x2 - x1 + 32);
    frame.h = Math.round(y2 - y1 + 48);
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.writeGraph(rec, {op: "frame.fit", id: frame.id});
    if (rec.inspector) this.renderGraphInspector(rec);
    return true;
  };

  Renderer.prototype.graphNavigate = function (rec, index) {
    var stack = (rec.navStack || []).slice(0, Math.max(0, index + 1));
    if (!stack.length || index >= (rec.navStack || []).length - 1) return false;
    var leaving = rec.navStack[rec.navStack.length - 1];
    this.rebuildGraph(rec, null, stack, {back: true, nodeId: leaving && leaving.nodeId});
    return true;
  };

  /** Parse the additive graph-on-parent contract. `graph_on_parent` may be
   * true or an object carrying the ROI/exposed list; the older
   * `graph_on_parent_rect` and `exposed_params` node keys remain supported. */
  Renderer.prototype.graphOnParentSettings = function (node) {
    if (!node || node.graph_on_parent === false) return null;
    var raw = node.graph_on_parent;
    var options = isObject(raw) ? raw : {};
    if (isObject(raw) && raw.enabled === false) return null;
    var rect = node.graph_on_parent_rect || options.rect || options.roi;
    if (!isObject(rect) && isObject(raw) && raw.x !== undefined && raw.y !== undefined) rect = raw;
    if (isObject(rect)) {
      var rx = Number(rect.x), ry = Number(rect.y), rw = Number(rect.w !== undefined ? rect.w : rect.width), rh = Number(rect.h !== undefined ? rect.h : rect.height);
      if (isFinite(rx) && isFinite(ry) && isFinite(rw) && isFinite(rh) && rw > 0 && rh > 0) {
        rect = {x: rx, y: ry, w: rw, h: rh};
      } else rect = null;
    } else rect = null;
    var exposed = node.exposed_params || options.exposed_params || options.exposed || [];
    if (!isArray(exposed)) exposed = [];
    exposed = exposed.map(function (entry) {
      if (typeof entry === "string") {
        var dot = entry.lastIndexOf(".");
        return dot > 0 ? {node: entry.slice(0, dot), param: entry.slice(dot + 1)} : null;
      }
      if (!isObject(entry)) return null;
      var nodeId = entry.node !== undefined ? entry.node : entry.nodeId;
      var paramId = entry.param !== undefined ? entry.param : entry.paramId;
      if (nodeId === undefined || paramId === undefined) return null;
      return {node: String(nodeId), param: String(paramId), label: entry.label ? String(entry.label) : ""};
    }).filter(Boolean);
    var enabled = raw === true || isObject(raw) || !!rect || exposed.length > 0;
    if (!enabled) return null;
    return {rect: rect, exposed: exposed, enabled: true};
  };

  /** Bounds using the measured node geometry (host bodies and graph-on-parent
   * previews included), unlike the pure model bounds. */
  Renderer.prototype.graphContentBounds = function (rec) {
    var self = this;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    (rec.graph.nodes || []).forEach(function (node) {
      if (!isObject(node)) return;
      var rect = self.graphNodeRect(rec, node);
      x1 = Math.min(x1, rect.x); y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.w); y2 = Math.max(y2, rect.y + rect.h);
    });
    (rec.graph.frames || []).forEach(function (frame) {
      if (!isObject(frame)) return;
      x1 = Math.min(x1, Number(frame.x) || 0); y1 = Math.min(y1, Number(frame.y) || 0);
      x2 = Math.max(x2, (Number(frame.x) || 0) + (Number(frame.w) || 0));
      y2 = Math.max(y2, (Number(frame.y) || 0) + (Number(frame.h) || 0));
    });
    if (!isFinite(x1)) return {x1: 0, y1: 0, w: 1, h: 1, x2: 1, y2: 1};
    return {x1: x1, y1: y1, x2: x2, y2: y2, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1)};
  };

  Renderer.prototype.graphViewForBounds = function (rec, bounds, pad) {
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 500};
    var w = Number(box.width) || 800, h = Number(box.height) || 500;
    pad = pad === undefined ? 40 : Number(pad) || 0;
    var bw = Math.max(1, Number(bounds.w) || 1), bh = Math.max(1, Number(bounds.h) || 1);
    var zoom = Math.min(2, Math.max(0.1, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
    return {
      zoom: zoom,
      panX: (w - bw * zoom) / 2 - (Number(bounds.x1) || 0) * zoom,
      panY: (h - bh * zoom) / 2 - (Number(bounds.y1) || 0) * zoom
    };
  };

  Renderer.prototype.graphViewForNode = function (rec, nodeId, scale) {
    var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(nodeId); });
    if (!node) return null;
    var rect = this.graphNodeRect(rec, node);
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 500};
    var w = Number(box.width) || 800, h = Number(box.height) || 500;
    var zoom = Math.max(0.2, Math.min(3, Number(scale) || 1));
    return {zoom: zoom, panX: w / 2 - (rect.x + rect.w / 2) * zoom, panY: h / 2 - (rect.y + rect.h / 2) * zoom};
  };

  Renderer.prototype.graphAnimateView = function (rec, start, target) {
    if (!rec || !rec.content || !target) return;
    if (!start) start = target;
    var finish = function () {
      rec.content.style.transition = "";
      rec.revealTimer = null;
    };
    rec.view.zoom = start.zoom;
    rec.view.panX = start.panX;
    rec.view.panY = start.panY;
    rec.content.style.transition = "none";
    rec.applyView();
    var raf = global.requestAnimationFrame;
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 0};
    if (typeof raf !== "function" || !box.width) {
      rec.view.zoom = target.zoom;
      rec.view.panX = target.panX;
      rec.view.panY = target.panY;
      rec.applyView();
      finish();
      return;
    }
    if (rec.revealTimer) clearTimeout(rec.revealTimer);
    raf(function () {
      rec.content.style.transition = "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      rec.view.zoom = target.zoom;
      rec.view.panX = target.panX;
      rec.view.panY = target.panY;
      rec.applyView();
      rec.revealTimer = setTimeout(finish, 280);
    });
  };

  Renderer.prototype.graphReveal = function (rec, reveal) {
    if (!rec || !reveal) return;
    var target = this.graphViewForBounds(rec, this.graphContentBounds(rec));
    if (reveal.back && reveal.nodeId) {
      var nodeView = this.graphViewForNode(rec, reveal.nodeId, Math.max(1.2, target.zoom * 1.8));
      this.graphAnimateView(rec, nodeView, target);
      return;
    }
    if (reveal.sourceRect && reveal.sourceRect.width && reveal.sourceRect.height) {
      var bounds = reveal.roi || this.graphContentBounds(rec);
      var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {left: 0, top: 0};
      var zoom = Math.max(0.1, Math.min(3, Math.min(reveal.sourceRect.width / Math.max(1, bounds.w), reveal.sourceRect.height / Math.max(1, bounds.h))));
      var start = {
        zoom: zoom,
        panX: reveal.sourceRect.left - box.left - bounds.x1 * zoom,
        panY: reveal.sourceRect.top - box.top - bounds.y1 * zoom
      };
      this.graphAnimateView(rec, start, this.graphViewForBounds(rec, bounds));
    }
  };

  Renderer.prototype.graphCurrentViewBounds = function (rec) {
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 500};
    var zoom = rec.view.zoom || 1;
    return {x1: -rec.view.panX / zoom, y1: -rec.view.panY / zoom, w: (box.width || 800) / zoom, h: (box.height || 500) / zoom};
  };

  Renderer.prototype.graphSelectedContentBounds = function (rec) {
    var self = this;
    var ids = Object.keys(rec.selected || {});
    if (!ids.length) return null;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ids.forEach(function (id) {
      var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(id); });
      if (!node) return;
      var rect = self.graphNodeRect(rec, node);
      x1 = Math.min(x1, rect.x); y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.w); y2 = Math.max(y2, rect.y + rect.h);
    });
    if (!isFinite(x1)) return null;
    return {x1: x1, y1: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1)};
  };

  Renderer.prototype.graphParentIntent = function (rec, intent) {
    if (typeof this.adapter.graphOnParentAction !== "function") {
      this.adapter.announce("warning", "The host does not expose graph-on-parent edits.");
      return false;
    }
    try { return this.adapter.graphOnParentAction(intent, rec.block) !== false; }
    catch (error) { this.adapter.announce("error", "Graph-on-parent edit failed: " + String(error && error.message || error)); return false; }
  };

  Renderer.prototype.graphSetParentRoi = function (rec) {
    var nav = rec.navStack || [];
    if (nav.length < 2) return false;
    var current = nav[nav.length - 1], parent = nav[nav.length - 2];
    var bounds = this.graphSelectedContentBounds(rec) || this.graphCurrentViewBounds(rec);
    return this.graphParentIntent(rec, {op: "set_roi", graphPath: parent.path, nodeId: current.nodeId, roi: bounds});
  };

  Renderer.prototype.graphClearParentRoi = function (rec) {
    var nav = rec.navStack || [];
    if (nav.length < 2) return false;
    return this.graphParentIntent(rec, {op: "clear_roi", graphPath: nav[nav.length - 2].path, nodeId: nav[nav.length - 1].nodeId});
  };

  Renderer.prototype.graphExposeSelected = function (rec) {
    var nav = rec.navStack || [];
    if (nav.length < 2) return false;
    var exposed = [];
    Object.keys(rec.selected || {}).forEach(function (id) {
      var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(id); });
      if (!node) return;
      var type = rec.typeMap[String(node.type)];
      (type && isArray(type.params) ? type.params : []).forEach(function (param) {
        exposed.push({node: String(node.id), param: String(param.id), label: String(param.label || param.id)});
      });
    });
    if (!exposed.length) {
      this.adapter.announce("warning", "Select an inner node with parameters before exposing.");
      return false;
    }
    return this.graphParentIntent(rec, {op: "expose", graphPath: nav[nav.length - 2].path, nodeId: nav[nav.length - 1].nodeId, exposed: exposed});
  };

  Renderer.prototype.graphExposedSet = function (rec, node, entry, value) {
    var nested = this.adapter.getValue(node.subgraph);
    if (!isObject(nested)) return false;
    var copy = deepClone(nested);
    var inner = (copy.nodes || []).find(function (item) { return String(item.id) === String(entry.node); });
    if (!inner) return false;
    if (!isObject(inner.params)) inner.params = {};
    inner.params[entry.param] = value;
    var intent = {op: "exposed.set", graphPath: rec.graphPath, nodeId: node.id, subgraphPath: node.subgraph, innerNodeId: entry.node, paramId: entry.param, value: value};
    if (typeof this.adapter.graphOnParentAction === "function") return this.graphParentIntent(rec, intent);
    if (typeof this.adapter.setValue === "function") return this.adapter.setValue(node.subgraph, copy, rec.block) !== false;
    this.adapter.announce("warning", "The host does not expose graph-on-parent writes.");
    return false;
  };

  Renderer.prototype.graphParentPreview = function (rec, node, settings) {
    var self = this;
    var Graph = global.PupitreGraph;
    if (!Graph || !settings) return null;
    var nested = this.adapter.getValue(node.subgraph);
    var preview = el("div", {class: "pui-graph-gop", "data-graph-on-parent": String(node.subgraph || ""), role: "group", "aria-label": "Graph on parent · " + String(node.label || node.id || "subgraph")});
    var head = el("div", {class: "pui-graph-gop-head"});
    head.appendChild(el("span", {class: "pui-graph-gop-title", text: "Graph on parent"}));
    var gopCount = String((nested && nested.nodes || []).length || 0) + " nodes";
    if (settings.rect) gopCount += " · ROI " + Math.round(settings.rect.w) + "×" + Math.round(settings.rect.h);
    head.appendChild(el("span", {class: "pui-graph-gop-count", text: gopCount}));
    var enter = el("button", {type: "button", class: "pui-graph-gop-enter", text: "Enter"});
    enter.setAttribute("aria-label", "Enter subgraph " + String(node.label || node.id || ""));
    enter.addEventListener("pointerdown", function (event) { if (event.stopPropagation) event.stopPropagation(); });
    enter.addEventListener("click", function (event) {
      if (event.stopPropagation) event.stopPropagation();
      self.graphOpenSubgraph(rec, node);
    });
    head.appendChild(enter);
    preview.appendChild(head);
    if (!isObject(nested)) {
      preview.appendChild(el("p", {class: "pui-graph-gop-missing", text: "(subgraph missing)"}));
      return preview;
    }
    var bounds = settings.rect || Graph.graphBounds(nested, rec.types);
    var map = el("div", {class: "pui-graph-gop-map"});
    var svg = svgEl("svg", {class: "pui-graph-gop-svg", viewBox: bounds.x1 + " " + bounds.y1 + " " + Math.max(1, bounds.w) + " " + Math.max(1, bounds.h), preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Interior of " + String(node.label || node.id || "subgraph")});
    (nested.frames || []).forEach(function (frame) {
      if (!isObject(frame)) return;
      svg.appendChild(svgEl("rect", {class: "pui-graph-gop-frame", x: Number(frame.x) || 0, y: Number(frame.y) || 0, width: Number(frame.w) || 0, height: Number(frame.h) || 0}));
    });
    var nestedTypes = rec.typeMap || {};
    var nestedNodes = (nested.nodes || []).filter(isObject);
    nestedNodes.forEach(function (inner) {
      var type = nestedTypes[String(inner.type)];
      var rect = Graph.nodeRect(inner, type, rec.metrics);
      var group = svgEl("g", {class: "pui-graph-gop-node" + (inner.enabled === false ? " is-disabled" : ""), "data-inner-node-id": String(inner.id || "")});
      group.appendChild(svgEl("rect", {x: rect.x, y: rect.y, width: rect.w, height: rect.h}));
      var label = String(inner.label || (type && type.label) || inner.id || inner.type || "node");
      var text = svgEl("text", {x: rect.x + 6, y: rect.y + 13});
      text.textContent = label.length > 20 ? label.slice(0, 19) + "…" : label;
      group.appendChild(text);
      svg.appendChild(group);
    });
    (nested.cables || []).forEach(function (cable) {
      if (!isObject(cable)) return;
      var from = Graph.parseRef(cable.from), to = Graph.parseRef(cable.to);
      if (!from || !to) return;
      var fromNode = nestedNodes.find(function (item) { return String(item.id) === from.node; });
      var toNode = nestedNodes.find(function (item) { return String(item.id) === to.node; });
      if (!fromNode || !toNode) return;
      var a = Graph.portPosition(fromNode, nestedTypes[String(fromNode.type)], from.port, false, rec.metrics);
      var b = Graph.portPosition(toNode, nestedTypes[String(toNode.type)], to.port, true, rec.metrics);
      if (!a || !b) return;
      var p = Graph.cablePath(a, b);
      svg.appendChild(svgEl("path", {class: "pui-graph-gop-cable", d: "M " + p.x1 + " " + p.y1 + " C " + p.cx1 + " " + p.cy1 + " " + p.cx2 + " " + p.cy2 + " " + p.x2 + " " + p.y2}));
    });
    map.appendChild(svg);
    if (settings.rect) map.appendChild(el("span", {class: "pui-graph-gop-roi-label", text: "ROI " + Math.round(settings.rect.x) + "," + Math.round(settings.rect.y) + " · " + Math.round(settings.rect.w) + "×" + Math.round(settings.rect.h)}));
    preview.appendChild(map);
    preview.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest(".pui-graph-gop-exposed, .pui-graph-gop-enter")) return;
      if (event.stopPropagation) event.stopPropagation();
      self.graphOpenSubgraph(rec, node);
    });
    preview.addEventListener("dblclick", function (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
      self.graphOpenSubgraph(rec, node);
    });
    if (settings.exposed.length) {
      var strip = el("div", {class: "pui-graph-gop-exposed", "aria-label": "Exposed parameters"});
      strip.appendChild(el("span", {class: "pui-graph-gop-exposed-title", text: "Exposed"}));
      settings.exposed.forEach(function (entry) {
        var inner = nestedNodes.find(function (item) { return String(item.id) === entry.node; });
        var type = inner && rec.typeMap[String(inner.type)];
        var param = type && isArray(type.params) ? type.params.find(function (item) { return String(item.id) === entry.param; }) : null;
        if (!inner || !param) return;
        var value = isObject(inner.params) && inner.params[entry.param] !== undefined ? inner.params[entry.param] : param.default;
        var row = el("label", {class: "pui-graph-gop-param", "data-exposed-node": String(entry.node), "data-exposed-param": String(entry.param)});
        row.appendChild(el("span", {class: "pui-graph-gop-param-label", text: String(entry.label || param.label || entry.param)}));
        var commit = function (next) { self.graphExposedSet(rec, node, entry, next); };
        var numberType = ["float", "int", "f", "i"].indexOf(String(param.type || "float")) >= 0;
        if (numberType && param.min !== undefined && param.max !== undefined && Number(param.max) > Number(param.min)) {
          var slider = el("input", {type: "range", class: "pui-graph-gop-range"});
          slider.min = String(param.min); slider.max = String(param.max); slider.step = String(param.step || 0.01);
          slider.value = String(Number(value) || 0);
          slider.setAttribute("aria-label", String(entry.label || param.label || entry.param));
          var output = el("output", {class: "pui-graph-gop-value", text: String(value)});
          slider.addEventListener("pointerdown", function (event) { if (event.stopPropagation) event.stopPropagation(); });
          slider.addEventListener("input", function () { output.textContent = slider.value; commit(Number(slider.value)); });
          row.appendChild(slider); row.appendChild(output);
        } else if (String(param.type) === "enum" && isArray(param.options)) {
          var select = el("select", {class: "pui-graph-gop-select", "aria-label": String(entry.label || param.label || entry.param)});
          param.options.forEach(function (option) {
            var entryValue = isObject(option) ? option.value : option;
            select.appendChild(el("option", {value: String(entryValue), text: String(isObject(option) ? option.label : option)}));
          });
          select.value = String(value);
          select.addEventListener("change", function () { commit(select.value); });
          row.appendChild(select);
        } else if (String(param.type) === "color") {
          var color = el("input", {type: "color", class: "pui-graph-gop-color", "aria-label": String(entry.label || param.label || entry.param)});
          color.value = String(value || "#ffffff").slice(0, 7);
          color.addEventListener("input", function () { commit(color.value); });
          row.appendChild(color);
        } else {
          row.appendChild(el("output", {class: "pui-graph-gop-value", text: String(value === undefined ? "—" : value)}));
        }
        strip.appendChild(row);
      });
      preview.appendChild(strip);
    }
    return preview;
  };

  Renderer.prototype.graphOpenSubgraph = function (rec, node) {
    if (!node || typeof node.subgraph !== "string" || !node.subgraph) return false;
    var nested = this.adapter.getValue(node.subgraph);
    if (!isObject(nested)) {
      this.adapter.announce("error", "Subgraph is missing: " + node.subgraph);
      return false;
    }
    var stack = (rec.navStack || []).slice();
    if (stack.some(function (entry) { return entry.path === node.subgraph; })) return false;
    var nodeEl = rec.nodeEls && rec.nodeEls[String(node.id)];
    var sourceRect = nodeEl && nodeEl.getBoundingClientRect ? nodeEl.getBoundingClientRect() : null;
    var settings = this.graphOnParentSettings(node);
    stack.push({path: node.subgraph, label: String(node.label || node.id || "Subgraph"), nodeId: String(node.id || "")});
    this.rebuildGraph(rec, null, stack, {sourceRect: sourceRect, roi: settings && settings.rect, nodeId: String(node.id || "")});
    return true;
  };

  Renderer.prototype.graphFrameNodes = function (rec, frame) {
    var self = this;
    var Graph = global.PupitreGraph;
    if (!Graph || !frame) return [];
    if (isArray(frame.members)) {
      var wanted = {};
      frame.members.forEach(function (id) { wanted[String(id)] = true; });
      return (rec.graph.nodes || []).filter(function (node) { return wanted[String(node.id)]; });
    }
    return (rec.graph.nodes || []).filter(function (node) {
      var rect = self.graphNodeRect(rec, node);
      var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
      return cx >= Number(frame.x) && cx <= Number(frame.x) + Number(frame.w) && cy >= Number(frame.y) && cy <= Number(frame.y) + Number(frame.h);
    });
  };

  Renderer.prototype.graphGroupSelection = function (rec) {
    if (rec.block.readonly) return null;
    var self = this;
    var Graph = global.PupitreGraph;
    var nodes = (rec.graph.nodes || []).filter(function (node) { return rec.selected[String(node.id)]; });
    var ids = nodes.map(function (node) { return String(node.id); });
    if (!Graph || !ids.length) return null;
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    nodes.forEach(function (node) {
      var rect = self.graphNodeRect(rec, node);
      x1 = Math.min(x1, rect.x); y1 = Math.min(y1, rect.y);
      x2 = Math.max(x2, rect.x + rect.w); y2 = Math.max(y2, rect.y + rect.h);
    });
    var index = 1;
    while ((rec.graph.frames || []).some(function (frame) { return String(frame.id) === "f" + index; })) index++;
    var frame = {
      id: "f" + index,
      x: Math.round(x1 - 20), y: Math.round(y1 - 42),
      w: Math.max(120, Math.round(x2 - x1 + 40)), h: Math.max(100, Math.round(y2 - y1 + 60)),
      title: "Group " + index, members: ids
    };
    var start = deepClone(rec.graph);
    rec.graph.frames = (rec.graph.frames || []).concat([frame]);
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "frame.add", id: frame.id, members: ids});
    this.rebuildGraph(rec);
    var newRec = this.graphRecords[this.graphRecords.length - 1];
    if (newRec) {
      var created = (newRec.graph.frames || []).filter(function (item) { return String(item.id) === String(frame.id); })[0];
      if (created) this.graphSelectFrame(newRec, created);
    }
    return frame.id;
  };

  Renderer.prototype.graphSelectFrameMembers = function (rec) {
    if (!rec.selectedFrame) return false;
    var ids = this.graphFrameNodes(rec, rec.selectedFrame).map(function (node) { return String(node.id); });
    rec.selected = {};
    ids.forEach(function (id) { rec.selected[id] = true; });
    rec.selectedFrame = null;
    rec.selectedCable = null;
    Object.keys(rec.frameEls || {}).forEach(function (id) { if (rec.frameEls[id].classList) rec.frameEls[id].classList.remove("is-selected"); });
    Object.keys(rec.nodeEls || {}).forEach(function (id) { if (rec.nodeEls[id].classList) rec.nodeEls[id].classList.toggle("is-selected", !!rec.selected[id]); });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    if (rec.block.selection_bind && rec.graphPath === String(rec.block.bind || "")) this.writeSelection(rec, {ids: ids, active: ids[0] || ""}, "node", "");
    this.renderGraphInspector(rec);
    return true;
  };

  Renderer.prototype.graphSnapshot = function (rec) {
    return {
      nodes: deepClone(rec.graph.nodes || []),
      cables: deepClone(rec.graph.cables || []),
      frames: deepClone(rec.graph.frames || []),
      output: rec.graph.output
    };
  };

  /** Optional visual culling: graph content outside the viewport (plus a
   * margin) is removed from layout/paint. The DOM stays in place so cables,
   * selection, focus and the host model are unchanged. Opt in with
   * `graph_options.culling:true`; `cull_margin` defaults to 240 graph units. */
  Renderer.prototype.graphCull = function (rec) {
    if (!rec || !rec.graphOptions || rec.graphOptions.culling !== true || !rec.viewport) return;
    var self = this;
    var Graph = global.PupitreGraph;
    if (!Graph) return;
    var view = rec.view || {zoom: 1, panX: 0, panY: 0};
    var margin = Number(rec.graphOptions.cull_margin);
    if (!isFinite(margin) || margin < 0) margin = 240;
    var vw = rec.viewport.clientWidth || 800, vh = rec.viewport.clientHeight || 500;
    var x1 = -view.panX / view.zoom - margin, y1 = -view.panY / view.zoom - margin;
    var x2 = x1 + vw / view.zoom + margin * 2, y2 = y1 + vh / view.zoom + margin * 2;
    var visible = {};
    (rec.graph.nodes || []).forEach(function (node) {
      if (!isObject(node)) return;
      var id = String(node.id || "");
      var rect = self.graphNodeRect(rec, node);
      var on = rect.x + rect.w >= x1 && rect.x <= x2 && rect.y + rect.h >= y1 && rect.y <= y2;
      visible[id] = on;
      var el = rec.nodeEls[id];
      if (el) el.style.display = on || rec.selected[id] ? "" : "none";
    });
    (rec.graph.frames || []).forEach(function (frame) {
      if (!isObject(frame)) return;
      var el = rec.frameEls[String(frame.id || "")];
      if (!el) return;
      var on = Number(frame.x) + Number(frame.w) >= x1 && Number(frame.x) <= x2
        && Number(frame.y) + Number(frame.h) >= y1 && Number(frame.y) <= y2;
      el.style.display = on ? "" : "none";
    });
    (rec.cableRefs || []).forEach(function (entry) {
      if (!entry || !entry.el || !entry.cable) return;
      var from = Graph.parseRef(entry.cable.from), to = Graph.parseRef(entry.cable.to);
      var on = (from && visible[from.node] !== false) || (to && visible[to.node] !== false);
      entry.el.style.display = on ? "" : "none";
    });
  };

  Renderer.prototype.graphRenderPresets = function (rec) {
    if (!rec.presetsBar) return;
    var self = this;
    rec.presetsBar.textContent = "";
    var presets = isArray(rec.graph.presets) ? rec.graph.presets : [];
    if (!rec.block.readonly) {
      var name = el("input", {type: "text", class: "pui-graph-preset-name", placeholder: "Preset name", "aria-label": "Preset name"});
      rec.presetName = name;
      rec.presetsBar.appendChild(name);
      var save = el("button", {type: "button", class: "pui-button", text: "Save preset"});
      save.addEventListener("click", function () { self.graphSavePreset(rec); });
      rec.presetsBar.appendChild(save);
    }
    presets.forEach(function (preset) {
      if (!isObject(preset)) return;
      var chip = el("span", {class: "pui-graph-preset"});
      var recall = el("button", {type: "button", class: "pui-graph-preset-recall", text: String(preset.label || preset.id || "Preset")});
      recall.addEventListener("click", function () { self.graphRecallPreset(rec, preset.id); });
      chip.appendChild(recall);
      if (!rec.block.readonly) {
        var remove = el("button", {type: "button", class: "pui-graph-preset-delete", text: "×", "aria-label": "Delete preset " + String(preset.label || preset.id || "")});
        remove.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          self.graphDeletePreset(rec, preset.id);
        });
        chip.appendChild(remove);
      }
      rec.presetsBar.appendChild(chip);
    });
    if (!rec.block.readonly && presets.length) {
      var morph = el("span", {class: "pui-graph-morph"});
      var from = el("select", {"aria-label": "Morph from preset"});
      var to = el("select", {"aria-label": "Morph to preset"});
      presets.forEach(function (preset) {
        from.appendChild(el("option", {value: String(preset.id), text: String(preset.label || preset.id)}));
        to.appendChild(el("option", {value: String(preset.id), text: String(preset.label || preset.id)}));
      });
      if (presets.some(function (preset) { return String(preset.id) === String(rec.morphA); })) from.value = String(rec.morphA);
      else from.value = String(presets[0].id);
      if (presets.some(function (preset) { return String(preset.id) === String(rec.morphB); })) to.value = String(rec.morphB);
      else to.value = String(presets[presets.length - 1].id);
      if (presets.length > 1 && from.value === to.value) to.value = String(presets[presets.length - 1].id);
      rec.morphA = from.value;
      rec.morphB = to.value;
      from.addEventListener("change", function () { rec.morphA = from.value; });
      to.addEventListener("change", function () { rec.morphB = to.value; });
      morph.appendChild(el("span", {class: "pui-graph-morph-label", text: "Morph"}));
      morph.appendChild(from);
      morph.appendChild(to);
      var morphButton = el("button", {type: "button", class: "pui-button", text: "Morph"});
      morphButton.addEventListener("click", function () { self.graphMorphPresets(rec, from.value, to.value); });
      morph.appendChild(morphButton);
      rec.presetsBar.appendChild(morph);
    }
  };

  Renderer.prototype.graphSavePreset = function (rec) {
    if (rec.block.readonly) return null;
    var presets = isArray(rec.graph.presets) ? rec.graph.presets : [];
    var index = 1;
    while (presets.some(function (preset) { return String(preset.id) === "p" + index; })) index++;
    var label = rec.presetName && String(rec.presetName.value || "").trim();
    if (!label) label = "Preset " + index;
    var start = deepClone(rec.graph);
    presets.push({id: "p" + index, label: label, graph: this.graphSnapshot(rec)});
    rec.graph.presets = presets;
    rec.presetName && (rec.presetName.value = "");
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "preset.save", id: "p" + index, label: label});
    this.graphRenderPresets(rec);
    return "p" + index;
  };

  Renderer.prototype.graphRecallPreset = function (rec, id) {
    if (rec.block.readonly) return false;
    var preset = (isArray(rec.graph.presets) ? rec.graph.presets : []).find(function (item) { return String(item.id) === String(id); });
    if (!preset || !isObject(preset.graph) || !isArray(preset.graph.nodes) || !isArray(preset.graph.cables)) return false;
    var Graph = global.PupitreGraph;
    if (Graph && Graph.validateGraph({nodes: preset.graph.nodes, cables: preset.graph.cables, frames: preset.graph.frames || [], output: preset.graph.output}, rec.types).some(function (issue) { return issue.level === "error"; })) return false;
    var start = deepClone(rec.graph);
    rec.graph.nodes = deepClone(preset.graph.nodes);
    rec.graph.cables = deepClone(preset.graph.cables);
    rec.graph.frames = deepClone(preset.graph.frames || []);
    rec.graph.output = preset.graph.output;
    rec.selected = {};
    rec.selectedFrame = null;
    rec.selectedCable = null;
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "preset.recall", id: String(id)});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphDeletePreset = function (rec, id) {
    if (rec.block.readonly) return false;
    var start = deepClone(rec.graph);
    rec.graph.presets = (isArray(rec.graph.presets) ? rec.graph.presets : []).filter(function (preset) { return String(preset.id) !== String(id); });
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "preset.delete", id: String(id)});
    this.graphRenderPresets(rec);
    return true;
  };

  Renderer.prototype.graphMorphPresets = function (rec, fromId, toId) {
    if (rec.block.readonly) return false;
    var from = (isArray(rec.graph.presets) ? rec.graph.presets : []).find(function (preset) { return String(preset.id) === String(fromId); });
    var to = (isArray(rec.graph.presets) ? rec.graph.presets : []).find(function (preset) { return String(preset.id) === String(toId); });
    if (!from || !to || typeof this.adapter.graphAction !== "function") {
      this.adapter.announce("warning", "Host does not expose graph morph.");
      return false;
    }
    var result = this.adapter.graphAction({op: "preset.morph", from: String(fromId), to: String(toId), duration: 1, easing: "smoothstep"}, rec.graph, rec.block);
    if (result === false) return false;
    this.adapter.announce("info", "Morphing " + String(from.label || fromId) + " → " + String(to.label || toId) + ".");
    return true;
  };

  Renderer.prototype.graphBookmarks = function (rec) {
    return rec.graph && isObject(rec.graph.view) && isArray(rec.graph.view.bookmarks) ? rec.graph.view.bookmarks : [];
  };

  Renderer.prototype.graphRenderBookmarks = function (rec) {
    if (!rec.bookmarkBar) return;
    rec.bookmarkBar.textContent = "";
    this.graphBookmarks(rec).forEach(function (bookmark) {
      if (!isObject(bookmark)) return;
      var button = el("button", {type: "button", class: "pui-graph-bookmark", text: String(bookmark.label || bookmark.id || "View")});
      button.setAttribute("aria-label", "Restore " + String(bookmark.label || bookmark.id || "bookmark"));
      button.addEventListener("click", function () { rec.__puiApplyBookmark(bookmark); });
      rec.bookmarkBar.appendChild(button);
    });
  };

  Renderer.prototype.graphSaveBookmark = function (rec) {
    if (rec.block.readonly) return null;
    var start = deepClone(rec.graph);
    if (!isObject(rec.graph.view)) rec.graph.view = {zoom: 1, panX: 0, panY: 0};
    if (!isArray(rec.graph.view.bookmarks)) rec.graph.view.bookmarks = [];
    var index = 1;
    while (rec.graph.view.bookmarks.some(function (bookmark) { return String(bookmark.id) === "b" + index; })) index++;
    var bookmark = {id: "b" + index, label: "View " + index, zoom: rec.view.zoom, panX: rec.view.panX, panY: rec.view.panY};
    rec.graph.view.bookmarks.push(bookmark);
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "view.bookmark", id: bookmark.id});
    this.graphRenderBookmarks(rec);
    return bookmark.id;
  };

  Renderer.prototype.graphFit = function (rec) {
    if (!rec || !rec.viewport) return;
    var view = this.graphViewForBounds(rec, this.graphContentBounds(rec));
    rec.view.zoom = view.zoom;
    rec.view.panX = view.panX;
    rec.view.panY = view.panY;
    rec.applyView();
  };

  Renderer.prototype.graphDuplicate = function (rec) {
    if (!rec || rec.block.readonly) return false;
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var nodes = rec.graph.nodes || [];
    var idMap = {};
    var newNodes = [];
    ids.forEach(function (id) {
      var node = nodes.find(function (item) { return String(item.id) === String(id); });
      if (!node) return;
      var next = String(id) + "-copy";
      var index = 2;
      while (nodes.some(function (item) { return String(item.id) === next; }) || newNodes.some(function (item) { return String(item.id) === next; })) next = String(id) + "-copy" + (index++);
      idMap[String(id)] = next;
      var copy = deepClone(node);
      copy.id = next;
      copy.x = Number(node.x) + 24;
      copy.y = Number(node.y) + 24;
      newNodes.push(copy);
    });
    if (!newNodes.length) return false;
    var start = deepClone(rec.graph);
    var newCables = [];
    (rec.graph.cables || []).forEach(function (cable) {
      var from = global.PupitreGraph.parseRef(cable.from);
      var to = global.PupitreGraph.parseRef(cable.to);
      if (!from || !to || !idMap[from.node] || !idMap[to.node]) return;
      var copy = deepClone(cable);
      copy.id = String(cable.id || "cable") + "-copy" + (newCables.length ? "-" + (newCables.length + 1) : "");
      copy.from = idMap[from.node] + "." + from.port;
      copy.to = idMap[to.node] + "." + to.port;
      newCables.push(copy);
    });
    rec.graph.nodes = nodes.concat(newNodes);
    rec.graph.cables = (rec.graph.cables || []).concat(newCables);
    rec.selected = {};
    Object.keys(idMap).forEach(function (id) { rec.selected[idMap[id]] = true; });
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "node.duplicate", ids: Object.keys(idMap), copies: Object.keys(idMap).map(function (id) { return idMap[id]; })});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphAddFrame = function (rec) {
    if (rec.block.readonly) return null;
    var index = 1;
    while ((rec.graph.frames || []).some(function (frame) { return String(frame.id) === "f" + index; })) index++;
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 500};
    var view = rec.view || {zoom: 1, panX: 0, panY: 0};
    var x = Math.round(((box.width || 800) / 2 - (view.panX || 0)) / (view.zoom || 1) - 140);
    var y = Math.round(((box.height || 500) / 2 - (view.panY || 0)) / (view.zoom || 1) - 90);
    var frame = {id: "f" + index, x: x, y: y, w: 280, h: 180, title: "Frame " + index};
    var start = deepClone(rec.graph);
    rec.graph.frames = (rec.graph.frames || []).concat([frame]);
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "frame.add", id: frame.id});
    this.rebuildGraph(rec);
    return frame.id;
  };

  Renderer.prototype.graphRefreshIssues = function (rec) {
    var Graph = global.PupitreGraph;
    if (!Graph) return;
    rec.issues = Graph.validateGraph(rec.graph, rec.types);
    var errors = rec.issues.filter(function (issue) { return issue.level === "error"; }).length;
    if (rec.issueEl) {
      rec.issueEl.textContent = rec.issues.length + " issue" + (rec.issues.length === 1 ? "" : "s");
      if (rec.issues.length) rec.issueEl.classList.toggle("is-error", errors > 0);
      else { rec.issueEl.remove(); rec.issueEl = null; }
    } else if (rec.issues.length && rec.head) {
      rec.issueEl = el("span", {class: "pui-graph-issues" + (errors ? " is-error" : ""), text: rec.issues.length + " issue" + (rec.issues.length === 1 ? "" : "s")});
      rec.head.appendChild(rec.issueEl);
    }
  };

  Renderer.prototype.graphSetParam = function (rec, paramId, value) {
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var start = deepClone(rec.graph);
    rec.graph.nodes.forEach(function (node) {
      if (!rec.selected[String(node.id)]) return;
      var type = rec.typeMap[String(node.type)];
      if (!type || !(type.params || []).some(function (param) { return String(param.id) === String(paramId); })) return;
      node.params = isObject(node.params) ? node.params : {};
      node.params[paramId] = value;
    });
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.graphRefreshIssues(rec);
    this.writeGraph(rec, {op: "node.param", ids: ids, param: String(paramId), value: value});
    return true;
  };

  Renderer.prototype.graphSetNodeField = function (rec, field, value) {
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var start = deepClone(rec.graph);
    rec.graph.nodes.forEach(function (node) {
      if (rec.selected[String(node.id)]) node[field] = value;
    });
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.graphRefreshIssues(rec);
    this.writeGraph(rec, {op: "node." + field, ids: ids, value: value});
    return true;
  };

  Renderer.prototype.graphSetArity = function (rec, arity) {
    var ids = Object.keys(rec.selected);
    if (ids.length !== 1) return false;
    var start = deepClone(rec.graph);
    rec.graph.nodes.forEach(function (node) {
      if (rec.selected[String(node.id)]) node.arity = Math.max(1, Math.round(Number(arity) || 1));
    });
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "node.arity", ids: ids, value: Number(arity)});
    this.rebuildGraph(rec, ids[0]);
    return true;
  };

  Renderer.prototype.graphInspectorControl = function (rec, param, value, mixed) {
    var self = this;
    var type = String(param.type || "float");
    var options = [];
    if (Array.isArray(param.options)) options = param.options;
    else if (Array.isArray(param.values)) options = param.values.map(function (v) { return {value: v, label: v}; });
    function commit(next) { self.graphSetParam(rec, param.id, next); }
    if (type === "bool") {
      var check = el("input", {type: "checkbox"});
      check.checked = !mixed && !!value;
      check.addEventListener("change", function () { commit(check.checked); });
      return check;
    }
    if (type === "enum" && options.length) {
      var select = el("select");
      options.forEach(function (option) {
        var optionValue = isObject(option) ? option.value : option;
        select.appendChild(el("option", {value: String(optionValue), text: String(isObject(option) ? (option.label !== undefined ? option.label : optionValue) : option)}));
        if (!mixed && equal(optionValue, value)) select.value = String(optionValue);
      });
      if (mixed) select.value = "";
      select.addEventListener("change", function () {
        var entry = options[select.selectedIndex];
        commit(isObject(entry) ? entry.value : select.value);
      });
      return select;
    }
    if (type === "color") {
      var color = el("input", {type: "color"});
      color.value = mixed ? "#ffffff" : String(value || "#ffffff").slice(0, 7);
      color.addEventListener("change", function () { commit(color.value); });
      return color;
    }
    if (type === "vec2" || type === "vec3" || type === "vec4") {
      var count = Number(type.slice(3));
      var inputs = [];
      var vector = el("span", {class: "pui-graph-param-vector"});
      for (var i = 0; i < count; i++) {
        (function (index) {
          var input = el("input", {type: "number", step: "0.01", "aria-label": "Component " + (index + 1)});
          input.value = mixed || !isArray(value) || value[index] === undefined ? "" : String(value[index]);
          input.addEventListener("change", function () {
            var next = inputs.map(function (item) { return Number(item.value) || 0; });
            commit(next);
          });
          inputs.push(input);
          vector.appendChild(input);
        })(i);
      }
      return vector;
    }
    if (type === "int" || type === "float") {
      var wrap = el("span", {class: "pui-graph-param-number"});
      var numeric = el("input", {type: "number", step: type === "int" ? "1" : String(param.step !== undefined ? param.step : 0.01)});
      if (param.min !== undefined) numeric.min = String(param.min);
      if (param.max !== undefined) numeric.max = String(param.max);
      numeric.value = mixed ? "" : String(value === undefined ? "" : value);
      if (mixed) numeric.placeholder = "—";
      numeric.addEventListener("change", function () { commit(type === "int" ? Math.round(Number(numeric.value)) : Number(numeric.value)); });
      if (param.min !== undefined && param.max !== undefined) {
        var range = el("input", {type: "range", step: String(param.step !== undefined ? param.step : (type === "int" ? 1 : 0.01))});
        range.min = String(param.min); range.max = String(param.max);
        range.value = mixed ? String(param.min) : String(value === undefined ? param.min : value);
        range.addEventListener("input", function () { numeric.value = range.value; commit(type === "int" ? Math.round(Number(range.value)) : Number(range.value)); });
        wrap.appendChild(range);
      }
      wrap.appendChild(numeric);
      return wrap;
    }
    var line = el("input", {type: "text"});
    line.value = mixed ? "" : String(value === undefined ? "" : value);
    line.addEventListener("change", function () { commit(line.value); });
    return line;
  };

  Renderer.prototype.renderGraphInspector = function (rec) {
    var self = this;
    if (!rec.inspector) return;
    rec.inspector.textContent = "";
    if (rec.graphOptions && rec.graphOptions.inspector === "host" && typeof this.adapter.graphInspector === "function") {
      var selectedNodes = (rec.graph.nodes || []).filter(function (node) { return rec.selected[String(node.id)]; });
      var context = {
        node: selectedNodes.length === 1 ? selectedNodes[0] : null,
        type: selectedNodes.length === 1 ? (rec.typeMap[String(selectedNodes[0].type)] || null) : null,
        selected: selectedNodes,
        frame: rec.selectedFrame || null,
        cable: rec.selectedCable || null
      };
      try {
        var made = this.adapter.graphInspector(rec.inspector, context, rec.block, this);
        if (made === false) { /* fall through to the generic inspector */ }
        else {
          if (made && (made.nodeType || typeof made.tagName === "string")) rec.inspector.appendChild(made);
          return;
        }
      } catch (error) {
        this.adapter.announce("error", "Graph inspector failed: " + String(error && error.message || error));
        rec.inspector.appendChild(el("p", {class: "pui-graph-inspector-empty", text: "Graph inspector unavailable."}));
        return;
      }
    }
    if (rec.selectedFrame) {
      var frame = rec.selectedFrame;
      rec.inspector.appendChild(el("h5", {text: String(frame.title || "Frame")}));
      rec.inspector.appendChild(el("p", {class: "pui-graph-inspector-type", text: isArray(frame.members) ? "Group · " + frame.members.length + " members" : "Frame"}));
      var frameTitleRow = el("div", {class: "pui-graph-param"});
      frameTitleRow.appendChild(el("label", {text: "Title"}));
      var frameTitle = el("input", {type: "text", "aria-label": "Frame title"});
      frameTitle.value = String(frame.title || "");
      frameTitle.addEventListener("change", function () { self.graphSetFrameField(rec, "title", frameTitle.value); });
      frameTitleRow.appendChild(frameTitle);
      rec.inspector.appendChild(frameTitleRow);
      var sizeRow = el("div", {class: "pui-graph-param pui-graph-frame-size"});
      sizeRow.appendChild(el("label", {text: "Size"}));
      var frameW = el("input", {type: "number", step: "1", min: "80", "aria-label": "Frame width"});
      frameW.value = String(frame.w || 0);
      frameW.addEventListener("change", function () { self.graphSetFrameField(rec, "w", Math.max(80, Number(frameW.value))); });
      var frameH = el("input", {type: "number", step: "1", min: "60", "aria-label": "Frame height"});
      frameH.value = String(frame.h || 0);
      frameH.addEventListener("change", function () { self.graphSetFrameField(rec, "h", Math.max(60, Number(frameH.value))); });
      sizeRow.appendChild(frameW);
      sizeRow.appendChild(frameH);
      rec.inspector.appendChild(sizeRow);
      var frameActions = el("div", {class: "pui-graph-inspector-actions"});
      if (isArray(frame.members)) {
        var selectMembers = el("button", {type: "button", class: "pui-button", text: "Select members"});
        selectMembers.addEventListener("click", function () { self.graphSelectFrameMembers(rec); });
        frameActions.appendChild(selectMembers);
      }
      var fit = el("button", {type: "button", class: "pui-button", text: "Fit to contents"});
      fit.addEventListener("click", function () { self.graphFitFrame(rec); });
      var remove = el("button", {type: "button", class: "pui-button pui-danger", text: "Delete frame"});
      remove.addEventListener("click", function () { self.graphDelete(rec); });
      frameActions.appendChild(fit);
      frameActions.appendChild(remove);
      rec.inspector.appendChild(frameActions);
      return;
    }
    var selected = (rec.graph.nodes || []).filter(function (node) { return rec.selected[String(node.id)]; });
    if (!selected.length) {
      rec.inspector.appendChild(el("h5", {text: rec.selectedCable ? "Cable" : "Inspector"}));
      rec.inspector.appendChild(el("p", {class: "pui-graph-inspector-empty", text: rec.selectedCable ? (rec.selectedCable.from + " → " + rec.selectedCable.to) : "Select a node or cable."}));
      return;
    }
    var firstType = rec.typeMap[String(selected[0].type)] || null;
    rec.inspector.appendChild(el("h5", {text: selected.length > 1 ? selected.length + " nodes" : String(selected[0].label || (firstType && firstType.label) || selected[0].type)}));
    if (firstType) rec.inspector.appendChild(el("p", {class: "pui-graph-inspector-type", text: String(firstType.label || firstType.id)}));
    var labelRow = el("div", {class: "pui-graph-param"});
    labelRow.appendChild(el("label", {text: "Label", for: rec.id ? "" : ""}));
    var labelInput = el("input", {type: "text", "aria-label": "Node label"});
    labelInput.value = selected.length === 1 ? String(selected[0].label || "") : "";
    labelInput.addEventListener("change", function () { self.graphSetNodeField(rec, "label", labelInput.value); });
    labelRow.appendChild(labelInput);
    rec.inspector.appendChild(labelRow);
    var enabledRow = el("div", {class: "pui-graph-param"});
    enabledRow.appendChild(el("label", {text: "Enabled"}));
    var enabled = el("input", {type: "checkbox", "aria-label": "Node enabled"});
    enabled.checked = selected.every(function (node) { return node.enabled !== false; });
    enabled.addEventListener("change", function () { self.graphSetNodeField(rec, "enabled", enabled.checked); });
    enabledRow.appendChild(enabled);
    rec.inspector.appendChild(enabledRow);
    var scaleRow = el("div", {class: "pui-graph-param"});
    scaleRow.appendChild(el("label", {text: "Scale"}));
    var scale = el("input", {type: "number", step: "0.01", min: "0", "aria-label": "Node scale"});
    var scales = selected.map(function (node) { return node.scale === undefined ? 1 : Number(node.scale); });
    var mixedScale = scales.some(function (value) { return value !== scales[0]; });
    scale.value = mixedScale ? "" : String(scales[0]);
    if (mixedScale) scale.placeholder = "—";
    scale.addEventListener("change", function () { self.graphSetNodeField(rec, "scale", Number(scale.value)); });
    scaleRow.appendChild(scale);
    rec.inspector.appendChild(scaleRow);
    // Params common to every selected node type.
    var common = null;
    selected.forEach(function (node) {
      var type = rec.typeMap[String(node.type)];
      var ids = {};
      (type && type.params || []).forEach(function (param) { ids[String(param.id)] = param; });
      if (common === null) common = ids;
      else Object.keys(common).forEach(function (id) { if (!ids[id]) delete common[id]; });
    });
    Object.keys(common || {}).forEach(function (paramId) {
      var param = common[paramId];
      var values = selected.map(function (node) { return isObject(node.params) ? node.params[paramId] : undefined; });
      var mixed = values.some(function (value) { return !equal(value, values[0]); });
      var row = el("div", {class: "pui-graph-param" + (!mixed && param.default !== undefined && !equal(values[0], param.default) ? " is-modified" : "")});
      var controlId = "pui-graph-param-" + String(paramId) + "-" + Math.random().toString(36).slice(2, 7);
      row.appendChild(el("label", {text: String(param.label || paramId), for: controlId}));
      var control = self.graphInspectorControl(rec, param, values[0], mixed);
      if (control && control.setAttribute) control.setAttribute("id", controlId);
      row.appendChild(control);
      if (param.default !== undefined) {
        var reset = el("button", {type: "button", class: "pui-reset", text: "↺", "aria-label": "Reset " + String(param.label || paramId)});
        reset.addEventListener("click", function () { self.graphSetParam(rec, paramId, param.default); });
        row.appendChild(reset);
      }
      rec.inspector.appendChild(row);
    });
    if (selected.length === 1 && firstType && isObject(firstType.dynamic)) {
      var arityRow = el("div", {class: "pui-graph-param"});
      arityRow.appendChild(el("label", {text: "Inputs"}));
      var minus = el("button", {type: "button", class: "pui-button", text: "−", "aria-label": "Remove input"});
      var plus = el("button", {type: "button", class: "pui-button", text: "+", "aria-label": "Add input"});
      var currentArity = selected[0].arity === undefined ? (firstType.inputs || []).length : Number(selected[0].arity);
      minus.addEventListener("click", function () { self.graphSetArity(rec, currentArity - 1); });
      plus.addEventListener("click", function () { self.graphSetArity(rec, currentArity + 1); });
      arityRow.appendChild(minus);
      arityRow.appendChild(el("span", {class: "pui-graph-arity", text: String(currentArity)}));
      arityRow.appendChild(plus);
      rec.inspector.appendChild(arityRow);
    }
    if (selected.length === 1 && firstType) {
      var visibility = el("details", {class: "pui-graph-visibility"});
      visibility.appendChild(el("summary", {text: "Show / hide"}));
      var visibilityList = el("div", {class: "pui-graph-visibility-list"});
      var node = selected[0];
      (firstType.inputs || []).forEach(function (port) {
        var label = el("label", {class: "pui-graph-visibility-row"});
        var check = el("input", {type: "checkbox"});
        check.checked = !(isArray(node.hidden_inputs) && node.hidden_inputs.indexOf(String(port.id)) >= 0);
        check.addEventListener("change", function () { self.graphSetNodeVisibility(rec, node, "inputs", port.id, check.checked); });
        label.appendChild(check);
        label.appendChild(el("span", {text: "Inlet · " + String(port.label || port.id)}));
        visibilityList.appendChild(label);
      });
      (firstType.params || []).forEach(function (param) {
        var label = el("label", {class: "pui-graph-visibility-row"});
        var check = el("input", {type: "checkbox"});
        check.checked = !(isArray(node.hidden_params) && node.hidden_params.indexOf(String(param.id)) >= 0);
        check.addEventListener("change", function () { self.graphSetNodeVisibility(rec, node, "params", param.id, check.checked); });
        label.appendChild(check);
        label.appendChild(el("span", {text: "Param · " + String(param.label || param.id)}));
        visibilityList.appendChild(label);
      });
      visibility.appendChild(visibilityList);
      rec.inspector.appendChild(visibility);
    }
    var issues = rec.issues || (global.PupitreGraph ? global.PupitreGraph.validateGraph(rec.graph, rec.types) : []);
    rec.inspector.appendChild(el("h6", {text: "Issues"}));
    if (!issues.length) rec.inspector.appendChild(el("p", {class: "pui-graph-inspector-empty", text: "No issues."}));
    else issues.slice(0, 8).forEach(function (issue) {
      rec.inspector.appendChild(el("p", {class: "pui-graph-issue is-" + issue.level, text: String(issue.code || "") + ": " + String(issue.message || "")}));
    });
  };

  Renderer.prototype.graphSetNodeVisibility = function (rec, node, kind, id, visible) {
    if (rec.block.readonly) return false;
    var start = deepClone(rec.graph);
    var target = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(node.id); });
    if (!target) return false;
    var key = kind === "inputs" ? "hidden_inputs" : "hidden_params";
    var hidden = isArray(target[key]) ? target[key].map(String) : [];
    hidden = hidden.filter(function (item) { return item !== String(id); });
    if (!visible) hidden.push(String(id));
    target[key] = hidden;
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "node.visibility", ids: [String(node.id)], kind: kind, id: String(id), visible: !!visible});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphSetSelection = function (rec, ids) {
    rec.selected = {};
    (ids || []).forEach(function (id) { rec.selected[String(id)] = true; });
    rec.selectedCable = null;
    rec.selectedFrame = null;
    (Object.keys(rec.frameEls || {})).forEach(function (id) { if (rec.frameEls[id].classList) rec.frameEls[id].classList.remove("is-selected"); });
    rec.nodeEls && Object.keys(rec.nodeEls).forEach(function (nodeId) {
      var el = rec.nodeEls[nodeId];
      if (el && el.classList) el.classList.toggle("is-selected", !!rec.selected[nodeId]);
    });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    if (rec.block.selection_bind && rec.graphPath === String(rec.block.bind || "")) this.writeSelection(rec, {ids: Object.keys(rec.selected), active: Object.keys(rec.selected)[0] || ""}, "node", "");
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphSelect = function (rec, id, additive) {
    var key = String(id);
    if (additive && rec.selected[key]) delete rec.selected[key];
    else {
      if (!additive) rec.selected = {};
      rec.selected[key] = true;
    }
    rec.selectedCable = null;
    rec.selectedFrame = null;
    (Object.keys(rec.frameEls || {})).forEach(function (frameId) { if (rec.frameEls[frameId].classList) rec.frameEls[frameId].classList.remove("is-selected"); });
    rec.nodeEls && Object.keys(rec.nodeEls).forEach(function (nodeId) {
      var el = rec.nodeEls[nodeId];
      if (el && el.classList) el.classList.toggle("is-selected", !!rec.selected[nodeId]);
    });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    if (rec.block.selection_bind && rec.graphPath === String(rec.block.bind || "")) this.writeSelection(rec, {ids: Object.keys(rec.selected), active: key}, "node", "");
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphSelectCable = function (rec, cable) {
    rec.selected = {};
    rec.selectedCable = cable;
    rec.selectedFrame = null;
    (Object.keys(rec.frameEls || {})).forEach(function (frameId) { if (rec.frameEls[frameId].classList) rec.frameEls[frameId].classList.remove("is-selected"); });
    rec.nodeEls && Object.keys(rec.nodeEls).forEach(function (id) {
      if (rec.nodeEls[id] && rec.nodeEls[id].classList) rec.nodeEls[id].classList.remove("is-selected");
    });
    (rec.cableRefs || []).forEach(function (ref) {
      if (ref.el.classList) ref.el.classList.toggle("is-selected", ref.cable === cable);
    });
    if (rec.block.selection_bind) this.writeSelection(rec, {ids: [], active: ""}, "cable", String(cable.id || ""));
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphClearSelection = function (rec) {
    rec.selected = {};
    rec.selectedCable = null;
    rec.selectedFrame = null;
    (Object.keys(rec.frameEls || {})).forEach(function (frameId) { if (rec.frameEls[frameId].classList) rec.frameEls[frameId].classList.remove("is-selected"); });
    rec.nodeEls && Object.keys(rec.nodeEls).forEach(function (id) {
      if (rec.nodeEls[id] && rec.nodeEls[id].classList) rec.nodeEls[id].classList.remove("is-selected");
    });
    (rec.cableRefs || []).forEach(function (ref) { if (ref.el.classList) ref.el.classList.remove("is-selected"); });
    if (rec.block.selection_bind) this.writeSelection(rec, {ids: [], active: ""}, "node", "");
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphStartWire = function (rec, nodeId, portId, isInput, event) {
    var Graph = global.PupitreGraph;
    if (!Graph || isInput || rec.block.readonly) return;
    var node = (rec.graph.nodes || []).find(function (n) { return String(n.id) === String(nodeId); });
    if (!node) return;
    var point = Graph.portPosition(node, rec.typeMap[String(node.type)], portId, false, rec.metrics);
    if (!point) return;
    if (event && event.preventDefault) event.preventDefault();
    this.graphCancelWire(rec);
    var path = svgEl("path", {class: "pui-graph-wire", d: ""});
    rec.cableGroup.appendChild(path);
    rec.wiring = {from: {node: nodeId, port: portId}, fromPoint: point, path: path};
    var fromType = Graph.portTypeOf(rec.typeMap[String(node.type)], portId, false) || "tex";
    this.graphMarkPorts(rec, fromType);
    this.graphUpdateWire(rec, point);
  };

  Renderer.prototype.graphMarkPorts = function (rec, fromType) {
    var Graph = global.PupitreGraph;
    Object.keys(rec.portEls || {}).forEach(function (key) {
      var entry = rec.portEls[key];
      if (!entry || !entry.isInput) return;
      var compatibility = Graph.portCompatible(fromType, entry.type);
      entry.el.classList.toggle("is-compatible", compatibility !== "no");
      entry.el.classList.toggle("is-incompatible", compatibility === "no");
    });
  };

  Renderer.prototype.graphParamFill = function (param, value) {
    var min = Number(param && param.min);
    var max = Number(param && param.max);
    var current = Number(value);
    if (!isFinite(min) || !isFinite(max) || max <= min || !isFinite(current)) return 0;
    return Math.max(0, Math.min(1, (current - min) / (max - min)));
  };

  Renderer.prototype.graphParamPaint = function (element, param, value) {
    if (!element || !element.querySelector) return;
    var fill = element.querySelector(".pui-graph-param-fill");
    if (!fill || !fill.style) return;
    fill.style.setProperty("width", (this.graphParamFill(param, value) * 100).toFixed(2) + "%");
  };

  Renderer.prototype.graphParamScrub = function (rec, node, param, event) {
    if (rec.block.readonly) return;
    if (event.stopPropagation) event.stopPropagation();
    if (event.preventDefault) event.preventDefault();
    var button = event.currentTarget;
    var raw = isObject(node.params) ? node.params[param.id] : undefined;
    rec.paramDrag = {start: deepClone(rec.graph), nodeId: String(node.id), param: param, x: event.clientX || 0,
      value: raw === undefined ? Number(param.default) || 0 : Number(raw) || 0, el: button};
    if (button && button.setPointerCapture) button.setPointerCapture(event.pointerId || 1);
  };

  Renderer.prototype.graphParamScrubMove = function (rec, event) {
    var drag = rec && rec.paramDrag;
    if (!drag) return;
    var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === drag.nodeId; });
    if (!node) return;
    var param = drag.param;
    var isInt = String(param.type || "float") === "int";
    var step = Number(param.step) > 0 ? Number(param.step) : isInt ? 1 : 0.01;
    if (event.altKey) step /= 10;
    if (event.shiftKey) step *= 10;
    var dx = (event.clientX || 0) - drag.x;
    var next = drag.value + Math.round(dx / 6) * step;
    if (param.min !== undefined) next = Math.max(Number(param.min), next);
    if (param.max !== undefined) next = Math.min(Number(param.max), next);
    var precision = Number(param.precision);
    if (isFinite(precision) && precision >= 0) next = Number(next.toFixed(precision));
    if (isInt) next = Math.round(next);
    node.params = isObject(node.params) ? node.params : {};
    node.params[param.id] = next;
    this.updateGraphDom(rec);
    this.writeGraph(rec, {op: "node.param", ids: [node.id], param: String(param.id), value: next});
  };

  Renderer.prototype.graphParamScrubEnd = function (rec, event) {
    if (!rec || !rec.paramDrag) return;
    var drag = rec.paramDrag;
    rec.paramDrag = null;
    var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === drag.nodeId; });
    var value = node && isObject(node.params) ? node.params[drag.param.id] : drag.value;
    this.graphPushUndo(rec, drag.start);
    this.writeGraph(rec, {op: "node.param", ids: [drag.nodeId], param: String(drag.param.id), value: value});
    if (rec.inspector) this.renderGraphInspector(rec);
  };

  Renderer.prototype.graphParamKey = function (rec, node, param, event) {
    if (rec.block.readonly) return;
    var keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (keys.indexOf(event.key) < 0) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    var isInt = String(param.type || "float") === "int";
    var step = Number(param.step) > 0 ? Number(param.step) : isInt ? 1 : 0.01;
    if (event.altKey) step /= 10;
    if (event.shiftKey) step *= 10;
    var raw = isObject(node.params) ? node.params[param.id] : undefined;
    var value = (raw === undefined ? Number(param.default) || 0 : Number(raw) || 0) +
      (event.key === "ArrowRight" || event.key === "ArrowUp" ? step : -step);
    if (param.min !== undefined) value = Math.max(Number(param.min), value);
    if (param.max !== undefined) value = Math.min(Number(param.max), value);
    if (isInt) value = Math.round(value);
    this.graphSetNodeParam(rec, node.id, param.id, value);
  };

  Renderer.prototype.graphSetNodeParam = function (rec, nodeId, paramId, value) {
    var node = (rec.graph.nodes || []).find(function (item) { return String(item.id) === String(nodeId); });
    if (!node) return false;
    var start = deepClone(rec.graph);
    node.params = isObject(node.params) ? node.params : {};
    node.params[paramId] = value;
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.writeGraph(rec, {op: "node.param", ids: [String(nodeId)], param: String(paramId), value: value});
    return true;
  };

  Renderer.prototype.graphUpdateWire = function (rec, point) {
    var Graph = global.PupitreGraph;
    if (!rec.wiring || !Graph) return;
    var p = Graph.cablePath(rec.wiring.fromPoint, point);
    rec.wiring.path.setAttribute("d", "M " + p.x1 + " " + p.y1 + " C " + p.cx1 + " " + p.cy1 + " " + p.cx2 + " " + p.cy2 + " " + p.x2 + " " + p.y2);
  };

  Renderer.prototype.graphCancelWire = function (rec) {
    if (rec.wiring && rec.wiring.path && rec.wiring.path.parentNode) rec.wiring.path.parentNode.removeChild(rec.wiring.path);
    rec.wiring = null;
    Object.keys(rec.portEls || {}).forEach(function (key) {
      var entry = rec.portEls[key];
      if (entry && entry.el.classList) entry.el.classList.remove("is-compatible", "is-incompatible");
    });
  };

  Renderer.prototype.graphFinishWire = function (rec, toNodeId, toPortId, event) {
    if (!rec.wiring) return;
    if (event && event.stopPropagation) event.stopPropagation();
    var from = rec.wiring.from;
    this.graphCancelWire(rec);
    this.graphConnect(rec, from.node, from.port, toNodeId, toPortId);
  };

  Renderer.prototype.graphConnect = function (rec, fromNodeId, fromPort, toNodeId, toPort) {
    var Graph = global.PupitreGraph;
    var fromNode = (rec.graph.nodes || []).find(function (n) { return String(n.id) === String(fromNodeId); });
    var toNode = (rec.graph.nodes || []).find(function (n) { return String(n.id) === String(toNodeId); });
    if (!fromNode || !toNode) return false;
    var fromType = Graph.portTypeOf(rec.typeMap[String(fromNode.type)], fromPort, false);
    var toType = Graph.portTypeOf(rec.typeMap[String(toNode.type)], toPort, true);
    var compatibility = Graph.portCompatible(fromType, toType);
    if (compatibility === "no") { this.adapter.announce("error", "Ports are not compatible."); return false; }
    var duplicate = (rec.graph.cables || []).some(function (cable) { return String(cable.from) === String(fromNodeId) + "." + String(fromPort) && String(cable.to) === String(toNodeId) + "." + String(toPort); });
    if (duplicate) { this.adapter.announce("warning", "That cable already exists."); return false; }
    var start = deepClone(rec.graph);
    var nextId = "c" + ((rec.graph.cables || []).length + 1);
    while ((rec.graph.cables || []).some(function (cable) { return String(cable.id) === nextId; })) nextId += "x";
    rec.graph.cables = (rec.graph.cables || []).concat([{id: nextId, from: String(fromNodeId) + "." + String(fromPort), to: String(toNodeId) + "." + String(toPort)}]);
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "cable.connect", from: String(fromNodeId) + "." + String(fromPort), to: String(toNodeId) + "." + String(toPort)});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphAddNode = function (rec, type) {
    if (!type || rec.block.readonly) return null;
    var Graph = global.PupitreGraph;
    var nodes = rec.graph.nodes || [];
    var index = 1;
    while (nodes.some(function (node) { return String(node.id) === "n" + index; })) index++;
    var viewportRect = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 500};
    var view = rec.view || {zoom: 1, panX: 0, panY: 0};
    var x = Math.round(((viewportRect.width || 800) / 2 - (view.panX || 0)) / (view.zoom || 1) - 78);
    var y = Math.round(((viewportRect.height || 500) / 2 - (view.panY || 0)) / (view.zoom || 1) - 40);
    var params = {};
    (type.params || []).forEach(function (param) { if (param.default !== undefined) params[param.id] = deepClone(param.default); });
    var node = {id: "n" + index, type: String(type.id), x: x, y: y, label: String(type.label || type.id), enabled: true, params: params};
    var start = deepClone(rec.graph);
    rec.graph.nodes = nodes.concat([node]);
    this.graphPushUndo(rec, start);
    rec.recentTypes = [String(type.id)].concat((rec.recentTypes || []).filter(function (id) { return id !== String(type.id); })).slice(0, 8);
    this.writeGraph(rec, {op: "node.add", type: String(type.id), id: node.id});
    this.rebuildGraph(rec, node.id);
    return node.id;
  };

  Renderer.prototype.openGraphAdd = function (rec) {
    var self = this;
    if (rec.block.readonly) return;
    var dialog = el("dialog", {class: "pui-dialog pui-graph-add", "aria-label": "Add node"});
    var form = el("form", {method: "dialog"});
    var input = el("input", {type: "search", "aria-label": "Search node types", placeholder: "Search node types…"});
    var list = el("div", {class: "pui-graph-add-list", role: "listbox", "aria-label": "Node types"});
    form.appendChild(input);
    form.appendChild(list);
    dialog.appendChild(form);
    function close() { if (dialog.open) dialog.close(); dialog.remove(); }
    function paint(query) {
      list.textContent = "";
      var needle = String(query || "").trim().toLowerCase();
      var recent = rec.recentTypes || [];
      var favorites = rec.favoriteTypes || {};
      var types = rec.types.filter(function (type) {
        return isObject(type) && (!needle || (String(type.label || "") + " " + String(type.id || "") + " " + String(type.category || "") + " " + String(type.description || "")).toLowerCase().indexOf(needle) >= 0);
      });
      types.sort(function (a, b) {
        var af = favorites[String(a.id)] ? 0 : 1;
        var bf = favorites[String(b.id)] ? 0 : 1;
        if (af !== bf) return af - bf;
        var ar = recent.indexOf(String(a.id));
        var br = recent.indexOf(String(b.id));
        if (ar < 0) ar = 999; if (br < 0) br = 999;
        if (ar !== br) return ar - br;
        var ac = String(a.category || "other");
        var bc = String(b.category || "other");
        if (ac !== bc) return ac < bc ? -1 : 1;
        return String(a.label || a.id) < String(b.label || b.id) ? -1 : 1;
      });
      types.forEach(function (type) {
        var row = el("div", {class: "pui-graph-add-row"});
        var button = el("button", {type: "button", role: "option", class: "pui-graph-add-option", text: String(type.label || type.id) + (type.category ? " · " + type.category : "")});
        button.setAttribute("aria-label", String(type.label || type.id) + (type.category ? ", " + type.category : ""));
        button.addEventListener("click", function () { close(); self.graphAddNode(rec, type); });
        var star = el("button", {type: "button", class: "pui-graph-add-star", text: favorites[String(type.id)] ? "★" : "☆", "aria-label": (favorites[String(type.id)] ? "Remove " : "Add ") + String(type.label || type.id) + " favorite"});
        star.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          if (rec.favoriteTypes[String(type.id)]) delete rec.favoriteTypes[String(type.id)];
          else rec.favoriteTypes[String(type.id)] = true;
          paint(input.value);
        });
        row.appendChild(button);
        row.appendChild(star);
        list.appendChild(row);
      });
      if (!list.childNodes.length) list.appendChild(el("p", {class: "pui-graph-add-empty", text: "No matching node types."}));
    }
    input.addEventListener("input", function () { paint(input.value); });
    input.addEventListener("keydown", function (event) {
      var options = Array.from(list.querySelectorAll(".pui-graph-add-option"));
      var index = options.indexOf(global.document.activeElement);
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!options.length) return;
        var next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1);
        options[index < 0 ? 0 : next].focus();
      } else if (event.key === "Enter" && index >= 0) {
        event.preventDefault();
        options[index].click();
      }
    });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    global.document.body.appendChild(dialog);
    dialog.showModal();
    paint("");
    input.focus();
  };

  Renderer.prototype.graphPushUndo = function (rec, snapshot) {
    if (rec.graphOptions && rec.graphOptions.host_undo && typeof this.adapter.historyCheckpoint === "function") {
      try { this.adapter.historyCheckpoint(deepClone(snapshot), rec.block, "graph"); } catch (error) { /* host history */ }
      return;
    }
    rec.undo.push(deepClone(snapshot));
    rec.redo = [];
  };

  Renderer.prototype.writeGraph = function (rec, intent) {
    if (typeof this.adapter.graphAction === "function") {
      try {
        var result = this.adapter.graphAction(intent || {}, rec.graph, rec.block);
        if (result === false) return false;
      } catch (error) {
        this.adapter.announce("error", "Graph action failed: " + String(error && error.message || error));
        return false;
      }
    }
    return this.setPath(String(rec.graphPath || rec.block.bind || ""), rec.graph, rec.block);
  };

  Renderer.prototype.updateGraphDom = function (rec) {
    var self = this;
    var Graph = global.PupitreGraph;
    if (!Graph) return;
    rec.graph.nodes.forEach(function (node) {
      var el = rec.nodeEls[String(node.id)];
      if (!el) return;
      var rect = self.graphNodeRect(rec, node);
      if (el.setAttribute) el.setAttribute("style", "left:" + rect.x + "px;top:" + rect.y + "px;width:" + rect.w + "px;height:" + rect.h + "px;");
      if (el.classList) el.classList.toggle("is-disabled", node.enabled === false);
      var title = el.querySelector ? el.querySelector(".pui-graph-node-title") : null;
      if (title) title.textContent = String(node.label || (rec.typeMap[String(node.type)] && rec.typeMap[String(node.type)].label) || node.type || node.id);
      var paramInfo = rec.paramEls[String(node.id)];
      if (paramInfo) {
        paramInfo.defs.forEach(function (param, index) {
          var raw = isObject(node.params) ? node.params[param.id] : undefined;
          var shown = raw === undefined ? (param.default === undefined ? "—" : param.default) : raw;
          if (paramInfo.elements[index]) {
            var paramEl = paramInfo.elements[index];
            var numberEl = paramEl.querySelector ? paramEl.querySelector(".pui-graph-param-number") : null;
            if (numberEl) numberEl.textContent = String(shown);
            else paramEl.textContent = String(shown);
            paramEl.setAttribute("aria-valuenow", String(Number(shown) || 0));
            paramEl.setAttribute("aria-label", String(param.label || param.id) + " value " + String(shown));
            self.graphParamPaint(paramEl, param, shown);
          }
        });
      }
    });
    (rec.graph.frames || []).forEach(function (frame) {
      var frameEl = rec.frameEls[String(frame.id)];
      if (frameEl && frameEl.setAttribute) frameEl.setAttribute("style", "left:" + (Number(frame.x) || 0) + "px;top:" + (Number(frame.y) || 0) + "px;width:" + (Number(frame.w) || 0) + "px;height:" + (Number(frame.h) || 0) + "px;");
    });
    rec.cableRefs.forEach(function (ref) {
      var from = Graph.parseRef(ref.cable.from);
      var to = Graph.parseRef(ref.cable.to);
      if (!from || !to) return;
      var fromNode = rec.graph.nodes.find(function (n) { return String(n.id) === from.node; });
      var toNode = rec.graph.nodes.find(function (n) { return String(n.id) === to.node; });
      if (!fromNode || !toNode) return;
      var a = Graph.portPosition(fromNode, rec.typeMap[String(fromNode.type)], from.port, false, rec.metrics);
      var b = Graph.portPosition(toNode, rec.typeMap[String(toNode.type)], to.port, true, rec.metrics);
      if (!a || !b) return;
      var p = Graph.cablePath(a, b);
      ref.el.setAttribute("d", "M " + p.x1 + " " + p.y1 + " C " + p.cx1 + " " + p.cy1 + " " + p.cx2 + " " + p.cy2 + " " + p.x2 + " " + p.y2);
    });
    if (rec.renderMinimap) rec.renderMinimap();
  };

  Renderer.prototype.graphMove = function (rec, dx, dy) {
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var start = deepClone(rec.graph);
    rec.graph.nodes.forEach(function (node) {
      if (!rec.selected[String(node.id)]) return;
      node.x = (Number(node.x) || 0) + dx;
      node.y = (Number(node.y) || 0) + dy;
    });
    this.graphPushUndo(rec, start);
    this.updateGraphDom(rec);
    this.writeGraph(rec, {op: "node.move", ids: ids, dx: dx, dy: dy});
    return true;
  };

  Renderer.prototype.graphDelete = function (rec) {
    if (rec.selectedFrame) {
      var frameStart = deepClone(rec.graph);
      var selectedFrame = rec.selectedFrame;
      rec.graph.frames = (rec.graph.frames || []).filter(function (frame) { return frame !== selectedFrame; });
      rec.selectedFrame = null;
      this.graphPushUndo(rec, frameStart);
      this.writeGraph(rec, {op: "frame.delete", id: selectedFrame.id});
      this.rebuildGraph(rec);
      return true;
    }
    if (rec.selectedCable) {
      var cableStart = deepClone(rec.graph);
      var selectedCable = rec.selectedCable;
      rec.graph.cables = (rec.graph.cables || []).filter(function (cable) { return cable !== selectedCable; });
      rec.selectedCable = null;
      this.graphPushUndo(rec, cableStart);
      this.writeGraph(rec, {op: "cable.disconnect", id: selectedCable.id});
      this.rebuildGraph(rec);
      return true;
    }
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var start = deepClone(rec.graph);
    var selected = {};
    ids.forEach(function (id) { selected[String(id)] = true; });
    rec.graph.nodes = (rec.graph.nodes || []).filter(function (node) { return !selected[String(node.id)]; });
    rec.graph.cables = (rec.graph.cables || []).filter(function (cable) {
      var from = global.PupitreGraph.parseRef(cable.from);
      var to = global.PupitreGraph.parseRef(cable.to);
      return !(from && selected[from.node]) && !(to && selected[to.node]);
    });
    rec.selected = {};
    if (rec.block.selection_bind) this.writeSelection(rec, {ids: [], active: ""}, "node", "");
    this.graphPushUndo(rec, start);
    this.writeGraph(rec, {op: "node.delete", ids: ids});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphUndo = function (rec) {
    if (rec.graphOptions && rec.graphOptions.host_undo) {
      if (typeof this.adapter.undo !== "function") return false;
      var ok = this.adapter.undo();
      rec.graph = this.adapter.getValue(String(rec.graphPath || rec.block.bind || ""));
      rec.undo = [];
      rec.redo = [];
      this.rebuildGraph(rec);
      return ok !== false;
    }
    if (!rec.undo.length) return false;
    rec.redo.push(deepClone(rec.graph));
    rec.graph = rec.undo.pop();
    this.writeGraph(rec, {op: "history.undo"});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.graphRedo = function (rec) {
    if (rec.graphOptions && rec.graphOptions.host_undo) {
      if (typeof this.adapter.redo !== "function") return false;
      var ok = this.adapter.redo();
      rec.graph = this.adapter.getValue(String(rec.graphPath || rec.block.bind || ""));
      rec.undo = [];
      rec.redo = [];
      this.rebuildGraph(rec);
      return ok !== false;
    }
    if (!rec.redo.length) return false;
    rec.undo.push(deepClone(rec.graph));
    rec.graph = rec.redo.pop();
    this.writeGraph(rec, {op: "history.redo"});
    this.rebuildGraph(rec);
    return true;
  };

  Renderer.prototype.rebuildGraph = function (rec, focusId, navStack, reveal) {
    if (!rec.root || !rec.root.parentNode) return;
    var parent = rec.root.parentNode;
    var index = this.graphRecords.indexOf(rec);
    this.graphUnobserveGraphBodies(rec);
    var newRoot = this.buildGraph(rec.block, navStack || rec.navStack);
    var newRec = this.graphRecords[this.graphRecords.length - 1];
    if (newRec) {
      if (navStack) {
        newRec.selected = {};
        newRec.selectedFrame = null;
        newRec.selectedCable = null;
      } else {
        newRec.undo = rec.undo;
        newRec.redo = rec.redo;
        newRec.selected = rec.selected;
        newRec.selectedFrame = rec.selectedFrame;
        newRec.recentTypes = rec.recentTypes;
        newRec.favoriteTypes = rec.favoriteTypes;
      }
    }
    parent.replaceChild(newRoot, rec.root);
    if (newRec) this.graphLayoutGraphBodies(newRec);
    if (index >= 0) this.graphRecords.splice(index, 1);
    if (newRec && reveal) {
      this.graphReveal(newRec, reveal);
      if (newRec.viewport && newRec.viewport.focus) {
        try { newRec.viewport.focus({preventScroll: true}); } catch (error) { try { newRec.viewport.focus(); } catch (error2) { /* ignore */ } }
      }
    }
    if (focusId && newRec && newRec.nodeEls[String(focusId)] && newRec.nodeEls[String(focusId)].focus) newRec.nodeEls[String(focusId)].focus();
  };














  Renderer.prototype.buildMacros = function (block) {
    var self = this;
    var root = el("section", {class: "pui-macros", "data-pui-macros": String(block.id || "")});
    var head = el("div", {class: "pui-macros-head"});
    head.appendChild(el("h4", {text: String(block.label || block.id || "Macros")}));
    var items = isArray(block.items) ? block.items : [];
    head.appendChild(el("span", {class: "pui-macros-count", text: items.length + " macros"}));
    root.appendChild(head);
    var grid = el("div", {class: "pui-macros-grid"});
    items.forEach(function (item) {
      if (!isObject(item)) return;
      var button = el("button", {type: "button", class: "pui-macro", text: String(item.label || item.id || "Macro")});
      if (item.color) button.style.setProperty("--pui-macro-color", String(item.color));
      if (item.size === "2x1") button.classList.add("is-wide");
      if (item.size === "1x2") button.classList.add("is-tall");
      if (item.a11y && item.a11y.name) button.setAttribute("aria-label", String(item.a11y.name));
      button.addEventListener("click", function () { self.startAction(item, button); });
      grid.appendChild(button);
    });
    root.appendChild(grid);
    return root;
  };

  Renderer.prototype.buildSlider = function (block) {
    var options = isObject(block.slider_options) ? block.slider_options : {};
    var field = Object.assign({}, block, options, {kind: "field", widget: block.widget || "range"});
    if (!field.orientation && options.orientation) field.orientation = options.orientation;
    var node = this.buildField(field);
    if (node && node.classList) node.classList.add("pui-big-slider");
    return node;
  };

  Renderer.prototype.buildDrawer = function (block) {
    var self = this;
    var modal = block.modal !== false;
    var contained = block.contained === true;
    var headless = block.headless === true;
    var translucent = block.translucent === true;
    var side = String(block.side || "right").toLowerCase();
    if (side !== "left" && side !== "right" && side !== "top" && side !== "bottom") side = "right";
    var size = function (value, fallback) {
      if (value === undefined || value === null || value === "") return String(fallback) + "px";
      return typeof value === "number" ? String(value) + "px" : String(value);
    };
    var root = el("section", {class: "pui-drawer" + (contained ? " is-contained" : "") + (headless ? " is-headless" : ""), "data-pui-drawer": String(block.id || "")});
    var trigger = null;
    if (block.trigger !== false) {
      trigger = el("button", {type: "button", class: "pui-drawer-trigger pui-button", text: String(block.trigger || block.label || "Open")});
      trigger.setAttribute("aria-expanded", "false");
      root.appendChild(trigger);
    }
    var panelId = this.id("drawer");
    var backdrop = el("div", {class: "pui-drawer-backdrop", hidden: true});
    var panel = el("aside", {class: "pui-drawer-panel is-" + side + (contained ? " is-contained" : "") + (headless ? " is-headless" : "") + (translucent ? " is-translucent" : ""), id: panelId, hidden: true,
      role: modal ? "dialog" : "region"});
    if (modal) panel.setAttribute("aria-modal", "true");
    if (trigger) trigger.setAttribute("aria-controls", panelId);
    var titleId = this.id("drawer-title");
    if (!headless) {
      panel.setAttribute("aria-labelledby", titleId);
      var head = el("div", {class: "pui-drawer-head"});
      head.appendChild(el("h4", {id: titleId, text: String(block.label || block.id || "Panel")}));
      var close = el("button", {type: "button", class: "pui-drawer-close", text: "×", "aria-label": "Close " + String(block.label || "panel")});
      head.appendChild(close);
      panel.appendChild(head);
      panel._puiClose = close;
    } else {
      panel.setAttribute("aria-label", String(block.label || block.id || "Panel"));
      panel.tabIndex = -1;
    }
    var body = el("div", {class: "pui-drawer-body"});
    (block.blocks || []).forEach(function (child) { body.appendChild(self.buildBlock(child)); });
    panel.appendChild(body);
    if (modal) root.appendChild(backdrop);
    root.appendChild(panel);
    var rec = {block: block, root: root, panel: panel, backdrop: backdrop, trigger: trigger, body: body, open: false, localOpen: block.open === true, returnFocus: null};
    var readOpen = function () {
      if (block.open_bind) {
        var value = self.adapter.getValue(String(block.open_bind));
        return value === true || value === 1 || value === "true";
      }
      return !!rec.localOpen;
    };
    var render = function () {
      var open = readOpen();
      rec.open = open;
      if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
      if (modal) backdrop.hidden = !open;
      panel.style.setProperty("--pui-drawer-width", size(block.width, 480));
      if (side === "top" || side === "bottom") {
        panel.style.setProperty("--pui-drawer-height", size(block.height, 260));
      }
      root.classList.toggle("is-open", open);
    };
    var toggle = function (open) {
      open = !!open;
      if (open && block.group) {
        for (var i = 0; i < self.drawerRecords.length; i++) {
          var other = self.drawerRecords[i];
          if (other !== rec && other.open && other.block && String(other.block.group || "") === String(block.group)) {
            other.toggle(false);
          }
        }
      }
      if (open) {
        var active = typeof document !== "undefined" ? document.activeElement : null;
        rec.returnFocus = active && active !== panel && !(panel.contains && panel.contains(active)) ? active : rec.trigger;
      }
      if (block.open_bind) self.setPath(String(block.open_bind), open, block);
      else rec.localOpen = open;
      if (typeof self.adapter.drawerAction === "function") {
        try { self.adapter.drawerAction({op: open ? "drawer.open" : "drawer.close", id: block.id}, open, block); } catch (error) { self.adapter.announce("error", "Drawer action failed: " + String(error && error.message || error)); }
      }
      render();
      if (open) {
        var first = body.querySelector("button, input, select, textarea");
        if (!first && !headless) first = panel.querySelector(".pui-drawer-head button, .pui-drawer-head input, .pui-drawer-head select, .pui-drawer-head textarea");
        if (first && first.focus) first.focus();
        else if (headless && panel.focus) panel.focus();
      } else {
        var back = rec.returnFocus || rec.trigger;
        if (back && back.focus) back.focus();
      }
    };
    trigger && trigger.addEventListener("click", function () { toggle(!readOpen()); });
    if (panel._puiClose) panel._puiClose.addEventListener("click", function () { toggle(false); });
    if (modal) backdrop.addEventListener("click", function () { toggle(false); });
    panel.addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); toggle(false); } });
    rec.render = render;
    rec.toggle = toggle;
    this.drawerRecords.push(rec);
    render();
    return root;
  };

  Renderer.prototype.drawerRecord = function (id) {
    for (var i = 0; i < this.drawerRecords.length; i++) {
      if (String(this.drawerRecords[i].block && this.drawerRecords[i].block.id || "") === String(id || "")) return this.drawerRecords[i];
    }
    return null;
  };

  Renderer.prototype.setDrawerOpen = function (id, open) {
    var rec = this.drawerRecord(id);
    if (!rec) return false;
    rec.toggle(!!open);
    return true;
  };

  Renderer.prototype.openDrawer = function (id) { return this.setDrawerOpen(id, true); };
  Renderer.prototype.closeDrawer = function (id) { return this.setDrawerOpen(id, false); };
  Renderer.prototype.toggleDrawer = function (id) {
    var rec = this.drawerRecord(id);
    if (!rec) return false;
    rec.toggle(!rec.open);
    return true;
  };

  Renderer.prototype.buildCurve = function (block) {
    var self = this;
    var Curve = global.PupitreCurve;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    if (!Curve) return el("p", {class: "pui-missing", text: "(curve model PupitreCurve is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(curve value is missing)"});
    if (isArray(value.series)) return this.buildSeriesCurve(block, value);
    var root = el("section", {class: "pui-curve", "data-pui-curve": path});
    var head = el("div", {class: "pui-curve-head"});
    head.appendChild(el("h4", {text: String(block.label || block.id || "Envelope")}));
    var shape = el("select", {"aria-label": "Curve shape"});
    [["linear", "Linear"], ["smooth", "Smooth"], ["hold", "Hold"]].forEach(function (entry) {
      shape.appendChild(el("option", {value: entry[0], text: entry[1]}));
    });
    shape.value = Curve.normalize(value).curve;
    head.appendChild(shape);
    var reset = null;
    if (block.default && isObject(block.default)) {
      reset = el("button", {type: "button", class: "pui-button", text: "Reset"});
      head.appendChild(reset);
    }
    root.appendChild(head);
    var fields = el("div", {class: "pui-curve-fields"});
    var inputs = {};
    [["attack", "A"], ["decay", "D"], ["sustain", "S"], ["hold", "H"], ["release", "R"]].forEach(function (entry) {
      var label = el("label", {class: "pui-curve-field"});
      label.appendChild(el("span", {text: entry[1]}));
      var input = el("input", {type: "number", min: "0", step: "0.01", "aria-label": entry[0]});
      input.value = String(Curve.normalize(value)[entry[0]]);
      label.appendChild(input);
      fields.appendChild(label);
      inputs[entry[0]] = input;
    });
    root.appendChild(fields);
    var chart = el("div", {class: "pui-curve-chart", style: "height:" + String(block.height || 220) + "px;", role: "group", "aria-label": String(block.label || "ADSR curve")});
    var svg = svgEl("svg", {class: "pui-curve-svg", viewBox: "0 0 1000 240", preserveAspectRatio: "none", "aria-hidden": "true"});
    var pathEl = svgEl("path", {class: "pui-curve-path"});
    svg.appendChild(pathEl);
    chart.appendChild(svg);
    root.appendChild(chart);
    var rec = {block: block, path: path, value: value, root: root, chart: chart, pathEl: pathEl, inputs: inputs, shape: shape, handleEls: {}, drag: null};
    var chartRect = function () { return chart.getBoundingClientRect ? chart.getBoundingClientRect() : {left: 0, top: 0, width: 1, height: 1}; };
    var update = function () {
      rec.pathEl.setAttribute("d", Curve.path(rec.value, 1000, 240));
      var state = Curve.normalize(rec.value);
      var pts = Curve.points(state);
      var byId = {};
      pts.forEach(function (point) { byId[point.id] = point; });
      Object.keys(rec.handleEls).forEach(function (id) {
        var point = byId[id];
        if (!point) return;
        var handle = rec.handleEls[id];
        handle.style.left = (point.x / Math.max(0.001, state.duration) * 100) + "%";
        var chartHeight = chart.clientHeight || Number(block.height) || 220;
        handle.style.top = Math.max(8, Math.min(chartHeight - 8, (1 - point.y) * chartHeight)) + "px";
        handle.setAttribute("aria-label", id + " at " + point.x.toFixed(2) + "s, level " + point.y.toFixed(2));
      });
      Object.keys(inputs).forEach(function (key) { inputs[key].value = String(state[key]); });
    };
    ["attack", "decay", "hold", "release"].forEach(function (id) {
      var handle = el("button", {type: "button", class: "pui-curve-handle is-" + id, "data-curve-handle": id});
      handle.addEventListener("pointerdown", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        rec.drag = {id: id, start: deepClone(rec.value), x: event.clientX || 0, y: event.clientY || 0};
        rec.lastX = event.clientX || 0; rec.lastY = event.clientY || 0;
        if (chart.setPointerCapture) chart.setPointerCapture(event.pointerId || 1);
      });
      chart.appendChild(handle);
      rec.handleEls[id] = handle;
    });
    var finish = function () {
      if (!rec.drag) return;
      var drag = rec.drag;
      rec.drag = null;
      if (Math.abs((rec.lastX || 0) - drag.x) + Math.abs((rec.lastY || 0) - drag.y) > 0) self.curveWrite(rec, {op: "curve.edit", handle: drag.id});
    };
    chart.addEventListener("pointermove", function (event) {
      if (!rec.drag) return;
      rec.lastX = event.clientX || 0; rec.lastY = event.clientY || 0;
      var box = chartRect();
      var start = Curve.normalize(rec.drag.start);
      var dx = (event.clientX || 0) - rec.drag.x;
      var dy = (event.clientY || 0) - rec.drag.y;
      var dt = dx / Math.max(1, box.width) * start.duration;
      var id = rec.drag.id;
      if (id === "attack") rec.value.attack = Math.max(0, Math.round((start.attack + dt) * 100) / 100);
      else if (id === "decay") { rec.value.decay = Math.max(0, Math.round((start.decay + dt) * 100) / 100); rec.value.sustain = Math.max(0, Math.min(1, Math.round((start.sustain - dy / Math.max(1, box.height)) * 100) / 100)); }
      else if (id === "hold") rec.value.hold = Math.max(0, Math.round((start.hold + dt) * 100) / 100);
      else if (id === "release") rec.value.release = Math.max(0, Math.round((start.release + dt) * 100) / 100);
      update();
    });
    chart.addEventListener("pointerup", finish);
    chart.addEventListener("pointercancel", finish);
    Object.keys(inputs).forEach(function (key) {
      inputs[key].addEventListener("change", function () {
        rec.value[key] = Math.max(0, Number(inputs[key].value) || 0);
        if (key === "sustain") rec.value[key] = Math.min(1, rec.value[key]);
        update();
        self.curveWrite(rec, {op: "curve.edit", handle: key});
      });
    });
    shape.addEventListener("change", function () { rec.value.curve = shape.value; update(); self.curveWrite(rec, {op: "curve.shape", shape: shape.value}); });
    if (reset) reset.addEventListener("click", function () { rec.value = Object.assign({}, block.default); update(); self.curveWrite(rec, {op: "curve.reset"}); });
    update();
    return root;
  };

  Renderer.prototype.buildSeriesCurve = function (block, value) {
    var self = this;
    var path = String(block.bind || "");
    var Series = global.PupitreCurve;
    var options = isObject(block.curve_options) ? block.curve_options : {};
    var series = value.series.map(function (entry, index) {
      if (!isObject(entry)) return {id: "s" + index, label: "Series " + (index + 1), points: []};
      return {
        id: String(entry.id || "s" + index),
        label: String(entry.label || entry.id || "Series " + (index + 1)),
        color: entry.color,
        points: isArray(entry.points) ? entry.points.filter(isObject).map(function (point) {
          return {x: Number(point.x) || 0, y: Number(point.y) || 0};
        }) : []
      };
    });
    var root = el("section", {class: "pui-curve pui-series-curve", "data-pui-curve": path});
    var head = el("div", {class: "pui-curve-head"});
    head.appendChild(el("h4", {text: String(block.label || block.id || "Curves")}));
    var activeSeries = 0;
    var seriesSelect = null;
    if (series.length > 1) {
      seriesSelect = el("select", {"aria-label": "Curve series"});
      series.forEach(function (entry, index) { seriesSelect.appendChild(el("option", {value: String(index), text: entry.label})); });
      seriesSelect.addEventListener("change", function () { activeSeries = Number(seriesSelect.value) || 0; self.seriesCurveRefresh(rec); });
      head.appendChild(seriesSelect);
    }
    if (!block.readonly) {
      var addPoint = el("button", {type: "button", class: "pui-button", text: "Add point"});
      addPoint.addEventListener("click", function () {
        var entry = series[activeSeries];
        if (!entry) return;
        var last = entry.points[entry.points.length - 1];
        var x = last ? Math.min(1, last.x + 0.1) : 0.5;
        entry.points.push({x: x, y: last ? last.y : 0.5});
        self.seriesCurveRefresh(rec);
        self.curveWrite(rec, {op: "series.add", series: entry.id, index: entry.points.length - 1});
      });
      head.appendChild(addPoint);
    }
    root.appendChild(head);
    var chart = el("div", {class: "pui-curve-chart pui-series-chart", style: "height:" + String(block.height || 260) + "px;", role: "group", "aria-label": String(block.label || "Curve series")});
    var svg = svgEl("svg", {class: "pui-curve-svg", viewBox: "0 0 1000 260", preserveAspectRatio: "none", "aria-hidden": "true"});
    var grid = svgEl("g", {class: "pui-series-grid"});
    for (var g = 1; g < 4; g++) {
      grid.appendChild(svgEl("line", {x1: 0, y1: 65 * g, x2: 1000, y2: 65 * g}));
    }
    svg.appendChild(grid);
    var pathEls = [];
    series.forEach(function (entry, index) {
      var pathEl = svgEl("path", {class: "pui-curve-path", "data-series": entry.id, style: entry.color ? "stroke:" + entry.color + ";" : ""});
      svg.appendChild(pathEl);
      pathEls.push(pathEl);
    });
    chart.appendChild(svg);
    root.appendChild(chart);
    value.series = series;
    var rec = {block: block, path: path, value: value, series: series, root: root, chart: chart, svg: svg, pathEls: pathEls,
      activeSeries: activeSeries, selected: null, drag: null, options: options, seriesSelect: seriesSelect,
      pointEls: [], intent: "series.edit"};
    var bounds = function () {
      var points = [];
      series.forEach(function (entry) { points = points.concat(entry.points); });
      var xMin = Number(options.x_min); if (!isFinite(xMin)) xMin = 0;
      var xMax = Number(options.x_max); if (!isFinite(xMax)) xMax = 1;
      var yMin = Number(options.y_min); if (!isFinite(yMin)) yMin = 0;
      var yMax = Number(options.y_max); if (!isFinite(yMax)) yMax = 1;
      return {xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax};
    };
    var toSvg = function (point) {
      var b = bounds();
      var x = ((point.x - b.xMin) / Math.max(0.000001, b.xMax - b.xMin)) * 1000;
      var y = 260 - ((point.y - b.yMin) / Math.max(0.000001, b.yMax - b.yMin)) * 260;
      return {x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(260, y))};
    };
    var fromEvent = function (event) {
      var box = chart.getBoundingClientRect ? chart.getBoundingClientRect() : {left: 0, top: 0, width: 1, height: 1};
      var b = bounds();
      return {
        x: b.xMin + ((Number(event.clientX) - box.left) / Math.max(1, box.width)) * (b.xMax - b.xMin),
        y: b.yMin + (1 - (Number(event.clientY) - box.top) / Math.max(1, box.height)) * (b.yMax - b.yMin)
      };
    };
    var update = function () {
      series.forEach(function (entry, index) {
        var points = entry.points.map(toSvg);
        var d = points.length ? "M " + points.map(function (p) { return p.x + " " + p.y; }).join(" L ") : "";
        pathEls[index].setAttribute("d", d);
      });
      if (rec.pointsLayer && rec.pointsLayer.parentNode) rec.pointsLayer.parentNode.removeChild(rec.pointsLayer);
      var layer = svgEl("g", {class: "pui-series-points"});
      rec.pointEls = [];
      series.forEach(function (entry, sIndex) {
        entry.points.forEach(function (point, pIndex) {
          var at = toSvg(point);
          var dot = svgEl("circle", {cx: at.x, cy: at.y, r: 7, class: "pui-curve-point", tabindex: "0", role: "button", "data-series": entry.id, "data-point": String(pIndex), "aria-label": entry.label + " point " + (pIndex + 1) + " at " + point.x + ", " + point.y});
          dot.addEventListener("focus", function () { rec.selected = {series: sIndex, point: pIndex}; });
          dot.addEventListener("pointerdown", function (event) {
            if (event.stopPropagation) event.stopPropagation();
            event.preventDefault && event.preventDefault();
            rec.selected = {series: sIndex, point: pIndex};
            rec.drag = {series: sIndex, point: pIndex, start: {x: point.x, y: point.y}};
            if (chart.setPointerCapture) chart.setPointerCapture(event.pointerId || 1);
          });
          dot.addEventListener("keydown", function (event) {
            if (event.key === "Delete" || event.key === "Backspace") {
              if (!block.readonly && entry.points.length > 1) {
                event.preventDefault();
                entry.points.splice(pIndex, 1);
                rec.selected = null;
                update();
                self.curveWrite(rec, {op: "series.remove", series: entry.id});
              }
            } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].indexOf(event.key) >= 0) {
              event.preventDefault();
              var step = event.shiftKey ? 0.1 : event.altKey ? 0.001 : 0.01;
              if (event.key === "ArrowLeft") point.x -= step;
              if (event.key === "ArrowRight") point.x += step;
              if (event.key === "ArrowUp") point.y += step;
              if (event.key === "ArrowDown") point.y -= step;
              point.x = Math.max(bounds().xMin, Math.min(bounds().xMax, point.x));
              point.y = Math.max(bounds().yMin, Math.min(bounds().yMax, point.y));
              update();
              self.curveWrite(rec, {op: "series.edit", series: entry.id});
            }
          });
          layer.appendChild(dot);
          rec.pointEls.push(dot);
        });
      });
      svg.appendChild(layer);
      rec.pointsLayer = layer;
      if (seriesSelect) seriesSelect.value = String(rec.activeSeries || 0);
    };
    rec.refresh = update;
    var move = function (event) {
      if (!rec.drag) return;
      var point = series[rec.drag.series].points[rec.drag.point];
      var next = fromEvent(event);
      point.x = Math.max(bounds().xMin, Math.min(bounds().xMax, next.x));
      point.y = Math.max(bounds().yMin, Math.min(bounds().yMax, next.y));
      update();
    };
    var up = function () {
      if (!rec.drag) return;
      var drag = rec.drag;
      rec.drag = null;
      self.curveWrite(rec, {op: "series.edit", series: series[drag.series].id, point: drag.point});
    };
    chart.addEventListener("pointermove", move);
    chart.addEventListener("pointerup", up);
    chart.addEventListener("pointercancel", up);
    chart.addEventListener("dblclick", function (event) {
      if (block.readonly || !series[activeSeries]) return;
      var point = fromEvent(event);
      series[activeSeries].points.push({x: point.x, y: point.y});
      series[activeSeries].points.sort(function (a, b) { return a.x - b.x; });
      update();
      self.curveWrite(rec, {op: "series.add", series: series[activeSeries].id});
    });
    update();
    return root;
  };

  Renderer.prototype.seriesCurveRefresh = function (rec) {
    if (rec && typeof rec.refresh === "function") rec.refresh();
  };

  Renderer.prototype.curveWrite = function (rec, intent) {
    this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
    if (typeof this.adapter.curveAction === "function") {
      try { this.adapter.curveAction(intent || {}, rec.value, rec.block); } catch (error) { this.adapter.announce("error", "Curve action failed: " + String(error && error.message || error)); }
    }
  };

  Renderer.prototype.codeTokens = function (text, language) {
    var out = [];
    var source = String(text);
    var lang = String(language || "json").toLowerCase();
    if (lang === "json") {
      var re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}\[\],:])/g;
      var last = 0;
      var match;
      while ((match = re.exec(source))) {
        if (match.index > last) out.push({text: source.slice(last, match.index), cls: ""});
        if (match[1]) {
          out.push({text: match[1], cls: match[2] ? "pui-code-key" : "pui-code-string"});
          if (match[2]) out.push({text: match[2], cls: "pui-code-punct"});
        } else if (match[3]) out.push({text: match[3], cls: "pui-code-number"});
        else if (match[4]) out.push({text: match[4], cls: "pui-code-literal"});
        else if (match[5]) out.push({text: match[5], cls: "pui-code-punct"});
        last = re.lastIndex;
      }
      if (last < source.length) out.push({text: source.slice(last), cls: ""});
      return out;
    }
    var generic = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\/\/[^\n]*|#[^\n]*)|(-?\d+(?:\.\d+)?)|\b(true|false|null|undefined|function|return|if|else|for|while|const|let|var|class|import|export)\b|([{}()\[\],.:;=+\-*\/])/g;
    var cursor = 0;
    while ((match = generic.exec(source))) {
      if (match.index > cursor) out.push({text: source.slice(cursor, match.index), cls: ""});
      out.push({text: match[0], cls: match[1] ? "pui-code-string" : match[2] ? "pui-code-comment" : match[3] ? "pui-code-number" : match[4] ? "pui-code-keyword" : "pui-code-punct"});
      cursor = generic.lastIndex;
    }
    if (cursor < source.length) out.push({text: source.slice(cursor), cls: ""});
    return out;
  };

  Renderer.prototype.buildCode = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var initial = this.adapter.getValue(path);
    if (initial === undefined) initial = block.value;
    var text = initial === undefined || initial === null ? "" : (typeof initial === "string" ? initial : JSON.stringify(initial, null, 2));
    var label = String(block.label || block.id || "Editor");
    var language = String(block.language || "json").toLowerCase();
    var root = el("section", {class: "pui-code", "data-pui-code": path});
    var head = el("div", {class: "pui-code-head"});
    head.appendChild(el("h4", {text: label}));
    head.appendChild(el("span", {class: "pui-code-language", text: language.toUpperCase()}));
    var apply = el("button", {type: "button", class: "pui-button pui-primary", text: self.t("action.save", "Apply")});
    apply.disabled = !!block.readonly;
    head.appendChild(apply);
    root.appendChild(head);
    var editor = el("div", {class: "pui-code-editor", style: "height:" + String(block.height || 260) + "px;"});
    var gutter = el("div", {class: "pui-code-gutter", "aria-hidden": "true"});
    var highlight = el("pre", {class: "pui-code-highlight", "aria-hidden": "true"});
    var area = el("textarea", {class: "pui-code-input", spellcheck: "false", "aria-label": label, readonly: !!block.readonly});
    area.value = text;
    editor.appendChild(gutter); editor.appendChild(highlight); editor.appendChild(area);
    root.appendChild(editor);
    var status = el("p", {class: "pui-code-status", role: "status", "aria-live": "polite"});
    root.appendChild(status);
    var rec = {block: block, path: path, area: area, highlight: highlight, status: status, dirty: false, text: text, setHighlight: null, setStatus: null, liveTimer: null};
    var setHighlight = function (value) {
      highlight.textContent = "";
      self.codeTokens(value, language).forEach(function (token) {
        highlight.appendChild(el("span", token.cls ? {class: token.cls, text: token.text} : {text: token.text}));
      });
      highlight.appendChild(document.createTextNode("\n"));
      gutter.textContent = "";
      var lines = String(value).split("\n").length;
      for (var i = 1; i <= lines; i++) gutter.appendChild(el("span", {text: String(i)}));
      highlight.scrollTop = area.scrollTop;
      highlight.scrollLeft = area.scrollLeft;
      gutter.scrollTop = area.scrollTop;
    };
    var setStatus = function (message, error) {
      status.textContent = message || "";
      status.className = "pui-code-status" + (error ? " is-error" : "");
    };
    rec.setHighlight = setHighlight;
    rec.setStatus = setStatus;
    this.codeRecords.push(rec);
    var highlightFrame = null;
    var scheduleHighlight = function () {
      if (highlightFrame) return;
      var schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : function (callback) { return setTimeout(callback, 16); };
      highlightFrame = schedule(function () {
        highlightFrame = null;
        setHighlight(area.value);
      });
    };
    area.addEventListener("input", function () {
      rec.dirty = true;
      rec.text = area.value;
      scheduleHighlight();
      setStatus("", false);
      if (block.live) {
        if (rec.liveTimer) clearTimeout(rec.liveTimer);
        rec.liveTimer = setTimeout(function () {
          rec.liveTimer = null;
          if (self.write(path, area.value, block) !== false) { rec.dirty = false; rec.text = area.value; }
        }, Number(block.throttle) > 0 ? Number(block.throttle) : 180);
      }
    });
    area.addEventListener("scroll", function () { highlight.scrollTop = area.scrollTop; highlight.scrollLeft = area.scrollLeft; gutter.scrollTop = area.scrollTop; });
    apply.addEventListener("click", function () {
      var value = area.value;
      if (language === "json" || block.validate === "json") {
        try { JSON.parse(value); }
        catch (error) { setStatus("Invalid JSON: " + String(error.message || error), true); return; }
      }
      if (self.write(path, value, block) === false) { setStatus("Host rejected the value.", true); return; }
      rec.dirty = false;
      rec.text = value;
      setStatus("Applied.", false);
      if (typeof self.adapter.codeAction === "function") {
        try { self.adapter.codeAction({op: "code.apply", path: path, language: language}, value, block); } catch (error) { self.adapter.announce("error", "Code action failed: " + String(error && error.message || error)); }
      }
    });
    setHighlight(text);
    return root;
  };

  Renderer.prototype.buildWorkflow = function (block) {
    var self = this;
    var Workflow = global.PupitreWorkflow;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Workflow");
    if (!Workflow) return el("p", {class: "pui-missing", text: "(workflow model PupitreWorkflow is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(workflow value is missing)"});
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-workflow", "data-pui-workflow": path});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, value: value, root: root};
    var render = function () { self.workflowRender(rec); };
    rec.render = render;
    render();
    return root;
  };

  Renderer.prototype.workflowRender = function (rec) {
    var self = this;
    var Workflow = global.PupitreWorkflow;
    if (!Workflow || !rec || !rec.root) return;
    var state = Workflow.normalize(rec.value);
    var step = state.steps[state.currentIndex] || null;
    rec.root.textContent = "";
    var head = el("div", {class: "pui-workflow-head"});
    head.appendChild(el("h4", {text: String(rec.value.title || rec.block.label || "Workflow")}));
    head.appendChild(el("span", {class: "pui-workflow-progress", text: state.progress + "% · " + state.completed.length + "/" + state.steps.length + " complete"}));
    if (state.offline || (global.PupitreFile && !global.PupitreFile.isOnline())) head.appendChild(el("span", {class: "pui-workflow-offline", text: "Offline"}));
    if (state.complete) head.appendChild(el("span", {class: "pui-workflow-complete", text: "Complete"}));
    rec.root.appendChild(head);
    var stepper = el("ol", {class: "pui-workflow-steps", role: "list"});
    state.steps.forEach(function (item, index) {
      var id = String(item.id);
      var done = state.completed.indexOf(id) >= 0;
      var skipped = state.skipped.indexOf(id) >= 0;
      var button = el("button", {type: "button", class: "pui-workflow-step" + (index === state.currentIndex ? " is-current" : "") + (done ? " is-done" : "") + (skipped ? " is-skipped" : ""), text: String(index + 1) + ". " + String(item.label || id)});
      if (index === state.currentIndex) button.setAttribute("aria-current", "step");
      button.addEventListener("click", function () { rec.value.current = id; self.workflowWrite(rec, {op: "workflow.step", id: id}); self.workflowRender(rec); });
      var li = el("li"); li.appendChild(button); stepper.appendChild(li);
    });
    rec.root.appendChild(stepper);
    if (step) {
      var body = el("div", {class: "pui-workflow-body", role: "region", "aria-live": "polite"});
      body.appendChild(el("h5", {text: String(step.label || step.id)}));
      if (step.description) body.appendChild(el("p", {text: String(step.description)}));
      if (isArray(step.issues) && step.issues.length) {
        var issues = el("ul", {class: "pui-workflow-issues"});
        step.issues.forEach(function (issue) {
          if (!isObject(issue)) return;
          var item = el("li", {class: "is-" + String(issue.level || "warning")});
          var button = el("button", {type: "button", class: "pui-workflow-issue", text: String(issue.text || issue.message || "Issue")});
          button.addEventListener("click", function () {
            if (isObject(issue.route)) self.navigate(issue.route);
            self.workflowAction(rec, {op: "workflow.issue", issue: issue.id || issue.text, route: issue.route || null});
          });
          item.appendChild(button); issues.appendChild(item);
        });
        body.appendChild(issues);
      }
      if (isObject(step.route)) {
        var open = el("button", {type: "button", class: "pui-button", text: "Open step"});
        open.addEventListener("click", function () { self.navigate(step.route); });
        body.appendChild(open);
      }
      var actions = el("div", {class: "pui-workflow-actions"});
      var back = el("button", {type: "button", class: "pui-button", text: "Back"});
      back.disabled = state.currentIndex === 0;
      back.addEventListener("click", function () {
        var previous = state.steps[state.currentIndex - 1];
        if (!previous) return;
        rec.value.current = String(previous.id);
        self.workflowWrite(rec, {op: "workflow.back", id: rec.value.current});
        self.workflowRender(rec);
      });
      var skip = el("button", {type: "button", class: "pui-button", text: "Skip"});
      skip.addEventListener("click", function () {
        if (state.skipped.indexOf(String(step.id)) < 0) state.skipped.push(String(step.id));
        rec.value.skipped = state.skipped;
        self.workflowWrite(rec, {op: "workflow.skip", id: step.id});
        self.workflowRender(rec);
      });
      var next = el("button", {type: "button", class: "pui-button pui-primary", text: state.currentIndex === state.steps.length - 1 ? "Finish" : "Next"});
      next.addEventListener("click", function () {
        var nextStep = state.steps[state.currentIndex + 1];
        rec.value.current = String(nextStep ? nextStep.id : step.id);
        if (state.currentIndex === state.steps.length - 1) {
          if (state.completed.indexOf(String(step.id)) < 0) state.completed.push(String(step.id));
          rec.value.completed = state.completed;
        }
        self.workflowWrite(rec, {op: "workflow.next", id: rec.value.current});
        self.workflowRender(rec);
      });
      actions.appendChild(back); actions.appendChild(skip); actions.appendChild(next); body.appendChild(actions);
      rec.root.appendChild(body);
    }
    if (state.captures.length) {
      var captures = el("div", {class: "pui-workflow-captures"});
      captures.appendChild(el("h5", {text: "Capture manifest"}));
      var list = el("ul");
      state.captures.forEach(function (shot) {
        var item = el("li", {class: "pui-workflow-capture"});
        item.appendChild(el("strong", {text: String(shot.label || shot.id)}));
        item.appendChild(el("span", {class: "pui-workflow-capture-status", text: String(shot.status || "planned")}));
        if (shot.purpose) item.appendChild(el("span", {text: String(shot.purpose)}));
        list.appendChild(item);
      });
      captures.appendChild(list);
      var download = el("button", {type: "button", class: "pui-button", text: "Download capture manifest"});
      download.addEventListener("click", function () {
        var manifest = Workflow.captureManifest(rec.value);
        self.workflowAction(rec, {op: "capture.manifest", manifest: manifest});
        if (global.PupitreFile && global.PupitreFile.download) global.PupitreFile.download("capture-manifest.json", JSON.stringify(manifest, null, 2), "application/json");
      });
      captures.appendChild(download);
      rec.root.appendChild(captures);
    }
  };

  Renderer.prototype.workflowWrite = function (rec, intent) {
    this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
    this.workflowAction(rec, intent);
  };

  Renderer.prototype.workflowAction = function (rec, intent) {
    if (typeof this.adapter.workflowAction !== "function") return;
    try { this.adapter.workflowAction(intent || {}, rec.value, rec.block); } catch (error) { this.adapter.announce("error", "Workflow action failed: " + String(error && error.message || error)); }
  };

  /** Generic mapping canvas: DOM/SVG shapes + focusable HTML handles. Hosts
   * own mapping data/execution; PUI owns view, hit-testing, selection and edits. */
  Renderer.prototype.buildCanvas = function (block) {
    var self = this;
    var Canvas = global.PupitreCanvas;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Canvas");
    if (!Canvas) return el("p", {class: "pui-missing", text: "(canvas model PupitreCanvas is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(canvas value is missing)"});
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var options = isObject(block.canvas_options) ? block.canvas_options : {};
    var root = el("section", {class: "pui-canvas", "data-pui-canvas": path});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var contextList = Canvas.contexts(value);
    var activeContext = Canvas.activeContext(value, contextList);
    var stageState = Canvas.stageState(value);
    var showContext = Canvas.hasContext(value) && contextList.length > 0;
    var rec = {block: block, path: path, value: value, root: root, options: options,
      view: isObject(value.view) ? {zoom: Number(value.view.zoom) > 0 ? Number(value.view.zoom) : 1, panX: Number(value.view.panX) || 0, panY: Number(value.view.panY) || 0} : {zoom: 1, panX: 0, panY: 0},
      selected: {}, selectedRegion: "", drag: null, pan: null, marquee: null, regionDrag: null,
      undo: [], redo: [], handleEls: {}, layerEls: [], regionEls: [], regionPaintEls: {}, paintMap: "alpha",
      contexts: contextList, activeContext: activeContext ? activeContext.id : "", stageMode: stageState.mode,
      showContext: showContext, contextBar: null, contextButtons: {}, stageButtons: {}};
    (isArray(value.selected) ? value.selected : []).forEach(function (id) { rec.selected[String(id)] = true; });
    if (value.selected_region) rec.selectedRegion = String(value.selected_region);
    else if (activeContext && activeContext.region) rec.selectedRegion = activeContext.region;
    if (showContext) root.classList.add("is-contextual");
    root.setAttribute("data-stage-mode", rec.stageMode);
    if (options.context_only === true) {
      root.classList.add("is-context-only");
      rec.render = function () { self.canvasContextOnlyRefresh(rec); };
      this.canvasRecords.push(rec);
      rec.render();
      return root;
    }
    var head = el("div", {class: "pui-canvas-head"});
    head.appendChild(el("h4", {text: label}));
    var count = el("span", {class: "pui-canvas-count", text: (value.handles || []).length + " handles · " + (value.layers || []).length + " layers"});
    head.appendChild(count);
    if (!block.readonly) {
      var fit = el("button", {type: "button", class: "pui-button", text: "Fit"});
      fit.addEventListener("click", function () { self.canvasFit(rec); });
      var undo = el("button", {type: "button", class: "pui-button", text: "Undo"});
      undo.addEventListener("click", function () { self.canvasUndo(rec); });
      var redo = el("button", {type: "button", class: "pui-button", text: "Redo"});
      redo.addEventListener("click", function () { self.canvasRedo(rec); });
      head.appendChild(fit); head.appendChild(undo); head.appendChild(redo);
      var tools = el("div", {class: "pui-canvas-tools"});
      [["L", "x", "min"], ["C", "x", "center"], ["R", "x", "max"], ["T", "y", "min"], ["M", "y", "center"], ["B", "y", "max"]].forEach(function (entry) {
        var button = el("button", {type: "button", class: "pui-button pui-canvas-align", text: entry[0], "aria-label": "Align " + entry[1] + " " + entry[2]});
        button.addEventListener("click", function () { self.canvasAlign(rec, entry[1], entry[2]); });
        tools.appendChild(button);
      });
      var distributeH = el("button", {type: "button", class: "pui-button", text: "Dist H", "aria-label": "Distribute horizontally"});
      distributeH.addEventListener("click", function () { self.canvasDistribute(rec, "x"); });
      var distributeV = el("button", {type: "button", class: "pui-button", text: "Dist V", "aria-label": "Distribute vertically"});
      distributeV.addEventListener("click", function () { self.canvasDistribute(rec, "y"); });
      tools.appendChild(distributeH); tools.appendChild(distributeV);
      if (isObject(value.source)) {
        var adopt = el("button", {type: "button", class: "pui-button", text: "Adopt source"});
        adopt.addEventListener("click", function () { self.canvasAdoptSource(rec); });
        tools.appendChild(adopt);
      }
      var hasRegionMaps = (value.regions || []).some(function (region) {
        return isObject(region) && (isObject(region.alpha) || isObject(region.beta));
      });
      if (isObject(value.paint) || hasRegionMaps) {
        var paint = el("button", {type: "button", class: "pui-button pui-canvas-paint-toggle", text: "Paint", "aria-pressed": "false"});
        paint.addEventListener("click", function () {
          rec.paintMode = !rec.paintMode;
          paint.setAttribute("aria-pressed", rec.paintMode ? "true" : "false");
          paint.classList.toggle("is-active", rec.paintMode);
          viewport.classList.toggle("is-painting", rec.paintMode);
        });
        tools.appendChild(paint);
        var tool = el("select", {"aria-label": "Paint tool"});
        [["lower", "Lower"], ["raise", "Raise"], ["smooth", "Smooth"], ["restore", "Restore"]].forEach(function (entry) {
          tool.appendChild(el("option", {value: entry[0], text: entry[1]}));
        });
        tool.value = rec.paintTool || "lower";
        tool.addEventListener("change", function () { rec.paintTool = tool.value; });
        tools.appendChild(tool);
        if (hasRegionMaps) {
          var mapSelect = el("select", {"aria-label": "Blend map"});
          [["alpha", "Alpha"], ["beta", "Beta"]].forEach(function (entry) { mapSelect.appendChild(el("option", {value: entry[0], text: entry[1]})); });
          mapSelect.value = rec.paintMap;
          mapSelect.addEventListener("change", function () { rec.paintMap = mapSelect.value; });
          tools.appendChild(mapSelect);
        }
      }
      if (isArray(value.regions) && value.regions.length) {
        var regionTools = el("div", {class: "pui-canvas-regions", role: "group", "aria-label": "Regions"});
        value.regions.forEach(function (region) {
          if (!isObject(region)) return;
          var regionButton = el("button", {type: "button", class: "pui-button pui-canvas-region-button", text: String(region.label || region.id || "Region"), "aria-pressed": "false"});
          regionButton.setAttribute("data-pui-region", String(region.id || ""));
          regionButton.addEventListener("click", function () { self.canvasSelectRegion(rec, String(region.id || ""), true); });
          regionTools.appendChild(regionButton);
        });
        head.appendChild(regionTools);
      }
      if (isArray(value.groups) && value.groups.length) {
        var groupTools = el("div", {class: "pui-canvas-groups", role: "group", "aria-label": "Canvas groups"});
        value.groups.forEach(function (group) {
          if (!isObject(group) || !isArray(group.handles)) return;
          var groupButton = el("button", {type: "button", class: "pui-button pui-canvas-group", text: String(group.label || group.id || "Group"), "aria-pressed": "false"});
          groupButton.setAttribute("data-pui-group", String(group.id || ""));
          groupButton.addEventListener("click", function () { self.canvasSelectGroup(rec, group); });
          groupTools.appendChild(groupButton);
        });
        head.appendChild(groupTools);
      }
      head.appendChild(tools);
    }
    if (value.profile) head.appendChild(el("span", {class: "pui-canvas-profile", text: String(value.profile)}));
    root.appendChild(head);
    if (showContext) root.appendChild(this.canvasContextBar(rec));
    var viewport = el("div", {class: "pui-canvas-viewport", tabindex: "0", role: "group", "aria-label": (a11y.name || label) + " canvas"});
    var content = el("div", {class: "pui-canvas-content"});
    var svg = svgEl("svg", {class: "pui-canvas-shapes", "aria-hidden": "true"});
    content.appendChild(svg);
    viewport.appendChild(content);
    root.appendChild(viewport);
    rec.viewport = viewport;
    rec.content = content;
    rec.svg = svg;
    var render = function () { self.canvasRender(rec); };
    rec.render = render;
    this.canvasRecords.push(rec);
    render();
    viewport.addEventListener("wheel", function (event) { self.canvasWheel(rec, event); }, {passive: false});
    viewport.addEventListener("pointerdown", function (event) { self.canvasPointerDown(rec, event); });
    viewport.addEventListener("pointermove", function (event) { self.canvasPointerMove(rec, event); });
    viewport.addEventListener("pointerup", function (event) { self.canvasPointerUp(rec, event); });
    viewport.addEventListener("keydown", function (event) { self.canvasKeydown(rec, event); });
    if (options.live_slot) {
      var live = this.buildCustom({kind: "custom", slot: String(options.live_slot), label: "Live inset", a11y: {name: "Live inset"}});
      live.classList.add("pui-canvas-live");
      root.appendChild(live);
    }
    var outline = el("details", {class: "pui-canvas-outline"});
    outline.appendChild(el("summary", {text: "Canvas outline"}));
    var list = el("ul");
    (value.handles || []).forEach(function (handle) {
      if (!isObject(handle)) return;
      var item = el("li");
      var button = el("button", {type: "button", class: "pui-canvas-outline-handle", text: String(handle.id) + " · " + Number(handle.x) + "," + Number(handle.y)});
      button.addEventListener("click", function () { self.canvasSelect(rec, handle.id, false); });
      item.appendChild(button);
      list.appendChild(item);
    });
    outline.appendChild(list);
    root.appendChild(outline);
    this.canvasApplyView(rec);
    if (options.fit_on_mount === true) {
      // the viewport has no useful size until the host has inserted the node
      setTimeout(function () { if (rec.viewport) self.canvasFit(rec); }, 0);
    }
    try { rec.__valueSignature = JSON.stringify(rec.value); } catch (error) { rec.__valueSignature = null; }
    return root;
  };

  Renderer.prototype.canvasRender = function (rec) {
    var Canvas = global.PupitreCanvas;
    if (!Canvas || !rec) return;
    if (!rec.viewport) { this.canvasContextOnlyRefresh(rec); return; }
    var self = this;
    if (isObject(rec.value.view) && Number(rec.value.view.zoom) > 0) {
      rec.view = {zoom: Number(rec.value.view.zoom), panX: Number(rec.value.view.panX) || 0, panY: Number(rec.value.view.panY) || 0};
    }
    rec.handleEls = {};
    rec.layerEls = [];
    rec.svg.textContent = "";
    rec.svg.setAttribute("viewBox", "0 0 " + Number(rec.value.width) + " " + Number(rec.value.height));
    rec.svg.setAttribute("width", String(rec.value.width));
    rec.svg.setAttribute("height", String(rec.value.height));
    if (rec.backgroundEl && rec.backgroundEl.parentNode) rec.backgroundEl.parentNode.removeChild(rec.backgroundEl);
    rec.backgroundEl = null;
    if (rec.value.background !== undefined && rec.value.background !== null && rec.value.background !== "") {
      var background = isObject(rec.value.background) ? rec.value.background : {src: rec.value.background};
      var src = String(background.src || background.url || "");
      if (src) {
        var image = el("img", {class: "pui-canvas-background", src: src, alt: String(background.alt || "")});
        image.style.width = String(Number(background.width) || Number(rec.value.width)) + "px";
        image.style.height = String(Number(background.height) || Number(rec.value.height)) + "px";
        if (background.opacity !== undefined) image.style.opacity = String(background.opacity);
        rec.content.insertBefore(image, rec.svg);
        rec.backgroundEl = image;
      }
    }
    var grid = el("g", {class: "pui-canvas-grid"});
    var gridOptions = isObject(rec.options.grid) ? rec.options.grid : {};
    var divisions = Number(rec.options.grid_divisions !== undefined ? rec.options.grid_divisions : gridOptions.divisions);
    var spacing = Number(rec.options.grid || gridOptions.spacing || 64);
    if (divisions > 0) spacing = Number(rec.value.width) / divisions;
    if (spacing > 0) {
      var gridColor = rec.options.grid_color || gridOptions.color || "";
      var gridOpacity = rec.options.grid_opacity !== undefined ? rec.options.grid_opacity : gridOptions.opacity;
      var gridWeight = rec.options.grid_weight !== undefined ? rec.options.grid_weight : gridOptions.weight;
      var makeLine = function (x1, y1, x2, y2) {
        var attrs = {x1: x1, y1: y1, x2: x2, y2: y2};
        if (gridColor) attrs.stroke = gridColor;
        if (gridOpacity !== undefined) attrs["stroke-opacity"] = Number(gridOpacity);
        if (gridWeight !== undefined) attrs["stroke-width"] = Number(gridWeight);
        return svgEl("line", attrs);
      };
      for (var gx = 0; gx <= Number(rec.value.width); gx += spacing) grid.appendChild(makeLine(gx, 0, gx, rec.value.height));
      for (var gy = 0; gy <= Number(rec.value.height); gy += spacing) grid.appendChild(makeLine(0, gy, rec.value.width, gy));
    }
    rec.svg.appendChild(grid);
    rec.paintEls = [];
    if (isObject(rec.value.paint) && isArray(rec.value.paint.data) && Number(rec.value.paint.width) > 0 && Number(rec.value.paint.height) > 0) {
      var paintGroup = svgEl("g", {class: "pui-canvas-paint"});
      var cw = Number(rec.value.width) / Number(rec.value.paint.width);
      var ch = Number(rec.value.height) / Number(rec.value.paint.height);
      for (var py = 0; py < Number(rec.value.paint.height); py++) {
        for (var px = 0; px < Number(rec.value.paint.width); px++) {
          var index = py * Number(rec.value.paint.width) + px;
          var cell = Number(rec.value.paint.data[index] || 0);
          var rect = svgEl("rect", {class: "pui-canvas-paint-cell", x: px * cw, y: py * ch, width: cw, height: ch, "fill-opacity": String(cell / 255)});
          paintGroup.appendChild(rect);
          rec.paintEls.push(rect);
        }
      }
      rec.svg.appendChild(paintGroup);
    }
    rec.regionEls = [];
    rec.regionPaintEls = {};
    var currentContext = Canvas.activeContext(rec.value, rec.contexts);
    if (currentContext) rec.activeContext = currentContext.id;
    if ((!rec.selectedRegion || !rec.value.selected_region) && currentContext && currentContext.region) rec.selectedRegion = currentContext.region;
    var stageActive = rec.selectedRegion || (currentContext && currentContext.region) || "";
    var stage = Canvas.stageState(rec.value);
    rec.stageMode = stage.mode;
    rec.root.setAttribute("data-stage-mode", rec.stageMode);
    var stageDim = function (active) {
      if (!rec.showContext) return 1;
      if (rec.stageMode === "composite") return 1;
      if (rec.stageMode === "focus") return active ? 1 : 0.06;
      return active ? 1 : 0.34;
    };
    var regionGroup = svgEl("g", {class: "pui-canvas-regions"});
    (rec.value.regions || []).forEach(function (region) {
      if (!isObject(region)) return;
      var regionId = String(region.id || "");
      var active = regionId === stageActive;
      var dim = stageDim(active);
      var rect = svgEl("rect", {class: "pui-canvas-region" + (active ? " is-selected is-stage-active" : " is-stage-inactive"), "data-region-id": regionId,
        x: Number(region.x) || 0, y: Number(region.y) || 0, width: Math.max(1, Number(region.w) || 1), height: Math.max(1, Number(region.h) || 1),
        opacity: String(dim)});
      rect.addEventListener("pointerdown", function (event) {
        if (event.stopPropagation) event.stopPropagation();
        if (event.preventDefault) event.preventDefault();
        self.canvasSelectRegion(rec, regionId, false);
        if (rec.paintMode && !rec.block.readonly) {
          rec.paint = {start: deepClone(rec.value), region: regionId, map: rec.paintMap};
          self.canvasPaintAt(rec, self.canvasClientToCanvas(rec, event));
          return;
        }
        rec.regionDrag = {id: regionId, mode: "move", start: deepClone(rec.value), x: event.clientX || 0, y: event.clientY || 0, moved: false};
      });
      regionGroup.appendChild(rect);
      rec.regionEls.push({rect: rect, region: region});
      ["alpha", "beta"].forEach(function (channel) {
        var map = region[channel];
        if (!isObject(map) || !isArray(map.data) || Number(map.width) <= 0 || Number(map.height) <= 0) return;
        var cells = svgEl("g", {class: "pui-canvas-blend is-" + channel, opacity: String(dim)});
        var cw = Number(rect.getAttribute("width")) / Number(map.width);
        var ch = Number(rect.getAttribute("height")) / Number(map.height);
        var key = regionId + ":" + channel;
        rec.regionPaintEls[key] = [];
        for (var my = 0; my < Number(map.height); my++) {
          for (var mx = 0; mx < Number(map.width); mx++) {
            var index = my * Number(map.width) + mx;
            var cell = Number(map.data[index] || 0);
            var cellRect = svgEl("rect", {class: "pui-canvas-paint-cell", x: Number(region.x) + mx * cw, y: Number(region.y) + my * ch,
              width: cw, height: ch, "fill-opacity": String(cell / 255)});
            cells.appendChild(cellRect);
            rec.regionPaintEls[key][index] = cellRect;
          }
        }
        regionGroup.appendChild(cells);
      });
    });
    rec.svg.appendChild(regionGroup);
    (rec.value.layers || []).forEach(function (layer) {
      if (!isObject(layer)) return;
      var points = Canvas.layerHandles(rec.value, layer);
      if (layer.kind === "mesh") {
        Canvas.layerEdges(rec.value, layer).forEach(function (edge) {
          var line = svgEl("line", {class: "pui-canvas-edge", x1: edge[0].x, y1: edge[0].y, x2: edge[1].x, y2: edge[1].y});
          rec.svg.appendChild(line);
          rec.layerEls.push({line: line, edge: edge});
        });
      } else if (points.length) {
        var polygon = svgEl("polygon", {class: "pui-canvas-polygon", points: points.map(function (point) { return point.x + "," + point.y; }).join(" ")});
        rec.svg.appendChild(polygon);
        rec.layerEls.push({polygon: polygon, layer: layer});
      }
    });
    if (rec.handlesEl && rec.handlesEl.parentNode) rec.handlesEl.parentNode.removeChild(rec.handlesEl);
    var handles = el("div", {class: "pui-canvas-handles"});
    (rec.value.handles || []).forEach(function (handle) {
      if (!isObject(handle)) return;
      var id = String(handle.id);
      var button = el("button", {type: "button", class: "pui-canvas-handle" + (rec.selected[id] ? " is-selected" : ""), "data-handle-id": id, style: "left:" + handle.x + "px;top:" + handle.y + "px;"});
      button.setAttribute("aria-label", "Handle " + id + " at " + handle.x + ", " + handle.y);
      button.addEventListener("pointerdown", function (event) { self.canvasHandleDown(rec, id, event); });
      button.addEventListener("focus", function () { rec.focusId = id; });
      handles.appendChild(button);
      rec.handleEls[id] = button;
    });
    (rec.value.regions || []).forEach(function (region) {
      if (!isObject(region)) return;
      var regionId = String(region.id || "");
      var rw = Math.max(1, Number(region.w) || 1);
      var rh = Math.max(1, Number(region.h) || 1);
      [["nw", region.x, region.y], ["ne", Number(region.x) + rw, region.y],
        ["sw", region.x, Number(region.y) + rh], ["se", Number(region.x) + rw, Number(region.y) + rh]].forEach(function (entry) {
        var handle = el("button", {type: "button", class: "pui-canvas-region-handle is-" + entry[0] + (rec.stageMode === "focus" && regionId !== stageActive ? " is-stage-inactive" : ""), "data-region-id": regionId, "data-corner": entry[0], style: "left:" + entry[1] + "px;top:" + entry[2] + "px;"});
        handle.setAttribute("aria-label", "Resize region " + regionId + " " + entry[0]);
        handle.addEventListener("pointerdown", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          if (event.preventDefault) event.preventDefault();
          self.canvasSelectRegion(rec, regionId, false);
          rec.regionDrag = {id: regionId, mode: "resize", corner: entry[0], start: deepClone(rec.value), x: event.clientX || 0, y: event.clientY || 0, moved: false};
        });
        handles.appendChild(handle);
      });
    });
    rec.content.appendChild(handles);
    rec.handlesEl = handles;
    Array.prototype.forEach.call(rec.root.querySelectorAll(".pui-canvas-region-button"), function (button) {
      button.setAttribute("aria-pressed", button.getAttribute("data-pui-region") === rec.selectedRegion ? "true" : "false");
    });
    Array.prototype.forEach.call(rec.root.querySelectorAll(".pui-canvas-group"), function (button) {
      var group = (rec.value.groups || []).find(function (entry) { return String(entry.id || "") === button.getAttribute("data-pui-group"); });
      var on = !!group && isArray(group.handles) && group.handles.length > 0 && group.handles.every(function (id) { return !!rec.selected[String(id)]; });
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
    this.canvasRefreshContextBar(rec);
    this.canvasApplyView(rec);
  };

  Renderer.prototype.canvasApplyView = function (rec) {
    if (!rec || !rec.content) return;
    rec.content.style.transform = "translate(" + rec.view.panX + "px," + rec.view.panY + "px) scale(" + rec.view.zoom + ")";
    Object.keys(rec.handleEls || {}).forEach(function (id) {
      var el = rec.handleEls[id];
      if (el && el.style) el.style.transform = "translate(-50%, -50%) scale(" + (1 / rec.view.zoom) + ")";
    });
  };

  Renderer.prototype.canvasClientToCanvas = function (rec, event) {
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {left: 0, top: 0};
    return {x: ((event.clientX || 0) - box.left - rec.view.panX) / rec.view.zoom, y: ((event.clientY || 0) - box.top - rec.view.panY) / rec.view.zoom};
  };

  Renderer.prototype.canvasSelect = function (rec, id, additive) {
    if (!rec) return;
    if (additive) { if (rec.selected[id]) delete rec.selected[id]; else rec.selected[id] = true; }
    else { rec.selected = {}; rec.selected[id] = true; }
    Object.keys(rec.handleEls || {}).forEach(function (key) { rec.handleEls[key].classList.toggle("is-selected", !!rec.selected[key]); });
    rec.value.selected = Object.keys(rec.selected);
    this.writeCanvas(rec, {op: "selection.set", ids: rec.value.selected});
  };

  Renderer.prototype.canvasHandleDown = function (rec, id, event) {
    if (event.stopPropagation) event.stopPropagation();
    if (event.button !== undefined && event.button !== 0) return;
    this.canvasSelect(rec, id, !!(event.shiftKey || event.metaKey || event.ctrlKey));
    if (rec.block.readonly) return;
    var ids = Object.keys(rec.selected);
    if (!ids.length) ids = [id];
    rec.drag = {start: deepClone(rec.value), ids: ids, x: event.clientX || 0, y: event.clientY || 0, moved: false};
    if (event.preventDefault) event.preventDefault();
  };

  Renderer.prototype.canvasSelectGroup = function (rec, group, additive) {
    if (!rec || !isObject(group) || !isArray(group.handles)) return false;
    var selected = additive ? Object.assign({}, rec.selected) : {};
    group.handles.forEach(function (id) { if (rec.handleEls[String(id)]) selected[String(id)] = true; });
    rec.selected = selected;
    Object.keys(rec.handleEls || {}).forEach(function (id) { rec.handleEls[id].classList.toggle("is-selected", !!rec.selected[id]); });
    rec.value.selected = Object.keys(rec.selected);
    this.writeCanvas(rec, {op: "selection.set", ids: rec.value.selected, group: String(group.id || "")});
    return rec.value.selected.length > 0;
  };

  Renderer.prototype.canvasAlign = function (rec, axis, mode) {
    if (rec.block.readonly) return false;
    var ids = Object.keys(rec.selected);
    if (!ids.length) return false;
    var start = deepClone(rec.value);
    var count = global.PupitreCanvas.alignHandles(rec.value, ids, axis, mode);
    if (!count) return false;
    this.canvasPushUndo(rec, start);
    this.canvasUpdateGeometry(rec);
    this.writeCanvas(rec, {op: "handle.align", ids: ids, axis: axis, mode: mode});
    return true;
  };

  Renderer.prototype.canvasDistribute = function (rec, axis) {
    if (rec.block.readonly) return false;
    var ids = Object.keys(rec.selected);
    if (ids.length < 3) return false;
    var start = deepClone(rec.value);
    if (!global.PupitreCanvas.distributeHandles(rec.value, ids, axis)) return false;
    this.canvasPushUndo(rec, start);
    this.canvasUpdateGeometry(rec);
    this.writeCanvas(rec, {op: "handle.distribute", ids: ids, axis: axis});
    return true;
  };

  Renderer.prototype.canvasAdoptSource = function (rec) {
    if (rec.block.readonly) return false;
    var start = deepClone(rec.value);
    if (!global.PupitreCanvas.adoptSource(rec.value)) { this.adapter.announce("warning", "Canvas has no valid source size."); return false; }
    this.canvasPushUndo(rec, start);
    this.canvasRender(rec);
    this.canvasFit(rec);
    this.writeCanvas(rec, {op: "source.adopt"});
    return true;
  };

  Renderer.prototype.canvasRegion = function (rec, id) {
    return (rec.value.regions || []).find(function (region) { return isObject(region) && String(region.id || "") === String(id); }) || null;
  };

  /** Context-only mode lets a host keep its own stage pixels (OBS MPCDI,
   * live compositors) while PUI owns the MPCDI display/buffer/region context
   * bar and stage-mode intents. */
  Renderer.prototype.canvasContextOnlyRefresh = function (rec) {
    var Canvas = global.PupitreCanvas;
    if (!rec || !Canvas) return;
    var contexts = Canvas.contexts(rec.value);
    var active = Canvas.activeContext(rec.value, contexts);
    var stage = Canvas.stageState(rec.value);
    var signature = JSON.stringify({contexts: contexts, active: active && active.id, stage: stage.mode});
    rec.contexts = contexts;
    rec.activeContext = active ? active.id : "";
    rec.stageMode = stage.mode;
    if (signature !== rec.contextSignature || !rec.contextBar) {
      rec.contextSignature = signature;
      rec.root.textContent = "";
      rec.contextBar = null;
      rec.contextButtons = {};
      rec.stageButtons = {};
      rec.root.appendChild(this.canvasContextBar(rec));
    } else {
      this.canvasRefreshContextBar(rec);
    }
  };

  /** MPCDI context/stage toolbar: display → buffer → region, active context
   * and the edit/composite/focus stage mode. */
  Renderer.prototype.canvasContextBar = function (rec) {
    var self = this;
    var bar = el("div", {class: "pui-canvas-contextbar", role: "group", "aria-label": "MPCDI context and stage"});
    var facts = el("div", {class: "pui-canvas-context-facts"});
    bar.appendChild(facts);
    var contexts = el("div", {class: "pui-canvas-contexts", role: "group", "aria-label": "Display, buffer and region contexts"});
    rec.contextButtons = {};
    (rec.contexts || []).forEach(function (entry) {
      var button = el("button", {type: "button", class: "pui-button pui-canvas-context", text: String(entry.label), "aria-pressed": "false"});
      button.setAttribute("data-context-id", entry.id);
      button.title = "Display " + entry.displayLabel + " · Buffer " + entry.bufferLabel + " · Region " + entry.regionLabel;
      button.addEventListener("click", function () { self.canvasSelectContext(rec, entry.id); });
      contexts.appendChild(button);
      rec.contextButtons[entry.id] = button;
    });
    bar.appendChild(contexts);
    var stage = el("div", {class: "pui-canvas-stage", role: "group", "aria-label": "Stage mode"});
    rec.stageButtons = {};
    [["edit", "Edit"], ["composite", "Composite"], ["focus", "Focus"]].forEach(function (entry) {
      var button = el("button", {type: "button", class: "pui-button pui-canvas-stage-mode", text: entry[1], "aria-pressed": "false"});
      button.setAttribute("data-stage-mode", entry[0]);
      button.title = "Stage " + entry[1].toLowerCase();
      button.addEventListener("click", function () { self.canvasSetStageMode(rec, entry[0]); });
      stage.appendChild(button);
      rec.stageButtons[entry[0]] = button;
    });
    var fitRegion = el("button", {type: "button", class: "pui-button pui-canvas-fit-region", text: "Fit region"});
    fitRegion.addEventListener("click", function () { self.canvasFitRegion(rec); });
    stage.appendChild(fitRegion);
    rec.fitRegionButton = fitRegion;
    bar.appendChild(stage);
    rec.contextBar = bar;
    rec.contextFacts = facts;
    this.canvasRefreshContextBar(rec);
    return bar;
  };

  Renderer.prototype.canvasRefreshContextBar = function (rec) {
    if (!rec || !rec.contextBar) return;
    var active = (rec.contexts || []).find(function (entry) { return entry.id === rec.activeContext; }) || (rec.contexts || [])[0] || null;
    if (rec.contextFacts) {
      rec.contextFacts.textContent = active
        ? active.displayLabel + " · " + active.bufferLabel + " · " + active.coordinate_space
        : "";
    }
    Object.keys(rec.contextButtons || {}).forEach(function (id) {
      var on = id === rec.activeContext;
      rec.contextButtons[id].setAttribute("aria-pressed", on ? "true" : "false");
      rec.contextButtons[id].classList.toggle("is-active", on);
    });
    Object.keys(rec.stageButtons || {}).forEach(function (mode) {
      var on = mode === rec.stageMode;
      rec.stageButtons[mode].setAttribute("aria-pressed", on ? "true" : "false");
      rec.stageButtons[mode].classList.toggle("is-active", on);
    });
    rec.root.setAttribute("data-stage-mode", rec.stageMode || "edit");
    if (rec.fitRegionButton) {
      rec.fitRegionButton.disabled = !rec.selectedRegion;
      rec.fitRegionButton.title = rec.selectedRegion ? "Fit the active region " + rec.selectedRegion : "Select a region first";
    }
  };

  Renderer.prototype.canvasSelectContext = function (rec, id, writeIntent) {
    if (!rec) return false;
    var entry = (rec.contexts || []).find(function (item) { return item.id === String(id); });
    if (!entry) return false;
    rec.activeContext = entry.id;
    rec.value.active_context = entry.id;
    if (entry.region) {
      rec.selectedRegion = entry.region;
      rec.value.selected_region = entry.region;
    }
    this.canvasRender(rec);
    if (writeIntent !== false) this.writeCanvas(rec, {op: "context.select", context: entry.id, display: entry.display, buffer: entry.buffer, region: entry.region, coordinate_space: entry.coordinate_space});
    return true;
  };

  Renderer.prototype.canvasSetStageMode = function (rec, mode) {
    if (!rec || ["edit", "composite", "focus"].indexOf(String(mode)) < 0) return false;
    rec.stageMode = String(mode);
    if (!isObject(rec.value.stage)) rec.value.stage = {};
    rec.value.stage.mode = rec.stageMode;
    this.canvasRender(rec);
    this.writeCanvas(rec, {op: "stage.mode", mode: rec.stageMode});
    return true;
  };

  Renderer.prototype.canvasFitRegion = function (rec) {
    if (!rec || !rec.selectedRegion) return false;
    var region = this.canvasRegion(rec, rec.selectedRegion);
    if (!region) return false;
    if (!rec.viewport) {
      this.writeCanvas(rec, {op: "view.fit_region", region: rec.selectedRegion});
      return true;
    }
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 450};
    var next = global.PupitreCanvas.fitRegion(rec.value, region, box.width || 800, box.height || 450, 24);
    rec.view = next;
    rec.value.view = {zoom: next.zoom, panX: next.panX, panY: next.panY};
    this.canvasApplyView(rec);
    this.writeCanvas(rec, {op: "view.fit_region", region: rec.selectedRegion});
    return true;
  };

  Renderer.prototype.canvasSelectRegion = function (rec, id, writeIntent) {
    if (!rec) return false;
    rec.selectedRegion = String(id || "");
    rec.value.selected_region = rec.selectedRegion;
    var entry = (rec.contexts || []).find(function (item) { return item.region === rec.selectedRegion; });
    if (entry) {
      rec.activeContext = entry.id;
      rec.value.active_context = entry.id;
    }
    this.canvasRender(rec);
    if (writeIntent !== false) this.writeCanvas(rec, {op: "region.select", region: rec.selectedRegion, context: rec.activeContext || ""});
    return true;
  };

  Renderer.prototype.canvasPaintAt = function (rec, point) {
    var region = rec.selectedRegion ? this.canvasRegion(rec, rec.selectedRegion) : null;
    var paint = region && isObject(region[rec.paintMap]) ? region[rec.paintMap] : rec.value.paint;
    if (!isObject(paint) || !isArray(paint.data)) return;
    var originX = region ? Number(region.x) || 0 : 0;
    var originY = region ? Number(region.y) || 0 : 0;
    var extentW = region ? Math.max(1, Number(region.w) || 1) : Number(rec.value.width);
    var extentH = region ? Math.max(1, Number(region.h) || 1) : Number(rec.value.height);
    var cellX = Math.floor((point.x - originX) / (extentW / Number(paint.width)));
    var cellY = Math.floor((point.y - originY) / (extentH / Number(paint.height)));
    var paintEls = region ? (rec.regionPaintEls[String(region.id || "") + ":" + rec.paintMap] || []) : rec.paintEls;
    rec.paint = {start: rec.paint && rec.paint.start ? rec.paint.start : deepClone(rec.value), region: region ? String(region.id || "") : "", map: region ? rec.paintMap : ""};
    var tool = rec.paintTool || "lower";
    var radius = Math.max(0, Math.floor(Number(rec.options.brush) || 1));
    for (var y = cellY - radius; y <= cellY + radius; y++) {
      for (var x = cellX - radius; x <= cellX + radius; x++) {
        if (x < 0 || y < 0 || x >= Number(paint.width) || y >= Number(paint.height)) continue;
        var index = y * Number(paint.width) + x;
        var old = Number(paint.data[index] || 0);
        var next = old;
        if (tool === "raise") next = Math.min(255, old + 32);
        else if (tool === "lower") next = Math.max(0, old - 32);
        else if (tool === "restore") next = 0;
        else if (tool === "smooth") {
          var sum = 0, count = 0;
          for (var sy = y - 1; sy <= y + 1; sy++) for (var sx = x - 1; sx <= x + 1; sx++) {
            if (sx >= 0 && sy >= 0 && sx < Number(paint.width) && sy < Number(paint.height)) { sum += Number(paint.data[sy * Number(paint.width) + sx] || 0); count++; }
          }
          next = Math.round(sum / Math.max(1, count));
        }
        paint.data[index] = Math.max(0, Math.min(255, next));
        if (paintEls[index]) paintEls[index].setAttribute("fill-opacity", String(paint.data[index] / 255));
      }
    }
  };

  Renderer.prototype.canvasPointerDown = function (rec, event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target && event.target.closest && (event.target.closest(".pui-canvas-handle") || event.target.closest(".pui-canvas-live"))) return;
    if (rec.paintMode && !rec.block.readonly) {
      rec.paint = {start: deepClone(rec.value)};
      this.canvasPaintAt(rec, this.canvasClientToCanvas(rec, event));
      if (event.preventDefault) event.preventDefault();
      return;
    }
    if (event.shiftKey) {
      var start = this.canvasClientToCanvas(rec, event);
      var box = el("div", {class: "pui-canvas-marquee"});
      rec.content.appendChild(box);
      rec.marquee = {start: start, el: box};
      if (event.preventDefault) event.preventDefault();
      return;
    }
    rec.pan = {x: event.clientX || 0, y: event.clientY || 0, panX: rec.view.panX, panY: rec.view.panY};
    if (event.preventDefault) event.preventDefault();
  };

  Renderer.prototype.canvasPointerMove = function (rec, event) {
    if (rec.paint) {
      this.canvasPaintAt(rec, this.canvasClientToCanvas(rec, event));
      return;
    }
    if (rec.regionDrag) {
      var region = this.canvasRegion(rec, rec.regionDrag.id);
      if (!region) { rec.regionDrag = null; return; }
      var rdx = ((event.clientX || 0) - rec.regionDrag.x) / rec.view.zoom;
      var rdy = ((event.clientY || 0) - rec.regionDrag.y) / rec.view.zoom;
      if (!rec.regionDrag.moved && Math.abs(rdx) + Math.abs(rdy) < 2) return;
      rec.regionDrag.moved = true;
      var startRegion = (rec.regionDrag.start.regions || []).find(function (entry) { return String(entry.id || "") === rec.regionDrag.id; });
      if (!startRegion) return;
      var sx = Number(startRegion.x) || 0, sy = Number(startRegion.y) || 0, sw = Math.max(1, Number(startRegion.w) || 1), sh = Math.max(1, Number(startRegion.h) || 1);
      if (rec.regionDrag.mode === "move") { region.x = sx + rdx; region.y = sy + rdy; }
      else {
        var corner = rec.regionDrag.corner;
        if (corner.indexOf("w") >= 0) { region.x = sx + rdx; region.w = sw - rdx; }
        if (corner.indexOf("e") >= 0) region.w = sw + rdx;
        if (corner.indexOf("n") >= 0) { region.y = sy + rdy; region.h = sh - rdy; }
        if (corner.indexOf("s") >= 0) region.h = sh + rdy;
        region.w = Math.max(1, Number(region.w) || 1); region.h = Math.max(1, Number(region.h) || 1);
      }
      this.canvasRender(rec);
      return;
    }
    if (rec.drag) {
      var dx = (event.clientX || 0) - rec.drag.x;
      var dy = (event.clientY || 0) - rec.drag.y;
      if (!rec.drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      rec.drag.moved = true;
      var map = global.PupitreCanvas.handleMap(rec.value);
      rec.drag.ids.forEach(function (id) {
        var handle = map[String(id)];
        var start = global.PupitreCanvas.handleMap(rec.drag.start)[String(id)];
        if (handle && start) { handle.x = Number(start.x) + dx / rec.view.zoom; handle.y = Number(start.y) + dy / rec.view.zoom; }
      });
      this.canvasUpdateGeometry(rec);
      return;
    }
    if (rec.pan) {
      rec.view.panX = rec.pan.panX + (event.clientX || 0) - rec.pan.x;
      rec.view.panY = rec.pan.panY + (event.clientY || 0) - rec.pan.y;
      this.canvasApplyView(rec);
      return;
    }
    if (rec.marquee) {
      var point = this.canvasClientToCanvas(rec, event);
      var x1 = Math.min(rec.marquee.start.x, point.x), y1 = Math.min(rec.marquee.start.y, point.y);
      var x2 = Math.max(rec.marquee.start.x, point.x), y2 = Math.max(rec.marquee.start.y, point.y);
      rec.marquee.el.style.left = x1 + "px"; rec.marquee.el.style.top = y1 + "px";
      rec.marquee.el.style.width = (x2 - x1) + "px"; rec.marquee.el.style.height = (y2 - y1) + "px";
      rec.marquee.bounds = {x1: x1, y1: y1, x2: x2, y2: y2};
    }
  };

  Renderer.prototype.canvasPointerUp = function (rec) {
    if (rec.paint) {
      var stroke = rec.paint;
      rec.paint = null;
      this.canvasPushUndo(rec, stroke.start);
      this.writeCanvas(rec, {op: "paint.stroke", region: stroke.region || "", map: stroke.map || ""});
      return;
    }
    if (rec.regionDrag) {
      var regionDrag = rec.regionDrag;
      rec.regionDrag = null;
      if (regionDrag.moved) {
        this.canvasPushUndo(rec, regionDrag.start);
        this.writeCanvas(rec, {op: regionDrag.mode === "resize" ? "region.resize" : "region.move", region: regionDrag.id});
      }
      return;
    }
    if (rec.drag) {
      var drag = rec.drag;
      rec.drag = null;
      if (drag.moved) {
        this.canvasPushUndo(rec, drag.start);
        this.writeCanvas(rec, {op: "handle.move", ids: drag.ids});
      }
      return;
    }
    if (rec.pan) {
      rec.pan = null;
      rec.value.view = {zoom: rec.view.zoom, panX: rec.view.panX, panY: rec.view.panY};
      this.writeCanvas(rec, {op: "view.set"});
      return;
    }
    if (rec.marquee) {
      var bounds = rec.marquee.bounds;
      if (rec.marquee.el && rec.marquee.el.remove) rec.marquee.el.remove();
      rec.marquee = null;
      if (bounds) {
        rec.selected = {};
        (rec.value.handles || []).forEach(function (handle) {
          if (isObject(handle) && Number(handle.x) >= bounds.x1 && Number(handle.x) <= bounds.x2 && Number(handle.y) >= bounds.y1 && Number(handle.y) <= bounds.y2) rec.selected[String(handle.id)] = true;
        });
        rec.value.selected = Object.keys(rec.selected);
        this.canvasUpdateSelection(rec);
        this.writeCanvas(rec, {op: "selection.set", ids: rec.value.selected});
      }
    }
  };

  Renderer.prototype.canvasUpdateGeometry = function (rec) {
    var Canvas = global.PupitreCanvas;
    (rec.value.handles || []).forEach(function (handle) {
      var el = rec.handleEls[String(handle.id)];
      if (el) { el.style.left = handle.x + "px"; el.style.top = handle.y + "px"; }
    });
    var map = Canvas.handleMap(rec.value);
    (rec.layerEls || []).forEach(function (entry) {
      if (entry.line && entry.edge) {
        var a = map[String(entry.edge[0].id)], b = map[String(entry.edge[1].id)];
        if (a && b) { entry.line.setAttribute("x1", a.x); entry.line.setAttribute("y1", a.y); entry.line.setAttribute("x2", b.x); entry.line.setAttribute("y2", b.y); }
      } else if (entry.polygon) {
        var points = Canvas.layerHandles(rec.value, entry.layer);
        entry.polygon.setAttribute("points", points.map(function (point) { return point.x + "," + point.y; }).join(" "));
      }
    });
  };

  Renderer.prototype.canvasUpdateSelection = function (rec) {
    Object.keys(rec.handleEls || {}).forEach(function (id) { rec.handleEls[id].classList.toggle("is-selected", !!rec.selected[id]); });
  };

  Renderer.prototype.canvasWheel = function (rec, event) {
    if (event.preventDefault) event.preventDefault();
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {left: 0, top: 0};
    var sx = (event.clientX || 0) - box.left, sy = (event.clientY || 0) - box.top;
    var gx = (sx - rec.view.panX) / rec.view.zoom, gy = (sy - rec.view.panY) / rec.view.zoom;
    var next = Math.max(0.1, Math.min(8, rec.view.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
    rec.view.zoom = next;
    rec.view.panX = sx - gx * next;
    rec.view.panY = sy - gy * next;
    rec.value.view = {zoom: rec.view.zoom, panX: rec.view.panX, panY: rec.view.panY};
    this.canvasApplyView(rec);
  };

  Renderer.prototype.canvasKeydown = function (rec, event) {
    if (rec.block.readonly) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) this.canvasRedo(rec); else this.canvasUndo(rec); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); rec.value.handles.forEach(function (handle) { rec.selected[String(handle.id)] = true; }); rec.value.selected = Object.keys(rec.selected); this.canvasUpdateSelection(rec); return; }
    if (event.key === "Escape") { rec.selected = {}; rec.value.selected = []; this.canvasUpdateSelection(rec); return; }
    if (event.key.indexOf("Arrow") !== 0) return;
    var ids = Object.keys(rec.selected);
    if (!ids.length) return;
    event.preventDefault();
    var step = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
    var dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    var dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    var start = deepClone(rec.value);
    var map = global.PupitreCanvas.handleMap(rec.value);
    ids.forEach(function (id) { if (map[id]) { map[id].x += dx; map[id].y += dy; } });
    this.canvasPushUndo(rec, start);
    this.canvasUpdateGeometry(rec);
    this.writeCanvas(rec, {op: "handle.nudge", ids: ids, dx: dx, dy: dy});
  };

  Renderer.prototype.canvasFit = function (rec) {
    var box = rec.viewport.getBoundingClientRect ? rec.viewport.getBoundingClientRect() : {width: 800, height: 450};
    var next = global.PupitreCanvas.fitView(rec.value, box.width || 800, box.height || 450, 24);
    rec.view = next;
    rec.value.view = {zoom: next.zoom, panX: next.panX, panY: next.panY};
    this.canvasApplyView(rec);
    this.writeCanvas(rec, {op: "view.fit"});
  };

  Renderer.prototype.canvasPushUndo = function (rec, snapshot) {
    if (rec.options && rec.options.host_undo && typeof this.adapter.historyCheckpoint === "function") {
      try { this.adapter.historyCheckpoint(deepClone(snapshot), rec.block, "canvas"); } catch (error) { /* host history */ }
      return;
    }
    rec.undo.push(deepClone(snapshot));
    rec.redo = [];
  };

  Renderer.prototype.canvasUndo = function (rec) {
    if (rec.options && rec.options.host_undo) {
      if (typeof this.adapter.undo !== "function") return false;
      var ok = this.adapter.undo();
      rec.value = this.adapter.getValue(String(rec.path || rec.block.bind || ""));
      rec.undo = [];
      rec.redo = [];
      rec.render();
      return ok !== false;
    }
    if (!rec.undo.length) return false;
    rec.redo.push(deepClone(rec.value));
    rec.value = rec.undo.pop();
    rec.render();
    this.writeCanvas(rec, {op: "history.undo"});
    return true;
  };

  Renderer.prototype.canvasRedo = function (rec) {
    if (rec.options && rec.options.host_undo) {
      if (typeof this.adapter.redo !== "function") return false;
      var ok = this.adapter.redo();
      rec.value = this.adapter.getValue(String(rec.path || rec.block.bind || ""));
      rec.undo = [];
      rec.redo = [];
      rec.render();
      return ok !== false;
    }
    if (!rec.redo.length) return false;
    rec.undo.push(deepClone(rec.value));
    rec.value = rec.redo.pop();
    rec.render();
    this.writeCanvas(rec, {op: "history.redo"});
    return true;
  };

  Renderer.prototype.writeCanvas = function (rec, intent) {
    if (typeof this.adapter.canvasAction === "function") {
      try { this.adapter.canvasAction(intent || {}, rec.value, rec.block); } catch (error) { this.adapter.announce("error", "Canvas action failed: " + String(error && error.message || error)); }
    }
    return this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
  };

  /** Project/file status block. Hosts own persistence; browser file helpers are
   * the fallback when projectAction is not supplied. */
  Renderer.prototype.buildProject = function (block) {
    var self = this;
    var Project = global.PupitreProject;
    var File = global.PupitreFile;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Project");
    if (!Project) return el("p", {class: "pui-missing", text: "(project model PupitreProject is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(project value is missing)"});
    var options = isObject(block.project_options) ? block.project_options : {};
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-project", "data-pui-project": path});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, value: value, root: root, options: options, statusText: ""};
    var head = el("div", {class: "pui-project-head"});
    head.appendChild(el("h4", {text: label}));
    var nameEl = el("span", {class: "pui-project-name"});
    head.appendChild(nameEl);
    var badges = el("span", {class: "pui-project-badges"});
    head.appendChild(badges);
    root.appendChild(head);
    var actions = el("div", {class: "pui-project-actions"});
    var newButton = el("button", {type: "button", class: "pui-button", text: "New"});
    newButton.addEventListener("click", function () { self.projectCommand(rec, "project.new"); });
    var open = el("button", {type: "button", class: "pui-button", text: "Open"});
    open.addEventListener("click", function () { self.projectCommand(rec, "project.open"); });
    var save = el("button", {type: "button", class: "pui-button pui-primary", text: "Save"});
    save.addEventListener("click", function () { self.projectCommand(rec, "project.save"); });
    var importButton = el("button", {type: "button", class: "pui-button", text: "Import"});
    importButton.addEventListener("click", function () { self.projectCommand(rec, "project.import"); });
    var exportButton = el("button", {type: "button", class: "pui-button", text: "Export"});
    exportButton.addEventListener("click", function () { self.projectCommand(rec, "project.export"); });
    actions.appendChild(newButton); actions.appendChild(open); actions.appendChild(save);
    if (options.allow_import !== false) actions.appendChild(importButton);
    if (options.allow_export !== false) actions.appendChild(exportButton);
    root.appendChild(actions);
    var autosaveRow = el("label", {class: "pui-project-autosave"});
    var autosave = el("input", {type: "checkbox"});
    autosave.addEventListener("change", function () {
      rec.value.autosave = !!autosave.checked;
      self.setPath(rec.path, rec.value, rec.block);
      self.projectCommand(rec, "project.autosave", {value: rec.value.autosave});
    });
    autosaveRow.appendChild(autosave);
    autosaveRow.appendChild(el("span", {text: "Autosave"}));
    root.appendChild(autosaveRow);
    var status = el("p", {class: "pui-project-status", role: "status", "aria-live": "polite"});
    root.appendChild(status);
    rec.autosave = autosave;
    rec.status = status;
    var refresh = function () {
      var live = self.adapter.getValue(rec.path);
      if (isObject(live)) rec.value = live;
      var state = Project.normalize(rec.value);
      state.offline = state.offline || (File ? !File.isOnline() : false);
      nameEl.textContent = state.name + (state.path ? " · " + state.path : "");
      badges.textContent = "";
      [["dirty", "Unsaved"], ["offline", "Offline"], ["autosave", "Autosave"]].forEach(function (pair) {
        if (!state[pair[0]]) return;
        var className = pair[0] === "dirty" ? "is-dirty" : pair[0] === "offline" ? "is-offline" : "is-autosave";
        badges.appendChild(el("span", {class: "pui-project-badge " + className, text: pair[1]}));
      });
      autosave.checked = state.autosave;
      status.textContent = rec.statusText || (state.lastSaved ? "Last saved " + state.lastSaved : Project.stateLabel(state));
      save.disabled = !state.dirty;
      root.setAttribute("data-project-state", Project.stateLabel(state));
    };
    rec.refresh = refresh;
    this.projectRecords.push(rec);
    refresh();
    if (options.service_worker && File) File.registerServiceWorker(String(options.service_worker));
    return root;
  };

  Renderer.prototype.projectCommand = function (rec, op, extra, skipAction) {
    var self = this;
    var File = global.PupitreFile;
    var intent = Object.assign({op: op, path: String(rec.value && rec.value.path || ""), name: String(rec.value && rec.value.name || "")}, extra || {});
    var finish = function (ok, message) {
      rec.statusText = message || (ok ? "Host handled " + op + "." : "Host rejected " + op + ".");
      if (ok) self.adapter.announce("success", rec.statusText); else self.adapter.announce("error", rec.statusText);
      if (rec.refresh) rec.refresh();
    };
    if (!skipAction && typeof this.adapter.projectAction === "function") {
      try {
        var result = this.adapter.projectAction(intent, rec.value, rec.block);
        if (result === false) { finish(false); return false; }
        if (result && typeof result.then === "function") {
          result.then(function () { finish(true); }).catch(function (error) { finish(false, String(error && error.message || error)); });
        } else finish(true);
      } catch (error) { finish(false, String(error && error.message || error)); }
      return true;
    }
    if (!File) { finish(false, "No project or file adapter is available."); return false; }
    if (op === "project.autosave") {
      finish(true, rec.value && rec.value.autosave ? "Autosave enabled." : "Autosave disabled.");
      return true;
    }
    if (op === "project.save" || op === "project.export") {
      var content = JSON.stringify(this.adapter.getValue(rec.path), null, 2);
      var filename = (rec.options.filename || global.PupitreProject.filename(global.PupitreProject.normalize(rec.value), rec.options.extension || "pui.json"));
      var ok = File.download(filename, content, "application/json");
      finish(ok, ok ? "Downloaded " + filename : "Could not create file.");
      return ok;
    }
    if (op === "project.open" || op === "project.import") {
      File.pickFile({accept: rec.options.accept || ".json,application/json"}).then(function (picked) {
        var parsed = File.parseJSON(picked.text);
        if (!parsed.ok) { finish(false, "Invalid project JSON: " + parsed.error); return; }
        self.setPath(rec.path, parsed.value, rec.block);
        rec.value = parsed.value;
        finish(true, "Loaded " + picked.name);
      }).catch(function (error) { finish(false, String(error && error.message || error)); });
      return true;
    }
    finish(false, "This project action requires a host adapter.");
    return false;
  };

  Renderer.prototype.buildDisclosure = function (block) {
    var self = this;
    var root = el("section", {class: "pui-disclosure", "data-pui-disclosure": String(block.id || block.bind || "")});
    var bodyId = this.id("disclosure-body");
    var key = String(block.storage_key || block.id || block.bind || "default");
    var stored = null;
    try { stored = window.localStorage && window.localStorage.getItem("pui.disclosure." + key); } catch (error) {}
    var defaultOpen = block.open === true || block.default_open === true;
    var open = stored === null || stored === undefined ? defaultOpen : stored === "1";
    var summary = el("button", {type: "button", class: "pui-disclosure-summary", "aria-expanded": open ? "true" : "false", "aria-controls": bodyId});
    var dot = el("span", {class: "pui-disclosure-dot", "aria-hidden": "true"});
    summary.appendChild(dot);
    summary.appendChild(el("span", {class: "pui-disclosure-title", text: String(block.label || block.title || block.id || "Details")}));
    var summaryText = el("span", {class: "pui-disclosure-summary-text"});
    summary.appendChild(summaryText);
    var status = el("span", {class: "pui-disclosure-status"});
    summary.appendChild(status);
    var modified = el("span", {class: "pui-disclosure-modified", text: "modified"});
    summary.appendChild(modified);
    summary.appendChild(el("span", {class: "pui-disclosure-chevron", "aria-hidden": "true", text: open ? "▾" : "▸"}));
    root.appendChild(summary);
    var body = el("div", {class: "pui-disclosure-body", id: bodyId, hidden: !open});
    (block.blocks || []).forEach(function (child) { body.appendChild(self.buildBlock(child)); });
    if (isArray(block.actions) && block.actions.length) body.appendChild(self.buildActions(block.actions));
    root.appendChild(body);
    var refresh = function () {
      var summaryValue = block.summary;
      if (block.summary_bind) summaryValue = self.adapter.getValue(String(block.summary_bind));
      summaryText.textContent = summaryValue === undefined || summaryValue === null ? "" : String(summaryValue);
      var statusValue = block.status;
      if (block.status_bind) statusValue = self.adapter.getValue(String(block.status_bind));
      var statusText = "";
      var statusLevel = String(block.status_level || "");
      if (isObject(statusValue)) {
        statusText = String(statusValue.text || statusValue.message || statusValue.state || "");
        statusLevel = String(statusValue.level || statusValue.state || statusLevel);
      } else if (statusValue !== undefined && statusValue !== null) statusText = String(statusValue);
      status.textContent = statusText;
      var tone = /fail|error|conflict/i.test(statusLevel + " " + statusText) ? "error" : /warn|stale|busy|pending/i.test(statusLevel + " " + statusText) ? "warn" : statusText ? "ok" : "";
      dot.className = "pui-disclosure-dot" + (tone ? " is-" + tone : "");
      var modifiedValue = block.modified === true;
      if (block.modified_bind) modifiedValue = !!self.adapter.getValue(String(block.modified_bind));
      modified.hidden = !modifiedValue;
      root.classList.toggle("is-modified", modifiedValue);
      body.style.setProperty("--pui-disclosure-depth", String(block.depth || 0));
    };
    var setOpen = function (next) {
      open = next;
      summary.setAttribute("aria-expanded", open ? "true" : "false");
      summary.querySelector(".pui-disclosure-chevron").textContent = open ? "▾" : "▸";
      body.hidden = !open;
      try { if (window.localStorage) window.localStorage.setItem("pui.disclosure." + key, open ? "1" : "0"); } catch (error) {}
    };
    summary.addEventListener("click", function () { setOpen(!open); });
    this.disclosureRecords.push({refresh: refresh});
    refresh();
    return root;
  };

  Renderer.prototype.readSelection = function (path, block) {
    if (!path) return {ids: [], active: "", kind: "", label: "", mixed: []};
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(String(path), block || {})
      : this.adapter.getValue(String(path));
    if (global.PupitreSelection) return global.PupitreSelection.normalize(value);
    var ids = isArray(value) ? value.map(String) : (isObject(value) && isArray(value.ids) ? value.ids.map(String) : []);
    return {ids: ids, active: isObject(value) && value.active ? String(value.active) : (ids[0] || ""), kind: isObject(value) && value.kind ? String(value.kind) : "", label: "", mixed: []};
  };

  Renderer.prototype.writeSelection = function (rec, state, kind, label) {
    var path = rec && rec.block && rec.block.selection_bind ? String(rec.block.selection_bind) : "";
    if (!path) return false;
    var current = this.adapter.getValue(path);
    var ids = isArray(state) ? state.map(String) : (isObject(state) && isArray(state.ids) ? state.ids.map(String) : []);
    var next = {ids: ids, active: isObject(state) && state.active ? String(state.active) : (ids[0] || ""), kind: kind || (isObject(state) && state.kind ? String(state.kind) : ""), label: label !== undefined ? String(label) : ""};
    if (global.PupitreSelection) next = global.PupitreSelection.normalize(Object.assign({}, next, {kind: next.kind}));
    var value = global.PupitreSelection ? global.PupitreSelection.toShape(current, next) : (isArray(current) ? next.ids : Object.assign({}, current, next));
    this.setPath(path, value, rec.block);
    if (typeof this.adapter.selectionAction === "function") {
      try { this.adapter.selectionAction({op: "selection.set", ids: next.ids, active: next.active, kind: next.kind}, next, rec.block); } catch (error) { this.adapter.announce("error", "Selection action failed: " + String(error && error.message || error)); }
    }
    this.refreshSelections(rec);
    return true;
  };

  Renderer.prototype.refreshSelections = function (except) {
    for (var i = 0; i < this.selectionRecords.length; i++) {
      var record = this.selectionRecords[i];
      if (record.owner === except) continue;
      if (record.refresh) record.refresh();
    }
  };

  Renderer.prototype.buildSelection = function (block) {
    var self = this;
    var Selection = global.PupitreSelection;
    var path = String(block.bind || "");
    if (!Selection) return el("p", {class: "pui-missing", text: "(selection model PupitreSelection is not loaded)"});
    var root = el("section", {class: "pui-selection", "data-pui-selection": path, role: "group"});
    var label = String(block.label || block.id || "Selection");
    var a11y = isObject(block.a11y) ? block.a11y : {};
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, root: root, options: isObject(block.selection_options) ? block.selection_options : {}};
    var head = el("div", {class: "pui-selection-head"});
    head.appendChild(el("h4", {text: label}));
    var count = el("span", {class: "pui-selection-count"});
    head.appendChild(count);
    root.appendChild(head);
    var body = el("div", {class: "pui-selection-body"});
    root.appendChild(body);
    var context = el("div", {class: "pui-selection-actions"});
    root.appendChild(context);
    var refresh = function () {
      var state = self.readSelection(path, block);
      count.textContent = state.ids.length + " selected";
      body.textContent = "";
      var context = self.root && self.root.querySelector ? self.root.querySelector(".pui-selection-actions") : null;
      if (context) context.textContent = "";
      if (!state.ids.length) {
        body.appendChild(el("p", {class: "pui-selection-empty", text: self.t("selection.none", "No selection.")}));
        return;
      }
      if (state.active) body.appendChild(el("span", {class: "pui-selection-active", text: "Active: " + state.active}));
      if (state.kind) body.appendChild(el("span", {class: "pui-selection-kind", text: state.kind}));
      var chips = el("div", {class: "pui-selection-chips"});
      state.ids.forEach(function (id) {
        chips.appendChild(el("span", {class: "pui-selection-chip" + (id === state.active ? " is-active" : ""), text: id}));
      });
      body.appendChild(chips);
      if (state.mixed.length) body.appendChild(el("span", {class: "pui-selection-mixed", text: "Mixed: " + state.mixed.join(", ")}));
      (rec.options.context || block.context || []).forEach(function (item) {
        if (!isObject(item)) return;
        var button = el("button", {type: "button", class: "pui-button", text: String(item.label || item.id || "Action")});
        button.addEventListener("click", function () { self.performAction(item, button, {selection: state.ids, active: state.active}); });
        if (context) context.appendChild(button);
      });
    };
    rec.refresh = refresh;
    rec.owner = rec;
    this.selectionRecords.push(rec);
    refresh();
    return root;
  };

  Renderer.prototype.schemaFormValue = function (block) {
    var path = String(block.bind || "");
    var value = path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(path, block) : this.adapter.getValue(path)) : null;
    if (!isObject(value)) value = {};
    var fields = (isArray(value.fields) ? value.fields : []).filter(isObject).map(function (field) {
      return Object.assign({kind: "field"}, field);
    });
    var groups = isArray(value.groups) ? value.groups.filter(isObject) : [];
    return {fields: fields, groups: groups, raw: value};
  };

  Renderer.prototype.schemaFormBuildFields = function (rec) {
    var self = this;
    var schema = this.schemaFormValue(rec.block);
    var fields = schema.fields;
    var groups = schema.groups.slice();
    var seen = {};
    groups.forEach(function (group) { seen[String(group.id)] = true; });
    fields.forEach(function (field) {
      var id = String(field.group || "");
      if (id && !seen[id]) { groups.push({id: id, label: id}); seen[id] = true; }
    });
    rec.fieldsRoot.textContent = "";
    var emitGroup = function (group) {
      var groupFields = fields.filter(function (field) { return String(field.group || "") === String(group.id); });
      if (!groupFields.length) return;
      var box = el("fieldset", {class: "pui-schema-form-group"});
      box.appendChild(el("legend", {text: String(group.label || group.id || "Group")}));
      groupFields.forEach(function (field) { box.appendChild(self.buildBlock(field, {section: {id: String(rec.block.id || "schemaForm")}})); });
      rec.fieldsRoot.appendChild(box);
    };
    if (groups.length) {
      groups.forEach(emitGroup);
      fields.filter(function (field) { return !field.group; }).forEach(function (field) {
        rec.fieldsRoot.appendChild(self.buildBlock(field, {section: {id: String(rec.block.id || "schemaForm")}}));
      });
    } else {
      fields.forEach(function (field) { rec.fieldsRoot.appendChild(self.buildBlock(field, {section: {id: String(rec.block.id || "schemaForm")}})); });
    }
    rec.block = Object.assign({}, rec.block, {fields: fields});
    rec.value = schema.raw;
    rec.fields = fields;
    rec.groups = groups;
    rec.signature = JSON.stringify({fields: fields, groups: groups});
  };

  Renderer.prototype.schemaFormRefresh = function (rec) {
    var schema = this.schemaFormValue(rec.block);
    var signature = JSON.stringify({fields: schema.fields, groups: schema.groups});
    if (signature !== rec.signature) this.schemaFormBuildFields(rec);
  };

  Renderer.prototype.buildSchemaForm = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("form", {class: "pui-schema-form", "data-pui-schema-form": path, role: "form"});
    if (a11y.name || block.label) root.setAttribute("aria-label", String(a11y.name || block.label));
    if (block.label) root.appendChild(el("h4", {class: "pui-schema-form-title", text: String(block.label)}));
    var fieldsRoot = el("div", {class: "pui-schema-form-fields", style: "grid-template-columns:repeat(" + Math.max(1, Math.min(4, Number(block.columns) || 1)) + ",minmax(0,1fr));"});
    root.appendChild(fieldsRoot);
    var status = el("p", {class: "pui-schema-form-status", role: "status", "aria-live": "polite"});
    root.appendChild(status);
    var rec = {block: Object.assign({}, block), root: root, path: path, fieldsRoot: fieldsRoot, value: {}, fields: [], groups: [], signature: "", status: status,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, visible: true, enabled: true, firstInvalid: null};
    this.schemaFormBuildFields(rec);
    var submit = isObject(block.submit) ? block.submit : {label: this.t("schemaForm.apply", "Apply")};
    var bar = el("div", {class: "pui-schema-form-actions"});
    var submitButton = el("button", {type: "submit", class: "pui-button pui-primary", text: String(submit.label || this.t("schemaForm.apply", "Apply"))});
    bar.appendChild(submitButton);
    var cancel = isObject(block.cancel) ? block.cancel : null;
    if (cancel) {
      var cancelButton = el("button", {type: "button", class: "pui-button", text: String(cancel.label || this.t("schemaForm.cancel", "Cancel"))});
      cancelButton.addEventListener("click", function () {
        if (typeof self.adapter.schemaFormAction === "function") self.adapter.schemaFormAction({op: "cancel", values: self.formValues(rec.block)}, rec.value, block);
        else if (cancel.call) self.adapter.callAction(String(cancel.call), {values: self.formValues(rec.block)});
      });
      bar.appendChild(cancelButton);
    }
    root.appendChild(bar);
    root.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!self.formValidate(rec)) return;
      var values = self.formValues(rec.block);
      status.textContent = String(submit.pending || self.t("schemaForm.pending", "Submitting…"));
      status.className = "pui-schema-form-status is-busy";
      var result;
      if (typeof self.adapter.schemaFormAction === "function") result = self.adapter.schemaFormAction({op: "submit", values: values}, rec.value, block);
      else if (submit.call) result = self.adapter.callAction(String(submit.call), Object.assign({}, submit.args || {}, {values: values}));
      else result = true;
      var done = function (ok, message) {
        status.textContent = ok ? String(submit.result || message || "") : String(message || self.t("schemaForm.failed", "Submit failed"));
        status.className = "pui-schema-form-status " + (ok ? "is-ok" : "is-error");
        if (ok && submit.result) self.adapter.announce("success", String(submit.result));
        else if (!ok) self.adapter.announce("error", status.textContent);
        self.apply();
      };
      if (result && typeof result.then === "function") result.then(function (value) { done(value !== false, value && value.error); }, function (error) { done(false, error && error.message || error); });
      else done(result !== false);
    });
    this.schemaFormRecords.push(rec);
    return root;
  };

  Renderer.prototype.favoriteValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    var normalize = function (item) {
      return isObject(item) ? {id: String(item.id === undefined ? item.value : item.id), label: String(item.label || item.name || item.id || ""), kind: String(item.kind || ""), active: item.active === true} : null;
    };
    return {items: (isArray(value.items) ? value.items : (isArray(value.favorites) ? value.favorites : [])).map(normalize).filter(Boolean),
      recent: (isArray(value.recent) ? value.recent : []).map(normalize).filter(Boolean),
      selected: value.selected !== undefined ? String(value.selected) : "", error: String(value.error || ""),
      canRemove: value.canRemove !== false, canClearRecent: value.canClearRecent !== false};
  };

  Renderer.prototype.favoriteAction = function (rec, intent) {
    if (typeof this.adapter.favoriteAction === "function") {
      try { return this.adapter.favoriteAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Favorite action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose favorite actions.");
    return false;
  };

  Renderer.prototype.favoriteRefresh = function (rec) {
    var data = this.favoriteValue(rec);
    rec.value = data;
    var fill = function (list, items, section) {
      list.textContent = "";
      items.forEach(function (item) {
        var active = item.id === data.selected || item.active;
        var button = el("button", {type: "button", class: "pui-button pui-favorite-item" + (active ? " is-active" : ""), text: item.label || item.id, "aria-pressed": active ? "true" : "false"});
        if (item.kind) button.setAttribute("data-kind", item.kind);
        button.addEventListener("click", function () { rec.self.favoriteAction(rec, {op: "select", id: item.id, section: section}); });
        list.appendChild(button);
      });
    };
    fill(rec.favorites, data.items, "favorites");
    fill(rec.recent, data.recent, "recent");
    rec.favorites.hidden = !data.items.length;
    rec.recent.hidden = !data.recent.length || rec.options.recents === false;
    rec.recentTitle.hidden = rec.recent.hidden;
    rec.favoritesEmpty.hidden = !!data.items.length;
    rec.remove.disabled = !data.selected || !data.canRemove;
    rec.clearRecent.disabled = !data.recent.length || !data.canClearRecent;
    rec.status.textContent = data.error;
    rec.status.hidden = !data.error;
  };

  Renderer.prototype.buildFavorites = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.favorites_options) ? block.favorites_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("favorites." + key, fallback)); };
    var root = el("section", {class: "pui-favorites", "data-pui-favorites": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Favorites"))});
    var head = el("div", {class: "pui-favorites-head"}, el("h4", {text: String(block.label || text("title", "Favorites"))}));
    root.appendChild(head);
    var favorites = el("div", {class: "pui-favorite-list", role: "group", "aria-label": text("favorites", "Favorite parameters")});
    var empty = el("span", {class: "pui-favorite-empty", text: text("empty", "No favorites.")});
    root.appendChild(favorites); root.appendChild(empty);
    var recentLabel = el("h5", {class: "pui-favorite-subtitle", text: text("recent", "Recent")});
    root.appendChild(recentLabel);
    var recent = el("div", {class: "pui-favorite-list pui-favorite-recent", role: "group", "aria-label": text("recent", "Recent")});
    root.appendChild(recent);
    var bar = el("div", {class: "pui-favorite-actions"});
    var remove = el("button", {type: "button", class: "pui-button", text: text("remove", "Remove")});
    var clearRecent = el("button", {type: "button", class: "pui-button", text: text("clear_recent", "Clear recent")});
    remove.addEventListener("click", function () { var data = self.favoriteValue(rec); self.favoriteAction(rec, {op: "remove", id: data.selected}); });
    clearRecent.addEventListener("click", function () { self.favoriteAction(rec, {op: "clearRecent"}); });
    bar.appendChild(remove); bar.appendChild(clearRecent); root.appendChild(bar);
    var status = el("p", {class: "pui-favorite-status", role: "status", "aria-live": "polite", hidden: true});
    root.appendChild(status);
    var rec = {block: block, path: path, root: root, favorites: favorites, recent: recent, recentTitle: recentLabel, favoritesEmpty: empty, remove: remove, clearRecent: clearRecent, status: status, options: options, labels: labels, text: text, self: self, unsubscribe: null};
    if (typeof this.adapter.subscribeFavorites === "function") {
      try { rec.unsubscribe = this.adapter.subscribeFavorites(path, function (data) { if (isObject(data)) self.favoriteRefresh(rec); }); } catch (error) {}
    }
    this.favoriteRecords.push(rec);
    this.favoriteRefresh(rec);
    return root;
  };

  Renderer.prototype.mediaTimelineValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    if (value.mode === "sequence" && global.PupitreSequence) {
      var seq = global.PupitreSequence.normalize(value, rec.options);
      var selectedId = seq.selected;
      return {
        mode: "sequence", source: seq.source, fps: seq.fps, drop_frame: seq.dropFrame,
        duration: seq.duration, playhead: seq.playhead, snap: seq.snap, zoom: Math.max(0.1, Number(value.zoom) || 1),
        selected: selectedId, verbs: seq.verbs,
        tracks: seq.tracks.map(function (track) {
          return {id: track.id, label: track.label, kind: track.kind, muted: track.muted, solo: track.solo, locked: track.locked,
            clips: track.clips.map(function (clip) {
              return {id: clip.id, label: clip.label, start: clip.start, duration: clip.duration, end: clip.start + clip.duration,
                in: clip.in, out: clip.out, enabled: clip.enabled, disabled: !clip.enabled, order: clip.order,
                regionId: clip.regionId, kind: clip.kind, color: clip.color, thumb: clip.thumb,
                selected: String(clip.id) === selectedId};
            })};
        })
      };
    }
    var duration = Number(value.duration);
    if (!isFinite(duration) || duration <= 0) duration = 60;
    var clamp = function (time) { return Math.max(0, Math.min(duration, Number(time) || 0)); };
    var selected = value.selectedClip !== undefined ? String(value.selectedClip) : (value.selected !== undefined ? String(value.selected) : "");
    var tracks = (isArray(value.tracks) ? value.tracks : []).filter(isObject).map(function (track) {
      var id = String(track.id === undefined ? "" : track.id);
      var clips = (isArray(track.clips) ? track.clips : []).filter(isObject).map(function (clip) {
        var start = clamp(clip.start);
        var length = Math.max(0.01, Math.min(duration - start, Number(clip.duration) || 1));
        return {id: String(clip.id === undefined ? "" : clip.id), label: String(clip.label || clip.name || clip.id || "Clip"),
          start: start, duration: length, end: start + length, kind: String(clip.kind || "clip"), color: String(clip.color || ""),
          thumb: String(clip.thumb || clip.thumbnail || ""), selected: clip.selected === true || String(clip.id) === selected,
          disabled: clip.disabled === true};
      });
      return {id: id, label: String(track.label || track.name || id || "Track"), kind: String(track.kind || "track"),
        muted: track.muted === true, solo: track.solo === true, locked: track.locked === true, clips: clips};
    });
    return {duration: duration, playhead: clamp(value.playhead), snap: Math.max(0.01, Number(value.snap || rec.options.snap) || 0.5),
      tracks: tracks, selected: selected, zoom: Math.max(0.1, Number(value.zoom) || 1),
      fps: Number(value.fps || rec.options.fps) || 0, drop_frame: value.drop_frame === true || rec.options.drop_frame === true};
  };

  Renderer.prototype.mediaTimelineAction = function (rec, intent) {
    if (typeof this.adapter.mediaTimelineAction === "function") {
      try { return this.adapter.mediaTimelineAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Media timeline action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose media timeline actions.");
    return false;
  };

  Renderer.prototype.mediaTimelineSignature = function (data) {
    return JSON.stringify({mode: data.mode, duration: data.duration, fps: data.fps, drop_frame: data.drop_frame,
      verbs: data.verbs, tracks: data.tracks.map(function (track) {
      return {id: track.id, label: track.label, kind: track.kind, muted: track.muted, solo: track.solo, locked: track.locked,
        clips: track.clips.map(function (clip) { return {id: clip.id, label: clip.label, start: clip.start, duration: clip.duration, in: clip.in, out: clip.out, enabled: clip.enabled, order: clip.order, kind: clip.kind, color: clip.color, thumb: clip.thumb}; })};
    })});
  };

  Renderer.prototype.mediaTimelineTime = function (seconds, data) {
    if (data && data.fps && global.PupitreTimeline && global.PupitreTimeline.formatTimecode) {
      return global.PupitreTimeline.formatTimecode(seconds, data.fps, {drop_frame: data.drop_frame});
    }
    if (global.PupitreTimeline && global.PupitreTimeline.formatTime) return global.PupitreTimeline.formatTime(seconds);
    var total = Math.max(0, Number(seconds) || 0);
    var m = Math.floor(total / 60), s = Math.floor(total % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  };

  Renderer.prototype.mediaTimelineSeekAt = function (rec, event, target) {
    if (!target || !target.getBoundingClientRect) return;
    var rect = target.getBoundingClientRect();
    if (!rect.width) return;
    var x = Math.max(0, Math.min(rect.width, Number(event.clientX) - rect.left));
    var time = x / rect.width * rec.value.duration;
    if (global.PupitreTimeline && global.PupitreTimeline.snapTime) time = global.PupitreTimeline.snapTime(time, rec.value.snap, rec.value.duration);
    this.mediaTimelineAction(rec, {op: "seek", time: time});
  };

  Renderer.prototype.mediaTimelineSeek = function (rec, event) {
    this.mediaTimelineSeekAt(rec, event, event.currentTarget || event.target);
  };

  Renderer.prototype.mediaTimelineScrubStart = function (rec, event) {
    if (!rec || !rec.value || (event.button !== undefined && event.button !== 0)) return;
    if (event.target && event.target.closest && event.target.closest(".pui-media-clip")) return;
    var target = event.currentTarget;
    if (!target || !target.getBoundingClientRect) return;
    if (event.preventDefault) event.preventDefault();
    rec.scrub = {target: target};
    this.mediaTimelineSeekAt(rec, event, target);
    var self = this;
    var move = function (moveEvent) { if (rec.scrub) self.mediaTimelineSeekAt(rec, moveEvent, rec.scrub.target); };
    var end = function () {
      rec.scrub = null;
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
      }
    };
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
    }
  };

  Renderer.prototype.mediaTimelineSelect = function (rec, trackId, clipId) {
    this.mediaTimelineAction(rec, {op: "select", trackId: trackId, clipId: clipId});
    this.mediaTimelineRefresh(rec);
  };

  Renderer.prototype.mediaTimelineKeyboard = function (rec, event, track, clip) {
    var key = String(event.key || "");
    if (key === "Enter" || key === " ") { event.preventDefault(); this.mediaTimelineSelect(rec, track.id, clip.id); return; }
    if (rec.value && rec.value.mode === "sequence" && (key === "s" || key === "S")) { event.preventDefault(); this.mediaTimelineAction(rec, {op: "split", trackId: track.id, clipId: clip.id, at: rec.value.playhead}); return; }
    if (rec.value && rec.value.mode === "sequence" && (key === "d" || key === "D")) { event.preventDefault(); this.mediaTimelineAction(rec, {op: "duplicate", trackId: track.id, clipId: clip.id}); return; }
    if (rec.value && rec.value.mode === "sequence" && (key === "e" || key === "E")) { event.preventDefault(); this.mediaTimelineAction(rec, {op: "enable", trackId: track.id, clipId: clip.id, enabled: clip.enabled === false}); return; }
    if (key === "Delete" || key === "Backspace") { event.preventDefault(); this.mediaTimelineAction(rec, {op: "remove", trackId: track.id, clipId: clip.id}); return; }
    if (key !== "ArrowLeft" && key !== "ArrowRight") return;
    event.preventDefault();
    var direction = key === "ArrowRight" ? 1 : -1;
    var step = (Number(event.shiftKey ? 5 : 1) * rec.value.snap);
    if (event.shiftKey) {
      var length = Math.max(0.01, clip.duration + direction * step);
      this.mediaTimelineAction(rec, {op: "trim", trackId: track.id, clipId: clip.id, start: clip.start, duration: length});
    } else if (rec.value.mode === "sequence") {
      var index = track.clips.findIndex(function (item) { return String(item.id) === String(clip.id); });
      var target = Math.max(0, Math.min(track.clips.length - 1, index + direction));
      if (target !== index) this.mediaTimelineAction(rec, {op: "reorder", trackId: track.id, clipId: clip.id, index: target});
    } else {
      var start = Math.max(0, Math.min(rec.value.duration - clip.duration, clip.start + direction * step));
      this.mediaTimelineAction(rec, {op: "move", trackId: track.id, clipId: clip.id, start: start});
    }
  };

  Renderer.prototype.mediaTimelineClipDrag = function (rec, event, track, clip, handle) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.preventDefault) event.preventDefault();
    var lane = event.currentTarget && event.currentTarget.parentNode;
    if (!lane || !lane.getBoundingClientRect) return;
    var rect = lane.getBoundingClientRect();
    if (!rect.width) return;
    var drag = {mode: handle ? "trim" : "move", trackId: track.id, clipId: clip.id, clip: clip,
      start: clip.start, duration: clip.duration, x: Number(event.clientX), width: rect.width, moved: false,
      element: event.currentTarget, initialLeft: clip.start / rec.value.duration * 100, initialWidth: clip.duration / rec.value.duration * 100};
    var move = function (moveEvent) {
      var delta = (Number(moveEvent.clientX) - drag.x) / drag.width * rec.value.duration;
      if (Math.abs(delta) < rec.value.snap / 4) return;
      drag.moved = true;
      var next = drag.start + delta;
      if (rec.value.snap) next = Math.round(next / rec.value.snap) * rec.value.snap;
      if (drag.mode === "move") {
        next = Math.max(0, Math.min(rec.value.duration - drag.duration, next));
        if (drag.element && drag.element.style) drag.element.style.left = (next / rec.value.duration * 100) + "%";
      } else {
        var length = Math.max(0.01, Math.min(rec.value.duration - drag.start, drag.duration + delta));
        if (rec.value.snap) length = Math.max(rec.value.snap, Math.round(length / rec.value.snap) * rec.value.snap);
        if (drag.element && drag.element.style) drag.element.style.width = (length / rec.value.duration * 100) + "%";
      }
    };
    var end = function (upEvent) {
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
      }
      if (!drag.moved) return;
      var delta = (Number(upEvent.clientX) - drag.x) / drag.width * rec.value.duration;
      var accepted = true;
      if (drag.mode === "move" && rec.value.mode === "sequence") {
        var time = (Number(upEvent.clientX) - rect.left) / Math.max(1, rect.width) * rec.value.duration;
        var track = rec.value.tracks.find(function (item) { return String(item.id) === String(drag.trackId); });
        var itemIndex = track ? track.clips.findIndex(function (item) { return String(item.id) === String(drag.clipId); }) : -1;
        var target = 0;
        (track ? track.clips : []).forEach(function (item) {
          if (String(item.id) !== String(drag.clipId) && item.start + item.duration / 2 < time) target++;
        });
        if (track && target !== itemIndex) accepted = rec.self.mediaTimelineAction(rec, {op: "reorder", trackId: drag.trackId, clipId: drag.clipId, index: target}) !== false;
      } else if (drag.mode === "move") {
        var start = drag.start + delta;
        if (rec.value.snap) start = Math.round(start / rec.value.snap) * rec.value.snap;
        start = Math.max(0, Math.min(rec.value.duration - drag.duration, start));
        accepted = rec.self.mediaTimelineAction(rec, {op: "move", trackId: drag.trackId, clipId: drag.clipId, start: start}) !== false;
      } else {
        var length = Math.max(0.01, drag.duration + delta);
        if (rec.value.snap) length = Math.max(rec.value.snap, Math.round(length / rec.value.snap) * rec.value.snap);
        length = Math.min(rec.value.duration - drag.start, length);
        accepted = rec.self.mediaTimelineAction(rec, {op: "trim", trackId: drag.trackId, clipId: drag.clipId, start: drag.start, duration: length}) !== false;
      }
      if (!accepted && drag.element) {
        drag.element.style.left = (drag.start / rec.value.duration * 100) + "%";
        drag.element.style.width = (drag.duration / rec.value.duration * 100) + "%";
        rec.self.adapter.announce("error", "Host rejected " + drag.mode + "; restored the segment.");
      }
      rec.self.mediaTimelineRefresh(rec);
    };
    if (event.currentTarget && event.currentTarget.setPointerCapture && event.pointerId !== undefined) {
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
      document.addEventListener("pointercancel", end);
    }
  };

  Renderer.prototype.mediaTimelineInspector = function (rec, force) {
    if (!rec || !rec.inspector) return;
    if (!Object.keys(rec.inspectorFields || {}).length) {
      var self = this;
      var fields = rec.inspectorFields = {};
      var head = el("div", {class: "pui-media-inspector-head"});
      head.appendChild(el("strong", {text: "Segment"}));
      fields.title = el("span", {class: "pui-media-inspector-title"});
      head.appendChild(fields.title);
      rec.inspector.appendChild(head);
      var grid = el("div", {class: "pui-media-inspector-grid"});
      fields.label = el("input", {type: "text", "aria-label": "Segment label"});
      fields.in = el("input", {type: "number", step: "0.01", min: "0", "aria-label": "Source in"});
      fields.out = el("input", {type: "number", step: "0.01", min: "0", "aria-label": "Source out"});
      fields.duration = el("output", {class: "pui-media-inspector-readout", "aria-label": "Duration"});
      fields.timecode = el("output", {class: "pui-media-inspector-readout", "aria-label": "Source timecode"});
      fields.enabled = el("input", {type: "checkbox", "aria-label": "Segment enabled"});
      [["Label", fields.label], ["Source in", fields.in], ["Source out", fields.out], ["Duration", fields.duration], ["Source timecode", fields.timecode]].forEach(function (pair) {
        var label = el("label", {class: "pui-media-inspector-field"});
        label.appendChild(el("span", {text: pair[0]}));
        label.appendChild(pair[1]);
        grid.appendChild(label);
      });
      var enabledRow = el("label", {class: "pui-media-inspector-enabled"});
      enabledRow.appendChild(fields.enabled);
      enabledRow.appendChild(el("span", {text: "Enabled"}));
      grid.appendChild(enabledRow);
      rec.inspector.appendChild(grid);
      var commit = function (intent) {
        var accepted = self.mediaTimelineAction(rec, intent);
        self.mediaTimelineRefresh(rec);
        self.mediaTimelineInspector(rec, true);
        if (accepted === false) {
          rec.status.textContent = "Host rejected " + String(intent.op || "segment edit") + ".";
          rec.status.hidden = false;
          self.adapter.announce("error", rec.status.textContent);
        } else {
          rec.status.textContent = "";
          rec.status.hidden = true;
        }
        return accepted !== false;
      };
      fields.label.addEventListener("change", function () {
        var selected = self.mediaTimelineSelectedClip(rec.value);
        if (selected) commit({op: "set_label", trackId: selected.track.id, clipId: selected.clip.id, label: fields.label.value});
      });
      var commitRange = function () {
        var selected = self.mediaTimelineSelectedClip(rec.value);
        if (!selected) return;
        var tin = Number(fields.in.value), tout = Number(fields.out.value);
        if (!isFinite(tin) || !isFinite(tout) || tin < 0 || tout <= tin) {
          rec.status.textContent = "Source out must be greater than source in.";
          rec.status.hidden = false;
          self.mediaTimelineRefresh(rec);
          self.mediaTimelineInspector(rec, true);
          return;
        }
        commit({op: "set_in_out", trackId: selected.track.id, clipId: selected.clip.id, in: tin, out: tout});
      };
      fields.in.addEventListener("change", commitRange);
      fields.out.addEventListener("change", commitRange);
      fields.enabled.addEventListener("change", function () {
        var selected = self.mediaTimelineSelectedClip(rec.value);
        if (selected) commit({op: "enable", trackId: selected.track.id, clipId: selected.clip.id, enabled: fields.enabled.checked});
      });
    }
    var selected = this.mediaTimelineSelectedClip(rec.value);
    var sequence = rec.value && rec.value.mode === "sequence";
    var visible = sequence && selected && rec.options.inspector !== false;
    rec.inspector.hidden = !visible;
    if (!visible) return;
    var clip = selected.clip;
    rec.inspectorFields.title.textContent = clip.label + " · " + selected.track.label;
    if (force || document.activeElement !== rec.inspectorFields.label) rec.inspectorFields.label.value = clip.label;
    if (force || document.activeElement !== rec.inspectorFields.in) rec.inspectorFields.in.value = String(clip.in);
    if (force || document.activeElement !== rec.inspectorFields.out) rec.inspectorFields.out.value = String(clip.out);
    var sourceDuration = Number(rec.value.source && rec.value.source.duration);
    if (force || document.activeElement !== rec.inspectorFields.in) {
      if (isFinite(sourceDuration) && sourceDuration > 0) rec.inspectorFields.in.max = rec.inspectorFields.out.max = String(sourceDuration);
      else { rec.inspectorFields.in.removeAttribute("max"); rec.inspectorFields.out.removeAttribute("max"); }
    }
    rec.inspectorFields.duration.textContent = clip.duration.toFixed(2) + " s";
    rec.inspectorFields.timecode.textContent = this.mediaTimelineTime(clip.in, rec.value);
    rec.inspectorFields.enabled.checked = clip.enabled !== false;
  };

  Renderer.prototype.mediaTimelineBuild = function (rec, data) {
    var self = this;
    rec.value = data;
    rec.signature = this.mediaTimelineSignature(data);
    rec.labelsEl.textContent = "";
    rec.lanesEl.textContent = "";
    rec.ruler.textContent = "";
    rec.clipEls = {};
    var step = Number(rec.options.ruler_step) > 0 ? Number(rec.options.ruler_step) : Math.max(1, data.duration / 8);
    for (var tick = 0; tick <= data.duration + 0.001; tick += step) {
      var at = Math.min(data.duration, tick);
      var mark = el("span", {class: "pui-media-ruler-tick", style: "left:" + (at / data.duration * 100) + "%;"});
      mark.appendChild(el("span", {class: "pui-media-ruler-label", text: this.mediaTimelineTime(at, data)}));
      rec.ruler.appendChild(mark);
    }
    data.tracks.forEach(function (track) {
      var label = el("div", {class: "pui-media-track-label" + (track.muted ? " is-muted" : ""), "data-track-id": track.id});
      label.appendChild(el("span", {class: "pui-media-track-name", text: track.label}));
      if (track.kind) label.appendChild(el("span", {class: "pui-media-track-kind", text: track.kind}));
      if (track.locked) label.appendChild(el("span", {class: "pui-media-track-state", text: rec.text("locked", "Locked")}));
      var trackTools = el("span", {class: "pui-media-track-tools"});
      [["mute", "M", track.muted], ["solo", "S", track.solo]].forEach(function (entry) {
        var button = el("button", {type: "button", class: "pui-button pui-media-track-toggle", text: entry[1], "aria-pressed": entry[2] ? "true" : "false", "aria-label": (entry[0] === "mute" ? "Mute" : "Solo") + " track " + track.label});
        button.disabled = !!rec.block.readonly;
        button.addEventListener("click", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          self.mediaTimelineAction(rec, {op: "track." + entry[0], trackId: track.id, value: !entry[2]});
          self.mediaTimelineRefresh(rec);
        });
        trackTools.appendChild(button);
      });
      label.appendChild(trackTools);
      rec.labelsEl.appendChild(label);
      var lane = el("div", {class: "pui-media-lane", "data-track-id": track.id, role: "list", "aria-label": track.label});
      lane.addEventListener("pointerdown", function (event) { self.mediaTimelineScrubStart(rec, event); });
      track.clips.forEach(function (clip) {
        var clipEl = el("button", {type: "button", class: "pui-media-clip" + (clip.selected ? " is-selected" : "") + (clip.disabled ? " is-disabled" : ""),
          role: "listitem", "data-track-id": track.id, "data-clip-id": clip.id, "aria-label": clip.label + " · " + self.mediaTimelineTime(clip.start, data) + " – " + self.mediaTimelineTime(clip.end, data),
          title: clip.label + " · " + self.mediaTimelineTime(clip.start, data) + " – " + self.mediaTimelineTime(clip.end, data), style: "left:" + (clip.start / data.duration * 100) + "%;width:" + (clip.duration / data.duration * 100) + "%;"});
        if (clip.color) clipEl.style.setProperty("--pui-media-clip-color", clip.color);
        if (clip.thumb) clipEl.style.backgroundImage = "url(\"" + clip.thumb.replace(/"/g, "%22") + "\")";
        clipEl.appendChild(el("span", {class: "pui-media-clip-label", text: clip.label}));
        clipEl.appendChild(el("span", {class: "pui-media-clip-time", text: self.mediaTimelineTime(clip.duration, data)}));
        var trim = el("span", {class: "pui-media-trim", "aria-hidden": "true"});
        clipEl.appendChild(trim);
        clipEl.addEventListener("click", function (event) { if (event.stopPropagation) event.stopPropagation(); self.mediaTimelineSelect(rec, track.id, clip.id); });
        clipEl.addEventListener("keydown", function (event) { self.mediaTimelineKeyboard(rec, event, track, clip); });
        clipEl.addEventListener("pointerdown", function (event) { self.mediaTimelineClipDrag(rec, event, track, clip, event.target === trim); });
        lane.appendChild(clipEl);
        rec.clipEls[track.id + "/" + clip.id] = clipEl;
      });
      rec.lanesEl.appendChild(lane);
    });
    rec.playheadEl = el("span", {class: "pui-media-playhead", "aria-hidden": "true"});
    rec.lanesEl.appendChild(rec.playheadEl);
    this.mediaTimelineBuildTools(rec, data);
  };

  Renderer.prototype.mediaTimelineRefresh = function (rec, update) {
    var data = this.mediaTimelineValue(rec);
    if (isObject(update)) data = Object.assign({}, data, update);
    var signature = this.mediaTimelineSignature(data);
    if (signature !== rec.signature) this.mediaTimelineBuild(rec, data);
    else rec.value = data;
    rec.time.textContent = this.mediaTimelineTime(data.playhead, data) + " / " + this.mediaTimelineTime(data.duration, data);
    if (rec.playheadEl) rec.playheadEl.style.left = (data.playhead / data.duration * 100) + "%";
    data.tracks.forEach(function (track) {
      track.clips.forEach(function (clip) {
        var clipEl = rec.clipEls[track.id + "/" + clip.id];
        if (!clipEl) return;
        clipEl.classList.toggle("is-selected", clip.selected);
        clipEl.setAttribute("aria-selected", clip.selected ? "true" : "false");
      });
    });
    this.mediaTimelineUpdateTools(rec, data);
    this.mediaTimelineInspector(rec);
  };

  Renderer.prototype.mediaTimelineSelectedClip = function (data) {
    for (var t = 0; t < (data.tracks || []).length; t++) {
      var track = data.tracks[t];
      for (var c = 0; c < (track.clips || []).length; c++) {
        if (track.clips[c].selected) return {track: track, clip: track.clips[c]};
      }
    }
    return null;
  };

  Renderer.prototype.mediaTimelineTool = function (rec, id, label, op, enabled) {
    var self = this;
    var button = el("button", {type: "button", class: "pui-button pui-media-tool", text: label});
    button.disabled = !enabled;
    button.addEventListener("click", function () { self.mediaTimelineAction(rec, op()); self.mediaTimelineRefresh(rec); });
    rec.toolButtons[id] = button;
    rec.toolsEl.appendChild(button);
    return button;
  };

  Renderer.prototype.mediaTimelineBuildTools = function (rec, data) {
    if (!rec.toolsEl) return;
    rec.toolsEl.textContent = "";
    rec.toolButtons = {};
    if (data.mode !== "sequence" || rec.block.readonly) return;
    var verbs = isArray(data.verbs) ? data.verbs : [];
    var has = function (verb) { return verbs.indexOf(verb) >= 0; };
    var selected = this.mediaTimelineSelectedClip(data);
    var trackId = selected ? selected.track.id : ((data.tracks.find(function (track) { return track.kind !== "audio"; }) || data.tracks[0] || {}).id || "");
    if (has("add")) this.mediaTimelineTool(rec, "add", "Add", function () { return {op: "add", trackId: trackId, at: data.playhead}; }, true);
    if (has("split")) this.mediaTimelineTool(rec, "split", "Split", function () { return {op: "split", trackId: selected && selected.track.id, clipId: selected && selected.clip.id, at: data.playhead}; }, !!selected);
    if (has("duplicate")) this.mediaTimelineTool(rec, "duplicate", "Duplicate", function () { return {op: "duplicate", trackId: selected && selected.track.id, clipId: selected && selected.clip.id}; }, !!selected);
    if (has("enable")) this.mediaTimelineTool(rec, "enable", "Toggle", function () { return {op: "enable", trackId: selected && selected.track.id, clipId: selected && selected.clip.id, enabled: !(selected && selected.clip.enabled)}; }, !!selected);
    if (has("remove")) this.mediaTimelineTool(rec, "remove", "Delete", function () { return {op: "remove", trackId: selected && selected.track.id, clipId: selected && selected.clip.id}; }, !!selected);
    var activeTrack = selected ? selected.track.id : ((data.tracks[0] || {}).id || "");
    if (has("track.add")) this.mediaTimelineTool(rec, "track-add", "Track +", function () { return {op: "track.add", trackId: activeTrack}; }, true);
    if (has("track.remove")) this.mediaTimelineTool(rec, "track-remove", "Track −", function () { return {op: "track.remove", trackId: activeTrack}; }, data.tracks.length > 1);
    this.mediaTimelineUpdateTools(rec, data);
  };

  Renderer.prototype.mediaTimelineUpdateTools = function (rec, data) {
    var selected = this.mediaTimelineSelectedClip(data);
    var inside = selected && data.playhead > selected.clip.start && data.playhead < selected.clip.start + selected.clip.duration;
    if (rec.toolButtons.split) rec.toolButtons.split.disabled = !inside;
    if (rec.toolButtons.duplicate) rec.toolButtons.duplicate.disabled = !selected;
    if (rec.toolButtons.enable) rec.toolButtons.enable.disabled = !selected;
    if (rec.toolButtons.remove) rec.toolButtons.remove.disabled = !selected;
    var activeTrack = selected ? selected.track.id : ((data.tracks[0] || {}).id || "");
    if (rec.toolButtons['track-remove']) rec.toolButtons['track-remove'].disabled = data.tracks.length < 2 || !activeTrack;
  };

  Renderer.prototype.buildMediaTimeline = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.mediaTimeline_options) ? block.mediaTimeline_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("mediaTimeline." + key, fallback)); };
    var root = el("section", {class: "pui-media-timeline", "data-pui-media-timeline": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Media timeline"))});
    var head = el("div", {class: "pui-media-timeline-head"});
    head.appendChild(el("h4", {text: String(block.label || text("title", "Media timeline"))}));
    var time = el("output", {class: "pui-media-timeline-time", "aria-live": "polite"});
    head.appendChild(time);
    var tools = el("div", {class: "pui-media-tools"});
    head.appendChild(tools);
    root.appendChild(head);
    var stage = el("div", {class: "pui-media-timeline-stage"});
    var corner = el("div", {class: "pui-media-corner", "aria-hidden": "true"});
    var ruler = el("div", {class: "pui-media-ruler", "aria-hidden": "true"});
    ruler.addEventListener("pointerdown", function (event) { self.mediaTimelineScrubStart(rec, event); });
    var labelsEl = el("div", {class: "pui-media-track-labels"});
    var lanesEl = el("div", {class: "pui-media-lanes"});
    stage.appendChild(corner); stage.appendChild(ruler); stage.appendChild(labelsEl); stage.appendChild(lanesEl);
    root.appendChild(stage);
    var inspector = el("div", {class: "pui-media-inspector", "data-pui-segment-inspector": "", hidden: true});
    root.appendChild(inspector);
    var status = el("p", {class: "pui-media-timeline-status", role: "status", "aria-live": "polite", hidden: true});
    root.appendChild(status);
    var rec = {block: block, path: path, root: root, options: options, labels: labels, text: text, time: time, toolsEl: tools, toolButtons: {}, ruler: ruler, labelsEl: labelsEl, lanesEl: lanesEl, inspector: inspector, inspectorFields: {}, status: status, playheadEl: null, clipEls: {}, signature: "", value: null, unsubscribe: null, self: self};
    if (typeof this.adapter.subscribeMediaTimeline === "function") {
      try { rec.unsubscribe = this.adapter.subscribeMediaTimeline(path, function (data) { if (isObject(data)) self.mediaTimelineRefresh(rec, data); }); } catch (error) {}
    }
    this.mediaTimelineRecords.push(rec);
    this.mediaTimelineRefresh(rec);
    return root;
  };

  Renderer.prototype.workspaceValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    var items = isArray(value.items) ? value.items.filter(isObject) : (isArray(value.workspaces) ? value.workspaces.filter(isObject) : []);
    var selected = value.selected !== undefined ? String(value.selected) : (value.active !== undefined ? String(value.active) : "");
    return {items: items, selected: selected, canSave: value.canSave !== false, canDelete: value.canDelete !== false, canRename: value.canRename !== false, error: String(value.error || "")};
  };

  Renderer.prototype.workspaceAction = function (rec, intent) {
    if (typeof this.adapter.workspaceAction === "function") {
      try { return this.adapter.workspaceAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Workspace action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose workspace actions.");
    return false;
  };

  Renderer.prototype.workspaceRefresh = function (rec) {
    var data = this.workspaceValue(rec);
    rec.value = data;
    rec.list.textContent = "";
    if (!data.items.length) rec.list.appendChild(el("span", {class: "pui-workspace-empty", text: rec.text("empty", "No workspaces.")}));
    data.items.forEach(function (item) {
      var id = String(item.id === undefined ? item.value : item.id);
      var active = String(item.id !== undefined ? item.id : item.value) === data.selected || item.active === true;
      var button = el("button", {type: "button", class: "pui-button pui-workspace-item" + (active ? " is-active" : ""), text: String(item.label || item.name || id), "aria-pressed": active ? "true" : "false"});
      button.addEventListener("click", function () { rec.self.workspaceAction(rec, {op: "select", id: id}); });
      rec.list.appendChild(button);
    });
    var selected = data.items.find(function (item) { return String(item.id !== undefined ? item.id : item.value) === data.selected; });
    if (document.activeElement !== rec.name && selected) rec.name.value = String(selected.label || selected.name || data.selected);
    else if (!selected && document.activeElement !== rec.name) rec.name.value = "";
    rec.save.disabled = !data.canSave;
    rec.rename.disabled = !data.canRename || !data.selected;
    rec.remove.disabled = !data.canDelete || !data.selected;
    rec.status.textContent = data.error;
    rec.status.hidden = !data.error;
  };

  Renderer.prototype.buildWorkspaces = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.workspaces_options) ? block.workspaces_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("workspaces." + key, fallback)); };
    var root = el("section", {class: "pui-workspaces", "data-pui-workspaces": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Workspaces"))});
    var head = el("div", {class: "pui-workspaces-head"}, el("h4", {text: String(block.label || text("title", "Workspaces"))}));
    root.appendChild(head);
    var list = el("div", {class: "pui-workspace-list", role: "group", "aria-label": text("list", "Saved workspaces")});
    root.appendChild(list);
    var row = el("div", {class: "pui-workspace-controls"});
    var name = el("input", {type: "text", class: "pui-workspace-name", "aria-label": text("name", "Workspace name"), placeholder: text("placeholder", "Workspace name")});
    var save = el("button", {type: "button", class: "pui-button pui-primary", text: text("save", "Save")});
    var rename = el("button", {type: "button", class: "pui-button", text: text("rename", "Rename")});
    var remove = el("button", {type: "button", class: "pui-button pui-danger", text: text("delete", "Delete")});
    save.addEventListener("click", function () {
      var value = name.value.trim();
      if (!value) { name.focus(); return; }
      self.workspaceAction(rec, {op: "save", name: value});
    });
    rename.addEventListener("click", function () {
      var value = name.value.trim();
      if (!value) { name.focus(); return; }
      self.workspaceAction(rec, {op: "rename", id: self.workspaceValue(rec).selected, name: value});
    });
    remove.addEventListener("click", function () { self.workspaceAction(rec, {op: "delete", id: self.workspaceValue(rec).selected}); });
    row.appendChild(name); row.appendChild(save); row.appendChild(rename); row.appendChild(remove);
    root.appendChild(row);
    var status = el("p", {class: "pui-workspace-status", role: "status", "aria-live": "polite", hidden: true});
    root.appendChild(status);
    var rec = {block: block, path: path, root: root, list: list, name: name, save: save, rename: rename, remove: remove, status: status, options: options, labels: labels, text: text, self: self};
    this.workspaceRecords.push(rec);
    this.workspaceRefresh(rec);
    return root;
  };

  Renderer.prototype.bindingValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    var control = value.control;
    var controlText = "";
    if (isObject(control)) controlText = String(control.label || [control.source, control.type, control.number].filter(function (part) { return part !== undefined && part !== ""; }).join(" "));
    else if (control !== undefined && control !== null) controlText = String(control);
    var error = String(value.error || "");
    var conflict = String(value.conflict || "");
    var state = value.learning === true ? "learning" : (error || conflict ? "error" : (controlText ? "bound" : "unbound"));
    return {label: String(value.label || rec.block.label || rec.text("title", "Binding")), target: String(value.target || ""), control: controlText,
      value: value.value, valueText: value.valueText !== undefined ? String(value.valueText) : (value.value !== undefined ? String(value.value) : ""),
      state: String(value.state || state), learning: value.learning === true, error: error, conflict: conflict, disabled: value.disabled === true,
      canLearn: value.canLearn !== false, canClear: value.canClear !== false && !!controlText};
  };

  Renderer.prototype.bindingAction = function (rec, intent) {
    if (typeof this.adapter.bindingAction === "function") {
      try { return this.adapter.bindingAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Binding action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose binding actions.");
    return false;
  };

  Renderer.prototype.bindingRefresh = function (rec, update) {
    var data = this.bindingValue(rec);
    if (isObject(update)) data = Object.assign({}, data, update);
    rec.value = data;
    rec.bindingLabel.textContent = data.label;
    rec.target.textContent = data.target;
    rec.target.hidden = !data.target;
    rec.control.textContent = data.control || rec.text("unbound", "Not bound");
    rec.valueText.textContent = data.valueText;
    rec.valueText.hidden = !data.valueText;
    rec.learn.textContent = data.learning ? rec.text("cancel", "Cancel") : rec.text("learn", "Learn");
    rec.learn.disabled = data.disabled || (data.learning ? false : !data.canLearn);
    rec.learn.setAttribute("aria-busy", data.learning ? "true" : "false");
    rec.clear.disabled = data.disabled || !data.canClear || data.learning;
    rec.root.setAttribute("data-state", data.state);
    var message = data.error || data.conflict || (data.learning ? rec.text("move", "Move a control to learn…") : "");
    rec.status.textContent = message;
    rec.status.hidden = !message;
    rec.status.setAttribute("data-tone", data.error || data.conflict ? "error" : data.learning ? "info" : "");
  };

  Renderer.prototype.buildBinding = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.binding_options) ? block.binding_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("binding." + key, fallback)); };
    var root = el("section", {class: "pui-binding", "data-pui-binding": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Binding"))});
    var rec = {block: block, path: path, root: root, options: options, labels: labels, text: text, unsubscribe: null};
    var head = el("div", {class: "pui-binding-head"});
    var label = el("span", {class: "pui-binding-label"});
    var target = el("span", {class: "pui-binding-target"});
    head.appendChild(label); head.appendChild(target);
    root.appendChild(head);
    var row = el("div", {class: "pui-binding-controls"});
    var control = el("output", {class: "pui-binding-control", "aria-live": "polite"});
    var valueText = el("output", {class: "pui-binding-value"});
    var learn = el("button", {type: "button", class: "pui-button pui-primary", text: text("learn", "Learn")});
    var clear = el("button", {type: "button", class: "pui-button", text: text("clear", "Clear")});
    learn.addEventListener("click", function () {
      var value = self.bindingValue(rec);
      self.bindingAction(rec, {op: value.learning ? "cancel" : "learn", target: value.target});
    });
    clear.addEventListener("click", function () { self.bindingAction(rec, {op: "clear"}); });
    row.appendChild(control); row.appendChild(valueText); row.appendChild(learn); row.appendChild(clear);
    root.appendChild(row);
    var status = el("p", {class: "pui-binding-status", role: "status", "aria-live": "polite", hidden: true});
    root.appendChild(status);
    rec.bindingLabel = label; rec.target = target; rec.control = control; rec.valueText = valueText; rec.learn = learn; rec.clear = clear; rec.status = status;
    if (typeof this.adapter.subscribeBindings === "function") {
      try { rec.unsubscribe = this.adapter.subscribeBindings(path, function (data) { if (isObject(data)) self.bindingRefresh(rec, data); }); } catch (error) {}
    }
    this.bindingRecords.push(rec);
    this.bindingRefresh(rec);
    return root;
  };

  Renderer.prototype.buildDialog = function (block) {
    var self = this;
    var root = el("section", {class: "pui-dialog-block", "data-pui-dialog": String(block.id || "")});
    var trigger = el("button", {type: "button", class: "pui-button pui-dialog-trigger", text: String(block.trigger || block.label || this.t("dialog.open", "Open"))});
    root.appendChild(trigger);
    var titleId = this.id("dialog-title");
    var dialog = el("dialog", {class: "pui-dialog pui-block-dialog", "aria-labelledby": titleId});
    var form = el("form", {method: "dialog"});
    form.appendChild(el("h2", {id: titleId, text: String(block.label || this.t("dialog.title", "Dialog"))}));
    var body = el("div", {class: "pui-dialog-body"});
    var blocks = isArray(block.blocks) ? block.blocks : [];
    blocks.forEach(function (child) { if (isObject(child)) body.appendChild(self.buildBlock(child)); });
    form.appendChild(body);
    var status = el("p", {class: "pui-dialog-status", role: "status", "aria-live": "polite"});
    form.appendChild(status);
    var bar = el("div", {class: "pui-dialog-actions"});
    var submit = isObject(block.submit) ? block.submit : null;
    var cancel = isObject(block.cancel) ? block.cancel : {label: this.t("dialog.cancel", "Close")};
    var submitButton = submit ? el("button", {type: "submit", class: "pui-button pui-primary", text: String(submit.label || this.t("dialog.submit", "Apply"))}) : null;
    if (submitButton) bar.appendChild(submitButton);
    var cancelButton = el("button", {type: "button", class: "pui-button", text: String(cancel.label || this.t("dialog.cancel", "Close"))});
    bar.appendChild(cancelButton);
    form.appendChild(bar);
    dialog.appendChild(form);
    root.appendChild(dialog);
    var rec = {block: block, root: root, trigger: trigger, dialog: dialog, body: body, status: status, localOpen: block.open === true,
      fields: blocks.filter(function (child) { return isObject(child) && String(child.kind || "field") === "field"; })};
    rec.block = Object.assign({}, block, {fields: rec.fields});
    var readOpen = function () {
      if (block.open_bind) { var value = self.adapter.getValue(String(block.open_bind)); return value === true || value === 1 || value === "true"; }
      return !!rec.localOpen;
    };
    var focusInside = function () {
      var first = body.querySelector("button, input, select, textarea, [tabindex]");
      if (first && first.focus) { first.focus(); return; }
      if (dialog.focus) { if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1"); dialog.focus(); }
    };
    var render = function () {
      var open = readOpen();
      var wasOpen = rec.wasOpen === true;
      rec.wasOpen = open;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (open && !dialog.open) { if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.open = true; }
      else if (!open && dialog.open) { if (typeof dialog.close === "function") dialog.close(); else dialog.open = false; }
      if (open && !wasOpen) focusInside();
      else if (!open && wasOpen) trigger.focus();
    };
    var setOpen = function (open) {
      if (block.open_bind) self.setPath(String(block.open_bind), !!open, block);
      else rec.localOpen = !!open;
      render();
    };
    trigger.addEventListener("click", function () { setOpen(!readOpen()); });
    cancelButton.addEventListener("click", function () {
      if (typeof self.adapter.dialogAction === "function") self.adapter.dialogAction({op: "cancel", values: self.formValues(rec.block)}, rec.block, block);
      else if (cancel.call) self.adapter.callAction(String(cancel.call), {values: self.formValues(rec.block)});
      setOpen(false);
    });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); setOpen(false); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (submit) {
        if (!self.formValidate(rec)) return;
        var values = self.formValues(rec.block);
        status.textContent = String(submit.pending || self.t("dialog.pending", "Submitting…"));
        var result;
        if (typeof self.adapter.dialogAction === "function") result = self.adapter.dialogAction({op: "submit", values: values}, rec.block, block);
        else if (submit.call) result = self.adapter.callAction(String(submit.call), Object.assign({}, submit.args || {}, {values: values}));
        else result = true;
        if (result && typeof result.then === "function") result.then(function (ok) { status.textContent = String(ok === false ? self.t("dialog.failed", "Submit failed") : submit.result || ""); if (ok !== false) setOpen(false); });
        else { status.textContent = String(result === false ? self.t("dialog.failed", "Submit failed") : submit.result || ""); if (result !== false) setOpen(false); }
      } else setOpen(false);
    });
    rec.render = render;
    this.dialogRecords = this.dialogRecords || [];
    this.dialogRecords.push(rec);
    render();
    return root;
  };

  Renderer.prototype.transportValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    return {
      playing: value.playing === true,
      position: Number(value.position) || 0,
      duration: Math.max(0, Number(value.duration) || 0),
      loop: value.loop === true,
      rate: Number(value.rate) || 1,
      canPlay: value.canPlay !== false,
      canPause: value.canPause !== false,
      canStop: value.canStop !== false,
      canSeek: value.canSeek !== false,
      canLoop: value.canLoop !== false,
      canRate: value.canRate !== false,
      fps: Number(value.fps || (rec.options && rec.options.fps)) || 0,
      drop_frame: value.drop_frame === true || !!(rec.options && rec.options.drop_frame)
    };
  };

  Renderer.prototype.transportAction = function (rec, intent) {
    if (typeof this.adapter.transportAction === "function") {
      try { return this.adapter.transportAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Transport action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose transport actions.");
    return false;
  };

  Renderer.prototype.transportTime = function (seconds, data) {
    if (data && data.fps && global.PupitreTimeline && global.PupitreTimeline.formatTimecode) {
      return global.PupitreTimeline.formatTimecode(seconds, data.fps, {drop_frame: data.drop_frame});
    }
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(total / 60), s = total % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  };

  Renderer.prototype.transportRefresh = function (rec) {
    var data = this.transportValue(rec);
    rec.value = data;
    rec.play.textContent = data.playing ? rec.text("pause", "Pause") : rec.text("play", "Play");
    rec.play.disabled = data.playing ? !data.canPause : !data.canPlay;
    rec.stop.disabled = !data.canStop;
    rec.seek.max = String(data.duration);
    if (document.activeElement !== rec.seek) rec.seek.value = String(Math.min(data.position, data.duration));
    rec.position.textContent = this.transportTime(data.position, data) + " / " + this.transportTime(data.duration, data);
    rec.loop.checked = data.loop;
    rec.loop.disabled = !data.canLoop;
    rec.rate.value = String(data.rate);
    rec.rate.disabled = !data.canRate;
    rec.seek.disabled = !data.canSeek;
  };

  Renderer.prototype.buildTransport = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.transport_options) ? block.transport_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("transport." + key, fallback)); };
    var root = el("section", {class: "pui-transport", "data-pui-transport": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Transport"))});
    var rec = {block: block, path: path, value: null, root: root, labels: labels, text: text};
    var head = el("div", {class: "pui-transport-head"});
    head.appendChild(el("h4", {text: String(block.label || text("title", "Transport"))}));
    var play = el("button", {type: "button", class: "pui-button pui-primary", text: text("play", "Play")});
    var stop = el("button", {type: "button", class: "pui-button", text: text("stop", "Stop")});
    play.addEventListener("click", function () { self.transportAction(rec, {op: self.transportValue(rec).playing ? "pause" : "play"}); });
    stop.addEventListener("click", function () { self.transportAction(rec, {op: "stop"}); });
    head.appendChild(play); head.appendChild(stop);
    root.appendChild(head);
    var row = el("div", {class: "pui-transport-controls"});
    var seek = el("input", {type: "range", min: "0", step: "0.01", "aria-label": text("seek", "Seek")});
    seek.addEventListener("input", function () { self.transportAction(rec, {op: "seek", position: Number(seek.value)}); });
    row.appendChild(seek);
    var position = el("output", {class: "pui-transport-time"});
    row.appendChild(position);
    var loopLabel = el("label", {class: "pui-transport-loop"});
    var loop = el("input", {type: "checkbox", "aria-label": text("loop", "Loop")});
    loop.addEventListener("change", function () { self.transportAction(rec, {op: "loop", value: loop.checked}); });
    loopLabel.appendChild(loop); loopLabel.appendChild(el("span", {text: text("loop", "Loop")}));
    row.appendChild(loopLabel);
    var rate = el("select", {"aria-label": text("rate", "Playback rate")});
    var rates = isArray(options.rates) ? options.rates.map(Number).filter(function (value) { return isFinite(value) && value > 0; }) : [];
    if (!rates.length) rates = [0.25, 0.5, 1, 1.5, 2];
    rates.forEach(function (value) { rate.appendChild(el("option", {value: String(value), text: value + "×"})); });
    rate.addEventListener("change", function () { self.transportAction(rec, {op: "rate", value: Number(rate.value)}); });
    row.appendChild(rate);
    root.appendChild(row);
    rec.play = play; rec.stop = stop; rec.seek = seek; rec.position = position; rec.loop = loop; rec.rate = rate;
    this.transportRecords.push(rec);
    this.transportRefresh(rec);
    return root;
  };

  Renderer.prototype.meterValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); };
    var options = rec.options || {};
    var min = value.gainMin !== undefined ? Number(value.gainMin) : (options.gain_min !== undefined ? Number(options.gain_min) : 0);
    var max = value.gainMax !== undefined ? Number(value.gainMax) : (options.gain_max !== undefined ? Number(options.gain_max) : 1);
    if (!isFinite(min)) min = 0;
    if (!isFinite(max) || max <= min) max = 1;
    return {label: String(value.label || rec.block.label || rec.text("title", "Meter")), level: clamp(value.level, 0, 1), peak: clamp(value.peak, 0, 1), clip: value.clip === true, muted: value.muted === true, solo: value.solo === true, gain: clamp(value.gain === undefined ? 1 : value.gain, min, max), gainMin: min, gainMax: max, gainStep: Number(value.gainStep !== undefined ? value.gainStep : options.gain_step) || 0.01, canMute: value.canMute !== false, canSolo: value.canSolo !== false, canGain: value.canGain !== false};
  };

  Renderer.prototype.meterAction = function (rec, intent) {
    if (typeof this.adapter.meterAction === "function") {
      try { return this.adapter.meterAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Meter action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose meter actions.");
    return false;
  };

  Renderer.prototype.meterRefresh = function (rec, update) {
    var data = update ? Object.assign(this.meterValue(rec), update) : this.meterValue(rec);
    rec.value = data;
    rec.meterLabel.textContent = data.label;
    rec.fill.style.width = (data.level * 100) + "%";
    rec.peakLine.style.left = (data.peak * 100) + "%";
    rec.bar.setAttribute("aria-valuenow", String(data.level));
    rec.bar.setAttribute("aria-valuetext", Math.round(data.level * 100) + "%");
    rec.root.classList.toggle("is-clip", data.clip);
    rec.root.classList.toggle("is-muted", data.muted);
    rec.mute.setAttribute("aria-pressed", data.muted ? "true" : "false");
    rec.solo.setAttribute("aria-pressed", data.solo ? "true" : "false");
    rec.mute.disabled = !data.canMute;
    rec.solo.disabled = !data.canSolo;
    rec.gain.min = String(data.gainMin);
    rec.gain.max = String(data.gainMax);
    rec.gain.step = String(data.gainStep);
    rec.gain.value = String(data.gain);
    rec.gain.disabled = !data.canGain;
    rec.gain.setAttribute("aria-valuetext", String(data.gain));
  };

  Renderer.prototype.buildMeter = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.meter_options) ? block.meter_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("meter." + key, fallback)); };
    var root = el("section", {class: "pui-meter", "data-pui-meter": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Meter"))});
    var head = el("div", {class: "pui-meter-head"});
    var label = el("span", {class: "pui-meter-label"});
    var mute = el("button", {type: "button", class: "pui-button pui-meter-mute", text: text("mute", "Mute"), "aria-pressed": "false"});
    var solo = el("button", {type: "button", class: "pui-button pui-meter-solo", text: text("solo", "Solo"), "aria-pressed": "false"});
    mute.addEventListener("click", function () { self.meterAction(rec, {op: "mute", value: !self.meterValue(rec).muted}); });
    solo.addEventListener("click", function () { self.meterAction(rec, {op: "solo", value: !self.meterValue(rec).solo}); });
    head.appendChild(label); head.appendChild(mute); head.appendChild(solo);
    root.appendChild(head);
    var bar = el("div", {class: "pui-meter-bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "1", "aria-label": String(block.label || text("level", "Level"))});
    var fill = el("span", {class: "pui-meter-fill"});
    var peakLine = el("span", {class: "pui-meter-peak"});
    bar.appendChild(fill); bar.appendChild(peakLine);
    root.appendChild(bar);
    var gain = el("input", {type: "range", min: "0", max: "1", step: "0.01", "aria-label": text("gain", "Gain")});
    gain.addEventListener("input", function () { self.meterAction(rec, {op: "gain", value: Number(gain.value)}); });
    root.appendChild(gain);
    var rec = {block: block, path: path, root: root, options: options, labels: labels, text: text, meterLabel: label, mute: mute, solo: solo, fill: fill, peakLine: peakLine, gain: gain, bar: bar, value: null, unsubscribe: null};
    if (typeof this.adapter.subscribeMeters === "function") {
      try { rec.unsubscribe = this.adapter.subscribeMeters(path, function (data) { if (isObject(data)) self.meterRefresh(rec, data); }); } catch (error) {}
    }
    this.meterRecords.push(rec);
    this.meterRefresh(rec);
    return root;
  };

  Renderer.prototype.keyCaptureValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    return {label: String(value.label || rec.block.label || rec.text("title", "Shortcut")), sequence: String(value.sequence || ""), capturing: value.capturing === true, error: String(value.error || ""), conflict: String(value.conflict || ""), disabled: value.disabled === true};
  };

  Renderer.prototype.keyCaptureAction = function (rec, intent) {
    if (typeof this.adapter.keyCaptureAction === "function") {
      try { return this.adapter.keyCaptureAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Key capture failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose key capture.");
    return false;
  };

  Renderer.prototype.keyCaptureRefresh = function (rec) {
    var data = this.keyCaptureValue(rec);
    rec.value = data;
    rec.keyLabel.textContent = data.label;
    rec.display.textContent = data.capturing ? "Press a shortcut…" : (data.sequence || "Not set");
    var error = data.error || data.conflict || rec.localError || "";
    rec.display.setAttribute("data-state", data.capturing ? "capturing" : error ? "error" : "ready");
    rec.clear.disabled = data.disabled || !data.sequence;
    rec.capture.disabled = data.disabled;
    rec.error.textContent = error;
    rec.error.hidden = !error;
  };

  Renderer.prototype.buildKeyCapture = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.keycapture_options) ? block.keycapture_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("keycapture." + key, fallback)); };
    var root = el("section", {class: "pui-keycapture", "data-pui-keycapture": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Shortcut"))});
    var rec = {block: block, path: path, root: root, value: null, handler: null, options: options, labels: labels, text: text, localError: ""};
    var label = el("span", {class: "pui-keycapture-label"});
    var display = el("output", {class: "pui-keycapture-display", "aria-live": "polite", text: text("not_set", "Not set")});
    var capture = el("button", {type: "button", class: "pui-button pui-primary", text: text("capture", "Capture")});
    var clear = el("button", {type: "button", class: "pui-button", text: text("clear", "Clear")});
    var error = el("p", {class: "pui-keycapture-error", role: "alert", hidden: true});
    root.appendChild(label); root.appendChild(display); root.appendChild(capture); root.appendChild(clear); root.appendChild(error);
    var stop = function () {
      if (rec.handler) document.removeEventListener("keydown", rec.handler, true);
      rec.handler = null;
      if (typeof capture.focus === "function") capture.focus();
    };
    var fail = function (sequence) {
      rec.localError = text("plain_not_allowed", "Use a modifier key for this shortcut.");
      keyCaptureAction(rec, {op: "invalid", key: sequence, error: rec.localError});
      rec.error.textContent = rec.localError;
      rec.error.hidden = false;
      rec.display.setAttribute("data-state", "error");
    };
    var keyCaptureAction = function (record, intent) {
      if (typeof self.adapter.keyCaptureAction === "function") {
        try { return self.adapter.keyCaptureAction(intent, record.value, record.block); }
        catch (err) { self.adapter.announce("error", "Key capture failed: " + String(err && err.message || err)); return false; }
      }
      return false;
    };
    var begin = function () {
      stop();
      rec.localError = "";
      self.keyCaptureAction(rec, {op: "capture", capturing: true});
      rec.handler = function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.key === "Escape") { rec.localError = ""; stop(); self.keyCaptureAction(rec, {op: "cancel"}); return; }
        if (event.key === "Backspace" || event.key === "Delete") { rec.localError = ""; stop(); self.keyCaptureAction(rec, {op: "clear"}); return; }
        var hasModifier = !!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey);
        var key = String(event.key || "");
        if (["Control", "Meta", "Alt", "Shift"].indexOf(key) >= 0) return;
        if (!key) return;
        if (!hasModifier && rec.options.allowPlain === false) { fail(key); return; }
        rec.localError = "";
        var parts = [];
        if (event.ctrlKey) parts.push("Ctrl");
        if (event.metaKey) parts.push("Meta");
        if (event.altKey) parts.push("Alt");
        if (event.shiftKey) parts.push("Shift");
        if (key === " ") key = "Space";
        else if (key === "+") key = "Plus";
        else if (key.length === 1) key = key.toUpperCase();
        parts.push(key);
        stop();
        self.keyCaptureAction(rec, {op: "capture", sequence: parts.join("+")});
      };
      document.addEventListener("keydown", rec.handler, true);
    };
    capture.addEventListener("click", begin);
    clear.addEventListener("click", function () { rec.localError = ""; stop(); self.keyCaptureAction(rec, {op: "clear"}); });
    rec.keyLabel = label; rec.display = display; rec.capture = capture; rec.clear = clear; rec.error = error;
    this.keyCaptureRecords.push(rec);
    this.keyCaptureRefresh(rec);
    return root;
  };

  /** Re-read a canvas value changed outside the canvas (field edit, undo,
   * host update) without rebuilding the rest of the page. Gestures keep their
   * local state until pointerup. */
  Renderer.prototype.canvasRefresh = function (rec) {
    if (!rec || rec.drag || rec.pan || rec.marquee || rec.regionDrag || rec.paint) return;
    var path = String(rec.path || rec.block && rec.block.bind || "");
    if (!path) return;
    var next = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, rec.block)
      : this.adapter.getValue(path);
    if (!isObject(next)) return;
    var signature;
    try { signature = JSON.stringify(next); } catch (error) { return; }
    if (rec.__valueSignature === signature) return;
    rec.__valueSignature = signature;
    rec.value = next;
    rec.view = { zoom: Number(next.view && next.view.zoom) > 0 ? Number(next.view.zoom) : 1,
      panX: Number(next.view && next.view.panX) || 0, panY: Number(next.view && next.view.panY) || 0 };
    rec.selected = {};
    (isArray(next.selected) ? next.selected : []).forEach(function (id) { rec.selected[String(id)] = true; });
    rec.selectedRegion = next.selected_region ? String(next.selected_region) : "";
    if (typeof rec.render === "function") rec.render();
  };

  Renderer.prototype.previewValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    var src = value.src || value.url || value.stream || "";
    var compare = isObject(value.compare) ? value.compare : null;
    return {
      kind: String(value.kind || "image").toLowerCase(),
      src: src ? String(src) : "",
      poster: value.poster ? String(value.poster) : "",
      loop: value.loop === true,
      muted: value.muted !== false,
      width: Number(value.width) || 0,
      height: Number(value.height) || 0,
      alt: String(value.alt || value.label || rec.block.label || rec.text("alt", "Preview")),
      caption: String(value.caption || ""),
      state: String(value.state || (src ? "ready" : "idle")).toLowerCase(),
      error: String(value.error || ""),
      fit: String(value.fit || "contain").toLowerCase(),
      compare: compare ? {src: String(compare.src || compare.url || ""), label: String(compare.label || rec.text("compare", "Compare"))} : null,
      overlay: isObject(value.overlay) ? {src: String(value.overlay.src || value.overlay.url || ""), opacity: Number(value.overlay.opacity) || 0.5} : null,
      guides: isObject(value.guides) ? value.guides : (isObject(rec.options.guides) ? rec.options.guides : null)
    };
  };

  Renderer.prototype.previewAction = function (rec, intent) {
    if (typeof this.adapter.previewAction === "function") {
      try { return this.adapter.previewAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Preview action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose preview actions.");
    return false;
  };

  Renderer.prototype.previewSetMedia = function (rec, kind) {
    kind = kind === "video" ? "video" : "image";
    if (rec.mediaKind === kind) return;
    var next = kind === "video"
      ? el("video", {class: "pui-preview-media", preload: "metadata", playsinline: "", muted: ""})
      : el("img", {class: "pui-preview-media", alt: rec.alt || rec.text("alt", "Preview")});
    if (rec.media && rec.media.parentNode) rec.media.parentNode.replaceChild(next, rec.media);
    else rec.viewport.insertBefore(next, rec.overlay);
    rec.media = next;
    rec.mediaKind = kind;
  };

  Renderer.prototype.previewRefresh = function (rec, update) {
    var data = this.previewValue(rec);
    if (isObject(update)) data = Object.assign({}, data, update);
    rec.value = data;
    var comparing = rec.showCompare && data.compare && data.compare.src;
    var kind = comparing ? "image" : (data.kind === "video" ? "video" : "image");
    this.previewSetMedia(rec, kind);
    var src = comparing ? data.compare.src : data.src;
    rec.media.hidden = !src;
    if (src) rec.media.setAttribute("src", src); else rec.media.removeAttribute("src");
    if (kind === "video") {
      rec.media.setAttribute("aria-label", data.alt);
      rec.media.autoplay = true;
      rec.media.loop = data.loop;
      rec.media.muted = data.muted;
      if (data.poster) rec.media.setAttribute("poster", data.poster); else rec.media.removeAttribute("poster");
    } else {
      rec.media.setAttribute("alt", data.alt);
    }
    rec.media.style.objectFit = data.fit === "cover" ? "cover" : data.fit === "actual" ? "none" : "contain";
    rec.state.textContent = data.state === "error" ? (data.error || rec.text("error", "Preview error")) : data.state === "loading" ? rec.text("loading", "Loading…") : data.caption || data.state;
    rec.state.setAttribute("data-state", data.state);
    rec.state.hidden = !rec.state.textContent;
    rec.compareButton.hidden = !data.compare;
    if (data.compare) {
      rec.compareButton.textContent = rec.showCompare ? rec.text("live", "Show live") : (data.compare.label || rec.text("compare", "Compare"));
      rec.compareButton.setAttribute("aria-pressed", rec.showCompare ? "true" : "false");
    }
    var guides = data.guides || {};
    var guideClass = "pui-preview-guides";
    if (guides.safe === true) guideClass += " is-safe";
    if (guides.thirds === true) guideClass += " is-thirds";
    if (guides.crosshair === true) guideClass += " is-crosshair";
    rec.guides.className = guideClass;
    rec.guides.hidden = !(guides.safe || guides.thirds || guides.crosshair) || rec.showCompare;
    rec.overlay.hidden = !data.overlay || !data.overlay.src || rec.showCompare;
    if (data.overlay && data.overlay.src) {
      rec.overlay.setAttribute("src", data.overlay.src);
      rec.overlay.style.opacity = String(data.overlay.opacity);
    }
    rec.fit.value = data.fit;
  };

  Renderer.prototype.buildPreview = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.preview_options) ? block.preview_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("preview." + key, fallback)); };
    var root = el("section", {class: "pui-preview", "data-pui-preview": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Preview"))});
    var head = el("div", {class: "pui-preview-head"});
    head.appendChild(el("h4", {text: String(block.label || text("title", "Preview"))}));
    var fit = el("select", {"aria-label": text("fit", "Preview fit")});
    [["contain", text("contain", "Fit")], ["cover", text("cover", "Fill")], ["actual", text("actual", "Actual")]].forEach(function (entry) { fit.appendChild(el("option", {value: entry[0], text: entry[1]})); });
    var compareButton = el("button", {type: "button", class: "pui-button", text: text("compare", "Compare")});
    var refresh = el("button", {type: "button", class: "pui-button", text: text("refresh", "Refresh")});
    head.appendChild(fit); head.appendChild(compareButton); head.appendChild(refresh);
    root.appendChild(head);
    var viewport = el("figure", {class: "pui-preview-viewport"});
    var media = el("img", {class: "pui-preview-media", alt: text("alt", "Preview")});
    var overlay = el("img", {class: "pui-preview-overlay", alt: "", "aria-hidden": "true"});
    var guides = el("div", {class: "pui-preview-guides", "aria-hidden": "true"});
    viewport.appendChild(media); viewport.appendChild(guides); viewport.appendChild(overlay);
    root.appendChild(viewport);
    var state = el("p", {class: "pui-preview-state", role: "status", "aria-live": "polite"});
    root.appendChild(state);
    var rec = {block: block, path: path, value: null, root: root, viewport: viewport, media: media, mediaKind: "image", overlay: overlay, guides: guides, state: state, fit: fit, compareButton: compareButton, refresh: refresh, showCompare: false, unsubscribe: null, labels: labels, text: text, alt: text("alt", "Preview"), options: options};
    fit.addEventListener("change", function () { self.previewAction(rec, {op: "fit", value: fit.value}); });
    compareButton.addEventListener("click", function () {
      rec.showCompare = !rec.showCompare;
      self.previewRefresh(rec);
      self.previewAction(rec, {op: "compare", value: rec.showCompare});
    });
    refresh.addEventListener("click", function () { self.previewAction(rec, {op: "refresh"}); });
    if (typeof this.adapter.subscribePreview === "function") {
      try {
        rec.unsubscribe = this.adapter.subscribePreview(path, function (data) {
          if (isObject(data)) self.previewRefresh(rec, data);
        });
      } catch (error) { /* host preview channel is optional */ }
    }
    this.previewRecords.push(rec);
    this.previewRefresh(rec);
    return root;
  };

  Renderer.prototype.connectionValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) value = {};
    return {
      state: String(value.state || "disconnected").toLowerCase(),
      target: value.target === undefined || value.target === null ? "" : String(value.target),
      targets: isArray(value.targets) ? value.targets.filter(isObject) : [],
      instances: isArray(value.instances) ? value.instances.filter(isObject) : [],
      activeId: value.activeId === undefined || value.activeId === null ? "" : String(value.activeId),
      canAddInstance: value.canAddInstance !== false,
      canRemoveInstance: value.canRemoveInstance !== false,
      endpoint: value.endpoint === undefined ? "" : String(value.endpoint),
      error: value.error === undefined ? "" : String(value.error),
      reconnectIn: value.reconnectIn === undefined ? "" : String(value.reconnectIn),
      backLink: value.backLink ? String(value.backLink) : "",
      backLabel: value.backLabel ? String(value.backLabel) : "Back",
      offline: value.offline === true,
      canConnect: value.canConnect !== false,
      canDisconnect: value.canDisconnect !== false,
      canReconnect: value.canReconnect !== false,
      canDiscover: value.canDiscover !== false
    };
  };

  Renderer.prototype.connectionAction = function (rec, intent) {
    if (typeof this.adapter.connectionAction === "function") {
      try { return this.adapter.connectionAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Connection action failed: " + String(error && error.message || error)); return false; }
    }
    this.adapter.announce("warning", "The host does not expose connection actions.");
    return false;
  };

  Renderer.prototype.connectionRefresh = function (rec) {
    var data = this.connectionValue(rec);
    rec.value = data;
    var states = {connected: "Connected", connecting: "Connecting…", reconnecting: "Reconnecting…", offline: "Offline", error: "Error", disconnected: "Disconnected"};
    rec.badge.textContent = String(rec.stateLabels[data.state] || rec.text("state." + data.state, states[data.state] || data.state));
    rec.badge.setAttribute("data-state", data.state);
    rec.status.textContent = data.error || (data.reconnectIn ? rec.text("reconnect", "Reconnect in") + " " + data.reconnectIn + "s" : "");
    rec.status.hidden = !rec.status.textContent;
    if (rec.instanceSelect && rec.block.connection_options && rec.block.connection_options.instances === true) {
      rec.instanceSelect.textContent = "";
      data.instances.forEach(function (instance) {
        var id = String(instance.id === undefined ? instance.value : instance.id);
        var option = el("option", {value: id, text: String(instance.label || instance.name || id)});
        if (id === data.activeId) option.selected = true;
        rec.instanceSelect.appendChild(option);
      });
      if (data.activeId) rec.instanceSelect.value = data.activeId;
      rec.instanceSelect.hidden = !data.instances.length;
      rec.addInstance.hidden = false;
      rec.removeInstance.hidden = !data.instances.length;
      rec.addInstance.disabled = !data.canAddInstance;
      rec.removeInstance.disabled = !data.canRemoveInstance || !data.activeId;
    }
    rec.endpointInput.value = data.endpoint;
    rec.endpointInput.disabled = data.state === "connected" || data.state === "connecting" || data.state === "reconnecting";
    rec.offline.checked = data.offline;
    rec.connect.disabled = !data.canConnect || data.state === "connected" || data.state === "connecting" || data.state === "reconnecting";
    rec.disconnect.disabled = !data.canDisconnect || data.state === "disconnected" || data.state === "offline";
    rec.reconnect.disabled = !data.canReconnect;
    rec.discover.disabled = !data.canDiscover || data.state === "offline";
    rec.target.textContent = "";
    data.targets.forEach(function (target) {
      var value = String(target.id === undefined ? target.value : target.id);
      var option = el("option", {value: value, text: String(target.label || target.name || value)});
      if (value === data.target) option.selected = true;
      rec.target.appendChild(option);
    });
    if (data.target) rec.target.value = data.target;
    rec.target.hidden = !data.targets.length;
    rec.target.disabled = !data.targets.length || data.state === "offline";
    rec.backLink.hidden = !data.backLink;
    if (data.backLink) { rec.backLink.setAttribute("href", data.backLink); rec.backLink.textContent = data.backLabel || rec.text("back", "Back"); }
  };

  Renderer.prototype.buildConnection = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var options = isObject(block.connection_options) ? block.connection_options : {};
    var labels = isObject(options.labels) ? options.labels : {};
    var stateLabels = isObject(options.state_labels) ? options.state_labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("connection." + key, fallback)); };
    var root = el("section", {class: "pui-connection", "data-pui-connection": path, role: "group", "aria-label": String(block.a11y && block.a11y.name || block.label || text("title", "Connection"))});
    var rec = {block: block, path: path, value: null, root: root, labels: labels, stateLabels: stateLabels, text: text};
    var head = el("div", {class: "pui-connection-head"});
    head.appendChild(el("h4", {text: String(block.label || text("title", "Connection"))}));
    var badge = el("span", {class: "pui-connection-state", "data-state": "disconnected", text: text("state.disconnected", "Disconnected")});
    head.appendChild(badge);
    root.appendChild(head);
    var row = el("div", {class: "pui-connection-controls"});
    var instanceSelect = el("select", {class: "pui-connection-instance", "aria-label": text("instance", "Connection instance")});
    instanceSelect.addEventListener("change", function () { self.connectionAction(rec, {op: "instance", value: instanceSelect.value, id: instanceSelect.value}); });
    var addInstance = el("button", {type: "button", class: "pui-button pui-connection-instance-add", text: text("add_instance", "＋")});
    var removeInstance = el("button", {type: "button", class: "pui-button pui-connection-instance-remove", text: text("remove_instance", "✕")});
    addInstance.addEventListener("click", function () { self.connectionAction(rec, {op: "instance.add"}); });
    removeInstance.addEventListener("click", function () { self.connectionAction(rec, {op: "instance.remove", id: instanceSelect.value}); });
    if (options.instances === true) { row.appendChild(instanceSelect); row.appendChild(addInstance); row.appendChild(removeInstance); }
    var endpointInput = el("input", {type: String(options.endpoint_type || "text"), class: "pui-connection-endpoint", "aria-label": text("endpoint", "Endpoint"), placeholder: String(options.endpoint_placeholder || "")});
    endpointInput.addEventListener("change", function () { self.connectionAction(rec, {op: "endpoint", value: endpointInput.value}); });
    if (options.endpoint === false) endpointInput.hidden = true;
    row.appendChild(endpointInput);
    var target = el("select", {class: "pui-connection-target", "aria-label": text("target", "Connection target")});
    target.addEventListener("change", function () { self.connectionAction(rec, {op: "target", value: target.value, target: target.value}); });
    row.appendChild(target);
    var connect = el("button", {type: "button", class: "pui-button pui-primary", text: text("connect", "Connect")});
    var disconnect = el("button", {type: "button", class: "pui-button", text: text("disconnect", "Disconnect")});
    var reconnect = el("button", {type: "button", class: "pui-button", text: text("reconnect", "Reconnect")});
    var discover = el("button", {type: "button", class: "pui-button", text: text("discover", "Discover")});
    connect.addEventListener("click", function () { self.connectionAction(rec, {op: "connect", endpoint: endpointInput.value}); });
    disconnect.addEventListener("click", function () { self.connectionAction(rec, {op: "disconnect"}); });
    reconnect.addEventListener("click", function () { self.connectionAction(rec, {op: "reconnect"}); });
    discover.addEventListener("click", function () { self.connectionAction(rec, {op: "discover", endpoint: endpointInput.value}); });
    row.appendChild(connect); row.appendChild(disconnect); row.appendChild(reconnect);
    if (options.discover !== false) row.appendChild(discover);
    var offline = el("input", {type: "checkbox", class: "pui-connection-offline", "aria-label": text("offline", "Offline mode")});
    offline.addEventListener("change", function () { self.connectionAction(rec, {op: "offline", value: offline.checked}); });
    if (options.offline !== false) {
      var offlineLabel = el("label", {class: "pui-connection-offline-label"}, offline, el("span", {text: text("offline", "Offline")}));
      row.appendChild(offlineLabel);
    }
    var backLink = el("a", {class: "pui-connection-back", href: "#", target: "_self", text: text("back", "Back")});
    row.appendChild(backLink);
    root.appendChild(row);
    var status = el("p", {class: "pui-connection-status", role: "status", "aria-live": "polite"});
    root.appendChild(status);
    rec.badge = badge; rec.status = status; rec.endpointInput = endpointInput; rec.target = target;
    rec.instanceSelect = instanceSelect; rec.addInstance = addInstance; rec.removeInstance = removeInstance;
    rec.connect = connect; rec.disconnect = disconnect; rec.reconnect = reconnect; rec.discover = discover;
    rec.offline = offline; rec.backLink = backLink;
    this.connectionRecords.push(rec);
    this.connectionRefresh(rec);
    return root;
  };

  /** Labelled host history: the host owns the stack, PUI owns entries/jump,
   * current position and undo/redo presentation. No renderer-local history. */
  Renderer.prototype.buildHistory = function (block) {
    var self = this;
    var path = String(block.bind || "");
    var value = path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(path, block) : this.adapter.getValue(path)) : null;
    var label = String(block.label || block.id || "History");
    var root = el("section", {class: "pui-history", "data-pui-history": path, role: "group"});
    if (block.a11y && block.a11y.name) root.setAttribute("aria-label", String(block.a11y.name));
    else root.setAttribute("aria-label", label);
    var head = el("div", {class: "pui-history-head"}, el("h4", {text: label}));
    root.appendChild(head);
    var undo = el("button", {type: "button", class: "pui-button", text: "Undo"});
    var redo = el("button", {type: "button", class: "pui-button", text: "Redo"});
    undo.addEventListener("click", function () { self.undo(); });
    redo.addEventListener("click", function () { self.redo(); });
    head.appendChild(undo);
    head.appendChild(redo);
    var list = el("ol", {class: "pui-history-list", role: "list"});
    root.appendChild(list);
    var rec = {block: block, path: path, value: value, root: root, head: head, list: list, undo: undo, redo: redo, entries: [], entryEls: [], current: -1};
    var render = function () { self.historyRender(rec); };
    rec.render = render;
    this.historyRecords.push(rec);
    render();
    return root;
  };

  Renderer.prototype.historyValue = function (rec) {
    var value = rec.path ? (typeof this.adapter.getValueFor === "function" ? this.adapter.getValueFor(rec.path, rec.block) : this.adapter.getValue(rec.path)) : null;
    if (!isObject(value)) return {entries: [], index: -1};
    var entries = isArray(value.entries) ? value.entries : (isArray(value.items) ? value.items : []);
    var index = Number(value.index);
    if (!isFinite(index)) index = entries.length - 1;
    return {entries: entries, index: index};
  };

  Renderer.prototype.historyRender = function (rec) {
    var self = this;
    var data = this.historyValue(rec);
    rec.value = data;
    rec.entrySignature = JSON.stringify(data.entries);
    rec.list.textContent = "";
    rec.entryEls = [];
    if (!data.entries.length) {
      rec.list.appendChild(el("li", {class: "pui-history-empty", text: "No history yet."}));
    }
    data.entries.forEach(function (entry, index) {
      if (!isObject(entry)) entry = {label: String(entry)};
      var item = el("li", {class: "pui-history-entry" + (index === data.index ? " is-current" : "")});
      var button = el("button", {type: "button", class: "pui-history-jump", text: String(entry.label || entry.id || "Edit " + (index + 1))});
      if (index === data.index) button.setAttribute("aria-current", "true");
      button.addEventListener("click", function () {
        var action = {op: "history.jump", index: index, entry: entry};
        if (typeof self.adapter.historyAction === "function") self.adapter.historyAction(action, data, rec.block);
        else self.adapter.announce("warning", "The host does not expose history jump.");
      });
      item.appendChild(button);
      if (entry.kind) item.appendChild(el("span", {class: "pui-history-kind", text: String(entry.kind)}));
      if (entry.at) item.appendChild(el("span", {class: "pui-history-at", text: String(entry.at)}));
      rec.list.appendChild(item);
      rec.entryEls.push(button);
    });
    this.historyRefresh(rec);
  };

  Renderer.prototype.historyRefresh = function (rec) {
    var data = this.historyValue(rec);
    var signature = JSON.stringify(data.entries);
    if (rec.entrySignature !== signature) {
      this.historyRender(rec);
      return;
    }
    rec.value = data;
    rec.current = data.index;
    rec.undo.disabled = !this.canUndo();
    rec.redo.disabled = !this.canRedo();
    rec.undo.title = this.historyLabel("undo");
    rec.redo.title = this.historyLabel("redo");
    rec.entryEls.forEach(function (button, index) {
      var entry = data.entries[index];
      var current = index === data.index;
      button.setAttribute("aria-current", current ? "true" : "false");
      button.classList.toggle("is-current", current);
      button.textContent = String(entry && (entry.label || entry.id) || "Edit " + (index + 1));
    });
  };

  /** Fixed status line + bounded command-history overlay. Hosts own commands,
   * rollback and audit; PUI only presents bounded state and a11y semantics. */
  Renderer.prototype.buildCommandLog = function (block) {
    var self = this;
    var CommandLog = global.PupitreCommandLog;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Command log");
    if (!CommandLog) return el("p", {class: "pui-missing", text: "(command log model PupitreCommandLog is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(command log value is missing)"});
    var options = isObject(block.commandlog_options) ? block.commandlog_options : {};
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-commandlog", "data-pui-commandlog": path});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, value: value, root: root, options: options, statusBind: block.status_bind ? String(block.status_bind) : "", history: null, dialog: null};
    var head = el("div", {class: "pui-commandlog-head"});
    head.appendChild(el("h4", {text: label}));
    var historyButton = el("button", {type: "button", class: "pui-button", text: "History", "aria-haspopup": "dialog", "aria-expanded": "false"});
    head.appendChild(historyButton);
    root.appendChild(head);
    var statusLine = el("div", {class: "pui-commandlog-status", role: "status", "aria-live": "polite"});
    root.appendChild(statusLine);
    var failures = el("div", {class: "pui-commandlog-failures"});
    root.appendChild(failures);
    var dialog = el("dialog", {class: "pui-dialog pui-commandlog-history", "aria-labelledby": this.id("commandlog-title")});
    var title = el("h5", {id: this.id("commandlog-title"), text: "Command history"});
    dialog.appendChild(title);
    var close = el("button", {type: "button", class: "pui-button", text: "Close"});
    close.addEventListener("click", function () { dialog.close(); historyButton.setAttribute("aria-expanded", "false"); });
    dialog.appendChild(close);
    var list = el("ol", {class: "pui-commandlog-list"});
    dialog.appendChild(list);
    root.appendChild(dialog);
    rec.dialog = dialog;
    rec.list = list;
    rec.statusLine = statusLine;
    rec.failures = failures;
    rec.historyButton = historyButton;
    var refresh = function () { self.commandLogRefresh(rec); };
    rec.refresh = refresh;
    historyButton.addEventListener("click", function () {
      self.commandLogRefresh(rec);
      dialog.showModal();
      historyButton.setAttribute("aria-expanded", "true");
    });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); dialog.close(); historyButton.setAttribute("aria-expanded", "false"); });
    this.commandLogRecords.push(rec);
    refresh();
    return root;
  };

  Renderer.prototype.commandLogRefresh = function (rec) {
    var CommandLog = global.PupitreCommandLog;
    if (!CommandLog || !rec) return;
    var live = this.adapter.getValue(rec.path);
    if (isObject(live)) rec.value = live;
    var override = rec.statusBind ? this.adapter.getValue(rec.statusBind) : undefined;
    var state = CommandLog.normalize(rec.value, override, rec.options.history_limit);
    var tone = CommandLog.statusTone(state.status, state);
    rec.statusLine.className = "pui-commandlog-status is-" + tone;
    rec.statusLine.textContent = "";
    rec.statusLine.appendChild(el("span", {class: "pui-commandlog-dot", "aria-hidden": "true"}));
    rec.statusLine.appendChild(el("span", {class: "pui-commandlog-status-text", text: state.status}));
    rec.statusLine.appendChild(el("span", {class: "pui-commandlog-meta", text: state.total + " entries · " + state.failed.length + " failed target" + (state.failed.length === 1 ? "" : "s") + (state.rolledBack ? " · " + state.rolledBack + " rolled back" : "")}));
    rec.failures.textContent = "";
    if (state.failed.length) {
      rec.failures.appendChild(el("span", {class: "pui-commandlog-failure-label", text: "Failed targets: "}));
      rec.failures.appendChild(el("span", {text: state.failed.map(function (entry) { return String(entry.target || entry.op || entry.id); }).join(", ")}));
    }
    rec.historyButton.textContent = "History (" + state.total + ")";
    rec.historyButton.setAttribute("aria-label", "Command history, " + state.total + " entries");
    rec.list.textContent = "";
    state.entries.slice().reverse().forEach(function (entry) {
      var item = el("li", {class: "pui-commandlog-entry is-" + String(entry.status || "unknown")});
      item.appendChild(el("span", {class: "pui-commandlog-entry-op", text: String(entry.op || entry.id || "command")}));
      item.appendChild(el("span", {class: "pui-commandlog-entry-status", text: CommandLog.statusLabel(entry.status)}));
      if (entry.target) item.appendChild(el("code", {text: String(entry.target)}));
      if (entry.message) item.appendChild(el("span", {class: "pui-commandlog-entry-message", text: String(entry.message)}));
      item.appendChild(el("span", {class: "pui-commandlog-meta", text: String(entry.actor || "host") + (entry.at ? " · " + String(entry.at) : "")}));
      rec.list.appendChild(item);
    });
    if (!state.entries.length) rec.list.appendChild(el("li", {class: "pui-commandlog-empty", text: "No commands yet."}));
  };

  /** ARIA tree/navigator. Host owns nodes/actions; PUI owns folds, ARIA,
   * selection, keyboard movement and edit intents. */
  Renderer.prototype.buildTree = function (block) {
    var self = this;
    var Tree = global.PupitreTree;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Tree");
    if (!Tree) return el("p", {class: "pui-missing", text: "(tree model PupitreTree is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(tree value is missing)"});
    var options = isObject(block.tree_options) ? block.tree_options : {};
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-tree", "data-pui-tree": path});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, value: value, root: root, options: options,
      selectionPath: block.selection_bind ? String(block.selection_bind) : "",
      expandedPath: block.expanded_bind ? String(block.expanded_bind) : "",
      selected: {}, expanded: {}, focusId: "", rows: {}, renaming: null, menu: null, shouldFocus: false};
    var readList = function (bind) {
      var list = bind ? self.adapter.getValue(bind) : null;
      return isArray(list) ? list.map(String) : [];
    };
    var selected = rec.selectionPath ? self.readSelection(rec.selectionPath, block).ids : (isArray(value.selected) ? value.selected : []);
    selected.forEach(function (id) { rec.selected[String(id)] = true; });
    var expanded = rec.expandedPath ? readList(rec.expandedPath) : (isArray(value.expanded) ? value.expanded : []);
    if (!rec.expandedPath && !expanded.length) {
      try {
        var stored = window.localStorage && window.localStorage.getItem("pui.tree." + String(options.storage_key || block.id || path));
        if (stored) expanded = JSON.parse(stored);
      } catch (error) {}
    }
    if (!isArray(expanded)) expanded = [];
    expanded.forEach(function (id) { rec.expanded[String(id)] = true; });
    var flat = Tree.flattenTree(value, rec.expanded);
    rec.focusId = selected.length ? String(selected[0]) : (flat[0] ? flat[0].id : "");
    var head = el("div", {class: "pui-tree-head"});
    head.appendChild(el("h4", {text: label}));
    head.appendChild(el("span", {class: "pui-tree-count", text: (value.roots || []).length + " root" + ((value.roots || []).length === 1 ? "" : "s")}));
    root.appendChild(head);
    var tree = el("div", {class: "pui-tree-view", role: "tree", "aria-label": a11y.name || label, tabindex: "-1"});
    root.appendChild(tree);
    rec.tree = tree;
    this.treeRender(rec);
    tree.addEventListener("keydown", function (event) { self.treeKeydown(rec, event); });
    if (rec.selectionPath) this.selectionRecords.push({owner: rec, refresh: function () { self.treeSelectionRefresh(rec); }});
    tree.addEventListener("contextmenu", function (event) {
      var row = event.target && event.target.closest ? event.target.closest("[data-node-id]") : null;
      if (!row) return;
      if (event.preventDefault) event.preventDefault();
      self.treeOpenMenu(rec, row.getAttribute("data-node-id"));
    });
    return root;
  };

  Renderer.prototype.treeRender = function (rec) {
    var self = this;
    var Tree = global.PupitreTree;
    if (!Tree || !rec || !rec.tree) return;
    rec.tree.textContent = "";
    rec.rows = {};
    var labels = isObject(rec.options.labels) ? rec.options.labels : {};
    var text = function (key, fallback) { return String(labels[key] || self.t("tree." + key, fallback)); };
    var makeRows = function (nodes) {
      if (!isArray(nodes)) return null;
      var group = el("div", {class: "pui-tree-group", role: "group"});
      nodes.forEach(function (node, index) {
        if (!isObject(node)) return;
        var id = String(node.id === undefined ? "" : node.id);
        var children = isArray(node.children) ? node.children : [];
        var isExpanded = children.length > 0 && !!rec.expanded[id];
        var row = el("div", {class: "pui-tree-row" + (rec.selected[id] ? " is-selected" : ""), role: "treeitem", "data-node-id": id,
          "aria-posinset": String(index + 1), "aria-setsize": String(nodes.length)});
        row.depth = 0;
        row.setAttribute("aria-level", "1");
        if (children.length) row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        row.setAttribute("aria-selected", rec.selected[id] ? "true" : "false");
        row.tabIndex = rec.focusId === id ? 0 : -1;
        if (children.length) {
          var expander = el("button", {type: "button", class: "pui-tree-expander", text: isExpanded ? "▾" : "▸", "aria-label": (isExpanded ? text("collapse", "Collapse") : text("expand", "Expand")) + " " + String(node.label || id)});
          expander.tabIndex = -1;
          expander.addEventListener("click", function (event) { if (event.stopPropagation) event.stopPropagation(); self.treeToggle(rec, id); });
          row.appendChild(expander);
        } else {
          row.appendChild(el("span", {class: "pui-tree-spacer", "aria-hidden": "true"}));
        }
        var labelSpan = el("span", {class: "pui-tree-label", text: String(node.label || id)});
        row.appendChild(labelSpan);
        if (node.kind) row.appendChild(el("span", {class: "pui-tree-kind", text: String(node.kind)}));
        var badgeText = Tree.badgesText(node);
        if (badgeText) row.appendChild(el("span", {class: "pui-tree-badges", text: badgeText}));
        if (node.status !== undefined) row.appendChild(el("span", {class: "pui-tree-status", text: String(node.status)}));
        if (rec.options.row_chrome === true || node.visible !== undefined || node.locked !== undefined) {
          var visible = node.visible !== false;
          var locked = node.locked === true;
          var eye = el("button", {type: "button", class: "pui-tree-row-action pui-tree-visibility", text: visible ? "◉" : "○"});
          eye.setAttribute("aria-label", (visible ? text("hide", "Hide") : text("show", "Show")) + " " + String(node.label || id));
          eye.setAttribute("aria-pressed", visible ? "true" : "false");
          eye.tabIndex = -1;
          eye.addEventListener("click", function (event) { if (event.stopPropagation) event.stopPropagation(); self.treeRowAction(rec, id, {op: "tree.visibility", visible: !visible}); });
          row.appendChild(eye);
          var lock = el("button", {type: "button", class: "pui-tree-row-action pui-tree-lock", text: locked ? "▣" : "▢"});
          lock.setAttribute("aria-label", (locked ? text("unlock", "Unlock") : text("lock", "Lock")) + " " + String(node.label || id));
          lock.setAttribute("aria-pressed", locked ? "true" : "false");
          lock.tabIndex = -1;
          lock.addEventListener("click", function (event) { if (event.stopPropagation) event.stopPropagation(); self.treeRowAction(rec, id, {op: "tree.lock", locked: !locked}); });
          row.appendChild(lock);
        }
        row.addEventListener("click", function (event) { self.treeSelect(rec, id, !!(event.ctrlKey || event.metaKey || event.shiftKey)); });
        row.addEventListener("dblclick", function (event) { if (event.preventDefault) event.preventDefault(); self.treeStartRename(rec, id); });
        row.addEventListener("focus", function () { rec.focusId = id; });
        if (rec.options.drag !== false && !rec.block.readonly) {
          row.draggable = true;
          row.addEventListener("dragstart", function (event) {
            rec.dragId = id;
            row.classList.add("is-dragging");
            if (event.dataTransfer && event.dataTransfer.setData) event.dataTransfer.setData("text/plain", id);
            if (event.stopPropagation) event.stopPropagation();
          });
          row.addEventListener("dragend", function () {
            rec.dragId = null;
            rec.dropTarget = null;
            self.treeClearDropClasses(rec);
          });
          row.addEventListener("dragover", function (event) {
            if (!rec.dragId || rec.dragId === id) return;
            if (event.preventDefault) event.preventDefault();
            var box = row.getBoundingClientRect ? row.getBoundingClientRect() : {top: 0, height: 1};
            var ratio = ((event.clientY || 0) - box.top) / Math.max(1, box.height);
            var position = ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "inside";
            rec.dropTarget = {id: id, position: position};
            self.treeClearDropClasses(rec);
            row.classList.add("is-drop-" + position);
          });
          row.addEventListener("dragleave", function () {
            if (rec.dropTarget && rec.dropTarget.id === id) row.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside");
          });
          row.addEventListener("drop", function (event) {
            if (event.preventDefault) event.preventDefault();
            var fromId = rec.dragId;
            var target = rec.dropTarget;
            rec.dragId = null;
            rec.dropTarget = null;
            self.treeClearDropClasses(rec);
            if (fromId && target && target.id === id) self.treeDrop(rec, fromId, id, target.position);
          });
        }
        if (rec.focusId === id) rec.rows[id] = row;
        group.appendChild(row);
        if (children.length && isExpanded) {
          var childGroup = makeRows(children);
          if (childGroup) group.appendChild(childGroup);
        }
        var nested = row.querySelectorAll ? row.querySelectorAll(".pui-tree-row") : [];
        if (nested.length) nested.forEach(function (child) { child.depth = (child.depth || 0) + 1; });
      });
      // Assign levels after creation so nested rows receive depth.
      var all = group.querySelectorAll(".pui-tree-row");
      all.forEach(function (row) {
        var depth = 0, node = row.parentElement;
        while (node) { if (node.classList && node.classList.contains("pui-tree-group")) depth += 1; node = node.parentElement; }
        depth = Math.max(0, depth - 1);
        row.setAttribute("aria-level", String(depth + 1));
        row.depth = depth;
        rec.rows[row.getAttribute("data-node-id")] = row;
      });
      return group;
    };
    var group = makeRows(rec.value.roots);
    if (group) rec.tree.appendChild(group);
    if (rec.shouldFocus && rec.rows[rec.focusId]) {
      rec.shouldFocus = false;
      if (rec.rows[rec.focusId].focus) rec.rows[rec.focusId].focus();
    }
  };

  Renderer.prototype.treeSelectionRefresh = function (rec) {
    if (!rec || !rec.selectionPath) return;
    var state = this.readSelection(rec.selectionPath, rec.block);
    rec.selected = {};
    state.ids.forEach(function (id) { rec.selected[id] = true; });
    Object.keys(rec.rows || {}).forEach(function (id) {
      var row = rec.rows[id];
      if (!row) return;
      row.classList.toggle("is-selected", !!rec.selected[id]);
      row.setAttribute("aria-selected", rec.selected[id] ? "true" : "false");
    });
  };

  Renderer.prototype.treeSelect = function (rec, id, additive) {
    if (!rec || !rec.value) return false;
    if (additive) {
      if (rec.selected[id]) delete rec.selected[id]; else rec.selected[id] = true;
    } else {
      rec.selected = {};
      rec.selected[id] = true;
    }
    rec.focusId = id;
    var ids = Object.keys(rec.selected);
    this.writeTree(rec, {op: "tree.select", id: id, ids: ids}, !rec.selectionPath);
    if (rec.selectionPath) this.writeSelection(rec, {ids: ids, active: id}, "tree", String(rec.value && rec.value.label || ""));
    rec.shouldFocus = true;
    this.treeRender(rec);
    return true;
  };

  Renderer.prototype.treeToggle = function (rec, id) {
    if (!rec || !rec.value) return false;
    rec.expanded[id] = !rec.expanded[id];
    var ids = Object.keys(rec.expanded).filter(function (key) { return rec.expanded[key]; });
    this.writeTree(rec, {op: rec.expanded[id] ? "tree.expand" : "tree.collapse", id: id, expanded: ids}, !rec.expandedPath);
    if (rec.expandedPath) this.setPath(rec.expandedPath, ids, rec.block);
    this.treeStore(rec, ids);
    rec.focusId = id;
    rec.shouldFocus = true;
    this.treeRender(rec);
    return true;
  };

  Renderer.prototype.treeStore = function (rec, ids) {
    try { if (window.localStorage) window.localStorage.setItem("pui.tree." + String(rec.options.storage_key || rec.block.id || rec.path), JSON.stringify(ids)); } catch (error) {}
  };

  Renderer.prototype.treeStartRename = function (rec, id) {
    if (rec.block.readonly || (rec.options.rename === false)) return false;
    var found = global.PupitreTree.findNode(rec.value, id);
    var row = rec.rows[id];
    if (!found || !row) return false;
    var label = row.querySelector(".pui-tree-label");
    if (!label) return false;
    var input = el("input", {type: "text", class: "pui-tree-rename", value: String(found.node.label || id), "aria-label": "Rename " + String(found.node.label || id)});
    label.hidden = true;
    row.appendChild(input);
    var done = function (commit) {
      if (rec.renaming !== input) return;
      rec.renaming = null;
      if (commit && input.value.trim()) {
        found.node.label = input.value.trim();
        rec.writeTreePending = true;
        self.treeWrite(rec, {op: "tree.rename", id: id, label: found.node.label});
      }
      rec.shouldFocus = true;
      self.treeRender(rec);
    };
    var self = this;
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { if (event.preventDefault) event.preventDefault(); done(true); }
      else if (event.key === "Escape") { if (event.preventDefault) event.preventDefault(); done(false); }
    });
    input.addEventListener("blur", function () { done(true); });
    rec.renaming = input;
    if (input.focus) input.focus();
    if (input.select) input.select();
    return true;
  };

  Renderer.prototype.treeWrite = function (rec, intent) {
    this.writeTree(rec, intent, true);
  };

  Renderer.prototype.writeTree = function (rec, intent, writeValue) {
    if (writeValue !== false) this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
    if (typeof this.adapter.treeAction === "function") {
      try { this.adapter.treeAction(intent || {}, rec.value, rec.block); } catch (error) { this.adapter.announce("error", "Tree action failed: " + String(error && error.message || error)); }
    }
  };

  Renderer.prototype.treeAction = function (rec, intent) {
    if (typeof this.adapter.treeAction === "function") {
      try { this.adapter.treeAction(intent || {}, rec.value, rec.block); } catch (error) { this.adapter.announce("error", "Tree action failed: " + String(error && error.message || error)); }
    }
  };

  Renderer.prototype.treeKeydown = function (rec, event) {
    var self = this;
    if (!rec || !rec.value) return;
    if (rec.menu && event.key === "Escape") {
      if (event.preventDefault) event.preventDefault();
      rec.menu.remove();
      rec.menu = null;
      return;
    }
    var Tree = global.PupitreTree;
    if (rec.renaming) return;
    var activeRow = document.activeElement && document.activeElement.closest ? document.activeElement.closest("[data-node-id]") : null;
    if (activeRow) rec.focusId = activeRow.getAttribute("data-node-id");
    var flat = Tree.flattenTree(rec.value, rec.expanded);
    var index = flat.findIndex(function (entry) { return entry.id === rec.focusId; });
    if (index < 0) index = 0;
    var current = flat[index];
    var focusAt = function (next) { if (next) { rec.focusId = next.id; rec.shouldFocus = true; self.treeRender(rec); } };
    if (rec.options.drag !== false && event.altKey && event.ctrlKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && current) {
      event.preventDefault();
      if (event.key === "ArrowLeft" && current.parentId) {
        var parent = this.treeFind(rec.value.roots, current.parentId);
        if (parent && parent.parent) this.treeDrop(rec, rec.focusId, String(parent.node.id), "after");
      } else if (event.key === "ArrowRight") {
        var visible = flat[index - 1];
        if (visible) this.treeDrop(rec, rec.focusId, String(visible.id), "inside");
      }
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      if (rec.block.readonly || (rec.options.reorder === false)) return;
      var moved = Tree.moveSibling(rec.value, rec.focusId, event.key === "ArrowUp" ? -1 : 1);
      if (moved) { this.treeWrite(rec, {op: "tree.reorder", id: rec.focusId, delta: event.key === "ArrowUp" ? -1 : 1}); rec.shouldFocus = true; this.treeRender(rec); }
      return;
    }
    if (event.key === "ArrowDown") { event.preventDefault(); focusAt(flat[index + 1]); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); focusAt(flat[index - 1]); return; }
    if (event.key === "Home") { event.preventDefault(); focusAt(flat[0]); return; }
    if (event.key === "End") { event.preventDefault(); focusAt(flat[flat.length - 1]); return; }
    if (event.key === "ArrowRight" && current) {
      event.preventDefault();
      var children = current.node.children || [];
      if (children.length && !rec.expanded[current.id]) this.treeToggle(rec, current.id);
      else if (children.length && flat[index + 1]) focusAt(flat[index + 1]);
      return;
    }
    if (event.key === "ArrowLeft" && current) {
      event.preventDefault();
      if ((current.node.children || []).length && rec.expanded[current.id]) this.treeToggle(rec, current.id);
      else if (current.parentId) focusAt(flat.find(function (entry) { return entry.id === String(current.parentId); }));
      return;
    }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.treeSelect(rec, rec.focusId, false); return; }
    if (event.key === "F2") { event.preventDefault(); this.treeStartRename(rec, rec.focusId); return; }
    if (event.key === "F10" && event.shiftKey) { event.preventDefault(); this.treeOpenMenu(rec, rec.focusId); return; }
  };

  Renderer.prototype.treeClearDropClasses = function (rec) {
    Object.keys(rec.rows || {}).forEach(function (id) {
      var row = rec.rows[id];
      if (row && row.classList) row.classList.remove("is-drop-before", "is-drop-after", "is-drop-inside");
    });
  };

  Renderer.prototype.treeFind = function (roots, id) {
    var found = null;
    var visit = function (list, parent) {
      if (!isArray(list) || found) return;
      for (var i = 0; i < list.length; i++) {
        var node = list[i];
        if (!isObject(node)) continue;
        var nodeId = String(node.id === undefined ? "" : node.id);
        if (nodeId === String(id)) { found = {node: node, parent: parent, list: list, index: i}; return; }
        visit(node.children, node);
        if (found) return;
      }
    };
    visit(roots, null);
    return found;
  };

  Renderer.prototype.treeContains = function (node, id) {
    if (!isObject(node)) return false;
    if (String(node.id) === String(id)) return true;
    return (isArray(node.children) ? node.children : []).some(function (child) { return this.treeContains(child, id); }, this);
  };

  Renderer.prototype.treeDrop = function (rec, fromId, toId, position) {
    if (!rec || !rec.value || !fromId || !toId || fromId === toId) return false;
    if (rec.block.readonly) return false;
    var from = this.treeFind(rec.value.roots, fromId);
    var to = this.treeFind(rec.value.roots, toId);
    if (!from || !to || this.treeContains(from.node, toId)) {
      this.adapter.announce("warning", "A node cannot be moved into itself.");
      return false;
    }
    var moved = from.node;
    if (typeof this.adapter.moveTreeNode === "function") {
      var ok = this.adapter.moveTreeNode(fromId, toId, position, rec.block);
      if (ok === false) {
        this.adapter.announce("warning", "The host rejected the tree move.");
        return false;
      }
      rec.value = this.adapter.getValue(rec.path);
      rec.focusId = fromId;
      if (position === "inside") rec.expanded[toId] = true;
      rec.shouldFocus = true;
      this.treeRender(rec);
      return true;
    }
    from.list.splice(from.index, 1);
    var targetList = position === "inside" ? (to.node.children || (to.node.children = [])) : to.list;
    var targetIndex = to.list.indexOf(to.node);
    if (position === "before") targetList.splice(targetIndex, 0, moved);
    else if (position === "after") targetList.splice(targetIndex + 1, 0, moved);
    else targetList.push(moved);
    rec.focusId = fromId;
    if (position === "inside") rec.expanded[toId] = true;
    this.writeTree(rec, {op: "tree.move", fromId: fromId, toId: toId, position: position}, true);
    rec.shouldFocus = true;
    this.treeRender(rec);
    return true;
  };

  Renderer.prototype.treeRowAction = function (rec, id, intent) {
    if (typeof this.adapter.treeAction === "function") {
      try { this.adapter.treeAction(intent, rec.value, rec.block); }
      catch (error) { this.adapter.announce("error", "Tree action failed: " + String(error && error.message || error)); return false; }
    }
    var found = this.treeFind(rec.value.roots, id);
    if (found) {
      if (intent.op === "tree.visibility") found.node.visible = intent.visible !== false;
      if (intent.op === "tree.lock") found.node.locked = intent.locked === true;
      this.writeTree(rec, intent, true);
      rec.focusId = id;
      rec.shouldFocus = true;
      this.treeRender(rec);
    }
    return true;
  };

  Renderer.prototype.treeOpenMenu = function (rec, id) {
    if (!rec || !rec.root || !id) return false;
    if (rec.menu) rec.menu.remove();
    var self = this;
    var items = isArray(rec.options.context) ? rec.options.context : [];
    if (!items.length || rec.block.readonly) return false;
    var menu = el("div", {class: "pui-tree-menu", role: "menu", "aria-label": "Tree actions"});
    items.forEach(function (item) {
      if (!isObject(item)) return;
      var button = el("button", {type: "button", class: "pui-tree-menu-item", role: "menuitem", text: String(item.label || item.id || "Action")});
      button.addEventListener("click", function () {
        if (rec.menu) rec.menu.remove();
        rec.menu = null;
        self.performAction(item, button, {nodeId: id, path: rec.path});
      });
      menu.appendChild(button);
    });
    rec.root.appendChild(menu);
    rec.menu = menu;
    if (menu.querySelector) { var first = menu.querySelector("button"); if (first && first.focus) first.focus(); }
    return true;
  };

  /** Local/live stage control surface. The host owns file access, rendering,
   * transport and conflict resolution; PUI owns state presentation and intents. */
  Renderer.prototype.buildStage = function (block) {
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var Stage = global.PupitreStage;
    var label = String(block.label || block.id || "Stage");
    if (!Stage) return el("p", {class: "pui-missing", text: "(stage model PupitreStage is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(stage value is missing)"});
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-stage", "data-pui-stage": path, role: "group"});
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {block: block, path: path, value: value, root: root, statusText: "", statusEl: null};
    this.stageRender(rec);
    return root;
  };

  Renderer.prototype.stageRender = function (rec) {
    var self = this;
    var Stage = global.PupitreStage;
    if (!rec || !rec.root || !Stage) return;
    var value = rec.value;
    var project = isObject(value.project) ? value.project : {};
    var readonly = !!rec.block.readonly;
    rec.root.textContent = "";
    var head = el("div", {class: "pui-stage-head"});
    head.appendChild(el("h4", {text: String(rec.block.label || rec.block.id || "Stage")}));
    if (project.name) head.appendChild(el("span", {class: "pui-stage-project", text: String(project.name)}));
    if (project.offline) head.appendChild(el("span", {class: "pui-stage-badge is-offline", text: "Offline"}));
    if (project.dirty) head.appendChild(el("span", {class: "pui-stage-badge is-dirty", text: "Unsaved"}));
    if (value.draft) head.appendChild(el("span", {class: "pui-stage-badge", text: "Draft"}));
    head.appendChild(el("span", {class: "pui-stage-sync is-" + String(value.sync || "in_sync"), text: Stage.syncLabel(value.sync)}));
    if (!readonly) {
      var open = el("button", {type: "button", class: "pui-button", text: "Open project"});
      open.addEventListener("click", function () { self.stageCommand(rec, {op: "project.open", path: project.path || ""}); });
      var save = el("button", {type: "button", class: "pui-button", text: "Save project"});
      save.addEventListener("click", function () { self.stageCommand(rec, {op: "project.save", path: project.path || ""}); });
      head.appendChild(open);
      head.appendChild(save);
    }
    rec.root.appendChild(head);

    var modes = el("div", {class: "pui-stage-modes", role: "group", "aria-label": "Stage mode"});
    Stage.MODES.forEach(function (mode) {
      var button = el("button", {type: "button", class: "pui-button pui-stage-mode" + (String(value.mode) === mode ? " is-active" : ""), text: Stage.modeLabel(mode)});
      button.setAttribute("aria-pressed", String(value.mode) === mode ? "true" : "false");
      button.disabled = readonly;
      button.addEventListener("click", function () { self.stageSetMode(rec, mode); });
      modes.appendChild(button);
    });
    var crossfade = el("label", {class: "pui-stage-crossfade"});
    crossfade.appendChild(el("span", {text: "Crossfade"}));
    var crossfadeInput = el("input", {type: "range", min: "0", max: "1", step: "0.01", "aria-label": "Crossfade"});
    crossfadeInput.value = String(Stage.clampCrossfade(value.crossfade));
    crossfadeInput.disabled = readonly;
    crossfadeInput.addEventListener("input", function () { self.stageSetCrossfade(rec, Number(crossfadeInput.value)); });
    crossfade.appendChild(crossfadeInput);
    crossfade.appendChild(el("output", {class: "pui-stage-crossfade-value", text: Math.round(Stage.clampCrossfade(value.crossfade) * 100) + "%"}));
    modes.appendChild(crossfade);
    rec.root.appendChild(modes);

    var actions = el("div", {class: "pui-stage-actions", role: "group", "aria-label": "Stage actions"});
    [["push", "Push"], ["pull", "Pull"], ["pin", "Pin"], ["clear", "Clear"]].forEach(function (pair) {
      var button = el("button", {type: "button", class: "pui-button", text: pair[1]});
      button.disabled = readonly;
      button.addEventListener("click", function () { self.stageCommand(rec, {op: "stage." + pair[0], mode: value.mode}); });
      actions.appendChild(button);
    });
    rec.root.appendChild(actions);

    var cards = el("div", {class: "pui-stage-cards"});
    [["local", "Local", value.local], ["live", "Live", value.live]].forEach(function (entry) {
      var card = el("div", {class: "pui-stage-card is-" + entry[0] + (String(value.mode) === entry[0] || String(value.mode) === "crossfade" ? " is-visible" : "")});
      card.appendChild(el("h5", {text: entry[1]}));
      var data = isObject(entry[2]) ? entry[2] : {};
      card.appendChild(el("strong", {text: String(data.label || entry[1])}));
      if (data.summary) card.appendChild(el("p", {text: String(data.summary)}));
      cards.appendChild(card);
    });
    rec.root.appendChild(cards);

    if (isObject(value.conflict)) {
      var conflict = value.conflict;
      var box = el("div", {class: "pui-stage-conflict", role: "alert"});
      box.appendChild(el("h5", {text: "Conflict · " + String(conflict.path || conflict.id || "value")}));
      if (conflict.reason) box.appendChild(el("p", {class: "pui-stage-conflict-reason", text: String(conflict.reason)}));
      var sides = el("div", {class: "pui-stage-conflict-sides"});
      ["base", "local", "remote"].forEach(function (name) {
        if (!isObject(conflict[name])) return;
        var side = el("div", {class: "pui-stage-conflict-side is-" + name});
        side.appendChild(el("strong", {text: name}));
        side.appendChild(el("code", {text: JSON.stringify(conflict[name].value)}));
        side.appendChild(el("span", {class: "pui-stage-provenance", text: "rev " + String(conflict[name].rev) + " · " + String(conflict[name].source || "unknown") + (conflict[name].at ? " · " + String(conflict[name].at) : "")}));
        sides.appendChild(side);
      });
      box.appendChild(sides);
      var conflictActions = el("div", {class: "pui-stage-actions"});
      ["keep_mine", "take_theirs"].forEach(function (op) {
        var button = el("button", {type: "button", class: "pui-button " + (op === "keep_mine" ? "pui-primary" : "pui-danger"), text: op === "keep_mine" ? "Keep mine" : "Take theirs"});
        button.disabled = readonly;
        button.addEventListener("click", function () { self.stageCommand(rec, {op: "conflict." + op, conflictId: conflict.id, path: conflict.path}); });
        conflictActions.appendChild(button);
      });
      box.appendChild(conflictActions);
      rec.root.appendChild(box);
    }
    if (isArray(value.commands) && value.commands.length) {
      var log = el("details", {class: "pui-stage-log"});
      log.appendChild(el("summary", {text: "Command log · " + value.commands.length}));
      var list = el("ul");
      value.commands.slice(-20).reverse().forEach(function (command) {
        if (!isObject(command)) return;
        var item = el("li", {class: "pui-stage-command is-" + String(command.status || "unknown")});
        item.appendChild(el("span", {class: "pui-stage-command-op", text: String(command.op || command.id || "command")}));
        item.appendChild(el("span", {class: "pui-stage-command-status", text: String(command.status || "unknown")}));
        if (command.path) item.appendChild(el("code", {text: String(command.path)}));
        if (command.message) item.appendChild(el("span", {class: "pui-stage-command-message", text: String(command.message)}));
        item.appendChild(el("span", {class: "pui-stage-provenance", text: String(command.actor || "host") + (command.at ? " · " + String(command.at) : "")}));
        list.appendChild(item);
      });
      log.appendChild(list);
      rec.root.appendChild(log);
    }
    if (isArray(value.unsupported) && value.unsupported.length) {
      var unsupported = el("div", {class: "pui-stage-unsupported"});
      unsupported.appendChild(el("strong", {text: "Unsupported: "}));
      unsupported.appendChild(el("span", {text: value.unsupported.map(String).join(", ")}));
      rec.root.appendChild(unsupported);
    }
    if (isArray(value.pinned) && value.pinned.length) rec.root.appendChild(el("p", {class: "pui-stage-pinned", text: "Pinned: " + value.pinned.map(String).join(", ")}));

    var status = el("p", {class: "pui-stage-status", role: "status", "aria-live": "polite"});
    status.textContent = rec.statusText || (project.offline ? "Offline preview; host keeps the live output untouched." : "Stage ready.");
    rec.statusEl = status;
    rec.root.appendChild(status);
  };

  Renderer.prototype.stageSetMode = function (rec, mode) {
    if (rec.block.readonly || global.PupitreStage.MODES.indexOf(String(mode)) < 0) return false;
    rec.value.mode = String(mode);
    this.stageWrite(rec, {op: "stage.mode", mode: rec.value.mode});
    this.stageRender(rec);
    return true;
  };

  Renderer.prototype.stageSetCrossfade = function (rec, value) {
    if (rec.block.readonly) return false;
    rec.value.crossfade = global.PupitreStage.clampCrossfade(value);
    this.stageWrite(rec, {op: "stage.crossfade", value: rec.value.crossfade});
    this.stageRender(rec);
    return true;
  };

  Renderer.prototype.stageWrite = function (rec, intent) {
    if (typeof this.adapter.stageAction === "function") {
      try {
        var result = this.adapter.stageAction(intent || {}, rec.value, rec.block);
        if (result === false) return false;
      } catch (error) {
        this.adapter.announce("error", "Stage action failed: " + String(error && error.message || error));
        return false;
      }
    }
    return this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
  };

  Renderer.prototype.stageCommand = function (rec, intent) {
    if (rec.block.readonly) return false;
    if (typeof this.adapter.stageAction !== "function") {
      this.adapter.announce("warning", "Host does not expose stage actions.");
      return false;
    }
    try {
      var result = this.adapter.stageAction(intent || {}, rec.value, rec.block);
      if (result === false) return false;
      rec.statusText = "Host received " + String(intent.op || "stage command") + ".";
      this.stageRender(rec);
      return true;
    } catch (error) {
      this.adapter.announce("error", "Stage action failed: " + String(error && error.message || error));
      return false;
    }
  };

  /** Generic timeline view: host owns playback/interpolation, PUI owns the
   * tracks/keys/playhead geometry, editing intents and accessibility. */
  Renderer.prototype.timelineTime = function (seconds, value) {
    if (value && value.fps && global.PupitreTimeline && global.PupitreTimeline.formatTimecode) {
      return global.PupitreTimeline.formatTimecode(seconds, value.fps, {drop_frame: value.drop_frame === true});
    }
    return global.PupitreTimeline ? global.PupitreTimeline.formatTime(seconds) : String(seconds);
  };

  Renderer.prototype.timelineScale = function (track, value) {
    var Timeline = global.PupitreTimeline;
    if (!Timeline || !isObject(track)) return null;
    var keys = Timeline.keysForTrack(value, track.id).filter(function (key) {
      return isObject(key) && isFinite(Number(key.value));
    });
    var min = track.min !== undefined && isFinite(Number(track.min)) ? Number(track.min) : Infinity;
    var max = track.max !== undefined && isFinite(Number(track.max)) ? Number(track.max) : -Infinity;
    if (!isFinite(min) || !isFinite(max) || max <= min) {
      min = keys.length ? Math.min.apply(null, keys.map(function (key) { return Number(key.value); })) : 0;
      max = keys.length ? Math.max.apply(null, keys.map(function (key) { return Number(key.value); })) : 1;
    }
    if (!isFinite(min) || !isFinite(max) || max <= min) { min -= 1; max += 1; }
    return {min: min, max: max, span: max - min};
  };

  Renderer.prototype.timelineValuePercent = function (scale, value) {
    if (!scale) return 50;
    var ratio = (Number(value) - scale.min) / scale.span;
    if (!isFinite(ratio)) ratio = 0;
    return (100 - Math.max(0, Math.min(1, ratio)) * 100).toFixed(3);
  };

  Renderer.prototype.timelineCurvePath = function (track, value, duration) {
    var Timeline = global.PupitreTimeline;
    if (!Timeline) return "";
    var keys = Timeline.keysForTrack(value, track.id).filter(function (key) {
      return isObject(key) && isFinite(Number(key.time)) && isFinite(Number(key.value));
    });
    if (!keys.length) return "";
    var scale = this.timelineScale(track, value);
    var min = scale.min, max = scale.max, span = scale.span;
    var x = function (time) { return Timeline.timeToPercent(time, duration); };
    var y = function (value) { return Number(this.timelineValuePercent(scale, value)); }.bind(this);
    var points = [[0, y(keys[0].value)]];
    keys.forEach(function (key, index) {
      points.push([x(key.time), y(key.value)]);
      var next = keys[index + 1];
      if (!next) return;
      for (var step = 1; step <= 12; step++) {
        var t = step / 12;
        var eased = String(key.curve || "linear") === "hold" ? 0 : ease(key.curve, t);
        points.push([x(Number(key.time) + (Number(next.time) - Number(key.time)) * t), y(Number(key.value) + (Number(next.value) - Number(key.value)) * eased)]);
      }
    });
    points.push([x(duration), y(keys[keys.length - 1].value)]);
    return points.map(function (point, index) {
      return (index ? "L " : "M ") + point[0].toFixed(3) + " " + point[1].toFixed(3);
    }).join(" ");
  };

  Renderer.prototype.buildTimeline = function (block) {
    var self = this;
    var Timeline = global.PupitreTimeline;
    var path = String(block.bind || "");
    var value = path ? this.adapter.getValue(path) : null;
    var label = String(block.label || block.id || "Timeline");
    if (!Timeline) return el("p", {class: "pui-missing", text: "(timeline model PupitreTimeline is not loaded)"});
    if (!isObject(value)) return el("p", {class: "pui-missing", text: "(timeline value is missing)"});
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var options = isObject(block.timeline_options) ? block.timeline_options : {};
    var root = el("section", {class: "pui-timeline", "data-pui-timeline": path, role: "group"});
    if (options.scope === "clip") root.classList.add("is-clip-automation");
    if (options.scope) root.setAttribute("data-scope", String(options.scope));
    if (a11y.name || label) root.setAttribute("aria-label", String(a11y.name || label));
    var rec = {
      block: block, path: path, value: value, root: root, options: options,
      selectedKey: null, selectedTrackId: (value.tracks && value.tracks[0] && value.tracks[0].id !== undefined) ? String(value.tracks[0].id) : "",
      drag: null, labelsEl: null, lanesEl: null, playheadEl: null, playheadInput: null, playheadOutput: null
    };
    var head = el("div", {class: "pui-timeline-head"});
    head.appendChild(el("h4", {text: label}));
    if (options.scope === "clip") head.appendChild(el("span", {class: "pui-timeline-scope", text: options.context ? "Clip · " + String(options.context) : "Clip"}));
    var count = el("span", {class: "pui-timeline-count", text: (value.tracks || []).length + " tracks · " + (value.keys || []).length + " keys"});
    head.appendChild(count);
    var loop = el("button", {type: "button", class: "pui-button pui-timeline-loop", text: "Loop"});
    loop.setAttribute("aria-pressed", value.loop ? "true" : "false");
    loop.disabled = !!block.readonly;
    loop.addEventListener("click", function () {
      rec.value.loop = !rec.value.loop;
      loop.setAttribute("aria-pressed", rec.value.loop ? "true" : "false");
      self.writeTimeline(rec, {op: "loop.set", value: !!rec.value.loop});
    });
    head.appendChild(loop);
    if (!block.readonly) {
      var addKey = el("button", {type: "button", class: "pui-button", text: "Add key"});
      addKey.addEventListener("click", function () { self.timelineAddKey(rec); });
      head.appendChild(addKey);
    }
    var playheadLabel = el("label", {class: "pui-timeline-playhead-control"});
    playheadLabel.appendChild(el("span", {text: this.t("timeline.playhead", "Playhead")}));
    var playheadInput = el("input", {type: "range", min: "0", max: String(Math.max(0.01, Number(value.duration) || 1)), step: "0.01", "aria-label": "Timeline playhead"});
    playheadInput.value = String(Number(value.playhead) || 0);
    playheadInput.disabled = !!block.readonly;
    var playheadOutput = el("output", {class: "pui-timeline-time", text: this.timelineTime(value.playhead, value)});
    playheadInput.addEventListener("input", function () { self.timelineSetPlayhead(rec, Number(playheadInput.value)); });
    playheadLabel.appendChild(playheadInput);
    playheadLabel.appendChild(playheadOutput);
    head.appendChild(playheadLabel);
    root.appendChild(head);
    var body = el("div", {class: "pui-timeline-body"});
    var labels = el("div", {class: "pui-timeline-labels"});
    labels.appendChild(el("div", {class: "pui-timeline-label-head", text: "Track"}));
    body.appendChild(labels);
    var lanes = el("div", {class: "pui-timeline-lanes"});
    body.appendChild(lanes);
    root.appendChild(body);
    rec.labelsEl = labels;
    rec.lanesEl = lanes;
    rec.playheadInput = playheadInput;
    rec.playheadOutput = playheadOutput;
    this.timelineRender(rec);
    root.addEventListener("pointermove", function (event) {
      if (rec.drag) self.timelineDragMove(rec, event);
      else if (rec.scrub) self.timelineScrub(rec, event);
    });
    root.addEventListener("pointerup", function (event) {
      rec.scrub = null;
      self.timelineDragEnd(rec, event);
    });
    root.addEventListener("pointercancel", function () { rec.scrub = null; self.timelineDragEnd(rec); });
    root.addEventListener("keydown", function (event) { self.timelineKeydown(rec, event); });
    return root;
  };

  Renderer.prototype.timelineRender = function (rec) {
    var self = this;
    var Timeline = global.PupitreTimeline;
    if (!Timeline || !rec || !rec.value) return;
    var value = rec.value;
    var duration = Number(value.duration) > 0 ? Number(value.duration) : 1;
    rec.keyEls = {};
    var groups = {labels: rec.labelsEl, lanes: rec.lanesEl};
    if (!groups.labels || !groups.lanes) return;
    groups.labels.textContent = "";
    groups.labels.appendChild(el("div", {class: "pui-timeline-label-head", text: "Track"}));
    groups.lanes.textContent = "";
    var ruler = el("div", {class: "pui-timeline-ruler", "aria-hidden": "true"});
    for (var tick = 0; tick <= 4; tick++) {
      var tickTime = duration * tick / 4;
      var mark = el("span", {class: "pui-timeline-tick", style: "left:" + (tick * 25) + "%;"});
      mark.appendChild(el("span", {class: "pui-timeline-tick-label", text: self.timelineTime(tickTime, value)}));
      ruler.appendChild(mark);
    }
    groups.lanes.appendChild(ruler);
    var trackList = el("div", {class: "pui-timeline-tracks"});
    (value.tracks || []).forEach(function (track) {
      if (!isObject(track)) return;
      var trackId = String(track.id);
      var labelButton = el("button", {type: "button", class: "pui-timeline-track-label" + (rec.selectedTrackId === trackId ? " is-selected" : ""), text: String(track.label || trackId)});
      labelButton.setAttribute("aria-pressed", rec.selectedTrackId === trackId ? "true" : "false");
      labelButton.addEventListener("click", function () { rec.selectedTrackId = trackId; self.timelineRender(rec); });
      var labelRow = el("div", {class: "pui-timeline-label-row"});
      labelRow.appendChild(labelButton);
      if (track.target) labelRow.appendChild(el("span", {class: "pui-timeline-target", text: String(track.target)}));
      rec.labelsEl.appendChild(labelRow);
      var lane = el("div", {class: "pui-timeline-lane", "data-track-id": trackId, tabindex: "0", role: "group"});
      lane.setAttribute("aria-label", String(track.label || trackId) + " keys");
      lane.addEventListener("pointerdown", function (event) {
        if (event.target && event.target.closest && event.target.closest(".pui-timeline-key")) return;
        rec.selectedTrackId = trackId;
        var box = lane.getBoundingClientRect ? lane.getBoundingClientRect() : {left: 0, width: 1};
        rec.scrub = {lane: lane};
        self.timelineSetPlayhead(rec, Timeline.xToTime((event.clientX || 0) - box.left, box.width || 1, duration));
        if (lane.setPointerCapture && event.pointerId !== undefined) {
          try { lane.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        }
      });
      lane.addEventListener("dblclick", function (event) {
        if (rec.block.readonly || (event.target && event.target.closest && event.target.closest(".pui-timeline-key"))) return;
        var box = lane.getBoundingClientRect ? lane.getBoundingClientRect() : {left: 0, width: 1, height: 1};
        var time = Timeline.xToTime((event.clientX || 0) - box.left, box.width || 1, duration);
        var scale = self.timelineScale(track, value);
        var valueAt = scale ? scale.max - Math.max(0, Math.min(1, ((event.clientY || 0) - box.top) / Math.max(1, box.height))) * scale.span : 0;
        self.timelineAddKeyAt(rec, trackId, time, Number(valueAt.toFixed(4)));
      });
      var curvePath = self.timelineCurvePath(track, value, duration);
      if (curvePath) {
        var curveSvg = svgEl("svg", {class: "pui-timeline-curve", viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true"});
        curveSvg.appendChild(svgEl("path", {class: "pui-timeline-curve-path", "data-track-id": trackId, d: curvePath, style: track.color ? "stroke:" + String(track.color) + ";" : ""}));
        lane.appendChild(curveSvg);
      }
      Timeline.keysForTrack(value, trackId).forEach(function (key) {
        if (!isObject(key)) return;
        var trackScale = self.timelineScale(track, value);
        var keyTop = Math.max(6, Math.min(94, Number(self.timelineValuePercent(trackScale, key.value))));
        var keyStyle = "left:" + Timeline.timeToPercent(key.time, duration) + "%;top:" + keyTop.toFixed(3) + "%;";
        if (track.color) keyStyle += "--pui-timeline-key-color:" + String(track.color) + ";";
        var button = el("button", {type: "button", class: "pui-timeline-key is-" + String(key.curve || "linear") + (rec.selectedKey && String(rec.selectedKey.id) === String(key.id) ? " is-selected" : ""), style: keyStyle, "data-key-id": String(key.id || ""), "data-key-value": String(key.value)});
        button.setAttribute("aria-label", Timeline.keyLabel(key));
        button.title = Timeline.keyLabel(key);
        button.setAttribute("aria-pressed", rec.selectedKey && String(rec.selectedKey.id) === String(key.id) ? "true" : "false");
        button.addEventListener("pointerdown", function (event) {
          if (event.stopPropagation) event.stopPropagation();
          if (rec.block.readonly) { self.timelineSelectKey(rec, key); return; }
          self.timelineSelectKey(rec, key, true);
          var box = lane.getBoundingClientRect ? lane.getBoundingClientRect() : {width: 1, height: 1};
          rec.drag = {key: key, startTime: Number(key.time) || 0, startValue: Number(key.value) || 0, x: event.clientX || 0, y: event.clientY || 0,
            lane: lane, box: box, scale: self.timelineScale(track, value), moved: false};
          if (button.setPointerCapture && event.pointerId !== undefined) {
            try { button.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
          }
        });
        button.addEventListener("click", function (event) { if (event.stopPropagation) event.stopPropagation(); self.timelineSelectKey(rec, key); });
        rec.keyEls[String(key.id || "")] = button;
        lane.appendChild(button);
      });
      trackList.appendChild(lane);
    });
    groups.lanes.appendChild(trackList);
    var playhead = el("div", {class: "pui-timeline-playhead", style: "left:" + Timeline.timeToPercent(value.playhead, duration) + "%;"});
    groups.lanes.appendChild(playhead);
    rec.playheadEl = playhead;
    if (rec.playheadInput) rec.playheadInput.value = String(Number(value.playhead) || 0);
    if (rec.playheadOutput) rec.playheadOutput.textContent = self.timelineTime(value.playhead, value);
    this.timelineRenderInspector(rec);
  };

  Renderer.prototype.timelineRenderInspector = function (rec) {
    if (!rec || !rec.root) return;
    var old = rec.root.querySelector(".pui-timeline-inspector");
    if (old && old.remove) old.remove();
    if (!rec.selectedKey) return;
    var self = this;
    var Timeline = global.PupitreTimeline;
    var inspector = el("div", {class: "pui-timeline-inspector"});
    inspector.appendChild(el("span", {class: "pui-timeline-inspector-title", text: "Key " + String(rec.selectedKey.id || "?")}));
    var curve = el("select", {"aria-label": "Key curve"});
    Timeline.CURVES.forEach(function (name) {
      var option = el("option", {value: name, text: name});
      if (String(rec.selectedKey.curve || "linear") === name) option.selected = true;
      curve.appendChild(option);
    });
    curve.disabled = !!rec.block.readonly;
    curve.addEventListener("change", function () {
      rec.selectedKey.curve = curve.value;
      self.writeTimeline(rec, {op: "key.curve", id: rec.selectedKey.id, curve: rec.selectedKey.curve});
      self.timelineRender(rec);
    });
    inspector.appendChild(curve);
    var valueInput = el("input", {type: "number", step: "0.01", "aria-label": "Key value"});
    valueInput.value = String(Number(rec.selectedKey.value) || 0);
    valueInput.disabled = !!rec.block.readonly;
    valueInput.addEventListener("change", function () {
      rec.selectedKey.value = Number(valueInput.value);
      self.writeTimeline(rec, {op: "key.value", id: rec.selectedKey.id, value: rec.selectedKey.value});
      self.timelineRender(rec);
    });
    inspector.appendChild(valueInput);
    var timeInput = el("input", {type: "number", step: "0.01", min: "0", max: String(Number(rec.value.duration) || 0), "aria-label": "Key time"});
    timeInput.value = String(Number(rec.selectedKey.time) || 0);
    timeInput.disabled = !!rec.block.readonly;
    timeInput.addEventListener("change", function () {
      rec.selectedKey.time = Timeline.snapTime(Number(timeInput.value), rec.options.snap, rec.value.duration);
      self.writeTimeline(rec, {op: "key.time", id: rec.selectedKey.id, time: rec.selectedKey.time});
      self.timelineRender(rec);
    });
    inspector.appendChild(timeInput);
    var removeKey = el("button", {type: "button", class: "pui-button pui-timeline-remove-key", text: "Delete key"});
    removeKey.disabled = !!rec.block.readonly;
    removeKey.addEventListener("click", function () {
      if (rec.block.readonly) return;
      var id = rec.selectedKey && rec.selectedKey.id;
      rec.value.keys = (rec.value.keys || []).filter(function (key) { return String(key.id) !== String(id); });
      rec.selectedKey = null;
      self.writeTimeline(rec, {op: "key.delete", id: id});
      self.timelineRender(rec);
    });
    inspector.appendChild(removeKey);
    rec.root.appendChild(inspector);
  };

  Renderer.prototype.timelineSelectKey = function (rec, key, keepElement) {
    rec.selectedKey = key;
    var track = key && key.track !== undefined ? String(key.track) : "";
    if (track) rec.selectedTrackId = track;
    if (keepElement) {
      Object.keys(rec.keyEls || {}).forEach(function (id) {
        var element = rec.keyEls[id];
        var selected = key && String(key.id) === String(id);
        if (element.classList) element.classList.toggle("is-selected", selected);
        if (element.setAttribute) element.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      this.timelineRenderInspector(rec);
      return;
    }
    this.timelineRender(rec);
  };

  Renderer.prototype.timelineSetPlayhead = function (rec, time) {
    if (!rec || !rec.value) return;
    var duration = Number(rec.value.duration) > 0 ? Number(rec.value.duration) : 1;
    var next = Math.max(0, Math.min(duration, Number(time) || 0));
    rec.value.playhead = next;
    if (rec.playheadInput) rec.playheadInput.value = String(next);
    if (rec.playheadEl) rec.playheadEl.style.left = global.PupitreTimeline.timeToPercent(next, duration) + "%";
    if (rec.playheadOutput) rec.playheadOutput.textContent = this.timelineTime(next, rec.value);
    if (!rec.block.readonly) this.writeTimeline(rec, {op: "playhead.set", time: next});
  };

  Renderer.prototype.timelineAddKeyAt = function (rec, trackId, time, value) {
    if (!rec || rec.block.readonly) return null;
    var Timeline = global.PupitreTimeline;
    var track = trackId !== undefined && trackId !== null ? trackId : (rec.selectedTrackId || (rec.value.tracks && rec.value.tracks[0] && rec.value.tracks[0].id));
    if (track === undefined || track === null) return null;
    var trackDef = Timeline.findTrack(rec.value, track);
    var duration = Number(rec.value.duration) > 0 ? Number(rec.value.duration) : 1;
    var index = 1;
    while ((rec.value.keys || []).some(function (key) { return String(key.id) === "k" + index; })) index++;
    var key = {
      id: "k" + index, track: String(track),
      time: Timeline.snapTime(Number(time) || 0, rec.options.snap, duration),
      value: value === undefined || value === null ? (trackDef && trackDef.default !== undefined ? trackDef.default : 0) : Number(value),
      curve: "linear"
    };
    rec.value.keys = (rec.value.keys || []).concat([key]);
    rec.selectedKey = key;
    this.writeTimeline(rec, {op: "key.add", id: key.id, time: key.time, value: key.value});
    this.timelineRender(rec);
    return key.id;
  };

  Renderer.prototype.timelineAddKey = function (rec) {
    return this.timelineAddKeyAt(rec, rec.selectedTrackId, Number(rec.value.playhead) || 0);
  };

  Renderer.prototype.timelineScrub = function (rec, event) {
    if (!rec || !rec.scrub || !rec.scrub.lane) return;
    var Timeline = global.PupitreTimeline;
    var box = rec.scrub.lane.getBoundingClientRect ? rec.scrub.lane.getBoundingClientRect() : {left: 0, width: 1};
    var duration = Number(rec.value.duration) > 0 ? Number(rec.value.duration) : 1;
    var time = Timeline.xToTime((event.clientX || 0) - box.left, box.width || 1, duration);
    this.timelineSetPlayhead(rec, Timeline.snapTime(time, rec.options.snap, duration));
  };

  Renderer.prototype.timelineDragMove = function (rec, event) {
    if (!rec || !rec.drag || rec.block.readonly) return;
    var dx = (event.clientX || 0) - rec.drag.x;
    var dy = (event.clientY || 0) - rec.drag.y;
    if (!rec.drag.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    rec.drag.moved = true;
    var box = rec.drag.box || (rec.drag.lane.getBoundingClientRect ? rec.drag.lane.getBoundingClientRect() : {width: 1, height: 1});
    var duration = Number(rec.value.duration) > 0 ? Number(rec.value.duration) : 1;
    var delta = dx / Math.max(1, box.width || 1) * duration;
    rec.drag.key.time = global.PupitreTimeline.snapTime(rec.drag.startTime + delta, rec.options.snap, duration);
    if (rec.drag.scale && box.height) {
      rec.drag.key.value = Number((rec.drag.startValue - dy / Math.max(1, box.height) * rec.drag.scale.span).toFixed(4));
      rec.drag.key.value = Math.max(rec.drag.scale.min, Math.min(rec.drag.scale.max, rec.drag.key.value));
    }
    var keyEl = rec.keyEls && rec.keyEls[String(rec.drag.key.id)];
    if (keyEl) {
      keyEl.style.left = global.PupitreTimeline.timeToPercent(rec.drag.key.time, duration) + "%";
      var dragTop = Math.max(6, Math.min(94, Number(this.timelineValuePercent(rec.drag.scale, rec.drag.key.value))));
      keyEl.style.top = dragTop.toFixed(3) + "%";
      keyEl.setAttribute("data-key-value", String(rec.drag.key.value));
      keyEl.setAttribute("aria-label", global.PupitreTimeline.keyLabel(rec.drag.key));
      keyEl.title = global.PupitreTimeline.keyLabel(rec.drag.key);
    }
  };

  Renderer.prototype.timelineDragEnd = function (rec, event) {
    if (!rec || !rec.drag) return;
    var drag = rec.drag;
    rec.drag = null;
    if (drag.moved) {
      this.writeTimeline(rec, {op: "key.move", id: drag.key.id, time: drag.key.time, value: drag.key.value});
      this.timelineRender(rec);
    }
  };

  Renderer.prototype.timelineKeydown = function (rec, event) {
    if (!rec || rec.block.readonly) return;
    if (event.target && event.target.closest && event.target.closest("input, select, textarea")) return;
    if ((event.key === "Delete" || event.key === "Backspace") && rec.selectedKey) {
      if (event.preventDefault) event.preventDefault();
      var id = rec.selectedKey.id;
      rec.value.keys = (rec.value.keys || []).filter(function (key) { return key !== rec.selectedKey; });
      rec.selectedKey = null;
      this.writeTimeline(rec, {op: "key.delete", id: id});
      this.timelineRender(rec);
      return;
    }
    if (rec.selectedKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      if (event.preventDefault) event.preventDefault();
      var step = Number(rec.options.snap) > 0 ? Number(rec.options.snap) : 0.1;
      if (event.shiftKey) step *= 10;
      rec.selectedKey.time = Math.max(0, Math.min(Number(rec.value.duration) || 0, Number(rec.selectedKey.time) + (event.key === "ArrowRight" ? step : -step)));
      this.writeTimeline(rec, {op: "key.time", id: rec.selectedKey.id, time: rec.selectedKey.time});
      this.timelineRender(rec);
    }
  };

  Renderer.prototype.writeTimeline = function (rec, intent) {
    if (typeof this.adapter.timelineAction === "function") {
      try {
        var result = this.adapter.timelineAction(intent || {}, rec.value, rec.block);
        if (result === false) return false;
      } catch (error) {
        this.adapter.announce("error", "Timeline action failed: " + String(error && error.message || error));
        return false;
      }
    }
    return this.setPath(String(rec.path || rec.block.bind || ""), rec.value, rec.block);
  };

  Renderer.prototype.buildField = function (block, context) {
    var field = this.effective(block);
    var path = String(field.bind || "");
    if (!path) return el("p", {class: "pui-missing", text: "(field without bind)"});
    var widget = String(field.widget || "text");
    var root = el("div", {class: "pui-field", "data-pui-block": "", "data-pui-path": path});
    var rec = {
      path: path, block: field, root: root, inputs: [], control: null,
      label: null, widget: widget, order: field.order || 0, dragging: false,
      readonly: !!field.readonly, disabled: !!field.disabled,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      collectionRecordIndex: this._collectionRecordIndex,
      rawBind: String(block.__pui_raw_bind !== undefined ? block.__pui_raw_bind : (block.bind || "")), collection: context || null
    };
    var id = this.id("field");
    if (widget === "switch" || widget === "checkbox") {
      var wrap = el("label", {class: "pui-switch"});
      var input = el("input", {type: "checkbox", id: id, "data-pui-bind": path});
      if (widget === "switch") input.setAttribute("role", "switch");
      input.checked = !!this.value(rec);
      input.addEventListener("change", function () { this.writeRecord(rec, input.checked); }.bind(this));
      var switchLabel = el("span", {text: this.labelText(field)});
      wrap.appendChild(switchLabel);
      wrap.appendChild(input);
      root.appendChild(wrap);
      var switchReset = this.resetButton(field, path);
      if (switchReset) {
        switchReset.classList.add("pui-switch-reset");
        rec.resetEl = switchReset;
        switchReset.style.visibility = "hidden";
        switchReset.setAttribute("aria-hidden", "true");
        root.appendChild(switchReset);
      }
      rec.control = input;
      rec.inputs = [input];
      rec.label = wrap;
      rec.labelTextEl = switchLabel;
      var switchHelp = this.helpEl(field, id);
      if (switchHelp) {
        root.appendChild(switchHelp);
        rec.helpEl = switchHelp;
      }
    } else if (widget === "readout" || widget === "none") {
      this.buildReadoutInto(root, field, rec);
    } else {
      var knobNumber = null;
      if (widget === "knob") {
        root.classList.add("is-knob");
        var knobCaption = el("div", {class: "pui-knob-caption"});
        var knobCap = caption(field, id);
        knobCaption.appendChild(knobCap);
        var knobNumberRow = el("div", {class: "pui-knob-number-row"});
        knobNumber = el("input", {
          type: "text", class: "pui-knob-number", inputmode: "decimal",
          "aria-label": this.labelText(field) + " value",
        });
        var initialKnobValue = this.value(rec);
        knobNumber.value = isMixedValue(initialKnobValue) ? "" : valueText(initialKnobValue, field);
        knobNumber.placeholder = isMixedValue(initialKnobValue) ? "—" : "";
        knobNumberRow.appendChild(knobNumber);
        var knobReset = this.resetButton(field, path);
        if (knobReset) {
          rec.resetEl = knobReset;
          knobReset.style.visibility = "hidden";
          knobReset.setAttribute("aria-hidden", "true");
          knobNumberRow.appendChild(knobReset);
        }
        knobCaption.appendChild(knobNumberRow);
        root.appendChild(knobCaption);
        rec.label = knobCap;
        rec.labelTextEl = knobCap;
        if (field.help) {
          var knobHelp = this.helpEl(field, id);
          root.appendChild(knobHelp);
          rec.helpEl = knobHelp;
        }
      } else if (widget !== "button" && widget !== "impulse") {
        var cap = caption(field, id);
        root.appendChild(cap);
        rec.label = cap;
        rec.labelTextEl = cap;
        if (field.help) {
          var fieldHelp = this.helpEl(field, id);
          root.appendChild(fieldHelp);
          rec.helpEl = fieldHelp;
        }
      }
      var control = this.controlFor(field, widget, id, rec);
      if (!control) return el("p", {class: "pui-missing", text: "(no widget for " + widget + ")"});
      if (widget === "knob") {
        var knobRow = el("div", {class: "pui-control-row"});
        knobRow.appendChild(control);
        root.appendChild(knobRow);
        rec.knobNumber = knobNumber;
        rec.inputs.push(knobNumber);
        this.bindKnobNumber(rec, knobNumber);
      } else if (widget !== "button" && widget !== "impulse") {
        var row = el("div", {class: "pui-control-row"});
        row.appendChild(control);
        var reset = this.resetButton(field, path);
        if (reset) {
          rec.resetEl = reset;
          reset.style.visibility = "hidden";
          reset.setAttribute("aria-hidden", "true");
          row.appendChild(reset);
        }
        root.appendChild(row);
      } else {
        root.appendChild(control);
      }
      if (!rec.control) rec.control = control;
    }
    if (rec.readonly || rec.disabled) rec.inputs.forEach(function (input) { input.disabled = true; });
    this.a11y(rec.control, field, rec.label, rec.inputs);
    rec.statusEl = el("p", {class: "pui-status", role: "status", "aria-live": "polite", hidden: true});
    root.appendChild(rec.statusEl);
    this.records.push(rec);
    if (field.visible_when || field.enabled_when) rec.conditional = true;
    this.updateModified(rec);
    return root;
  };

  // The knob's numeric value lives under the parameter caption, not inside the
  // dial. This keeps both the label and value readable while a finger covers
  // the rotary, and makes exact typing a first-class input.
  Renderer.prototype.bindKnobNumber = function (rec, input) {
    var self = this;
    var committed = false;
    var commit = function () {
      if (committed) return;
      committed = true;
      var text = String(input.value || "").trim().replace(",", ".");
      var parsed = Number(text);
      rec.knobEditing = false;
      if (text !== "" && isFinite(parsed)) {
        rec.knobApply(parsed, true, true);
        input.value = rec.knobText(parsed);
      } else {
        input.value = rec.knobText(self.value(rec));
      }
      committed = false;
    };
    input.addEventListener("focus", function () {
      rec.knobEditing = true;
      if (input.select) input.select();
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commit();
        if (input.select) input.select();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        rec.knobEditing = false;
        input.value = rec.knobText(self.value(rec));
        if (input.blur) input.blur();
        if (rec.control && rec.control.focus) rec.control.focus();
      } else {
        event.stopPropagation();
      }
    });
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
  };

  Renderer.prototype.scrubHandle = function (rec, field, read, write, label) {
    var self = this;
    var precision = numericPrecision(field);
    var step = Number(field.step) || (precision !== null ? Math.pow(10, -precision) : 1);
    var handle = el("span", {
      class: "pui-scrub", role: "slider", tabindex: "0",
      "aria-label": "Drag to adjust " + String(label || this.labelText(field))
    });
    if (field.min !== undefined) handle.setAttribute("aria-valuemin", String(field.min));
    if (field.max !== undefined) handle.setAttribute("aria-valuemax", String(field.max));
    var update = function () {
      var value = Number(read());
      if (!isNaN(value)) {
        handle.setAttribute("aria-valuenow", String(value));
        handle.setAttribute("aria-valuetext", valueText(value, field));
        handle.setAttribute("aria-valuenow", String(value));
      }
    };
    var apply = function (value, final) {
      var next = quantizeNumeric(value, field);
      if (field.min !== undefined) next = Math.max(Number(field.min), next);
      if (field.max !== undefined) next = Math.min(Number(field.max), next);
      write(next, final);
      update();
    };
    var drag = null;
    var move = function (event) {
      if (!drag) return;
      var factor = event.shiftKey ? 10 : (event.altKey ? 0.1 : 1);
      apply(drag.value + (Number(event.clientX) - drag.x) * drag.step * factor, false);
    };
    var end = function () {
      if (!drag) return;
      var value = Number(read());
      drag = null;
      rec.dragging = false;
      if (typeof document !== "undefined" && document.removeEventListener) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", end);
        document.removeEventListener("pointercancel", end);
      }
      if (!isNaN(value)) write(value, true);
      update();
    };
    handle.addEventListener("pointerdown", function (event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      if (handle.focus) handle.focus();
      drag = {x: Number(event.clientX), value: Number(read()), step: step};
      rec.dragging = true;
      if (typeof document !== "undefined" && document.addEventListener) {
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", end);
        document.addEventListener("pointercancel", end);
      }
    });
    handle.addEventListener("keydown", function (event) {
      var key = String(event.key || "");
      if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].indexOf(key) < 0) return;
      event.preventDefault();
      var current = Number(read());
      if (key === "Home" && field.min !== undefined) apply(Number(field.min), true);
      else if (key === "End" && field.max !== undefined) apply(Number(field.max), true);
      else {
        var factor = event.shiftKey ? 10 : (event.altKey ? 0.1 : 1);
        var direction = key === "ArrowUp" || key === "ArrowRight" ? 1 : -1;
        apply(current + direction * step * factor, true);
      }
    });
    update();
    return handle;
  };

  Renderer.prototype.controlFor = function (field, widget, id, rec) {
    var self = this;
    var path = rec.path;
    if (widget === "range") {
      var vertical = String(field.orientation || "").toLowerCase() === "vertical";
      if (vertical) rec.root.classList.add("is-vertical");
      var row = el("div", {class: "pui-range" + (vertical ? " is-vertical" : "")});
      var range = el("input", {type: "range", id: id, "data-pui-bind": path});
      var current = this.value(rec);
      var mixed = isMixedValue(current);
      range.min = String(field.min !== undefined ? field.min : 0);
      range.max = String(field.max !== undefined ? field.max : 1);
      range.step = String(field.step !== undefined ? field.step : 0.01);
      range.value = mixed ? range.min : String(this.numberValue(rec));
      range.setAttribute("aria-orientation", vertical ? "vertical" : "horizontal");
      range.title = "Drag or wheel: Shift ×10, Alt ×0.1. Double-click the scrub handle to reset.";
      var paintRange = function () { paintRangeFill(range); };
      paintRange();
      var number = el("input", {type: "number", class: "pui-number-input", "aria-label": this.labelText(field) + " — precise value"});
      number.min = range.min; number.max = range.max; number.step = range.step;
      number.value = mixed ? "" : formatNumeric(this.numberValue(rec), field);
      number.placeholder = mixed ? "—" : "";
      if (mixed) {
        range.setAttribute("aria-valuetext", "mixed");
        rec.root.classList.add("is-mixed");
      }
      var emit = function (value, final) {
        var next = quantizeNumeric(value, field);
        var min = Number(range.min), max = Number(range.max);
        if (isFinite(min)) next = Math.max(min, next);
        if (isFinite(max)) next = Math.min(max, next);
        rec.rangeValue = next;
        range.value = String(next);
        number.value = formatNumeric(next, field);
        paintRange();
        rec.root.classList.remove("is-mixed");
        number.placeholder = "";
        var throttle = Number(field.throttle);
        if (field.live_emit && throttle > 0 && !final) {
          rec.livePending = next;
          if (!rec.liveTimer) {
            self.writeRecord(rec, next);
            rec.liveTimer = setTimeout(function () {
              rec.liveTimer = null;
              if (rec.livePending !== undefined) {
                var pending = rec.livePending;
                rec.livePending = undefined;
                self.writeRecord(rec, pending);
              }
            }, throttle);
          }
          return;
        }
        if (rec.liveTimer) { clearTimeout(rec.liveTimer); rec.liveTimer = null; }
        rec.livePending = undefined;
        self.writeRecord(rec, next);
      };
      var nudge = function (direction, event) {
        if (document.activeElement !== range && document.activeElement !== number) return;
        if (event.preventDefault) event.preventDefault();
        var precision = numericPrecision(field);
        var step = Number(field.step) || (precision !== null ? Math.pow(10, -precision) : 0.01);
        if (event.altKey && precision !== null) step = Math.pow(10, -precision);
        if (event.shiftKey) step *= 10;
        emit(Number(range.value) + direction * step, false);
      };
      range.addEventListener("wheel", function (event) { nudge(event.deltaY < 0 ? 1 : -1, event); }, {passive: false});
      number.addEventListener("wheel", function (event) { nudge(event.deltaY < 0 ? 1 : -1, event); }, {passive: false});
      range.addEventListener("input", function () { paintRange(); emit(Number(range.value), false); });
      number.addEventListener("change", function () { emit(Number(number.value), true); });
      range.addEventListener("pointerdown", function () { rec.dragging = true; });
      range.addEventListener("pointerup", function () { rec.dragging = false; if (rec.rangeValue !== undefined) emit(rec.rangeValue, true); });
      range.addEventListener("blur", function () { rec.dragging = false; if (rec.rangeValue !== undefined) emit(rec.rangeValue, true); });
      var rangeScrub = this.scrubHandle(rec, field, function () { return Number(range.value); }, function (value, final) { emit(value, final); }, this.labelText(field));
      row.appendChild(range); row.appendChild(number); row.appendChild(rangeScrub);
      rec.inputs = [range, number, rangeScrub];
      rec.range = range; rec.number = number; rec.rangePaint = paintRange;
      rec.control = range;
      return row;
    }
    if (widget === "knob") {
      var knob = el("div", {class: "pui-knob", id: id, role: "slider", tabindex: "0", "data-pui-bind": path});
      var min = field.min !== undefined ? Number(field.min) : 0;
      var max = field.max !== undefined ? Number(field.max) : 1;
      if (!isFinite(min)) min = 0;
      if (!isFinite(max) || max <= min) max = min + 1;
      var step = Number(field.step) > 0 ? Number(field.step) : 0.01;
      var dial = svgEl("svg", {class: "pui-knob-dial", viewBox: "0 0 48 48", "aria-hidden": "true", focusable: "false"});
      dial.appendChild(svgEl("circle", {class: "pui-knob-track", cx: "24", cy: "24", r: "19", pathLength: "100"}));
      var arc = svgEl("circle", {class: "pui-knob-arc", cx: "24", cy: "24", r: "19", pathLength: "100"});
      dial.appendChild(arc);
      knob.appendChild(dial);
      var readout = el("span", {class: "pui-knob-value"});
      knob.appendChild(readout);
      knob.setAttribute("aria-valuemin", String(min));
      knob.setAttribute("aria-valuemax", String(max));
      knob.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter");
      knob.title = "Drag or wheel: Shift ×10, Alt ×0.1, Ctrl ×0.01. Enter or type a value; long-press to type; double-click resets.";
      rec.knobArc = arc;
      rec.knobValue = readout;
      rec.knob = knob;

      var knobText = function (value) {
        if (field.precision !== undefined) {
          var fixedPrecision = Number(field.precision);
          if (isFinite(fixedPrecision) && fixedPrecision >= 0) return Number(value).toFixed(fixedPrecision);
        }
        var text = String(Number(Number(value).toFixed(6)));
        return text === "-0" ? "0" : text;
      };
      var readKnob = function () {
        var value = self.value(rec);
        return value === undefined || value === null || isMixedValue(value) ? NaN : Number(value);
      };
      var paintKnob = function (value, mixed) {
        var ratio = mixed ? 0 : Math.max(0, Math.min(1, (Number(value) - min) / (max - min)));
        arc.style.setProperty("stroke-dasharray", (ratio * 75).toFixed(2) + " 100");
        readout.textContent = mixed ? "—" : knobText(Number(value));
        knob.setAttribute("aria-valuenow", String(mixed ? min : Number(value)));
        knob.setAttribute("aria-valuetext", mixed ? "mixed" : knobText(Number(value)) + (field.unit ? " " + field.unit : ""));
        if (rec.knobNumber && (typeof document === "undefined" || document.activeElement !== rec.knobNumber)) {
          rec.knobNumber.value = mixed ? "" : knobText(Number(value));
          rec.knobNumber.placeholder = mixed ? "—" : "";
        }
        rec.root.classList.toggle("is-mixed", !!mixed);
      };
      var applyKnob = function (value, final, exact) {
        var next = Number(value);
        if (!isFinite(next)) return;
        var fixedPrecision = field.precision !== undefined ? Number(field.precision) : null;
        if (fixedPrecision !== null && isFinite(fixedPrecision) && fixedPrecision >= 0) {
          next = Number(next.toFixed(fixedPrecision));
        } else {
          next = Number(next.toFixed(6));
        }
        next = Math.max(min, Math.min(max, next));
        paintKnob(next, false);
        self.writeRecord(rec, next);
        if (final) rec.dragging = false;
      };
      var modifierScale = function (event) {
        if (event && event.shiftKey) return 10;
        if (event && event.altKey) return 0.1;
        if (event && event.ctrlKey) return 0.01;
        return 1;
      };
      var knobNudge = function (direction, event) {
        if (event && event.preventDefault) event.preventDefault();
        if (rec.knobInput) return;
        var amount = step * modifierScale(event);
        var current = readKnob();
        applyKnob(isNaN(current) ? min : current + direction * amount, true);
      };

      var finishKnobEdit = function (commit, refocus) {
        var input = rec.knobInput;
        if (!input) return;
        knob.classList.remove("is-editing");
        var text = String(input.value || "").trim().replace(",", ".");
        var parsed = Number(text);
        if (commit && text !== "" && isFinite(parsed)) {
          applyKnob(parsed, true, true);
          // Keep the optimistic exact value even if the host snapshot is one
          // frame behind the synchronous PUI apply.
          paintKnob(parsed, false);
        }
        rec.knobInput = null;
        if (input.remove) input.remove();
        if (refocus && knob.focus) knob.focus();
      };
      var beginKnobEdit = function (seed, selectAll) {
        if (!knob || rec.knobInput) return;
        if (rec.knobNumber) {
          rec.knobEditing = true;
          rec.knobNumber.value = seed === null || seed === undefined ? knobText(readKnob()) : String(seed);
          if (rec.knobNumber.focus) rec.knobNumber.focus();
          if (rec.knobNumber.select && selectAll) rec.knobNumber.select();
          else if (rec.knobNumber.setSelectionRange) rec.knobNumber.setSelectionRange(rec.knobNumber.value.length, rec.knobNumber.value.length);
          return;
        }
        var input = el("input", {
          type: "text", class: "pui-knob-input", inputmode: "decimal",
          "aria-label": self.labelText(field) + " — type a value",
        });
        input.value = seed === null || seed === undefined ? knobText(readKnob()) : String(seed);
        rec.knobInput = input;
        knob.classList.add("is-editing");
        knob.appendChild(input);
        input.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            finishKnobEdit(true, true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            finishKnobEdit(false, true);
          } else {
            event.stopPropagation();
          }
        });
        input.addEventListener("blur", function () { finishKnobEdit(true, false); });
        if (input.focus) input.focus();
        if (input.select && selectAll) input.select();
        else if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length);
      };

      knob.addEventListener("wheel", function (event) {
        if (rec.knobInput) return;
        knobNudge(event.deltaY < 0 ? 1 : -1, event);
      }, {passive: false});
      knob.addEventListener("keydown", function (event) {
        if (event.target !== knob || rec.knobInput) return;
        var key = String(event.key || "");
        if (key === "Enter") {
          event.preventDefault();
          beginKnobEdit(null, true);
          return;
        }
        if (key === "Escape" && knobDrag) {
          event.preventDefault();
          cancelKnobDrag();
          return;
        }
        if (/^[0-9]$/.test(key) || key === "." || key === "," || key === "-") {
          event.preventDefault();
          beginKnobEdit(key, false);
          return;
        }
        if (key === "Home") { event.preventDefault(); applyKnob(min, true, true); return; }
        if (key === "End") { event.preventDefault(); applyKnob(max, true, true); return; }
        if (key === "PageUp" || key === "PageDown") {
          event.preventDefault();
          knobNudge(key === "PageUp" ? 10 : -10, event);
          return;
        }
        if (key === "ArrowUp" || key === "ArrowRight") {
          event.preventDefault();
          knobNudge(1, event);
        } else if (key === "ArrowDown" || key === "ArrowLeft") {
          event.preventDefault();
          knobNudge(-1, event);
        }
      });
      knob.addEventListener("dblclick", function (event) {
        if (event.preventDefault) event.preventDefault();
        if (rec.knobInput) return;
        applyKnob(field.default === undefined ? min : Number(field.default), true, true);
      });

      var knobDrag = null;
      var knobDragTimer = null;
      var clearKnobDragTimer = function () {
        if (knobDragTimer !== null) {
          clearTimeout(knobDragTimer);
          knobDragTimer = null;
        }
      };
      var removeKnobDragListeners = function () {
        if (typeof document !== "undefined" && document.removeEventListener) {
          document.removeEventListener("pointermove", knobMove);
          document.removeEventListener("pointerup", knobEnd);
          document.removeEventListener("pointercancel", knobCancel);
        }
      };
      var knobMove = function (event) {
        if (!knobDrag) return;
        var dx = Number(event.clientX || 0) - knobDrag.x;
        var dy = knobDrag.y - Number(event.clientY || 0);
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
          knobDrag.moved = true;
          clearKnobDragTimer();
        }
        var modifier = knobDrag.pointerType === "touch" ? 1 : modifierScale(event);
        var distance = knobDrag.pointerType === "touch" ? 220 : 120;
        applyKnob(knobDrag.value + (dy / distance) * (max - min) * modifier, false);
        if (event.preventDefault) event.preventDefault();
      };
      var knobEnd = function () {
        if (!knobDrag) return;
        var drag = knobDrag;
        var current = readKnob();
        clearKnobDragTimer();
        removeKnobDragListeners();
        knobDrag = null;
        rec.dragging = false;
        if (!isNaN(current)) applyKnob(current, true);
      };
      var knobCancel = function () {
        if (!knobDrag) return;
        var start = knobDrag.value;
        clearKnobDragTimer();
        removeKnobDragListeners();
        knobDrag = null;
        rec.dragging = false;
        applyKnob(start, true, true);
      };
      var cancelKnobDrag = function () {
        knobCancel();
      };
      knob.addEventListener("pointerdown", function (event) {
        if (rec.knobInput) return;
        if (event.target === rec.knobInput) return;
        if (event.button !== undefined && event.button !== 0) return;
        if (event.preventDefault) event.preventDefault();
        if (knob.focus) knob.focus();
        var current = readKnob();
        knobDrag = {
          x: Number(event.clientX || 0),
          y: Number(event.clientY || 0),
          value: isNaN(current) ? min : current,
          pointerType: String(event.pointerType || "mouse"),
          moved: false,
        };
        rec.dragging = true;
        if (knob.setPointerCapture && event.pointerId !== undefined) {
          try { knob.setPointerCapture(event.pointerId); } catch (error) { /* ignore */ }
        }
        if (typeof document !== "undefined" && document.addEventListener) {
          document.addEventListener("pointermove", knobMove);
          document.addEventListener("pointerup", knobEnd);
          document.addEventListener("pointercancel", knobCancel);
        }
        clearKnobDragTimer();
        if (typeof setTimeout === "function") {
          knobDragTimer = setTimeout(function () {
            knobDragTimer = null;
            if (!knobDrag || knobDrag.moved) return;
            var start = knobDrag.value;
            knobDrag = null;
            rec.dragging = false;
            removeKnobDragListeners();
            beginKnobEdit(null, true);
          }, 520);
        }
      });
      rec.knobPaint = paintKnob;
      rec.knobApply = applyKnob;
      rec.knobText = knobText;
      paintKnob(this.value(rec), isMixedValue(this.value(rec)));
      rec.control = knob;
      rec.inputs = [knob];
      return knob;
    }
    if (widget === "number") {
      var spin = el("input", {type: "number", id: id, "data-pui-bind": path});
      spin.min = String(field.min !== undefined ? field.min : -1e12);
      spin.max = String(field.max !== undefined ? field.max : 1e12);
      spin.step = String(field.step !== undefined ? field.step : 1);
      spin.value = formatNumeric(this.numberValue(rec), field);
      var spinNudge = function (direction, event) {
        if (document.activeElement !== spin) return;
        if (event.preventDefault) event.preventDefault();
        var precision = numericPrecision(field);
        var base = Number(field.step) || (precision !== null ? Math.pow(10, -precision) : 1);
        if (event.altKey && precision !== null) base = Math.pow(10, -precision);
        if (event.shiftKey) base *= 10;
        var next = quantizeNumeric(Number(spin.value) + direction * base, field);
        if (field.min !== undefined) next = Math.max(Number(field.min), next);
        if (field.max !== undefined) next = Math.min(Number(field.max), next);
        spin.value = formatNumeric(next, field);
        self.writeRecord(rec, next);
      };
      var spinEmit = function (value, final) {
        var next = quantizeNumeric(value, field);
        if (field.min !== undefined) next = Math.max(Number(field.min), next);
        if (field.max !== undefined) next = Math.min(Number(field.max), next);
        spin.value = formatNumeric(next, field);
        self.writeRecord(rec, next);
      };
      spin.addEventListener("wheel", function (event) { spinNudge(event.deltaY < 0 ? 1 : -1, event); }, {passive: false});
      spin.addEventListener("change", function () { spinEmit(Number(spin.value), true); });
      var numberBox = el("div", {class: "pui-number"});
      numberBox.appendChild(spin);
      var spinScrub = this.scrubHandle(rec, field, function () { return Number(spin.value); }, spinEmit, this.labelText(field));
      numberBox.appendChild(spinScrub);
      rec.control = spin;
      rec.inputs = [spin, spinScrub];
      return numberBox;
    }
    if (widget === "file") {
      var fileInput = el("input", {type: "file", id: id, "data-pui-bind": path});
      if (field.accept) fileInput.setAttribute("accept", String(field.accept));
      if (field.multiple) fileInput.setAttribute("multiple", "");
      var fileNote = el("span", {class: "pui-file-field-name", text: valueText(this.value(rec), field)});
      fileInput.addEventListener("change", function () {
        var files = fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
        var value = field.multiple ? files : (files[0] || null);
        self.writeRecord(rec, value);
        fileNote.textContent = files.length ? files.map(function (file) { return file.name; }).join(", ") : "";
      });
      var fileBox = el("div", {class: "pui-file-field"}, fileInput, fileNote);
      rec.inputs = [fileInput];
      rec.fileNote = fileNote;
      return fileBox;
    }
    if (widget === "path") {
      var pathInput = el("input", {type: "text", id: id, "data-pui-bind": path, class: "pui-path-input"});
      if (field.placeholder) pathInput.setAttribute("placeholder", String(field.placeholder));
      pathInput.value = valueText(this.value(rec), field);
      pathInput.addEventListener("change", function () { self.writeRecord(rec, pathInput.value); });
      rec.control = pathInput;
      rec.inputs = [pathInput];
      if (field.browse) {
        var browse = el("button", {type: "button", class: "pui-button pui-path-browse", text: String(field.browse_label || self.t("field.browse", "Browse…"))});
        browse.addEventListener("click", function () {
          if (typeof self.adapter.filePick === "function") {
            try { self.adapter.filePick({op: "pick", kind: "path", path: path, block: field}, self.value(rec), field); }
            catch (error) { self.adapter.announce("error", "File picker failed: " + String(error && error.message || error)); }
          } else {
            self.adapter.announce("warning", "The host does not expose a file picker.");
          }
        });
        var pathWrap = el("div", {class: "pui-path-field"}, pathInput, browse);
        rec.inputs = [pathInput, browse];
        return pathWrap;
      }
      return pathInput;
    }
    if (widget === "select") {
      var select = el("select", {id: id, "data-pui-bind": path});
      var current = this.value(rec);
      var selectOptions = this.optionsFor(field);
      selectOptions.forEach(function (entry) {
        var option = el("option", {value: String(entry.value), text: String(entry.label !== undefined ? entry.label : entry.value)});
        if (equal(entry.value, current)) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener("change", function () {
        var entry = self.optionsFor(field)[select.selectedIndex];
        self.writeRecord(rec, entry ? entry.value : select.value);
      });
      rec.inputs = [select];
      return select;
    }
    if (widget === "radio") {
      var group = el("fieldset", {class: "pui-radio-group", id: id, "data-pui-bind": path, role: "radiogroup"});
      group.appendChild(el("legend", {class: "pui-sr-only", text: this.labelText(field)}));
      var currentRadio = this.value(rec);
      rec.optionLabels = [];
      this.optionsFor(field).forEach(function (entry, index) {
        var label = el("label", {class: "pui-radio"});
        var radio = el("input", {type: "radio", name: id, value: String(entry.value)});
        radio.checked = equal(entry.value, currentRadio);
        radio.addEventListener("change", function () { if (radio.checked) self.write(path, entry.value); });
        var optionText = el("span", {text: String(entry.label !== undefined ? entry.label : entry.value)});
        label.appendChild(radio); label.appendChild(optionText);
        group.appendChild(label); rec.inputs.push(radio); rec.optionLabels.push(optionText);
      });
      return group;
    }
    if (widget === "textarea" || widget === "json") {
      var box = el("div", {class: "pui-textarea"});
      var area = el("textarea", {id: id, "data-pui-bind": path, rows: widget === "json" ? 6 : 4});
      area.value = valueText(this.value(rec), field);
      var apply = el("button", {type: "button", class: "pui-button", text: "Apply"});
      apply.addEventListener("click", function () { self.writeRecord(rec, area.value); });
      box.appendChild(area); box.appendChild(apply);
      rec.inputs = [area];
      rec.edit = area;
      rec.control = area;
      return box;
    }
    if (widget === "color") {
      var value = this.value(rec);
      var hasAlpha = (typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) || (isArray(value) && value.length >= 4);
      var color = el("input", {type: "color", id: id, "data-pui-bind": path});
      color.value = this.colorValue(value);
      var commitColor = function () {
        var alpha = rec.alphaInput ? Math.round(Number(rec.alphaInput.value) / 100 * 255).toString(16).padStart(2, "0") : null;
        self.writeRecord(rec, alpha === null ? color.value : color.value + alpha);
      };
      color.addEventListener("change", commitColor);
      rec.inputs = [color];
      if (hasAlpha) {
        var alphaInput = el("input", {type: "number", class: "pui-color-alpha", min: "0", max: "100", step: "1", "aria-label": self.labelText(field) + " alpha"});
        alphaInput.value = String(Math.round(this.colorAlphaValue(value) * 100));
        alphaInput.addEventListener("change", commitColor);
        var wrap = el("span", {class: "pui-color-control"});
        wrap.appendChild(color);
        wrap.appendChild(alphaInput);
        wrap.appendChild(el("span", {class: "pui-unit", text: "% α"}));
        rec.inputs.push(alphaInput);
        rec.alphaInput = alphaInput;
        return wrap;
      }
      return color;
    }
    if (widget === "xy-pad") {
      var xyValues = components(this.value(rec), 2);
      var xyMin = field.min !== undefined ? Number(field.min) : 0;
      var xyMax = field.max !== undefined ? Number(field.max) : 1;
      var xyStep = field.step !== undefined ? Number(field.step) : 0.01;
      var xyWrap = el("div", {class: "pui-xypad-control", id: id, "data-pui-bind": path});
      var pad = el("div", {class: "pui-xypad", tabindex: "0", role: "application", "aria-label": this.labelText(field) + " XY pad"});
      var dot = el("span", {class: "pui-xypad-dot"});
      pad.appendChild(dot);
      var xyInputs = [];
      var xySync = function (values) {
        var x = Math.max(xyMin, Math.min(xyMax, Number(values[0]) || 0));
        var y = Math.max(xyMin, Math.min(xyMax, Number(values[1]) || 0));
        if (xyInputs[0]) xyInputs[0].value = formatNumeric(x, field);
        if (xyInputs[1]) xyInputs[1].value = formatNumeric(y, field);
        dot.style.left = (xyMax === xyMin ? 0 : (x - xyMin) / (xyMax - xyMin) * 100) + "%";
        dot.style.top = (xyMax === xyMin ? 0 : (1 - (y - xyMin) / (xyMax - xyMin)) * 100) + "%";
        rec.xyValue = [x, y];
        return [x, y];
      };
      var xyWrite = function () { self.writeRecord(rec, xySync(rec.xyValue || xyValues)); };
      var xyFromEvent = function (event) {
        var box = pad.getBoundingClientRect ? pad.getBoundingClientRect() : {left: 0, top: 0, width: 1, height: 1};
        var x = xyMin + Math.max(0, Math.min(1, ((event.clientX || 0) - box.left) / Math.max(1, box.width))) * (xyMax - xyMin);
        var y = xyMin + (1 - Math.max(0, Math.min(1, ((event.clientY || 0) - box.top) / Math.max(1, box.height)))) * (xyMax - xyMin);
        var precision = numericPrecision(field);
        if (precision !== null) { x = Number(x.toFixed(precision)); y = Number(y.toFixed(precision)); }
        xySync([x, y]);
      };
      pad.addEventListener("pointerdown", function (event) {
        if (event.preventDefault) event.preventDefault();
        rec.xyDrag = true;
        xyFromEvent(event);
        if (pad.setPointerCapture) pad.setPointerCapture(event.pointerId || 1);
      });
      pad.addEventListener("pointermove", function (event) { if (rec.xyDrag) xyFromEvent(event); });
      pad.addEventListener("pointerup", function () { if (rec.xyDrag) { rec.xyDrag = false; xyWrite(); } });
      pad.addEventListener("pointercancel", function () { rec.xyDrag = false; });
      pad.addEventListener("keydown", function (event) {
        if (event.key.indexOf("Arrow") !== 0) return;
        if (event.preventDefault) event.preventDefault();
        var step = xyStep;
        if (event.altKey) step /= 10;
        if (event.shiftKey) step *= 10;
        var value = xySync(rec.xyValue || xyValues).slice();
        if (event.key === "ArrowLeft") value[0] -= step;
        else if (event.key === "ArrowRight") value[0] += step;
        else if (event.key === "ArrowUp") value[1] += step;
        else if (event.key === "ArrowDown") value[1] -= step;
        xySync(value);
        xyWrite();
      });
      [0, 1].forEach(function (index) {
        var comp = el("input", {type: "number", "aria-label": index === 0 ? "X " + self.labelText(field) : "Y " + self.labelText(field), min: String(xyMin), max: String(xyMax), step: String(xyStep)});
        comp.value = formatNumeric(xyValues[index], field);
        comp.addEventListener("change", function () {
          var typed = Number(comp.value);
          var current = xySync(rec.xyValue || xyValues).slice();
          current[index] = typed;
          xySync(current);
          xyWrite();
        });
        comp.addEventListener("wheel", function (event) {
          if (document.activeElement !== comp) return;
          if (event.preventDefault) event.preventDefault();
          var current = xySync(rec.xyValue || xyValues).slice();
          current[index] += (event.deltaY < 0 ? 1 : -1) * xyStep * (event.shiftKey ? 10 : 1);
          xySync(current);
          xyWrite();
        }, {passive: false});
        xyInputs.push(comp);
        xyWrap.appendChild(el("label", {class: "pui-xypad-input"}, el("span", {text: index === 0 ? "X" : "Y"}), comp));
      });
      xyWrap.insertBefore(pad, xyWrap.firstChild);
      xySync(xyValues);
      rec.inputs = xyInputs;
      rec.control = pad;
      rec.xyPad = pad;
      rec.xyDot = dot;
      rec.xyInputs = xyInputs;
      return xyWrap;
    }
    if (widget === "vector") {
      var count = componentCount(field);
      var values = components(this.value(rec), count);
      var vector = el("div", {class: "pui-vector", id: id, "data-pui-bind": path});
      var names = ["X", "Y", "Z", "W"];
      for (var i = 0; i < count; i++) {
        (function (index) {
          var comp = el("input", {type: "number", "aria-label": names[index] + " " + self.labelText(field), step: String(field.step !== undefined ? field.step : (String(field.type || "").charAt(0) === "i" ? 1 : 0.01))});
          comp.value = formatNumeric(values[index] !== undefined ? values[index] : 0, field);
          comp.addEventListener("change", function () {
            var out = rec.inputs.map(function (input) { return quantizeNumeric(Number(input.value), field); });
            rec.inputs.forEach(function (input, inputIndex) { input.value = formatNumeric(out[inputIndex], field); });
            self.writeRecord(rec, out);
          });
          comp.addEventListener("wheel", function (event) {
            if (document.activeElement !== comp) return;
            if (event.preventDefault) event.preventDefault();
            var precision = numericPrecision(field);
            var base = Number(field.step) || (precision !== null ? Math.pow(10, -precision) : 0.01);
            if (event.altKey && precision !== null) base = Math.pow(10, -precision);
            if (event.shiftKey) base *= 10;
            var next = quantizeNumeric(Number(comp.value) + (event.deltaY < 0 ? base : -base), field);
            if (field.min !== undefined) next = Math.max(Number(field.min), next);
            if (field.max !== undefined) next = Math.min(Number(field.max), next);
            comp.value = formatNumeric(next, field);
            var out = rec.inputs.map(function (input) { return quantizeNumeric(Number(input.value), field); });
            self.writeRecord(rec, out);
          }, {passive: false});
          rec.inputs.push(comp);
          vector.appendChild(el("label", {class: "pui-vector-comp"}, el("span", {text: names[index]}), comp));
        })(i);
      }
      return vector;
    }
    if (widget === "impulse") {
      var pulse = el("button", {type: "button", class: "pui-button pui-impulse", id: id, "data-pui-bind": path, text: this.labelText(field)});
      var fireImpulse = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        self.writeRecord(rec, null);
      };
      pulse.addEventListener("pointerdown", function (event) {
        if (event.button !== undefined && event.button !== 0) return;
        fireImpulse(event);
      });
      pulse.addEventListener("click", function (event) {
        if (!event.detail) fireImpulse(event);
      });
      rec.inputs = [pulse];
      return pulse;
    }
    if (widget === "flags") {
      var bits = el("fieldset", {class: "pui-flags", id: id, "data-pui-bind": path});
      bits.appendChild(el("legend", {class: "pui-sr-only", text: this.labelText(field)}));
      var mask = Number(this.value(rec) || 0);
      rec.optionLabels = [];
      this.optionsFor(field).forEach(function (entry) {
        var label = el("label", {class: "pui-check"});
        var check = el("input", {type: "checkbox", value: String(entry.value), "data-pui-bit": String(entry.value)});
        check.checked = (mask & Number(entry.value)) !== 0;
        check.addEventListener("change", function () {
          var next = 0;
          rec.inputs.forEach(function (input) { if (input.checked) next |= Number(input.getAttribute("data-pui-bit")); });
          self.write(path, next);
        });
        var optionText = el("span", {text: String(entry.label !== undefined ? entry.label : entry.value)});
        label.appendChild(check); label.appendChild(optionText);
        bits.appendChild(label); rec.inputs.push(check); rec.optionLabels.push(optionText);
      });
      return bits;
    }
    if (widget === "button") {
      var button = el("button", {type: "button", class: "pui-button", id: id, "data-pui-bind": path, text: this.labelText(field)});
      button.addEventListener("click", function () { self.writeRecord(rec, null); });
      rec.inputs = [button];
      return button;
    }
    var line = el("input", {type: "text", id: id, "data-pui-bind": path});
    line.value = valueText(this.value(rec), field);
    if (field.maxlength) line.maxLength = Number(field.maxlength);
    line.addEventListener("change", function () { self.writeRecord(rec, line.value); });
    line.addEventListener("keydown", function (event) { if (event.key === "Enter") self.writeRecord(rec, line.value); });
    rec.inputs = [line];
    return line;
  };

  /* -------------------------------------------------------------- shell */

  Renderer.prototype.shellCondition = function (block, root) {
    var rec = {
      root: root, block: block,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true
    };
    this.shellRecords.push(rec);
    return rec;
  };

  Renderer.prototype.toolbarText = function (item, key) {
    var bind = String(item[key + "_bind"] || "");
    if (bind) {
      var value = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(bind, item)
        : this.adapter.getValue(bind);
      if (value !== undefined && value !== null) return String(value);
    }
    var value = item[key];
    return value === undefined || value === null ? "" : String(value);
  };

  Renderer.prototype.toolbarIcon = function (item) {
    var name = this.toolbarText(item, "icon");
    if (!name) return "";
    var icon = this.icons[name];
    if (icon === undefined && typeof this.adapter.getIcon === "function") icon = this.adapter.getIcon(name, item);
    if (typeof icon === "function") {
      try { icon = icon(name, item); } catch (error) { icon = null; }
    }
    if (icon === undefined || icon === null) return "";
    return icon;
  };

  Renderer.prototype.toolbarHasIcon = function (icon) {
    return icon !== undefined && icon !== null && icon !== "";
  };

  Renderer.prototype.fillToolbarIcon = function (iconEl, icon) {
    while (iconEl.firstChild) iconEl.removeChild(iconEl.firstChild);
    if (this.toolbarHasIcon(icon) && typeof icon === "object" && typeof icon.cloneNode === "function") {
      iconEl.appendChild(icon.cloneNode(true));
    } else if (this.toolbarHasIcon(icon)) {
      iconEl.textContent = String(icon);
    }
    iconEl.hidden = !this.toolbarHasIcon(icon);
  };

  Renderer.prototype.toolbarPressed = function (item) {
    var value = this.toolbarText(item, "pressed");
    return value === "true" || value === "1" || value === "on";
  };

  Renderer.prototype.toolbarReadoutValue = function (item) {
    var bind = String(item.bind || item.value_bind || "");
    if (!bind) return this.toolbarText(item, "value");
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(bind, item)
      : this.adapter.getValue(bind);
    if (typeof item.format === "function") return String(item.format(value));
    return value === undefined || value === null ? "" : String(value);
  };

  Renderer.prototype.toolbarRefresh = function (rec) {
    var item = rec.item;
    var label = this.toolbarText(item, "label");
    var title = this.toolbarText(item, "title") || label;
    if (rec.kind === "readout") {
      var readoutValue = this.toolbarReadoutValue(item);
      rec.value.textContent = readoutValue;
      rec.readoutLabel.textContent = label;
      rec.root.hidden = !!item.hide_empty && readoutValue === "";
      rec.root.setAttribute("data-tone", this.toolbarText(item, "tone") || "info");
      return;
    }
    var icon = this.toolbarIcon(item);
    var hasIcon = this.toolbarHasIcon(icon);
    var pressed = this.toolbarPressed(item);
    var badge = this.toolbarText(item, "badge");
    if (rec.iconEl) this.fillToolbarIcon(rec.iconEl, icon);
    if (rec.labelEl) {
      rec.labelEl.textContent = label;
      rec.labelEl.hidden = !label || (item.icon_only && hasIcon);
    }
    if (rec.badgeEl) {
      rec.badgeEl.textContent = badge;
      rec.badgeEl.hidden = !badge;
    }
    if (rec.button) {
      if (item.icon_only) rec.button.setAttribute("aria-label", label || title);
      else rec.button.removeAttribute("aria-label");
      if (title) rec.button.title = title;
      if (item.aria_controls) rec.button.setAttribute("aria-controls", String(item.aria_controls));
      // Only toggle items are pressed controls. Links and momentary actions
      // (Reset, Share, …) must keep their native semantics.
      if (item.pressed !== undefined || item.pressed_bind !== undefined) {
        rec.button.setAttribute("aria-pressed", pressed ? "true" : "false");
      } else {
        rec.button.removeAttribute("aria-pressed");
      }
      rec.button.classList.toggle("is-pressed", pressed);
    }
  };

  Renderer.prototype.toolbarContent = function (item, root) {
    var icon = this.toolbarIcon(item);
    var hasIcon = this.toolbarHasIcon(icon);
    var label = this.toolbarText(item, "label");
    var iconEl = el("span", {class: "pui-toolbar-icon", "aria-hidden": "true"});
    this.fillToolbarIcon(iconEl, icon);
    var labelEl = el("span", {class: "pui-toolbar-label", text: label});
    labelEl.hidden = !label || (item.icon_only && hasIcon);
    var badge = this.toolbarText(item, "badge");
    var badgeEl = el("span", {class: "pui-toolbar-badge", text: badge});
    badgeEl.hidden = !badge;
    root.appendChild(iconEl);
    root.appendChild(labelEl);
    root.appendChild(badgeEl);
    return {iconEl: iconEl, labelEl: labelEl, badgeEl: badgeEl};
  };

  Renderer.prototype.buildToolbarItem = function (parent, item, mode) {
    if (!isObject(item)) return null;
    var inMenu = mode === "menu";
    var contentItem = inMenu && item.icon_only ? Object.assign({}, item, {icon_only: false}) : item;
    var node;
    if (item.kind === "separator") {
      node = el(inMenu ? "div" : "span", {class: inMenu ? "pui-menu-separator" : "pui-toolbar-separator", role: "separator"});
      parent.appendChild(node);
      return node;
    }
    if (item.kind === "label") {
      node = el(inMenu ? "div" : "span", {class: inMenu ? "pui-menu-label" : "pui-toolbar-label", role: "presentation", text: String(item.text || item.label || "")});
      if (item.id) node.setAttribute("data-pui-item", String(item.id));
      parent.appendChild(node);
      return node;
    }
    if (item.kind === "spacer") {
      if (inMenu) return null;
      node = el("span", {class: "pui-toolbar-spacer"});
      parent.appendChild(node);
      return node;
    }
    if (item.kind === "menu") {
      if (inMenu) return null;
      node = this.buildMenu(item);
      parent.appendChild(node);
      return node;
    }
    if (item.kind === "readout") {
      node = el(inMenu ? "div" : "span", {
        class: inMenu ? "pui-menu-readout" : "pui-toolbar-readout",
        "data-tone": "info",
        "data-pui-item": String(item.id || "")
      });
      if (inMenu) node.setAttribute("role", "presentation");
      if (item.a11y && item.a11y.name) node.setAttribute("aria-label", String(item.a11y.name));
      var readoutLabel = el("span", {class: inMenu ? "pui-menu-readout-label" : "pui-toolbar-readout-label", text: this.toolbarText(item, "label")});
      var readoutValue = el("output", {class: inMenu ? "pui-menu-readout-value" : "pui-toolbar-readout-value", "data-pui-bind": String(item.bind || "")});
      node.appendChild(readoutLabel);
      node.appendChild(readoutValue);
      parent.appendChild(node);
      this.toolbarRecords.push({kind: "readout", root: node, item: item, readoutLabel: readoutLabel, value: readoutValue});
      return node;
    }
    if (item.kind === "link") {
      node = el("a", {class: "pui-button pui-toolbar-link" + (inMenu ? " pui-menu-item" : ""), href: String(item.href || "#"), "data-pui-item": String(item.id || "")});
      if (item.target) node.target = String(item.target);
      if (item.rel) node.rel = String(item.rel);
      if (item.download) node.download = String(item.download);
      this.toolbarContent(contentItem, node);
      if (inMenu) {
        node.setAttribute("role", "menuitem");
        node.tabIndex = -1;
        if (item.overflow_index !== undefined) node.setAttribute("data-pui-overflow-index", String(item.overflow_index));
      }
      if (item.icon_only && !inMenu) node.setAttribute("aria-label", this.toolbarText(item, "label"));
      var linkRec = {kind: "link", root: node, item: contentItem, button: node};
      linkRec = Object.assign(linkRec, {iconEl: node.children[0], labelEl: node.children[1], badgeEl: node.children[2]});
      parent.appendChild(node);
      this.toolbarRecords.push(linkRec);
      this.toolbarRefresh(linkRec);
      return node;
    }
    node = this.addActionButton(parent, item);
    if (!node) return null;
    node.textContent = "";
    node.setAttribute("data-pui-item", String(item.id || ""));
    node.__puiToolbar = true;
    if (inMenu) {
      node.setAttribute("role", "menuitem");
      node.tabIndex = -1;
      if (item.overflow_index !== undefined) node.setAttribute("data-pui-overflow-index", String(item.overflow_index));
    }
    var content = this.toolbarContent(contentItem, node);
    var rec = Object.assign({kind: "action", root: node, button: node, item: contentItem}, content);
    this.toolbarRecords.push(rec);
    this.toolbarRefresh(rec);
    return node;
  };

  Renderer.prototype.disconnectMeters = function () {
    for (var i = 0; i < this.meterRecords.length; i++) {
      var rec = this.meterRecords[i];
      if (typeof rec.unsubscribe === "function") { try { rec.unsubscribe(); } catch (error) {} rec.unsubscribe = null; }
    }
    this.meterRecords = [];
    for (var k = 0; k < this.keyCaptureRecords.length; k++) {
      var keyRec = this.keyCaptureRecords[k];
      if (keyRec.handler) document.removeEventListener("keydown", keyRec.handler, true);
      keyRec.handler = null;
    }
    this.keyCaptureRecords = [];
    for (var b = 0; b < this.bindingRecords.length; b++) {
      if (this.bindingRecords[b].unsubscribe) { try { this.bindingRecords[b].unsubscribe(); } catch (error) {} }
    }
    this.bindingRecords = [];
    this.workspaceRecords = [];
    for (var mt = 0; mt < this.mediaTimelineRecords.length; mt++) {
      if (this.mediaTimelineRecords[mt].unsubscribe) { try { this.mediaTimelineRecords[mt].unsubscribe(); } catch (error) {} }
    }
    this.mediaTimelineRecords = [];
    for (var f = 0; f < this.favoriteRecords.length; f++) {
      if (this.favoriteRecords[f].unsubscribe) { try { this.favoriteRecords[f].unsubscribe(); } catch (error) {} }
    }
    this.favoriteRecords = [];
    this.dialogRecords = [];
    this.schemaFormRecords = [];
  };

  Renderer.prototype.disconnectPreviews = function () {
    for (var i = 0; i < this.previewRecords.length; i++) {
      var rec = this.previewRecords[i];
      if (typeof rec.unsubscribe === "function") {
        try { rec.unsubscribe(); } catch (error) { /* host cleanup */ }
        rec.unsubscribe = null;
      }
    }
    this.previewRecords = [];
    this.transportRecords = [];
    this.meterRecords = [];
    this.keyCaptureRecords = [];
    for (var b = 0; b < this.bindingRecords.length; b++) {
      if (this.bindingRecords[b].unsubscribe) { try { this.bindingRecords[b].unsubscribe(); } catch (error) {} }
    }
    this.bindingRecords = [];
    this.workspaceRecords = [];
    for (var mt = 0; mt < this.mediaTimelineRecords.length; mt++) {
      if (this.mediaTimelineRecords[mt].unsubscribe) { try { this.mediaTimelineRecords[mt].unsubscribe(); } catch (error) {} }
    }
    this.mediaTimelineRecords = [];
    for (var f = 0; f < this.favoriteRecords.length; f++) {
      if (this.favoriteRecords[f].unsubscribe) { try { this.favoriteRecords[f].unsubscribe(); } catch (error) {} }
    }
    this.favoriteRecords = [];
    this.dialogRecords = [];
    this.schemaFormRecords = [];
  };

  Renderer.prototype.disconnectToolbarLayouts = function () {
    for (var i = 0; i < this.toolbarLayouts.length; i++) {
      var layout = this.toolbarLayouts[i];
      if (layout.observer && typeof layout.observer.disconnect === "function") layout.observer.disconnect();
      if (layout.resize && typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("resize", layout.resize);
      layout.observer = null;
      layout.resize = null;
    }
    this.toolbarLayouts = [];
  };

  Renderer.prototype.toolbarMeasure = function (node) {
    if (!node) return 0;
    var rect = node.getBoundingClientRect ? node.getBoundingClientRect() : null;
    if (rect && rect.width) return rect.width;
    return node.offsetWidth || 0;
  };

  Renderer.prototype.toolbarGap = function (root) {
    if (typeof window !== "undefined" && window.getComputedStyle) {
      try {
        var style = window.getComputedStyle(root);
        var gap = parseFloat(style.columnGap || style.gap || "0");
        if (!isNaN(gap)) return gap;
      } catch (error) { /* fall through */ }
    }
    return 6;
  };

  Renderer.prototype.toolbarIsHidden = function (node, root) {
    for (var walk = node; walk && walk !== root; walk = walk.parentNode) {
      if (walk.hidden) return true;
      if (walk.style && walk.style.display === "none") return true;
    }
    return false;
  };

  Renderer.prototype.toolbarAutoLayout = function (layout) {
    var root = layout.root;
    if (!root || !root.isConnected && typeof root.isConnected !== "undefined") return;
    var available = root.clientWidth || (root.getBoundingClientRect ? root.getBoundingClientRect().width : 0);
    if (!available) return;
    var main = layout.main;
    for (var i = 0; i < main.length; i++) {
      if (main[i].collapsible) main[i].node.hidden = false;
    }
    for (var m = 0; m < layout.menuNodes.length; m++) layout.menuNodes[m].hidden = true;
    layout.trigger.hidden = true;
    layout.menu.hidden = true;
    var gap = this.toolbarGap(root);
    var widths = [];
    var total = 0;
    for (var w = 0; w < main.length; w++) {
      // A flex spacer absorbs the remaining width; counting its expanded
      // measurement as fixed content makes every toolbar look overfull.
      var flexible = main[w].node.classList && main[w].node.classList.contains("pui-toolbar-spacer");
      widths[w] = flexible ? 0 : this.toolbarMeasure(main[w].node);
      total += widths[w] + (w ? gap : 0);
    }
    layout.menu.hidden = false;
    layout.trigger.hidden = false;
    layout.trigger.style.visibility = "hidden";
    var triggerWidth = this.toolbarMeasure(layout.trigger);
    layout.trigger.style.visibility = "";
    layout.menu.hidden = true;
    layout.trigger.hidden = true;
    if (total <= available) {
      layout.collapsed = [];
      layout.trigger.hidden = true;
      layout.menu.hidden = true;
      if (typeof document !== "undefined" && document.activeElement === layout.trigger) {
        var first = root.__puiFirstToolbarFocus();
        if (first) first.focus();
      }
      root.__puiSyncToolbarFocus();
      return;
    }
    var candidates = main.filter(function (entry) { return entry.collapsible; });
    candidates.sort(function (a, b) {
      var ap = Number(a.item.priority) || 0;
      var bp = Number(b.item.priority) || 0;
      if (ap !== bp) return ap - bp;
      return b.index - a.index;
    });
    var collapsed = [];
    for (var c = 0; c < candidates.length; c++) {
      if (total + gap + triggerWidth <= available) break;
      var entry = candidates[c];
      entry.node.hidden = true;
      total -= widths[entry.index] + gap;
      collapsed.push(entry.index);
    }
    if (!collapsed.length) {
      layout.collapsed = [];
      layout.menu.hidden = true;
      layout.trigger.hidden = true;
      root.__puiSyncToolbarFocus();
      return;
    }
    layout.collapsed = collapsed;
    layout.menu.hidden = false;
    layout.trigger.hidden = false;
    for (var n = 0; n < layout.menuNodes.length; n++) {
      layout.menuNodes[n].hidden = collapsed.indexOf(Number(layout.menuNodes[n].getAttribute("data-pui-overflow-index"))) < 0;
    }
    var active = typeof document !== "undefined" ? document.activeElement : null;
    var activeInside = false;
    for (var walk = active; walk; walk = walk.parentNode) if (walk === root) { activeInside = true; break; }
    if (active && active !== layout.trigger && activeInside && this.toolbarIsHidden(active, root)) {
      if (layout.trigger.focus) layout.trigger.focus();
    }
    root.__puiSyncToolbarFocus();
  };

  Renderer.prototype.layoutToolbars = function () {
    for (var i = 0; i < this.toolbarLayouts.length; i++) this.toolbarAutoLayout(this.toolbarLayouts[i]);
  };

  Renderer.prototype.observeToolbar = function (layout) {
    var self = this;
    var schedule = function () {
      if (layout.scheduled) return;
      layout.scheduled = true;
      var run = function () {
        layout.scheduled = false;
        self.toolbarAutoLayout(layout);
      };
      if (typeof window !== "undefined" && window.requestAnimationFrame) window.requestAnimationFrame(run);
      else setTimeout(run, 0);
    };
    layout.schedule = schedule;
    if (typeof ResizeObserver !== "undefined") {
      layout.observer = new ResizeObserver(schedule);
      layout.observer.observe(layout.root);
    } else if (typeof window !== "undefined" && window.addEventListener) {
      layout.resize = schedule;
      window.addEventListener("resize", schedule);
    }
    this.toolbarLayouts.push(layout);
    schedule();
  };

  Renderer.prototype.buildToolbar = function (block) {
    var self = this;
    var root = el("div", {class: "pui-toolbar", "data-pui-toolbar": String(block.id || ""), role: "toolbar"});
    root.style.minWidth = "0";
    if (block.label) root.setAttribute("aria-label", String(block.label));
    else if (block.a11y && block.a11y.name) root.setAttribute("aria-label", String(block.a11y.name));
    if (block.align) root.setAttribute("data-align", String(block.align));
    var items = isArray(block.items) ? block.items : [];
    var auto = String(block.overflow || "") === "auto";
    if (auto) root.classList.add("is-overflow-auto");
    var keep = items.length;
    if (!auto && String(block.overflow || "") === "menu") {
      keep = Number(block.overflow_after);
      if (!isFinite(keep) || keep < 0) keep = 3;
      keep = Math.min(items.length, Math.floor(keep));
    }
    var main = [];
    for (var i = 0; i < keep; i++) {
      var node = this.buildToolbarItem(root, items[i], "toolbar");
      if (!node) continue;
      node.setAttribute("data-pui-overflow-index", String(i));
      if (auto && isObject(items[i])) {
        var kind = String(items[i].kind || "action");
        main.push({
          node: node,
          item: items[i],
          index: i,
          collapsible: (kind === "action" || kind === "link") && items[i].collapse !== false
        });
      }
    }
    var menu = null;
    var trigger = null;
    var menuNodes = [];
    if (auto) {
      var autoItems = main.filter(function (entry) { return entry.collapsible; }).map(function (entry) {
        return Object.assign({}, entry.item, {icon_only: false, overflow_index: entry.index});
      });
      menu = this.buildMenu({
        kind: "menu",
        id: String(block.id || "toolbar") + "-overflow",
        label: String(block.overflow_label || "More"),
        items: autoItems
      });
      menu.classList.add("pui-toolbar-overflow");
      menu.hidden = true;
      root.appendChild(menu);
      trigger = menu.querySelector(".pui-menu-trigger");
      if (trigger) trigger.hidden = true;
      menuNodes = Array.prototype.slice.call(menu.querySelectorAll("[data-pui-overflow-index]"));
      // The menu builder numbers its own children; map them back to the
      // toolbar item indices used by the layout planner.
      var autoCandidates = main.filter(function (entry) { return entry.collapsible; });
      menuNodes.forEach(function (entry, menuIndex) {
        entry.hidden = true;
        if (autoCandidates[menuIndex]) entry.setAttribute("data-pui-overflow-index", String(autoCandidates[menuIndex].index));
      });
    } else if (keep < items.length) {
      var overflowItems = items.slice(keep);
      menu = this.buildMenu({
        kind: "menu",
        id: String(block.id || "toolbar") + "-overflow",
        label: String(block.overflow_label || "More"),
        items: overflowItems
      });
      menu.classList.add("pui-toolbar-overflow");
      root.appendChild(menu);
    }
    var focusables = Array.prototype.slice.call(root.querySelectorAll("button, a[href]"));
    focusables = focusables.filter(function (control) {
      for (var parent = control.parentNode; parent && parent !== root; parent = parent.parentNode) {
        if (parent.classList && parent.classList.contains("pui-menu-popup")) return false;
      }
      return true;
    });
    var visibleFocusables = function () {
      return focusables.filter(function (control) { return !self.toolbarIsHidden(control, root); });
    };
    var syncFocus = function () {
      var visible = visibleFocusables();
      var active = typeof document !== "undefined" ? document.activeElement : null;
      var target = visible.indexOf(active) >= 0 ? active : visible[0];
      focusables.forEach(function (control) { control.tabIndex = -1; });
      if (target) target.tabIndex = 0;
    };
    root.__puiSyncToolbarFocus = syncFocus;
    root.__puiFirstToolbarFocus = function () { return visibleFocusables()[0] || null; };
    focusables.forEach(function (control) {
      control.addEventListener("focus", syncFocus);
    });
    root.addEventListener("keydown", function (event) {
      var visible = visibleFocusables();
      var index = visible.indexOf(document.activeElement);
      if (index < 0) return;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        visible[(index + 1) % visible.length].focus();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        visible[(index - 1 + visible.length) % visible.length].focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        visible[event.key === "Home" ? 0 : visible.length - 1].focus();
      }
    });
    syncFocus();
    if (auto) {
      var layout = {
        root: root, block: block, main: main, menu: menu, trigger: trigger,
        menuNodes: menuNodes, collapsed: [], scheduled: false
      };
      root.__puiToolbarLayout = layout;
      this.observeToolbar(layout);
    }
    this.shellCondition(block, root);
    return root;
  };

  Renderer.prototype.statusValue = function (item) {
    var path = String(item.bind || "");
    if (!path) return "";
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, item)
      : this.adapter.getValue(path);
    if (typeof item.format === "function") return String(item.format(value));
    if (value === undefined || value === null) return "";
    if (typeof value === "object") {
      try { return JSON.stringify(value); } catch (error) { return String(value); }
    }
    return String(value);
  };

  Renderer.prototype.statusTone = function (item) {
    var bind = String(item.tone_bind || "");
    var tone = bind ? (typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(bind, item) : this.adapter.getValue(bind)) : item.tone;
    return ["info", "success", "warning", "error"].indexOf(String(tone || "info")) >= 0 ? String(tone || "info") : "info";
  };

  Renderer.prototype.buildStatusbar = function (block) {
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("div", {class: "pui-statusbar", "data-pui-statusbar": String(block.id || ""), role: "status", "aria-live": String(a11y.live || "polite")});
    if (block.label) root.setAttribute("aria-label", String(block.label));
    var items = isArray(block.items) ? block.items : [];
    var values = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!isObject(item)) continue;
      var cell = el("span", {class: "pui-statusbar-item", "data-tone": this.statusTone(item)});
      var label = el("span", {class: "pui-statusbar-label", text: String(item.label || item.bind || "")});
      var value = el("output", {class: "pui-statusbar-value", "data-pui-bind": String(item.bind || "")});
      value.textContent = this.statusValue(item);
      cell.appendChild(label);
      cell.appendChild(value);
      root.appendChild(cell);
      values.push({item: item, value: value, cell: cell});
    }
    if (!values.length && block.bind) {
      var only = {bind: block.bind, label: block.label || ""};
      var single = el("span", {class: "pui-statusbar-item"});
      single.appendChild(el("span", {class: "pui-statusbar-label", text: String(only.label)}));
      var out = el("output", {class: "pui-statusbar-value", "data-pui-bind": String(only.bind)});
      out.textContent = this.statusValue(only);
      single.appendChild(out);
      root.appendChild(single);
      values.push({item: only, value: out, cell: single});
    }
    this.statusRecords.push({root: root, block: block, values: values});
    this.shellCondition(block, root);
    return root;
  };

  /** Title-bar menu: a compact trigger in the workbench header opening an
   * overlay with readouts, editable fields and actions for the current editor.
   * Kept page-local: it is not a nested dock. */
  Renderer.prototype.buildHeaderMenu = function (block) {
    var self = this;
    var root = el("div", {class: "pui-header-menu"});
    var popupId = this.id("header-menu");
    var label = String(block.label || "Menu");
    var trigger = el("button", {type: "button", class: "pui-button pui-header-menu-trigger", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-controls": popupId, text: label});
    if (block.icon) trigger.insertBefore(el("span", {class: "pui-header-menu-icon", "aria-hidden": "true", text: String(block.icon)}), trigger.firstChild);
    var popup = el("div", {class: "pui-header-menu-popup", id: popupId, role: "dialog", "aria-label": String(block.title || label), hidden: true});
    var head = el("div", {class: "pui-header-menu-head"});
    head.appendChild(el("h4", {text: String(block.title || label)}));
    var close = el("button", {type: "button", class: "pui-header-menu-close", text: "×", "aria-label": "Close " + String(block.title || label)});
    head.appendChild(close);
    popup.appendChild(head);
    var body = el("div", {class: "pui-header-menu-body"});
    (block.blocks || []).forEach(function (child) { body.appendChild(self.buildBlock(child)); });
    popup.appendChild(body);
    var closeMenu = function () { popup.hidden = true; trigger.setAttribute("aria-expanded", "false"); if (typeof document !== "undefined") document.removeEventListener("mousedown", outside, true); trigger.focus(); };
    var outside = function (event) { if (!root.contains(event.target)) closeMenu(); };
    var openMenu = function () { popup.hidden = false; trigger.setAttribute("aria-expanded", "true"); if (typeof document !== "undefined") document.addEventListener("mousedown", outside, true); var first = popup.querySelector("button, input, select, textarea"); if (first) first.focus(); };
    trigger.addEventListener("click", function () { if (popup.hidden) openMenu(); else closeMenu(); });
    close.addEventListener("click", closeMenu);
    popup.addEventListener("keydown", function (event) { if (event.key === "Escape") { event.preventDefault(); closeMenu(); } });
    popup.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest(".pui-actions button, .pui-actions a") : null;
      if (target) setTimeout(closeMenu, 0);
    });
    root.appendChild(trigger);
    root.appendChild(popup);
    return root;
  };

  Renderer.prototype.buildMenu = function (block) {
    var self = this;
    var root = el("div", {class: "pui-menu"});
    var label = String(block.label || "Actions");
    var popupId = this.id("menu-popup");
    var trigger = el("button", {type: "button", class: "pui-button pui-menu-trigger", "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": popupId});
    if (block.id) trigger.setAttribute("data-pui-item", String(block.id));
    var triggerContent = this.toolbarContent(block, trigger);
    var triggerRec = Object.assign({kind: "action", root: trigger, button: trigger, item: block}, triggerContent);
    this.toolbarRecords.push(triggerRec);
    this.toolbarRefresh(triggerRec);
    var popup = el("div", {class: "pui-menu-popup", role: "menu", "aria-label": label, id: popupId});
    popup.setAttribute("hidden", "");
    var items = isArray(block.items) ? block.items : [];
    for (var i = 0; i < items.length; i++) {
      var node = this.buildToolbarItem(popup, items[i], "menu");
      var overflowIndex = isObject(items[i]) && items[i].overflow_index !== undefined ? items[i].overflow_index : i;
      if (node) node.setAttribute("data-pui-overflow-index", String(overflowIndex));
      if (node && node.getAttribute && node.getAttribute("role") === "menuitem") {
        (function (control) {
          control.addEventListener("click", function () {
            close();
            if (typeof document !== "undefined" && document.activeElement === control) trigger.focus();
          });
        })(node);
      }
    }
    function menuItems() {
      return Array.prototype.slice.call(popup.querySelectorAll('[role="menuitem"]'));
    }
    function close() {
      if (popup.hasAttribute("hidden")) return;
      popup.setAttribute("hidden", "");
      trigger.setAttribute("aria-expanded", "false");
      if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("mousedown", outside, true);
    }
    function open() {
      if (!popup.hasAttribute("hidden")) return;
      popup.removeAttribute("hidden");
      trigger.setAttribute("aria-expanded", "true");
      if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("mousedown", outside, true);
      var first = menuItems()[0];
      if (first) first.focus();
    }
    function outside(event) {
      if (!root.contains(event.target)) close();
    }
    function keydown(event) {
      var list = menuItems();
      var index = list.indexOf(document.activeElement);
      if (event.key === "Escape") { close(); trigger.focus(); event.preventDefault(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (popup.hasAttribute("hidden")) { open(); event.preventDefault(); return; }
        if (!list.length) return;
        var next = event.key === "ArrowDown" ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
        list[next].focus();
        event.preventDefault();
      } else if (event.key === "Home" || event.key === "End") {
        if (!list.length) return;
        list[event.key === "Home" ? 0 : list.length - 1].focus();
        event.preventDefault();
      } else if (event.key === "Tab") {
        close();
      }
    }
    trigger.addEventListener("click", function (event) {
      event.stopPropagation();
      if (popup.hasAttribute("hidden")) open(); else close();
    });
    trigger.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    popup.addEventListener("keydown", keydown);
    root.appendChild(trigger);
    root.appendChild(popup);
    var rec = {
      root: root, trigger: trigger, popup: popup, block: block, outside: outside,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true
    };
    this.menuRecords.push(rec);
    this.shellCondition(block, root);
    return root;
  };

  Renderer.prototype.toastItems = function (block) {
    var path = String(block.bind || "");
    if (!path) return [];
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, block)
      : this.adapter.getValue(path);
    return isArray(value) ? value : [];
  };

  Renderer.prototype.toastRender = function (rec) {
    var self = this;
    var items = this.toastItems(rec.block);
    while (rec.root.firstChild) rec.root.removeChild(rec.root.firstChild);
    rec.root.hidden = items.length === 0;
    for (var i = 0; i < items.length; i++) {
      (function (item) {
        if (!isObject(item)) return;
        var level = String(item.level || "info");
        var toast = el("div", {class: "pui-toast is-" + level, role: level === "error" ? "alert" : "status"});
        toast.appendChild(el("span", {class: "pui-toast-text", text: String(item.text || item.label || "")}));
        var dismiss = isObject(rec.block.dismiss) ? rec.block.dismiss : null;
        if (dismiss) {
          var close = el("button", {type: "button", class: "pui-toast-close", "aria-label": "Dismiss notification", text: "×"});
          close.addEventListener("click", function () {
            var action = Object.assign({}, dismiss, {
              args: Object.assign({}, isObject(dismiss.args) ? dismiss.args : {}, {id: item.id, notice: item})
            });
            self.performAction(action, close, {id: item.id, notice: item});
          });
          toast.appendChild(close);
        }
        rec.root.appendChild(toast);
      })(items[i]);
    }
  };

  Renderer.prototype.buildToast = function (block) {
    var placement = String(block.placement || "bottom-end");
    var root = el("div", {class: "pui-toast-region", "data-placement": placement, "aria-live": "polite", "aria-atomic": "false"});
    var rec = {root: root, block: block,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true};
    this.toastRecords.push(rec);
    this.toastRender(rec);
    this.shellCondition(block, root);
    return root;
  };

  /* ---------------------------------------------------------------- form */

  Renderer.prototype.formFields = function (block) {
    return isArray(block.fields) ? block.fields.filter(function (field) { return isObject(field); }) : [];
  };

  Renderer.prototype.formValue = function (field) {
    var path = String(field.bind || "");
    if (!path) return undefined;
    return typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, field)
      : this.adapter.getValue(path);
  };

  Renderer.prototype.formValues = function (block) {
    var out = {};
    var fields = this.formFields(block);
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field.bind) continue;
      var value = this.formValue(field);
      if (value !== undefined) out[String(field.bind)] = value;
    }
    return out;
  };

  Renderer.prototype.formValidate = function (rec) {
    var fields = this.formFields(rec.block);
    var first = null;
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (!field.bind || !(field.required || (isObject(field.a11y) && field.a11y.required))) continue;
      var value = this.formValue(field);
      var empty = value === undefined || value === null || value === "" || (isArray(value) && value.length === 0);
      if (empty) {
        var control = null;
        for (var r = 0; r < this.records.length; r++) {
          if (this.records[r].path === String(field.bind)) control = this.records[r].control;
        }
        if (control) {
          control.setAttribute("aria-invalid", "true");
          if (!first) first = control;
        }
        if (!rec.firstInvalid) rec.firstInvalid = control;
      } else {
        for (var r2 = 0; r2 < this.records.length; r2++) {
          if (this.records[r2].path === String(field.bind) && this.records[r2].control) {
            this.records[r2].control.removeAttribute("aria-invalid");
          }
        }
      }
    }
    if (first) {
      if (typeof first.focus === "function") first.focus();
      this.adapter.announce("error", "Please complete the required fields.");
      rec.status.textContent = "Please complete the required fields.";
      rec.status.className = "pui-form-status is-error";
      return false;
    }
    rec.status.textContent = "";
    rec.status.className = "pui-form-status";
    return true;
  };

  Renderer.prototype.formSubmit = function (rec, item, button) {
    if (!this.formValidate(rec)) return false;
    var values = this.formValues(rec.block);
    var payload = Object.assign({}, item, {
      args: Object.assign({}, isObject(item.args) ? item.args : {}, {values: values})
    });
    rec.status.textContent = item.pending ? String(item.pending) : "Submitting…";
    rec.status.className = "pui-form-status is-busy";
    var result;
    try {
      result = this.performAction(payload, button, {values: values});
    } catch (error) {
      rec.status.textContent = String(error && error.message || error);
      rec.status.className = "pui-form-status is-error";
      return false;
    }
    var finish = function (ok, detail) {
      rec.status.textContent = ok ? String(item.result || "Saved.") : String(detail || "Could not save.");
      rec.status.className = "pui-form-status " + (ok ? "is-ok" : "is-error");
    };
    if (result && typeof result.then === "function") {
      result.then(function (ok) { finish(ok !== false); }, function (error) { finish(false, String(error && error.message || error)); });
    } else {
      finish(result !== false);
    }
    return result;
  };

  Renderer.prototype.buildForm = function (block) {
    var self = this;
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("form", {class: "pui-form", "data-pui-form": String(block.id || block.bind || ""), role: String(a11y.role || "form")});
    if (a11y.name) root.setAttribute("aria-label", String(a11y.name));
    if (block.label) root.appendChild(el("h4", {class: "pui-form-title", text: String(block.label)}));
    if (block.help) root.appendChild(el("p", {class: "pui-help", text: String(block.help)}));
    var fields = el("div", {class: "pui-form-fields"});
    var columns = Math.max(1, Math.min(4, Number(block.columns) || 1));
    fields.style.setProperty("--pui-form-columns", String(columns));
    var formFields = this.formFields(block);
    for (var i = 0; i < formFields.length; i++) fields.appendChild(this.buildBlock(formFields[i], {section: {id: String(block.id || "form")}}));
    root.appendChild(fields);
    var status = el("p", {class: "pui-form-status", "aria-live": "polite"});
    root.appendChild(status);
    var bar = el("div", {class: "pui-form-actions"});
    var submit = isObject(block.submit) ? block.submit : null;
    var cancel = isObject(block.cancel) ? block.cancel : null;
    var submitButton = null;
    if (submit) {
      submitButton = el("button", {type: "submit", class: "pui-button pui-primary", text: String(submit.label || "Save")});
      submitButton.addEventListener("click", function (event) {
        event.preventDefault();
        self.formSubmit(rec, submit, submitButton);
      });
      bar.appendChild(submitButton);
    }
    if (cancel) {
      var cancelButton = el("button", {type: "button", class: "pui-button", text: String(cancel.label || "Cancel")});
      cancelButton.addEventListener("click", function () { self.performAction(cancel, cancelButton, {values: self.formValues(block)}); });
      bar.appendChild(cancelButton);
    }
    if (bar.childNodes.length) root.appendChild(bar);
    root.addEventListener("submit", function (event) {
      event.preventDefault();
      if (submitButton) submitButton.click();
    });
    var rec = {
      root: root, block: block, fields: formFields, status: status,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true, firstInvalid: null
    };
    this.formRecords.push(rec);
    return root;
  };

  /* --------------------------------------------------------------- table */

  Renderer.prototype.tableRows = function (block) {
    if (typeof this.adapter.getCollection === "function") {
      var direct = this.adapter.getCollection(String(block.bind || ""), block);
      if (isArray(direct)) return direct;
    }
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(String(block.bind || ""), block)
      : this.adapter.getValue(String(block.bind || ""));
    return isArray(value) ? value : [];
  };

  Renderer.prototype.tableKey = function (block, item, index) {
    var keyField = String(block.row_key || "id");
    if (isObject(item) && item[keyField] !== undefined) return item[keyField];
    return index;
  };

  Renderer.prototype.tableCell = function (row, column) {
    var key = String(column.key || "");
    var value = row;
    if (key) {
      var parts = key.split(".");
      for (var i = 0; i < parts.length; i++) {
        if (value == null || typeof value !== "object") { value = undefined; break; }
        value = value[parts[i]];
      }
    }
    if (typeof column.format === "function") return column.format(value, row);
    if (value === undefined || value === null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  Renderer.prototype.tableSelection = function (block) {
    var path = String(block.selection_bind || "");
    if (!path) return [];
    var raw = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, block)
      : this.adapter.getValue(path);
    if (isArray(raw)) return raw.map(String);
    if (isObject(raw) && isArray(raw.ids)) return raw.ids.map(String);
    if (raw === undefined || raw === null || raw === "") return [];
    return [String(raw)];
  };

  Renderer.prototype.tableFilterText = function (rec) {
    var block = rec.block;
    var path = String(block.filter_bind || "");
    if (path) {
      var raw = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(path, block)
        : this.adapter.getValue(path);
      if (raw !== undefined && raw !== null) return String(raw);
    }
    if (rec.filterText !== undefined) return String(rec.filterText);
    return String(block.filter_text || "");
  };

  Renderer.prototype.tableSortState = function (rec) {
    var block = rec.block;
    var path = String(block.sort_bind || "");
    var raw = null;
    if (path) {
      raw = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(path, block)
        : this.adapter.getValue(path);
    }
    if (!isObject(raw)) raw = isObject(rec.sort) ? rec.sort : block.sort;
    if (!isObject(raw) || !raw.key) return {key: "", dir: "asc"};
    var dir = String(raw.dir || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    return {key: String(raw.key), dir: dir};
  };

  Renderer.prototype.tableFilterMatch = function (row, columns, query) {
    if (!query) return true;
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    var haystack = "";
    for (var i = 0; i < columns.length; i++) {
      var column = columns[i];
      if (!isObject(column) || column.filterable === false) continue;
      haystack += " " + this.tableCell(row, column);
    }
    haystack = haystack.toLowerCase();
    for (var t = 0; t < terms.length; t++) {
      if (haystack.indexOf(terms[t]) < 0) return false;
    }
    return true;
  };

  Renderer.prototype.tableView = function (rec) {
    var block = rec.block;
    var rows = this.tableRows(block);
    var columns = isArray(block.columns) ? block.columns.filter(isObject) : [];
    var query = block.filterable ? this.tableFilterText(rec).trim() : "";
    if (query) rows = rows.filter(function (row) { return this.tableFilterMatch(row, columns, query); }, this);
    var sort = this.tableSortState(rec);
    if (sort.key) {
      var direction = sort.dir === "desc" ? -1 : 1;
      rows = rows.map(function (row, index) { return {row: row, index: index}; });
      rows.sort(function (a, b) {
        var av = this.tableCell(a.row, {key: sort.key});
        var bv = this.tableCell(b.row, {key: sort.key});
        var an = av === "" ? null : Number(av);
        var bn = bv === "" ? null : Number(bv);
        var cmp = 0;
        if (av !== "" && bv !== "" && !isNaN(an) && !isNaN(bn)) cmp = an - bn;
        else cmp = String(av).localeCompare(String(bv), undefined, {numeric: true, sensitivity: "base"});
        if (cmp === 0) cmp = a.index - b.index;
        return cmp * direction;
      }.bind(this));
      rows = rows.map(function (entry) { return entry.row; });
    }
    return rows;
  };

  Renderer.prototype.tableSort = function (rec, key) {
    var state = this.tableSortState(rec);
    var next = {key: String(key), dir: state.key === String(key) && state.dir === "asc" ? "desc" : "asc"};
    if (rec.block.sort_bind) this.setPath(String(rec.block.sort_bind), next, rec.block);
    else rec.sort = next;
    rec.resetScroll = true;
    this.tableRebuild(rec);
  };

  Renderer.prototype.tableWriteSelection = function (rec, keys) {
    var path = String(rec.block.selection_bind || "");
    if (!path) return;
    var current = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, rec.block)
      : this.adapter.getValue(path);
    var value = keys;
    if (isObject(current) && !isArray(current)) {
      value = deepClone(current);
      value.ids = keys;
    }
    this.setPath(path, value, rec.block);
    rec.selected = keys;
    this.apply();
  };

  Renderer.prototype.tableToggle = function (rec, key, additive, range) {
    var selected = rec.selected.slice();
    var index = selected.indexOf(String(key));
    var rowIndex = rec.keys.indexOf(String(key));
    if (rec.block.multi === false) {
      selected = index >= 0 && !additive ? [] : [String(key)];
    } else if (range && rec.anchorIndex !== null && rec.anchorIndex !== undefined && rowIndex >= 0) {
      var from = Math.min(rec.anchorIndex, rowIndex);
      var to = Math.max(rec.anchorIndex, rowIndex);
      selected = rec.keys.slice(from, to + 1);
    } else if (additive) {
      if (index >= 0) selected.splice(index, 1);
      else selected.push(String(key));
    } else {
      selected = [String(key)];
    }
    if (rowIndex >= 0 && !range) rec.anchorIndex = rowIndex;
    // Visible rows follow the current view order; hidden selections stay put.
    selected.sort(function (a, b) {
      var ai = rec.keys.indexOf(a), bi = rec.keys.indexOf(b);
      if (ai < 0 && bi < 0) return 0;
      if (ai < 0) return -1;
      if (bi < 0) return 1;
      return ai - bi;
    });
    this.tableWriteSelection(rec, selected);
  };

  Renderer.prototype.tableActionItems = function (rec) {
    return (isArray(rec.block.actions) ? rec.block.actions : []).map(function (item) {
      var copy = Object.assign({}, item);
      copy.args = Object.assign({}, item.args || {}, {
        bind: String(rec.block.bind || ""),
        selected: rec.selected.slice(),
        item: rec.selected.length === 1 ? rec.selected[0] : undefined
      });
      return copy;
    });
  };

  Renderer.prototype.tableSelectedVisible = function (rec) {
    var selected = {};
    rec.selected.forEach(function (key) { selected[String(key)] = true; });
    return rec.keys.filter(function (key) { return selected[key]; });
  };

  Renderer.prototype.tableUpdateHead = function (rec) {
    var state = this.tableSortState(rec);
    var visible = this.tableSelectedVisible(rec);
    for (var i = 0; i < (rec.headerCells || []).length; i++) {
      var cell = rec.headerCells[i];
      if (cell.th) {
        if (cell.sortable) {
          if (state.key === cell.key) cell.th.setAttribute("aria-sort", state.dir === "desc" ? "descending" : "ascending");
          else cell.th.setAttribute("aria-sort", "none");
        }
        if (cell.indicator) {
          cell.indicator.textContent = state.key === cell.key ? (state.dir === "desc" ? "▼" : "▲") : "";
          cell.indicator.hidden = state.key !== cell.key;
        }
      }
    }
    if (rec.selectAll) {
      rec.selectAll.checked = visible.length > 0 && visible.length === rec.keys.length;
      rec.selectAll.indeterminate = visible.length > 0 && visible.length < rec.keys.length;
      rec.selectAll.setAttribute("aria-label", rec.keys.length ? "Select all visible rows" : "Select all rows");
    }
    if (rec.count) {
      rec.count.textContent = rec.keys.length === rec.totalRows ? rec.totalRows + " rows" : rec.keys.length + " of " + rec.totalRows + " rows";
    }
    if (rec.table) {
      rec.table.setAttribute("aria-rowcount", String(rec.keys.length + 1));
      rec.table.setAttribute("aria-colcount", String((rec.headerCells || []).length + (rec.block.multi !== false ? 1 : 0)));
    }
  };

  Renderer.prototype.tableRowEmpty = function (rec) {
    var block = rec.block;
    var columns = isArray(block.columns) ? block.columns : [];
    var colspan = Math.max(1, columns.length + (block.multi !== false ? 1 : 0));
    var row = el("tr", {}, el("td", {colspan: colspan, class: "pui-table-empty-cell"}));
    if (rec.totalRows === 0 && isObject(block.empty)) row.firstChild.appendChild(this.buildBlock(block.empty));
    else row.firstChild.textContent = String(rec.totalRows === 0 ? (block.empty_text || "No rows.") : (block.empty_filter_text || "No matching rows."));
    return row;
  };

  Renderer.prototype.tableRowValue = function (row, key) {
    var value = row;
    var parts = String(key || "").split(".");
    for (var i = 0; i < parts.length; i++) {
      if (value == null || typeof value !== "object") return undefined;
      value = value[parts[i]];
    }
    return value;
  };

  Renderer.prototype.tableEditSpec = function (column) {
    if (!column.edit) return null;
    var spec = isObject(column.edit) ? column.edit : {type: String(column.edit)};
    var type = String(spec.type || "text").toLowerCase();
    if (type === "true") type = "text";
    if (["text", "number", "select"].indexOf(type) < 0) type = "text";
    return {
      type: type,
      bind: String(spec.bind || column.bind || ""),
      options: isArray(spec.options) ? spec.options : (isArray(column.options) ? column.options : []),
      options_bind: spec.options_bind || column.options_bind,
      required: !!(spec.required || column.required),
      min: spec.min !== undefined ? spec.min : column.min,
      max: spec.max !== undefined ? spec.max : column.max,
      step: spec.step !== undefined ? spec.step : column.step,
      placeholder: spec.placeholder !== undefined ? spec.placeholder : column.placeholder,
      value_type: spec.value_type || column.value_type
    };
  };

  Renderer.prototype.tableEditPath = function (rec, key, column) {
    var spec = this.tableEditSpec(column);
    var raw = spec && spec.bind ? spec.bind : String(column.bind || "");
    raw = raw.replace(/\{key\}|\{row\}/g, String(key));
    if (!raw) raw = String(column.key || "");
    if (raw.charAt(0) === "/") return raw;
    var base = String(rec.block.bind || "");
    return base.replace(/\/$/, "") + "/" + String(key) + "/" + raw.replace(/^\./, "");
  };

  Renderer.prototype.tableEditOptions = function (rec, column) {
    var spec = this.tableEditSpec(column);
    var list = spec && spec.options ? spec.options : [];
    if (spec && spec.options_bind) {
      var bound = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(String(spec.options_bind), rec.block)
        : this.adapter.getValue(String(spec.options_bind));
      if (isArray(bound)) list = bound;
    }
    return list.map(function (entry) {
      if (isObject(entry)) return {value: entry.value === undefined ? entry.label : entry.value, label: String(entry.label === undefined ? entry.value : entry.label)};
      return {value: entry, label: String(entry)};
    });
  };

  Renderer.prototype.tableEditValue = function (rec, key, row, column) {
    var path = this.tableEditPath(rec, key, column);
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, rec.block)
      : this.adapter.getValue(path);
    if (value === undefined || value === null) value = this.tableRowValue(row, String(column.key || ""));
    return value;
  };

  Renderer.prototype.tableEditError = function (rec, message) {
    if (!rec.editing) return;
    var input = rec.editing.input;
    input.setAttribute("aria-invalid", "true");
    if (!rec.editing.errorEl) {
      var errorId = this.id("table-edit-error");
      rec.editing.errorEl = el("span", {id: errorId, class: "pui-table-edit-error", role: "alert"});
      input.setAttribute("aria-describedby", errorId);
      rec.editing.td.appendChild(rec.editing.errorEl);
    }
    rec.editing.errorEl.textContent = String(message);
    if (input.focus) input.focus();
    this.adapter.announce("error", String(message));
  };

  Renderer.prototype.tableStartEdit = function (rec, key, column, td, trigger) {
    var self = this;
    var spec = this.tableEditSpec(column);
    if (!spec) return;
    if (rec.editing) this.tableCommitEdit(rec);
    var entry = null;
    for (var i = 0; i < rec.rowEls.length; i++) if (rec.rowEls[i].key === key) entry = rec.rowEls[i];
    if (!entry) return;
    var value = this.tableEditValue(rec, key, entry.row, column);
    var input;
    if (spec.type === "select") {
      input = el("select", {class: "pui-table-edit-input", "aria-label": "Edit " + String(column.label || column.key || "") + " for " + key});
      var options = this.tableEditOptions(rec, column);
      var found = false;
      options.forEach(function (option) {
        var opt = el("option", {value: String(option.value), text: option.label});
        if (String(option.value) === String(value)) { opt.selected = true; found = true; }
        input.appendChild(opt);
      });
      if (!found && value !== undefined && value !== null) {
        input.appendChild(el("option", {value: String(value), text: String(value)}));
      }
      input.value = String(value === undefined || value === null ? "" : value);
    } else {
      input = el("input", {
        type: spec.type === "number" ? "number" : "text",
        class: "pui-table-edit-input",
        "aria-label": "Edit " + String(column.label || column.key || "") + " for " + key,
        placeholder: String(spec.placeholder || "")
      });
      if (spec.min !== undefined) input.min = String(spec.min);
      if (spec.max !== undefined) input.max = String(spec.max);
      if (spec.step !== undefined) input.step = String(spec.step);
      input.value = value === undefined || value === null ? "" : String(value);
    }
    while (td.firstChild) td.removeChild(td.firstChild);
    td.appendChild(input);
    rec.editing = {rec: rec, key: key, column: column, td: td, input: input, trigger: trigger, entry: entry};
    input.addEventListener("click", function (event) { event.stopPropagation(); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); self.tableCommitEdit(rec); }
      else if (event.key === "Escape") { event.preventDefault(); self.tableCancelEdit(rec); }
      else if (event.key === "Tab") { self.tableCommitEdit(rec); }
    });
    input.addEventListener("blur", function () {
      if (rec.editing && rec.editing.input === input) self.tableCommitEdit(rec);
    });
    if (input.focus) input.focus();
    if (input.select) input.select();
  };

  Renderer.prototype.tableParseEdit = function (rec, value) {
    var spec = this.tableEditSpec(rec.editing.column);
    var original = this.tableEditValue(rec, rec.editing.key, rec.editing.entry.row, rec.editing.column);
    var text = String(value);
    if (spec.required && text.trim() === "") return {error: "This cell is required."};
    if (spec.type === "number" || spec.value_type === "number" || (spec.value_type !== "string" && typeof original === "number")) {
      if (text.trim() === "") return {value: null};
      var number = Number(text);
      if (isNaN(number)) return {error: "Enter a number."};
      return {value: number};
    }
    if (spec.value_type === "boolean") return {value: text === "true" || text === "1" || text === "on"};
    return {value: text};
  };

  Renderer.prototype.tableValidateEdit = function (rec, path, value, column) {
    if (typeof this.adapter.validateValue !== "function") return null;
    var result = this.adapter.validateValue(path, value, column, rec.block);
    if (result === false) return "This value is not valid.";
    if (typeof result === "string" && result) return result;
    if (isObject(result) && result.ok === false) return String(result.message || "This value is not valid.");
    return null;
  };

  Renderer.prototype.tableCommitEdit = function (rec) {
    var editing = rec.editing;
    if (!editing || rec.committingEdit) return false;
    rec.committingEdit = true;
    var parsed = this.tableParseEdit(rec, editing.input.value);
    if (parsed.error) {
      rec.committingEdit = false;
      this.tableEditError(rec, parsed.error);
      return false;
    }
    var path = this.tableEditPath(rec, editing.key, editing.column);
    var invalid = this.tableValidateEdit(rec, path, parsed.value, editing.column);
    if (invalid) {
      rec.committingEdit = false;
      this.tableEditError(rec, invalid);
      return false;
    }
    var ok = this.setPath(path, parsed.value, rec.block);
    if (!ok) {
      rec.committingEdit = false;
      this.tableEditError(rec, "The host rejected this value.");
      return false;
    }
    var key = editing.key;
    var columnKey = String(editing.column.key || "");
    rec.editing = null;
    rec.committingEdit = false;
    if (editing.trigger) {
      while (editing.td.firstChild) editing.td.removeChild(editing.td.firstChild);
      editing.trigger.textContent = this.tableCell(editing.entry.row, editing.column);
      editing.td.appendChild(editing.trigger);
    }
    this.apply();
    this.tableFocusCell(rec, key, columnKey);
    return true;
  };

  Renderer.prototype.tableCancelEdit = function (rec) {
    if (!rec.editing) return;
    var key = rec.editing.key;
    var columnKey = String(rec.editing.column.key || "");
    rec.editing = null;
    rec.committingEdit = false;
    this.tableRenderBody(rec);
    this.tableFocusCell(rec, key, columnKey, true);
  };

  Renderer.prototype.tableFocusCell = function (rec, key, columnKey, trigger) {
    for (var i = 0; i < rec.rowEls.length; i++) {
      var entry = rec.rowEls[i];
      if (entry.key !== key) continue;
      var cell = null;
      for (var c = 0; c < entry.cells.length; c++) {
        if (String(entry.cells[c].column.key || "") === String(columnKey)) cell = entry.cells[c];
      }
      if (trigger && cell && cell.button) { cell.button.focus(); return; }
      if (cell && cell.button) { cell.button.focus(); return; }
      entry.el.focus();
      return;
    }
  };

  Renderer.prototype.tableRenderBody = function (rec) {
    var self = this;
    var block = rec.block;
    var columns = isArray(block.columns) ? block.columns.filter(isObject) : [];
    while (rec.body.firstChild) rec.body.removeChild(rec.body.firstChild);
    rec.rowEls = [];
    rec.checks = [];
    var total = rec.keys.length;
    if (!columns.length) {
      rec.body.appendChild(el("tr", {}, el("td", {colspan: 1}, el("p", {class: "pui-table-empty", text: "Table has no columns."}))));
      this.tableUpdateHead(rec);
      return;
    }
    if (!total) {
      rec.body.appendChild(this.tableRowEmpty(rec));
      this.tableUpdateHead(rec);
      return;
    }
    var start = 0;
    var end = total;
    var virtual = !!block.virtual;
    var rowHeight = Math.max(18, Number(block.row_height) || 32);
    var viewportHeight = Math.max(1, Number(block.height) || 320);
    if (rec.focusIndex >= total) rec.focusIndex = Math.max(0, total - 1);
    if (virtual && rec.viewport) {
      var scrollTop = Number(rec.viewport.scrollTop) || 0;
      start = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
      end = Math.min(total, start + Math.ceil(viewportHeight / rowHeight) + 5);
      if (rec.focusIndex < start || rec.focusIndex >= end) rec.focusIndex = start;
    }
    if (virtual && start > 0) {
      var top = el("tr", {class: "pui-table-spacer", "aria-hidden": "true"}, el("td", {colspan: columns.length + (block.multi !== false ? 1 : 0)}));
      top.firstChild.style.height = String(start * rowHeight) + "px";
      rec.body.appendChild(top);
    }
    for (var index = start; index < end; index++) {
      (function (row, index) {
        var key = rec.keys[index];
        var tr = el("tr", {class: "pui-table-row", "data-pui-row": key, tabindex: String(index === (rec.focusIndex || 0) ? 0 : -1), role: "row", "aria-keyshortcuts": "F2"});
        tr.setAttribute("aria-selected", rec.selected.indexOf(key) >= 0 ? "true" : "false");
        if (virtual) tr.setAttribute("aria-rowindex", String(index + 2));
        if (rec.selected.indexOf(key) >= 0) tr.classList.add("is-selected");
        var check = null;
        if (block.multi !== false) {
          check = el("input", {type: "checkbox", "aria-label": "Select " + key, tabindex: String(index === (rec.focusIndex || 0) ? 0 : -1)});
          check.checked = rec.selected.indexOf(key) >= 0;
          check.addEventListener("click", function (event) {
            event.stopPropagation();
            self.tableToggle(rec, key, true);
          });
          tr.appendChild(el("td", {class: "pui-table-select"}, check));
          rec.checks.push(check);
        }
        var cells = [];
        columns.forEach(function (column) {
          var td = el("td", {class: column.cell ? "pui-table-" + String(column.cell) : ""});
          var text = self.tableCell(row, column);
          var editSpec = self.tableEditSpec(column);
          if (editSpec) {
            td.classList.add("pui-table-editable");
            var editButton = el("button", {type: "button", class: "pui-table-cell-edit", "data-pui-column": String(column.key || ""), text: text});
            editButton.tabIndex = -1;
            editButton.title = "Edit " + String(column.label || column.key || "") + " for " + key;
            editButton.setAttribute("aria-label", "Edit " + String(column.label || column.key || "") + " for " + key);
            editButton.addEventListener("click", function (event) {
              event.stopPropagation();
              self.tableStartEdit(rec, key, column, td, editButton);
            });
            td.appendChild(editButton);
            cells.push({node: td, column: column, button: editButton});
          } else {
            td.textContent = text;
            cells.push({node: td, column: column});
          }
          tr.appendChild(td);
        });
        tr.addEventListener("click", function (event) {
          if (event.target && event.target.tagName === "INPUT") return;
          self.tableToggle(rec, key, !!(event.metaKey || event.ctrlKey), !!event.shiftKey);
        });
        tr.addEventListener("keydown", function (event) {
          if (event.key === "F2") {
            var firstEdit = tr.querySelector(".pui-table-cell-edit");
            if (firstEdit) { event.preventDefault(); firstEdit.click(); }
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            self.tableToggle(rec, key, !!(event.metaKey || event.ctrlKey), !!event.shiftKey);
          }
        });
        tr.addEventListener("focus", function () { rec.focusIndex = index; });
        rec.rowEls.push({key: key, row: row, el: tr, check: check, cells: cells, index: index});
        rec.body.appendChild(tr);
      })(rec.rows[index], index);
    }
    if (virtual && end < total) {
      var bottom = el("tr", {class: "pui-table-spacer", "aria-hidden": "true"}, el("td", {colspan: columns.length + (block.multi !== false ? 1 : 0)}));
      bottom.firstChild.style.height = String((total - end) * rowHeight) + "px";
      rec.body.appendChild(bottom);
    }
    this.tableUpdateHead(rec);
  };

  Renderer.prototype.tableFocusRow = function (rec) {
    if (!rec || !rec.keys.length) return;
    var index = Math.max(0, Math.min(rec.keys.length - 1, rec.focusIndex || 0));
    rec.focusIndex = index;
    if (rec.viewport && rec.block.virtual) {
      var rowHeight = Math.max(18, Number(rec.block.row_height) || 32);
      var top = index * rowHeight;
      var height = Math.max(1, Number(rec.block.height) || 320);
      if (top < rec.viewport.scrollTop) rec.viewport.scrollTop = top;
      else if (top + rowHeight > rec.viewport.scrollTop + height) rec.viewport.scrollTop = top + rowHeight - height;
      this.tableRenderBody(rec);
    }
    var target = null;
    for (var i = 0; i < rec.rowEls.length; i++) {
      rec.rowEls[i].el.tabIndex = rec.rowEls[i].index === index ? 0 : -1;
      if (rec.rowEls[i].check) rec.rowEls[i].check.tabIndex = rec.rowEls[i].index === index ? 0 : -1;
      if (rec.rowEls[i].index === index) target = rec.rowEls[i].el;
    }
    if (target && target.focus) target.focus();
  };

  Renderer.prototype.tableRefresh = function (rec) {
    var block = rec.block;
    var rows = this.tableView(rec);
    var keys = rows.map(function (row, index) { return String(this.tableKey(block, row, index)); }, this);
    var rowSignature;
    try { rowSignature = JSON.stringify(rows); } catch (error) { rowSignature = ""; }
    var viewChanged = keys.join("\u0001") !== rec.keys.join("\u0001");
    var sortOrFilter = !!this.tableSortState(rec).key || (!!block.filterable && !!this.tableFilterText(rec).trim());
    if (viewChanged || (rowSignature !== rec.rowSignature && sortOrFilter)) {
      rec.resetScroll = false;
      this.tableRebuild(rec);
      return;
    }
    rec.rowSignature = rowSignature;
    rec.rows = rows;
    rec.totalRows = this.tableRows(block).length;
    rec.selected = this.tableSelection(block);
    var filterText = this.tableFilterText(rec);
    if (rec.filterInput && rec.filterInput.value !== filterText) rec.filterInput.value = filterText;
    for (var i = 0; i < rec.rowEls.length; i++) {
      var entry = rec.rowEls[i];
      var selected = rec.selected.indexOf(entry.key) >= 0;
      entry.el.classList.toggle("is-selected", selected);
      entry.el.setAttribute("aria-selected", selected ? "true" : "false");
      if (entry.check && entry.check.checked !== selected) entry.check.checked = selected;
      for (var c = 0; c < entry.cells.length; c++) {
        var edit = rec.editing;
        if (edit && edit.key === entry.key && String(edit.column.key || "") === String(entry.cells[c].column.key || "")) continue;
        var cellText = this.tableCell(entry.row, entry.cells[c].column);
        if (entry.cells[c].button) entry.cells[c].button.textContent = cellText;
        else entry.cells[c].node.textContent = cellText;
      }
    }
    this.tableUpdateHead(rec);
    for (var a = 0; a < rec.actionItems.length; a++) {
      rec.actionItems[a].args = Object.assign({}, rec.actionItems[a].args, {
        selected: rec.selected.slice(),
        item: rec.selected.length === 1 ? rec.selected[0] : undefined
      });
    }
  };

  Renderer.prototype.tableRebuild = function (rec) {
    var self = this;
    rec.editing = null;
    rec.committingEdit = false;
    var block = rec.block;
    var rows = this.tableView(rec);
    var keys = rows.map(function (row, index) { return String(self.tableKey(block, row, index)); });
    var selected = this.tableSelection(block);
    rec.rows = rows;
    rec.keys = keys;
    rec.selected = selected;
    rec.totalRows = this.tableRows(block).length;
    try { rec.rowSignature = JSON.stringify(rows); } catch (error) { rec.rowSignature = ""; }
    if (rec.filterInput) rec.filterInput.value = this.tableFilterText(rec);
    rec.rowEls = [];
    rec.checks = [];
    rec.headerCells = [];
    rec.body.innerHTML = "";
    var columns = isArray(block.columns) ? block.columns : [];
    if (!columns.length) {
      rec.body.appendChild(el("tr", {}, el("td", {colspan: 1}, el("p", {class: "pui-table-empty", text: "Table has no columns."}))));
      this.tableUpdateHead(rec);
      return;
    }
    var headRow = rec.headRow;
    headRow.innerHTML = "";
    rec.selectAll = null;
    if (block.multi !== false) {
      var selectAll = el("input", {type: "checkbox", "aria-label": "Select all rows"});
      selectAll.checked = rows.length > 0 && selected.length === rows.length;
      selectAll.addEventListener("change", function () {
        // Select every visible row, preserving hidden selections.
        var next = rec.selected.filter(function (key) { return rec.keys.indexOf(String(key)) < 0; });
        if (selectAll.checked) next = next.concat(rec.keys);
        self.tableWriteSelection(rec, next);
      });
      rec.selectAll = selectAll;
      headRow.appendChild(el("th", {class: "pui-table-select"}, selectAll));
    }
    var sortState = this.tableSortState(rec);
    columns.forEach(function (column) {
      if (!isObject(column)) return;
      var key = String(column.key || "");
      var sortable = !!block.sortable ? column.sortable !== false : column.sortable === true;
      var th = el("th", {scope: "col"});
      if (column.width) th.style.width = String(column.width);
      if (sortable) {
        var button = el("button", {type: "button", class: "pui-table-sort", text: String(column.label || key || "")});
        var indicator = el("span", {class: "pui-table-sort-indicator", "aria-hidden": "true", text: sortState.key === key ? (sortState.dir === "desc" ? "▼" : "▲") : ""});
        if (sortState.key !== key) indicator.hidden = true;
        button.appendChild(indicator);
        button.addEventListener("click", function () { self.tableSort(rec, key); });
        th.appendChild(button);
        rec.headerCells.push({th: th, key: key, sortable: true, indicator: indicator});
      } else {
        th.textContent = String(column.label || key || "");
        rec.headerCells.push({th: th, key: key, sortable: false});
      }
      headRow.appendChild(th);
    });
    rec.actions.innerHTML = "";
    rec.actionItems = this.tableActionItems(rec);
    if (rec.actionItems.length) rec.actions.appendChild(this.buildActions(rec.actionItems, "table"));
    if (rec.resetScroll && rec.viewport) rec.viewport.scrollTop = 0;
    rec.resetScroll = false;
    this.tableRenderBody(rec);
  };

  Renderer.prototype.buildTable = function (block) {
    var self = this;
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var root = el("section", {class: "pui-table", "data-pui-table": String(block.bind || ""), role: String(a11y.role || "group")});
    if (a11y.name) root.setAttribute("aria-label", String(a11y.name));
    if (block.label) root.appendChild(el("h4", {class: "pui-table-title", text: String(block.label)}));
    if (block.help) root.appendChild(el("p", {class: "pui-help", text: String(block.help)}));
    var filterBar = null;
    var filterInput = null;
    var count = null;
    if (block.filterable) {
      filterBar = el("div", {class: "pui-table-toolbar"});
      var filterId = this.id("table-filter");
      filterInput = el("input", {type: "search", id: filterId, class: "pui-table-filter",
        placeholder: String(block.filter_placeholder || "Filter rows…"),
        "aria-label": String(block.filter_label || "Filter rows")});
      count = el("span", {class: "pui-table-count", role: "status", "aria-live": "polite"});
      filterBar.appendChild(filterInput);
      filterBar.appendChild(count);
      root.appendChild(filterBar);
    }
    var table = el("table", {class: "pui-table-grid"});
    var captionId = this.id("table-caption");
    if (block.label) {
      table.appendChild(el("caption", {id: captionId, class: "pui-sr-only", text: String(block.label)}));
      table.setAttribute("aria-labelledby", captionId);
    }
    var head = el("thead");
    var headRow = el("tr");
    head.appendChild(headRow);
    table.appendChild(head);
    var body = el("tbody");
    table.appendChild(body);
    var viewport = el("div", {class: "pui-table-viewport"});
    if (block.virtual) {
      viewport.style.maxHeight = String(Number(block.height) || 320) + "px";
      viewport.tabIndex = 0;
    }
    viewport.appendChild(table);
    var actions = el("div", {class: "pui-table-actions"});
    root.appendChild(viewport);
    root.appendChild(actions);
    var rec = {
      root: root, block: block, table: table, headRow: headRow, body: body, actions: actions,
      viewport: viewport, filterInput: filterInput, count: count,
      rows: [], keys: [], selected: [], rowEls: [], checks: [], actionItems: [], headerCells: [],
      filterText: block.filter_text, sort: block.sort, totalRows: 0, resetScroll: true,
      focusIndex: 0, anchorIndex: null,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true
    };
    if (filterInput) {
      filterInput.value = this.tableFilterText(rec);
      filterInput.addEventListener("input", function () {
        var value = filterInput.value;
        if (block.filter_bind) self.setPath(String(block.filter_bind), value, block);
        else rec.filterText = value;
        rec.resetScroll = true;
        self.tableRebuild(rec);
      });
    }
    viewport.addEventListener("scroll", function () {
      if (!block.virtual) return;
      if (rec.editing) self.tableCancelEdit(rec);
      else self.tableRenderBody(rec);
    });
    table.addEventListener("keydown", function (event) {
      var key = String(event.key || "");
      if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].indexOf(key) < 0) return;
      if (!rec.keys.length) return;
      event.preventDefault();
      var current = rec.focusIndex || 0;
      var page = Math.max(1, Math.floor(Number(block.height) || 320) / Math.max(18, Number(block.row_height) || 32) - 1);
      if (key === "Home") rec.focusIndex = 0;
      else if (key === "End") rec.focusIndex = rec.keys.length - 1;
      else if (key === "PageDown") rec.focusIndex = Math.min(rec.keys.length - 1, current + page);
      else if (key === "PageUp") rec.focusIndex = Math.max(0, current - page);
      else rec.focusIndex = Math.max(0, Math.min(rec.keys.length - 1, current + (key === "ArrowDown" ? 1 : -1)));
      self.tableFocusRow(rec);
    });
    this.tableRecords.push(rec);
    this.tableRebuild(rec);
    return rec.root;
  };

  Renderer.prototype.collectionItems = function (block) {
    if (typeof this.adapter.getCollection === "function") {
      var direct = this.adapter.getCollection(String(block.bind || ""), block);
      if (isArray(direct)) return direct;
    }
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(String(block.bind || ""), block)
      : this.adapter.getValue(String(block.bind || ""));
    return isArray(value) ? value : [];
  };

  Renderer.prototype.collectionKey = function (block, item, index) {
    var keyField = String(block.item_key || "id");
    if (isObject(item) && item[keyField] !== undefined) return item[keyField];
    return index;
  };

  Renderer.prototype.collectionPath = function (block, key, rawBind) {
    var raw = String(rawBind || "");
    if (typeof this.adapter.resolveCollectionPath === "function") {
      return this.adapter.resolveCollectionPath(String(block.bind || ""), key, raw, block);
    }
    if (raw.indexOf("{item}") >= 0) return raw.replace(/\{item\}/g, String(key));
    if (raw.charAt(0) === "/") return raw;
    return String(block.bind || "") + "/" + String(key) + "/" + raw.replace(/^\./, "");
  };

  Renderer.prototype.collectionLabel = function (item, key, block) {
    if (!isObject(item)) return String(item);
    var keyName = String(block && (block.rename_key || block.label_key) || "");
    return String(item[keyName] || item.label || item.name || item.title || key);
  };

  Renderer.prototype.collectionSelection = function (block) {
    var path = String(block.selected || "");
    if (!path) return [];
    var raw = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, block)
      : this.adapter.getValue(path);
    if (isArray(raw)) return raw.map(String);
    if (isObject(raw) && isArray(raw.ids)) return raw.ids.map(String);
    if (raw === undefined || raw === null || raw === "") return [];
    return [String(raw)];
  };

  Renderer.prototype.collectionWriteSelection = function (rec, keys) {
    var block = rec.block;
    var path = String(block.selected || "");
    rec.selectedKeys = keys.slice();
    if (!path) return;
    var current = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, block)
      : this.adapter.getValue(path);
    var value;
    if (block.multi === true) {
      value = keys.slice();
      if (isObject(current) && !isArray(current)) {
        value = deepClone(current);
        value.ids = keys.slice();
      }
    } else {
      value = keys.length ? keys[0] : null;
    }
    this.setPath(path, value, block);
  };

  Renderer.prototype.collectionRefresh = function (rec, focus) {
    var self = this;
    var selected = {};
    rec.selectedKeys.forEach(function (key) { selected[String(key)] = true; });
    for (var i = 0; i < rec.options.length; i++) {
      var on = !!selected[String(rec.optionKeys[i])];
      rec.options[i].setAttribute("aria-selected", on ? "true" : "false");
      rec.options[i].classList.toggle("is-selected", on);
    }
    if (rec.actions) {
      rec.actions.textContent = "";
      rec.actionItems = (isArray(rec.block.actions) ? rec.block.actions : []).map(function (item) {
        var copy = Object.assign({}, item);
        copy.collection_bind = String(rec.block.bind || "");
        copy.collection_selected = String(rec.block.selected || "");
        copy.collection_items = rec.selectedKeys.slice();
        copy.collection_item = rec.selectedKeys.length === 1 ? rec.selectedKeys[0] : undefined;
        return copy;
      });
      if (rec.actionItems.length) rec.actions.appendChild(this.buildActions(rec.actionItems, "collection"));
    }
    if (rec.itemPanel) {
      rec.itemPanel.textContent = "";
      var selectedItem = null;
      for (var s = 0; s < rec.items.length; s++) {
        if (String(this.collectionKey(rec.block, rec.items[s], s)) === String(rec.selectedKeys[0])) selectedItem = rec.items[s];
      }
      if (selectedItem) this.collectionBuildItem(rec, selectedItem, rec.itemPanel);
    }
    this.collectionFocus(rec, focus);
  };

  Renderer.prototype.collectionBuildItem = function (rec, item, panel) {
    var template = rec.block.item && isArray(rec.block.item.template) ? rec.block.item.template : (isArray(rec.block.template) ? rec.block.template : []);
    var key = this.collectionKey(rec.block, item, rec.items.indexOf(item));
    var context = {bind: String(rec.block.bind || ""), key: key, item: item, items: rec.items, block: rec.block};
    for (var t = 0; t < template.length; t++) {
      var copy = Object.assign({}, template[t]);
      var rawBind = String(copy.bind || "");
      if (copy.bind) copy.bind = this.collectionPath(rec.block, key, copy.bind);
      copy.__pui_raw_bind = rawBind;
      panel.appendChild(this.buildBlock(copy, context));
    }
  };

  Renderer.prototype.collectionFocus = function (rec, force) {
    if (!rec.list || !rec.list.focus) return;
    if (rec.activeIndex < 0) rec.activeIndex = rec.options.length ? 0 : -1;
    rec.options.forEach(function (option, index) {
      option.classList.toggle("is-active", index === rec.activeIndex);
      option.tabIndex = -1;
    });
    if (rec.activeIndex >= 0 && rec.options[rec.activeIndex]) {
      rec.list.setAttribute("aria-activedescendant", rec.options[rec.activeIndex].id);
      if (force || (typeof document !== "undefined" && document.activeElement === rec.list)) rec.list.focus();
    } else {
      rec.list.removeAttribute("aria-activedescendant");
    }
  };

  Renderer.prototype.collectionSelect = function (rec, index, event) {
    if (index < 0 || index >= rec.options.length) return;
    var key = String(rec.optionKeys[index]);
    var keys = rec.selectedKeys.slice();
    var additive = !!(event && (event.ctrlKey || event.metaKey));
    var range = !!(event && event.shiftKey);
    if (rec.block.multi === true) {
      if (range && rec.anchorIndex !== null) {
        var from = Math.min(rec.anchorIndex, index), to = Math.max(rec.anchorIndex, index);
        keys = [];
        for (var i = from; i <= to; i++) keys.push(String(rec.optionKeys[i]));
      } else if (additive) {
        var at = keys.indexOf(key);
        if (at >= 0) keys.splice(at, 1); else keys.push(key);
      } else {
        keys = [key];
      }
    } else {
      keys = [key];
    }
    rec.anchorIndex = index;
    rec.activeIndex = index;
    this.collectionWriteSelection(rec, keys);
    this.collectionRefresh(rec, true);
  };

  Renderer.prototype.collectionRename = function (rec, index) {
    var self = this;
    if (!rec.block.rename || index < 0 || index >= rec.options.length || rec.editing) return;
    var option = rec.options[index];
    var key = String(rec.optionKeys[index]);
    var item = rec.items[index];
    var labelEl = rec.optionLabels[index];
    if (!option || !labelEl) return;
    var previous = this.collectionLabel(item, key, rec.block);
    var input = el("input", {type: "text", class: "pui-collection-rename", value: previous, "aria-label": "Rename " + previous});
    labelEl.hidden = true;
    option.appendChild(input);
    rec.editing = {index: index, key: key, item: item, input: input, labelEl: labelEl, option: option};
    input.addEventListener("click", function (event) { event.stopPropagation(); });
    var finish = function (commit) {
      if (!rec.editing) return;
      var editing = rec.editing;
      rec.editing = null;
      var label = String(input.value || "").trim();
      if (commit && label && label !== previous) {
        var keyName = String(rec.block.rename_key || rec.block.label_key || "label");
        var renamed = false;
        if (typeof self.adapter.renameCollectionItem === "function") {
          renamed = self.adapter.renameCollectionItem(String(rec.block.bind || ""), key, label, rec.block) !== false;
        } else {
          var path = String(rec.block.bind || "").replace(/\/$/, "") + "/" + key + "/" + keyName;
          renamed = self.setPath(path, label, rec.block) !== false;
        }
        if (renamed) {
          if (isObject(editing.item)) editing.item[keyName] = label;
          editing.labelEl.textContent = label;
        } else {
          self.adapter.announce("error", "Rename was rejected by the host.");
        }
      }
      editing.labelEl.hidden = false;
      if (editing.input.parentNode) editing.input.parentNode.removeChild(editing.input);
      self.collectionFocus(rec, true);
    };
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === "Escape") { event.preventDefault(); finish(false); }
      else { event.stopPropagation(); }
    });
    input.addEventListener("blur", function () { finish(true); });
    input.focus();
    if (input.select) input.select();
  };

  Renderer.prototype.collectionMove = function (rec, index, delta) {
    if (!rec.block.reorder || index < 0 || index + delta < 0 || index + delta >= rec.items.length) return;
    var next = rec.items.slice();
    var moved = next.splice(index, 1)[0];
    next.splice(index + delta, 0, moved);
    var bind = String(rec.block.bind || "");
    var ok = true;
    if (typeof this.adapter.moveCollectionItem === "function") {
      ok = this.adapter.moveCollectionItem(bind, this.collectionKey(rec.block, moved, index), this.collectionKey(rec.block, next[index], index + delta), rec.block) !== false;
    } else {
      ok = this.setPath(bind, next, rec.block) !== false;
    }
    if (!ok) {
      this.adapter.announce("warning", "The collection order was not changed.");
      return;
    }
    var activeKey = rec.optionKeys[rec.activeIndex];
    this.render(this.doc);
    var root = this.mount.querySelector('[data-pui-collection="' + bind.replace(/"/g, '\\"') + '"]');
    var list = root && root.querySelector(".pui-collection-list");
    if (list) {
      var record = null;
      for (var r = 0; r < this.collectionRecords.length; r++) if (this.collectionRecords[r].element === root) record = this.collectionRecords[r];
      if (record) {
        var at = record.optionKeys.indexOf(String(activeKey));
        record.activeIndex = at >= 0 ? at : 0;
        this.collectionFocus(record, true);
      }
    }
  };

  Renderer.prototype.buildCollection = function (block) {
    var self = this;
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var bind = String(block.bind || "");
    var title = String(block.label || block.title || "Items");
    var items = this.collectionItems(block);
    var selectedKeys = this.collectionSelection(block);
    var root = el("section", {class: "pui-collection", "data-pui-collection": bind, role: String(a11y.role || "group")});
    var list = el("div", {class: "pui-collection-list", role: "listbox", tabindex: "0", "aria-label": title});
    if (block.multi === true) list.setAttribute("aria-multiselectable", "true");
    var rec = {
      element: root, block: block, list: list, options: [], optionKeys: [], optionLabels: [],
      items: items, selectedKeys: selectedKeys, activeIndex: selectedKeys.length ? Math.max(0, items.findIndex(function (item, index) {
        return String(self.collectionKey(block, item, index)) === String(selectedKeys[0]);
      })) : (items.length ? 0 : -1), anchorIndex: null, editing: null,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, visible: true, enabled: true
    };
    var previousCollectionIndex = this._collectionRecordIndex;
    this._collectionRecordIndex = this.collectionRecords.length;
    this.collectionRecords.push(rec);
    if (a11y.name) root.setAttribute("aria-label", String(a11y.name));
    if (block.help) root.appendChild(el("p", {class: "pui-help", text: String(block.help)}));
    var head = el("div", {class: "pui-collection-head"}, el("h4", {text: title}));
    root.appendChild(head);
    for (var i = 0; i < items.length; i++) {
      (function (item, index) {
        var key = self.collectionKey(block, item, index);
        var option = el("button", {type: "button", class: "pui-collection-option", role: "option", id: self.id("collection-option"), tabindex: "-1", "data-pui-key": String(key)});
        var itemLabel = self.collectionLabel(item, key, block);
        var labelEl = el("span", {class: "pui-collection-name", text: itemLabel});
        option.appendChild(labelEl);
        option.setAttribute("aria-selected", selectedKeys.indexOf(String(key)) >= 0 ? "true" : "false");
        if (selectedKeys.indexOf(String(key)) >= 0) option.classList.add("is-selected");
        option.addEventListener("click", function (event) {
          rec.activeIndex = index;
          self.collectionSelect(rec, index, event);
        });
        option.addEventListener("dblclick", function () { self.collectionRename(rec, index); });
        rec.options.push(option);
        rec.optionKeys.push(String(key));
        rec.optionLabels.push(labelEl);
        list.appendChild(option);
      })(items[i], i);
    }
    list.addEventListener("keydown", function (event) {
      var key = String(event.key || "");
      if (rec.editing) return;
      if (event.altKey && (key === "ArrowUp" || key === "ArrowDown") && block.reorder) {
        event.preventDefault();
        self.collectionMove(rec, rec.activeIndex, key === "ArrowUp" ? -1 : 1);
      } else if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
        event.preventDefault();
        var next = key === "Home" ? 0 : key === "End" ? rec.options.length - 1 :
          rec.activeIndex + (key === "ArrowDown" ? 1 : -1);
        rec.activeIndex = Math.max(0, Math.min(rec.options.length - 1, next));
        if (event.shiftKey && block.multi === true) self.collectionSelect(rec, rec.activeIndex, event);
        else self.collectionFocus(rec);
      } else if (key === "Enter" || key === " ") {
        event.preventDefault();
        self.collectionSelect(rec, rec.activeIndex, event);
      } else if (key === "F2" && block.rename) {
        event.preventDefault();
        self.collectionRename(rec, rec.activeIndex);
      }
    });
    list.addEventListener("focus", function () { self.collectionFocus(rec); });
    root.appendChild(list);
    rec.list = list;
    if (!items.length) {
      if (isObject(block.empty)) root.appendChild(this.buildBlock(block.empty));
      else root.appendChild(el("p", {class: "pui-collection-empty", text: "No items."}));
    }
    rec.actions = null;
    rec.actionItems = [];
    if (isArray(block.actions) && block.actions.length) {
      rec.actions = el("div", {class: "pui-collection-actions"});
      root.appendChild(rec.actions);
    }
    var selectedItem = null;
    for (var s = 0; s < items.length; s++) if (String(this.collectionKey(block, items[s], s)) === String(selectedKeys[0])) selectedItem = items[s];
    rec.itemPanel = null;
    if (selectedItem) {
      rec.itemPanel = el("div", {class: "pui-collection-item", role: "group", "aria-label": String(block.label || "Selected item")});
      root.appendChild(rec.itemPanel);
      this.collectionBuildItem(rec, selectedItem, rec.itemPanel);
    }
    this.collectionRefresh(rec);
    this._collectionRecordIndex = previousCollectionIndex;
    return root;
  };

  Renderer.prototype.buildReadout = function (block) {
    var field = this.effective(block);
    var root = el("div", {class: "pui-field pui-readout", "data-pui-block": "", "data-pui-path": String(field.bind || "")});
    var rec = {path: String(field.bind || ""), block: field, root: root, inputs: [], control: null, label: null, widget: "readout", order: field.order || 0, pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, collectionRecordIndex: this._collectionRecordIndex};
    this.buildReadoutInto(root, field, rec);
    this.records.push(rec);
    return root;
  };

  Renderer.prototype.buildReadoutInto = function (root, field, rec) {
    var id = this.id("readout");
    var cap = caption(field, id);
    var output = el("output", {id: id, "data-pui-bind": String(field.bind || ""), class: "pui-readout-value", text: valueText(this.value(rec), field)});
    var row = el("div", {class: "pui-readout-row"}, cap, output);
    root.appendChild(row);
    if (field.help) {
      var readoutHelp = this.helpEl(field, id);
      root.appendChild(readoutHelp);
      rec.helpEl = readoutHelp;
    }
    rec.control = output;
    rec.label = cap;
    rec.labelTextEl = cap;
    rec.readout = output;
    this.a11y(output, field, cap, []);
  };

  Renderer.prototype.registerSlot = function (name, factory) {
    this.slots[String(name)] = factory;
    var self = this;
    return function () { if (self.slots[String(name)] === factory) delete self.slots[String(name)]; };
  };

  Renderer.prototype.slotHost = function (block) {
    var self = this;
    return {
      slot: String(block.slot || ""),
      block: block,
      getValue: function (path) {
        return typeof self.adapter.getValueFor === "function" ? self.adapter.getValueFor(path, block) : self.adapter.getValue(path);
      },
      setValue: function (path, value) {
        return typeof self.adapter.setValueFor === "function" ? self.adapter.setValueFor(path, value, block) : self.adapter.setValue(path, value);
      },
      callAction: function (name, args) { return self.adapter.callAction(name, args || {}); },
      callCustom: function (name, args) {
        return self.adapter.callCustom ? self.adapter.callCustom(name, args || {}) : self.adapter.callAction(name, args || {});
      },
      subscribe: function (callback) { return self.adapter.subscribe(callback); },
      announce: function (level, textValue) { self.adapter.announce(level, textValue); },
      update: function (data) { self.updateSlot(block.slot, data); },
      document: function () { return self.doc; },
      ui: self
    };
  };

  Renderer.prototype.buildCustom = function (block) {
    var a11y = isObject(block.a11y) ? block.a11y : {};
    var slot = String(block.slot || "");
    if (this.slots[slot]) {
      var container = el("div", {class: "pui-slot", "data-pui-slot": slot, role: String(a11y.role || "region")});
      if (a11y.name) container.setAttribute("aria-label", String(a11y.name));
      if (a11y.description) container.setAttribute("aria-description", String(a11y.description));
      var host = this.slotHost(block);
      var instance = this.slots[slot];
      if (typeof instance === "function") instance = {mount: instance};
      var record = {name: slot, block: block, container: container, host: host, instance: instance,
        pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, collectionRecordIndex: this._collectionRecordIndex, visible: true, enabled: true};
      try {
        if (typeof instance.mount === "function") instance.mount(container, host, block);
        this.slotInstances.push(record);
        this.customRecords.push(record);
        return container;
      } catch (error) {
        this.adapter.announce("error", "custom slot '" + slot + "' failed: " + String(error && error.message || error));
        container.remove();
      }
    }
    var fallback = block.fallback;
    var node;
    if (isObject(fallback)) node = this.buildBlock(fallback);
    else node = el("p", {class: "pui-missing", text: "(custom panel '" + slot + "' is not available here)"});
    if (a11y.name) node.setAttribute("aria-label", String(a11y.name));
    if (a11y.description) node.setAttribute("aria-description", String(a11y.description));
    node.setAttribute("data-pui-slot-fallback", slot);
    this.customRecords.push({name: slot, block: block, container: node, fallback: true,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, collectionRecordIndex: this._collectionRecordIndex, visible: true, enabled: true});
    return node;
  };

  Renderer.prototype.updateSlot = function (name, data) {
    for (var i = 0; i < this.slotInstances.length; i++) {
      var record = this.slotInstances[i];
      if (record.name !== String(name)) continue;
      if (record.instance && typeof record.instance.update === "function") {
        try { record.instance.update(data, record.block, record.host); }
        catch (error) { this.adapter.announce("error", "custom slot update failed: " + String(error && error.message || error)); }
      }
    }
  };

  Renderer.prototype.bindDebugShortcut = function () {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    var self = this;
    if (this._debugKeyHandler) return;
    this._debugKeyHandler = function (event) {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || String(event.key || "").toLowerCase() !== "d") return;
      if (event.preventDefault) event.preventDefault();
      self.toggleDebug();
    };
    document.addEventListener("keydown", this._debugKeyHandler);
  };

  Renderer.prototype.unbindDebugShortcut = function () {
    if (!this._debugKeyHandler || typeof document === "undefined" || typeof document.removeEventListener !== "function") return;
    document.removeEventListener("keydown", this._debugKeyHandler);
    this._debugKeyHandler = null;
  };

  Renderer.prototype.setDebug = function (enabled) {
    this.debug = !!enabled;
    if (this.debug) this.showDebug(); else this.hideDebug();
    return this.debug;
  };

  Renderer.prototype.toggleDebug = function () { return this.setDebug(!this.debug); };

  Renderer.prototype.showDebug = function () {
    if (!this.mount) return;
    if (this.debugOverlay && this.debugOverlay.parentNode) this.debugOverlay.parentNode.removeChild(this.debugOverlay);
    var self = this;
    var panel = el("aside", {class: "pui-debug-overlay", role: "complementary", "aria-label": "PUI developer diagnostics"});
    var head = el("header", {class: "pui-debug-head"});
    head.appendChild(el("strong", {text: "PUI diagnostics"}));
    var close = el("button", {type: "button", class: "pui-debug-close", text: "×", "aria-label": "Close PUI diagnostics"});
    close.addEventListener("click", function () { self.setDebug(false); });
    head.appendChild(close);
    panel.appendChild(head);
    var body = el("pre", {class: "pui-debug-body", role: "status", "aria-live": "polite"});
    panel.appendChild(body);
    this.debugOverlay = panel;
    this.debugBody = body;
    this.mount.appendChild(panel);
    this.debugRefresh();
  };

  Renderer.prototype.hideDebug = function () {
    if (this.debugOverlay && this.debugOverlay.parentNode) this.debugOverlay.parentNode.removeChild(this.debugOverlay);
    this.debugOverlay = null;
    this.debugBody = null;
  };

  Renderer.prototype.debugRefresh = function () {
    if (!this.debugBody) return;
    var d = this.diagnostics();
    var lines = [
      "host      " + String(d.host || "—") + "   rev " + String(d.rev === null ? "—" : d.rev),
      "document  " + d.pages + " pages · " + d.sections + " sections · " + d.fields + " fields",
      "actions   " + d.actions + "   collections " + d.collections + "   custom " + d.custom + "   a11y " + d.a11y,
      "layout    " + d.density + "   render " + (d.renderMs === null ? "—" : d.renderMs + " ms"),
      "adapter   " + d.adapterMethods.length + " methods",
      "last      " + (d.lastAnnounce ? d.lastAnnounce.level + ": " + d.lastAnnounce.text : "—")
    ];
    if (d.lastError && (!d.lastAnnounce || d.lastError.at !== d.lastAnnounce.at)) lines.push("error     " + d.lastError.text);
    this.debugBody.textContent = lines.join("\n");
  };

  Renderer.prototype.destroySlots = function () {
    for (var i = 0; i < this.slotInstances.length; i++) {
      var record = this.slotInstances[i];
      if (record.instance && typeof record.instance.destroy === "function") {
        try { record.instance.destroy(); } catch (error) { /* cleanup must not break render */ }
      }
    }
    this.slotInstances = [];
  };

  Renderer.prototype.destroy = function () {
    this.unbindDebugShortcut();
    this.hideDebug();
    this.disconnectPreviews();
    this.disconnectMeters();
    this.disconnectToolbarLayouts();
    this.disconnectGraphBodies();
    this.unbindShortcuts();
    this.unbindPaletteShortcut();
    this.unbindHistoryShortcut();
    if (this._hashHandler && typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("hashchange", this._hashHandler);
    this._hashHandler = null;
    if (this._palette) this._palette.close();
    this.destroySlots();
    if (this.mount) while (this.mount.firstChild) this.mount.removeChild(this.mount.firstChild);
  };

  Renderer.prototype.presetItems = function (block) {
    var path = String(block.storage && block.storage.list || "");
    if (!path) return [];
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(path, block)
      : this.adapter.getValue(path);
    if (isArray(value)) return value;
    if (isObject(value) && isArray(value.presets)) return value.presets;
    return [];
  };

  Renderer.prototype.presetId = function (preset, index) {
    if (isObject(preset) && preset.id !== undefined) return String(preset.id);
    if (isObject(preset) && preset.name !== undefined) return String(preset.name);
    return String(preset === undefined || preset === null ? index : preset);
  };

  Renderer.prototype.presetLabel = function (preset, id) {
    if (isObject(preset)) return String(preset.label || preset.name || preset.title || id);
    return String(preset);
  };

  Renderer.prototype.presetSelected = function (rec) {
    var path = String(rec.block.storage && rec.block.storage.select || "");
    if (path) {
      var raw = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(path, rec.block)
        : this.adapter.getValue(path);
      if (raw !== undefined && raw !== null) return String(raw);
    }
    return rec.selectedId === undefined || rec.selectedId === null ? "" : String(rec.selectedId);
  };

  Renderer.prototype.presetStorageAction = function (rec, action) {
    if (!isObject(action)) return null;
    var copy = Object.assign({}, action);
    copy.args = Object.assign({}, isObject(action.args) ? action.args : {}, {
      preset: rec.selectedPreset || null,
      preset_id: rec.selectedId || "",
      presets: this.presetItems(rec.block)
    });
    return copy;
  };

  Renderer.prototype.presetStorageActions = function (rec) {
    if (!rec.actions) return;
    for (var old = 0; old < (rec.storageActionRecords || []).length; old++) {
      var control = rec.storageActionRecords[old];
      this.actions = this.actions.filter(function (entry) { return entry.control !== control; });
    }
    rec.storageActionRecords = [];
    rec.actions.textContent = "";
    var storage = rec.block.storage || {};
    var selected = !!rec.selectedPreset;
    ["save", "delete", "rename"].forEach(function (key) {
      var action = storage[key];
      if (!isObject(action)) return;
      var copy = rec.renderer.presetStorageAction(rec, action);
      if (key === "delete" && !selected) copy.disabled = true;
      var control = rec.renderer.addActionButton(rec.actions, copy);
      rec.storageActionRecords.push(control);
    });
  };

  Renderer.prototype.presetSignature = function (rec) {
    return JSON.stringify({selected: rec.selectedId, items: this.presetItems(rec.block).map(function (preset, index) {
      return {id: this.presetId(preset, index), label: this.presetLabel(preset, this.presetId(preset, index))};
    }, this)});
  };

  Renderer.prototype.presetRefresh = function (rec) {
    var selectedId = this.presetSelected(rec);
    var signature = this.presetSignature({selectedId: selectedId, block: rec.block});
    if (rec.presetSignature === signature) {
      rec.selectedId = selectedId;
      rec.selectedPreset = this.presetItems(rec.block).find(function (preset, index) {
        return this.presetId(preset, index) === selectedId;
      }, this) || null;
      return;
    }
    rec.selectedId = selectedId;
    var presets = this.presetItems(rec.block);
    rec.presets = presets;
    rec.selectedPreset = null;
    for (var i = 0; i < presets.length; i++) {
      if (this.presetId(presets[i], i) === rec.selectedId) rec.selectedPreset = presets[i];
    }
    this.presetRender(rec);
    rec.presetSignature = this.presetSignature(rec);
  };

  Renderer.prototype.presetRender = function (rec) {
    var self = this;
    if (rec.list) {
      rec.list.textContent = "";
      rec.items = this.presetItems(rec.block);
      rec.items.forEach(function (preset, index) {
        var id = self.presetId(preset, index);
        var option = el("button", {type: "button", role: "option", class: "pui-preset", "data-pui-preset": id, text: self.presetLabel(preset, id)});
        option.setAttribute("aria-selected", id === rec.selectedId ? "true" : "false");
        if (id === rec.selectedId) option.classList.add("is-selected");
        option.addEventListener("click", function () { self.presetSelect(rec, preset, id, option); });
        rec.list.appendChild(option);
      });
      if (!rec.items.length) rec.list.appendChild(el("span", {class: "pui-preset-empty", text: "No presets."}));
    }
    this.presetStorageActions(rec);
    rec.presetSignature = this.presetSignature(rec);
  };

  Renderer.prototype.presetSelect = function (rec, preset, id, button) {
    rec.selectedId = id;
    rec.selectedPreset = preset;
    var selectPath = String(rec.block.storage && rec.block.storage.select || "");
    if (selectPath) this.setPath(selectPath, id, rec.block);
    this.presetRender(rec);
    if (typeof document !== "undefined") {
      var focusedPreset = null;
      var choices = rec.list ? rec.list.querySelectorAll("[data-pui-preset]") : [];
      for (var p = 0; p < choices.length; p++) if (choices[p].getAttribute("data-pui-preset") === String(id)) focusedPreset = choices[p];
      if (focusedPreset && focusedPreset.focus) focusedPreset.focus();
    }
    var recall = rec.block.storage && rec.block.storage.recall;
    if (isObject(recall)) this.startAction(this.presetStorageAction(rec, recall), button);
  };

  Renderer.prototype.buildPresets = function (block) {
    var self = this;
    var root = el("section", {class: "pui-presets", "data-pui-presets": String(block.bind || "")});
    if (block.label) root.appendChild(el("h4", {class: "pui-presets-title", text: String(block.label)}));
    root.appendChild(this.buildActions(block.items || [], "presets"));
    var storage = isObject(block.storage) ? block.storage : null;
    var rec = {
      renderer: this, block: block, root: root, list: null, actions: null,
      presets: [], items: [], selectedId: "", selectedPreset: null,
      storageActionRecords: [], presetSignature: undefined,
      pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex,
      visible: true, enabled: true
    };
    if (storage && storage.list) {
      rec.list = el("div", {class: "pui-preset-list", role: "listbox", "aria-label": String(block.label || "Presets")});
      root.appendChild(rec.list);
    }
    if (storage) {
      rec.actions = el("div", {class: "pui-preset-storage"});
      root.appendChild(rec.actions);
    }
    this.presetRecords.push(rec);
    this.presetRefresh(rec);
    return root;
  };

  Renderer.prototype.buildActions = function (items, kind, storage) {
    var bar = el("div", {class: "pui-actions", "data-pui-actions": kind || "actions"});
    for (var i = 0; i < items.length; i++) {
      this.addActionButton(bar, items[i]);
    }
    if (isObject(storage)) {
      if (isObject(storage.save)) {
        var save = Object.assign({label: "Save preset…", style: "primary"}, storage.save);
        this.addActionButton(bar, save);
      }
      if (isObject(storage.delete)) this.addActionButton(bar, storage.delete);
      if (isObject(storage.rename)) this.addActionButton(bar, storage.rename);
    }
    return bar;
  };

  Renderer.prototype.addActionButton = function (bar, item) {
    if (!isObject(item)) return;
    var button = el("button", {type: "button", class: "pui-button " + (item.style === "primary" ? "pui-primary" : item.style === "danger" ? "pui-danger" : ""), text: String(item.label || item.id || "Action")});
    if (item.help) button.title = String(item.help);
    if (item.color) button.style.setProperty("--pui-action-color", String(item.color));
    button.disabled = !!item.disabled;
    var a11y = item.a11y || {};
    if (a11y.name) button.setAttribute("aria-label", String(a11y.name));
    if (a11y.description) button.setAttribute("aria-description", String(a11y.description));
    button.addEventListener("click", function () { this.startAction(item, button); }.bind(this));
    bar.appendChild(button);
    this.actions.push({control: button, block: item, bar: bar, status: null, pageRecordIndex: this._pageRecordIndex, sectionRecordIndex: this._sectionRecordIndex, collectionRecordIndex: this._collectionRecordIndex});
    return button;
  };

  Renderer.prototype.startAction = function (item, button) {
    if (isArray(item.inputs) && item.inputs.length) {
      this.openActionForm(item, button);
      return;
    }
    if (item.confirm) {
      this.openConfirm(item, button);
      return;
    }
    this.performAction(item, button, {});
  };

  Renderer.prototype.defaultAction = function (item) {
    if (isObject(item.set) && Number(item.morph) > 0) {
      return morph(this.adapter, item.set, Number(item.morph), String(item.easing || "linear")).then(function () { return true; });
    }
    if (item.collection_bind) {
      if (item.id === "add" && typeof this.adapter.addCollectionItem === "function") {
        return this.adapter.addCollectionItem(item.collection_bind, item);
      }
      if (item.id === "remove" && typeof this.adapter.removeCollectionItem === "function") {
        return this.adapter.removeCollectionItem(item.collection_bind, item.collection_item, item);
      }
      if (isArray(item.collection_items) && item.call) {
        var selectedItems = item.collection_items.slice();
        return this.adapter.callAction(String(item.call), Object.assign({}, isObject(item.args) ? item.args : {}, {
          bind: item.collection_bind, selected: selectedItems, item: selectedItems.length === 1 ? selectedItems[0] : undefined
        }));
      }
      if (item.call) {
        var extra = {bind: item.collection_bind, selected: item.collection_item, item: item.collection_item};
        return this.adapter.callAction(String(item.call), Object.assign({}, isObject(item.args) ? item.args : {}, extra));
      }
    }
    var ok = true;
    if (isObject(item.set)) {
      if (typeof this.adapter.setValues === "function") return this.adapter.setValues(item.set);
      var paths = Object.keys(item.set);
      for (var i = 0; i < paths.length; i++) {
        if (!this.setPath(paths[i], item.set[paths[i]], null)) ok = false;
      }
      return ok;
    }
    if (item.call) return this.adapter.callAction(String(item.call), isObject(item.args) ? item.args : {});
    if (item.custom) {
      if (this.adapter.callCustom) return this.adapter.callCustom(String(item.custom), isObject(item.args) ? item.args : {});
      return this.adapter.callAction(String(item.custom), isObject(item.args) ? item.args : {});
    }
    if (item.bind) return this.adapter.setValue(String(item.bind), null, null);
    return false;
  };

  Renderer.prototype.actionStatus = function (record, textValue, error) {
    if (!record) return;
    if (!record.status) {
      record.status = el("span", {class: "pui-action-status", role: "status", "aria-live": "polite"});
      record.bar.appendChild(record.status);
    }
    record.status.textContent = textValue || "";
    record.status.className = "pui-action-status" + (error ? " pui-status-error" : "");
    record.status.hidden = !textValue;
  };

  Renderer.prototype.performAction = function (item, button, extraArgs) {
    var self = this;
    var record = null;
    for (var i = 0; i < this.actions.length; i++) if (this.actions[i].control === button) record = this.actions[i];
    var args = Object.assign({}, isObject(item.args) ? item.args : {}, extraArgs || {});
    var payload = Object.assign({}, item, {args: args});
    var original = button.textContent;
    if (item.pending) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.textContent = String(item.pending);
    }
    var finish = function (ok, detail) {
      button.disabled = !!item.disabled;
      button.removeAttribute("aria-busy");
      if (!button.__puiToolbar) button.textContent = original;
      var message = ok ? String(item.result || "") : String(detail || item.error || "Action failed");
      self.actionStatus(record, message, !ok);
      if (message) self.adapter.announce(ok ? "success" : "error", message);
      if (ok && item.collection_bind && self.doc) {
        self.render(self.doc);
      } else {
        self.apply();
      }
      return ok;
    };
    var result;
    try {
      result = typeof this.adapter.action === "function"
        ? this.adapter.action(payload, this)
        : this.defaultAction(payload);
    } catch (error) {
      return finish(false, String(error && error.message || error));
    }
    if (result && typeof result.then === "function") {
      var timeout = Number(item.timeout || 0);
      var timed = timeout > 0 ? new Promise(function (_resolve, reject) {
        setTimeout(function () { reject(new Error("Action timed out")); }, timeout);
      }) : null;
      var race = timed ? Promise.race([result, timed]) : result;
      return race.then(function (value) {
        return finish(value !== false, value && value.error ? String(value.error) : "");
      }).catch(function (error) {
        return finish(false, String(error && error.message || error));
      });
    }
    return finish(result !== false, "");
  };

  Renderer.prototype.actionFormField = function (input, formId) {
    var renderer = this;
    var id = formId + "-" + String(input.name || "arg");
    var label = el("label", {class: "pui-dialog-label", for: id, text: String(input.label || input.name || "Value")});
    var control;
    var type = String(input.type || "text");
    if (type === "select") {
      control = el("select", {id: id, name: String(input.name || "")});
      var selectOptions = optionList(input);
      control.__puiOptions = selectOptions;
      selectOptions.forEach(function (entry) {
        control.appendChild(el("option", {value: String(entry.value), text: String(entry.label !== undefined ? entry.label : entry.value)}));
      });
      if (input.value !== undefined) {
        for (var oi = 0; oi < selectOptions.length; oi++) {
          if (equal(selectOptions[oi].value, input.value)) { control.selectedIndex = oi; break; }
        }
      }
    } else if (type === "textarea") {
      control = el("textarea", {id: id, name: String(input.name || ""), rows: 3});
    } else if (type === "checkbox") {
      control = el("input", {type: "checkbox", id: id, name: String(input.name || "")});
    } else if (type === "file" || type === "media") {
      control = el("input", {type: "file", id: id, name: String(input.name || "")});
      control.accept = String(input.accept || (type === "media" ? "image/*,audio/*,video/*" : ""));
      if (input.multiple) { control.multiple = true; control.setAttribute("multiple", ""); }
      if (input.capture) control.setAttribute("capture", String(input.capture));
      if (input.directory) control.setAttribute("webkitdirectory", "");
    } else {
      var inputType = type === "number" || type === "integer" ? "number" : type === "color" ? "color" : "text";
      control = el("input", {type: inputType, id: id, name: String(input.name || "")});
      if (input.min !== undefined) control.min = String(input.min);
      if (input.max !== undefined) control.max = String(input.max);
      if (input.step !== undefined) control.step = String(input.step);
      else if (type === "integer") control.step = "1";
    }
    if (input.required) control.required = true;
    if (input.placeholder && control.setAttribute) control.setAttribute("placeholder", String(input.placeholder));
    if (input.value !== undefined && type !== "checkbox" && type !== "file" && type !== "media") control.value = String(input.value);
    if (type === "checkbox") control.checked = !!input.value;
    var fileHint = null;
    if (type === "file" || type === "media") {
      fileHint = el("span", {class: "pui-file-name", role: "status", "aria-live": "polite"});
      var filesOf = function () {
        if (control.files && typeof control.files.length === "number") return Array.prototype.slice.call(control.files);
        return isArray(control.__puiFiles) ? control.__puiFiles : [];
      };
      control.__puiFilesOf = filesOf;
      var updateFiles = function () {
        var files = filesOf();
        fileHint.textContent = files.length ? files.map(function (file) { return String(file.name || file); }).join(", ") : renderer.t("field.no_file", "No file selected.");
      };
      control.addEventListener("change", updateFiles);
      updateFiles();
    }
    return {label: label, control: control, hint: fileHint, filesOf: control.__puiFilesOf};
  };

  Renderer.prototype.openActionForm = function (item, button) {
    var self = this;
    var formId = this.id("form");
    var dialog = el("dialog", {class: "pui-dialog", "aria-labelledby": formId + "-title"});
    var form = el("form", {method: "dialog"});
    form.appendChild(el("h2", {id: formId + "-title", text: String(item.label || "Action")}));
    var fields = [];
    for (var i = 0; i < item.inputs.length; i++) {
      var made = this.actionFormField(item.inputs[i], formId);
      form.appendChild(made.label);
      form.appendChild(made.control);
      if (made.hint) form.appendChild(made.hint);
      fields.push({input: item.inputs[i], control: made.control, filesOf: made.filesOf});
    }
    var status = el("p", {class: "pui-status", role: "alert", hidden: true});
    form.appendChild(status);
    var bar = el("div", {class: "pui-dialog-actions"});
    var cancel = el("button", {type: "button", class: "pui-button", text: self.t("action.cancel", "Cancel")});
    var submit = el("button", {type: "submit", class: "pui-button pui-primary", text: self.t("action.save", "Save")});
    bar.appendChild(cancel); bar.appendChild(submit); form.appendChild(bar);
    dialog.appendChild(form);
    var close = function () { if (dialog.open) dialog.close(); dialog.remove(); };
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
      var missingFile = fields.some(function (field) {
        var type = String(field.input.type || "text");
        if (type !== "file" && type !== "media") return false;
        return !!field.input.required && !(field.filesOf ? field.filesOf().length : (field.control.files && field.control.files.length));
      });
      if (missingFile) {
        status.textContent = "Please select the required file.";
        status.hidden = false;
        return;
      }
      var values = {};
      fields.forEach(function (field) {
        var control = field.control;
        var type = String(field.input.type || "text");
        if (type === "checkbox") values[String(field.input.name || "")] = !!control.checked;
        else if (type === "select" && control.__puiOptions) {
          var selected = control.__puiOptions[control.selectedIndex];
          values[String(field.input.name || "")] = selected ? selected.value : control.value;
        } else if (type === "file" || type === "media") {
          var files = field.filesOf ? field.filesOf() : (control.files ? Array.prototype.slice.call(control.files) : []);
          if (field.input.required && !files.length) values[String(field.input.name || "")] = null;
          else values[String(field.input.name || "")] = field.input.multiple ? files : (files[0] || null);
        } else if (type === "number" || type === "integer") values[String(field.input.name || "")] = Number(control.value);
        else values[String(field.input.name || "")] = control.value;
      });
      close();
      if (item.confirm) self.openConfirm(item, button, values);
      else self.performAction(item, button, values);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    if (fields.length && fields[0].control.focus) fields[0].control.focus();
  };

  Renderer.prototype.openConfirm = function (item, button, extraArgs) {
    var self = this;
    var dialog = el("dialog", {class: "pui-dialog", "aria-labelledby": this.id("confirm")});
    var form = el("form", {method: "dialog"});
    form.appendChild(el("h2", {id: dialog.getAttribute("aria-labelledby"), text: String(item.confirm_text || item.label || "Confirm")}));
    var bar = el("div", {class: "pui-dialog-actions"});
    var cancel = el("button", {type: "button", class: "pui-button", text: self.t("action.cancel", "Cancel")});
    var confirm = el("button", {type: "submit", class: "pui-button " + (item.style === "danger" ? "pui-danger" : "pui-primary"), text: String(item.confirm_label || self.t("action.confirm", "Confirm"))});
    bar.appendChild(cancel); bar.appendChild(confirm); form.appendChild(bar);
    dialog.appendChild(form);
    var close = function () { if (dialog.open) dialog.close(); dialog.remove(); };
    cancel.addEventListener("click", close);
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      close();
      self.performAction(item, button, extraArgs || {});
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  };

  Renderer.prototype.resetButton = function (field, path) {
    var target;
    if (isObject(field.reset) && Object.prototype.hasOwnProperty.call(field.reset, "value")) target = field.reset.value;
    else if (Object.prototype.hasOwnProperty.call(field, "default")) target = field.default;
    else return null;
    var button = el("button", {type: "button", class: "pui-reset", text: "↺", "aria-label": "Reset " + this.labelText(field) + " to default"});
    button.addEventListener("click", function () { this.write(path, target); }.bind(this));
    return button;
  };

  Renderer.prototype.helpEl = function (field, id) {
    var textValue = String(field.help || "");
    if (!textValue) return null;
    var node = el("p", {class: "pui-field-help", id: id + "-help", text: textValue});
    return node;
  };

  Renderer.prototype.labelText = function (field) {
    var label = String(field.label || field.bind || "Parameter");
    if (field.unit && label.indexOf("(" + field.unit + ")") < 0) label += " (" + field.unit + ")";
    return label;
  };

  Renderer.prototype.a11y = function (control, field, label, inputs) {
    if (!control) return;
    var a11y = isObject(field.a11y) ? field.a11y : {};
    var role = a11y.role || control.getAttribute("role") || implicitRole(control);
    if (role) control.setAttribute("role", role);
    var name = String(a11y.name || field.label || field.bind || "Parameter");
    if (field.unit && name.indexOf("(" + field.unit + ")") < 0) name += " (" + field.unit + ")";
    if (a11y.name) control.setAttribute("aria-label", name);
    else if (label && label.id && label.tagName.toLowerCase() === "label") control.setAttribute("aria-labelledby", label.id);
    else if (!control.getAttribute("aria-label")) control.setAttribute("aria-label", name);
    var explicitDescription = a11y.description || "";
    if (a11y.keyboard && explicitDescription.indexOf("Keyboard:") < 0) {
      explicitDescription += (explicitDescription ? " " : "") + "Keyboard: " + String(a11y.keyboard);
    }
    var visibleHelp = control.closest ? control.closest(".pui-field") && control.closest(".pui-field").querySelector(".pui-field-help") : null;
    if (explicitDescription || field.help) {
      if (!explicitDescription && visibleHelp) {
        if (!visibleHelp.id) visibleHelp.id = this.id("help");
        control.setAttribute("aria-describedby", visibleHelp.id);
      } else {
        if (control.__puiDescription && control.__puiDescription.parentNode) {
          control.__puiDescription.parentNode.removeChild(control.__puiDescription);
        }
        var descId = this.id("desc");
        var desc = el("span", {class: "pui-sr-only", id: descId, text: String(explicitDescription || field.help)});
        control.parentNode && control.parentNode.insertBefore(desc, control.nextSibling);
        control.__puiDescription = desc;
        control.setAttribute("aria-describedby", descId);
      }
    }
    var required = !!(a11y.required || field.required);
    if (required) {
      control.setAttribute("aria-required", "true");
      if ("required" in control) control.required = true;
    } else {
      control.removeAttribute("aria-required");
      if ("required" in control) control.required = false;
    }
    if (a11y.readonly || field.readonly) control.setAttribute("aria-readonly", "true");
    else control.removeAttribute("aria-readonly");
    if (a11y.live && a11y.live !== "off") control.setAttribute("aria-live", String(a11y.live));
    var widgetName = String(field.widget || "");
    if (widgetName === "switch" || widgetName === "checkbox") control.setAttribute("aria-checked", control.checked ? "true" : "false");
    if (field.min !== undefined && field.max !== undefined) {
      control.setAttribute("aria-valuemin", String(field.min));
      control.setAttribute("aria-valuemax", String(field.max));
    }
    if (field.unit) control.setAttribute("aria-valuetext", valueText(this.value({path: field.bind, block: field}), field));
    (inputs || []).forEach(function (input) {
      var optionInput = input.type === "radio" || (input.hasAttribute && input.hasAttribute("data-pui-bit"));
      if (input !== control && !optionInput && !input.getAttribute("aria-label") && !input.getAttribute("aria-labelledby")) {
        input.setAttribute("aria-label", String(a11y.name || this.labelText(field)) + (input.type === "number" ? " — precise value" : ""));
      }
    }, this);
  };

  Renderer.prototype.value = function (rec) {
    var value = typeof this.adapter.getValueFor === "function"
      ? this.adapter.getValueFor(rec.path, rec.block)
      : this.adapter.getValue(rec.path);
    if (value === undefined && rec.collection && rec.collection.item) {
      var raw = String(rec.rawBind || "");
      if (typeof this.adapter.getCollectionValue === "function") {
        value = this.adapter.getCollectionValue(rec.collection.bind, rec.collection.key, raw);
      }
      if (value === undefined && raw && raw.charAt(0) !== "/") {
        value = getByPath(rec.collection.item, raw);
      }
    }
    if (value === undefined) value = rec.block.default;
    return value;
  };

  Renderer.prototype.numberValue = function (rec) {
    var value = this.value(rec);
    return value === undefined || value === null || isNaN(Number(value)) ? 0 : Number(value);
  };

  Renderer.prototype.colorValue = function (value) {
    if (typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) return value.slice(0, 7);
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
    if (isArray(value)) {
      return "#" + value.slice(0, 3).map(function (x) { return Math.round(Number(x) * 255).toString(16).padStart(2, "0"); }).join("");
    }
    return "#ffffff";
  };

  Renderer.prototype.colorAlphaValue = function (value) {
    if (typeof value === "string" && /^#[0-9a-fA-F]{8}$/.test(value)) return parseInt(value.slice(7, 9), 16) / 255;
    if (isArray(value) && value.length >= 4) return Math.max(0, Math.min(1, Number(value[3])));
    return 1;
  };

  Renderer.prototype.setPath = function (path, value, block) {
    return typeof this.adapter.setValueFor === "function"
      ? this.adapter.setValueFor(path, value, block)
      : this.adapter.setValue(path, value);
  };

  Renderer.prototype.write = function (path, value, block) {
    if (!this.setPath(path, value, block)) { this.apply(); return; }
    this.apply();
  };

  Renderer.prototype.writeRecord = function (rec, value) {
    if (rec.collection && rec.collection.items && rec.collection.item) {
      var ok = typeof this.adapter.setCollectionItem === "function"
        ? this.adapter.setCollectionItem(rec.collection.bind, rec.collection.key, rec.rawBind, value, rec.block)
        : this.setPath(rec.path, value, rec.block);
      if (!ok) {
        var raw = String(rec.rawBind || "");
        if (raw && raw.charAt(0) !== "/") setByPath(rec.collection.item, raw, value);
        this.setPath(rec.collection.bind, rec.collection.items, rec.block);
        this.apply();
        return;
      }
      this.apply();
      return;
    }
    this.write(rec.path, value, rec.block);
  };

  Renderer.prototype.optionsFor = function (field) {
    if (field.options_bind) {
      var dynamic = typeof this.adapter.getValueFor === "function"
        ? this.adapter.getValueFor(String(field.options_bind), field)
        : this.adapter.getValue(String(field.options_bind));
      if (isArray(dynamic)) return normalizeOptions(dynamic);
    }
    return optionList(field);
  };

  Renderer.prototype.effective = function (block) {
    var out = {};
    Object.keys(block).forEach(function (key) { out[key] = block[key]; });
    if (out.label_key) out.label = this.t(String(out.label_key), String(out.label || out.bind || ""));
    if (out.help_key) out.help = this.t(String(out.help_key), String(out.help || ""));
    var meta = this.adapter.getPathMeta(out.bind) || {};
    ["type", "unit", "min", "max", "step", "options", "precision"].forEach(function (key) {
      if (out[key] === undefined && meta[key] !== undefined) out[key] = meta[key];
    });
    if (out.min === undefined && meta.range && meta.range.length && isObject(meta.range[0])) {
      if (meta.range[0].MIN !== undefined) out.min = meta.range[0].MIN;
      if (meta.range[0].MAX !== undefined) out.max = meta.range[0].MAX;
      if (meta.range[0].STEP_SIZE !== undefined) out.step = meta.range[0].STEP_SIZE;
    }
    return out;
  };

  Renderer.prototype.apply = function () {
    for (var sf = 0; sf < this.schemaFormRecords.length; sf++) {
      this.schemaFormRefresh(this.schemaFormRecords[sf]);
    }
    for (var i = 0; i < this.records.length; i++) {
      this.applyRecord(this.records[i]);
      this.applyStatus(this.records[i]);
      this.updateModified(this.records[i]);
    }
    for (var tr = 0; tr < this.toastRecords.length; tr++) {
      this.toastRender(this.toastRecords[tr]);
    }
    for (var tb = 0; tb < this.toolbarRecords.length; tb++) {
      this.toolbarRefresh(this.toolbarRecords[tb]);
    }
    for (var sb = 0; sb < this.statusRecords.length; sb++) {
      var statusRec = this.statusRecords[sb];
      for (var sv = 0; sv < statusRec.values.length; sv++) {
        var statusItem = statusRec.values[sv].item;
        statusRec.values[sv].value.textContent = this.statusValue(statusItem);
        if (statusRec.values[sv].cell) statusRec.values[sv].cell.setAttribute("data-tone", this.statusTone(statusItem));
      }
    }
    for (var t = 0; t < this.tableRecords.length; t++) {
      this.tableRefresh(this.tableRecords[t]);
    }
    for (var hr = 0; hr < this.historyRecords.length; hr++) {
      this.historyRefresh(this.historyRecords[hr]);
    }
    for (var cn = 0; cn < this.connectionRecords.length; cn++) {
      this.connectionRefresh(this.connectionRecords[cn]);
    }
    for (var pv = 0; pv < this.previewRecords.length; pv++) {
      this.previewRefresh(this.previewRecords[pv]);
    }
    for (var cv = 0; cv < this.canvasRecords.length; cv++) {
      this.canvasRefresh(this.canvasRecords[cv]);
    }
    for (var tr = 0; tr < this.transportRecords.length; tr++) {
      this.transportRefresh(this.transportRecords[tr]);
    }
    for (var mr = 0; mr < this.meterRecords.length; mr++) {
      this.meterRefresh(this.meterRecords[mr]);
    }
    for (var kc = 0; kc < this.keyCaptureRecords.length; kc++) {
      this.keyCaptureRefresh(this.keyCaptureRecords[kc]);
    }
    for (var bd = 0; bd < this.bindingRecords.length; bd++) {
      this.bindingRefresh(this.bindingRecords[bd]);
    }
    for (var ws = 0; ws < this.workspaceRecords.length; ws++) {
      this.workspaceRefresh(this.workspaceRecords[ws]);
    }
    for (var mt = 0; mt < this.mediaTimelineRecords.length; mt++) {
      this.mediaTimelineRefresh(this.mediaTimelineRecords[mt]);
    }
    for (var fv = 0; fv < this.favoriteRecords.length; fv++) {
      this.favoriteRefresh(this.favoriteRecords[fv]);
    }
    for (var dl = 0; dl < this.dialogRecords.length; dl++) {
      this.dialogRecords[dl].render();
    }
    for (var c = 0; c < this.commandLogRecords.length; c++) {
      if (this.commandLogRecords[c].refresh) this.commandLogRecords[c].refresh();
    }
    for (var s = 0; s < this.selectionRecords.length; s++) {
      if (this.selectionRecords[s].refresh) this.selectionRecords[s].refresh();
    }
    for (var d = 0; d < this.disclosureRecords.length; d++) {
      if (this.disclosureRecords[d].refresh) this.disclosureRecords[d].refresh();
    }
    for (var p = 0; p < this.projectRecords.length; p++) {
      if (this.projectRecords[p].refresh) this.projectRecords[p].refresh();
    }
    for (var dr = 0; dr < this.drawerRecords.length; dr++) {
      if (this.drawerRecords[dr].render) this.drawerRecords[dr].render();
    }
    for (var cr = 0; cr < this.codeRecords.length; cr++) {
      var codeRec = this.codeRecords[cr];
      var liveText = this.adapter.getValue(codeRec.path);
      if (typeof liveText === "string" && liveText !== codeRec.text && document.activeElement !== codeRec.area && !codeRec.dirty) {
        codeRec.text = liveText;
        codeRec.area.value = liveText;
        codeRec.setHighlight(liveText);
        codeRec.setStatus("Updated from host.", false);
      }
    }
    for (var pr = 0; pr < this.presetRecords.length; pr++) {
      this.presetRefresh(this.presetRecords[pr]);
    }
    this.refreshConditions();
    this.layoutToolbars();
    this.paintRanges();
    if (this.debug) this.debugRefresh();
  };

  Renderer.prototype.paintRanges = function () {
    if (!this.root || !this.root.querySelectorAll) return;
    var ranges = this.root.querySelectorAll('input[type="range"]');
    for (var i = 0; i < ranges.length; i++) paintRangeFill(ranges[i]);
  };

  Renderer.prototype.fieldStatus = function (rec) {
    var live = this.adapter.getFieldStatus(rec.path, rec.block) || {};
    var block = rec.block;
    var status = live.status !== undefined ? live.status : block.status;
    if (isObject(status)) {
      return {
        state: String(status.state || status.kind || ""),
        text: String(status.text || status.message || ""),
        stale: !!(live.stale !== undefined ? live.stale : block.stale),
        invalid: !!(live.invalid !== undefined ? live.invalid : (block.a11y && block.a11y.invalid)),
        busy: !!live.busy,
        reason: String(live.disabled_reason || block.disabled_reason || "")
      };
    }
    return {
      state: status ? String(status) : "",
      text: String(live.error || block.error || ""),
      stale: !!(live.stale !== undefined ? live.stale : block.stale),
      invalid: !!(live.invalid !== undefined ? live.invalid : (block.a11y && block.a11y.invalid)),
      busy: !!live.busy,
      reason: String(live.disabled_reason || block.disabled_reason || "")
    };
  };

  Renderer.prototype.applyStatus = function (rec) {
    if (!rec.statusEl) return;
    var status = this.fieldStatus(rec);
    var text = status.text || status.reason || "";
    if (status.busy && !text) text = "Working…";
    if (status.stale && !text) text = "Stale value";
    if (!text && status.state) text = status.state;
    rec.statusEl.hidden = !text;
    rec.statusEl.textContent = text;
    rec.statusEl.className = "pui-status" +
      (status.invalid || status.state === "error" || status.state === "invalid" ? " pui-status-error" :
        status.busy ? " pui-status-busy" : status.stale || status.state === "offline" || status.state === "warning" ? " pui-status-warn" : "");
    if (rec.control) {
      var invalid = !!(status.invalid || status.state === "error" || status.state === "invalid");
      if (invalid) rec.control.setAttribute("aria-invalid", "true");
      else rec.control.removeAttribute("aria-invalid");
      if (status.busy) rec.control.setAttribute("aria-busy", "true");
      else rec.control.removeAttribute("aria-busy");
      var described = rec.control.getAttribute("aria-describedby") || "";
      if (text) {
        if (!rec.statusEl.id) rec.statusEl.id = this.id("status");
        if (described.indexOf(rec.statusEl.id) < 0) {
          rec.control.setAttribute("aria-describedby", (described ? described + " " : "") + rec.statusEl.id);
        }
      } else if (rec.statusEl.id) {
        var remaining = described.split(/\s+/).filter(function (id) { return id && id !== rec.statusEl.id; });
        if (remaining.length) rec.control.setAttribute("aria-describedby", remaining.join(" "));
        else rec.control.removeAttribute("aria-describedby");
      }
    }
  };

  Renderer.prototype.applyRecord = function (rec) {
    var value = this.value(rec);
    if (value === undefined) return;
    var active = document.activeElement;
    if (rec.widget === "range") {
      if (rec.dragging || active === rec.range || active === rec.number) return;
      if (isMixedValue(value)) {
        rec.root.classList.add("is-mixed");
        rec.range.value = rec.range.min;
        rec.number.value = "";
        rec.number.placeholder = "—";
        rec.control.setAttribute("aria-valuetext", "mixed");
        return;
      }
      rec.root.classList.remove("is-mixed");
      rec.number.placeholder = "";
      rec.range.value = String(Number(value));
      rec.number.value = formatNumeric(value, rec.block);
      if (rec.rangePaint) rec.rangePaint();
      rec.control.setAttribute("aria-valuetext", valueText(value, rec.block));
      return;
    }
    if (rec.widget === "knob") {
      if (rec.dragging || active === rec.control || active === rec.knobNumber || rec.knobInput) return;
      if (isMixedValue(value)) { if (rec.knobPaint) rec.knobPaint(rec.block.min !== undefined ? Number(rec.block.min) : 0, true); return; }
      if (rec.knobPaint) rec.knobPaint(Number(value), false);
      return;
    }
    if (rec.widget === "number") {
      if (active !== rec.control) rec.control.value = String(Number(value));
      return;
    }
    if (rec.widget === "file") {
      if (rec.fileNote) rec.fileNote.textContent = valueText(value, rec.block);
      return;
    }
    if (rec.widget === "path") {
      if (active !== rec.control) rec.control.value = valueText(value, rec.block);
      return;
    }
    if (rec.widget === "select") {
      var opts = this.optionsFor(rec.block);
      for (var i = 0; i < opts.length; i++) if (equal(opts[i].value, value)) { rec.control.selectedIndex = i; break; }
      return;
    }
    if (rec.widget === "radio") {
      var radioOptions = optionList(rec.block);
      rec.inputs.forEach(function (input, index) {
        input.checked = equal(radioOptions[index] ? radioOptions[index].value : input.value, value);
      });
      return;
    }
    if (rec.widget === "text" || rec.widget === "textarea" || rec.widget === "json") {
      if (active !== rec.control && active !== rec.edit) rec.control.value = valueText(value, rec.block);
      return;
    }
    if (rec.widget === "color") {
      if (active !== rec.control) {
        var colorInput = rec.control && rec.control.tagName && rec.control.tagName.toLowerCase() === "input" ? rec.control : rec.inputs[0];
        if (colorInput) colorInput.value = this.colorValue(value);
      }
      if (rec.alphaInput && active !== rec.alphaInput) rec.alphaInput.value = String(Math.round(this.colorAlphaValue(value) * 100));
      return;
    }
    if (rec.widget === "xy-pad") {
      var xy = components(value, 2);
      var min = rec.block.min !== undefined ? Number(rec.block.min) : 0;
      var max = rec.block.max !== undefined ? Number(rec.block.max) : 1;
      if (rec.xyInputs) {
        if (active !== rec.xyInputs[0]) rec.xyInputs[0].value = formatNumeric(xy[0], rec.block);
        if (active !== rec.xyInputs[1]) rec.xyInputs[1].value = formatNumeric(xy[1], rec.block);
      }
      if (rec.xyDot) {
        rec.xyDot.style.left = (max === min ? 0 : (Number(xy[0]) - min) / (max - min) * 100) + "%";
        rec.xyDot.style.top = (max === min ? 0 : (1 - (Number(xy[1]) - min) / (max - min)) * 100) + "%";
      }
      rec.xyValue = xy;
      return;
    }
    if (rec.widget === "vector") {
      var vals = isArray(value) ? value : components(value, rec.inputs.length);
      for (var j = 0; j < rec.inputs.length; j++) if (active !== rec.inputs[j]) rec.inputs[j].value = String(vals[j] !== undefined ? vals[j] : 0);
      return;
    }
    if (rec.widget === "flags") {
      var mask = Number(value || 0);
      rec.inputs.forEach(function (input) { input.checked = (mask & Number(input.getAttribute("data-pui-bit"))) !== 0; });
      return;
    }
    if (rec.widget === "switch" || rec.widget === "checkbox") {
      rec.control.checked = !!value;
      rec.control.setAttribute("aria-checked", rec.control.checked ? "true" : "false");
      return;
    }
    if (rec.readout) rec.readout.textContent = valueText(value, rec.block);
  };

  Renderer.prototype.updateModified = function (rec) {
    if (!rec || !rec.root) return;
    var value = this.value(rec);
    var mixed = isMixedValue(value);
    var def = defaultValueOf(rec.block);
    var modified = !mixed && def !== undefined && !equal(value, def);
    rec.root.classList.toggle("is-modified", modified);
    rec.root.classList.toggle("is-mixed", mixed);
    if (rec.resetEl) {
      rec.resetEl.style.visibility = modified ? "visible" : "hidden";
      rec.resetEl.setAttribute("aria-hidden", modified ? "false" : "true");
      rec.resetEl.tabIndex = modified ? 0 : -1;
    }
  };

  Renderer.prototype.conditionOk = function (cond) {
    if (!isObject(cond)) return true;
    if (Object.prototype.hasOwnProperty.call(cond, "all")) return (cond.all || []).every(this.conditionOk.bind(this));
    if (Object.prototype.hasOwnProperty.call(cond, "any")) return (cond.any || []).some(this.conditionOk.bind(this));
    if (Object.prototype.hasOwnProperty.call(cond, "not")) return !this.conditionOk(cond.not);
    if (!cond.bind) return true;
    var value = this.adapter.getValue(cond.bind);
    if (Object.prototype.hasOwnProperty.call(cond, "equals")) return equal(value, cond.equals);
    if (Object.prototype.hasOwnProperty.call(cond, "not_equals")) return !equal(value, cond.not_equals);
    if (Object.prototype.hasOwnProperty.call(cond, "in")) return (cond["in"] || []).some(function (x) { return equal(value, x); });
    if (Object.prototype.hasOwnProperty.call(cond, "not_in")) return !(cond.not_in || []).some(function (x) { return equal(value, x); });
    if (Object.prototype.hasOwnProperty.call(cond, "truthy")) return !!value === !!cond.truthy;
    if (Object.prototype.hasOwnProperty.call(cond, "falsy")) return !!value !== !!cond.falsy;
    return !!value;
  };

  function groupEnabled(records, index) {
    return index < 0 || !records[index] || records[index].enabled !== false;
  }

  Renderer.prototype.refreshConditions = function () {
    for (var p = 0; p < this.pageRecords.length; p++) {
      var page = this.pageRecords[p];
      page.visible = this.conditionOk(page.page.visible_when);
      page.enabled = this.conditionOk(page.page.enabled_when);
      if (page.tab) page.tab.hidden = !page.visible;
    }
    for (var s = 0; s < this.sectionRecords.length; s++) {
      var section = this.sectionRecords[s];
      section.visible = this.conditionOk(section.block.visible_when);
      section.enabled = this.conditionOk(section.block.enabled_when) &&
        groupEnabled(this.pageRecords, section.pageRecordIndex);
      section.element.hidden = !section.visible;
    }
    for (var c = 0; c < this.collectionRecords.length; c++) {
      var collection = this.collectionRecords[c];
      collection.visible = this.conditionOk(collection.block.visible_when);
      collection.enabled = this.conditionOk(collection.block.enabled_when) &&
        groupEnabled(this.pageRecords, collection.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, collection.sectionRecordIndex);
      collection.element.hidden = !collection.visible;
      if (collection.enabled) collection.element.removeAttribute("aria-disabled");
      else collection.element.setAttribute("aria-disabled", "true");
      collection.options.forEach(function (option) { option.disabled = !collection.enabled; });
    }
    for (var i = 0; i < this.records.length; i++) {
      var rec = this.records[i];
      var matches = this.matchesSearch([this.labelText(rec.block), rec.path, rec.block.help]);
      rec.root.hidden = !matches || (rec.conditional ? !this.conditionOk(rec.block.visible_when) : false);
      var enabled = (!rec.conditional || this.conditionOk(rec.block.enabled_when)) &&
        !rec.readonly && !rec.disabled &&
        groupEnabled(this.pageRecords, rec.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, rec.sectionRecordIndex) &&
        groupEnabled(this.collectionRecords, rec.collectionRecordIndex);
      rec.inputs.forEach(function (input) { input.disabled = !enabled; });
    }
    for (var j = 0; j < this.actions.length; j++) {
      var action = this.actions[j];
      var actionMatches = this.matchesSearch([action.block.label, action.block.id, action.block.call, action.block.help]);
      action.control.hidden = !actionMatches || !this.conditionOk(action.block.visible_when);
      action.control.disabled = !!action.block.disabled || !this.conditionOk(action.block.enabled_when) ||
        !groupEnabled(this.pageRecords, action.pageRecordIndex) ||
        !groupEnabled(this.sectionRecords, action.sectionRecordIndex) ||
        !groupEnabled(this.collectionRecords, action.collectionRecordIndex);
    }
    for (var c2 = 0; c2 < this.customRecords.length; c2++) {
      var custom = this.customRecords[c2];
      var customMatches = this.matchesSearch([custom.block.slot, custom.block.label, custom.block.help]);
      custom.visible = customMatches && this.conditionOk(custom.block.visible_when);
      custom.enabled = this.conditionOk(custom.block.enabled_when) &&
        groupEnabled(this.pageRecords, custom.pageRecordIndex) &&
        groupEnabled(this.sectionRecords, custom.sectionRecordIndex) &&
        groupEnabled(this.collectionRecords, custom.collectionRecordIndex);
      custom.container.hidden = !custom.visible;
      if (custom.enabled) {
        custom.container.removeAttribute("inert");
        custom.container.removeAttribute("aria-disabled");
      } else {
        custom.container.setAttribute("inert", "");
        custom.container.setAttribute("aria-disabled", "true");
      }
    }
    for (var pi = 0; pi < this.panelRecords.length; pi++) {
      var panel = this.panelRecords[pi];
      var chosen = panel.active;
      if (!panel.pages[chosen] || !panel.pages[chosen].visible) {
        chosen = -1;
        for (var li = 0; li < panel.pages.length; li++) {
          if (panel.pages[li].visible) { chosen = li; break; }
        }
      }
      this.activatePage(panel, chosen);
    }
  };

  Renderer.prototype.loadPreferences = function () {
    if (typeof this.adapter.getPreferences !== "function") return this.preferences;
    var next = {favorites: [], recent: []};
    if (typeof this.adapter.getPreferences === "function") {
      try {
        var stored = this.adapter.getPreferences();
        if (isObject(stored)) {
          if (isArray(stored.favorites)) next.favorites = stored.favorites.map(String);
          if (isArray(stored.recent)) next.recent = stored.recent.map(String);
        }
      } catch (error) { /* host preference reads must not break rendering */ }
    }
    this.preferences = next;
    return next;
  };

  Renderer.prototype.savePreferences = function (next) {
    this.preferences = {
      favorites: isArray(next.favorites) ? next.favorites.slice() : [],
      recent: isArray(next.recent) ? next.recent.slice() : []
    };
    if (typeof this.adapter.setPreferences === "function") {
      try { this.adapter.setPreferences({favorites: this.preferences.favorites.slice(), recent: this.preferences.recent.slice()}); }
      catch (error) { /* host preference writes are best-effort */ }
    }
    return this.preferences;
  };

  Renderer.prototype.isFavorite = function (id) {
    return this.preferences.favorites.indexOf(String(id)) >= 0;
  };

  Renderer.prototype.toggleFavorite = function (id) {
    id = String(id);
    var favorites = this.preferences.favorites.slice();
    var index = favorites.indexOf(id);
    if (index >= 0) favorites.splice(index, 1);
    else favorites.unshift(id);
    this.savePreferences({favorites: favorites, recent: this.preferences.recent});
    if (this._palette && this._palette.paint) this._palette.paint(this._palette.input.value);
    return index < 0;
  };

  Renderer.prototype.recordRecent = function (id) {
    id = String(id);
    var recent = [id].concat(this.preferences.recent.filter(function (entry) { return entry !== id; })).slice(0, 20);
    this.savePreferences({favorites: this.preferences.favorites, recent: recent});
  };

  Renderer.prototype.orderedCommands = function () {
    var self = this;
    var favorites = this.preferences.favorites;
    var recent = this.preferences.recent;
    return this.commands().map(function (command, index) {
      var favoriteIndex = favorites.indexOf(command.id);
      var recentIndex = recent.indexOf(command.id);
      return {command: command, index: index, favoriteIndex: favoriteIndex, recentIndex: recentIndex};
    }).sort(function (a, b) {
      if (a.favoriteIndex >= 0 && b.favoriteIndex < 0) return -1;
      if (b.favoriteIndex >= 0 && a.favoriteIndex < 0) return 1;
      if (a.favoriteIndex >= 0 && b.favoriteIndex >= 0) return a.favoriteIndex - b.favoriteIndex;
      if (a.recentIndex >= 0 && b.recentIndex < 0) return -1;
      if (b.recentIndex >= 0 && a.recentIndex < 0) return 1;
      if (a.recentIndex >= 0 && b.recentIndex >= 0) return a.recentIndex - b.recentIndex;
      return a.index - b.index;
    }).map(function (entry) { return entry.command; });
  };

  Renderer.prototype.historyLabel = function (kind) {
    var value = kind === "undo" ? this.adapter.undoLabel : this.adapter.redoLabel;
    if (typeof value === "function") {
      try { value = value(); } catch (error) { value = null; }
    }
    if (value === undefined || value === null || value === "") value = kind === "undo" ? "Undo" : "Redo";
    return String(value);
  };

  Renderer.prototype.canUndo = function () {
    if (typeof this.adapter.undo !== "function") return false;
    if (typeof this.adapter.canUndo !== "function") return true;
    try { return !!this.adapter.canUndo(); } catch (error) { return false; }
  };

  Renderer.prototype.canRedo = function () {
    if (typeof this.adapter.redo !== "function") return false;
    if (typeof this.adapter.canRedo !== "function") return true;
    try { return !!this.adapter.canRedo(); } catch (error) { return false; }
  };

  Renderer.prototype.runHistory = function (kind) {
    var method = kind === "redo" ? this.adapter.redo : this.adapter.undo;
    if (typeof method !== "function") return false;
    var result;
    try { result = method.call(this.adapter); }
    catch (error) { this.adapter.announce("error", this.historyLabel(kind) + " failed: " + String(error && error.message || error)); return false; }
    if (result && typeof result.then === "function") {
      return result.then(function (ok) {
        if (ok === false) this.adapter.announce("warning", this.historyLabel(kind) + " is not available.");
        else this.apply();
        return ok !== false;
      }.bind(this), function (error) {
        this.adapter.announce("error", this.historyLabel(kind) + " failed: " + String(error && error.message || error));
        return false;
      }.bind(this));
    }
    if (result === false) {
      this.adapter.announce("warning", this.historyLabel(kind) + " is not available.");
      return false;
    }
    this.apply();
    return true;
  };

  Renderer.prototype.undo = function () { return this.runHistory("undo"); };
  Renderer.prototype.redo = function () { return this.runHistory("redo"); };

  Renderer.prototype.bindHistoryShortcut = function () {
    if ((typeof this.adapter.undo !== "function" && typeof this.adapter.redo !== "function") || this._historyKeyHandler) return;
    var self = this;
    this._historyKeyHandler = function (event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      var target = event.target || {};
      var tag = String(target.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      var key = String(event.key || "").toLowerCase();
      if (key === "z" && typeof self.adapter.undo === "function") {
        event.preventDefault();
        if (event.shiftKey) self.redo(); else self.undo();
      } else if (key === "y" && typeof self.adapter.redo === "function") {
        event.preventDefault();
        self.redo();
      }
    };
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", this._historyKeyHandler);
  };

  Renderer.prototype.unbindHistoryShortcut = function () {
    if (this._historyKeyHandler && typeof document !== "undefined" && document.removeEventListener) {
      document.removeEventListener("keydown", this._historyKeyHandler);
    }
    this._historyKeyHandler = null;
  };

  Renderer.prototype.commands = function () {
    var self = this;
    var out = [];
    this.pageRecords.forEach(function (rec) {
      out.push({kind: "page", id: "page:" + String(rec.page.id || ""), label: String(rec.page.title || rec.page.id || "Page"), path: "#page=" + String(rec.page.id || ""), run: function () { self.navigate(rec.page.id); }});
    });
    this.records.forEach(function (rec) {
      out.push({kind: "field", id: "field:" + rec.path, label: self.labelText(rec.block), path: rec.path, run: function () { self.focusPath(rec.path); }});
    });
    this.actions.forEach(function (rec) {
      var actionId = String(rec.block.id || rec.block.label || rec.block.call || rec.block.bind || "action");
      out.push({kind: "action", id: "action:" + actionId, label: String(rec.block.label || rec.block.id || "Action"), path: rec.block.bind || "action:" + String(rec.block.id || ""), run: function () { self.startAction(rec.block, rec.control); }});
    });
    if (typeof this.adapter.undo === "function") {
      out.push({kind: "history", id: "history:undo", label: this.historyLabel("undo"), path: "history:undo", disabled: !this.canUndo(), run: function () { self.undo(); }});
    }
    if (typeof this.adapter.redo === "function") {
      out.push({kind: "history", id: "history:redo", label: this.historyLabel("redo"), path: "history:redo", disabled: !this.canRedo(), run: function () { self.redo(); }});
    }
    return out;
  };

  Renderer.prototype.openPalette = function () {
    var self = this;
    if (this._palette) { this._palette.close(); return 0; }
    var dialog = el("dialog", {class: "pui-dialog pui-palette", "aria-label": this.t("palette.title", "Commands")});
    var form = el("form", {method: "dialog"});
    var input = el("input", {type: "search", "aria-label": this.t("palette.title", "Commands"), placeholder: this.t("search.filter", "Filter parameters")});
    var list = el("div", {class: "pui-palette-list", role: "listbox", "aria-label": this.t("palette.title", "Commands")});
    form.appendChild(input);
    form.appendChild(list);
    dialog.appendChild(form);
    this.loadPreferences();
    var commands = this.orderedCommands();
    var rows = [];
    var active = 0;
    function close() {
      if (dialog.open) dialog.close();
      dialog.remove();
      self._palette = null;
    }
    function choose(index) {
      var row = rows[index];
      if (!row || row.command.disabled) return;
      self.recordRecent(row.command.id);
      close();
      row.command.run();
    }
    function paint(query) {
      list.textContent = "";
      rows = [];
      active = 0;
      var needle = String(query || "").trim().toLowerCase();
      commands.filter(function (command) {
        return !needle || (command.label + " " + command.path + " " + command.kind + " " + command.id).toLowerCase().indexOf(needle) >= 0;
      }).slice(0, 80).forEach(function (command, index) {
        var option = el("button", {type: "button", role: "option", class: "pui-palette-option", id: self.id("command")});
        var favorite = self.isFavorite(command.id);
        var star = el("span", {class: "pui-palette-star", "aria-hidden": "true", text: favorite ? "★" : "☆"});
        option.appendChild(star);
        option.appendChild(el("span", {class: "pui-palette-label", text: command.label + " · " + command.kind}));
        option.setAttribute("data-pui-command", command.id);
        option.setAttribute("data-favorite", favorite ? "true" : "false");
        if (self.preferences.recent.indexOf(command.id) >= 0) option.setAttribute("data-recent", "true");
        if (command.disabled) {
          option.disabled = true;
          option.setAttribute("aria-disabled", "true");
        }
        option.setAttribute("aria-selected", index === active ? "true" : "false");
        option.setAttribute("aria-label", command.label + " · " + command.kind + (favorite ? " · favorite" : "") + (self.preferences.recent.indexOf(command.id) >= 0 ? " · recent" : ""));
        option.addEventListener("click", function () { choose(index); });
        list.appendChild(option);
        rows.push({button: option, command: command});
      });
      if (!rows.length) list.appendChild(el("p", {class: "pui-palette-empty", text: this.t("palette.empty", "No matching commands.")}));
      if (rows[active]) input.setAttribute("aria-activedescendant", rows[active].button.id);
      else input.removeAttribute("aria-activedescendant");
    }
    function select(index) {
      active = Math.max(0, Math.min(rows.length - 1, index));
      rows.forEach(function (row, i) { row.button.setAttribute("aria-selected", i === active ? "true" : "false"); });
      if (rows[active]) input.setAttribute("aria-activedescendant", rows[active].button.id);
    }
    input.addEventListener("input", function () { paint(input.value); });
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") { event.preventDefault(); select(active + 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); select(active - 1); }
      else if (event.key === "Enter") { event.preventDefault(); choose(active); }
      else if (event.key === "Escape") { event.preventDefault(); close(); }
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); choose(active); });
    dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
    this._palette = {dialog: dialog, input: input, list: list, close: close, paint: paint};
    document.body.appendChild(dialog);
    dialog.showModal();
    paint("");
    input.focus();
    return commands.length;
  };

  Renderer.prototype.bindPaletteShortcut = function () {
    if (!this.paletteEnabled || this._paletteKeyHandler) return;
    var self = this;
    this._paletteKeyHandler = function (event) {
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "k") {
        event.preventDefault();
        self.openPalette();
      }
    };
    document.addEventListener("keydown", this._paletteKeyHandler);
  };

  Renderer.prototype.unbindPaletteShortcut = function () {
    if (this._paletteKeyHandler) document.removeEventListener("keydown", this._paletteKeyHandler);
    this._paletteKeyHandler = null;
  };

  Renderer.prototype.matchesSearch = function (parts) {
    if (!this.searchQuery) return true;
    return parts.filter(Boolean).join(" ").toLowerCase().indexOf(this.searchQuery) >= 0;
  };

  Renderer.prototype.search = function (query) {
    query = query === undefined || query === null ? "" : String(query);
    this.searchQuery = query.trim().toLowerCase();
    if (this.searchInput && this.searchInput.value !== query) this.searchInput.value = query;
    if (this.root) this.refreshConditions();
    return this.dumpAccessibility().filter(function (row) { return row.visible; }).length;
  };

  Renderer.prototype.outline = function () {
    var doc = this.doc || {};
    return (doc.panels || []).map(function (panel) {
      return {
        id: panel.id || null,
        title: panel.title || null,
        pages: (panel.pages || []).map(function (page) {
          return {
            id: page.id || null,
            title: page.title || null,
            sections: (page.sections || []).map(function (section) {
              return {
                id: section.id || null,
                title: section.title || null,
                fields: (section.blocks || []).filter(function (block) {
                  return block && (block.kind === "field" || block.kind === "readout") && block.bind;
                }).map(function (block) {
                  return {bind: String(block.bind), label: String(block.label || block.bind)};
                })
              };
            })
          };
        })
      };
    });
  };

  Renderer.prototype.diagnostics = function () {
    var doc = this.doc || {};
    var activePages = this.panelRecords.map(function (panel) {
      var page = panel.pages[panel.active];
      return {id: page && page.page ? page.page.id : null, active: panel.active};
    });
    return {
      host: doc.host || null,
      rev: doc.rev === undefined ? null : doc.rev,
      lang: doc.lang || null,
      dir: doc.dir || null,
      theme: isObject(doc.theme) ? doc.theme.mode || null : null,
      density: this.density,
      search: this.searchQuery || null,
      panels: (doc.panels || []).length,
      pages: this.pageRecords.length,
      sections: this.sectionRecords.length,
      fields: this.records.length,
      actions: this.actions.length,
      collections: this.collectionRecords.length,
      custom: this.customRecords.length,
      slots: this.slotInstances.length,
      shortcuts: this.shortcuts.length,
      a11y: this.dumpAccessibility().length,
      renderMs: this.renderMs,
      lastAnnounce: this.lastAnnounce,
      lastError: this.lastError,
      adapterMethods: Object.keys(this.adapter).filter(function (key) { return typeof this.adapter[key] === "function"; }, this),
      activePages: activePages
    };
  };

  Renderer.prototype.dumpAccessibility = function () {
    var self = this;
    var out = [];
    function visible(element, pageIndex, sectionIndex, collectionIndex) {
      if (!element || element.hidden) return false;
      var page = self.pageRecords[pageIndex];
      var section = self.sectionRecords[sectionIndex];
      var collection = self.collectionRecords[collectionIndex];
      if (page && !page.visible) return false;
      if (section && !section.visible) return false;
      if (collection && !collection.visible) return false;
      return true;
    }
    for (var i = 0; i < this.records.length; i++) {
      var rec = this.records[i];
      var control = rec.control;
      if (!control) continue;
      var a11y = isObject(rec.block.a11y) ? rec.block.a11y : {};
      var label = rec.label && rec.label.textContent ? rec.label.textContent : "";
      var name = String(a11y.name || control.getAttribute("aria-label") || label || this.labelText(rec.block));
      if (rec.block.unit && name.indexOf("(" + rec.block.unit + ")") < 0) name += " (" + rec.block.unit + ")";
      out.push({
        path: rec.path,
        role: a11y.role || control.getAttribute("role") || implicitRole(control),
        name: name,
        description: a11y.description || rec.block.help || "",
        live: a11y.live || "off",
        order: rec.order,
        visible: visible(rec.root, rec.pageRecordIndex, rec.sectionRecordIndex, rec.collectionRecordIndex)
      });
    }
    for (var j = 0; j < this.actions.length; j++) {
      var action = this.actions[j];
      var block = action.block;
      var aa = isObject(block.a11y) ? block.a11y : {};
      out.push({
        path: block.bind || "action:" + String(block.id || block.label || "action"),
        role: aa.role || implicitRole(action.control),
        name: aa.name || action.control.textContent,
        description: aa.description || block.help || "",
        live: aa.live || "off",
        order: Number(block.order || 0),
        visible: visible(action.control, action.pageRecordIndex, action.sectionRecordIndex, action.collectionRecordIndex)
      });
    }
    out.sort(function (a, b) { return String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0; });
    return out;
  };

  Renderer.prototype.id = function (prefix) {
    return this.uid + "-" + prefix + "-" + (++this.uidCounter);
  };

  function ease(name, t) {
    switch (String(name || "linear")) {
      case "ease_in": return t * t;
      case "ease_out": return 1 - (1 - t) * (1 - t);
      case "ease_in_out": return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      case "smoothstep": return t * t * (3 - 2 * t);
      case "step": return t < 1 ? 0 : 1;
      default: return t;
    }
  }

  function lerpValue(from, to, t) {
    if (typeof from === "number" && typeof to === "number") return from + (to - from) * t;
    if (isArray(from) && isArray(to)) {
      var out = [];
      for (var i = 0; i < Math.max(from.length, to.length); i++) {
        out.push(lerpValue(Number(from[i] || 0), Number(to[i] || 0), t));
      }
      return out;
    }
    return t < 1 ? from : to;
  }

  /** Host helper: animate a set-map through an adapter. Hosts that own their
   * transport (e.g. gd-hyperhdr) can call this from their action handler.
   * Returns a Promise resolving after the final exact values are written. */
  function morph(adapter, set, duration, easing) {
    duration = Math.max(0, Number(duration) || 0);
    var paths = Object.keys(set || {});
    if (!paths.length) return Promise.resolve();
    if (duration <= 0 || typeof adapter.setValue !== "function") {
      paths.forEach(function (path) { adapter.setValue(path, set[path]); });
      return Promise.resolve();
    }
    var from = {};
    paths.forEach(function (path) { from[path] = adapter.getValue ? adapter.getValue(path) : undefined; });
    var start = Date.now();
    return new Promise(function (resolve) {
      function frame() {
        var elapsed = (Date.now() - start);
        var t = Math.min(1, elapsed / (duration * 1000));
        var eased = ease(easing, t);
        paths.forEach(function (path) {
          adapter.setValue(path, t >= 1 ? set[path] : lerpValue(from[path], set[path], eased));
        });
        if (t >= 1) resolve();
        else setTimeout(frame, 16);
      }
      frame();
    });
  }

  function str(value) { return value === undefined || value === null ? "" : String(value); }

  function collectBlocks(doc, out) {
    (doc.panels || []).forEach(function (panel) {
      (panel.pages || []).forEach(function (page) {
        (page.sections || []).forEach(function (section) {
          (section.blocks || []).forEach(function (block) {
            if (block && block.bind) out[String(block.bind)] = block;
          });
        });
      });
    });
  }

  function findAction(doc, id) {
    var found = null;
    (doc.panels || []).forEach(function (panel) {
      (panel.actions || []).forEach(function (item) { if (!found && str(item.id) === id) found = item; });
      (panel.pages || []).forEach(function (page) {
        (page.sections || []).forEach(function (section) {
          (section.actions || []).forEach(function (item) { if (!found && str(item.id) === id) found = item; });
          (section.blocks || []).forEach(function (block) {
            (block.items || []).forEach(function (item) { if (!found && str(item.id) === id) found = item; });
          });
        });
      });
    });
    return found;
  }

  function actionShape(item) {
    return [str(item.id), str(item.label), str(item.call), str(item.custom), str(item.bind),
      item.set && typeof item.set === "object" ? Object.keys(item.set).sort() : null,
      item.inputs ? item.inputs.length : 0, !!item.confirm];
  }

  function blockShape(block) {
    var out = [str(block.kind), str(block.id), str(block.bind), str(block.widget), str(block.type),
      str(block.slot), str(block.selected), str(block.item_key), !!block.readonly, !!block.disabled, !!block.help];
    if (Array.isArray(block.options)) out.push(block.options.map(function (o) { return isObject(o) ? o.value : o; }));
    if (block.item && Array.isArray(block.item.template)) out.push(block.item.template.map(blockShape));
    if (Array.isArray(block.template)) out.push(block.template.map(blockShape));
    if (Array.isArray(block.actions)) out.push(block.actions.map(actionShape));
    if (Array.isArray(block.items)) out.push(block.items.map(actionShape));
    if (Array.isArray(block.columns)) out.push(block.columns.map(function (column) {
      return [str(column.key), str(column.label), str(column.width), str(column.cell)];
    }));
    if (Array.isArray(block.fields)) out.push(block.fields.map(blockShape));
    if (Array.isArray(block.items)) out.push(block.items.map(function (item) {
      return [str(item.kind), str(item.bind), str(item.label), str(item.call), str(item.text)];
    }));
    out.push(str(block.align), str(block.bind));
    out.push(str(block.submit && block.submit.call), str(block.cancel && block.cancel.call), Number(block.columns) || 1);
    out.push(str(block.row_key), str(block.selection_bind), block.multi !== false, str(block.empty_text));
    return out;
  }

  function ariaShortcut(spec) {
    return String(spec).split("+").map(function (part) {
      var key = part.trim();
      if (/^(ctrl|control)$/i.test(key)) return "Control";
      if (/^(cmd|meta)$/i.test(key)) return "Meta";
      if (/^alt$/i.test(key)) return "Alt";
      if (/^shift$/i.test(key)) return "Shift";
      if (/^(esc|escape)$/i.test(key)) return "Escape";
      if (/^space$/i.test(key)) return "Space";
      return key.length === 1 ? key.toUpperCase() : key;
    }).join("+");
  }

  function shortcutMatches(spec, event) {
    var parts = String(spec).split("+").map(function (part) { return part.trim(); }).filter(Boolean);
    if (!parts.length) return false;
    var key = parts[parts.length - 1];
    var needsCtrl = false, needsMeta = false, needsAlt = false, needsShift = false;
    for (var i = 0; i < parts.length - 1; i++) {
      var mod = parts[i].toLowerCase();
      if (mod === "ctrl" || mod === "control" || mod === "mod") needsCtrl = true;
      else if (mod === "cmd" || mod === "meta") needsMeta = true;
      else if (mod === "alt" || mod === "option") needsAlt = true;
      else if (mod === "shift") needsShift = true;
    }
    if (!!event.ctrlKey !== needsCtrl) return false;
    if (!!event.metaKey !== needsMeta) return false;
    if (!!event.altKey !== needsAlt) return false;
    if (!!event.shiftKey !== needsShift) return false;
    var actual = String(event.key || "");
    var wanted = String(key);
    if (/^(esc|escape)$/i.test(wanted)) return actual.toLowerCase() === "escape";
    if (/^space$/i.test(wanted)) return actual === " ";
    if (wanted.length === 1) return actual.toLowerCase() === wanted.toLowerCase();
    return actual.toLowerCase() === wanted.toLowerCase();
  }

  function deepClone(value) {
    if (Array.isArray(value)) return value.map(deepClone);
    if (isObject(value)) {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = deepClone(value[key]); });
      return out;
    }
    return value;
  }

  function substitute(value, args) {
    if (typeof value === "string") {
      return value.replace(/\{\{([\w.-]+)\}\}/g, function (_match, key) {
        return args && Object.prototype.hasOwnProperty.call(args, key) ? String(args[key]) : "{{" + key + "}}";
      });
    }
    if (Array.isArray(value)) return value.map(function (entry) { return substitute(entry, args); });
    if (isObject(value)) {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = substitute(value[key], args); });
      return out;
    }
    return value;
  }

  /** Expand additive template/use composition. Template bodies are ordinary
   * blocks; `{{arg}}` placeholders are substituted from use.args. No
   * expressions are evaluated and recursion is depth-limited. */
  function expandTemplates(doc) {
    if (!isObject(doc) || !isObject(doc.templates)) return doc;
    var templates = doc.templates;
    var out = deepClone(doc);
    delete out.templates;
    var limit = 16;
    function expandBlock(block, depth) {
      if (!isObject(block) || block.kind !== "use") return [block];
      var id = String(block.ref || block.template || "");
      var template = templates[id];
      if (!isObject(template) || depth >= limit) {
        return [{kind: "note", text: "(template '" + id + "' is unavailable or recursive)"}];
      }
      var body = substitute(deepClone(template), isObject(block.args) ? block.args : {});
      var blocks = Array.isArray(body.blocks) ? body.blocks : [body];
      var result = [];
      blocks.forEach(function (entry) { result = result.concat(expandBlock(entry, depth + 1)); });
      return result;
    }
    (out.panels || []).forEach(function (panel) {
      (panel.pages || []).forEach(function (page) {
        (page.sections || []).forEach(function (section) {
          var blocks = [];
          (section.blocks || []).forEach(function (block) { blocks = blocks.concat(expandBlock(block, 0)); });
          section.blocks = blocks;
        });
      });
    });
    return out;
  }

  function structureKey(doc) {
    return JSON.stringify((doc.panels || []).map(function (panel) {
      return [str(panel.id), str(panel.title), str(panel.default_page), str(panel.page_bind), !!panel.embedded, (panel.actions || []).map(actionShape),
        (panel.pages || []).map(function (page) {
          return [str(page.id), str(page.title), (page.sections || []).map(function (section) {
            return [str(section.id), str(section.title), !!section.help, (section.actions || []).map(actionShape),
              (section.blocks || []).map(blockShape)];
          })];
        })];
    }));
  }

  function hasCollection(doc) {
    var found = false;
    (doc.panels || []).forEach(function (panel) {
      (panel.pages || []).forEach(function (page) {
        (page.sections || []).forEach(function (section) {
          (section.blocks || []).forEach(function (block) { if (block && block.kind === "collection") found = true; });
        });
      });
    });
    return found;
  }

  function validate(doc) {
    var errors = [];
    if (!isObject(doc)) return ["document is not an object"];
    if (doc.format !== "pupitre-ui") errors.push("format is not pupitre-ui");
    if (Number(doc.version) !== 1) errors.push("version is not 1");
    if (!isArray(doc.panels)) errors.push("panels is not an array");
    return errors;
  }

  function create(options) {
    return new Renderer(options);
  }

  global.PupitreUI = {
    version: "1.8.0",
    create: create,
    validate: validate,
    expandTemplates: expandTemplates,
    morph: morph,
    ease: ease,
    render: function (doc, options) { return create(options).render(doc); }
  };
})(typeof window !== "undefined" ? window : this);
