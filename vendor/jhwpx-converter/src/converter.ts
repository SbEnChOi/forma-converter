import { DocxParser } from "./docx/parser.js";
import { DocxBuilder } from "./docx/builder.js";
import { HwpxParser } from "./hwpx/parser.js";
import { HwpxBuilder } from "./hwpx/builder.js";
import { OdtParser } from "./odt/parser.js";
import { OdtBuilder } from "./odt/builder.js";
import { parseHwp, hwpDocumentToHwpx } from "./hwp/index.js";
import { ConversionOptions, DocxDocumentModel } from "./types.js";
import JSZip from "jszip";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export class Docx2HwpxConverter {
  private parser = new DocxParser();
  private builder = new HwpxBuilder();

  async convertBuffer(docxBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const docModel: DocxDocumentModel = await this.parser.parse(docxBuffer);
    return await this.builder.build(docModel, options);
  }

  async convertFile(inputDocxPath: string, outputHwpxPath: string, options?: ConversionOptions): Promise<void> {
    const buffer = await fs.readFile(inputDocxPath);
    const hwpxBytes = await this.convertBuffer(buffer, options);
    await fs.writeFile(outputHwpxPath, hwpxBytes);
  }
}

export class Hwpx2DocxConverter {
  private parser = new HwpxParser();
  private builder = new DocxBuilder();

  async convertBuffer(hwpxBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const docModel: DocxDocumentModel = await this.parser.parse(hwpxBuffer);
    return await this.builder.build(docModel, options);
  }

  async convertFile(inputHwpxPath: string, outputDocxPath: string, options?: ConversionOptions): Promise<void> {
    const buffer = await fs.readFile(inputHwpxPath);
    const docxBytes = await this.convertBuffer(buffer, options);
    await fs.writeFile(outputDocxPath, docxBytes);
  }
}

export class Hwp2HwpxConverter {
  async convertBuffer(
    hwpBuffer: Buffer | ArrayBuffer | Uint8Array,
    options?: { title?: string; creator?: string }
  ): Promise<Uint8Array> {
    const data = hwpBuffer instanceof Uint8Array ? hwpBuffer : new Uint8Array(hwpBuffer);
    const hwpDoc = parseHwp(data);
    return await hwpDocumentToHwpx(hwpDoc, options);
  }

  async convertFile(
    inputHwpPath: string,
    outputHwpxPath: string,
    options?: { title?: string; creator?: string }
  ): Promise<void> {
    const buffer = await fs.readFile(inputHwpPath);
    const hwpxBytes = await this.convertBuffer(buffer, options);
    await fs.writeFile(outputHwpxPath, hwpxBytes);
  }
}

export class Any2OdtConverter {
  private odtBuilder = new OdtBuilder();
  private docxParser = new DocxParser();
  private hwpxParser = new HwpxParser();

  async convertDocxBuffer(docxBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const model = await this.docxParser.parse(docxBuffer);
    return await this.odtBuilder.build(model, options);
  }

  async convertHwpxBuffer(hwpxBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const model = await this.hwpxParser.parse(hwpxBuffer);
    return await this.odtBuilder.build(model, options);
  }
}

export class Odt2AnyConverter {
  private odtParser = new OdtParser();
  private docxBuilder = new DocxBuilder();
  private hwpxBuilder = new HwpxBuilder();

  async convertToDocxBuffer(odtBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const model = await this.odtParser.parse(odtBuffer);
    return await this.docxBuilder.build(model, options);
  }

  async convertToHwpxBuffer(odtBuffer: Buffer | ArrayBuffer | Uint8Array, options?: ConversionOptions): Promise<Uint8Array> {
    const model = await this.odtParser.parse(odtBuffer);
    return await this.hwpxBuilder.build(model, options);
  }
}

// ----------------- Public API Functions -----------------

export async function convertDocxToHwpx(
  docxInput: string | Buffer | ArrayBuffer | Uint8Array,
  outputPathOrOptions?: string | ConversionOptions,
  options?: ConversionOptions
): Promise<Uint8Array | void> {
  const converter = new Docx2HwpxConverter();
  if (typeof docxInput === "string") {
    if (typeof outputPathOrOptions !== "string") throw new Error("Output path string is required.");
    await converter.convertFile(docxInput, outputPathOrOptions, options);
    return;
  }
  const opts = (typeof outputPathOrOptions === "object" ? outputPathOrOptions : options) as ConversionOptions | undefined;
  return await converter.convertBuffer(docxInput, opts);
}

export async function convertHwpxToDocx(
  hwpxInput: string | Buffer | ArrayBuffer | Uint8Array,
  outputPathOrOptions?: string | ConversionOptions,
  options?: ConversionOptions
): Promise<Uint8Array | void> {
  const converter = new Hwpx2DocxConverter();
  if (typeof hwpxInput === "string") {
    if (typeof outputPathOrOptions !== "string") throw new Error("Output path string is required.");
    await converter.convertFile(hwpxInput, outputPathOrOptions, options);
    return;
  }
  const opts = (typeof outputPathOrOptions === "object" ? outputPathOrOptions : options) as ConversionOptions | undefined;
  return await converter.convertBuffer(hwpxInput, opts);
}

export async function convertHwpToHwpx(
  hwpInput: string | Buffer | ArrayBuffer | Uint8Array,
  outputPathOrOptions?: string | { title?: string; creator?: string },
  options?: { title?: string; creator?: string }
): Promise<Uint8Array | void> {
  const converter = new Hwp2HwpxConverter();
  if (typeof hwpInput === "string") {
    if (typeof outputPathOrOptions !== "string") throw new Error("Output path string is required.");
    await converter.convertFile(hwpInput, outputPathOrOptions, options);
    return;
  }
  const opts = (typeof outputPathOrOptions === "object" ? outputPathOrOptions : options) as { title?: string; creator?: string } | undefined;
  return await converter.convertBuffer(hwpInput, opts);
}

export async function convertHwpToDocx(
  hwpInput: string | Buffer | ArrayBuffer | Uint8Array,
  outputPathOrOptions?: string | ConversionOptions,
  options?: ConversionOptions
): Promise<Uint8Array | void> {
  const opts = (typeof outputPathOrOptions === "object" ? outputPathOrOptions : options) as ConversionOptions | undefined;
  let hwpBuffer: Uint8Array;
  if (typeof hwpInput === "string") {
    const raw = await fs.readFile(hwpInput);
    hwpBuffer = new Uint8Array(raw);
  } else if (hwpInput instanceof Uint8Array) {
    hwpBuffer = hwpInput;
  } else {
    hwpBuffer = new Uint8Array(hwpInput);
  }

  const hwpxBytes = (await convertHwpToHwpx(hwpBuffer, opts)) as Uint8Array;
  const docxBytes = (await convertHwpxToDocx(hwpxBytes, opts)) as Uint8Array;

  if (typeof hwpInput === "string" && typeof outputPathOrOptions === "string") {
    await fs.writeFile(outputPathOrOptions, docxBytes);
    return;
  }
  return docxBytes;
}

export async function convertToOdt(
  input: string | Buffer | ArrayBuffer | Uint8Array,
  outputPathOrOptions?: string | ConversionOptions,
  options?: ConversionOptions
): Promise<Uint8Array | void> {
  const opts = (typeof outputPathOrOptions === "object" ? outputPathOrOptions : options) as ConversionOptions | undefined;
  const odtBuilder = new OdtBuilder();

  let inputBytes: Uint8Array;
  let inputExt = "";

  if (typeof input === "string") {
    inputExt = path.extname(input).toLowerCase();
    const raw = await fs.readFile(input);
    inputBytes = new Uint8Array(raw);
  } else if (input instanceof Uint8Array) {
    inputBytes = input;
  } else {
    inputBytes = new Uint8Array(input);
  }

  let model: DocxDocumentModel;
  if (inputExt === ".docx") {
    model = await new DocxParser().parse(inputBytes);
  } else if (inputExt === ".hwp") {
    const hwpx = (await convertHwpToHwpx(inputBytes, opts)) as Uint8Array;
    model = await new HwpxParser().parse(hwpx);
  } else {
    // 버퍼 기반 판별
    const zip = await JSZip.loadAsync(inputBytes);
    if (zip.file("word/document.xml")) {
      model = await new DocxParser().parse(inputBytes);
    } else {
      model = await new HwpxParser().parse(inputBytes);
    }
  }

  const odtBytes = await odtBuilder.build(model, opts);
  if (typeof input === "string" && typeof outputPathOrOptions === "string") {
    await fs.writeFile(outputPathOrOptions, odtBytes);
    return;
  }
  return odtBytes;
}

export async function convertOdtTo(
  odtInput: string | Buffer | ArrayBuffer | Uint8Array,
  targetFormat: "hwpx" | "docx",
  outputPath?: string,
  options?: ConversionOptions
): Promise<Uint8Array | void> {
  let odtBytes: Uint8Array;
  if (typeof odtInput === "string") {
    const raw = await fs.readFile(odtInput);
    odtBytes = new Uint8Array(raw);
  } else if (odtInput instanceof Uint8Array) {
    odtBytes = odtInput;
  } else {
    odtBytes = new Uint8Array(odtInput);
  }

  const parser = new OdtParser();
  const model = await parser.parse(odtBytes);

  let result: Uint8Array;
  if (targetFormat === "hwpx") {
    result = await new HwpxBuilder().build(model, options);
  } else {
    result = await new DocxBuilder().build(model, options);
  }

  if (outputPath) {
    await fs.writeFile(outputPath, result);
    return;
  }
  return result;
}

/**
 * 확장자(.hwp, .hwpx, .docx, .odt)를 보고 자동으로 적절한 포맷으로 변환합니다.
 */
export async function convertFileAuto(
  inputPath: string,
  outputPath?: string,
  options?: ConversionOptions
): Promise<string> {
  const inExt = path.extname(inputPath).toLowerCase();
  let resolvedOutput = outputPath;

  if (resolvedOutput) {
    const outExt = path.extname(resolvedOutput).toLowerCase();
    if (outExt === ".odt") {
      await convertToOdt(inputPath, resolvedOutput, options);
      return resolvedOutput;
    }
    if (inExt === ".odt") {
      if (outExt === ".hwpx") {
        await convertOdtTo(inputPath, "hwpx", resolvedOutput, options);
      } else {
        await convertOdtTo(inputPath, "docx", resolvedOutput, options);
      }
      return resolvedOutput;
    }
    if (inExt === ".hwp" && outExt === ".docx") {
      await convertHwpToDocx(inputPath, resolvedOutput, options);
      return resolvedOutput;
    }
    if (inExt === ".hwp" && outExt === ".hwpx") {
      await convertHwpToHwpx(inputPath, resolvedOutput, options);
      return resolvedOutput;
    }
    if (inExt === ".docx" && outExt === ".hwpx") {
      await convertDocxToHwpx(inputPath, resolvedOutput, options);
      return resolvedOutput;
    }
    if (inExt === ".hwpx" && outExt === ".docx") {
      await convertHwpxToDocx(inputPath, resolvedOutput, options);
      return resolvedOutput;
    }
  }

  // outputPath가 지정되지 않은 경우 기본 타깃 포맷 설정
  if (inExt === ".hwp") {
    resolvedOutput = inputPath.substring(0, inputPath.length - inExt.length) + ".hwpx";
    await convertHwpToHwpx(inputPath, resolvedOutput, options);
    return resolvedOutput;
  } else if (inExt === ".docx") {
    resolvedOutput = inputPath.substring(0, inputPath.length - inExt.length) + ".hwpx";
    await convertDocxToHwpx(inputPath, resolvedOutput, options);
    return resolvedOutput;
  } else if (inExt === ".hwpx") {
    resolvedOutput = inputPath.substring(0, inputPath.length - inExt.length) + ".docx";
    await convertHwpxToDocx(inputPath, resolvedOutput, options);
    return resolvedOutput;
  } else if (inExt === ".odt") {
    resolvedOutput = inputPath.substring(0, inputPath.length - inExt.length) + ".hwpx";
    await convertOdtTo(inputPath, "hwpx", resolvedOutput, options);
    return resolvedOutput;
  } else {
    throw new Error(`Unsupported file extension: ${inExt}. Expected .hwp, .hwpx, .docx, or .odt`);
  }
}
