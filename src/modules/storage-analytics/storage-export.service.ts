import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
// pdfkit CommonJS default export qiladi — esModuleInterop o'chiq, shuning uchun require-import
// eslint-disable-next-line @typescript-eslint/no-require-imports
import PDFDocument = require('pdfkit');
import { ExportFormat, ExportReport } from './dto/storage-analytics.dtos';
import { StorageAnalyticsService } from './storage-analytics.service';

/** Baytni odam o'qiydigan ko'rinishga o'tkazish (eksport hujjatlari uchun) */
function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const abs = Math.abs(bytes);
  const sign = bytes < 0 ? '-' : '';
  if (abs >= 1024 ** 3) return `${sign}${(abs / 1024 ** 3).toFixed(2)} GB`;
  if (abs >= 1024 ** 2) return `${sign}${(abs / 1024 ** 2).toFixed(1)} MB`;
  if (abs >= 1024) return `${sign}${(abs / 1024).toFixed(1)} KB`;
  return `${sign}${abs} B`;
}

interface ReportData {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

/** Eksport uchun standart so'rov: birinchi 100 yozuv, hajm bo'yicha kamayish tartibida */
function exportQuery<T extends { page: number; limit: number; sortOrder: 'ASC' | 'DESC' }>(): T {
  return { page: 1, limit: 100, sortOrder: 'DESC', skip: 0 } as unknown as T;
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
};

/**
 * Storage Analytics hisobotlarini Excel/CSV/PDF ga eksport qilish.
 * Ma'lumot StorageAnalyticsService dan (keshlangan) olinadi — eksport
 * hech qachon qo'shimcha og'ir so'rov yaratmaydi.
 */
@Injectable()
export class StorageExportService {
  constructor(private readonly analyticsService: StorageAnalyticsService) {}

  async export(report: ExportReport, format: ExportFormat): Promise<Buffer> {
    const data = await this.buildReport(report);
    switch (format) {
      case 'csv':
        return this.toCsv(data);
      case 'pdf':
        return this.toPdf(data);
      default:
        return this.toXlsx(data);
    }
  }

  buildFileName(report: ExportReport, format: ExportFormat): string {
    const date = new Date().toISOString().slice(0, 10);
    return `storage-${report}-${date}.${format}`;
  }

  private async buildReport(report: ExportReport): Promise<ReportData> {
    switch (report) {
      case 'companies': {
        const { items } = await this.analyticsService.companies(exportQuery());
        return {
          title: 'Kompaniyalar saqlash hajmi',
          headers: [
            'Kompaniya', 'Holat', 'Hajm', 'Foydalanuvchilar', 'Xodimlar', 'Filiallar',
            'Qurilmalar', 'Davomat eventlari', 'Jami yozuvlar', 'Oxirgi faollik',
          ],
          rows: items.map((c) => [
            c.companyName, c.status, formatBytes(c.estimatedBytes), c.users, c.employees,
            c.branches, c.devices, c.attendanceEvents, c.totalRecords, c.lastActivityAt ?? '—',
          ]),
        };
      }
      case 'models': {
        const { items } = await this.analyticsService.models(exportQuery());
        return {
          title: 'Model (Entity) statistikasi',
          headers: ['Entity', 'Jadval', 'Qatorlar', 'Hajm', "O'rtacha qator", "Bugungi o'sish", "Oylik o'sish"],
          rows: items.map((m) => [
            m.entityName, m.tableName, m.rows, formatBytes(m.totalBytes),
            formatBytes(m.avgRowBytes), formatBytes(m.growthTodayBytes), formatBytes(m.growthMonthBytes),
          ]),
        };
      }
      case 'logs': {
        const logs = await this.analyticsService.logs();
        return {
          title: 'Log jadvallari statistikasi',
          headers: ['Log', 'Jadval', 'Qatorlar', 'Hajm', "Kunlik o'sish", 'Eng eski yozuv', 'Eng yangi yozuv'],
          rows: logs.map((l) => [
            l.logName, l.tableName, l.rows, formatBytes(l.totalBytes),
            formatBytes(l.growthDayBytes), l.oldestAt ?? '—', l.newestAt ?? '—',
          ]),
        };
      }
      case 'recommendations': {
        const { items } = await this.analyticsService.recommendations();
        return {
          title: 'Tozalash tavsiyalari',
          headers: ['Turi', 'Obyekt', 'Tavsif', 'Taxminiy tejash'],
          rows: items.map((r) => [r.kind, r.target, r.description, formatBytes(r.estimatedSavingBytes)]),
        };
      }
      default: {
        const { items } = await this.analyticsService.tables(exportQuery());
        return {
          title: 'Jadvallar statistikasi',
          headers: [
            'Jadval', 'Qatorlar', 'Jadval hajmi', 'Indeks', 'TOAST', 'Jami',
            'Dead tuples', 'Seq scan', 'Index scan', 'Vacuum', 'Analyze',
          ],
          rows: items.map((t) => [
            t.tableName, t.liveRows, formatBytes(t.tableBytes), formatBytes(t.indexBytes),
            formatBytes(t.toastBytes), formatBytes(t.totalBytes), t.deadTuples,
            t.seqScan, t.idxScan, t.vacuumStatus, t.analyzeStatus,
          ]),
        };
      }
    }
  }

  private async toXlsx(data: ReportData): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FaceID Platform';
    const sheet = workbook.addWorksheet(data.title.slice(0, 31));

    sheet.mergeCells(1, 1, 1, data.headers.length);
    const title = sheet.getCell(1, 1);
    title.value = `${data.title} — ${new Date().toISOString().slice(0, 10)}`;
    title.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 24;

    const headerRow = sheet.getRow(3);
    data.headers.forEach((value, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = value;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      sheet.getColumn(i + 1).width = Math.max(14, value.length + 4);
    });
    headerRow.height = 22;

    data.rows.forEach((row, ri) => {
      row.forEach((value, ci) => {
        const cell = sheet.getRow(4 + ri).getCell(ci + 1);
        cell.value = value;
        cell.font = { size: 10 };
        if (typeof value === 'number') cell.numFmt = '#,##0';
      });
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private toCsv(data: ReportData): Buffer {
    const escape = (v: string | number): string => {
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      data.headers.map(escape).join(','),
      ...data.rows.map((row) => row.map(escape).join(',')),
    ];
    // BOM — Excel'da UTF-8 to'g'ri ochilishi uchun
    return Buffer.from('﻿' + lines.join('\n'), 'utf8');
  }

  private toPdf(data: ReportData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).fillColor('#1F3864').text(data.title, { align: 'center' });
      doc.fontSize(9).fillColor('#808080').text(new Date().toISOString().slice(0, 10), {
        align: 'center',
      });
      doc.moveDown();

      const pageWidth = doc.page.width - 72;
      const colWidth = pageWidth / data.headers.length;
      const startX = 36;
      let y = doc.y + 4;

      const drawRow = (values: (string | number)[], bold: boolean) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(bold ? '#FFFFFF' : '#18181B');
        if (bold) doc.rect(startX, y - 2, pageWidth, 16).fill('#2F5597');
        doc.fillColor(bold ? '#FFFFFF' : '#18181B');
        values.forEach((v, i) => {
          doc.text(String(v), startX + i * colWidth + 2, y, {
            width: colWidth - 4,
            height: 14,
            ellipsis: true,
            lineBreak: false,
          });
        });
        y += 16;
        if (y > doc.page.height - 50) {
          doc.addPage();
          y = 40;
        }
      };

      drawRow(data.headers, true);
      for (const row of data.rows) drawRow(row, false);

      doc.end();
    });
  }
}
