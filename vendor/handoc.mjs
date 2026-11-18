// vendor/handoc/packages/hwpx-core/src/opc-package.ts
import { unzipSync, zipSync } from "fflate";

// vendor/handoc/packages/hwpx-core/src/manifest.ts
function parseManifest(xml) {
  const metadata = {};
  const langMatch = xml.match(/<opf:language[^>]*>([^<]+)<\/opf:language>/);
  if (langMatch) metadata.language = langMatch[1];
  const titleMatch = xml.match(/<opf:title[^>]*>([^<]*)<\/opf:title>/);
  if (titleMatch && titleMatch[1]) metadata.title = titleMatch[1];
  const creatorMatch = xml.match(/<opf:meta[^>]*name="creator"[^>]*>([^<]+)<\/opf:meta>/);
  if (creatorMatch && creatorMatch[1]) metadata.creator = creatorMatch[1];
  const items = [];
  const itemRe = /<opf:item\s+([^>]+?)\/?\s*>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const attrs6 = m[1];
    const id = attrs6.match(/id="([^"]+)"/)?.[1] ?? "";
    const href = attrs6.match(/href="([^"]+)"/)?.[1] ?? "";
    const mediaType = attrs6.match(/media-type="([^"]+)"/)?.[1] ?? "";
    items.push({ id, href, mediaType });
  }
  const spine = [];
  const spineRe = /<opf:itemref\s+([^>]+?)\/?\s*>/g;
  while ((m = spineRe.exec(xml)) !== null) {
    const idref = m[1].match(/idref="([^"]+)"/)?.[1];
    if (idref) spine.push(idref);
  }
  return { metadata, items, spine };
}

// vendor/handoc/packages/hwpx-core/src/opc-package.ts
var CONTENT_HPF = "Contents/content.hpf";
var decoder = new TextDecoder();
var encoder = new TextEncoder();
var OpcPackage = class _OpcPackage {
  parts;
  manifest = null;
  constructor(parts) {
    this.parts = parts;
  }
  static async open(input) {
    let unzipped;
    try {
      unzipped = unzipSync(input);
    } catch {
      throw new Error("Invalid ZIP data");
    }
    const parts = /* @__PURE__ */ new Map();
    for (const [name, data] of Object.entries(unzipped)) {
      parts.set(name, data);
    }
    const pkg = new _OpcPackage(parts);
    if (pkg.hasPart(CONTENT_HPF)) {
      pkg.manifest = parseManifest(pkg.getPartAsText(CONTENT_HPF));
    }
    return pkg;
  }
  partNames() {
    return [...this.parts.keys()].sort();
  }
  hasPart(name) {
    return this.parts.has(name);
  }
  getPart(name) {
    const part = this.parts.get(name);
    if (!part) throw new Error(`Part not found: ${name}`);
    return part;
  }
  getPartAsText(name) {
    return decoder.decode(this.getPart(name));
  }
  // Forma: images reference manifest IDs, not necessarily package paths.
  resolveItemPath(id) {
    return this.manifest?.items.find((item) => item.id === id)?.href;
  }
  setPart(name, data) {
    this.parts.set(name, typeof data === "string" ? encoder.encode(data) : data);
    if (name === CONTENT_HPF) {
      this.manifest = parseManifest(this.getPartAsText(CONTENT_HPF));
    }
  }
  deletePart(name) {
    this.parts.delete(name);
  }
  async save() {
    const data = {};
    for (const [name, bytes] of this.parts) {
      data[name] = bytes;
    }
    return zipSync(data);
  }
  ensureManifest() {
    if (!this.manifest) throw new Error("No content.hpf manifest found");
    return this.manifest;
  }
  getSectionPaths() {
    const m = this.ensureManifest();
    const sectionItems = /* @__PURE__ */ new Set();
    for (const item of m.items) {
      if (/^section\d+$/i.test(item.id)) {
        sectionItems.add(item.id);
      }
    }
    return m.spine.filter((idref) => sectionItems.has(idref)).map((idref) => {
      const item = m.items.find((i) => i.id === idref);
      return item?.href ?? "";
    }).filter(Boolean);
  }
  getHeaderPaths() {
    const m = this.ensureManifest();
    return m.items.filter((item) => item.href.toLowerCase().includes("header")).map((item) => item.href);
  }
  getMetadata() {
    return this.ensureManifest().metadata;
  }
};

// vendor/handoc/packages/document-model/src/constants.ts
var HWPUNIT_PER_INCH = 7200;

// vendor/handoc/packages/document-model/src/utils.ts
var MM_PER_INCH = 25.4;
function hwpUnitToMm(hu) {
  return hu / HWPUNIT_PER_INCH * MM_PER_INCH;
}

// vendor/handoc/packages/document-model/src/warning.ts
var WarningCollector = class {
  warnings = [];
  add(code, message, path, severity = "warn") {
    this.warnings.push({ code, message, path, severity });
  }
  get count() {
    return this.warnings.length;
  }
  toJSON() {
    return [...this.warnings];
  }
};

// vendor/handoc/packages/hwpx-parser/src/xml-utils.ts
import { XMLParser } from "fast-xml-parser";
var ATTR_PREFIX = "@_";
var parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  removeNSPrefix: true,
  preserveOrder: false,
  trimValues: true
});
function parseXml(xml) {
  return parser.parse(xml);
}
function getAttr(node, name) {
  const val = node[ATTR_PREFIX + name];
  return val !== void 0 ? String(val) : void 0;
}
function getAttrs(node) {
  const result = {};
  for (const key of Object.keys(node)) {
    if (key.startsWith(ATTR_PREFIX)) {
      result[key.slice(ATTR_PREFIX.length)] = String(node[key]);
    }
  }
  return result;
}
function getChildren(node, tag) {
  const val = node[tag];
  if (val === void 0 || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}
function parseBool(val) {
  if (val === void 0) return false;
  return val === "1" || val.toLowerCase() === "true";
}
function parseIntSafe(val, defaultVal = 0) {
  if (val === void 0) return defaultVal;
  const n = Number.parseInt(val, 10);
  return Number.isNaN(n) ? defaultVal : n;
}

// vendor/handoc/packages/hwpx-parser/src/header-parser.ts
function parseHeader(xml, warnings) {
  const doc = parseXml(xml);
  const head = findHead(doc);
  const version = getAttr(head, "version") ?? "";
  const secCnt = parseIntSafe(getAttr(head, "secCnt"), 1);
  const beginNum = parseBeginNum(head);
  if (warnings && !version) {
    warnings.add("MISSING_ATTR", 'Missing required attribute "version" on <head>', "head");
  }
  const refListNode = findChild(head, "refList") ?? {};
  const refList = parseRefList(refListNode);
  const trackChanges = parseTrackChanges(refListNode);
  const trackChangeAuthors = parseTrackChangeAuthors(refListNode);
  const memoShapes = parseMemoShapes(refListNode);
  const result = { version, secCnt, beginNum, refList };
  if (trackChanges.length > 0) result.trackChanges = trackChanges;
  if (trackChangeAuthors.length > 0) result.trackChangeAuthors = trackChangeAuthors;
  if (memoShapes.length > 0) result.memoShapes = memoShapes;
  return result;
}
function findHead(doc) {
  for (const key of Object.keys(doc)) {
    if (key === "?xml") continue;
    if (key === "head" || key.endsWith(":head")) {
      return doc[key];
    }
  }
  for (const key of Object.keys(doc)) {
    if (key !== "?xml") return doc[key];
  }
  throw new Error("No head element found");
}
function findChild(node, localTag) {
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    if (local === localTag) {
      const val = node[key];
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return void 0;
}
function findChildren(node, localTag) {
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    if (local === localTag) {
      const val = node[key];
      if (Array.isArray(val)) return val;
      if (val !== void 0 && val !== null) return [val];
    }
  }
  return [];
}
function parseBeginNum(head) {
  const bn = findChild(head, "beginNum") ?? {};
  return {
    page: parseIntSafe(getAttr(bn, "page"), 1),
    footnote: parseIntSafe(getAttr(bn, "footnote"), 1),
    endnote: parseIntSafe(getAttr(bn, "endnote"), 1),
    pic: parseIntSafe(getAttr(bn, "pic"), 1),
    tbl: parseIntSafe(getAttr(bn, "tbl"), 1),
    equation: parseIntSafe(getAttr(bn, "equation"), 1)
  };
}
function parseRefList(refList) {
  const fontFaces = parseFontFaces(findChild(refList, "fontfaces") ?? {});
  const charProperties = parseCharProperties(findChildren(refList, "charProperties"));
  const tabProperties = parseTabProperties(findChild(refList, "tabProperties") ?? {});
  const numberings = parseNumberings(findChild(refList, "numberings") ?? {});
  const bullets = parseBullets(findChild(refList, "bullets") ?? {});
  const paraProperties = parseParaProperties(findChildren(refList, "paraProperties"));
  const styles = parseStyles(findChild(refList, "styles") ?? {});
  const borderFills = parseBorderFills(findChild(refList, "borderFills") ?? {});
  const knownTags = /* @__PURE__ */ new Set([
    "fontfaces",
    "charProperties",
    "paraProperties",
    "styles",
    "borderFills",
    "tabProperties",
    "numberings",
    "bullets"
  ]);
  const others = [];
  for (const key of Object.keys(refList)) {
    if (key.startsWith("@_")) continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    if (!knownTags.has(local)) {
      for (const child of Array.isArray(refList[key]) ? refList[key] : [refList[key]]) {
        others.push(toGenericElement(local, child));
      }
    }
  }
  return { fontFaces, charProperties, tabProperties, numberings, bullets, paraProperties, styles, borderFills, others };
}
function parseFontFaces(fontfaces) {
  const result = [];
  const faces = findChildren(fontfaces, "fontface");
  for (const face of faces) {
    const lang = getAttr(face, "lang") ?? "";
    const fonts = findChildren(face, "font").map((f) => ({
      id: parseIntSafe(getAttr(f, "id")),
      face: getAttr(f, "face") ?? "",
      type: getAttr(f, "type") ?? "",
      isEmbedded: parseBool(getAttr(f, "isEmbedded"))
    }));
    result.push({ lang, fonts });
  }
  return result;
}
function parseCharProperties(containers) {
  const result = [];
  for (const container of containers) {
    const items = findChildren(container, "charPr");
    for (const item of items) {
      const attrs6 = getAttrs(item);
      const id = parseIntSafe(attrs6.id);
      const height = parseIntSafe(attrs6.height);
      const boldEl = findChild(item, "bold");
      const bold = boldEl !== void 0 ? true : attrs6.bold !== void 0 ? parseBool(attrs6.bold) : void 0;
      const italicEl = findChild(item, "italic");
      const italic = italicEl !== void 0 ? true : attrs6.italic !== void 0 ? parseBool(attrs6.italic) : void 0;
      const textColor = attrs6.textColor || void 0;
      const shadeColor = attrs6.shadeColor && attrs6.shadeColor !== "none" ? attrs6.shadeColor : void 0;
      const highlightColor = attrs6.highlightColor || void 0;
      const underlineEl = findChild(item, "underline");
      const underline = underlineEl ? getAttr(underlineEl, "type") ?? void 0 : void 0;
      const strikeoutEl = findChild(item, "strikeout");
      const strikeout = strikeoutEl ? getAttr(strikeoutEl, "shape") ?? void 0 : void 0;
      const fontRefEl = findChild(item, "fontRef");
      let fontRef;
      if (fontRefEl) {
        const fontRefAttrs = getAttrs(fontRefEl);
        fontRef = {};
        for (const [lang, val] of Object.entries(fontRefAttrs)) {
          fontRef[lang] = parseIntSafe(val);
        }
      }
      const spacing = parseLangNumericMap(findChild(item, "spacing"));
      const ratio = parseLangNumericMap(findChild(item, "ratio"));
      const offset = parseLangNumericMap(findChild(item, "offset"));
      const relSz = parseLangNumericMap(findChild(item, "relSz"));
      const outlineEl = findChild(item, "outline");
      const outlineType = outlineEl ? getAttr(outlineEl, "type") ?? void 0 : void 0;
      const shadowEl = findChild(item, "shadow");
      let shadow;
      if (shadowEl) {
        const sType = getAttr(shadowEl, "type") ?? "NONE";
        if (sType !== "NONE") {
          shadow = {
            type: sType,
            color: getAttr(shadowEl, "color") ?? void 0,
            offsetX: parseIntSafe(getAttr(shadowEl, "offsetX")),
            offsetY: parseIntSafe(getAttr(shadowEl, "offsetY"))
          };
        }
      }
      const useKerning = attrs6.useKerning !== void 0 ? parseBool(attrs6.useKerning) : void 0;
      const useFontSpace = attrs6.useFontSpace !== void 0 ? parseBool(attrs6.useFontSpace) : void 0;
      const symMark = attrs6.symMark && attrs6.symMark !== "NONE" ? attrs6.symMark : void 0;
      const borderFillIDRef = attrs6.borderFillIDRef !== void 0 ? parseIntSafe(attrs6.borderFillIDRef) : void 0;
      const cp = { id, height, attrs: attrs6, children: childrenToGeneric(item) };
      if (bold !== void 0) cp.bold = bold;
      if (italic !== void 0) cp.italic = italic;
      if (underline && underline !== "NONE") cp.underline = underline;
      if (strikeout && strikeout !== "NONE") cp.strikeout = strikeout;
      if (textColor) cp.textColor = textColor;
      if (shadeColor) cp.shadeColor = shadeColor;
      if (highlightColor) cp.highlightColor = highlightColor;
      if (fontRef) cp.fontRef = fontRef;
      if (spacing) cp.spacing = spacing;
      if (ratio) cp.ratio = ratio;
      if (offset) {
        cp.offset = offset;
        const offsetValues = Object.values(offset);
        const hasPositive = offsetValues.some((v) => v > 0);
        const hasNegative = offsetValues.some((v) => v < 0);
        if (hasPositive) cp.superscript = true;
        if (hasNegative) cp.subscript = true;
      }
      if (relSz) cp.relSz = relSz;
      if (useKerning) cp.useKerning = useKerning;
      if (useFontSpace) cp.useFontSpace = useFontSpace;
      if (symMark) cp.symMark = symMark;
      if (borderFillIDRef !== void 0) cp.borderFillIDRef = borderFillIDRef;
      if (outlineType && outlineType !== "NONE") cp.outline = outlineType;
      if (shadow) cp.shadow = shadow;
      result.push(cp);
    }
  }
  return result;
}
function parseParaProperties(containers) {
  const result = [];
  for (const container of containers) {
    const items = findChildren(container, "paraPr");
    for (const item of items) {
      const attrs6 = getAttrs(item);
      const id = parseIntSafe(attrs6.id);
      const pp = { id, attrs: attrs6, children: childrenToGeneric(item) };
      const alignEl = findChild(item, "align");
      if (alignEl) {
        const h = getAttr(alignEl, "horizontal");
        if (h) {
          const map = {
            LEFT: "left",
            CENTER: "center",
            RIGHT: "right",
            JUSTIFY: "justify",
            DISTRIBUTE: "distribute"
          };
          pp.align = map[h] ?? void 0;
        }
      }
      const headingEl = findChild(item, "heading");
      if (headingEl) {
        const hType = getAttr(headingEl, "type") ?? "NONE";
        const hIdRef = parseIntSafe(getAttr(headingEl, "idRef"));
        const hLevel = parseIntSafe(getAttr(headingEl, "level"));
        if (hType !== "NONE") {
          pp.heading = { type: hType, idRef: hIdRef, level: hLevel };
        }
      }
      const lineSpacingEl = findLineSpacing(item);
      if (lineSpacingEl) {
        const lsType = getAttr(lineSpacingEl, "type") ?? "PERCENT";
        const lsValue = parseIntSafe(getAttr(lineSpacingEl, "value"));
        pp.lineSpacing = { type: lsType, value: lsValue };
      }
      const marginEl = findMargin(item);
      if (marginEl) {
        const margin = {};
        for (const child of findAllChildren(marginEl)) {
          const local = child.localTag;
          const val = parseIntSafe(getAttr(child.node, "value"));
          if (local === "left") margin.left = val;
          else if (local === "right") margin.right = val;
          else if (local === "intent") margin.indent = val;
          else if (local === "prev") margin.prev = val;
          else if (local === "next") margin.next = val;
        }
        if (Object.keys(margin).length > 0) pp.margin = margin;
      }
      if (attrs6.tabPrIDRef !== void 0) pp.tabPrIDRef = parseIntSafe(attrs6.tabPrIDRef);
      const condenseVal = parseIntSafe(attrs6.condense);
      if (condenseVal > 0) pp.condense = condenseVal;
      const borderEl = findChild(item, "border");
      if (borderEl) {
        const bAttrs = getAttrs(borderEl);
        pp.border = {
          borderFillIDRef: parseIntSafe(bAttrs.borderFillIDRef),
          offsetLeft: parseIntSafe(bAttrs.offsetLeft),
          offsetRight: parseIntSafe(bAttrs.offsetRight),
          offsetTop: parseIntSafe(bAttrs.offsetTop),
          offsetBottom: parseIntSafe(bAttrs.offsetBottom),
          connect: parseBool(bAttrs.connect),
          ignoreMargin: parseBool(bAttrs.ignoreMargin)
        };
      }
      const breakEl = findChild(item, "breakSetting");
      if (breakEl) {
        const bsAttrs = getAttrs(breakEl);
        pp.breakSetting = {
          breakLatinWord: bsAttrs.breakLatinWord,
          breakNonLatinWord: bsAttrs.breakNonLatinWord,
          widowOrphan: parseBool(bsAttrs.widowOrphan),
          keepWithNext: parseBool(bsAttrs.keepWithNext),
          keepLines: parseBool(bsAttrs.keepLines),
          pageBreakBefore: parseBool(bsAttrs.pageBreakBefore),
          lineWrap: bsAttrs.lineWrap
        };
      }
      const autoSpacingEl = findChild(item, "autoSpacing");
      if (autoSpacingEl) {
        const asAttrs = getAttrs(autoSpacingEl);
        pp.autoSpacing = {
          eAsianEng: parseBool(asAttrs.eAsianEng),
          eAsianNum: parseBool(asAttrs.eAsianNum)
        };
      }
      result.push(pp);
    }
  }
  return result;
}
function parseLangNumericMap(el) {
  if (!el) return void 0;
  const elAttrs = getAttrs(el);
  const map = {};
  let hasNonZero = false;
  for (const [lang, val] of Object.entries(elAttrs)) {
    const n = parseIntSafe(val);
    map[lang] = n;
    if (n !== 0) hasNonZero = true;
  }
  return Object.keys(map).length > 0 ? map : void 0;
}
function parseTabProperties(tabPropsNode) {
  const items = findChildren(tabPropsNode, "tabPr");
  return items.map((item) => {
    const tAttrs = getAttrs(item);
    const tabStops = [];
    const collectTabItems = (node) => {
      for (const ti of findChildren(node, "tabItem")) {
        const tiAttrs = getAttrs(ti);
        tabStops.push({
          pos: parseIntSafe(tiAttrs.pos),
          type: tiAttrs.type,
          leader: tiAttrs.leader,
          unit: tiAttrs.unit
        });
      }
    };
    collectTabItems(item);
    const sw = findChild(item, "switch");
    if (sw) {
      const cs = findChild(sw, "case");
      if (cs) collectTabItems(cs);
      else {
        const df = findChild(sw, "default");
        if (df) collectTabItems(df);
      }
    }
    return {
      id: parseIntSafe(tAttrs.id),
      autoTabLeft: tAttrs.autoTabLeft !== void 0 ? parseBool(tAttrs.autoTabLeft) : void 0,
      autoTabRight: tAttrs.autoTabRight !== void 0 ? parseBool(tAttrs.autoTabRight) : void 0,
      tabStops
    };
  });
}
function findLineSpacing(item) {
  const direct = findChild(item, "lineSpacing");
  if (direct) return direct;
  const sw = findChild(item, "switch");
  if (sw) {
    const cs = findChild(sw, "case");
    if (cs) {
      const r = findChild(cs, "lineSpacing");
      if (r) return r;
    }
    const df = findChild(sw, "default");
    if (df) {
      const r = findChild(df, "lineSpacing");
      if (r) return r;
    }
  }
  return void 0;
}
function findMargin(item) {
  const direct = findChild(item, "margin");
  if (direct) return direct;
  const sw = findChild(item, "switch");
  if (sw) {
    const cs = findChild(sw, "case");
    if (cs) {
      const r = findChild(cs, "margin");
      if (r) return r;
    }
    const df = findChild(sw, "default");
    if (df) {
      const r = findChild(df, "margin");
      if (r) return r;
    }
  }
  return void 0;
}
function findAllChildren(node) {
  const result = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    const val = node[key];
    const items = Array.isArray(val) ? val : [val];
    for (const item of items) {
      if (item && typeof item === "object") {
        result.push({ localTag: local, node: item });
      }
    }
  }
  return result;
}
function parseParaHeads(parent) {
  return findChildren(parent, "paraHead").map((ph) => {
    const a = getAttrs(ph);
    const result = {
      level: parseIntSafe(a.level)
    };
    if (a.start !== void 0) result.start = parseIntSafe(a.start);
    if (a.align) result.align = a.align;
    if (a.useInstWidth !== void 0) result.useInstWidth = parseBool(a.useInstWidth);
    if (a.autoIndent !== void 0) result.autoIndent = parseBool(a.autoIndent);
    if (a.widthAdjust !== void 0) result.widthAdjust = parseIntSafe(a.widthAdjust);
    if (a.textOffsetType) result.textOffsetType = a.textOffsetType;
    if (a.textOffset !== void 0) result.textOffset = parseIntSafe(a.textOffset);
    if (a.numFormat) result.numFormat = a.numFormat;
    if (a.charPrIDRef !== void 0) result.charPrIDRef = parseIntSafe(a.charPrIDRef);
    if (a.checkable !== void 0) result.checkable = parseBool(a.checkable);
    const text = ph["#text"];
    if (text !== void 0 && text !== null) result.text = String(text);
    return result;
  });
}
function parseNumberings(node) {
  return findChildren(node, "numbering").map((n) => {
    const a = getAttrs(n);
    return {
      id: parseIntSafe(a.id),
      start: parseIntSafe(a.start, 1),
      levels: parseParaHeads(n)
    };
  });
}
function parseBullets(node) {
  return findChildren(node, "bullet").map((b) => {
    const a = getAttrs(b);
    const result = {
      id: parseIntSafe(a.id),
      char: a.char ?? "",
      levels: parseParaHeads(b)
    };
    if (a.useImage !== void 0) result.useImage = parseBool(a.useImage);
    return result;
  });
}
function parseStyles(stylesNode) {
  const items = findChildren(stylesNode, "style");
  return items.map((s) => {
    const attrs6 = getAttrs(s);
    return {
      id: parseIntSafe(attrs6.id),
      type: attrs6.type ?? "",
      name: attrs6.name ?? "",
      engName: attrs6.engName,
      paraPrIDRef: attrs6.paraPrIDRef !== void 0 ? parseIntSafe(attrs6.paraPrIDRef) : void 0,
      charPrIDRef: attrs6.charPrIDRef !== void 0 ? parseIntSafe(attrs6.charPrIDRef) : void 0,
      nextStyleIDRef: attrs6.nextStyleIDRef !== void 0 ? parseIntSafe(attrs6.nextStyleIDRef) : void 0,
      attrs: attrs6
    };
  });
}
function parseBorderFills(node) {
  return findChildren(node, "borderFill").map((bf) => toGenericElement("borderFill", bf));
}
function childrenToGeneric(node) {
  const result = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    const val = node[key];
    const items = Array.isArray(val) ? val : [val];
    for (const item of items) {
      result.push(toGenericElement(local, item));
    }
  }
  return result;
}
function toGenericElement(tag, value) {
  if (value === null || value === void 0) {
    return { tag, attrs: {}, children: [], text: null };
  }
  if (typeof value !== "object") {
    return { tag, attrs: {}, children: [], text: String(value) };
  }
  const node = value;
  const attrs6 = getAttrs(node);
  const text = node["#text"] !== void 0 ? String(node["#text"]) : null;
  const children = childrenToGeneric(node);
  return { tag, attrs: attrs6, children, text };
}
function parseTrackChanges(refList) {
  const container = findChild(refList, "trackChanges");
  if (!container) return [];
  const items = findChildren(container, "trackChange");
  return items.map((item) => {
    const attrs6 = getAttrs(item);
    return {
      id: parseIntSafe(attrs6.id),
      type: attrs6.type ?? "Unknown",
      date: attrs6.date ?? "",
      authorID: parseIntSafe(attrs6.authorID),
      hide: parseBool(attrs6.hide)
    };
  });
}
function parseTrackChangeAuthors(refList) {
  const container = findChild(refList, "trackChangeAuthors");
  if (!container) return [];
  const items = findChildren(container, "trackChangeAuthor");
  return items.map((item) => {
    const attrs6 = getAttrs(item);
    return {
      id: parseIntSafe(attrs6.id),
      name: attrs6.name ?? "",
      mark: parseIntSafe(attrs6.mark)
    };
  });
}
function parseMemoShapes(refList) {
  const container = findChild(refList, "memoShapeList") ?? findChild(refList, "MEMOSHAPELIST");
  if (!container) return [];
  const items = findChildren(container, "memo") ?? findChildren(container, "MEMO");
  return items.map((item) => {
    const attrs6 = getAttrs(item);
    return {
      id: parseIntSafe(attrs6.id),
      width: attrs6.width !== void 0 ? parseIntSafe(attrs6.width) : void 0,
      lineColor: attrs6.lineColor || void 0,
      lineType: attrs6.lineType || void 0,
      fillColor: attrs6.fillColor || void 0,
      memoType: attrs6.MemoType || attrs6.memoType || void 0
    };
  });
}

// vendor/handoc/packages/hwpx-parser/src/section-props-parser.ts
function findChild2(el, tag) {
  return el.children.find((c) => c.tag === tag);
}
function num(val, fallback = 0) {
  if (val === void 0) return fallback;
  const n = Number(val);
  return Number.isNaN(n) ? fallback : n;
}
function parseSectionProps(element) {
  const pagePr = findChild2(element, "pagePr");
  const marginEl = pagePr ? findChild2(pagePr, "margin") : void 0;
  const startNum = findChild2(element, "startNum");
  const width = num(pagePr?.attrs["width"]);
  const height = num(pagePr?.attrs["height"]);
  const landscape = pagePr?.attrs["landscape"] === "NARROWLY";
  const margins = {
    left: num(marginEl?.attrs["left"]),
    right: num(marginEl?.attrs["right"]),
    top: num(marginEl?.attrs["top"]),
    bottom: num(marginEl?.attrs["bottom"]),
    header: num(marginEl?.attrs["header"]),
    footer: num(marginEl?.attrs["footer"]),
    gutter: num(marginEl?.attrs["gutter"])
  };
  const result = {
    pageWidth: width,
    pageHeight: height,
    margins,
    landscape
  };
  const colPr = findChild2(element, "colPr");
  if (colPr) {
    result.columns = {
      count: num(colPr.attrs["colCount"], 1),
      gap: num(colPr.attrs["sameGap"]),
      type: colPr.attrs["type"] ?? "NEWSPAPER"
    };
    const colSizes = colPr.children.filter((c) => c.tag === "colSz");
    if (colSizes.length > 0) {
      result.columns.sizes = colSizes.map((cs) => ({
        width: num(cs.attrs["width"]),
        gap: num(cs.attrs["gap"])
      }));
    }
    const colLine = colPr.children.find((c) => c.tag === "colLine");
    if (colLine) {
      result.columns.separator = {
        type: colLine.attrs["type"] ?? "SOLID",
        width: colLine.attrs["width"] ?? "0.12 mm",
        color: colLine.attrs["color"] ?? "#000000"
      };
    }
  }
  if (startNum) {
    const pageNum = num(startNum.attrs["page"]);
    if (pageNum > 0) {
      result.pageStartNumber = pageNum;
    }
  }
  return result;
}

// vendor/handoc/packages/hwpx-parser/src/paragraph-parser.ts
var SHAPE_OBJECTS = /* @__PURE__ */ new Set([
  "line",
  "rect",
  "ellipse",
  "arc",
  "polyline",
  "polygon",
  "curve",
  "connectLine",
  "shape",
  "drawingObject",
  "container",
  "textart"
]);
var INLINE_OBJECTS = /* @__PURE__ */ new Set([
  "picture",
  "pic",
  "ole",
  "chart",
  "video",
  "audio"
]);
var TRACK_CHANGE_MARKS = /* @__PURE__ */ new Set([
  "insertBegin",
  "insertEnd",
  "deleteBegin",
  "deleteEnd"
]);
function parseGenericElement(node, tag, depth = 0) {
  if (depth > 50) return { tag, attrs: {}, children: [], text: null };
  const attrs6 = getAttrs(node);
  const children = [];
  let text = null;
  if (typeof node["#text"] === "string" || typeof node["#text"] === "number") {
    text = String(node["#text"]);
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const val = node[key];
    if (val === null || val === void 0) continue;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      children.push({ tag: key, attrs: {}, children: [], text: String(val) });
      continue;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "object" && item !== null) {
          children.push(parseGenericElement(item, key, depth + 1));
        } else {
          children.push({ tag: key, attrs: {}, children: [], text: item != null ? String(item) : null });
        }
      }
    } else if (typeof val === "object") {
      children.push(parseGenericElement(val, key, depth + 1));
    }
  }
  return { tag, attrs: attrs6, children, text };
}
function parseRunChild(key, value) {
  const results = [];
  if (key === "t") {
    let content = "";
    if (typeof value === "string" || typeof value === "number") {
      content = String(value);
    } else if (typeof value === "object" && value !== null) {
      const obj = value;
      if ("#text" in obj) {
        content = String(obj["#text"]);
      }
      for (const innerKey of Object.keys(obj)) {
        if (innerKey.startsWith("@_") || innerKey === "#text") continue;
        const localKey = innerKey.includes(":") ? innerKey.split(":").pop() : innerKey;
        const innerVal = obj[innerKey];
        const items = Array.isArray(innerVal) ? innerVal : [innerVal];
        for (const item of items) {
          results.push(...parseRunChild(localKey, item));
        }
      }
    }
    results.push({ type: "text", content });
    return results;
  }
  if (key === "secPr") {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "secPr", element: parseGenericElement(node2, "secPr") });
    return results;
  }
  if (key === "ctrl") {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "ctrl", element: parseGenericElement(node2, "ctrl") });
    return results;
  }
  if (key === "tbl") {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "table", element: parseGenericElement(node2, "tbl") });
    return results;
  }
  if (key === "equation") {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "equation", element: parseGenericElement(node2, "equation") });
    return results;
  }
  if (SHAPE_OBJECTS.has(key)) {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "shape", name: key, element: parseGenericElement(node2, key) });
    return results;
  }
  if (INLINE_OBJECTS.has(key)) {
    const node2 = typeof value === "object" && value !== null ? value : {};
    results.push({ type: "inlineObject", name: key, element: parseGenericElement(node2, key) });
    return results;
  }
  if (TRACK_CHANGE_MARKS.has(key)) {
    const node2 = typeof value === "object" && value !== null ? value : {};
    const attrs6 = getAttrs(node2);
    const tc = { type: "trackChange", mark: key };
    if (attrs6["Id"]) tc.id = Number(attrs6["Id"]);
    if (attrs6["TcId"]) tc.tcId = Number(attrs6["TcId"]);
    if (attrs6["paraend"] !== void 0) tc.paraEnd = attrs6["paraend"] === "1";
    results.push(tc);
    return results;
  }
  if (key === "hiddenComment" || key === "HIDDENCOMMENT") {
    const node2 = typeof value === "object" && value !== null ? value : {};
    const paragraphs = parseHiddenCommentParagraphs(node2);
    results.push({ type: "hiddenComment", paragraphs });
    return results;
  }
  const node = typeof value === "object" && value !== null ? value : {};
  results.push({ type: "inlineObject", name: key, element: parseGenericElement(node, key) });
  return results;
}
function parseRun(node) {
  const attrs6 = getAttrs(node);
  const charPrIDRef = attrs6["charPrIDRef"] != null ? Number(attrs6["charPrIDRef"]) : null;
  const children = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_")) continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        children.push(...parseRunChild(key, item));
      }
    } else {
      children.push(...parseRunChild(key, val));
    }
  }
  return { charPrIDRef, children };
}
function parseLineSeg(node) {
  const attrs6 = getAttrs(node);
  return {
    textpos: parseIntSafe(attrs6["textpos"]),
    vertpos: parseIntSafe(attrs6["vertpos"]),
    vertsize: parseIntSafe(attrs6["vertsize"]),
    textheight: parseIntSafe(attrs6["textheight"]),
    baseline: parseIntSafe(attrs6["baseline"]),
    spacing: parseIntSafe(attrs6["spacing"]),
    horzpos: parseIntSafe(attrs6["horzpos"]),
    horzsize: parseIntSafe(attrs6["horzsize"]),
    flags: parseIntSafe(attrs6["flags"])
  };
}
function parseParagraph(node) {
  const attrs6 = getAttrs(node);
  const runs = [];
  const lineSegArray = [];
  const runNodes = getChildren(node, "run");
  for (const runNode of runNodes) {
    runs.push(parseRun(runNode));
  }
  const lsaNodes = getChildren(node, "linesegarray");
  for (const lsa of lsaNodes) {
    const segNodes = getChildren(lsa, "lineseg");
    for (const seg of segNodes) {
      lineSegArray.push(parseLineSeg(seg));
    }
  }
  return {
    id: attrs6["id"] ?? null,
    paraPrIDRef: attrs6["paraPrIDRef"] != null ? Number(attrs6["paraPrIDRef"]) : null,
    styleIDRef: attrs6["styleIDRef"] != null ? Number(attrs6["styleIDRef"]) : null,
    pageBreak: parseBool(attrs6["pageBreak"]),
    columnBreak: parseBool(attrs6["columnBreak"]),
    merged: parseBool(attrs6["merged"]),
    runs,
    lineSegArray
  };
}
function parseHiddenCommentParagraphs(node) {
  const paragraphs = [];
  for (const key of Object.keys(node)) {
    if (key.startsWith("@_") || key === "#text") continue;
    const local = key.includes(":") ? key.split(":").pop() : key;
    if (local === "p") {
      const items = Array.isArray(node[key]) ? node[key] : [node[key]];
      for (const item of items) {
        paragraphs.push(parseParagraph(item));
      }
    }
  }
  return paragraphs;
}

// vendor/handoc/packages/hwpx-parser/src/section-parser.ts
function findSecPr(paragraphs) {
  for (const p of paragraphs) {
    for (const r of p.runs) {
      for (const c of r.children) {
        if (c.type === "secPr") return c.element;
      }
    }
  }
  return void 0;
}
function parseSection(xml, warnings) {
  const root = parseXml(xml);
  const paragraphs = [];
  const sec = root["sec"];
  if (!sec) return { paragraphs };
  if (warnings) {
    const knownSecChildren = /* @__PURE__ */ new Set(["p", "@_"]);
    for (const key of Object.keys(sec)) {
      if (key.startsWith("@_") || key === "#text") continue;
      const local = key.includes(":") ? key.split(":").pop() : key;
      if (!knownSecChildren.has(local) && local !== "p") {
        warnings.add("UNKNOWN_ELEMENT", `Unknown element <${local}> under <sec>`, `sec/${local}`);
      }
    }
  }
  const pNodes = getChildren(sec, "p");
  for (const pNode of pNodes) {
    paragraphs.push(parseParagraph(pNode));
  }
  const secPrEl = findSecPr(paragraphs);
  const sectionProps = secPrEl ? parseSectionProps(secPrEl) : void 0;
  if (sectionProps) {
    for (const p of paragraphs) {
      for (const r of p.runs) {
        for (const c of r.children) {
          if (c.type === "ctrl") {
            const pageNumEl = c.element.children.find((ch) => ch.tag === "pageNum");
            if (pageNumEl && pageNumEl.attrs["pos"]) {
              sectionProps.pageNumbering = {
                pos: pageNumEl.attrs["pos"],
                formatType: pageNumEl.attrs["formatType"] ?? "DIGIT",
                sideChar: pageNumEl.attrs["sideChar"] ?? ""
              };
            }
          }
        }
      }
    }
  }
  return { paragraphs, sectionProps };
}
function collectTextFromElement(el) {
  const lines = [];
  if (el.text) {
    lines.push(el.text);
  }
  for (const child of el.children) {
    lines.push(...collectTextFromElement(child));
  }
  return lines;
}
function collectTextFromRunChild(rc) {
  if (rc.type === "text") {
    return [rc.content];
  }
  if (rc.type === "table" || rc.type === "inlineObject" || rc.type === "ctrl" || rc.type === "secPr") {
    return collectTextFromElement(rc.element);
  }
  return [];
}
function extractParagraphText(p) {
  const directText = p.runs.flatMap(
    (r) => r.children.filter((c) => c.type === "text").map((c) => c.content)
  ).join("");
  const nestedLines = [];
  for (const r of p.runs) {
    for (const c of r.children) {
      if (c.type !== "text") {
        nestedLines.push(...collectTextFromRunChild(c));
      }
    }
  }
  const result = [];
  if (directText) result.push(directText);
  result.push(...nestedLines.filter((l) => l.length > 0));
  return result;
}
function extractText(section) {
  return section.paragraphs.flatMap((p) => extractParagraphText(p));
}

// vendor/handoc/packages/hwpx-parser/src/image-extractor.ts
var EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".emf": "image/x-emf",
  ".wmf": "image/x-wmf",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml"
};
function guessMimeType(path) {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  const ext = path.slice(dot).toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}
function extractImages(pkg) {
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const name of pkg.partNames()) {
    if (/(?:^|\/)?BinData\//i.test(name)) {
      if (seen.has(name)) continue;
      seen.add(name);
      results.push({
        path: name,
        mimeType: guessMimeType(name),
        data: pkg.getPart(name)
      });
    }
  }
  return results;
}

// vendor/handoc/packages/hwpx-parser/src/annotation-parser.ts
function parseHeaderFooter(element) {
  const hf = findChildByTag(element, "header") ?? findChildByTag(element, "footer");
  if (!hf) {
    if (element.tag === "header" || element.tag === "footer") {
      return buildHeaderFooter(element);
    }
    return null;
  }
  return buildHeaderFooter(hf);
}
function buildHeaderFooter(hf) {
  const type = hf.tag === "header" ? "header" : "footer";
  const applyPageType = hf.attrs["applyPageType"] ?? "BOTH";
  const paragraphs = extractParagraphsFromSubList(hf);
  return { type, applyPageType, paragraphs };
}
function parseFootnote(element) {
  const fn = findChildByTag(element, "footnote") ?? findChildByTag(element, "endnote");
  if (!fn) {
    if (element.tag === "footnote" || element.tag === "endnote") {
      return buildFootnote(element);
    }
    return null;
  }
  return buildFootnote(fn);
}
function buildFootnote(fn) {
  const type = fn.tag === "footnote" ? "footnote" : "endnote";
  const paragraphs = extractParagraphsFromSubList(fn);
  return { type, paragraphs };
}
function findChildByTag(el, tag) {
  return el.children.find((c) => c.tag === tag);
}
function extractParagraphsFromSubList(el) {
  const paragraphs = [];
  const subList = findChildByTag(el, "subList");
  const container = subList ?? el;
  for (const child of container.children) {
    if (child.tag === "p") {
      paragraphs.push(parseParagraphFromGeneric(child));
    }
  }
  return paragraphs;
}
function parseParagraphFromGeneric(el) {
  const rawNode = genericToRawNode(el);
  return parseParagraph(rawNode);
}
function genericToRawNode(el) {
  const node = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    node[`@_${k}`] = v;
  }
  if (el.text !== null) {
    node["#text"] = el.text;
  }
  const groups = /* @__PURE__ */ new Map();
  for (const child of el.children) {
    const raw = genericToRawNode(child);
    if (!groups.has(child.tag)) {
      groups.set(child.tag, []);
    }
    groups.get(child.tag).push(raw);
  }
  for (const [tag, items] of groups) {
    node[tag] = items.length === 1 ? items[0] : items;
  }
  return node;
}
function collectHeadersFooters(sections) {
  const results = [];
  for (const section of sections) {
    for (const para of section.paragraphs) {
      for (const run of para.runs) {
        for (const child of run.children) {
          if (child.type === "ctrl") {
            const hf = parseHeaderFooter(child.element);
            if (hf) results.push(hf);
          }
        }
      }
    }
  }
  return results;
}
function collectFootnotes(sections) {
  const results = [];
  for (const section of sections) {
    for (const para of section.paragraphs) {
      for (const run of para.runs) {
        for (const child of run.children) {
          if (child.type === "ctrl") {
            const fn = parseFootnote(child.element);
            if (fn) results.push(fn);
          }
        }
      }
    }
  }
  return results;
}

// vendor/handoc/packages/hwpx-parser/src/shape-parser.ts
function parseShape(element) {
  const type = element.tag;
  const szChild = findChild3(element, "sz");
  const width = szChild ? parseNum(szChild.attrs["width"]) : void 0;
  const height = szChild ? parseNum(szChild.attrs["height"]) : void 0;
  const paragraphs = [];
  const drawText = findChild3(element, "drawText");
  if (drawText) {
    const subList = findChild3(drawText, "subList");
    const pSource = subList ?? drawText;
    for (const child of pSource.children) {
      if (child.tag === "p") {
        paragraphs.push(parseParagraphFromGeneric2(child));
      }
    }
  }
  const textContent = paragraphs.length > 0 ? paragraphs.map((p) => p.runs.map((r) => r.children.filter((c) => c.type === "text").map((c) => c.content).join("")).join("")).join("\n") : void 0;
  return {
    type,
    width,
    height,
    textContent: textContent || void 0,
    paragraphs,
    children: element.children
  };
}
function findChild3(el, tag) {
  return el.children.find((c) => c.tag === tag);
}
function parseNum(val) {
  if (val == null) return void 0;
  const n = Number(val);
  return isNaN(n) ? void 0 : n;
}
function parseParagraphFromGeneric2(el) {
  const raw = genericToRaw(el);
  return parseParagraph(raw);
}
function genericToRaw(el) {
  const obj = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    obj[`@_${k}`] = v;
  }
  if (el.text != null) {
    obj["#text"] = el.text;
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const child of el.children) {
    const arr = grouped.get(child.tag) ?? [];
    arr.push(genericToRaw(child));
    grouped.set(child.tag, arr);
  }
  for (const [tag, items] of grouped) {
    obj[tag] = items.length === 1 ? items[0] : items;
  }
  return obj;
}

// vendor/handoc/packages/hwpx-parser/src/equation-parser.ts
function parseEquation(element) {
  const scriptChild = element.children.find((c) => c.tag === "script");
  const script = scriptChild?.text ?? "";
  const font = element.attrs["font"] || void 0;
  const baseUnit = element.attrs["baseUnit"] ? Number(element.attrs["baseUnit"]) : void 0;
  const version = element.attrs["version"] || void 0;
  return {
    script,
    font,
    baseUnit: baseUnit != null && !isNaN(baseUnit) ? baseUnit : void 0,
    version
  };
}

// vendor/handoc/packages/hwpx-parser/src/handoc.ts
var HanDoc = class _HanDoc {
  pkg;
  _header = null;
  _sections = null;
  _images = null;
  _headers = null;
  _footers = null;
  _footnotes = null;
  _shapes = null;
  _equations = null;
  _warnings = new WarningCollector();
  constructor(pkg) {
    this.pkg = pkg;
  }
  /**
   * Open an HWPX file from a buffer (ZIP bytes).
   * Alias for `open()` — note this is async despite the name,
   * because OpcPackage.open() is async.
   */
  static async fromBuffer(buf) {
    return _HanDoc.open(buf);
  }
  /**
   * Open an HWPX file from a buffer (ZIP bytes).
   */
  static async open(buf) {
    const pkg = await OpcPackage.open(buf);
    return new _HanDoc(pkg);
  }
  get header() {
    if (!this._header) {
      const paths = this.pkg.getHeaderPaths();
      if (paths.length === 0) {
        throw new Error("No header found in document");
      }
      const headerPath = paths[0].startsWith("Contents/") ? paths[0] : `Contents/${paths[0]}`;
      const xml = this.pkg.getPartAsText(headerPath);
      this._header = parseHeader(xml, this._warnings);
    }
    return this._header;
  }
  get sections() {
    if (!this._sections) {
      const paths = this.pkg.getSectionPaths().filter((p) => p.toLowerCase().endsWith(".xml"));
      this._sections = paths.map((p) => {
        const fullPath = p.startsWith("Contents/") ? p : `Contents/${p}`;
        const xml = this.pkg.getPartAsText(fullPath);
        return parseSection(xml, this._warnings);
      });
    }
    return this._sections;
  }
  /** Access the underlying OPC package (for roundtrip preservation). */
  get opcPackage() {
    return this.pkg;
  }
  get metadata() {
    return this.pkg.getMetadata();
  }
  /**
   * All images/binary data found in BinData/ (lazy loaded).
   */
  get images() {
    if (!this._images) {
      this._images = extractImages(this.pkg);
    }
    return this._images;
  }
  /**
   * Get a single image by its path within the ZIP.
   * Returns null if not found.
   */
  getImage(path) {
    const reference = (this.pkg.resolveItemPath(path) ?? path).replace(/^(?:\.\.\/)+/, "").replace(/^\//, "");
    const img = this.images.find((i) => i.path === reference || i.path === `Contents/${reference}` || i.path === `BinData/${reference}`);
    return img?.data ?? null;
  }
  /**
   * Section properties of the first section (or undefined if not available).
   */
  get sectionProps() {
    return this.sections[0]?.sectionProps;
  }
  /**
   * Whether the first section is in landscape orientation.
   */
  get landscape() {
    return this.sectionProps?.landscape ?? false;
  }
  /**
   * Page size in mm (from the first section).
   * Returns { width: 210, height: 297 } for A4.
   */
  get pageSize() {
    const props = this.sectionProps;
    if (!props) return { width: 210, height: 297 };
    return {
      width: Math.round(hwpUnitToMm(props.pageWidth)),
      height: Math.round(hwpUnitToMm(props.pageHeight))
    };
  }
  /**
   * Page margins in mm (from the first section).
   */
  get margins() {
    const props = this.sectionProps;
    if (!props) {
      return { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0, gutter: 0 };
    }
    const m = props.margins;
    return {
      left: Math.round(hwpUnitToMm(m.left) * 10) / 10,
      right: Math.round(hwpUnitToMm(m.right) * 10) / 10,
      top: Math.round(hwpUnitToMm(m.top) * 10) / 10,
      bottom: Math.round(hwpUnitToMm(m.bottom) * 10) / 10,
      header: Math.round(hwpUnitToMm(m.header) * 10) / 10,
      footer: Math.round(hwpUnitToMm(m.footer) * 10) / 10,
      gutter: Math.round(hwpUnitToMm(m.gutter) * 10) / 10
    };
  }
  /**
   * All headers found in the document (from ctrl elements in section paragraphs).
   */
  get headers() {
    if (!this._headers) {
      const all = collectHeadersFooters(this.sections);
      this._headers = all.filter((h) => h.type === "header");
      this._footers = all.filter((h) => h.type === "footer");
    }
    return this._headers;
  }
  /**
   * All footers found in the document.
   */
  get footers() {
    if (!this._footers) {
      void this.headers;
    }
    return this._footers;
  }
  /**
   * All footnotes and endnotes found in the document.
   */
  get footnotes() {
    if (!this._footnotes) {
      this._footnotes = collectFootnotes(this.sections);
    }
    return this._footnotes;
  }
  /**
   * All shapes (rect, ellipse, line, etc.) found in document paragraphs.
   */
  get shapes() {
    if (!this._shapes) {
      this._shapes = [];
      for (const section of this.sections) {
        for (const para of section.paragraphs) {
          for (const run of para.runs) {
            for (const child of run.children) {
              if (child.type === "shape") {
                this._shapes.push(parseShape(child.element));
              }
            }
          }
        }
      }
    }
    return this._shapes;
  }
  /**
   * All equations found in document paragraphs.
   */
  get equations() {
    if (!this._equations) {
      this._equations = [];
      for (const section of this.sections) {
        for (const para of section.paragraphs) {
          for (const run of para.runs) {
            for (const child of run.children) {
              if (child.type === "equation") {
                this._equations.push(parseEquation(child.element));
              }
            }
          }
        }
      }
    }
    return this._equations;
  }
  /**
   * Track changes found in the document header.
   * Each entry includes the resolved author name.
   */
  get trackChanges() {
    const h = this.header;
    const hdr = h;
    const entries = hdr.trackChanges ?? [];
    const authors = hdr.trackChangeAuthors ?? [];
    const authorById = /* @__PURE__ */ new Map();
    const authorByMark = /* @__PURE__ */ new Map();
    for (const a of authors) {
      authorById.set(a.id, a.name);
      authorByMark.set(a.mark, a.name);
    }
    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      date: e.date,
      author: authorById.get(e.authorID) ?? authorByMark.get(e.authorID) ?? `Author#${e.authorID}`,
      hide: e.hide
    }));
  }
  /**
   * Hidden comments (메모/주석) found inline in the document.
   */
  get hiddenComments() {
    const results = [];
    for (const section of this.sections) {
      for (const para of section.paragraphs) {
        for (const run of para.runs) {
          for (const child of run.children) {
            if (child.type === "hiddenComment") {
              const text = child.paragraphs.flatMap((p) => p.runs.flatMap((r) => r.children.filter((c) => c.type === "text").map((c) => c.content))).join("");
              results.push({ text, paragraphs: child.paragraphs });
            }
          }
        }
      }
    }
    return results;
  }
  /**
   * Warnings collected during parsing.
   */
  get warnings() {
    return this._warnings.toJSON();
  }
  /** The underlying warning collector (for internal use by parsers). */
  get warningCollector() {
    return this._warnings;
  }
  /**
   * Extract all text from the document (all sections joined by newlines).
   */
  extractText() {
    return this.sections.flatMap((sec) => extractText(sec)).join("\n");
  }
  /**
   * Extract text per section.
   */
  extractTextBySection() {
    return this.sections.map((sec) => extractText(sec).join("\n"));
  }
};

// vendor/handoc/packages/hwpx-parser/src/table-parser.ts
function int(v, fallback = 0) {
  if (v === void 0) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function bool(v) {
  return v === "1" || v === "true";
}
function findChild4(el, tag) {
  return el.children.find((c) => c.tag === tag);
}
function findAllChildren2(el, tag) {
  return el.children.filter((c) => c.tag === tag);
}
function parseCellFromGeneric(tc) {
  const addr = findChild4(tc, "cellAddr");
  const span = findChild4(tc, "cellSpan");
  const sz = findChild4(tc, "cellSz");
  const margin = findChild4(tc, "cellMargin");
  const paragraphs = [];
  const subList = findChild4(tc, "subList");
  let vertAlign;
  if (subList) {
    for (const pEl of findAllChildren2(subList, "p")) {
      paragraphs.push(parseParagraphFromGeneric3(pEl));
    }
    vertAlign = subList.attrs["vertAlign"];
  }
  const cellMargin = margin ? {
    left: int(margin.attrs["left"], 0),
    right: int(margin.attrs["right"], 0),
    top: int(margin.attrs["top"], 0),
    bottom: int(margin.attrs["bottom"], 0)
  } : void 0;
  return {
    name: tc.attrs["name"] ?? "",
    header: bool(tc.attrs["header"]),
    borderFillIDRef: int(tc.attrs["borderFillIDRef"]),
    cellAddr: {
      colAddr: int(addr?.attrs["colAddr"]),
      rowAddr: int(addr?.attrs["rowAddr"])
    },
    cellSpan: {
      colSpan: int(span?.attrs["colSpan"], 1),
      rowSpan: int(span?.attrs["rowSpan"], 1)
    },
    cellSz: {
      width: int(sz?.attrs["width"]),
      height: int(sz?.attrs["height"])
    },
    cellMargin,
    vertAlign,
    paragraphs
  };
}
function genericToRawNode2(el) {
  const node = {};
  for (const [k, v] of Object.entries(el.attrs)) {
    node["@_" + k] = v;
  }
  if (el.text != null) {
    node["#text"] = el.text;
  }
  const grouped = /* @__PURE__ */ new Map();
  for (const child of el.children) {
    const arr = grouped.get(child.tag) ?? [];
    arr.push(genericToRawNode2(child));
    grouped.set(child.tag, arr);
  }
  for (const [tag, items] of grouped) {
    node[tag] = items.length === 1 ? items[0] : items;
  }
  return node;
}
function parseParagraphFromGeneric3(pEl) {
  return parseParagraph(genericToRawNode2(pEl));
}
function parseTable(element) {
  const a = element.attrs;
  const rows = [];
  for (const trEl of findAllChildren2(element, "tr")) {
    const cells = [];
    for (const tcEl of findAllChildren2(trEl, "tc")) {
      cells.push(parseCellFromGeneric(tcEl));
    }
    rows.push({ cells });
  }
  return {
    id: a["id"] ?? "",
    rowCnt: int(a["rowCnt"]),
    colCnt: int(a["colCnt"]),
    cellSpacing: int(a["cellSpacing"]),
    borderFillIDRef: int(a["borderFillIDRef"]),
    repeatHeader: bool(a["repeatHeader"]),
    noAdjust: bool(a["noAdjust"]),
    rows
  };
}

// vendor/handoc/packages/hwpx-writer/src/xml-helpers.ts
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function attrs(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(` ${k}="${escapeXml(String(v))}"`);
  }
  return parts.join("");
}
function writeGenericElement(el, prefix = "hh") {
  const tag = el.tag.includes(":") ? el.tag : `${prefix}:${el.tag}`;
  const hasChildren = el.children.length > 0;
  const hasText = el.text !== null && el.text !== void 0;
  if (!hasChildren && !hasText) {
    return `<${tag}${attrs(el.attrs)}/>`;
  }
  let xml = `<${tag}${attrs(el.attrs)}>`;
  if (hasText) {
    xml += escapeXml(el.text);
  }
  for (const child of el.children) {
    xml += writeGenericElement(child, prefix);
  }
  xml += `</${tag}>`;
  return xml;
}

// vendor/handoc/packages/hwpx-writer/src/header-writer.ts
function attrs2(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(` ${k}="${escapeXml(String(v))}"`);
  }
  return parts.join("");
}
function selfClose(tag, a) {
  return `<${tag}${attrs2(a)}/>`;
}
function open(tag, a = {}) {
  return `<${tag}${attrs2(a)}>`;
}
function close(tag) {
  return `</${tag}>`;
}
var HEADER_NS = {
  "xmlns:ha": "http://www.hancom.co.kr/hwpml/2011/app",
  "xmlns:hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
  "xmlns:hp10": "http://www.hancom.co.kr/hwpml/2016/paragraph",
  "xmlns:hs": "http://www.hancom.co.kr/hwpml/2011/section",
  "xmlns:hc": "http://www.hancom.co.kr/hwpml/2011/core",
  "xmlns:hh": "http://www.hancom.co.kr/hwpml/2011/head",
  "xmlns:hhs": "http://www.hancom.co.kr/hwpml/2011/history",
  "xmlns:hm": "http://www.hancom.co.kr/hwpml/2011/master-page",
  "xmlns:hpf": "http://www.hancom.co.kr/schema/2011/hpf",
  "xmlns:dc": "http://purl.org/dc/elements/1.1/",
  "xmlns:opf": "http://www.idpf.org/2007/opf/",
  "xmlns:ooxmlchart": "http://www.hancom.co.kr/hwpml/2016/ooxmlchart",
  "xmlns:hwpunitchar": "http://www.hancom.co.kr/hwpml/2016/HwpUnitChar",
  "xmlns:epub": "http://www.idpf.org/2007/ops",
  "xmlns:config": "urn:oasis:names:tc:opendocument:xmlns:config:1.0"
};
function writeHeader(header) {
  const headAttrs = {
    ...HEADER_NS,
    version: header.version,
    secCnt: String(header.secCnt)
  };
  let xml = '<?xml version="1.0" encoding="UTF-8" ?>\n';
  xml += open("hh:head", headAttrs);
  xml += selfClose("hh:beginNum", {
    page: String(header.beginNum.page),
    footnote: String(header.beginNum.footnote),
    endnote: String(header.beginNum.endnote),
    pic: String(header.beginNum.pic),
    tbl: String(header.beginNum.tbl),
    equation: String(header.beginNum.equation)
  });
  xml += writeRefList(header.refList);
  if (header.extra) {
    for (const el of header.extra) {
      xml += writeGenericElement(el, "hh");
    }
  }
  xml += close("hh:head");
  return xml;
}
function writeRefList(ref) {
  let xml = open("hh:refList");
  xml += writeFontFaces(ref.fontFaces);
  if (ref.borderFills.length > 0) {
    xml += open("hh:borderFills", { itemCnt: String(ref.borderFills.length) });
    for (const bf of ref.borderFills) {
      xml += writeGenericElement(bf, "hh");
    }
    xml += close("hh:borderFills");
  }
  xml += writeCharProperties(ref.charProperties);
  xml += writeTabProperties(ref.tabProperties ?? []);
  xml += writeNumberings(ref.numberings ?? []);
  xml += writeBullets(ref.bullets ?? []);
  xml += writeParaProperties(ref.paraProperties);
  xml += writeStyles(ref.styles);
  for (const el of ref.others) {
    xml += writeGenericElement(el, "hh");
  }
  xml += close("hh:refList");
  return xml;
}
function writeFontFaces(fontFaces) {
  if (fontFaces.length === 0) return "";
  const totalFonts = fontFaces.reduce((sum, ff) => sum + ff.fonts.length, 0);
  let xml = open("hh:fontfaces", { itemCnt: String(totalFonts) });
  for (const ff of fontFaces) {
    xml += open("hh:fontface", { lang: ff.lang, fontCnt: String(ff.fonts.length) });
    for (const f of ff.fonts) {
      xml += selfClose("hh:font", {
        id: String(f.id),
        face: f.face,
        type: f.type,
        isEmbedded: f.isEmbedded ? "1" : "0"
      });
    }
    xml += close("hh:fontface");
  }
  xml += close("hh:fontfaces");
  return xml;
}
function writeCharProperties(charProps) {
  if (charProps.length === 0) return "";
  let xml = open("hh:charProperties", { itemCnt: String(charProps.length) });
  for (const cp of charProps) {
    if (cp.children.length === 0) {
      xml += selfClose("hh:charPr", cp.attrs);
    } else {
      xml += open("hh:charPr", cp.attrs);
      for (const child of cp.children) {
        xml += writeGenericElement(child, "hh");
      }
      xml += close("hh:charPr");
    }
  }
  xml += close("hh:charProperties");
  return xml;
}
function writeParaProperties(paraProps) {
  if (paraProps.length === 0) return "";
  let xml = open("hh:paraProperties", { itemCnt: String(paraProps.length) });
  for (const pp of paraProps) {
    const hasChildren = pp.children.length > 0;
    const hasHeading = pp.heading !== void 0;
    const headingInChildren = pp.children.some((c) => c.tag.toLowerCase().endsWith("heading"));
    const needsHeading = hasHeading && !headingInChildren;
    const needsOpen = hasChildren || needsHeading;
    if (!needsOpen) {
      xml += selfClose("hh:paraPr", pp.attrs);
    } else {
      xml += open("hh:paraPr", pp.attrs);
      for (const child of pp.children) {
        xml += writeGenericElement(child, "hh");
      }
      if (needsHeading) {
        const headingAttrs = {
          type: pp.heading.type,
          idRef: String(pp.heading.idRef),
          level: String(pp.heading.level)
        };
        xml += selfClose("hh:heading", headingAttrs);
      }
      xml += close("hh:paraPr");
    }
  }
  xml += close("hh:paraProperties");
  return xml;
}
function writeTabProperties(tabProps) {
  if (tabProps.length === 0) return "";
  let xml = open("hh:tabProperties", { itemCnt: String(tabProps.length) });
  for (const tp of tabProps) {
    const tpAttrs = { id: String(tp.id) };
    if (tp.autoTabLeft !== void 0) tpAttrs.autoTabLeft = tp.autoTabLeft ? "1" : "0";
    if (tp.autoTabRight !== void 0) tpAttrs.autoTabRight = tp.autoTabRight ? "1" : "0";
    if (tp.tabStops.length === 0) {
      xml += selfClose("hh:tabPr", tpAttrs);
    } else {
      xml += open("hh:tabPr", tpAttrs);
      for (const ts of tp.tabStops) {
        const tsAttrs = { pos: String(ts.pos) };
        if (ts.type) tsAttrs.type = ts.type;
        if (ts.leader) tsAttrs.leader = ts.leader;
        if (ts.unit) tsAttrs.unit = ts.unit;
        xml += selfClose("hh:tabItem", tsAttrs);
      }
      xml += close("hh:tabPr");
    }
  }
  xml += close("hh:tabProperties");
  return xml;
}
function writeNumberings(numberings) {
  if (numberings.length === 0) return "";
  let xml = open("hh:numberings", { itemCnt: String(numberings.length) });
  for (const num2 of numberings) {
    const numAttrs = {
      id: String(num2.id),
      start: String(num2.start)
    };
    xml += open("hh:numbering", numAttrs);
    for (const level of num2.levels) {
      xml += writeParaHead(level);
    }
    xml += close("hh:numbering");
  }
  xml += close("hh:numberings");
  return xml;
}
function writeBullets(bullets) {
  if (bullets.length === 0) return "";
  let xml = open("hh:bullets", { itemCnt: String(bullets.length) });
  for (const bul of bullets) {
    const bulAttrs = {
      id: String(bul.id),
      char: bul.char
    };
    if (bul.useImage !== void 0) bulAttrs.useImage = bul.useImage ? "1" : "0";
    xml += open("hh:bullet", bulAttrs);
    for (const level of bul.levels) {
      xml += writeParaHead(level);
    }
    xml += close("hh:bullet");
  }
  xml += close("hh:bullets");
  return xml;
}
function writeParaHead(ph) {
  const phAttrs = {
    level: String(ph.level)
  };
  if (ph.start !== void 0) phAttrs.start = String(ph.start);
  if (ph.align) phAttrs.align = ph.align;
  if (ph.useInstWidth !== void 0) phAttrs.useInstWidth = ph.useInstWidth ? "1" : "0";
  if (ph.autoIndent !== void 0) phAttrs.autoIndent = ph.autoIndent ? "1" : "0";
  if (ph.widthAdjust !== void 0) phAttrs.widthAdjust = String(ph.widthAdjust);
  if (ph.textOffsetType) phAttrs.textOffsetType = ph.textOffsetType;
  if (ph.textOffset !== void 0) phAttrs.textOffset = String(ph.textOffset);
  if (ph.numFormat) phAttrs.numFormat = ph.numFormat;
  if (ph.charPrIDRef !== void 0) phAttrs.charPrIDRef = String(ph.charPrIDRef);
  if (ph.checkable !== void 0) phAttrs.checkable = ph.checkable ? "1" : "0";
  if (ph.text) {
    return `<hh:paraHead${attrs2(phAttrs)}>${escapeXml(ph.text)}</hh:paraHead>`;
  } else {
    return selfClose("hh:paraHead", phAttrs);
  }
}
function writeStyles(styles) {
  if (styles.length === 0) return "";
  let xml = open("hh:styles", { itemCnt: String(styles.length) });
  for (const s of styles) {
    xml += selfClose("hh:style", s.attrs);
  }
  xml += close("hh:styles");
  return xml;
}

// vendor/handoc/packages/hwpx-writer/src/serializers/shape-serializer.ts
function attrs3(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(` ${k}="${escapeXml(String(v))}"`);
  }
  return parts.join("");
}
function open2(tag, a = {}) {
  return `<${tag}${attrs3(a)}>`;
}
function close2(tag) {
  return `</${tag}>`;
}
function selfClose2(tag, a) {
  return `<${tag}${attrs3(a)}/>`;
}
function serializeShape(element, nsPrefix = "hp") {
  const shapeTag = element.tag;
  const shapeAttrs = { ...element.attrs };
  let xml = open2(`${nsPrefix}:${shapeTag}`, shapeAttrs);
  for (const child of element.children) {
    xml += serializeShapeChild(child, nsPrefix);
  }
  xml += close2(`${nsPrefix}:${shapeTag}`);
  return xml;
}
function serializeShapeChild(child, nsPrefix) {
  const tag = child.tag;
  const childAttrs = { ...child.attrs };
  switch (tag) {
    case "sz":
    case "pos":
    case "angle":
    case "flip":
    case "lineShape":
    case "fillBrush":
    case "shadowEffect":
    case "lineEffect":
    case "strokeEffect":
    case "rotationInfo":
    case "renderingInfo":
    case "effect":
      if (child.children.length === 0 && !child.text) {
        return selfClose2(`${nsPrefix}:${tag}`, childAttrs);
      }
      let xml = open2(`${nsPrefix}:${tag}`, childAttrs);
      for (const grandChild of child.children) {
        xml += serializeShapeChild(grandChild, nsPrefix);
      }
      if (child.text) {
        xml += escapeXml(child.text);
      }
      xml += close2(`${nsPrefix}:${tag}`);
      return xml;
    case "drawText":
      return serializeDrawText(child, nsPrefix);
    case "subList":
      return serializeSubList(child, nsPrefix);
    case "p":
      return serializeParagraph(child, nsPrefix);
    case "run":
      return serializeRun(child, nsPrefix);
    case "t":
      if (child.text && child.text.length > 0) {
        return `<${nsPrefix}:${tag}${attrs3(childAttrs)}>${escapeXml(child.text)}</${nsPrefix}:${tag}>`;
      }
      return `<${nsPrefix}:${tag}${attrs3(childAttrs)}/>`;
    default:
      if (child.children.length === 0 && !child.text) {
        return selfClose2(`${nsPrefix}:${tag}`, childAttrs);
      }
      let fallbackXml = open2(`${nsPrefix}:${tag}`, childAttrs);
      for (const grandChild of child.children) {
        fallbackXml += serializeShapeChild(grandChild, nsPrefix);
      }
      if (child.text) {
        fallbackXml += escapeXml(child.text);
      }
      fallbackXml += close2(`${nsPrefix}:${tag}`);
      return fallbackXml;
  }
}
function serializeDrawText(element, nsPrefix) {
  const drawTextAttrs = { ...element.attrs };
  let xml = open2(`${nsPrefix}:drawText`, drawTextAttrs);
  for (const child of element.children) {
    xml += serializeShapeChild(child, nsPrefix);
  }
  xml += close2(`${nsPrefix}:drawText`);
  return xml;
}
function serializeSubList(element, nsPrefix) {
  const subListAttrs = { ...element.attrs };
  let xml = open2(`${nsPrefix}:subList`, subListAttrs);
  for (const child of element.children) {
    xml += serializeShapeChild(child, nsPrefix);
  }
  xml += close2(`${nsPrefix}:subList`);
  return xml;
}
function serializeParagraph(element, nsPrefix) {
  const pAttrs = { ...element.attrs };
  let xml = open2(`${nsPrefix}:p`, pAttrs);
  for (const child of element.children) {
    xml += serializeShapeChild(child, nsPrefix);
  }
  xml += close2(`${nsPrefix}:p`);
  return xml;
}
function serializeRun(element, nsPrefix) {
  const runAttrs = { ...element.attrs };
  let xml = open2(`${nsPrefix}:run`, runAttrs);
  for (const child of element.children) {
    xml += serializeShapeChild(child, nsPrefix);
  }
  xml += close2(`${nsPrefix}:run`);
  return xml;
}

// vendor/handoc/packages/hwpx-writer/src/serializers/equation-serializer.ts
function attrs4(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(` ${k}="${escapeXml(String(v))}"`);
  }
  return parts.join("");
}
function open3(tag, a = {}) {
  return `<${tag}${attrs4(a)}>`;
}
function close3(tag) {
  return `</${tag}>`;
}
function selfClose3(tag, a) {
  return `<${tag}${attrs4(a)}/>`;
}
function serializeEquation(element, nsPrefix = "hc") {
  const eqAttrs = { ...element.attrs };
  let xml = open3(`${nsPrefix}:equation`, eqAttrs);
  for (const child of element.children) {
    xml += serializeEquationChild(child, nsPrefix);
  }
  xml += close3(`${nsPrefix}:equation`);
  return xml;
}
function serializeEquationChild(child, nsPrefix) {
  const tag = child.tag;
  const childAttrs = { ...child.attrs };
  switch (tag) {
    case "script":
      if (child.text && child.text.length > 0) {
        return `<${nsPrefix}:${tag}${attrs4(childAttrs)}>${escapeXml(child.text)}</${nsPrefix}:${tag}>`;
      }
      return `<${nsPrefix}:${tag}${attrs4(childAttrs)}/>`;
    case "sz":
      return selfClose3(`${nsPrefix}:${tag}`, childAttrs);
    default:
      if (child.children.length === 0 && !child.text) {
        return selfClose3(`${nsPrefix}:${tag}`, childAttrs);
      }
      let fallbackXml = open3(`${nsPrefix}:${tag}`, childAttrs);
      for (const grandChild of child.children) {
        fallbackXml += serializeEquationChild(grandChild, nsPrefix);
      }
      if (child.text) {
        fallbackXml += escapeXml(child.text);
      }
      fallbackXml += close3(`${nsPrefix}:${tag}`);
      return fallbackXml;
  }
}

// vendor/handoc/packages/hwpx-writer/src/section-writer.ts
var SECTION_NS = {
  "xmlns:hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
  "xmlns:hs": "http://www.hancom.co.kr/hwpml/2011/section",
  "xmlns:hc": "http://www.hancom.co.kr/hwpml/2011/core",
  "xmlns:hh": "http://www.hancom.co.kr/hwpml/2011/head"
};
function attrs5(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    parts.push(` ${k}="${escapeXml(String(v))}"`);
  }
  return parts.join("");
}
function selfClose4(tag, a) {
  return `<${tag}${attrs5(a)}/>`;
}
function open4(tag, a = {}) {
  return `<${tag}${attrs5(a)}>`;
}
function close4(tag) {
  return `</${tag}>`;
}
function writeSection(section) {
  let xml = '<?xml version="1.0" encoding="UTF-8" ?>\n';
  xml += open4("hs:sec", SECTION_NS);
  for (let i = 0; i < section.paragraphs.length; i++) {
    const p = section.paragraphs[i];
    xml += writeParagraph(p);
    if (i === 0 && section.sectionProps && !hasSectionProps(section)) {
      xml += writeSecPrFromProps(section.sectionProps);
    }
  }
  xml += close4("hs:sec");
  return xml;
}
function hasSectionProps(section) {
  for (const p of section.paragraphs) {
    for (const r of p.runs) {
      for (const c of r.children) {
        if (c.type === "secPr") return true;
      }
    }
  }
  return false;
}
function writeSecPrFromProps(sp) {
  let xml = open4("hp:p", { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" });
  xml += open4("hp:run", { charPrIDRef: "0" });
  xml += `<hp:secPr>`;
  xml += open4("hp:pagePr", {
    width: String(sp.pageWidth),
    height: String(sp.pageHeight),
    landscape: sp.landscape ? "WIDELY" : "NARROWLY"
  });
  xml += selfClose4("hp:margin", {
    left: String(sp.margins.left),
    right: String(sp.margins.right),
    top: String(sp.margins.top),
    bottom: String(sp.margins.bottom),
    header: String(sp.margins.header),
    footer: String(sp.margins.footer)
  });
  xml += close4("hp:pagePr");
  xml += `</hp:secPr>`;
  xml += close4("hp:run");
  xml += close4("hp:p");
  return xml;
}
function writeParagraph(p) {
  const pAttrs = {};
  if (p.id !== null) pAttrs.id = p.id;
  if (p.paraPrIDRef !== null) pAttrs.paraPrIDRef = String(p.paraPrIDRef);
  if (p.styleIDRef !== null) pAttrs.styleIDRef = String(p.styleIDRef);
  pAttrs.pageBreak = p.pageBreak ? "1" : "0";
  pAttrs.columnBreak = p.columnBreak ? "1" : "0";
  pAttrs.merged = p.merged ? "1" : "0";
  let xml = open4("hp:p", pAttrs);
  for (const run of p.runs) {
    xml += writeRun(run);
  }
  if (p.lineSegArray.length > 0) {
    xml += open4("hp:linesegarray");
    for (const ls of p.lineSegArray) {
      xml += writeLineSeg(ls);
    }
    xml += close4("hp:linesegarray");
  }
  xml += close4("hp:p");
  return xml;
}
function writeRun(run) {
  const runAttrs = {};
  if (run.charPrIDRef !== null) runAttrs.charPrIDRef = String(run.charPrIDRef);
  let xml = open4("hp:run", runAttrs);
  for (const child of run.children) {
    xml += writeRunChild(child);
  }
  xml += close4("hp:run");
  return xml;
}
function writeRunChild(child) {
  switch (child.type) {
    case "text":
      if (child.content === "") {
        return "<hp:t/>";
      }
      return `<hp:t>${escapeXml(child.content)}</hp:t>`;
    case "secPr":
      return writeGenericElement(child.element, "hp");
    case "ctrl":
      return writeGenericElement(child.element, "hp");
    case "table":
      return writeTable(child.element);
    case "inlineObject":
      return writeInlineObject(child.element, child.name);
    case "shape":
      return serializeShape(child.element, "hp");
    case "equation":
      return serializeEquation(child.element, "hc");
    case "trackChange":
      return `<hp:${child.mark}/>`;
    default:
      return "";
  }
}
function writeLineSeg(ls) {
  return selfClose4("hp:lineseg", {
    textpos: String(ls.textpos),
    vertpos: String(ls.vertpos),
    vertsize: String(ls.vertsize),
    textheight: String(ls.textheight),
    baseline: String(ls.baseline),
    spacing: String(ls.spacing),
    horzpos: String(ls.horzpos),
    horzsize: String(ls.horzsize),
    flags: String(ls.flags)
  });
}
function writeTable(element) {
  try {
    const tblAttrs = { ...element.attrs };
    let xml = open4("hp:tbl", tblAttrs);
    for (const child of element.children) {
      if (child.tag === "tr") {
        xml += writeTableRow(child);
      } else {
        xml += writeGenericElement(child, "hp");
      }
    }
    xml += close4("hp:tbl");
    return xml;
  } catch (err) {
    return writeGenericElement(element, "hp");
  }
}
function writeTableRow(row) {
  let xml = open4("hp:tr", row.attrs);
  for (const tc of row.children) {
    if (tc.tag === "tc") {
      xml += writeTableCell(tc);
    } else {
      xml += writeGenericElement(tc, "hp");
    }
  }
  xml += close4("hp:tr");
  return xml;
}
function writeTableCell(cell) {
  const tcAttrs = { ...cell.attrs };
  let xml = open4("hp:tc", tcAttrs);
  for (const child of cell.children) {
    if (child.tag === "subList") {
      xml += writeSubList(child);
    } else {
      xml += writeGenericElement(child, "hp");
    }
  }
  xml += close4("hp:tc");
  return xml;
}
function writeSubList(subList) {
  let xml = open4("hp:subList", subList.attrs);
  for (const child of subList.children) {
    if (child.tag === "p") {
      xml += writeParagraphFromGeneric(child);
    } else {
      xml += writeGenericElement(child, "hp");
    }
  }
  xml += close4("hp:subList");
  return xml;
}
function writeParagraphFromGeneric(pEl) {
  const pAttrs = { ...pEl.attrs };
  let xml = open4("hp:p", pAttrs);
  for (const child of pEl.children) {
    if (child.tag === "run") {
      xml += writeRunFromGeneric(child);
    } else if (child.tag === "linesegarray") {
      xml += writeGenericElement(child, "hp");
    } else {
      xml += writeGenericElement(child, "hp");
    }
  }
  xml += close4("hp:p");
  return xml;
}
function writeRunFromGeneric(runEl) {
  let xml = open4("hp:run", runEl.attrs);
  for (const child of runEl.children) {
    if (child.tag === "t") {
      if (child.text && child.text.length > 0) {
        xml += `<hp:t>${escapeXml(child.text)}</hp:t>`;
      } else {
        xml += "<hp:t/>";
      }
    } else {
      xml += writeGenericElement(child, "hp");
    }
  }
  xml += close4("hp:run");
  return xml;
}
function writeInlineObject(element, name) {
  if (name === "equation") {
    return serializeEquation(element, "hc");
  }
  const shapeTypes = [
    "rect",
    "ellipse",
    "line",
    "arc",
    "polygon",
    "curve",
    "polyline",
    "textbox",
    "freeform",
    "connector",
    "callout",
    "roundedRect",
    "diamond",
    "trapezoid",
    "parallelogram",
    "hexagon",
    "octagon",
    "star",
    "arrow",
    "flowchart"
  ];
  if (shapeTypes.includes(name)) {
    return serializeShape(element, "hp");
  }
  return writeGenericElement(element, "hp");
}

// vendor/handoc/packages/hwpx-writer/src/builder.ts
var MM_TO_HWP = 283.46;
var A4_WIDTH = 59528;
var A4_HEIGHT = 84188;
var HwpxBuilder = class _HwpxBuilder {
  pageWidth;
  pageHeight;
  margins;
  sectionItems = [[]];
  // array of sections, each an array of items
  sectionMetas = [{}];
  images = [];
  extraFontFamilies = /* @__PURE__ */ new Set();
  constructor(pageWidth, pageHeight, margins) {
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
    this.margins = margins ?? null;
  }
  static create(options) {
    return new _HwpxBuilder(
      options?.pageWidth ?? A4_WIDTH,
      options?.pageHeight ?? A4_HEIGHT,
      options?.margins
    );
  }
  addParagraph(text, style) {
    this.currentSection().push({ kind: "paragraph", text, style });
    return this;
  }
  addTable(rows) {
    this.currentSection().push({ kind: "table", rows });
    return this;
  }
  addRichTable(data) {
    this.currentSection().push({ kind: "richTable", data });
    return this;
  }
  addImage(data, ext, width, height) {
    const w = width ?? Math.round(100 * MM_TO_HWP);
    const h = height ?? Math.round(75 * MM_TO_HWP);
    this.currentSection().push({
      kind: "image",
      image: { data, ext, width: w, height: h }
    });
    return this;
  }
  addHeading(level, text) {
    const sizes = { 1: 28, 2: 24, 3: 20, 4: 16, 5: 14, 6: 12 };
    const fontSize = sizes[level] ?? 12;
    this.currentSection().push({
      kind: "paragraph",
      text,
      style: { bold: true, fontSize }
    });
    return this;
  }
  addFootnote(text, noteText) {
    this.currentSection().push({ kind: "footnote", text, noteText });
    return this;
  }
  addShape(options) {
    this.currentSection().push({ kind: "shape", options });
    return this;
  }
  addEquation(options) {
    this.currentSection().push({ kind: "equation", options });
    return this;
  }
  setHeader(text) {
    this.currentSectionMeta().headerText = text;
    return this;
  }
  setFooter(text) {
    this.currentSectionMeta().footerText = text;
    return this;
  }
  setPageNumber(position, align) {
    this.currentSectionMeta().pageNumber = { position, align };
    return this;
  }
  addSectionBreak() {
    this.sectionItems.push([]);
    this.sectionMetas.push({});
    return this;
  }
  build() {
    const { header, charPropMap, paraPropMap } = this.buildHeader();
    const sections = this.buildSections(charPropMap, paraPropMap);
    header.secCnt = sections.length;
    const extraParts = /* @__PURE__ */ new Map();
    for (const img of this.images) {
      extraParts.set(img.path, img.data);
    }
    return writeHwpx({ header, sections, extraParts });
  }
  // ── Private helpers ──
  currentSection() {
    return this.sectionItems[this.sectionItems.length - 1];
  }
  currentSectionMeta() {
    return this.sectionMetas[this.sectionMetas.length - 1];
  }
  /**
   * Collect all unique style combinations and build charProperties / paraProperties.
   * Returns mapping from style-key to property index.
   */
  buildHeader() {
    const charStyles = /* @__PURE__ */ new Map();
    charStyles.set("default", {});
    for (const section of this.sectionItems) {
      for (const item of section) {
        if (item.kind === "paragraph" && item.style) {
          const key = charStyleKey(item.style);
          if (!charStyles.has(key)) {
            charStyles.set(key, item.style);
          }
          if (item.style.fontFamily) {
            this.extraFontFamilies.add(item.style.fontFamily);
          }
        }
      }
    }
    const paraStyleMap = /* @__PURE__ */ new Map();
    paraStyleMap.set("left||", {});
    for (const section of this.sectionItems) {
      for (const item of section) {
        if (item.kind === "paragraph" && item.style) {
          const key = paraStyleKey(item.style);
          if (!paraStyleMap.has(key)) {
            paraStyleMap.set(key, item.style);
          }
        }
      }
    }
    const extraFonts = Array.from(this.extraFontFamilies);
    const fontFaces = [
      {
        lang: "hangul",
        fonts: [
          { id: 0, face: "\uB9D1\uC740 \uACE0\uB515", type: "ttf", isEmbedded: false },
          ...extraFonts.map((f, i) => ({ id: i + 1, face: f, type: "ttf", isEmbedded: false }))
        ]
      },
      {
        lang: "latin",
        fonts: [
          { id: 0, face: "\uB9D1\uC740 \uACE0\uB515", type: "ttf", isEmbedded: false },
          ...extraFonts.map((f, i) => ({ id: i + 1, face: f, type: "ttf", isEmbedded: false }))
        ]
      },
      {
        lang: "hanja",
        fonts: [
          { id: 0, face: "\uB9D1\uC740 \uACE0\uB515", type: "ttf", isEmbedded: false },
          ...extraFonts.map((f, i) => ({ id: i + 1, face: f, type: "ttf", isEmbedded: false }))
        ]
      }
    ];
    const fontIdMap = /* @__PURE__ */ new Map();
    fontIdMap.set("\uB9D1\uC740 \uACE0\uB515", 0);
    extraFonts.forEach((f, i) => fontIdMap.set(f, i + 1));
    const charProperties = [];
    const charPropMap = /* @__PURE__ */ new Map();
    let cpIdx = 0;
    for (const [key, style] of charStyles) {
      const height = (style.fontSize ?? 10) * 100;
      const textColor = style.color ?? "0";
      const cpAttrs = {
        id: String(cpIdx),
        height: String(height),
        textColor
      };
      if (style.bold) cpAttrs.bold = "1";
      if (style.italic) cpAttrs.italic = "1";
      const fontId = style.fontFamily ? String(fontIdMap.get(style.fontFamily) ?? 0) : "0";
      charProperties.push({
        id: cpIdx,
        height,
        bold: style.bold,
        italic: style.italic,
        attrs: cpAttrs,
        children: [
          makeGenericEl("fontRef", {
            hangul: fontId,
            latin: fontId,
            hanja: fontId
          })
        ]
      });
      charPropMap.set(key, cpIdx);
      cpIdx++;
    }
    const paraProperties = [];
    const paraPropMap = /* @__PURE__ */ new Map();
    let ppIdx = 0;
    for (const [key, style] of paraStyleMap) {
      const alignVal = style.align ?? "left";
      const ppAttrs = { id: String(ppIdx) };
      const ppChildren = [];
      if (alignVal && alignVal !== "left") {
        const alignMap = {
          left: "LEFT",
          center: "CENTER",
          right: "RIGHT",
          justify: "JUSTIFY",
          distribute: "DISTRIBUTE"
        };
        ppChildren.push(makeGenericEl("align", {
          horizontal: alignMap[alignVal] ?? "LEFT"
        }));
      }
      const ppLineSpacing = style.lineSpacing ? { type: "percent", value: style.lineSpacing } : void 0;
      const ppMargin = style.indent ? { left: Math.round(style.indent * MM_TO_HWP), indent: Math.round(style.indent * MM_TO_HWP) } : void 0;
      if (style.lineSpacing) {
        ppChildren.push(makeGenericEl("lineSpacing", {
          type: "percent",
          value: String(style.lineSpacing)
        }));
      }
      if (style.indent) {
        const indentHwp = String(Math.round(style.indent * MM_TO_HWP));
        ppChildren.push(makeGenericEl("margin", {
          indent: indentHwp,
          left: indentHwp,
          right: "0"
        }));
      }
      paraProperties.push({
        id: ppIdx,
        align: alignVal,
        lineSpacing: ppLineSpacing,
        margin: ppMargin,
        attrs: ppAttrs,
        children: ppChildren
      });
      paraPropMap.set(key, ppIdx);
      ppIdx++;
    }
    const styles = [
      {
        id: 0,
        type: "para",
        name: "\uBC14\uD0D5\uAE00",
        engName: "Normal",
        paraPrIDRef: 0,
        charPrIDRef: 0,
        attrs: {
          id: "0",
          type: "para",
          name: "\uBC14\uD0D5\uAE00",
          engName: "Normal",
          paraPrIDRef: "0",
          charPrIDRef: "0",
          nextStyleIDRef: "0"
        }
      }
    ];
    const header = {
      version: "1.5",
      secCnt: this.sectionItems.length,
      beginNum: { page: 1, footnote: 1, endnote: 1, pic: 1, tbl: 1, equation: 1 },
      refList: {
        fontFaces,
        borderFills: [],
        charProperties,
        tabProperties: [],
        numberings: [],
        bullets: [],
        paraProperties,
        styles,
        others: []
      }
    };
    return { header, charPropMap, paraPropMap };
  }
  buildSections(charPropMap, paraPropMap) {
    let imageCounter = 0;
    return this.sectionItems.map((items, sectionIdx) => {
      const paragraphs = [];
      const meta = this.sectionMetas[sectionIdx] ?? {};
      const headerFooterCtrls = [];
      if (meta.headerText) {
        const text = meta.pageNumber?.position === "header" ? meta.headerText : meta.headerText;
        headerFooterCtrls.push(makeHeaderFooterParagraph("header", text));
      } else if (meta.pageNumber?.position === "header") {
        headerFooterCtrls.push(makeHeaderFooterParagraph("header", ""));
      }
      if (meta.footerText) {
        headerFooterCtrls.push(makeHeaderFooterParagraph("footer", meta.footerText));
      } else if (meta.pageNumber?.position === "footer") {
        headerFooterCtrls.push(makeHeaderFooterParagraph("footer", ""));
      }
      paragraphs.push(...headerFooterCtrls);
      if (items.length === 0 && headerFooterCtrls.length === 0) {
        paragraphs.push(makeParagraph("", 0, 0));
      }
      for (const item of items) {
        switch (item.kind) {
          case "paragraph": {
            const cpKey = item.style ? charStyleKey(item.style) : "default";
            const ppKey = item.style ? paraStyleKey(item.style) : "left||";
            const cpIdx = charPropMap.get(cpKey) ?? 0;
            const ppIdx = paraPropMap.get(ppKey) ?? 0;
            paragraphs.push(makeParagraph(item.text, cpIdx, ppIdx));
            break;
          }
          case "table": {
            paragraphs.push(makeTableParagraph(item.rows));
            break;
          }
          case "richTable": {
            paragraphs.push(makeRichTableParagraph(item.data));
            break;
          }
          case "image": {
            const imgPath = `BinData/image${imageCounter}.${item.image.ext}`;
            this.images.push({ data: item.image.data, path: imgPath });
            paragraphs.push(makeImageParagraph(imgPath, item.image.width, item.image.height));
            imageCounter++;
            break;
          }
          case "footnote": {
            paragraphs.push(makeFootnoteParagraph(item.text, item.noteText));
            break;
          }
          case "shape": {
            paragraphs.push(makeShapeParagraph(item.options));
            break;
          }
          case "equation": {
            paragraphs.push(makeEquationParagraph(item.options));
            break;
          }
        }
      }
      return {
        paragraphs,
        sectionProps: {
          pageWidth: this.pageWidth,
          pageHeight: this.pageHeight,
          margins: this.margins ?? {
            left: 8504,
            // ~30mm default
            right: 8504,
            top: 5668,
            // ~20mm default
            bottom: 4252,
            // ~15mm default
            header: 4252,
            footer: 4252,
            gutter: 0
          },
          landscape: false
        }
      };
    });
  }
};
function charStyleKey(style) {
  if (!style.bold && !style.italic && !style.fontSize && !style.fontFamily && !style.color) return "default";
  return `b${style.bold ? 1 : 0}_i${style.italic ? 1 : 0}_fs${style.fontSize ?? 10}_ff${style.fontFamily ?? ""}_c${style.color ?? ""}`;
}
function paraStyleKey(style) {
  return `${style.align ?? "left"}|${style.lineSpacing ?? ""}|${style.indent ?? ""}`;
}
function makeParagraph(text, charPrIdx, paraPrIdx) {
  const children = [{ type: "text", content: text }];
  return {
    id: null,
    paraPrIDRef: paraPrIdx,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{ charPrIDRef: charPrIdx, children }],
    lineSegArray: []
  };
}
function makeTableParagraph(rows) {
  const rowCount = rows.length;
  const colCount = rows[0]?.length ?? 0;
  const tableEl = buildTableElement(rows, rowCount, colCount);
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "table", element: tableEl }]
    }],
    lineSegArray: []
  };
}
function buildTableElement(rows, rowCount, colCount) {
  const totalWidth = 48e3;
  const colWidth = Math.floor(totalWidth / colCount);
  const rowHeight = 1e3;
  const trElements = rows.map((row, ri) => {
    const tcElements = row.map((cell, ci) => {
      const cellPara = {
        tag: "hp:p",
        attrs: { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" },
        children: [{
          tag: "hp:run",
          attrs: { charPrIDRef: "0" },
          children: [{
            tag: "hp:t",
            attrs: {},
            children: [],
            text: cell
          }],
          text: null
        }],
        text: null
      };
      const cellAddr = {
        tag: "hp:cellAddr",
        attrs: { colAddr: String(ci), rowAddr: String(ri) },
        children: [],
        text: null
      };
      const cellSpan = {
        tag: "hp:cellSpan",
        attrs: { colSpan: "1", rowSpan: "1" },
        children: [],
        text: null
      };
      const cellSz = {
        tag: "hp:cellSz",
        attrs: { width: String(colWidth), height: String(rowHeight) },
        children: [],
        text: null
      };
      const subList = {
        tag: "hp:subList",
        attrs: { id: "0", textDirection: "HORIZONTAL", lineWrap: "BREAK", vertAlign: "CENTER", linkListIDRef: "0", linkListNextIDRef: "0", textWidth: "0", textHeight: "0" },
        children: [cellPara],
        text: null
      };
      return {
        tag: "hp:tc",
        attrs: { name: "", header: "0", hasMargin: "0" },
        children: [cellAddr, cellSpan, cellSz, subList],
        text: null
      };
    });
    return {
      tag: "hp:tr",
      attrs: {},
      children: tcElements,
      text: null
    };
  });
  return {
    tag: "hp:tbl",
    attrs: {
      rowCnt: String(rowCount),
      colCnt: String(colCount),
      cellSpacing: "0",
      borderFillIDRef: "0"
    },
    children: trElements,
    text: null
  };
}
function makeRichTableParagraph(data) {
  const tableEl = buildRichTableElement(data);
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "table", element: tableEl }]
    }],
    lineSegArray: []
  };
}
function buildRichTableElement(data) {
  const rowMap = /* @__PURE__ */ new Map();
  for (const cell of data.cells) {
    const arr = rowMap.get(cell.rowAddr) ?? [];
    arr.push(cell);
    rowMap.set(cell.rowAddr, arr);
  }
  const sortedRows = [...rowMap.entries()].sort((a, b) => a[0] - b[0]);
  const trElements = sortedRows.map(([, cells]) => {
    const sortedCells = cells.sort((a, b) => a.colAddr - b.colAddr);
    const tcElements = sortedCells.map((cell) => {
      const cellPara = {
        tag: "hp:p",
        attrs: { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" },
        children: [{
          tag: "hp:run",
          attrs: { charPrIDRef: "0" },
          children: [{
            tag: "hp:t",
            attrs: {},
            children: [],
            text: cell.text
          }],
          text: null
        }],
        text: null
      };
      const cellAddr = {
        tag: "hp:cellAddr",
        attrs: { colAddr: String(cell.colAddr), rowAddr: String(cell.rowAddr) },
        children: [],
        text: null
      };
      const cellSpan = {
        tag: "hp:cellSpan",
        attrs: { colSpan: String(cell.colSpan), rowSpan: String(cell.rowSpan) },
        children: [],
        text: null
      };
      const cellSz = {
        tag: "hp:cellSz",
        attrs: { width: String(cell.width), height: String(cell.height) },
        children: [],
        text: null
      };
      const cellMargin = {
        tag: "hp:cellMargin",
        attrs: {
          left: String(cell.marginLeft),
          right: String(cell.marginRight),
          top: String(cell.marginTop),
          bottom: String(cell.marginBottom)
        },
        children: [],
        text: null
      };
      const subList = {
        tag: "hp:subList",
        attrs: { id: "0", textDirection: "HORIZONTAL", lineWrap: "BREAK", vertAlign: "CENTER", linkListIDRef: "0", linkListNextIDRef: "0", textWidth: "0", textHeight: "0" },
        children: [cellPara],
        text: null
      };
      return {
        tag: "hp:tc",
        attrs: {
          name: "",
          header: "0",
          hasMargin: cell.marginLeft > 0 || cell.marginRight > 0 ? "1" : "0",
          borderFillIDRef: String(cell.borderFillId)
        },
        children: [cellAddr, cellSpan, cellSz, cellMargin, subList],
        text: null
      };
    });
    return {
      tag: "hp:tr",
      attrs: {},
      children: tcElements,
      text: null
    };
  });
  let totalWidth = 0;
  if (data.cells.length > 0) {
    const row1Cells = rowMap.get(sortedRows.length > 1 ? sortedRows[1][0] : sortedRows[0][0]) ?? [];
    totalWidth = row1Cells.reduce((sum, c) => sum + c.width, 0);
  }
  const szEl = {
    tag: "hp:sz",
    attrs: { width: String(totalWidth), height: "0" },
    children: [],
    text: null
  };
  return {
    tag: "hp:tbl",
    attrs: {
      rowCnt: String(data.rows),
      colCnt: String(data.cols),
      cellSpacing: "0",
      borderFillIDRef: "0"
    },
    children: [szEl, ...trElements],
    text: null
  };
}
function makeImageParagraph(binPath, width, height) {
  const imgEl = {
    tag: "hp:pic",
    attrs: {},
    children: [
      {
        tag: "hp:sz",
        attrs: { width: String(width), height: String(height) },
        children: [],
        text: null
      },
      {
        tag: "hp:img",
        attrs: { binaryItemIDRef: binPath, bright: "0", contrast: "0" },
        children: [],
        text: null
      }
    ],
    text: null
  };
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "inlineObject", name: "pic", element: imgEl }]
    }],
    lineSegArray: []
  };
}
function makeHeaderFooterParagraph(type, text) {
  const innerPara = {
    tag: "p",
    attrs: { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" },
    children: [{
      tag: "run",
      attrs: { charPrIDRef: "0" },
      children: [{
        tag: "t",
        attrs: {},
        children: [],
        text
      }],
      text: null
    }],
    text: null
  };
  const subList = {
    tag: "subList",
    attrs: {},
    children: [innerPara],
    text: null
  };
  const hfEl = {
    tag: type,
    attrs: { applyPageType: "BOTH" },
    children: [subList],
    text: null
  };
  const ctrlEl = {
    tag: "ctrl",
    attrs: {},
    children: [hfEl],
    text: null
  };
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "ctrl", element: ctrlEl }]
    }],
    lineSegArray: []
  };
}
function makeFootnoteParagraph(text, noteText) {
  const innerPara = {
    tag: "p",
    attrs: { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" },
    children: [{
      tag: "run",
      attrs: { charPrIDRef: "0" },
      children: [{
        tag: "t",
        attrs: {},
        children: [],
        text: noteText
      }],
      text: null
    }],
    text: null
  };
  const subList = {
    tag: "subList",
    attrs: {},
    children: [innerPara],
    text: null
  };
  const footnoteEl = {
    tag: "footnote",
    attrs: {},
    children: [subList],
    text: null
  };
  const ctrlEl = {
    tag: "ctrl",
    attrs: {},
    children: [footnoteEl],
    text: null
  };
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [
        { type: "text", content: text },
        { type: "ctrl", element: ctrlEl }
      ]
    }],
    lineSegArray: []
  };
}
function makeGenericEl(tag, attrs6) {
  return { tag, attrs: attrs6, children: [], text: null };
}
function makeShapeParagraph(options) {
  const { shapeType, width, height, x = 0, y = 0, text } = options;
  const children = [
    {
      tag: "sz",
      attrs: { width: String(width), height: String(height) },
      children: [],
      text: null
    },
    {
      tag: "pos",
      attrs: { x: String(x), y: String(y), z: "0" },
      children: [],
      text: null
    }
  ];
  if (text) {
    const textPara = {
      tag: "p",
      attrs: { paraPrIDRef: "0", styleIDRef: "0", pageBreak: "0", columnBreak: "0", merged: "0" },
      children: [{
        tag: "run",
        attrs: { charPrIDRef: "0" },
        children: [{
          tag: "t",
          attrs: {},
          children: [],
          text
        }],
        text: null
      }],
      text: null
    };
    const subList = {
      tag: "subList",
      attrs: {},
      children: [textPara],
      text: null
    };
    children.push(subList);
  }
  const shapeEl = {
    tag: shapeType,
    attrs: {},
    children,
    text: null
  };
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "shape", name: shapeType, element: shapeEl }]
    }],
    lineSegArray: []
  };
}
function makeEquationParagraph(options) {
  const { script, font = "HWP_Equation", baseUnit = 100, width = 5e3, height = 1e3 } = options;
  const eqChildren = [
    {
      tag: "script",
      attrs: {},
      children: [],
      text: script
    },
    {
      tag: "sz",
      attrs: { width: String(width), height: String(height) },
      children: [],
      text: null
    }
  ];
  const eqEl = {
    tag: "equation",
    attrs: {
      font,
      baseUnit: String(baseUnit),
      version: "1.0"
    },
    children: eqChildren,
    text: null
  };
  return {
    id: null,
    paraPrIDRef: 0,
    styleIDRef: 0,
    pageBreak: false,
    columnBreak: false,
    merged: false,
    runs: [{
      charPrIDRef: 0,
      children: [{ type: "equation", element: eqEl }]
    }],
    lineSegArray: []
  };
}

// vendor/handoc/packages/hwpx-writer/src/index.ts
import { zipSync as zipSync2 } from "fflate";
function buildManifest(sectionCount, extraPartNames) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>';
  xml += '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="" unique-identifier="" id="">';
  xml += "<opf:metadata><opf:language>ko</opf:language></opf:metadata>";
  xml += "<opf:manifest>";
  xml += '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>';
  for (let i = 0; i < sectionCount; i++) {
    xml += `<opf:item id="section${i}" href="Contents/section${i}.xml" media-type="application/xml"/>`;
  }
  if (extraPartNames) {
    for (const name of extraPartNames) {
      if (name.startsWith("BinData/")) {
        const ext = name.split(".").pop()?.toLowerCase() ?? "bin";
        const mimeMap = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          bmp: "image/bmp",
          tiff: "image/tiff"
        };
        const mime = mimeMap[ext] ?? "application/octet-stream";
        const id = name.replace(/[^a-zA-Z0-9]/g, "_");
        xml += `<opf:item id="${id}" href="Contents/${name}" media-type="${mime}"/>`;
      }
    }
  }
  xml += "</opf:manifest>";
  xml += "<opf:spine>";
  xml += '<opf:itemref idref="header" linear="yes"/>';
  for (let i = 0; i < sectionCount; i++) {
    xml += `<opf:itemref idref="section${i}" linear="yes"/>`;
  }
  xml += "</opf:spine>";
  xml += "</opf:package>";
  return xml;
}
var encoder2 = /* @__PURE__ */ new TextEncoder();
function encode(s) {
  return encoder2.encode(s);
}
function writeHwpx(doc, originalPackage) {
  const parts = {};
  if (originalPackage) {
    for (const name of originalPackage.partNames()) {
      parts[name] = originalPackage.getPart(name);
    }
  } else {
    parts["mimetype"] = encode("application/hwp+zip");
    parts["version.xml"] = encode(
      '<?xml version="1.0" encoding="UTF-8" ?><HWPVersion Major="1" Minor="5" Micro="0" BuildNumber="0"/>'
    );
    const binDataPaths = [];
    if (doc.extraParts) {
      for (const name of doc.extraParts.keys()) {
        if (name.startsWith("BinData/")) {
          binDataPaths.push(name);
        }
      }
    }
    parts["Contents/content.hpf"] = encode(buildManifest(doc.sections.length, binDataPaths));
  }
  parts["Contents/header.xml"] = encode(writeHeader(doc.header));
  for (let i = 0; i < doc.sections.length; i++) {
    parts[`Contents/section${i}.xml`] = encode(writeSection(doc.sections[i]));
  }
  if (doc.extraParts) {
    for (const [name, data] of doc.extraParts) {
      const path = name.startsWith("BinData/") ? `Contents/${name}` : name;
      parts[path] = typeof data === "string" ? encode(data) : data;
    }
  }
  const normalizedParts = {};
  for (const [key, value] of Object.entries(parts)) {
    normalizedParts[key] = new Uint8Array(value);
  }
  return zipSync2(normalizedParts);
}

// vendor/handoc/packages/docx-reader/src/docx-parser.ts
import { unzipSync as unzipSync2 } from "fflate";

// vendor/handoc/packages/docx-reader/src/xml-utils.ts
function parseXml2(xml) {
  const clean = xml.replace(/<\?xml[^?]*\?>/g, "").trim();
  const result = parseElement(clean, 0);
  return result.node;
}
function localName(tag) {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}
function parseElement(xml, pos) {
  while (pos < xml.length && xml[pos] !== "<") pos++;
  if (pos >= xml.length) return { node: { tag: "", fullTag: "", attrs: {}, children: [], text: "" }, end: pos };
  pos++;
  let tagEnd = pos;
  while (tagEnd < xml.length && xml[tagEnd] !== " " && xml[tagEnd] !== ">" && xml[tagEnd] !== "/" && xml[tagEnd] !== "\n" && xml[tagEnd] !== "\r" && xml[tagEnd] !== "	") tagEnd++;
  const fullTag = xml.slice(pos, tagEnd);
  const tag = localName(fullTag);
  pos = tagEnd;
  const attrs6 = {};
  while (pos < xml.length) {
    while (pos < xml.length && (xml[pos] === " " || xml[pos] === "\n" || xml[pos] === "\r" || xml[pos] === "	")) pos++;
    if (xml[pos] === ">" || xml[pos] === "/") break;
    let attrEnd = pos;
    while (attrEnd < xml.length && xml[attrEnd] !== "=" && xml[attrEnd] !== " " && xml[attrEnd] !== ">") attrEnd++;
    const attrName = localName(xml.slice(pos, attrEnd));
    pos = attrEnd;
    if (xml[pos] === "=") {
      pos++;
      const quote = xml[pos];
      pos++;
      let valEnd = pos;
      while (valEnd < xml.length && xml[valEnd] !== quote) valEnd++;
      attrs6[attrName] = decodeEntities(xml.slice(pos, valEnd));
      pos = valEnd + 1;
    }
  }
  if (xml[pos] === "/") {
    pos += 2;
    return { node: { tag, fullTag, attrs: attrs6, children: [], text: "" }, end: pos };
  }
  pos++;
  const children = [];
  let text = "";
  while (pos < xml.length) {
    if (xml[pos] === "<" && xml[pos + 1] === "/") {
      const closeEnd = xml.indexOf(">", pos);
      pos = closeEnd + 1;
      return { node: { tag, fullTag, attrs: attrs6, children, text }, end: pos };
    }
    if (xml[pos] === "<") {
      const child = parseElement(xml, pos);
      children.push(child.node);
      pos = child.end;
    } else {
      let textEnd = pos;
      while (textEnd < xml.length && xml[textEnd] !== "<") textEnd++;
      text += decodeEntities(xml.slice(pos, textEnd));
      pos = textEnd;
    }
  }
  return { node: { tag, fullTag, attrs: attrs6, children, text }, end: pos };
}
function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function findAll(node, tag) {
  const result = [];
  if (node.tag === tag) result.push(node);
  for (const child of node.children) {
    result.push(...findAll(child, tag));
  }
  return result;
}
function findFirst(node, tag) {
  if (node.tag === tag) return node;
  for (const child of node.children) {
    const found = findFirst(child, tag);
    if (found) return found;
  }
  return null;
}
function childrenByTag(node, tag) {
  return node.children.filter((c) => c.tag === tag);
}
function childByTag(node, tag) {
  return node.children.find((c) => c.tag === tag) ?? null;
}

// vendor/handoc/packages/docx-reader/src/docx-parser.ts
async function parseDocx(buffer) {
  const files = unzipSync2(buffer);
  const decoder2 = new TextDecoder();
  const getText = (path) => {
    const data = files[path];
    if (!data) return null;
    return decoder2.decode(data);
  };
  const images = [];
  const imagesByPath = /* @__PURE__ */ new Map();
  for (const [path, data] of Object.entries(files)) {
    if (path.startsWith("word/media/")) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      const mimeMap = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "svg": "image/svg+xml",
        "emf": "image/x-emf",
        "wmf": "image/x-wmf",
        "tiff": "image/tiff"
      };
      const img = {
        path,
        data,
        mimeType: mimeMap[ext] ?? "application/octet-stream"
      };
      images.push(img);
      imagesByPath.set(path, img);
    }
  }
  const relsMap = /* @__PURE__ */ new Map();
  const relsXml = getText("word/_rels/document.xml.rels");
  if (relsXml) {
    const relsTree = parseXml2(relsXml);
    const rels = findAll(relsTree, "Relationship");
    for (const rel of rels) {
      const id = rel.attrs.Id;
      const target = rel.attrs.Target;
      if (id && target) {
        const external = rel.attrs.TargetMode === "External" || /^[a-z][a-z0-9+.-]*:/i.test(target);
        const fullPath = external ? target : target.startsWith("/") ? target.slice(1) : "word/" + target;
        relsMap.set(id, fullPath);
      }
    }
  }
  const docXml = getText("word/document.xml");
  if (!docXml) throw new Error("Missing word/document.xml in DOCX");
  const docTree = parseXml2(docXml);
  const bodyNode = findFirst(docTree, "body");
  if (!bodyNode) throw new Error("No w:body found in document.xml");
  const paragraphs = [];
  const tables = [];
  const body = [];
  const sections = [];
  const parseCtx = { relsMap, imagesByPath, headingLevels: parseHeadingLevels(getText("word/styles.xml")) };
  for (const child of bodyNode.children) {
    if (child.tag === "p") {
      const p = parseParagraph2(child, parseCtx);
      paragraphs.push(p);
      body.push({ type: "paragraph", item: p });
    } else if (child.tag === "tbl") {
      const t = parseTable2(child, parseCtx);
      tables.push(t);
      body.push({ type: "table", item: t });
    } else if (child.tag === "sectPr") {
      sections.push(parseSectPr(child));
    }
  }
  if (sections.length === 0) {
    const lastSectPr = findFirst(bodyNode, "sectPr");
    if (lastSectPr) sections.push(parseSectPr(lastSectPr));
  }
  const metadata = {};
  const coreXml = getText("docProps/core.xml");
  if (coreXml) {
    const coreTree = parseXml2(coreXml);
    const titleNode = findFirst(coreTree, "title");
    if (titleNode?.text.trim()) metadata.title = titleNode.text.trim();
    const creatorNode = findFirst(coreTree, "creator");
    if (creatorNode?.text.trim()) metadata.author = creatorNode.text.trim();
  }
  return { paragraphs, tables, sections, metadata, body, images };
}
function parseHeadingLevels(stylesXml) {
  const levels = /* @__PURE__ */ new Map();
  if (!stylesXml) return levels;
  const tree = parseXml2(stylesXml);
  for (const style of findAll(tree, "style")) {
    const id = style.attrs.styleId;
    if (!id || style.attrs.type !== "paragraph") continue;
    const name = findFirst(style, "name")?.attrs.val ?? "";
    const outline = findFirst(style, "outlineLvl")?.attrs.val;
    const named = name.trim().match(/^(?:heading|제목|개요)\s*([1-9])$/i);
    const level = named ? Number(named[1]) : outline != null ? Number(outline) + 1 : 0;
    if (level >= 1 && level <= 6) levels.set(id, level);
  }
  return levels;
}
function parseParagraph2(node, ctx) {
  const runs = [];
  const pPr = childByTag(node, "pPr");
  let align;
  let styleId;
  let headingLevel;
  let numPr;
  if (pPr) {
    const jc = childByTag(pPr, "jc");
    if (jc?.attrs.val) align = jc.attrs.val;
    const pStyle = childByTag(pPr, "pStyle");
    if (pStyle?.attrs.val) styleId = pStyle.attrs.val;
    const outline = childByTag(pPr, "outlineLvl");
    if (outline?.attrs.val != null) {
      const level = Number(outline.attrs.val) + 1;
      if (level >= 1 && level <= 6) headingLevel = level;
    }
    const numPrNode = childByTag(pPr, "numPr");
    if (numPrNode) {
      const ilvl = childByTag(numPrNode, "ilvl");
      const numId = childByTag(numPrNode, "numId");
      if (numId?.attrs.val) {
        numPr = {
          numId: parseInt(numId.attrs.val, 10),
          ilvl: ilvl?.attrs.val ? parseInt(ilvl.attrs.val, 10) : 0
        };
      }
    }
  }
  collectRuns(node, ctx, runs);
  if (!headingLevel && styleId) headingLevel = ctx.headingLevels.get(styleId);
  return { runs, align, styleId, headingLevel, numPr };
}
function collectRuns(node, ctx, runs, link) {
  for (const child of node.children) {
    if (child.tag === "r") {
      runs.push(parseRun2(child, ctx, link));
    } else if (child.tag === "hyperlink") {
      const id = child.attrs.id;
      const anchor = child.attrs.anchor;
      const target = id ? ctx.relsMap.get(id) : anchor ? `#${anchor}` : void 0;
      collectRuns(child, ctx, runs, target);
    } else if (["ins", "smartTag", "fldSimple", "sdt", "sdtContent"].includes(child.tag)) {
      collectRuns(child, ctx, runs, link);
    }
  }
}
function parseRun2(node, ctx, link) {
  const style = {};
  const rPr = childByTag(node, "rPr");
  if (rPr) {
    if (childByTag(rPr, "b")) style.bold = true;
    if (childByTag(rPr, "i")) style.italic = true;
    if (childByTag(rPr, "u")) style.underline = true;
    if (childByTag(rPr, "strike")) style.strike = true;
    const sz = childByTag(rPr, "sz");
    if (sz?.attrs.val) style.fontSize = parseInt(sz.attrs.val, 10);
    const color = childByTag(rPr, "color");
    if (color?.attrs.val && color.attrs.val !== "auto") style.color = color.attrs.val;
    const rFonts = childByTag(rPr, "rFonts");
    if (rFonts) {
      style.fontFamily = rFonts.attrs.ascii || rFonts.attrs.hAnsi || rFonts.attrs.eastAsia;
    }
  }
  let image;
  const drawing = childByTag(node, "drawing");
  if (drawing) image = parseDrawingImage(drawing, ctx);
  else {
    const picture = childByTag(node, "pict");
    if (picture) image = parsePictureImage(picture, ctx);
  }
  const textParts = [];
  for (const child of node.children) {
    if (child.tag === "t") {
      textParts.push(child.text);
    } else if (child.tag === "br") {
      textParts.push("\n");
    } else if (child.tag === "tab") {
      textParts.push("	");
    }
  }
  return { text: textParts.join(""), style, image, link };
}
function parseDrawingImage(drawing, ctx) {
  const blip = findFirst(drawing, "blip");
  if (!blip) return void 0;
  const rId = blip.attrs.embed || blip.attrs["r:embed"];
  if (!rId) return void 0;
  const targetPath = ctx.relsMap.get(rId);
  if (!targetPath) return void 0;
  const img = ctx.imagesByPath.get(targetPath);
  if (!img) return void 0;
  const ext = findFirst(drawing, "ext");
  if (ext) {
    const cx = ext.attrs.cx ? parseInt(ext.attrs.cx, 10) : void 0;
    const cy = ext.attrs.cy ? parseInt(ext.attrs.cy, 10) : void 0;
    if (cx) img.width = cx;
    if (cy) img.height = cy;
  }
  return img;
}
function parsePictureImage(picture, ctx) {
  const imageData = findFirst(picture, "imagedata");
  const rId = imageData?.attrs.id;
  if (!rId) return void 0;
  const targetPath = ctx.relsMap.get(rId);
  return targetPath ? ctx.imagesByPath.get(targetPath) : void 0;
}
function parseTable2(node, ctx) {
  const rows = [];
  for (const tr of childrenByTag(node, "tr")) {
    const cells = [];
    for (const tc of childrenByTag(tr, "tc")) {
      const paras = [];
      for (const p of childrenByTag(tc, "p")) {
        paras.push(parseParagraph2(p, ctx));
      }
      const tcPr = childByTag(tc, "tcPr");
      let gridSpan;
      let vMerge;
      let bgColor;
      let borders;
      if (tcPr) {
        const gs = childByTag(tcPr, "gridSpan");
        if (gs?.attrs.val) gridSpan = parseInt(gs.attrs.val, 10);
        const vm = childByTag(tcPr, "vMerge");
        if (vm) vMerge = vm.attrs.val || "continue";
        const shd = childByTag(tcPr, "shd");
        if (shd?.attrs.fill && shd.attrs.fill !== "auto") {
          bgColor = shd.attrs.fill;
        }
        const tcBorders = childByTag(tcPr, "tcBorders");
        if (tcBorders) {
          borders = {};
          for (const side of ["top", "bottom", "left", "right"]) {
            const b = childByTag(tcBorders, side);
            if (b?.attrs.val && b.attrs.val !== "none") {
              borders[side] = {
                style: b.attrs.val,
                color: b.attrs.color,
                size: b.attrs.sz ? parseInt(b.attrs.sz, 10) : void 0
              };
            }
          }
        }
      }
      cells.push({ paragraphs: paras, gridSpan, vMerge, bgColor, borders });
    }
    rows.push({ cells });
  }
  return { rows };
}
function parseSectPr(node) {
  const section = {};
  const pgSz = childByTag(node, "pgSz");
  if (pgSz) {
    if (pgSz.attrs.w) section.pageWidth = parseInt(pgSz.attrs.w, 10);
    if (pgSz.attrs.h) section.pageHeight = parseInt(pgSz.attrs.h, 10);
    if (pgSz.attrs.orient === "landscape") section.orientation = "landscape";
    else section.orientation = "portrait";
  }
  const pgMar = childByTag(node, "pgMar");
  if (pgMar) {
    section.margins = {
      top: pgMar.attrs.top ? parseInt(pgMar.attrs.top, 10) : void 0,
      right: pgMar.attrs.right ? parseInt(pgMar.attrs.right, 10) : void 0,
      bottom: pgMar.attrs.bottom ? parseInt(pgMar.attrs.bottom, 10) : void 0,
      left: pgMar.attrs.left ? parseInt(pgMar.attrs.left, 10) : void 0
    };
  }
  return section;
}

// vendor/handoc/packages/docx-reader/src/docx-to-hwpx.ts
var HEADING_STYLE_MAP = {
  "Heading1": 1,
  "heading1": 1,
  "Heading 1": 1,
  "Heading2": 2,
  "heading2": 2,
  "Heading 2": 2,
  "Heading3": 3,
  "heading3": 3,
  "Heading 3": 3,
  "Heading4": 4,
  "heading4": 4,
  "Heading 4": 4,
  "Heading5": 5,
  "heading5": 5,
  "Heading 5": 5,
  "Heading6": 6,
  "heading6": 6,
  "Heading 6": 6
};
async function docxToHwpx(docxBuffer) {
  const doc = await parseDocx(docxBuffer);
  const builder = HwpxBuilder.create();
  for (const elem of doc.body) {
    if (elem.type === "paragraph") {
      addParagraphToBuilder(builder, elem.item);
    } else if (elem.type === "table") {
      const rows = elem.item.rows.map(
        (row) => row.cells.map(
          (cell) => cell.paragraphs.map((p) => extractParagraphText2(p)).join("\n")
        )
      );
      if (rows.length > 0) {
        builder.addTable(rows);
      }
    }
  }
  for (const elem of doc.body) {
    if (elem.type === "paragraph") {
      for (const run of elem.item.runs) {
        if (run.image) {
          addImageToBuilder(builder, run.image);
        }
      }
    }
  }
  return builder.build();
}
function addParagraphToBuilder(builder, para) {
  for (const run of para.runs) {
    if (run.image) {
      const text2 = extractParagraphText2(para);
      if (text2.trim()) {
        const style2 = mergeParagraphStyle(para);
        builder.addParagraph(text2, style2);
      }
      return;
    }
  }
  const text = extractParagraphText2(para);
  const style = mergeParagraphStyle(para);
  if (para.numPr) {
    const prefix = para.numPr.numId > 0 ? "\u2022 " : "";
    builder.addParagraph(prefix + text, style);
    return;
  }
  builder.addParagraph(text, style);
}
function addImageToBuilder(builder, image) {
  const ext = image.path.split(".").pop()?.toLowerCase() ?? "png";
  const EMU_PER_INCH2 = 914400;
  const HWP_PER_INCH = 7200;
  const width = image.width ? Math.round(image.width / EMU_PER_INCH2 * HWP_PER_INCH) : void 0;
  const height = image.height ? Math.round(image.height / EMU_PER_INCH2 * HWP_PER_INCH) : void 0;
  builder.addImage(image.data, ext, width, height);
}
function extractParagraphText2(para) {
  return para.runs.map((r) => r.text).join("");
}
function mergeParagraphStyle(para) {
  const style = {};
  if (para.align) {
    style.align = para.align === "both" ? "justify" : para.align;
  }
  if (para.styleId) {
    const headingLevel = HEADING_STYLE_MAP[para.styleId];
    if (headingLevel) {
      const sizes = [28, 24, 20, 16, 14, 12];
      style.fontSize = sizes[headingLevel - 1] ?? 12;
      style.bold = true;
    }
  }
  const firstRun = para.runs[0];
  if (firstRun?.style) {
    if (firstRun.style.bold) style.bold = true;
    if (firstRun.style.italic) style.italic = true;
    if (firstRun.style.fontSize && !style.fontSize) {
      style.fontSize = firstRun.style.fontSize / 2;
    }
  }
  return style;
}

// vendor/handoc/packages/docx-writer/src/converter.ts
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  PageBreak,
  BorderStyle,
  ShadingType,
  Header,
  Footer,
  HeadingLevel
} from "docx";
var HWPUNIT_PER_INCH2 = 7200;
var TWIPS_PER_INCH = 1440;
var EMU_PER_INCH = 914400;
function hwpUnitToTwip(hu) {
  return Math.round(hu / HWPUNIT_PER_INCH2 * TWIPS_PER_INCH);
}
function hwpUnitToHalfPt(hu) {
  return Math.round(hu / 100 * 2);
}
function hwpUnitToEmu(hu) {
  return Math.round(hu / HWPUNIT_PER_INCH2 * EMU_PER_INCH);
}
var ALIGN_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
  distribute: AlignmentType.DISTRIBUTE
};
var FONT_MAP = {
  "\uD55C\uCEF4\uBC14\uD0D5": "Batang",
  "\uD55C\uCEF4\uB3CB\uC6C0": "Dotum",
  "\uD55C\uC591\uC2E0\uBA85\uC870": "New Batang",
  "\uBC14\uD0D5": "Batang",
  "\uBC14\uD0D5\uCCB4": "BatangChe",
  "\uB3CB\uC6C0": "Dotum",
  "\uB3CB\uC6C0\uCCB4": "DotumChe",
  "\uAD74\uB9BC": "Gulim",
  "\uAD74\uB9BC\uCCB4": "GulimChe",
  "\uAD81\uC11C": "Gungsuh",
  "\uAD81\uC11C\uCCB4": "GungsuhChe",
  "\uB9D1\uC740 \uACE0\uB515": "Malgun Gothic",
  "\uB098\uB214\uACE0\uB515": "NanumGothic",
  "\uB098\uB214\uBA85\uC870": "NanumMyeongjo",
  "\uB098\uB214\uBC14\uB978\uACE0\uB515": "NanumBarunGothic",
  "\uD568\uCD08\uB86C\uBC14\uD0D5": "HCR Batang",
  "\uD568\uCD08\uB86C\uB3CB\uC6C0": "HCR Dotum"
};
function mapFontName(name) {
  return FONT_MAP[name] ?? name;
}
function resolveFontName(charProp, header) {
  if (!charProp.fontRef) return void 0;
  for (const lang of ["hangul", "latin", "hanja"]) {
    const fontIdx = charProp.fontRef[lang];
    if (fontIdx == null) continue;
    const decl = header.refList.fontFaces.find((f) => f.lang === lang);
    if (!decl) continue;
    const font = decl.fonts.find((f) => f.id === fontIdx);
    if (font) return mapFontName(font.face);
  }
  return void 0;
}
function parseBorderFill(bf) {
  const result = { borders: {} };
  for (const child of bf.children) {
    if (child.tag === "fillBrush" || child.tag.endsWith(":fillBrush")) {
      for (const fc of child.children) {
        if (fc.tag === "winBrush" || fc.tag.endsWith(":winBrush")) {
          const faceColor = fc.attrs["faceColor"];
          if (faceColor && faceColor !== "none" && faceColor !== "ffffff") {
            result.bgColor = faceColor;
          }
        }
      }
    }
    for (const side of ["top", "bottom", "left", "right"]) {
      if (child.tag === side || child.tag === side + "Border" || child.tag.endsWith(":" + side) || child.tag.endsWith(":" + side + "Border")) {
        const type = child.attrs["type"] ?? child.attrs["style"];
        const width = child.attrs["width"];
        if (type && type !== "none") {
          result.borders[side] = { style: mapBorderStyle(type), width: width ? parseInt(width) : void 0 };
        }
      }
    }
  }
  return result;
}
function mapBorderStyle(hwpStyle) {
  const map = {
    "solid": BorderStyle.SINGLE,
    "double": BorderStyle.DOUBLE,
    "dashed": BorderStyle.DASHED,
    "dotted": BorderStyle.DOTTED,
    "dash_dot": BorderStyle.DOT_DASH,
    "none": BorderStyle.NONE
  };
  return map[hwpStyle?.toLowerCase()] ?? BorderStyle.SINGLE;
}
function normalizeHexColor(value) {
  if (!value) return void 0;
  const raw = String(value).replace(/^#/, "");
  if (/^[\da-f]{6}$/i.test(raw)) return raw.toUpperCase();
  if (/^\d+$/.test(raw) && Number(raw) <= 16777215) return Number(raw).toString(16).padStart(6, "0").toUpperCase();
  return void 0;
}
async function hwpxToDocx(hwpxBuffer) {
  const doc = await HanDoc.open(hwpxBuffer);
  const header = doc.header;
  const sections = doc.sections;
  const borderFills = /* @__PURE__ */ new Map();
  for (const bf of header.refList.borderFills) {
    const id = parseInt(bf.attrs["id"] ?? "0");
    if (id > 0) borderFills.set(id, parseBorderFill(bf));
  }
  const docxHeaders = doc.headers.length > 0 ? { default: convertHeaderFooterToDocxHeader(doc.headers, header) } : void 0;
  const docxFooters = doc.footers.length > 0 ? { default: convertHeaderFooterToDocxFooter(doc.footers, header) } : void 0;
  const docxSections = sections.map((section, idx) => {
    const children = convertSection(section, header, doc, borderFills);
    const sectionProps = section.sectionProps;
    return {
      properties: {
        ...sectionProps ? convertSectionProperties(sectionProps) : {}
      },
      headers: idx === 0 ? docxHeaders : void 0,
      footers: idx === 0 ? docxFooters : void 0,
      children
    };
  });
  const docxDoc = new Document({
    creator: doc.metadata.creator ?? "HanDoc",
    title: doc.metadata.title,
    sections: docxSections
  });
  const buffer = await Packer.toBuffer(docxDoc);
  return new Uint8Array(buffer);
}
function convertHeaderFooterToDocxHeader(headers, docHeader) {
  const children = [];
  for (const hf of headers) {
    for (const para of hf.paragraphs) {
      const converted = convertParagraphToDocx(para, docHeader);
      children.push(...converted.filter((c) => c instanceof DocxParagraph));
    }
  }
  return new Header({ children: children.length > 0 ? children : [new DocxParagraph({})] });
}
function convertHeaderFooterToDocxFooter(footers, docHeader) {
  const children = [];
  for (const hf of footers) {
    for (const para of hf.paragraphs) {
      const converted = convertParagraphToDocx(para, docHeader);
      children.push(...converted.filter((c) => c instanceof DocxParagraph));
    }
  }
  return new Footer({ children: children.length > 0 ? children : [new DocxParagraph({})] });
}
function convertParagraphToDocx(para, header) {
  const textRuns = [];
  const paraProp = para.paraPrIDRef != null ? header.refList.paraProperties.find((p) => p.id === para.paraPrIDRef) : void 0;
  for (const run of para.runs) {
    const charProp = run.charPrIDRef != null ? header.refList.charProperties.find((c) => c.id === run.charPrIDRef) : void 0;
    for (const child of run.children) {
      if (child.type === "text") {
        textRuns.push(createTextRun(child.content, charProp, header));
      }
    }
  }
  return [createDocxParagraph(textRuns, paraProp)];
}
function convertSectionProperties(props) {
  return {
    page: {
      size: {
        width: hwpUnitToTwip(props.pageWidth),
        height: hwpUnitToTwip(props.pageHeight),
        orientation: props.landscape ? "landscape" : void 0
      },
      margin: {
        top: hwpUnitToTwip(props.margins.top),
        bottom: hwpUnitToTwip(props.margins.bottom),
        left: hwpUnitToTwip(props.margins.left),
        right: hwpUnitToTwip(props.margins.right),
        header: hwpUnitToTwip(props.margins.header),
        footer: hwpUnitToTwip(props.margins.footer),
        gutter: hwpUnitToTwip(props.margins.gutter)
      }
    }
  };
}
function convertSection(section, header, doc, borderFills) {
  const result = [];
  for (const para of section.paragraphs) {
    const converted = convertParagraph(para, header, doc, borderFills);
    result.push(...converted);
  }
  return result;
}
function convertParagraph(para, header, doc, borderFills) {
  const result = [];
  const textRuns = [];
  const paraProp = para.paraPrIDRef != null ? header.refList.paraProperties.find((p) => p.id === para.paraPrIDRef) : void 0;
  if (para.pageBreak) {
    textRuns.push(new TextRun({ children: [new PageBreak()] }));
  }
  for (const run of para.runs) {
    const charProp = run.charPrIDRef != null ? header.refList.charProperties.find((c) => c.id === run.charPrIDRef) : void 0;
    for (const child of run.children) {
      if (child.type === "text") {
        textRuns.push(createTextRun(child.content, charProp, header));
      } else if (child.type === "table") {
        if (textRuns.length > 0) {
          result.push(createDocxParagraph(textRuns.splice(0), paraProp));
        }
        const table = convertTable(child.element, header, doc, borderFills);
        if (table) result.push(table);
      } else if (child.type === "inlineObject") {
        const imageRun = convertInlineObject(child, doc);
        if (imageRun) textRuns.push(imageRun);
      }
    }
  }
  if (textRuns.length > 0 || result.length === 0) {
    result.push(createDocxParagraph(textRuns, paraProp));
  }
  return result;
}
function convertInlineObject(child, doc) {
  const el = child.element;
  const imgPath = findImagePath(el);
  if (!imgPath) return null;
  const imgData = doc.getImage(imgPath);
  if (!imgData) return null;
  const { width, height } = findImageDimensions(el);
  const resolvedImage = doc.images.find((image) => image.data === imgData);
  const ext = (resolvedImage?.path ?? imgPath).split(".").pop()?.toLowerCase() ?? "png";
  const typeMap = {
    "jpg": "jpg",
    "jpeg": "jpg",
    "png": "png",
    "gif": "gif",
    "bmp": "bmp"
  };
  const imgType = typeMap[ext] ?? "png";
  return new ImageRun({
    type: imgType,
    data: imgData,
    transformation: {
      width: width > 0 ? hwpUnitToEmu(width) / 914400 * 96 : 200,
      height: height > 0 ? hwpUnitToEmu(height) / 914400 * 96 : 150
    }
  });
}
function findImagePath(el) {
  for (const child of el.children) {
    if (child.tag === "binItem" || child.tag.endsWith(":binItem")) {
      const src = child.attrs["src"] ?? child.attrs["href"];
      if (src) return src;
    }
    if (child.tag === "img" || child.tag.endsWith(":img")) {
      const src = child.attrs["binaryItemIDRef"] ?? child.attrs["src"];
      if (src) return src;
    }
    const found = findImagePath(child);
    if (found) return found;
  }
  return null;
}
function findImageDimensions(el) {
  const w = parseInt(el.attrs["width"] ?? "0");
  const h = parseInt(el.attrs["height"] ?? "0");
  if (w > 0 && h > 0) return { width: w, height: h };
  for (const child of el.children) {
    if (child.tag === "sz" || child.tag.endsWith(":sz") || child.tag === "imgRect" || child.tag.endsWith(":imgRect")) {
      const cw = parseInt(child.attrs["width"] ?? child.attrs["cx"] ?? "0");
      const ch = parseInt(child.attrs["height"] ?? child.attrs["cy"] ?? "0");
      if (cw > 0 && ch > 0) return { width: cw, height: ch };
    }
    const found = findImageDimensions(child);
    if (found.width > 0) return found;
  }
  return { width: 0, height: 0 };
}
function createDocxParagraph(children, paraProp) {
  let heading;
  if (paraProp?.heading) {
    const level = paraProp.heading.level;
    const headingMap = {
      1: HeadingLevel.HEADING_1,
      2: HeadingLevel.HEADING_2,
      3: HeadingLevel.HEADING_3,
      4: HeadingLevel.HEADING_4,
      5: HeadingLevel.HEADING_5,
      6: HeadingLevel.HEADING_6
    };
    heading = headingMap[level];
  }
  return new DocxParagraph({
    children,
    alignment: paraProp?.align ? ALIGN_MAP[paraProp.align] : void 0,
    heading
  });
}
function createTextRun(text, charProp, header) {
  const font = charProp && header ? resolveFontName(charProp, header) : void 0;
  return new TextRun({
    text,
    bold: charProp?.bold || void 0,
    italics: charProp?.italic || void 0,
    underline: charProp?.underline && charProp.underline !== "none" ? {} : void 0,
    strike: charProp?.strikeout && charProp.strikeout !== "none" ? true : void 0,
    size: charProp?.height ? hwpUnitToHalfPt(charProp.height) : void 0,
    color: normalizeHexColor(charProp?.textColor),
    font: font ? { name: font } : void 0
  });
}
function extractTextFromGeneric(el) {
  let text = el.text ?? "";
  for (const child of el.children) {
    text += extractTextFromGeneric(child);
  }
  return text;
}
function convertTable(tableEl, header, doc, borderFills) {
  let parsed;
  try {
    parsed = parseTable(tableEl);
  } catch {
    return convertTableSimple(tableEl);
  }
  if (parsed.rows.length === 0) return null;
  const tableRows = parsed.rows.map((row) => {
    const tableCells = row.cells.map((cell) => {
      const cellText = cell.paragraphs.flatMap((p) => p.runs.flatMap(
        (r) => r.children.filter((c) => c.type === "text").map((c) => c.content)
      )).join("");
      const cellOpts = {
        children: [new DocxParagraph({ children: [new TextRun(cellText)] })]
      };
      if (cell.cellSpan.colSpan > 1) {
        cellOpts.columnSpan = cell.cellSpan.colSpan;
      }
      if (cell.cellSpan.rowSpan > 1) {
        cellOpts.rowSpan = cell.cellSpan.rowSpan;
      }
      if (cell.borderFillIDRef > 0) {
        const bf = borderFills.get(cell.borderFillIDRef);
        if (bf) {
          if (bf.bgColor) {
            cellOpts.shading = {
              fill: normalizeHexColor(bf.bgColor),
              type: ShadingType.CLEAR,
              color: "auto"
            };
          }
          if (Object.keys(bf.borders).length > 0) {
            const borders = {};
            for (const [side, border] of Object.entries(bf.borders)) {
              if (border) {
                borders[side] = {
                  style: border.style,
                  size: border.width ?? 1,
                  color: border.color ?? "000000"
                };
              }
            }
            if (Object.keys(borders).length > 0) {
              cellOpts.borders = borders;
            }
          }
        }
      }
      return new TableCell(cellOpts);
    });
    if (tableCells.length === 0) {
      return new TableRow({
        children: [new TableCell({ children: [new DocxParagraph({})] })]
      });
    }
    return new TableRow({ children: tableCells });
  });
  return new Table({ rows: tableRows });
}
function convertTableSimple(tableEl) {
  const rows = tableEl.children.filter((c) => c.tag === "tr" || c.tag.endsWith(":tr"));
  if (rows.length === 0) return null;
  const tableRows = rows.map((row) => {
    const cells = row.children.filter((c) => c.tag === "tc" || c.tag.endsWith(":tc"));
    const tableCells = cells.map((cell) => {
      const cellText = extractTextFromGeneric(cell);
      return new TableCell({
        children: [new DocxParagraph({ children: [new TextRun(cellText)] })]
      });
    });
    if (tableCells.length === 0) {
      return new TableRow({
        children: [new TableCell({ children: [new DocxParagraph({})] })]
      });
    }
    return new TableRow({ children: tableCells });
  });
  return new Table({ rows: tableRows });
}
export {
  HanDoc,
  HwpxBuilder,
  docxToHwpx,
  hwpxToDocx,
  parseDocx
};
