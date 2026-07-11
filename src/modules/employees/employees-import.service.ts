import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Branch } from '../../entities/branch.entity';
import { User } from '../../entities/user.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { Gender, SalaryType } from '../../common/enums';
import { UploadedFile } from '../../common/utils/multipart.util';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/employee.dtos';

/** Import shablonidagi varaq nomi va ustunlar tartibi */
const SHEET_NAME = 'Xodimlar';
const BRANCHES_SHEET = 'Filiallar';
const GUIDE_SHEET = "Yo'riqnoma";
const MAX_ROWS = 500;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Ustunlar: index (1-based) → sarlavha. Tartib o'zgarsa parseRow ham yangilanadi. */
const COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'Familiya *', key: 'lastName', width: 18 },
  { header: 'Ism *', key: 'firstName', width: 16 },
  { header: 'Otasining ismi', key: 'middleName', width: 18 },
  { header: 'Tab raqami *', key: 'tabNumber', width: 14 },
  { header: 'Filial *', key: 'branch', width: 22 },
  { header: 'Lavozim', key: 'position', width: 18 },
  { header: "Bo'lim", key: 'department', width: 16 },
  { header: 'Telefon *', key: 'phone', width: 17 },
  { header: 'Email *', key: 'email', width: 26 },
  { header: 'Username', key: 'username', width: 16 },
  { header: 'Parol', key: 'password', width: 14 },
  { header: "Tug'ilgan sana", key: 'birthDate', width: 15 },
  { header: 'Jins', key: 'gender', width: 10 },
  { header: 'Ishga olingan sana', key: 'hiredAt', width: 17 },
  { header: 'Maosh turi', key: 'salaryType', width: 12 },
  { header: "Maosh (so'm)", key: 'salaryAmount', width: 14 },
];

const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1])) as Record<string, number>;

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  total: number;
  created: number;
  failed: number;
  errors: ImportRowError[];
}

@Injectable()
export class EmployeesImportService {
  constructor(
    @InjectRepository(Branch) private readonly branchRepository: Repository<Branch>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly employeesService: EmployeesService,
  ) {}

  // ---------- Shablon ----------

  async buildTemplate(companyId: string): Promise<Buffer> {
    const branches = await this.branchRepository.find({
      where: { companyId },
      order: { name: 'ASC' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

    const headerRow = sheet.getRow(1);
    headerRow.height = 22;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Telefon/tab/parol ustunlari matn formatida — Excel '+' va boshdagi nollarni yemasin
    for (const key of ['tabNumber', 'phone', 'username', 'password', 'birthDate', 'hiredAt']) {
      sheet.getColumn(COL[key]).numFmt = '@';
    }

    // Filiallar ro'yxati (dropdown manbasi)
    const branchSheet = workbook.addWorksheet(BRANCHES_SHEET);
    branchSheet.getCell('A1').value = 'Filial nomi';
    branchSheet.getCell('A1').font = { bold: true };
    branchSheet.getColumn(1).width = 30;
    branches.forEach((b, i) => {
      branchSheet.getCell(`A${i + 2}`).value = b.name;
    });
    const branchListEnd = Math.max(branches.length + 1, 2);

    // Data validation dropdownlari (2..MAX_ROWS+1 qatorlar)
    const colLetter = (n: number) => sheet.getColumn(n).letter;
    for (let r = 2; r <= MAX_ROWS + 1; r++) {
      sheet.getCell(`${colLetter(COL.branch)}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'${BRANCHES_SHEET}'!$A$2:$A$${branchListEnd}`],
      };
      sheet.getCell(`${colLetter(COL.gender)}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Erkak,Ayol"'],
      };
      sheet.getCell(`${colLetter(COL.salaryType)}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"Oylik,Soatbay"'],
      };
    }

    // Yo'riqnoma varag'i
    const guide = workbook.addWorksheet(GUIDE_SHEET);
    guide.getColumn(1).width = 110;
    const lines = [
      "XODIMLARNI OMMAVIY IMPORT QILISH — YO'RIQNOMA",
      '',
      `1. Ma'lumotlarni "${SHEET_NAME}" varag'iga 2-qatordan boshlab kiriting (1-qator — sarlavha).`,
      "2. * bilan belgilangan ustunlar majburiy: Familiya, Ism, Tab raqami, Filial, Telefon, Email.",
      `3. Filial — "${BRANCHES_SHEET}" varag'idagi nomlardan birini tanlang (katakda dropdown bor).`,
      '4. Telefon: +998901234567 formatida (998901234567 yoki 901234567 ham qabul qilinadi).',
      "5. Sanalar: YYYY-MM-DD (masalan 1995-04-12) yoki KK.OO.YYYY (12.04.1995) formatida.",
      "6. Jins: Erkak yoki Ayol. Maosh turi: Oylik yoki Soatbay (bo'sh qolsa — Oylik).",
      "7. Maosh so'mda kiritiladi (masalan 3000000). Bo'sh qolsa — 0.",
      "8. Username bo'sh qolsa email asosida avtomatik yaratiladi.",
      "9. Parol bo'sh qolsa avtomatik yaratiladi va xodimning emailiga yuboriladi.",
      `10. Bir faylda ko'pi bilan ${MAX_ROWS} ta xodim import qilinadi.`,
      '',
      'NAMUNA QATOR:',
      "Familiya: Azizov | Ism: Aziz | Tab raqami: EMP-001 | Filial: (ro'yxatdan) | Telefon: +998901234567 | Email: aziz@example.com | Jins: Erkak | Maosh turi: Oylik | Maosh: 3000000",
    ];
    lines.forEach((text, i) => {
      const cell = guide.getCell(`A${i + 1}`);
      cell.value = text;
      if (i === 0) cell.font = { bold: true, size: 13 };
      cell.alignment = { wrapText: true };
    });

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // ---------- Import ----------

  async import(companyId: string, file: UploadedFile): Promise<ImportResult> {
    const isXlsx =
      file.mimetype === XLSX_MIME || file.filename?.toLowerCase().endsWith('.xlsx');
    if (!isXlsx) {
      throw AppException.validation('Faqat .xlsx (Excel) fayl qabul qilinadi');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw AppException.validation('Fayl ochilmadi — .xlsx formatida ekanini tekshiring');
    }
    const sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.worksheets[0];
    if (!sheet) throw AppException.validation('Faylda varaq topilmadi');
    if (sheet.rowCount > MAX_ROWS + 1) {
      throw AppException.validation(`Bir faylda ko'pi bilan ${MAX_ROWS} qator import qilinadi`);
    }

    const branches = await this.branchRepository.find({ where: { companyId } });
    const branchByName = new Map(branches.map((b) => [this.norm(b.name), b.id]));

    const errors: ImportRowError[] = [];
    const usedUsernames = new Set<string>();
    let total = 0;
    let created = 0;

    for (let r = 2; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (this.isEmptyRow(row)) continue;
      total++;
      try {
        const dto = await this.parseRow(row, branchByName, usedUsernames);
        await this.employeesService.create(companyId, dto);
        created++;
      } catch (err) {
        errors.push({
          row: r,
          message: err instanceof Error ? err.message : "Noma'lum xato",
        });
      }
    }

    if (total === 0) {
      throw AppException.validation(
        `Faylda ma'lumot topilmadi — "${SHEET_NAME}" varag'ini 2-qatordan boshlab to'ldiring`,
      );
    }

    return { total, created, failed: errors.length, errors };
  }

  // ---------- Qator parsing ----------

  private async parseRow(
    row: ExcelJS.Row,
    branchByName: Map<string, string>,
    usedUsernames: Set<string>,
  ): Promise<CreateEmployeeDto> {
    const text = (key: string) => this.cellText(row.getCell(COL[key]));

    const lastName = text('lastName');
    const firstName = text('firstName');
    const tabNumber = text('tabNumber');
    const branchName = text('branch');
    const email = text('email').toLowerCase();

    const missing: string[] = [];
    if (!lastName) missing.push('Familiya');
    if (!firstName) missing.push('Ism');
    if (!tabNumber) missing.push('Tab raqami');
    if (!branchName) missing.push('Filial');
    if (!text('phone')) missing.push('Telefon');
    if (!email) missing.push('Email');
    if (missing.length > 0) {
      throw AppException.validation(`Majburiy ustunlar to'ldirilmagan: ${missing.join(', ')}`);
    }

    const branchId = branchByName.get(this.norm(branchName));
    if (!branchId) {
      throw AppException.validation(
        `Filial topilmadi: "${branchName}" — "${BRANCHES_SHEET}" varag'idagi nomlardan foydalaning`,
      );
    }

    const phone = this.normalizePhone(text('phone'));
    if (!/^\+998\d{9}$/.test(phone)) {
      throw AppException.validation(`Telefon noto'g'ri: "${text('phone')}" (+998XXXXXXXXX kutilgan)`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw AppException.validation(`Email noto'g'ri: "${email}"`);
    }

    const password = text('password');
    if (password && password.length < 8) {
      throw AppException.validation("Parol kamida 8 belgidan iborat bo'lishi kerak");
    }

    let username = text('username').toLowerCase();
    if (username) {
      if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
        throw AppException.validation(
          `Username noto'g'ri: "${username}" (3-64 belgi, faqat lotin harf, raqam va . _ -)`,
        );
      }
    } else {
      username = await this.generateUsername(email, usedUsernames);
    }
    usedUsernames.add(username);

    const salaryAmountSom = this.parseNumber(text('salaryAmount'), "Maosh (so'm)");

    const dto = {
      firstName,
      lastName,
      middleName: text('middleName') || undefined,
      birthDate: this.parseDate(text('birthDate'), "Tug'ilgan sana"),
      gender: this.parseGender(text('gender')),
      position: text('position') || undefined,
      department: text('department') || undefined,
      tabNumber,
      branchId,
      hiredAt: this.parseDate(text('hiredAt'), 'Ishga olingan sana'),
      salaryType: this.parseSalaryType(text('salaryType')),
      salaryAmount: Math.round(salaryAmountSom * 100), // so'm → tiyin
      credentials: {
        username,
        email,
        phone,
        password: password || undefined,
      },
    };
    return dto as CreateEmployeeDto;
  }

  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      const obj = v as unknown as Record<string, unknown>;
      if (typeof obj.text === 'string') return obj.text.trim();
      if (Array.isArray(obj.richText)) {
        return obj.richText.map((t) => String((t as { text?: string }).text ?? '')).join('').trim();
      }
      if ('result' in obj && obj.result !== null && obj.result !== undefined) {
        return String(obj.result).trim();
      }
      return '';
    }
    return String(v).trim();
  }

  private isEmptyRow(row: ExcelJS.Row): boolean {
    for (let c = 1; c <= COLUMNS.length; c++) {
      if (this.cellText(row.getCell(c))) return false;
    }
    return true;
  }

  private norm(s: string): string {
    return s.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizePhone(raw: string): string {
    const digits = raw.replace(/[\s()\-.]/g, '');
    if (/^\d{9}$/.test(digits)) return `+998${digits}`;
    if (/^998\d{9}$/.test(digits)) return `+${digits}`;
    return digits;
  }

  private parseDate(raw: string, label: string): string | undefined {
    if (!raw) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    // KK.OO.YYYY yoki KK/OO/YYYY
    const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (m) {
      return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
    throw AppException.validation(`${label} formati noto'g'ri: "${raw}" (YYYY-MM-DD kutilgan)`);
  }

  private parseGender(raw: string): Gender | undefined {
    if (!raw) return undefined;
    const v = raw.trim().toLowerCase();
    if (['erkak', 'male', 'm', 'э', 'мужской'].includes(v)) return Gender.MALE;
    if (['ayol', 'female', 'f', 'женский'].includes(v)) return Gender.FEMALE;
    throw AppException.validation(`Jins noto'g'ri: "${raw}" (Erkak yoki Ayol kutilgan)`);
  }

  private parseSalaryType(raw: string): SalaryType {
    if (!raw) return SalaryType.FIXED;
    const v = raw.trim().toLowerCase();
    if (['oylik', 'fixed', 'belgilangan'].includes(v)) return SalaryType.FIXED;
    if (['soatbay', 'soatlik', 'hourly'].includes(v)) return SalaryType.HOURLY;
    throw AppException.validation(`Maosh turi noto'g'ri: "${raw}" (Oylik yoki Soatbay kutilgan)`);
  }

  private parseNumber(raw: string, label: string): number {
    if (!raw) return 0;
    const n = Number(raw.replace(/[\s,]/g, ''));
    if (!Number.isFinite(n) || n < 0) {
      throw AppException.validation(`${label} noto'g'ri: "${raw}" (musbat son kutilgan)`);
    }
    return n;
  }

  private async generateUsername(email: string, used: Set<string>): Promise<string> {
    let base = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (base.length < 3) base = `xodim.${base || 'user'}`;
    base = base.slice(0, 56);
    for (let i = 0; i < 100; i++) {
      const candidate = i === 0 ? base : `${base}${i}`;
      if (used.has(candidate)) continue;
      if (!(await this.userRepository.exists({ where: { username: candidate } }))) {
        return candidate;
      }
    }
    throw AppException.conflict(`Username avtomatik yaratib bo'lmadi (${email}) — qo'lda kiriting`);
  }
}
