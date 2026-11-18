/**
 * HwpDocument IR → HWPX(OWPML) 패키지 빌더 (스타일 보존 포함).
 *
 * - DocInfo 의 fontFaces / charShapes / paraShapes / styles 를 header.xml refList 로 매핑
 * - paragraph: paraPrIDRef = paraShapeId, styleIDRef = styleId
 * - run: charPrIDRef = charShapeId
 * - 표/이미지 + BinData 패키징 + manifest 등록
 *
 * 1차 포팅 한계: BorderFill/Numbering/TabDef 는 paraShape 의 참조 ID 만 보존하고
 *               실제 정의는 default(0) 로 둠. 추후 단계에서 정의 자체도 옮길 예정.
 */

import JSZip from "jszip";
import type {
  HwpDocument,
  HwpDocInfo,
  HwpCharShape,
  HwpParaShape,
  HwpStyle,
  HwpFaceName,
  HwpBorderFill,
  HwpBorderLine,
  HwpNumbering,
  HwpBullet,
  HwpTabDef,
  HwpParagraph,
  HwpRun,
  HwpControl,
  HwpTableControl,
  HwpTableCell,
} from "./types.js";
import { detectImageMime } from "./binData.js";

const NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HH = "http://www.hancom.co.kr/hwpml/2011/head";
const NS_HC = "http://www.hancom.co.kr/hwpml/2011/core";
const NS_HA = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_HS = "http://www.hancom.co.kr/hwpml/2011/section";
const NS_OPF = "http://www.idpf.org/2007/opf/";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_OASIS_CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OASIS_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

const LANG_NAMES = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"] as const;

const DEFAULT_LINESEG =
  `<hp:linesegarray>` +
  `<hp:lineseg textpos="0" vertpos="0" vertsize="1000" textheight="1000" baseline="850" spacing="600" horzpos="0" horzsize="42520" flags="393216"/>` +
  `</hp:linesegarray>`;

export interface BuildOptions {
  title?: string;
  creator?: string;
}

interface BinEntry {
  id: string;
  href: string;
  mediaType: string;
  data: Uint8Array;
}

export async function buildHwpxFromDocument(
  doc: HwpDocument,
  options?: BuildOptions
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });

  // BinData 매니페스트 항목 사전 구성
  const binEntries: BinEntry[] = [];
  const binDataMap = doc.binData instanceof Map ? doc.binData : new Map();
  for (const [storageId, { data, extension }] of binDataMap) {
    const ext = extension.toLowerCase();
    binEntries.push({
      id: `image${storageId}`,
      href: `BinData/image${storageId}.${ext}`,
      mediaType: detectImageMime(ext),
      data,
    });
  }

  // META-INF/container.xml
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<container xmlns="${NS_OASIS_CONTAINER}">` +
      `<rootfiles>` +
      `<rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
      `</rootfiles>` +
      `</container>`
  );

  // META-INF/manifest.xml
  const manifestEntries: string[] = [
    `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwpml-package+xml"/>`,
    `<manifest:file-entry manifest:full-path="version.xml" manifest:media-type="application/xml"/>`,
    `<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="application/xml"/>`,
    `<manifest:file-entry manifest:full-path="Contents/content.hpf" manifest:media-type="application/hwpml-package+xml"/>`,
    `<manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="application/xml"/>`,
  ];
  for (let i = 0; i < doc.sections.length; i++) {
    manifestEntries.push(
      `<manifest:file-entry manifest:full-path="Contents/section${i}.xml" manifest:media-type="application/xml"/>`
    );
  }
  for (const e of binEntries) {
    manifestEntries.push(
      `<manifest:file-entry manifest:full-path="${e.href}" manifest:media-type="${e.mediaType}"/>`
    );
  }
  zip.file(
    "META-INF/manifest.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<manifest:manifest xmlns:manifest="${NS_OASIS_MANIFEST}">` +
      manifestEntries.join("") +
      `</manifest:manifest>`
  );

  // version.xml
  zip.file(
    "version.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
      `<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.2" application="Hancom Office Hangul" appVersion="10, 0, 0, 5060 WIN32LEWindows_8"/>`
  );

  // settings.xml
  zip.file(
    "settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
      `<ha:HWPApplicationSetting xmlns:ha="${NS_HA}" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">` +
      `<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>` +
      `</ha:HWPApplicationSetting>`
  );

  // OPF 매니페스트 + spine
  const opfManifest: string[] = [
    `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`,
    `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>`,
    `<opf:item id="prvText" href="Preview/PrvText.txt" media-type="text/plain"/>`,
  ];
  for (let i = 0; i < doc.sections.length; i++) {
    opfManifest.push(
      `<opf:item id="section${i}" href="Contents/section${i}.xml" media-type="application/xml"/>`
    );
  }
  for (const e of binEntries) {
    opfManifest.push(`<opf:item id="${e.id}" href="${e.href}" media-type="${e.mediaType}" isEmbeded="1"/>`);
  }
  const spineRefs = `<opf:itemref idref="header" linear="yes"/>` + doc.sections.map((_, i) => `<opf:itemref idref="section${i}" linear="yes"/>`).join("");
  zip.file(
    "Contents/content.hpf",
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<opf:package xmlns:opf="${NS_OPF}" xmlns:dc="${NS_DC}" version="1.0">` +
      `<opf:metadata>` +
      `<dc:title>${escapeXml(options?.title ?? "")}</dc:title>` +
      `<dc:creator>${escapeXml(options?.creator ?? "")}</dc:creator>` +
      `<dc:format>application/hwpml-package+xml</dc:format>` +
      `</opf:metadata>` +
      `<opf:manifest>` +
      opfManifest.join("") +
      `</opf:manifest>` +
      `<opf:spine>` +
      spineRefs +
      `</opf:spine>` +
      `</opf:package>`
  );

  // header.xml — DocInfo 기반 풀 빌드
  zip.file("Contents/header.xml", buildHeaderXmlFromDocInfo(doc.docInfo));

  // 섹션
  for (let i = 0; i < doc.sections.length; i++) {
    const paraIdState = { nextId: 1 };
    zip.file(`Contents/section${i}.xml`, buildSectionXml(doc.sections[i].paragraphs, binEntries, paraIdState));
  }

  // BinData
  for (const e of binEntries) {
    zip.file(e.href, e.data);
  }

  // Preview/PrvText.txt — 다른 HWP 뷰어 호환을 위한 평문 미리보기
  zip.file("Preview/PrvText.txt", buildPrvText(doc));

  return await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

/**
 * 한컴 HWP/HWPX 의 Preview/PrvText.txt 형식을 따른 미리보기 평문 생성.
 *   - 셀은 "<셀텍스트 >" 로 감싸 행 단위로 나열
 *   - 행 사이는 \r\n
 *   - 일반 문단은 그대로
 */
function buildPrvText(doc: HwpDocument): string {
  const lines: string[] = [];
  for (const section of doc.sections) {
    for (const para of section.paragraphs) {
      collectPrvLines(para, lines);
    }
  }
  // 약 2KB 까지만 보존 (Hancom 제한)
  return lines.join("\r\n").slice(0, 2000);
}

function collectPrvLines(para: HwpParagraph, lines: string[]): void {
  if (para.text.length > 0) {
    lines.push(para.text);
  }
  for (const ctrl of para.controls) {
    if (ctrl.kind === "table") {
      // 행별로 셀을 < ... > 로 감싸 join
      const rows: HwpTableCell[][] = Array.from({ length: ctrl.rowCount }, () => []);
      for (const cell of ctrl.cells) {
        if (cell.row >= 0 && cell.row < ctrl.rowCount) rows[cell.row].push(cell);
      }
      for (const row of rows) {
        row.sort((a, b) => a.col - b.col);
        const cellTexts = row.map((cell) => {
          const inner = cell.paragraphs
            .map((q) => {
              const buf: string[] = [];
              collectPrvLines(q, buf);
              return buf.join(" ");
            })
            .join(" ");
          return inner.trim();
        });
        if (cellTexts.length > 0) lines.push(cellTexts.join(" "));
      }
    } else if (
      ctrl.kind === "header" ||
      ctrl.kind === "footer" ||
      ctrl.kind === "footnote"
    ) {
      for (const q of ctrl.paragraphs) collectPrvLines(q, lines);
    } else if (ctrl.kind === "equation" && ctrl.script.length > 0) {
      lines.push(ctrl.script);
    }
  }
}

// ============================================================
// header.xml 빌드 (DocInfo → refList)
// ============================================================

function buildHeaderXmlFromDocInfo(docInfo: HwpDocInfo): string {
  const fontfacesXml = buildFontfacesXml(docInfo.fontFaces);
  const borderFillsXml = buildBorderFillsXml(docInfo.borderFills);
  const charPropsXml = buildCharPropertiesXml(docInfo.charShapes);
  const tabDefsXml = buildTabDefsXml(docInfo.tabDefs);
  const numberingsXml = buildNumberingsXml(docInfo.numberings);
  const bulletsXml = buildBulletsXml(docInfo.bullets);
  const paraPropsXml = buildParaPropertiesXml(docInfo.paraShapes);
  const stylesXml = buildStylesXml(docInfo.styles);

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<hh:head xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="1.2" secCnt="1">` +
    `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
    `<hh:refList>` +
    fontfacesXml +
    borderFillsXml +
    charPropsXml +
    tabDefsXml +
    numberingsXml +
    bulletsXml +
    paraPropsXml +
    stylesXml +
    `</hh:refList>` +
    `</hh:head>`
  );
}

function buildBorderFillsXml(borderFills: HwpBorderFill[]): string {
  const cnt = Math.max(1, borderFills.length);
  const items: string[] = [];
  for (let i = 0; i < cnt; i++) {
    items.push(buildSingleBorderFillXml(i, borderFills[i]));
  }
  return `<hh:borderFills itemCnt="${cnt}">${items.join("")}</hh:borderFills>`;
}

/** HWP 너비 인덱스 → mm 매핑 (HWP 5.0 스펙) */
const BORDER_WIDTH_MM = [
  "0.1", "0.12", "0.15", "0.2", "0.25", "0.3", "0.4", "0.5",
  "0.6", "0.7", "1.0", "1.5", "2.0", "3.0", "4.0", "5.0",
];

const BORDER_LINE_TYPE_NAMES = [
  "NONE", "SOLID", "DASH", "DOT", "DASH_DOT", "DASH_DOT_DOT", "LONG_DASH", "CIRCLE",
  "DOUBLE", "THIN_THICK_DOUBLE", "THICK_THIN_DOUBLE", "THIN_THICK_THIN_TRIPLE",
  "WAVE", "DOUBLE_WAVE", "THICK_3D", "THICK_3D_REVERSE", "THIN_3D", "THIN_3D_REVERSE",
];

function lineTypeName(idx: number): string {
  return BORDER_LINE_TYPE_NAMES[idx] ?? "SOLID";
}

function widthMm(idx: number): string {
  return (BORDER_WIDTH_MM[idx] ?? "0.1") + " mm";
}

function buildBorderXml(tagName: string, line: HwpBorderLine | undefined): string {
  if (!line) {
    return `<hh:${tagName} type="SOLID" width="0.1 mm" color="#000000"/>`;
  }
  return `<hh:${tagName} type="${lineTypeName(line.lineType)}" width="${widthMm(line.widthIndex)}" color="${colorBgrToHex(line.color)}"/>`;
}

function buildSingleBorderFillXml(id: number, bf?: HwpBorderFill): string {
  const left = buildBorderXml("leftBorder", bf?.borders?.[0]);
  const right = buildBorderXml("rightBorder", bf?.borders?.[1]);
  const top = buildBorderXml("topBorder", bf?.borders?.[2]);
  const bottom = buildBorderXml("bottomBorder", bf?.borders?.[3]);

  // BorderFill attr u16 비트필드:
  //   bit 0: 3D, bit 1: 그림자
  //   bit 2..4 (0x1C): slash 대각선 모양 — 0=NONE, 그 외=present
  //   bit 5..7 (0xE0): backSlash 대각선 모양
  const attr = bf?.attr ?? 0;
  const slashKind = (attr >>> 2) & 0x07;
  const backSlashKind = (attr >>> 5) & 0x07;
  const diagWidth = widthMm(bf?.diagonal?.widthIndex ?? 0);
  const diagColor = colorBgrToHex(bf?.diagonal?.color ?? 0);
  const slashType = slashKind !== 0 ? "SOLID" : "NONE";
  const backSlashType = backSlashKind !== 0 ? "SOLID" : "NONE";

  // <hh:diagonal> 의 type 은 둘 중 하나라도 있으면 SOLID
  const hasDiag = slashKind !== 0 || backSlashKind !== 0;
  const diagonalEl = `<hh:diagonal type="${hasDiag ? "SOLID" : "NONE"}" width="${diagWidth}" color="${diagColor}"/>`;

  const fillEl = bf?.fill
    ? `<hh:fillBrush>` +
      `<hh:winBrush faceColor="${colorBgrToHex(bf.fill.backgroundColor)}" hatchColor="${colorBgrToHex(bf.fill.patternColor)}" hatchStyle="${bf.fill.patternType < 0 ? "NONE" : "HORIZONTAL"}" alpha="0"/>` +
      `</hh:fillBrush>`
    : "";

  return (
    `<hh:borderFill id="${id}" threeD="${(attr & 0x01) !== 0 ? 1 : 0}" shadow="${(attr & 0x02) !== 0 ? 1 : 0}" centerLine="NONE" breakCellSeparateLine="0">` +
    `<hh:slash type="${slashType}" Crooked="0" isCounter="0"/>` +
    `<hh:backSlash type="${backSlashType}" Crooked="0" isCounter="0"/>` +
    left +
    right +
    top +
    bottom +
    diagonalEl +
    fillEl +
    `</hh:borderFill>`
  );
}

function buildTabDefsXml(tabDefs: HwpTabDef[]): string {
  const cnt = Math.max(1, tabDefs.length);
  const items: string[] = [];
  for (let i = 0; i < cnt; i++) {
    const td = tabDefs[i];
    const al = td?.autoTabLeft ?? true ? 1 : 0;
    const ar = td?.autoTabRight ?? true ? 1 : 0;
    items.push(
      `<hh:tabPr id="${i}" autoTabLeft="${al}" autoTabRight="${ar}">` +
        `<hh:items itemCnt="0"/>` +
        `</hh:tabPr>`
    );
  }
  return `<hh:tabPrs itemCnt="${cnt}">${items.join("")}</hh:tabPrs>`;
}

function buildNumberingsXml(numberings: HwpNumbering[]): string {
  if (numberings.length === 0) {
    return (
      `<hh:numberings itemCnt="1">` +
      `<hh:numbering id="0" start="1">` +
      Array.from({ length: 7 })
        .map(
          (_, level) =>
            `<hh:paraHead level="${level + 1}" start="1" numFormat="^${level + 1}." textOffsetType="PERCENT" textOffset="50" numberingChar="false" charPrIDRef="0">` +
            `<hh:autoNumberFormat type="DIGIT" userChar="" prefixChar="" suffixChar="."/>` +
            `</hh:paraHead>`
        )
        .join("") +
      `</hh:numbering>` +
      `</hh:numberings>`
    );
  }
  const items = numberings
    .map(
      (n, idx) =>
        `<hh:numbering id="${idx}" start="${n.startNumber}">` +
        n.levelFormats
          .map(
            (fmt, level) =>
              `<hh:paraHead level="${level + 1}" start="1" numFormat="${escapeXml(fmt || "^" + (level + 1) + ".")}" textOffsetType="PERCENT" textOffset="50" numberingChar="false" charPrIDRef="0">` +
              `<hh:autoNumberFormat type="DIGIT" userChar="" prefixChar="" suffixChar="."/>` +
              `</hh:paraHead>`
          )
          .join("") +
        `</hh:numbering>`
    )
    .join("");
  return `<hh:numberings itemCnt="${numberings.length}">${items}</hh:numberings>`;
}

function buildBulletsXml(bullets: HwpBullet[]): string {
  if (bullets.length === 0) {
    return (
      `<hh:bullets itemCnt="1">` +
      `<hh:bullet id="0" char="●" imageBullet="0" checkedChar="0">` +
      `<hh:img bright="0" contrast="0" effect="REAL_PIC" binaryItemIDRef="0"/>` +
      `</hh:bullet>` +
      `</hh:bullets>`
    );
  }
  const items = bullets
    .map(
      (b, idx) =>
        `<hh:bullet id="${idx}" char="${escapeXml(b.bulletChar)}" imageBullet="0" checkedChar="0">` +
        `<hh:img bright="0" contrast="0" effect="REAL_PIC" binaryItemIDRef="0"/>` +
        `</hh:bullet>`
    )
    .join("");
  return `<hh:bullets itemCnt="${bullets.length}">${items}</hh:bullets>`;
}

function buildFontfacesXml(fontFaces: HwpFaceName[][]): string {
  // 7개 언어 그룹 — 비어있어도 lang 속성은 넣어둔다.
  // 그룹 안 폰트가 0개면 단일 fallback "바탕"
  const groups: string[] = [];
  for (let li = 0; li < 7; li++) {
    const fonts = fontFaces[li] ?? [];
    const lang = LANG_NAMES[li];
    const list = fonts.length > 0
      ? fonts.map((f, idx) => buildFontXml(idx, f)).join("")
      : `<hh:font id="0" type="TTF" name="바탕"/>`;
    const cnt = fonts.length > 0 ? fonts.length : 1;
    groups.push(
      `<hh:fontface lang="${lang}" fontCnt="${cnt}">${list}</hh:fontface>`
    );
  }
  return `<hh:fontfaces itemCnt="${groups.length}">${groups.join("")}</hh:fontfaces>`;
}

function buildFontXml(id: number, f: HwpFaceName): string {
  const subAttrs = f.substituteName ? ` type="UNKNOWN" hh:name="${escapeXml(f.substituteName)}"` : "";
  const sub = f.substituteName ? `<hh:substFont${subAttrs}/>` : "";
  return `<hh:font id="${id}" type="TTF" name="${escapeXml(f.name)}">${sub}</hh:font>`;
}

function buildCharPropertiesXml(charShapes: HwpCharShape[]): string {
  if (charShapes.length === 0) {
    // 최소 1개 fallback
    return (
      `<hh:charProperties itemCnt="1">` +
      `<hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">` +
      defaultFontGroupXml() +
      `</hh:charPr>` +
      `</hh:charProperties>`
    );
  }
  const items = charShapes.map((cs, idx) => buildCharPrXml(idx, cs)).join("");
  return `<hh:charProperties itemCnt="${charShapes.length}">${items}</hh:charProperties>`;
}

function buildCharPrXml(id: number, cs: HwpCharShape): string {
  const ids = cs.faceNameIds || {
    hangul: 0,
    latin: 0,
    hanja: 0,
    japanese: 0,
    other: 0,
    symbol: 0,
    user: 0,
  };
  const fontRef =
    `<hh:fontRef hangul="${ids.hangul ?? 0}" latin="${ids.latin ?? 0}" hanja="${ids.hanja ?? 0}" japanese="${ids.japanese ?? 0}" other="${ids.other ?? 0}" symbol="${ids.symbol ?? 0}" user="${ids.user ?? 0}"/>`;
  const ratio = `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>`;
  const spacing = `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>`;
  const relSz = `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>`;
  const offset = `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>`;
  const italic = cs.italic ? `<hh:italic/>` : "";
  const bold = cs.bold ? `<hh:bold/>` : "";
  const underline = cs.underline
    ? `<hh:underline type="BOTTOM" shape="SOLID" color="${colorBgrToHex(cs.underlineColor)}"/>`
    : "";
  const strikeout = cs.strikeout
    ? `<hh:strikeout shape="SOLID" color="${colorBgrToHex(cs.textColor)}"/>`
    : "";

  const textColor = colorBgrToHex(cs.textColor);
  const shadeColor = cs.shadeColor === 0xffffff || cs.shadeColor === 0 ? "none" : colorBgrToHex(cs.shadeColor);

  return (
    `<hh:charPr id="${id}" height="${cs.baseSize}" textColor="${textColor}" shadeColor="${shadeColor}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">` +
    fontRef +
    ratio +
    spacing +
    relSz +
    offset +
    italic +
    bold +
    underline +
    strikeout +
    `</hh:charPr>`
  );
}

function defaultFontGroupXml(): string {
  return (
    `<hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
    `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
    `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
    `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
    `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>`
  );
}

function buildParaPropertiesXml(paraShapes: HwpParaShape[]): string {
  if (paraShapes.length === 0) {
    return (
      `<hh:paraProperties itemCnt="1">` +
      `<hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="JUSTIFY" vertical="BASELINE"/>` +
      `<hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hh:margin><hh:intent value="0"/><hh:left value="0"/><hh:right value="0"/><hh:prev value="0"/><hh:next value="0"/></hh:margin>` +
      `<hh:lineSpacing type="PERCENT" value="160"/>` +
      `</hh:paraPr>` +
      `</hh:paraProperties>`
    );
  }
  const items = paraShapes.map((ps, idx) => buildParaPrXml(idx, ps)).join("");
  return `<hh:paraProperties itemCnt="${paraShapes.length}">${items}</hh:paraProperties>`;
}

function buildParaPrXml(id: number, ps: HwpParaShape): string {
  const align = alignToOwpml(ps.alignment);
  return (
    `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
    `<hh:align horizontal="${align}" vertical="BASELINE"/>` +
    `<hh:heading type="NONE" idRef="0" level="0"/>` +
    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
    `<hh:margin>` +
    `<hh:intent value="${ps.indent}"/>` +
    `<hh:left value="${ps.leftMargin}"/>` +
    `<hh:right value="${ps.rightMargin}"/>` +
    `<hh:prev value="${ps.prevSpacing}"/>` +
    `<hh:next value="${ps.nextSpacing}"/>` +
    `</hh:margin>` +
    `<hh:lineSpacing type="PERCENT" value="${Math.max(0, ps.lineSpacing)}"/>` +
    `</hh:paraPr>`
  );
}

function buildStylesXml(styles: HwpStyle[]): string {
  if (styles.length === 0) {
    return (
      `<hh:styles itemCnt="1">` +
      `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
      `</hh:styles>`
    );
  }
  const items = styles
    .map(
      (s, idx) =>
        `<hh:style id="${idx}" type="PARA" name="${escapeXml(s.name || "Style" + idx)}" engName="${escapeXml(s.engName ?? "")}" paraPrIDRef="${s.paraShapeId}" charPrIDRef="${s.charShapeId}" nextStyleIDRef="${idx}" langID="1042" lockForm="0"/>`
    )
    .join("");
  return `<hh:styles itemCnt="${styles.length}">${items}</hh:styles>`;
}

// ============================================================
// 색상 / 정렬 변환
// ============================================================

/** HWP ColorRef (u32 LE 의 0xAABBGGRR 형식) → "#RRGGBB" */
export function colorBgrToHex(color: number): string {
  const r = color & 0xff;
  const g = (color >>> 8) & 0xff;
  const b = (color >>> 16) & 0xff;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("");
}

function alignToOwpml(a: HwpParaShape["alignment"]): string {
  switch (a) {
    case "left":
      return "LEFT";
    case "right":
      return "RIGHT";
    case "center":
      return "CENTER";
    case "justify":
      return "JUSTIFY";
    case "distribute":
      return "DISTRIBUTE";
    case "distributeSpace":
      return "DISTRIBUTE_SPACE";
    default:
      return "JUSTIFY";
  }
}

// ============================================================
// section.xml 빌드
// ============================================================


function getSecPrXml(): string {
  return (
    `<hp:run charPrIDRef="0">` +
    `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" outlineShapeIDRef="1" memoShapeIDRef="0" textVerticalWidthHead="0" masterPageCnt="0">` +
    `<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>` +
    `<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>` +
    `<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>` +
    `<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>` +
    `<hp:pagePr landscape="WIDELY" width="59528" height="84186" gutterType="LEFT_ONLY">` +
    `<hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/>` +
    `</hp:pagePr>` +
    `<hp:footNotePr>` +
    `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
    `<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>` +
    `<hp:noteSpacing betweenNotes="283" belowLine="567" aboveLine="850"/>` +
    `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hp:placement place="EACH_COLUMN" beneathText="0"/>` +
    `</hp:footNotePr>` +
    `<hp:endNotePr>` +
    `<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>` +
    `<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>` +
    `<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>` +
    `<hp:numbering type="CONTINUOUS" newNum="1"/>` +
    `<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>` +
    `</hp:endNotePr>` +
    `<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER">` +
    `<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>` +
    `</hp:pageBorderFill>` +
    `</hp:secPr>` +
    `<hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" sameSz="1" sameGap="0"/></hp:ctrl>` +
    `</hp:run>`
  );
}
function buildSectionXml(paragraphs: HwpParagraph[], binEntries: BinEntry[], paraIdState: { nextId: number }): string {
  // 본 문단 + 머리말/꼬리말/각주 인라인 보강
  const parts: string[] = [];
  let isFirst = true;
  for (const p of paragraphs) {
    parts.push(buildParagraphXml(p, binEntries, isFirst, paraIdState));
    isFirst = false;
    // 같은 paragraph 안의 header/footer/footnote 컨트롤이 가진 paragraphs 도 본문 흐름에 평탄 출력
    for (const ctrl of p.controls) {
      if (
        ctrl.kind === "header" ||
        ctrl.kind === "footer" ||
        ctrl.kind === "footnote"
      ) {
        for (const subPara of ctrl.paragraphs) {
          parts.push(buildParagraphXml(subPara, binEntries, false, paraIdState));
        }
      }
    }
  }
  if (paragraphs.length === 0) {
    const emptyId = paraIdState.nextId++;
    parts.push(`<hp:p id="${emptyId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${getSecPrXml()}<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
    `<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">` +
    parts.join("") +
    `</hs:sec>`
  );
}

function buildParagraphXml(p: HwpParagraph, binEntries: BinEntry[], includeSecPr = false, paraIdState?: { nextId: number }): string {
  const parts: string[] = [];
  if (includeSecPr) {
    parts.push(getSecPrXml());
  }

  // 텍스트 run 들 (charShape 별로 분리됨)
  if (p.runs && p.runs.length > 0) {
    for (const run of p.runs) {
      parts.push(buildRunXml(run));
    }
  } else if (p.text && p.text.length > 0) {
    parts.push(buildRunXml({ charShapeId: 0, text: p.text }));
  }

  // 컨트롤 (표/그림/...)
  if (p.controls && p.controls.length > 0) {
    for (const ctrl of p.controls) {
      const xml = buildControlXml(ctrl, binEntries, paraIdState);
      if (xml) parts.push(xml);
    }
  }

  if (parts.length === 0) {
    parts.push(`<hp:run charPrIDRef="0"/>`);
  }

  const pid = paraIdState ? paraIdState.nextId++ : 1;
  return (
    `<hp:p id="${pid}" paraPrIDRef="${p.paraShapeId}" styleIDRef="${p.styleId}" pageBreak="0" columnBreak="0" merged="0">` +
    parts.join("") +
    `</hp:p>`
  );
}

function buildRunXml(run: HwpRun): string {
  return `<hp:run charPrIDRef="${run.charShapeId}"><hp:t>${escapeXml(run.text)}</hp:t></hp:run>`;
}

function buildControlXml(ctrl: HwpControl, binEntries: BinEntry[], paraIdState?: { nextId: number }): string {
  switch (ctrl.kind) {
    case "table":
      return `<hp:run charPrIDRef="0">${buildTableXml(ctrl, binEntries, paraIdState)}</hp:run>`;
    case "picture": {
      const entry = binEntries.find((b) => b.id === `image${ctrl.binDataId}`);
      if (!entry) return "";
      const pid = paraIdState ? paraIdState.nextId++ : 1;
      const picId = 1000000000 + pid;
      const instId = 2000000000 + pid;
      const width = ctrl.width && ctrl.width > 0 ? ctrl.width : 28346; // ~100mm
      const height = ctrl.height && ctrl.height > 0 ? ctrl.height : 21260; // ~75mm
      const orgWidth = ctrl.orgWidth && ctrl.orgWidth > 0 ? ctrl.orgWidth : width;
      const orgHeight = ctrl.orgHeight && ctrl.orgHeight > 0 ? ctrl.orgHeight : height;
      const cx = Math.floor(width / 2);
      const cy = Math.floor(height / 2);
      return (
        `<hp:run charPrIDRef="0">` +
        `<hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${instId}" reverse="0">` +
        `<hp:offset x="0" y="0"/>` +
        `<hp:orgSz width="${orgWidth}" height="${orgHeight}"/>` +
        `<hp:curSz width="${width}" height="${height}"/>` +
        `<hp:flip horizontal="0" vertical="0"/>` +
        `<hp:rotationInfo angle="0" centerX="${cx}" centerY="${cy}" rotateimage="0"/>` +
        `<hp:renderingInfo>` +
        `<hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `<hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `<hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/>` +
        `</hp:renderingInfo>` +
        `<hc:img binaryItemIDRef="${entry.id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
        `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${width}" y="0"/><hc:pt2 x="${width}" y="${height}"/><hc:pt3 x="0" y="${height}"/></hp:imgRect>` +
        `<hp:imgClip left="0" right="${orgWidth}" top="0" bottom="${orgHeight}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:imgDim dimwidth="${orgWidth}" dimheight="${orgHeight}"/>` +
        `<hp:effects/>` +
        `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `</hp:pic>` +
        `<hp:t/>` +
        `</hp:run>`
      );
    }
    case "shape": {
      // 도형: 1차 포팅에서는 placeholder. line 은 좌표만 보존.
      const tag =
        ctrl.shapeType === "line"
          ? "line"
          : ctrl.shapeType === "rectangle"
            ? "rect"
            : ctrl.shapeType === "ellipse"
              ? "ellipse"
              : ctrl.shapeType === "arc"
                ? "arc"
                : ctrl.shapeType === "polygon"
                  ? "polygon"
                  : "curve";
      const coords =
        ctrl.shapeType === "line" && ctrl.x1 !== undefined
          ? `<hc:startPt x="${ctrl.x1}" y="${ctrl.y1 ?? 0}"/><hc:endPt x="${ctrl.x2 ?? 0}" y="${ctrl.y2 ?? 0}"/>`
          : "";
      return `<hp:run charPrIDRef="0"><hp:${tag}>${coords}</hp:${tag}></hp:run>`;
    }
    case "equation": {
      if (ctrl.script.length === 0) return "";
      return (
        `<hp:run charPrIDRef="0">` +
        `<hp:equation>` +
        `<hp:script>${escapeXml(ctrl.script)}</hp:script>` +
        `</hp:equation>` +
        `</hp:run>`
      );
    }
    case "header":
    case "footer":
    case "footnote":
    case "field":
    case "unknown":
      return "";
  }
}

function buildTableXml(t: HwpTableControl, binEntries: BinEntry[], paraIdState?: { nextId: number }): string {
  const rowCnt = t.rowCount || 1;
  const colCnt = t.colCount || 1;
  const colWidth = Math.floor(42520 / colCnt);

  const rows: HwpTableCell[][] = Array.from({ length: rowCnt }, () => []);
  for (const cell of t.cells) {
    if (cell.row >= 0 && cell.row < rowCnt) rows[cell.row].push(cell);
  }
  for (const row of rows) row.sort((a, b) => a.col - b.col);

  let totalHeight = 0;

  const trXml = rows
    .map((row, r) => {
      let rowHeight = 2400;
      let colAddr = 0;
      const tcXml = row
        .map((cell) => {
          const cAddr = cell.col !== undefined ? cell.col : colAddr;
          const span = cell.colSpan || 1;
          const rowSpan = cell.rowSpan || 1;
          const cellWidth = cell.width && cell.width > 0
            ? cell.width
            : ((cAddr + span === colCnt) ? (42520 - cAddr * colWidth) : (span * colWidth));
          const cellHeight = cell.height && cell.height > 0 ? cell.height : 2400;
          if (cellHeight > rowHeight) rowHeight = cellHeight;

          const cellInner = cell.paragraphs
            .map((q) => buildParagraphXml(q, binEntries, false, paraIdState))
            .join("");
          const emptyPid = paraIdState ? paraIdState.nextId++ : 1;
          colAddr = cAddr + span;

          return (
            `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="1">` +
            `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
            (cellInner || `<hp:p id="${emptyPid}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>`) +
            `</hp:subList>` +
            `<hp:cellAddr colAddr="${cAddr}" rowAddr="${r}"/>` +
            `<hp:cellSpan colSpan="${span}" rowSpan="${rowSpan}"/>` +
            `<hp:cellSz width="${cellWidth}" height="${cellHeight}"/>` +
            `<hp:cellMargin left="170" right="170" top="0" bottom="0"/>` +
            `</hp:tc>`
          );
        })
        .join("");
      totalHeight += rowHeight;
      return `<hp:tr>${tcXml}</hp:tr>`;
    })
    .join("");

  const tblParaId = paraIdState ? paraIdState.nextId++ : 1;
  const tblId = 1000000000 + tblParaId;

  return (
    `<hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="1" noAdjust="0">` +
    `<hp:sz width="42520" widthRelTo="ABSOLUTE" height="${totalHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    trXml +
    `</hp:tbl>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
