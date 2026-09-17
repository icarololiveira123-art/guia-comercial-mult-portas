import { strToU8, zipSync } from "fflate";

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function escapeXml(value) {
  return String(value ?? "")
    .replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(position) {
  let current = position;
  let result = "";
  while (current > 0) {
    current -= 1;
    result = String.fromCharCode(65 + (current % 26)) + result;
    current = Math.floor(current / 26);
  }
  return result || "A";
}

function normalizeSheetName(value, index) {
  const normalized = String(value || `Planilha ${index + 1}`)
    .replace(/[\\/?*:[\]]/g, " ")
    .replaceAll("'", "")
    .trim()
    .slice(0, 31);
  return normalized || `Planilha ${index + 1}`;
}

function cellXml(value, reference, style) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(sheet) {
  const rows = Array.isArray(sheet.rows) && sheet.rows.length ? sheet.rows : [[""]];
  const columnCount = Math.max(1, ...rows.map((row) => Array.isArray(row) ? row.length : 0));
  const lastCell = `${columnName(columnCount)}${rows.length}`;
  const currencyColumns = new Set(sheet.currencyColumns ?? []);
  const wrappedColumns = new Set(sheet.wrappedColumns ?? []);
  const body = rows.map((row, rowIndex) => {
    const values = Array.isArray(row) ? row : [];
    const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
      const value = values[columnIndex] ?? "";
      const style = rowIndex === 0
        ? 1
        : typeof value === "number" && currencyColumns.has(columnIndex)
          ? 3
          : wrappedColumns.has(columnIndex) ? 4 : 2;
      return cellXml(value, `${columnName(columnIndex + 1)}${rowIndex + 1}`, style);
    }).join("");
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="24" customHeight="1"' : ""}>${cells}</row>`;
  }).join("");
  const widths = Array.from({ length: columnCount }, (_, index) => {
    const width = Math.min(120, Math.max(6, Number(sheet.columnWidths?.[index]) || 16));
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");
  const filter = sheet.autoFilter && rows.length > 0 ? `<autoFilter ref="A1:${lastCell}"/>` : "";
  const freeze = sheet.freezeHeader === false
    ? ""
    : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';

  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${lastCell}"/>${freeze}<sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols>` +
    `<sheetData>${body}</sheetData>${filter}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>` +
    '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>';
}

function stylesXml() {
  return `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="10"/><name val="Arial"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF293238"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8DFE2"/></left><right style="thin"><color rgb="FFD8DFE2"/></right><top style="thin"><color rgb="FFD8DFE2"/></top><bottom style="thin"><color rgb="FFD8DFE2"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
}

function workbookXml(sheets) {
  const entries = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  return `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${entries}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
}

function workbookRelationsXml(sheetCount) {
  const sheetRelations = Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRelations}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypesXml(sheetCount) {
  const worksheets = Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${worksheets}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

/**
 * Produces a standards-based XLSX archive without evaluating formulas from text cells.
 * @param {{ title?: string, subject?: string, author?: string, createdAt?: Date|string, sheets: Array<{ name: string, rows: Array<Array<string|number|null|undefined>>, columnWidths?: number[], currencyColumns?: number[], wrappedColumns?: number[], autoFilter?: boolean, freezeHeader?: boolean }> }} definition
 */
export function createWorkbookArchive(definition) {
  if (!definition || !Array.isArray(definition.sheets) || definition.sheets.length === 0) {
    throw new TypeError("Informe ao menos uma planilha para gerar o arquivo Excel.");
  }
  const usedNames = new Set();
  const sheets = definition.sheets.map((sheet, index) => {
    let name = normalizeSheetName(sheet?.name, index);
    let suffix = 2;
    while (usedNames.has(name.toLocaleLowerCase("pt-BR"))) {
      const ending = ` ${suffix}`;
      name = `${normalizeSheetName(sheet?.name, index).slice(0, 31 - ending.length)}${ending}`;
      suffix += 1;
    }
    usedNames.add(name.toLocaleLowerCase("pt-BR"));
    return { ...sheet, name };
  });
  const createdAt = new Date(definition.createdAt ?? Date.now());
  const isoDate = Number.isNaN(createdAt.getTime()) ? new Date().toISOString() : createdAt.toISOString();
  const core = `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(definition.title || "Planilha Mult Portas")}</dc:title><dc:subject>${escapeXml(definition.subject || "Exportação operacional")}</dc:subject><dc:creator>${escapeXml(definition.author || "Mult Portas")}</dc:creator><cp:lastModifiedBy>${escapeXml(definition.author || "Mult Portas")}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified></cp:coreProperties>`;
  const rootRelations = `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const appProperties = `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Guia Comercial Mult Portas</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Mult Portas</Company><AppVersion>1.0</AppVersion></Properties>`;
  const files = {
    "[Content_Types].xml": strToU8(contentTypesXml(sheets.length)),
    "_rels/.rels": strToU8(rootRelations),
    "docProps/core.xml": strToU8(core),
    "docProps/app.xml": strToU8(appProperties),
    "xl/workbook.xml": strToU8(workbookXml(sheets)),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationsXml(sheets.length)),
    "xl/styles.xml": strToU8(stylesXml()),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}

/** @param {{ filename: string, title?: string, subject?: string, author?: string, sheets: Parameters<typeof createWorkbookArchive>[0]["sheets"] }} definition */
export function downloadWorkbook(definition) {
  const archive = createWorkbookArchive(definition);
  const buffer = new ArrayBuffer(archive.byteLength);
  new Uint8Array(buffer).set(archive);
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  const filename = definition.filename.toLocaleLowerCase().endsWith(".xlsx") ? definition.filename : `${definition.filename}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { filename, byteLength: archive.byteLength, mimeType: XLSX_MIME_TYPE };
}
