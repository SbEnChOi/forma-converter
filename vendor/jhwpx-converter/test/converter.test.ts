import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { Docx2HwpxConverter, Hwpx2DocxConverter, convertHwpToHwpx } from "../src/converter.js";
import { HwpDocument } from "../src/hwp/types.js";
import { hwpDocumentToHwpx } from "../src/hwp/converter.js";

async function createSampleDocx(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b w:val="1"/>
          <w:sz w:val="32"/>
          <w:color w:val="003366"/>
        </w:rPr>
        <w:t>양방향 변환 테스트 문서</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:jc w:val="both"/>
      </w:pPr>
      <w:r>
        <w:t>이 문서는 DOCX와 HWPX 양방향 변환을 </w:t>
      </w:r>
      <w:r>
        <w:rPr>
          <w:b w:val="1"/>
          <w:i w:val="1"/>
          <w:u w:val="single"/>
        </w:rPr>
        <w:t>테스트하기 위한 본문</w:t>
      </w:r>
      <w:r>
        <w:t>입니다.</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>구분</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>내용</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:p><w:r><w:t>지원 여부</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:p><w:r><w:t>양방향 지원 완료</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;
  zip.file("word/document.xml", documentXml);

  return await zip.generateAsync({ type: "uint8array" });
}

function createSampleHwpDoc(): HwpDocument {
  return {
    header: {
      version: { major: 5, minor: 0, build: 6, revision: 0 },
      flags: {
        raw: 1,
        compressed: false,
        encrypted: false,
        distribution: false,
        script: false,
        drm: false,
        xmlTemplate: false,
        documentHistory: false,
        digitalSignature: false,
        publicKeyEncrypted: false,
        modifiedCertificate: false,
        prepareDistribution: false,
      },
    },
    docInfo: {
      fontFaces: [[{ name: "함초롬바탕" }], [{ name: "함초롬바탕" }], [], [], [], [], []],
      charShapes: [
        {
          fontId: [0, 0, 0, 0, 0, 0, 0],
          ratio: [100, 100, 100, 100, 100, 100, 100],
          spacing: [0, 0, 0, 0, 0, 0, 0],
          relSize: [100, 100, 100, 100, 100, 100, 100],
          offset: [0, 0, 0, 0, 0, 0, 0],
          height: 1200,
          bold: true,
          italic: false,
          underlineType: 0,
          strikeType: 0,
          color: 0x0000ff,
          shadeColor: 0,
          shadowColor: 0,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          borderFillId: 0,
        },
      ],
      paraShapes: [
        {
          align: 0,
          leftMargin: 0,
          rightMargin: 0,
          indent: 0,
          prevMargin: 0,
          nextMargin: 0,
          lineSpacingType: 0,
          lineSpacing: 160,
          tabDefId: 0,
          condense: 0,
        },
      ],
      styles: [{ name: "바탕글", engName: "Normal", type: 0, paraShapeId: 0, charShapeId: 0 }],
      binData: [],
      borderFills: [],
      numberings: [],
      bullets: [],
      tabDefs: [],
    },
    sections: [
      {
        paragraphs: [
          {
            paraShapeId: 0,
            styleId: 0,
            pageBreak: false,
            columnBreak: false,
            text: "HWP 5.0에서 HWPX로 변환된 문단입니다.",
            chars: [
              {
                charShapeId: 0,
                length: "HWP 5.0에서 HWPX로 변환된 문단입니다.".length,
              },
            ],
            lines: [],
            controls: [],
          },
        ],
      },
    ],
  };
}

describe("Document Format Converters", () => {
  it("should convert DOCX -> HWPX correctly", async () => {
    const docxBytes = await createSampleDocx();
    const docx2hwpx = new Docx2HwpxConverter();
    const hwpxBytes = await docx2hwpx.convertBuffer(docxBytes, {
      title: "변환 테스트",
      creator: "테스터",
    });

    expect(hwpxBytes).toBeDefined();

    const hwpxZip = await JSZip.loadAsync(hwpxBytes);
    expect(await hwpxZip.file("mimetype")?.async("string")).toBe("application/hwp+zip");
    expect(hwpxZip.file("Contents/header.xml")).toBeDefined();
    const secXml = await hwpxZip.file("Contents/section0.xml")?.async("string");
    expect(secXml).toContain("양방향 변환 테스트 문서");
    expect(secXml).toContain("양방향 지원 완료");
  });

  it("should convert HWPX -> DOCX correctly (Round-trip)", async () => {
    const initialDocxBytes = await createSampleDocx();
    const docx2hwpx = new Docx2HwpxConverter();
    const hwpxBytes = await docx2hwpx.convertBuffer(initialDocxBytes, {
      title: "왕복 테스트",
      creator: "테스터",
    });

    const hwpx2docx = new Hwpx2DocxConverter();
    const convertedDocxBytes = await hwpx2docx.convertBuffer(hwpxBytes);

    expect(convertedDocxBytes).toBeDefined();
    expect(convertedDocxBytes.length).toBeGreaterThan(0);

    const docxZip = await JSZip.loadAsync(convertedDocxBytes);
    expect(docxZip.file("[Content_Types].xml")).toBeDefined();
    expect(docxZip.file("word/_rels/document.xml.rels")).toBeDefined();

    const documentXml = await docxZip.file("word/document.xml")?.async("string");
    expect(documentXml).toBeDefined();
    expect(documentXml).toContain("양방향 변환 테스트 문서");
    expect(documentXml).toContain("테스트하기 위한 본문");
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("양방향 지원 완료");
  });

  it("should convert HWP Document -> HWPX correctly", async () => {
    const hwpDoc = createSampleHwpDoc();
    const hwpxBytes = await hwpDocumentToHwpx(hwpDoc, {
      title: "HWP 변환 문서",
      creator: "HWP 변환기",
    });

    expect(hwpxBytes).toBeDefined();
    const hwpxZip = await JSZip.loadAsync(hwpxBytes);
    expect(await hwpxZip.file("mimetype")?.async("string")).toBe("application/hwp+zip");

    const secXml = await hwpxZip.file("Contents/section0.xml")?.async("string");
    expect(secXml).toContain("HWP 5.0에서 HWPX로 변환된 문단입니다.");
  });

  it("should convert DOCX -> ODT and ODT -> HWPX correctly", async () => {
    const docxBytes = await createSampleDocx();
    
    // DOCX -> ODT 변환
    const { convertToOdt, convertOdtTo } = await import("../src/converter.js");
    const odtBytes = (await convertToOdt(docxBytes, {
      title: "오픈오피스 테스트",
      creator: "테스터",
    })) as Uint8Array;

    expect(odtBytes).toBeDefined();
    const odtZip = await JSZip.loadAsync(odtBytes);
    expect(await odtZip.file("mimetype")?.async("string")).toBe("application/vnd.oasis.opendocument.text");
    expect(odtZip.file("content.xml")).toBeDefined();

    const contentXml = await odtZip.file("content.xml")?.async("string");
    expect(contentXml).toContain("양방향 변환 테스트 문서");
    expect(contentXml).toContain("양방향 지원 완료");

    // ODT -> HWPX 변환
    const hwpxFromOdt = (await convertOdtTo(odtBytes, "hwpx")) as Uint8Array;
    expect(hwpxFromOdt).toBeDefined();
    const hwpxZip = await JSZip.loadAsync(hwpxFromOdt);
    expect(await hwpxZip.file("mimetype")?.async("string")).toBe("application/hwp+zip");
    const secXml = await hwpxZip.file("Contents/section0.xml")?.async("string");
    expect(secXml).toContain("양방향 변환 테스트 문서");
  });
});

