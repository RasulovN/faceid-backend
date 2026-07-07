import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Branch } from '../../entities/branch.entity';
import { Company } from '../../entities/company.entity';
import { Employee } from '../../entities/employee.entity';
import { WorkDay } from '../../entities/work-day.entity';
import { EmployeeStatus, WorkDayStatus } from '../../common/enums';
import { datesOfMonth } from '../../common/utils/tz.util';

const STATUS_LABEL: Record<WorkDayStatus, string> = {
  [WorkDayStatus.PRESENT]: '+',
  [WorkDayStatus.LATE]: 'K',
  [WorkDayStatus.ABSENT]: 'Y',
  [WorkDayStatus.VACATION]: 'T',
  [WorkDayStatus.SICK]: 'B',
};

@Injectable()
export class AttendanceExportService {
  constructor(
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    @InjectRepository(WorkDay) private readonly workDayRepository: Repository<WorkDay>,
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(Company) private readonly companyRepository: Repository<Company>,
  ) {}

  /** Oylik davomat hisoboti — chiroyli formatlangan xlsx */
  async exportMonthly(companyId: string, month: string, branchId?: string): Promise<Buffer> {
    const company = await this.companyRepository.findOne({ where: { id: companyId } });
    const branch = branchId
      ? await this.branchRepository.findOne({ where: { id: branchId, companyId } })
      : null;
    const employees = await this.employeeRepository.find({
      where: {
        companyId,
        deletedAt: IsNull(),
        status: In([EmployeeStatus.ACTIVE, EmployeeStatus.VACATION]),
        ...(branchId ? { branchId } : {}),
      },
      order: { lastName: 'ASC' },
    });
    const dates = datesOfMonth(month);
    const workDays = employees.length
      ? await this.workDayRepository.find({
          where: { employeeId: In(employees.map((e) => e.id)), date: In(dates) },
        })
      : [];
    const wdMap = new Map(workDays.map((w) => [`${w.employeeId}:${w.date}`, w]));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FaceID Platform';
    const sheet = workbook.addWorksheet(`Davomat ${month}`, {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }],
    });

    // Sarlavha
    const lastCol = 3 + dates.length + 4;
    sheet.mergeCells(1, 1, 1, lastCol);
    const title = sheet.getCell(1, 1);
    title.value = `${company?.name ?? ''} — Davomat hisoboti (${month}${branch ? `, ${branch.name}` : ''})`;
    title.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 24;

    sheet.mergeCells(2, 1, 2, lastCol);
    const legend = sheet.getCell(2, 1);
    legend.value = 'Belgilar: + kelgan · K kechikkan · Y yo‘q (sababsiz) · T ta’til · B betob';
    legend.font = { italic: true, size: 9, color: { argb: 'FF808080' } };
    legend.alignment = { horizontal: 'center' };

    // Header (4-qator)
    const headerRow = sheet.getRow(4);
    const headers = [
      '№',
      'F.I.Sh.',
      'Tab №',
      ...dates.map((d) => String(Number(d.slice(8)))),
      'Ish kunlari',
      'Kechikish (daq)',
      'Ishlagan (soat)',
      'Qo‘shimcha (soat)',
    ];
    headers.forEach((value, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = value;
      cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5597' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin' }, right: { style: 'thin', color: { argb: 'FFD0D7E5' } } };
    });
    headerRow.height = 28;
    sheet.getColumn(1).width = 5;
    sheet.getColumn(2).width = 28;
    sheet.getColumn(3).width = 9;
    dates.forEach((_d, i) => (sheet.getColumn(4 + i).width = 4));
    for (let i = 0; i < 4; i++) sheet.getColumn(4 + dates.length + i).width = 13;

    // Ma'lumot qatorlari
    employees.forEach((employee, index) => {
      const row = sheet.getRow(5 + index);
      row.getCell(1).value = index + 1;
      row.getCell(2).value = employee.fullName;
      row.getCell(3).value = employee.tabNumber;
      let presentDays = 0;
      let lateTotal = 0;
      let workedTotal = 0;
      let overtimeTotal = 0;
      dates.forEach((date, di) => {
        const cell = row.getCell(4 + di);
        const wd = wdMap.get(`${employee.id}:${date}`);
        cell.alignment = { horizontal: 'center' };
        if (!wd) {
          cell.value = '';
          return;
        }
        cell.value = STATUS_LABEL[wd.status];
        if (wd.status === WorkDayStatus.LATE) {
          // Kechikish — qizil
          cell.font = { bold: true, color: { argb: 'FFC00000' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E7' } };
        } else if (wd.status === WorkDayStatus.ABSENT) {
          cell.font = { bold: true, color: { argb: 'FF7F1D1D' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3CFCF' } };
        } else if (wd.status === WorkDayStatus.PRESENT) {
          cell.font = { color: { argb: 'FF1E7E34' } };
        }
        if (wd.status === WorkDayStatus.PRESENT || wd.status === WorkDayStatus.LATE) presentDays++;
        lateTotal += wd.lateMinutes;
        workedTotal += wd.workedMinutes;
        overtimeTotal += wd.overtimeMinutes;
      });
      const summaryStart = 4 + dates.length;
      row.getCell(summaryStart).value = presentDays;
      const lateCell = row.getCell(summaryStart + 1);
      lateCell.value = lateTotal;
      if (lateTotal > 0) lateCell.font = { bold: true, color: { argb: 'FFC00000' } };
      row.getCell(summaryStart + 2).value = Math.round((workedTotal / 60) * 10) / 10;
      row.getCell(summaryStart + 3).value = Math.round((overtimeTotal / 60) * 10) / 10;
      for (let c = summaryStart; c < summaryStart + 4; c++) {
        row.getCell(c).alignment = { horizontal: 'center' };
      }
      // Zebra
      if (index % 2 === 1) {
        for (let c = 1; c <= 3; c++) {
          row.getCell(c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF4F6FB' },
          };
        }
      }
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
