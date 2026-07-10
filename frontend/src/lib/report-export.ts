/**
 * Report export helpers — CSV download + a clean print-to-PDF window.
 *
 * PDF uses the browser's own "Save as PDF" via a standalone print window, so the
 * exported document is laid out independently of the app's CSS (no theme bleed,
 * always light, Clockify-style). Zero dependencies for CSV/PDF; Excel via xlsx.
 */

import * as XLSX from 'xlsx';

const csvEscape = (v: string | number): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCSV(filename: string, header: string[], rows: (string | number)[][]): void {
  const body = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
  // BOM so Excel reads UTF-8 correctly.
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const esc = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );

export interface PrintColumn {
  label: string;
  align?: 'left' | 'right' | 'center';
}

/** Build one printable table block (header + rows + optional totals row). */
export function printTable(
  columns: PrintColumn[],
  rows: (string | number)[][],
  totals?: (string | number)[],
): string {
  const th = columns
    .map(c => `<th style="text-align:${c.align ?? 'left'}">${esc(c.label)}</th>`)
    .join('');
  const trs = rows
    .map(
      r =>
        `<tr>${r
          .map((cell, i) => `<td style="text-align:${columns[i]?.align ?? 'left'}">${esc(String(cell))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  const tfoot = totals
    ? `<tr class="totals">${totals
        .map((cell, i) => `<td style="text-align:${columns[i]?.align ?? 'left'}">${esc(String(cell))}</td>`)
        .join('')}</tr>`
    : '';
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}${tfoot}</tbody></table>`;
}

export function openPrintWindow(opts: {
  title: string;
  subtitle?: string;
  total?: string;
  sections: string[]; // pre-built HTML blocks (e.g. from printTable)
}): void {
  const w = window.open('', '_blank', 'width=1100,height=800');
  if (!w) {
    // Pop-up blocked — surface to caller via throw so they can toast.
    throw new Error('Allow pop-ups to export a PDF.');
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #1a1a2e; margin: 40px; }
    .head { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom: 28px; }
    h1 { font-size: 26px; margin: 0 0 4px; }
    .sub { color:#6b7280; font-size: 13px; }
    .total { font-size: 15px; margin-top: 10px; }
    .total b { font-size: 20px; }
    .brand { font-size: 22px; font-weight: 800; letter-spacing: .04em; color:#4f46e5; }
    table { width:100%; border-collapse: collapse; margin: 0 0 26px; font-size: 12.5px; }
    th { text-transform: uppercase; font-size: 10.5px; letter-spacing:.05em; color:#6b7280; border-bottom:2px solid #e5e7eb; padding: 8px 10px; }
    td { padding: 9px 10px; border-bottom: 1px solid #f0f0f3; }
    tr.totals td { border-top: 2px solid #e5e7eb; border-bottom: none; font-weight: 700; }
    @media print { body { margin: 16px; } @page { margin: 14mm; } }
  </style></head><body>
    <div class="head">
      <div>
        <h1>${esc(opts.title)}</h1>
        ${opts.subtitle ? `<div class="sub">${esc(opts.subtitle)}</div>` : ''}
        ${opts.total ? `<div class="total">Total: <b>${esc(opts.total)}</b></div>` : ''}
      </div>
      <div class="brand">ZET</div>
    </div>
    ${opts.sections.join('\n')}
    <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 200); };</script>
  </body></html>`;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

// ── Per-employee report export ───────────────────────────────────────────────

export interface EmployeeReportSummary {
  employeeName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  totalHours: string;
  billableHours: string;
  nonBillableHours: string;
  entryCount: number;
  projectCount: number;
}

export function slugEmployeeName(name: string): string {
  const slug = name.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_');
  return slug || 'Employee';
}

export function employeeReportFilename(
  employeeName: string,
  periodStart: string,
  periodEnd: string,
): string {
  return `Timesheet_Report_${slugEmployeeName(employeeName)}_${periodStart}_to_${periodEnd}`;
}

function summaryRowsFromEmployeeReport(summary: EmployeeReportSummary): [string, string][] {
  return [
    ['Employee Name', summary.employeeName],
    ['Report Period', summary.periodLabel],
    ['Total Hours', summary.totalHours],
    ['Billable Hours', summary.billableHours],
    ['Non-Billable Hours', summary.nonBillableHours],
    ['Number of Entries', String(summary.entryCount)],
    ['Number of Projects Worked On', String(summary.projectCount)],
  ];
}

function employeeReportSummaryHtml(summary: EmployeeReportSummary): string {
  const trs = summaryRowsFromEmployeeReport(summary)
    .map(([label, value]) =>
      `<tr><td style="color:#6b7280;font-weight:600;padding:6px 12px 6px 0;white-space:nowrap">${esc(label)}</td>`
      + `<td style="padding:6px 0">${esc(value)}</td></tr>`,
    )
    .join('');
  return `<div style="margin-bottom:24px;padding:16px 18px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px">`
    + `<table>${trs}</table></div>`;
}

function downloadBlobCsv(filename: string, body: string): void {
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadEmployeeExcel(
  filename: string,
  summary: EmployeeReportSummary,
  header: string[],
  rows: (string | number)[][],
): void {
  const aoa: (string | number)[][] = [
    ...summaryRowsFromEmployeeReport(summary),
    [],
    header,
    ...rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 30 }, { wch: 44 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function downloadEmployeeCSV(
  filename: string,
  summary: EmployeeReportSummary,
  header: string[],
  rows: (string | number)[][],
): void {
  const summaryLines = summaryRowsFromEmployeeReport(summary)
    .map(([label, value]) => `${csvEscape(label)},${csvEscape(value)}`);
  const body = [
    ...summaryLines,
    '',
    header.map(csvEscape).join(','),
    ...rows.map(r => r.map(csvEscape).join(',')),
  ].join('\r\n');
  downloadBlobCsv(filename, body);
}

export function openEmployeePrintWindow(
  summary: EmployeeReportSummary,
  detailColumns: PrintColumn[],
  detailRows: (string | number)[][],
): void {
  openPrintWindow({
    title: `Timesheet Report — ${summary.employeeName}`,
    subtitle: summary.periodLabel,
    total: summary.totalHours,
    sections: [
      employeeReportSummaryHtml(summary),
      printTable(detailColumns, detailRows),
    ],
  });
}

export type EmployeeReportFormat = 'excel' | 'csv' | 'pdf';

export interface EmployeeReportExportInput {
  format: EmployeeReportFormat;
  summary: EmployeeReportSummary;
  detailHeader: string[];
  detailRows: (string | number)[][];
}

/** Shared per-employee export — summary block + detailed rows, all active filters applied by caller. */
export function exportEmployeeReport(input: EmployeeReportExportInput): void {
  const base = employeeReportFilename(
    input.summary.employeeName,
    input.summary.periodStart,
    input.summary.periodEnd,
  );
  if (input.format === 'excel') {
    downloadEmployeeExcel(base, input.summary, input.detailHeader, input.detailRows);
    return;
  }
  if (input.format === 'csv') {
    downloadEmployeeCSV(base, input.summary, input.detailHeader, input.detailRows);
    return;
  }
  openEmployeePrintWindow(
    input.summary,
    input.detailHeader.map(label => ({ label })),
    input.detailRows,
  );
}
