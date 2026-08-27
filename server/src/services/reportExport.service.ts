import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ExtraFile, MatchMode, RowMatchResult, SearchSummary } from "../types/domain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "..", "assets", "obmi-logo.png");

const COLORS = {
  // Light banner, not dark: the OBMI logo asset is dark ink on a transparent background (built
  // for placing on light surfaces) - a dark banner made the logo functionally invisible.
  banner: "FFF2F2F4",
  subtitle: "FFDCEEFB",
  sectionHeader: "FF2196F3",
  labelRow: "FFEFF3F8",
  completion: "FF2ECC71",
  totalSource: "FF3498DB",
  totalLog: "FF3498DB",
  match: "FF2ECC71",
  missing: "FFE74C3C",
  duplicate: "FFF39C12",
  extra: "FF7B68EE",
  white: "FFFFFFFF",
  darkText: "FF1A1A2E",
};

// Same tints as STATUS_FILL.not_found_in_log / duplicate_in_log below (Comparison sheet) - kept
// as their own constants since the Summary sheet's missing/duplicate sections are built before
// STATUS_FILL is declared.
const MISSING_ROW_FILL = "FFFCE8E6";
const DUPLICATE_ROW_FILL = "FFFEF3E0";

export interface ReportExportRequest {
  sourceFileName?: string;
  filesLogSourceDescription?: string;
  onlyShared?: boolean;
  sharedKeyword?: string;
  selectedSheetNames?: string[];
  headerRow?: number;
  identifierColumn?: string;
  formatsColumn?: string;
  plannedDateColumn?: string;
  selectedPlannedDates?: string[];
  columnFilters?: Record<string, string>;
  matchMode: MatchMode;
  results: RowMatchResult[];
  summary: SearchSummary;
  extraFiles: ExtraFile[];
  filesScanned: number;
}

type DeliverableStatus =
  | "match"
  | "duplicate_in_log"
  | "duplicate_in_source"
  | "not_found_in_log"
  | "not_found_in_source"
  | "skipped";

interface DeliverableRow {
  identifier: string;
  format: string;
  status: DeliverableStatus;
  discipline: string;
  fileName: string;
  webViewUrl?: string;
  version: string;
  folderPath: string;
  lastModified: string;
  lastModifiedBy: string;
  logRevision: string;
  sourceRevision: string;
  revisionMatch: "match" | "mismatch" | "";
  matchedVia: "exact" | "startsWith" | "contains" | "";
}

const MATCHED_VIA_LABEL: Record<DeliverableRow["matchedVia"], string> = {
  exact: "Exact",
  startsWith: "Starts With",
  contains: "Contains",
  "": "",
};

/** Files found in the Files Log with no matching TIDP/MIDP row are appended as their own "Not
 * found in TIDP/MIDP" rows.
 *
 * "Skipped" rows (a TIDP/MIDP row with a blank identifier and/or no formats listed - see matchRows
 * in matchService.ts) are left out entirely: they're not a real deliverable to compare against the
 * Files Log, just an empty/incomplete row in the source register, so listing them here would only
 * be noise. They're still counted in the Summary sheet's SKIPPED stat (read from the search
 * response directly, not from this list), so the count isn't lost - just kept out of the
 * row-by-row review. */
function flatten(results: RowMatchResult[], extraFiles: ExtraFile[]): DeliverableRow[] {
  const rows: DeliverableRow[] = [];
  for (const result of results) {
    if (result.formats.length === 0) continue;
    for (const format of result.formats) {
      rows.push({
        identifier: result.identifier,
        format: format.format.toUpperCase(),
        status: format.status,
        discipline: result.discipline,
        fileName: format.fileName ?? "",
        webViewUrl: format.webViewUrl,
        version: format.versionNumber ? `V${format.versionNumber}` : "",
        folderPath: format.folderPath ?? "",
        lastModified: format.lastModifiedTime ?? "",
        lastModifiedBy: format.lastModifiedBy ?? "",
        logRevision: format.revision ?? "",
        sourceRevision: result.sourceRevision,
        revisionMatch: format.revisionMatch ?? "",
        matchedVia: format.matchedVia ?? "",
      });
    }
  }
  for (const file of extraFiles) {
    rows.push({
      identifier: "Not found in TIDP/MIDP",
      format: file.extension.toUpperCase(),
      status: "not_found_in_source",
      discipline: file.discipline,
      fileName: file.fileName,
      webViewUrl: file.webViewUrl,
      version: file.versionNumber ? `V${file.versionNumber}` : "",
      folderPath: file.folderPath ?? "",
      lastModified: file.lastModifiedTime ?? "",
      lastModifiedBy: file.lastModifiedBy ?? "",
      logRevision: file.revision ?? "",
      sourceRevision: "",
      revisionMatch: "",
      matchedVia: "",
    });
  }
  return rows;
}

interface DisciplineStat {
  discipline: string;
  total: number;
  match: number;
  missing: number;
  duplicate: number;
  completion: number;
}

interface MissingDeliverable {
  discipline: string;
  identifier: string;
  formats: string;
}

/** One row per missing TIDP/MIDP deliverable, not per missing format - `flatten` expands each
 * row's formats into separate DeliverableRow entries (so a deliverable missing 2 of 3 expected
 * formats appears twice), which is what the per-format Comparison sheet wants but would
 * double-list the same deliverable in a document-level summary. Grouped back by
 * identifier+discipline here, with the missing formats collapsed into one comma list. */
function computeMissingDeliverables(deliverables: DeliverableRow[]): MissingDeliverable[] {
  const byKey = new Map<string, MissingDeliverable>();
  for (const row of deliverables) {
    if (row.status !== "not_found_in_log") continue;
    const key = `${row.discipline} ${row.identifier}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.formats += `, ${row.format}`;
    } else {
      byKey.set(key, { discipline: row.discipline || "(unspecified)", identifier: row.identifier, formats: row.format });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.discipline.localeCompare(b.discipline) || a.identifier.localeCompare(b.identifier)
  );
}

interface DuplicateDeliverable {
  discipline: string;
  identifier: string;
  formats: string;
  /** "duplicate_in_log" (multiple Files Log entries matched one TIDP/MIDP row) and
   * "duplicate_in_source" (the same identifier appears more than once in the TIDP/MIDP register)
   * are distinct problems needing different fixes, so they're kept as separate groups/rows even
   * when the same identifier somehow has both. */
  type: "duplicate_in_log" | "duplicate_in_source";
}

const DUPLICATE_TYPE_LABEL: Record<DuplicateDeliverable["type"], string> = {
  duplicate_in_log: "Duplicate in Files Log",
  duplicate_in_source: "Duplicate in TIDP/MIDP",
};

/** Same grouping as computeMissingDeliverables, but for duplicates - one row per deliverable
 * (formats collapsed to a comma list) instead of one row per format, split further by duplicate
 * type since "the Files Log has two copies of this file" and "the TIDP/MIDP register lists this
 * identifier twice" call for different follow-up. */
function computeDuplicateDeliverables(deliverables: DeliverableRow[]): DuplicateDeliverable[] {
  const byKey = new Map<string, DuplicateDeliverable>();
  for (const row of deliverables) {
    if (row.status !== "duplicate_in_log" && row.status !== "duplicate_in_source") continue;
    const key = `${row.status} ${row.discipline} ${row.identifier}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.formats += `, ${row.format}`;
    } else {
      byKey.set(key, {
        discipline: row.discipline || "(unspecified)",
        identifier: row.identifier,
        formats: row.format,
        type: row.status,
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.discipline.localeCompare(b.discipline) || a.identifier.localeCompare(b.identifier)
  );
}

/** Breaks the same completion numbers PROGRESS SUMMARY shows down by discipline - "not found in
 * TIDP/MIDP" rows are excluded since they're not TIDP/MIDP deliverables to begin with. Discipline
 * comes from each row's already-resolved Discipline (the last suffix of its source TIDP tab name -
 * see disciplineFromSheetName on the client). */
function computeDisciplineStats(deliverables: DeliverableRow[]): DisciplineStat[] {
  const byDiscipline = new Map<string, DeliverableRow[]>();
  for (const row of deliverables) {
    if (row.status === "skipped" || row.status === "not_found_in_source") continue;
    const key = row.discipline || "(unspecified)";
    if (!byDiscipline.has(key)) byDiscipline.set(key, []);
    byDiscipline.get(key)!.push(row);
  }

  const stats: DisciplineStat[] = [];
  for (const [discipline, rows] of byDiscipline) {
    const total = rows.length;
    const match = rows.filter((r) => r.status === "match").length;
    const missing = rows.filter((r) => r.status === "not_found_in_log").length;
    const duplicate = rows.filter((r) => r.status === "duplicate_in_log" || r.status === "duplicate_in_source").length;
    stats.push({ discipline, total, match, missing, duplicate, completion: total > 0 ? (match / total) * 100 : 0 });
  }
  return stats.sort((a, b) => b.total - a.total);
}

/** Builds a branded QA/QC summary workbook: a dashboard-style Summary sheet plus a full flattened
 * Comparison sheet, matching the TIDP/MIDP submittal checker's report layout but comparing against
 * an ACC Files Log instead of a live ACC folder search. */
export async function buildQaQcWorkbook(request: ReportExportRequest): Promise<Buffer> {
  const deliverables = flatten(request.results, request.extraFiles);
  const sourceTotal = deliverables.filter((d) => d.status !== "skipped" && d.status !== "not_found_in_source").length;
  const matchCount = deliverables.filter((d) => d.status === "match").length;
  const missingCount = deliverables.filter((d) => d.status === "not_found_in_log").length;
  const duplicateCount = deliverables.filter(
    (d) => d.status === "duplicate_in_log" || d.status === "duplicate_in_source"
  ).length;
  const completion = sourceTotal > 0 ? (matchCount / sourceTotal) * 100 : 0;
  const disciplineStats = computeDisciplineStats(deliverables);
  const missingDeliverables = computeMissingDeliverables(deliverables);
  const duplicateDeliverables = computeDuplicateDeliverables(deliverables);

  const sourceBaseName = (request.sourceFileName ?? "").replace(/\.[^./\\]+$/, "");
  const projectCode = sourceBaseName.split(/[-_]/)[0] || "Project";
  const subtitleBreadcrumb = sourceBaseName || "—";
  const generatedAt = new Date().toLocaleString();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OBMI ACC Files Log / TIDP-MIDP Checker";
  workbook.created = new Date();

  buildSummarySheet(workbook, request, {
    projectCode,
    subtitleBreadcrumb,
    generatedAt,
    sourceTotal,
    matchCount,
    missingCount,
    duplicateCount,
    completion,
    disciplineStats,
    missingDeliverables,
    duplicateDeliverables,
  });
  buildComparisonSheet(workbook, deliverables);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  request: ReportExportRequest,
  meta: {
    projectCode: string;
    subtitleBreadcrumb: string;
    generatedAt: string;
    sourceTotal: number;
    matchCount: number;
    missingCount: number;
    duplicateCount: number;
    completion: number;
    disciplineStats: DisciplineStat[];
    missingDeliverables: MissingDeliverable[];
    duplicateDeliverables: DuplicateDeliverable[];
  }
) {
  const sheet = workbook.addWorksheet("Summary");
  const statColumnCount = 7;
  sheet.columns = Array.from({ length: statColumnCount }, () => ({ width: 18 }));

  // Row 1: light banner with the OBMI logo (left) and report title (right).
  sheet.getRow(1).height = 46;
  fillRange(sheet, 1, statColumnCount, COLORS.banner);
  sheet.mergeCells(1, 5, 1, statColumnCount);
  const titleCell = sheet.getCell(1, 5);
  titleCell.value = `${meta.projectCode} - QA/QC Report`;
  titleCell.font = { bold: true, size: 16, color: { argb: COLORS.darkText } };
  titleCell.alignment = { vertical: "middle", horizontal: "right" };

  try {
    const logoBuffer = readFileSync(LOGO_PATH);
    const imageId = workbook.addImage({ buffer: logoBuffer as never, extension: "png" });
    sheet.addImage(imageId, { tl: { col: 0.15, row: 0.15 }, ext: { width: 130, height: 34 } });
  } catch {
    // Logo asset missing - report still generates without it.
  }

  // Row 2: subtitle breadcrumb.
  sheet.mergeCells(2, 1, 2, statColumnCount);
  const subtitleCell = sheet.getCell(2, 1);
  subtitleCell.value = `TIDP/MIDP vs ACC Files Log   -   ${meta.subtitleBreadcrumb}   -   Generated ${meta.generatedAt}`;
  subtitleCell.font = { bold: true, size: 10.5, color: { argb: COLORS.darkText } };
  subtitleCell.alignment = { vertical: "middle", horizontal: "center" };
  fillRange(sheet, 2, statColumnCount, COLORS.subtitle);
  sheet.getRow(2).height = 22;

  let row = 4;
  row = sectionHeader(sheet, row, statColumnCount, "PROGRESS SUMMARY");

  const stats: { label: string; value: string; color: string }[] = [
    { label: "COMPLETION", value: `${meta.completion.toFixed(1)}%`, color: COLORS.completion },
    { label: "TOTAL TIDP/MIDP", value: String(meta.sourceTotal), color: COLORS.totalSource },
    { label: "TOTAL FILES LOG", value: String(request.filesScanned), color: COLORS.totalLog },
    { label: "MATCH", value: String(meta.matchCount), color: COLORS.match },
    { label: "MISSING", value: String(meta.missingCount), color: COLORS.missing },
    { label: "DUPLICATES", value: String(meta.duplicateCount), color: COLORS.duplicate },
    { label: "EXTRA", value: String(request.summary.extra), color: COLORS.extra },
  ];
  const labelRow = sheet.getRow(row);
  const valueRow = sheet.getRow(row + 1);
  valueRow.height = 30;
  stats.forEach((stat, idx) => {
    const col = idx + 1;
    const labelCell = labelRow.getCell(col);
    labelCell.value = stat.label;
    labelCell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
    labelCell.alignment = { horizontal: "center" };
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.labelRow } };

    const valueCell = valueRow.getCell(col);
    valueCell.value = stat.value;
    valueCell.font = { bold: true, size: 15, color: { argb: COLORS.white } };
    valueCell.alignment = { horizontal: "center", vertical: "middle" };
    valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: stat.color } };
  });
  row += 3;

  row = sectionHeader(sheet, row, statColumnCount, "DISCIPLINE-WISE COMPLETION");
  if (meta.disciplineStats.length === 0) {
    sheet.mergeCells(row, 1, row, statColumnCount);
    sheet.getCell(row, 1).value = "No discipline data available.";
    sheet.getCell(row, 1).font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    row += 1;
  } else {
    const disciplineHeaderRow = sheet.getRow(row);
    ["Discipline", "Total", "Match", "Missing", "Duplicate", "Completion"].forEach((label, idx) => {
      const cell = disciplineHeaderRow.getCell(idx + 1);
      cell.value = label;
      cell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.labelRow } };
    });
    row += 1;
    for (const stat of meta.disciplineStats) {
      const dataRow = sheet.getRow(row);
      dataRow.getCell(1).value = stat.discipline;
      dataRow.getCell(1).font = { bold: true, size: 10 };
      dataRow.getCell(2).value = stat.total;
      dataRow.getCell(3).value = stat.match;
      dataRow.getCell(3).font = { color: { argb: "FF2ECC71" } };
      dataRow.getCell(4).value = stat.missing;
      dataRow.getCell(4).font = { color: { argb: "FFE74C3C" } };
      dataRow.getCell(5).value = stat.duplicate;
      dataRow.getCell(5).font = { color: { argb: "FFF39C12" } };
      dataRow.getCell(6).value = `${stat.completion.toFixed(1)}%`;
      dataRow.getCell(6).font = { bold: true };
      row += 1;
    }
  }
  row += 1;

  row = sectionHeader(sheet, row, statColumnCount, `MISSING DOCUMENTS (${meta.missingDeliverables.length})`);
  if (meta.missingDeliverables.length === 0) {
    sheet.mergeCells(row, 1, row, statColumnCount);
    sheet.getCell(row, 1).value = "None - every TIDP/MIDP deliverable's expected formats were found in the Files Log.";
    sheet.getCell(row, 1).font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    row += 1;
  } else {
    const missingHeaderRow = sheet.getRow(row);
    ["Discipline", "TIDP/MIDP Deliverable", "Missing Format(s)"].forEach((label, idx) => {
      const cell = missingHeaderRow.getCell(idx + 1);
      cell.value = label;
      cell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.labelRow } };
    });
    sheet.mergeCells(row, 3, row, statColumnCount);
    row += 1;
    for (const missing of meta.missingDeliverables) {
      fillRange(sheet, row, statColumnCount, MISSING_ROW_FILL);
      const dataRow = sheet.getRow(row);
      dataRow.getCell(1).value = missing.discipline;
      dataRow.getCell(1).font = { size: 10 };
      dataRow.getCell(2).value = missing.identifier;
      dataRow.getCell(2).font = { size: 10 };
      sheet.mergeCells(row, 3, row, statColumnCount);
      dataRow.getCell(3).value = missing.formats;
      dataRow.getCell(3).font = { size: 10, color: { argb: "FFE74C3C" } };
      row += 1;
    }
  }
  row += 1;

  row = sectionHeader(sheet, row, statColumnCount, `DUPLICATE DOCUMENTS (${meta.duplicateDeliverables.length})`);
  if (meta.duplicateDeliverables.length === 0) {
    sheet.mergeCells(row, 1, row, statColumnCount);
    sheet.getCell(row, 1).value = "None - no duplicate Files Log entries or repeated TIDP/MIDP identifiers found.";
    sheet.getCell(row, 1).font = { size: 10, italic: true, color: { argb: "FF6B7280" } };
    row += 1;
  } else {
    const duplicateHeaderRow = sheet.getRow(row);
    ["Discipline", "TIDP/MIDP Deliverable", "Duplicate Type", "Format(s)"].forEach((label, idx) => {
      const cell = duplicateHeaderRow.getCell(idx + 1);
      cell.value = label;
      cell.font = { bold: true, size: 9, color: { argb: "FF6B7280" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.labelRow } };
    });
    sheet.mergeCells(row, 4, row, statColumnCount);
    row += 1;
    for (const duplicate of meta.duplicateDeliverables) {
      fillRange(sheet, row, statColumnCount, DUPLICATE_ROW_FILL);
      const dataRow = sheet.getRow(row);
      dataRow.getCell(1).value = duplicate.discipline;
      dataRow.getCell(1).font = { size: 10 };
      dataRow.getCell(2).value = duplicate.identifier;
      dataRow.getCell(2).font = { size: 10 };
      dataRow.getCell(3).value = DUPLICATE_TYPE_LABEL[duplicate.type];
      dataRow.getCell(3).font = { size: 10 };
      sheet.mergeCells(row, 4, row, statColumnCount);
      dataRow.getCell(4).value = duplicate.formats;
      dataRow.getCell(4).font = { size: 10, color: { argb: "FFF39C12" } };
      row += 1;
    }
  }
  row += 1;

  row = sectionHeader(sheet, row, statColumnCount, "COMPARISON SETUP");
  const filterSummary = Object.entries(request.columnFilters ?? {})
    .filter(([, value]) => value)
    .map(([column, value]) => `${column} = ${value}`)
    .join("; ");
  const info: [string, string][] = [
    ["TIDP/MIDP Source", request.sourceFileName ?? "—"],
    ["Files Log Source", request.filesLogSourceDescription ?? "—"],
    [
      "Only Shared Files",
      request.onlyShared ? `Yes - folder path contains "${request.sharedKeyword ?? "Shared"}"` : "No - every logged file counted",
    ],
    ["Sheet(s)", (request.selectedSheetNames ?? []).join(", ") || "—"],
    ["Identifier Column", request.identifierColumn ?? "—"],
    ["Formats Column", request.formatsColumn ?? "—"],
    ["Discipline Source", "Last suffix of each TIDP sheet/tab name"],
    [
      "Planned Date Filter",
      request.selectedPlannedDates?.length ? `${request.selectedPlannedDates.length} planned date(s)` : "All dates",
    ],
    ["Column Filters", filterSummary || "None"],
    ["Match Mode", request.matchMode],
  ];
  for (const [key, value] of info) {
    const keyCell = sheet.getCell(`A${row}`);
    keyCell.value = key;
    keyCell.font = { bold: true, size: 10 };
    sheet.mergeCells(row, 2, row, statColumnCount);
    const valueCell = sheet.getCell(row, 2);
    valueCell.value = value;
    valueCell.font = { size: 10 };
    row += 1;
  }
  row += 1;

  row = sectionHeader(sheet, row, statColumnCount, "ANALYSIS & INSIGHTS");
  const insights = [
    `${meta.sourceTotal} deliverable(s) evaluated: ${meta.matchCount} Match, ${meta.missingCount} Missing, ${meta.duplicateCount} Duplicate, ${request.summary.skipped} Skipped.`,
    `Total TIDP/MIDP: ${meta.sourceTotal}; Total Files Log entries: ${request.filesScanned}; Match: ${meta.matchCount}; Missing: ${meta.missingCount}; Duplicates: ${meta.duplicateCount}; Extra: ${request.summary.extra}.`,
    `Completion is ${meta.completion.toFixed(1)}% using match mode "${request.matchMode}"${
      request.selectedPlannedDates?.length ? ` and ${request.selectedPlannedDates.length} planned date(s) selected` : ""
    }.`,
  ];
  for (const insight of insights) {
    sheet.mergeCells(row, 1, row, statColumnCount);
    const cell = sheet.getCell(row, 1);
    cell.value = `-  ${insight}`;
    cell.font = { size: 10 };
    row += 1;
  }
  row += 1;

  if (meta.disciplineStats.length > 0) {
    row = sectionHeader(sheet, row, statColumnCount, "DISCIPLINE INSIGHTS");
    for (const stat of meta.disciplineStats) {
      sheet.mergeCells(row, 1, row, statColumnCount);
      const cell = sheet.getCell(row, 1);
      cell.value = `-  ${stat.discipline}: ${stat.total} deliverable(s) - ${stat.match} Match, ${stat.missing} Missing, ${stat.duplicate} Duplicate (${stat.completion.toFixed(1)}% complete).`;
      cell.font = { size: 10 };
      row += 1;
    }
  }
}

function sectionHeader(sheet: ExcelJS.Worksheet, row: number, colCount: number, title: string): number {
  sheet.mergeCells(row, 1, row, colCount);
  const cell = sheet.getCell(row, 1);
  cell.value = title;
  cell.font = { bold: true, size: 11, color: { argb: COLORS.white } };
  cell.alignment = { vertical: "middle" };
  sheet.getRow(row).height = 20;
  fillRange(sheet, row, colCount, COLORS.sectionHeader);
  return row + 1;
}

function fillRange(sheet: ExcelJS.Worksheet, rowNumber: number, colCount: number, argb: string) {
  for (let col = 1; col <= colCount; col++) {
    sheet.getCell(rowNumber, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  }
}

const STATUS_FILL: Record<DeliverableStatus, string> = {
  match: "FFE6F9EE",
  not_found_in_log: "FFFCE8E6",
  duplicate_in_log: "FFFEF3E0",
  duplicate_in_source: "FFFEF3E0",
  not_found_in_source: "FFF0EDFC",
  skipped: "FFF0F0F0",
};
const STATUS_LABEL: Record<DeliverableStatus, string> = {
  match: "Match",
  not_found_in_log: "Not Found in Files Log",
  duplicate_in_log: "Duplicate in Files Log",
  duplicate_in_source: "Duplicate in TIDP/MIDP",
  not_found_in_source: "Not Found in TIDP/MIDP",
  skipped: "Skipped",
};

const REVISION_MATCH_FILL: Record<"match" | "mismatch" | "", string | undefined> = {
  match: "FFE6F9EE",
  mismatch: "FFFCE8E6",
  "": undefined,
};
const REVISION_MATCH_LABEL: Record<"match" | "mismatch" | "", string> = {
  match: "Match",
  mismatch: "Mismatch",
  "": "",
};

function buildComparisonSheet(workbook: ExcelJS.Workbook, deliverables: DeliverableRow[]) {
  const sheet = workbook.addWorksheet("Comparison Table QA_QC");
  sheet.columns = [
    { header: "TIDP/MIDP Deliverable", key: "identifier", width: 44 },
    { header: "Format", key: "format", width: 10 },
    { header: "Status", key: "status", width: 20 },
    { header: "Discipline", key: "discipline", width: 14 },
    { header: "Files Log Entry", key: "fileName", width: 44 },
    { header: "Version", key: "version", width: 10 },
    { header: "Folder Path", key: "folderPath", width: 40 },
    { header: "Last Modified", key: "lastModified", width: 20 },
    { header: "Modified By", key: "lastModifiedBy", width: 20 },
    { header: "Log Revision", key: "logRevision", width: 14 },
    { header: "TIDP/MIDP Revision", key: "sourceRevision", width: 16 },
    { header: "Revision Match", key: "revisionMatch", width: 14 },
    { header: "Matched Via", key: "matchedVia", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: COLORS.white } };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.sectionHeader } };
  });

  for (const row of deliverables) {
    const excelRow = sheet.addRow({
      identifier: row.identifier,
      format: row.format,
      status: STATUS_LABEL[row.status],
      discipline: row.discipline,
      fileName: row.fileName,
      version: row.version,
      folderPath: row.folderPath,
      lastModified: row.lastModified,
      lastModifiedBy: row.lastModifiedBy,
      logRevision: row.logRevision,
      sourceRevision: row.sourceRevision,
      revisionMatch: REVISION_MATCH_LABEL[row.revisionMatch],
      matchedVia: MATCHED_VIA_LABEL[row.matchedVia],
    });
    excelRow.getCell("status").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: STATUS_FILL[row.status] },
    };
    const revisionFill = REVISION_MATCH_FILL[row.revisionMatch];
    if (revisionFill) {
      excelRow.getCell("revisionMatch").fill = { type: "pattern", pattern: "solid", fgColor: { argb: revisionFill } };
    }
    if (row.fileName && row.webViewUrl) {
      excelRow.getCell("fileName").value = { text: row.fileName, hyperlink: row.webViewUrl };
      excelRow.getCell("fileName").font = { color: { argb: "FF1155CC" }, underline: true };
    }
  }

  sheet.autoFilter = { from: "A1", to: `M${deliverables.length + 1}` };
}
