import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Company } from '../../entities/company.entity';
import { PayrollRecord } from '../../entities/payroll-record.entity';

/** tiyin → so'm */
function tiyinToSum(tiyin: number): number {
  return tiyin / 100;
}

@Injectable()
export class PayrollExportService {
  constructor(
    @InjectRepository(PayrollRecord)
    private readonly payrollRepository: Repository<PayrollRecord>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
  ) {}

  async exportMonthly(
    companyId: string,
    month: string,
    ids?: string,
    branchId?: string,
  ): Promise<Buffer> {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    const idList = ids
      ? ids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const records = await this.payrollRepository.find({
      where: {
        periodMonth: month,
        employee: { companyId, ...(branchId ? { branchId } : {}) },
        ...(idList && idList.length > 0 ? { id: In(idList) } : {}),
      },
      relations: { employee: true },
      order: { createdAt: 'ASC' },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FaceID Platform';
    const sheet = workbook.addWorksheet(`Oylik ${month}`);

    sheet.mergeCells('A1:I1');
    const title = sheet.getCell('A1');
    title.value = `${company?.name ?? ''} — Oylik hisob-kitob (${month})`;
    title.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
    title.alignment = { horizontal: 'center' };
    sheet.getRow(1).height = 24;

    const headers = [
      '№',
      'F.I.Sh.',
      'Tab №',
      'Ish haqi turi',
      'Asosiy (so‘m)',
      'Qo‘shimcha ish (so‘m)',
      'Jarima (so‘m)',
      'Bonus (so‘m)',
      'Jami (so‘m)',
    ];
    const headerRow = sheet.getRow(3);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    headerRow.height = 26;
    sheet.getColumn(1).width = 5;
    sheet.getColumn(2).width = 28;
    sheet.getColumn(3).width = 9;
    sheet.getColumn(4).width = 12;
    for (let c = 5; c <= 9; c++) sheet.getColumn(c).width = 17;

    records.forEach((record, index) => {
      const row = sheet.getRow(4 + index);
      row.getCell(1).value = index + 1;
      row.getCell(2).value = record.employee?.fullName ?? '';
      row.getCell(3).value = record.employee?.tabNumber ?? '';
      row.getCell(4).value = record.employee?.salaryType ?? '';
      row.getCell(5).value = tiyinToSum(record.baseSalary);
      row.getCell(6).value = tiyinToSum(record.overtimeAmount);
      const penaltyCell = row.getCell(7);
      penaltyCell.value = tiyinToSum(record.penaltyAmount);
      if (record.penaltyAmount > 0) penaltyCell.font = { color: { argb: 'FFC00000' }, bold: true };
      row.getCell(8).value = tiyinToSum(record.bonusAmount);
      const totalCell = row.getCell(9);
      totalCell.value = tiyinToSum(record.totalAmount);
      totalCell.font = { bold: true };
      for (let c = 5; c <= 9; c++) {
        row.getCell(c).numFmt = '#,##0.00';
        row.getCell(c).alignment = { horizontal: 'right' };
      }
    });

    // Jami qator
    const totalRow = sheet.getRow(4 + records.length);
    totalRow.getCell(2).value = 'JAMI:';
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(9).value = tiyinToSum(records.reduce((s, r) => s + r.totalAmount, 0));
    totalRow.getCell(9).font = { bold: true, color: { argb: 'FF1F3864' } };
    totalRow.getCell(9).numFmt = '#,##0.00';
    totalRow.getCell(9).alignment = { horizontal: 'right' };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
