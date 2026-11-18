import JSZip from "jszip";
import {
  DocxBlockElement,
  DocxCharStyle,
  DocxDocumentModel,
  DocxParagraph,
  DocxParaStyle,
  DocxRun,
  DocxTable,
  DocxTableCell,
  DocxTableRow,
  ConversionOptions,
} from "../types.js";
const NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const NS_HH = "http://www.hancom.co.kr/hwpml/2011/head";
const NS_HC = "http://www.hancom.co.kr/hwpml/2011/core";
const NS_HA = "http://www.hancom.co.kr/hwpml/2011/app";
const NS_HV = "http://www.hancom.co.kr/hwpml/2011/version";
const NS_HS = "http://www.hancom.co.kr/hwpml/2011/section";
const NS_OPF = "http://www.idpf.org/2007/opf/";
const NS_DC = "http://purl.org/dc/elements/1.1/";
const NS_OASIS_CONTAINER = "urn:oasis:names:tc:opendocument:xmlns:container";
const NS_OASIS_MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
const NS_CONFIG = "urn:oasis:names:tc:opendocument:xmlns:config:1.0";
// pt to HwpUnit (1 pt = 100 HwpUnit)
function ptToHwpUnit(pt: number): number {
    return Math.round(pt * 100);
}
function escapeXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
export class HwpxBuilder {
  private fonts: string[] = ["함초롬바탕"];
  private charProps: DocxCharStyle[] = [];
  private paraProps: DocxParaStyle[] = [];
  private charPrMap = new Map<string, number>();
  private paraPrMap = new Map<string, number>();
  private fontMap = new Map<string, number>();
  private nextParaId = 1;
    constructor() {
        this.fontMap.set("함초롬바탕", 0);
    }
    private getFontId(fontFamily?: string): number {
        const name = fontFamily || "함초롬바탕";
        if (this.fontMap.has(name)) {
            return this.fontMap.get(name)!;
        }
        const id = this.fonts.length;
        this.fonts.push(name);
        this.fontMap.set(name, id);
        return id;
    }
    private getCharPrId(style: DocxCharStyle): number {
        const key = JSON.stringify({
            b: style.bold || false,
            i: style.italic || false,
            u: style.underline || false,
            s: style.strike || false,
            sz: style.fontSizePt || 10,
            f: style.fontFamily || "함초롬바탕",
            c: style.color || "#000000",
        });
        if (this.charPrMap.has(key)) {
            return this.charPrMap.get(key)!;
        }
        const id = this.charProps.length;
        this.charProps.push(style);
        this.charPrMap.set(key, id);
        return id;
    }
    private getParaPrId(style: DocxParaStyle): number {
        const key = JSON.stringify({
            a: style.align || "justify",
            ls: style.lineSpacingPercent || 160,
            ml: style.marginLeftPt || 0,
            mr: style.marginRightPt || 0,
            mt: style.marginTopPt || 0,
            mb: style.marginBottomPt || 0,
            fl: style.firstLineIndentPt || 0,
        });
        if (this.paraPrMap.has(key)) {
            return this.paraPrMap.get(key)!;
        }
        const id = this.paraProps.length;
        this.paraProps.push(style);
        this.paraPrMap.set(key, id);
        return id;
    }
    async build(doc: DocxDocumentModel, options?: ConversionOptions): Promise<Uint8Array> {
        const zip = new JSZip();
        this.nextParaId = 1;
        // 0. 기본 charPr 및 paraPr 초기화 (ID 0)
        this.getCharPrId({
            fontSizePt: options?.defaultFontSizePt || 10,
            fontFamily: options?.defaultFont || "함초롬바탕",
            color: "#000000",
        });
        this.getParaPrId({
            align: "justify",
            lineSpacingPercent: 160,
        });
        // 1. mimetype (STORED) - 한컴오피스 표준 매직 MIME 타입 (반드시 첫 엔트리여야 함)
        zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
        // 2. version.xml (한컴 2016이 가장 먼저 파싱하는 표준 포맷)
        const versionXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
            `<hv:HCFVersion xmlns:hv="${NS_HV}" tagetApplication="WORDPROCESSOR" major="5" minor="1" micro="0" buildNumber="1" os="1" xmlVersion="1.2" application="Hancom Office Hangul" appVersion="10, 0, 0, 5060 WIN32LEWindows_8"/>`;
        zip.file("version.xml", versionXml);
        // 3. settings.xml
        const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
            `<ha:HWPApplicationSetting xmlns:ha="${NS_HA}" xmlns:config="${NS_CONFIG}">` +
            `<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>` +
            `</ha:HWPApplicationSetting>`;
        zip.file("settings.xml", settingsXml);
        // 4. section0.xml 생성 (동시에 charPr, paraPr, font 인덱스들이 수집됨)
        const sectionXml = this.buildSectionXml(doc.body);
        zip.file("Contents/section0.xml", sectionXml);
        // 5. header.xml 생성 (수집된 인덱스 기반으로 등록)
        const headerXml = this.buildHeaderXml();
        zip.file("Contents/header.xml", headerXml);
        // 6. Preview/PrvText.txt (한컴 및 뷰어용 평문 미리보기)
        const prvText = this.buildPrvText(doc.body);
        zip.file("Preview/PrvText.txt", prvText);
        // 7. Contents/content.hpf
        const title = options?.title || doc.title || "Converted Document";
        const creator = options?.creator || doc.creator || "docx2hwpx";
        const contentHpf = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<opf:package xmlns:opf="${NS_OPF}" xmlns:dc="${NS_DC}" version="1.0">` +
            `<opf:metadata>` +
            `<dc:title>${escapeXml(title)}</dc:title>` +
            `<dc:creator>${escapeXml(creator)}</dc:creator>` +
            `<dc:format>application/hwpml-package+xml</dc:format>` +
            `</opf:metadata>` +
            `<opf:manifest>` +
            `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>` +
            `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>` +
            `<opf:item id="settings" href="settings.xml" media-type="application/xml"/>` +
            `<opf:item id="prvText" href="Preview/PrvText.txt" media-type="text/plain"/>` +
            `</opf:manifest>` +
            `<opf:spine>` +
            `<opf:itemref idref="header" linear="yes"/>` +
            `<opf:itemref idref="section0" linear="yes"/>` +
            `</opf:spine>` +
            `</opf:package>`;
        zip.file("Contents/content.hpf", contentHpf);
        // 8. META-INF/container.xml
        const containerXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<container xmlns="${NS_OASIS_CONTAINER}">` +
            `<rootfiles>` +
            `<rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>` +
            `</rootfiles>` +
            `</container>`;
        zip.file("META-INF/container.xml", containerXml);
        // 9. META-INF/manifest.xml
        const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<manifest:manifest xmlns:manifest="${NS_OASIS_MANIFEST}">` +
            `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwpml-package+xml"/>` +
            `<manifest:file-entry manifest:full-path="version.xml" manifest:media-type="application/xml"/>` +
            `<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="application/xml"/>` +
            `<manifest:file-entry manifest:full-path="Contents/content.hpf" manifest:media-type="application/hwpml-package+xml"/>` +
            `<manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="application/xml"/>` +
            `<manifest:file-entry manifest:full-path="Contents/section0.xml" manifest:media-type="application/xml"/>` +
            `</manifest:manifest>`;
        zip.file("META-INF/manifest.xml", manifestXml);
        return await zip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: { level: 6 },
        });
    }
    private buildPrvText(elements: DocxBlockElement[]): string {
        const lines = [];
        for (const el of elements) {
            if (el.type === "paragraph") {
                const text = el.children
                    .filter((c): c is DocxRun => c.type === "run")
                    .map((c) => c.text)
                    .join("");
                lines.push(text);
            }
            else if (el.type === "table") {
                for (const row of el.rows) {
                    const rowTexts = row.cells.map((cell) => {
                        const cellText = cell.paragraphs
                            .map((p) => p.children
                            .filter((c): c is DocxRun => c.type === "run")
                            .map((c) => c.text)
                            .join(""))
                            .join(" ");
                        return cellText.trim();
                    });
                    lines.push(rowTexts.join(" "));
                }
            }
        }
        return lines.join("\r\n").slice(0, 2000);
    }
    private buildSectionXml(elements: DocxBlockElement[]): string {
        let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
            `<hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">`;
        let isFirst = true;
        for (const el of elements) {
            if (el.type === "paragraph") {
                xml += this.renderParagraph(el, isFirst);
                isFirst = false;
            }
            else if (el.type === "table") {
                xml += this.renderTable(el, isFirst);
                isFirst = false;
            }
        }
        // 문서가 비어있는 경우 최소 1개 문단 및 secPr 보장
        if (elements.length === 0) {
            xml += this.renderParagraph({ type: "paragraph", children: [], style: {} }, true);
        }
        xml += `</hs:sec>`;
        return xml;
    }
    private getSecPrXml(): string {
        return (`<hp:run charPrIDRef="0">` +
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
            `</hp:run>`);
    }
    private renderParagraph(p: DocxParagraph, includeSecPr = false): string {
        const paraPrId = this.getParaPrId(p.style);
        let runsXml = includeSecPr ? this.getSecPrXml() : "";
        for (const child of p.children) {
            if (child.type === "run") {
                const charPrId = this.getCharPrId(child.style);
                runsXml +=
                    `<hp:run charPrIDRef="${charPrId}">` +
                        `<hp:t>${escapeXml(child.text)}</hp:t>` +
                        `</hp:run>`;
            }
            else if (child.type === "break") {
                runsXml += `<hp:run charPrIDRef="0"><hp:lineBreak/></hp:run>`;
            }
        }
        // 빈 문단인 경우(텍스트 run이 전혀 없는 경우) 기본 text run 하나 보장
        if (p.children.length === 0) {
            runsXml += `<hp:run charPrIDRef="0"><hp:t></hp:t></hp:run>`;
        }
        const paraId = this.nextParaId++;
        return (`<hp:p id="${paraId}" paraPrIDRef="${paraPrId}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
            runsXml +
            `</hp:p>`);
    }
    private renderTable(table: DocxTable, includeSecPr = false): string {
        const rowCnt = table.rows.length;
        let colCnt = 0;
        for (const row of table.rows) {
            colCnt = Math.max(colCnt, row.cells.reduce((acc, c) => acc + (c.colSpan || 1), 0));
        }
        if (colCnt === 0) colCnt = 1;
        const colWidth = Math.floor(42520 / colCnt);

        let trXml = "";
        for (let r = 0; r < table.rows.length; r++) {
            const row = table.rows[r];
            let tcXml = "";
            let colAddr = 0;

            for (let c = 0; c < row.cells.length; c++) {
                const cell = row.cells[c];
                let span = cell.colSpan || 1;
                const rowSpan = cell.rowSpan || 1;

                // 행의 마지막 셀이고 아직 colCnt에 도달하지 못했다면 (열 병합 또는 누락), 남은 열을 모두 차지하도록 보정
                if (c === row.cells.length - 1 && colAddr + span < colCnt) {
                    span = colCnt - colAddr;
                }

                const cellWidth = (colAddr + span >= colCnt) ? (42520 - colAddr * colWidth) : (span * colWidth);
                const cellHeight = 2400;

                let cellParaXml = "";
                if (cell.paragraphs.length > 0) {
                    for (const p of cell.paragraphs) {
                        cellParaXml += this.renderParagraph(p, false);
                    }
                } else {
                    const emptyId = this.nextParaId++;
                    cellParaXml = `<hp:p id="${emptyId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t></hp:t></hp:run></hp:p>`;
                }

                tcXml += `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="0" dirty="0" borderFillIDRef="2">` +
                    `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">` +
                    cellParaXml +
                    `</hp:subList>` +
                    `<hp:cellAddr colAddr="${colAddr}" rowAddr="${r}"/>` +
                    `<hp:cellSpan colSpan="${span}" rowSpan="${rowSpan}"/>` +
                    `<hp:cellSz width="${cellWidth}" height="${cellHeight}"/>` +
                    `<hp:cellMargin left="170" right="170" top="0" bottom="0"/>` +
                    `</hp:tc>`;

                colAddr += span;
            }
            trXml += `<hp:tr>${tcXml}</hp:tr>`;
        }

        const secPrXml = includeSecPr ? this.getSecPrXml() : "";
        const tblParaId = this.nextParaId++;
        const tblId = 1000000000 + tblParaId;
        const totalHeight = rowCnt * 2400;

        return (`<hp:p id="${tblParaId}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">` +
            secPrXml +
            `<hp:run charPrIDRef="0">` +
            `<hp:tbl id="${tblId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="0" rowCnt="${rowCnt}" colCnt="${colCnt}" cellSpacing="0" borderFillIDRef="2" noAdjust="0">` +
            `<hp:sz width="42520" widthRelTo="ABSOLUTE" height="${totalHeight}" heightRelTo="ABSOLUTE" protect="0"/>` +
            `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
            `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
            `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
            trXml +
            `</hp:tbl>` +
            `</hp:run>` +
            `</hp:p>`);
    }
    private buildHeaderXml(): string {
        // 1. Fontfaces (한컴 OWPML 필수 7개 언어군 그룹)
        const LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"];
        let fontFacesXml = `<hh:fontfaces itemCnt="7">`;
        for (const lang of LANGS) {
            let fontList = "";
            for (let i = 0; i < this.fonts.length; i++) {
                const fontName = escapeXml(this.fonts[i]);
                fontList += `<hh:font id="${i}" type="TTF" name="${fontName}"></hh:font>`;
            }
            fontFacesXml += `<hh:fontface lang="${lang}" fontCnt="${this.fonts.length}">${fontList}</hh:fontface>`;
        }
        fontFacesXml += `</hh:fontfaces>`;
        // 2. BorderFills
        const borderFillsXml = `<hh:borderFills itemCnt="2">` +
            `<hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
            `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>` +
            `<hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>` +
            `<hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>` +
            `<hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>` +
            `<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>` +
            `</hh:borderFill>` +
            `<hh:borderFill id="2" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
            `<hh:slash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
            `<hh:leftBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
            `<hh:rightBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
            `<hh:topBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
            `<hh:bottomBorder type="SOLID" width="0.1 mm" color="#000000"/>` +
            `<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>` +
            `<hh:fillBrush><hh:winBrush faceColor="#FFFFFF" hatchColor="#000000" hatchStyle="NONE" alpha="0"/></hh:fillBrush>` +
            `</hh:borderFill>` +
            `</hh:borderFills>`;
        // 3. CharProperties
        let charPropertiesXml = `<hh:charProperties itemCnt="${this.charProps.length}">`;
        for (let i = 0; i < this.charProps.length; i++) {
            const cp = this.charProps[i];
            const fontId = this.getFontId(cp.fontFamily);
            const height = ptToHwpUnit(cp.fontSizePt || 10);
            const textColor = cp.color || "#000000";
            const boldXml = cp.bold ? `<hh:bold/>` : "";
            const italicXml = cp.italic ? `<hh:italic/>` : "";
            const underlineXml = cp.underline ? `<hh:underline type="BOTTOM" shape="SOLID" color="${textColor}"/>` : "";
            const strikeXml = cp.strike ? `<hh:strikeout shape="SOLID" color="${textColor}"/>` : "";
            charPropertiesXml +=
                `<hh:charPr id="${i}" height="${height}" textColor="${textColor}" shadeColor="none" ` +
                    `useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="0">` +
                    `<hh:fontRef hangul="${fontId}" latin="${fontId}" hanja="${fontId}" japanese="${fontId}" other="${fontId}" symbol="${fontId}" user="${fontId}"/>` +
                    `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
                    `<hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
                    `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
                    `<hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
                    italicXml +
                    boldXml +
                    underlineXml +
                    strikeXml +
                    `</hh:charPr>`;
        }
        charPropertiesXml += `</hh:charProperties>`;
        // 4. TabProperties
        const tabDefsXml = `<hh:tabPrs itemCnt="1">` +
            `<hh:tabPr id="0" autoTabLeft="1" autoTabRight="1">` +
            `<hh:items itemCnt="0"/>` +
            `</hh:tabPr>` +
            `</hh:tabPrs>`;
        // 5. Numberings
        const numberingsXml = `<hh:numberings itemCnt="1">` +
            `<hh:numbering id="0" start="1">` +
            Array.from({ length: 7 })
                .map((_, level) => `<hh:paraHead level="${level + 1}" start="1" numFormat="^${level + 1}." textOffsetType="PERCENT" textOffset="50" numberingChar="false" charPrIDRef="0">` +
                `<hh:autoNumberFormat type="DIGIT" userChar="" prefixChar="" suffixChar="."/>` +
                `</hh:paraHead>`)
                .join("") +
            `</hh:numbering>` +
            `</hh:numberings>`;
        // 6. Bullets
        const bulletsXml = `<hh:bullets itemCnt="1">` +
            `<hh:bullet id="0" char="●" imageBullet="0" checkedChar="0">` +
            `<hh:img bright="0" contrast="0" effect="REAL_PIC" binaryItemIDRef="0"/>` +
            `</hh:bullet>` +
            `</hh:bullets>`;
        // 7. ParaProperties
        let paraPropertiesXml = `<hh:paraProperties itemCnt="${this.paraProps.length}">`;
        for (let i = 0; i < this.paraProps.length; i++) {
            const pp = this.paraProps[i];
            let align = "JUSTIFY";
            if (pp.align === "left")
                align = "LEFT";
            else if (pp.align === "center")
                align = "CENTER";
            else if (pp.align === "right")
                align = "RIGHT";
            const leftMargin = ptToHwpUnit(pp.marginLeftPt || 0);
            const rightMargin = ptToHwpUnit(pp.marginRightPt || 0);
            const prevMargin = ptToHwpUnit(pp.marginTopPt || 0);
            const nextMargin = ptToHwpUnit(pp.marginBottomPt || 0);
            const indent = ptToHwpUnit(pp.firstLineIndentPt || 0);
            const lineSpacing = pp.lineSpacingPercent || 160;
            paraPropertiesXml +=
                `<hh:paraPr id="${i}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
                    `<hh:align horizontal="${align}" vertical="BASELINE"/>` +
                    `<hh:heading type="NONE" idRef="0" level="0"/>` +
                    `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
                    `<hh:margin>` +
                    `<hh:intent value="${indent}"/>` +
                    `<hh:left value="${leftMargin}"/>` +
                    `<hh:right value="${rightMargin}"/>` +
                    `<hh:prev value="${prevMargin}"/>` +
                    `<hh:next value="${nextMargin}"/>` +
                    `</hh:margin>` +
                    `<hh:lineSpacing type="PERCENT" value="${lineSpacing}"/>` +
                    `</hh:paraPr>`;
        }
        paraPropertiesXml += `</hh:paraProperties>`;
        // 8. Styles
        const stylesXml = `<hh:styles itemCnt="1">` +
            `<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/>` +
            `</hh:styles>`;
        return (`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n` +
            `<hh:head xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="1.2" secCnt="1">` +
            `<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>` +
            `<hh:refList>` +
            fontFacesXml +
            borderFillsXml +
            charPropertiesXml +
            tabDefsXml +
            numberingsXml +
            bulletsXml +
            paraPropertiesXml +
            stylesXml +
            `</hh:refList>` +
            `</hh:head>`);
    }
}
