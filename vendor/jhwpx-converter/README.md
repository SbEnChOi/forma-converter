# jhwpx-converter (HWP ↔ HWPX ↔ DOCX ↔ ODT 통합 오피스 문서 변환기)

한글(HWP 5.0, HWPX), MS Word(DOCX), 오픈오피스/리브레오피스(ODT) 4대 주요 오피스 문서 포맷 간의 상호 변환을 완벽히 지원하는 Node.js / TypeScript 라이브러리 및 CLI 도구입니다.

## 지원 포맷 및 변환 매트릭스

| 원본 포맷 | 대상 포맷 | 주요 용도 |
| :--- | :--- | :--- |
| **DOCX** | **HWPX**, **ODT** | 워드 문서를 한글/오픈오피스용 문서로 변환 |
| **HWPX** | **DOCX**, **ODT** | 한글 표준 문서를 워드/오픈오피스 문서로 변환 |
| **HWP** | **HWPX**, **DOCX**, **ODT** | 구형 HWP 문서를 최신 개방형 포맷으로 일괄 변환 |
| **ODT** | **HWPX**, **DOCX** | 오픈오피스/리브레오피스 문서를 한글/워드로 변환 |

---

## 주요 기능

- **서식 보존**:
  - 글자 크기, 색상, 글꼴, 굵게(Bold), 기울임(Italic), 밑줄(Underline), 취소선(Strike)
  - 문단 정렬(좌/가운데/우/양쪽), 들여쓰기, 여백, 줄간격
- **표(Table) 구조 보존**:
  - 행/열, 너비, 셀 병합(`colSpan`), 테두리 매핑
- **CLI 자동 확장자 감지**:
  - 입력 및 출력 파일의 확장자에 따라 최적의 변환 파이프라인 자동 실행

---

## 설치 및 빌드

```bash
cd jhwpx-converter
npm install
npm run build
```

---

## 사용법

### 1. CLI 명령어로 사용 (자동 확장자 감지)

```bash
# 1) HWP -> HWPX 변환
node dist/jhwpx-converter-cli.js document.hwp

# 2) HWPX -> DOCX 변환
node dist/jhwpx-converter-cli.js document.hwpx

# 3) DOCX -> ODT (오픈오피스) 변환
node dist/jhwpx-converter-cli.js report.docx report.odt

# 4) ODT -> HWPX 변환
node dist/jhwpx-converter-cli.js open_doc.odt

# 5) HWP -> ODT 직접 변환
node dist/jhwpx-converter-cli.js old_doc.hwp output.odt
```

### 2. TypeScript / JavaScript API

```typescript
import { 
  convertFileAuto,
  convertDocxToHwpx, 
  convertHwpxToDocx, 
  convertToOdt,
  convertOdtTo,
  convertHwpToHwpx,
  convertHwpToDocx
} from "jhwpx-converter";

// 1. 파일 자동 변환 (확장자 기반 자동 감지)
await convertFileAuto("document.hwp");  // document.hwpx 생성
await convertFileAuto("document.docx"); // document.hwpx 생성
await convertFileAuto("document.hwpx"); // document.docx 생성
await convertFileAuto("document.odt");  // document.hwpx 생성

// 2. ODT 변환
await convertToOdt("report.docx", "report.odt");
await convertToOdt("notice.hwpx", "notice.odt");
await convertOdtTo("report.odt", "docx", "output.docx");
await convertOdtTo("report.odt", "hwpx", "output.hwpx");

// 3. Buffer / Uint8Array 직접 변환
import * as fs from "node:fs/promises";

const docxBuf = await fs.readFile("report.docx");
const odtBytes = await convertToOdt(docxBuf);
await fs.writeFile("report.odt", odtBytes);
```

---

## 테스트

```bash
npm test
```
