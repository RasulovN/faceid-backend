import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../../entities/employee.entity';
import { Group } from '../../entities/group.entity';
import { TelegramContact } from '../../entities/telegram-contact.entity';
import { AttendanceEventType, PersonType } from '../../common/enums';

interface TgUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
    contact?: { phone_number: string; first_name?: string; user_id?: number };
    from?: { id: number; first_name?: string };
  };
}

/**
 * Ota-onalarga davomat xabarlari uchun Telegram bot (tashqi kutubxonasiz,
 * global fetch bilan long-polling). TELEGRAM_BOT_TOKEN berilmagan bo'lsa
 * modul jim o'chiq turadi — hech narsa yuborilmaydi va polling boshlanmaydi.
 *
 * Ulanish oqimi: ota-ona botga /start → "Raqamni yuborish" tugmasi (request_contact)
 * → telefon telegram_contacts'ga yoziladi → shu raqam employees.parentPhones bilan
 * mos kelgan o'quvchilarning check-in/kelmadi xabarlari shu chatga boradi.
 * Mini App (ota-ona kabineti): xabarlardagi web_app tugma + chat menyu tugmasi
 * TELEGRAM_WEBAPP_URL (default CLIENT_URL/parent) sahifasini ochadi.
 */
@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token: string;
  private running = false;
  private offset = 0;

  constructor(
    @InjectRepository(TelegramContact)
    private readonly contactRepository: Repository<TelegramContact>,
    @InjectRepository(Employee) private readonly employeeRepository: Repository<Employee>,
    private readonly config: ConfigService,
  ) {
    this.token = this.config.get<string>('TELEGRAM_BOT_TOKEN') ?? '';
  }

  get enabled(): boolean {
    return this.token.length > 0;
  }

  get botToken(): string {
    return this.token;
  }

  /** Ota-ona kabineti (Mini App) URL — faqat https bo'lsa tugma qo'shiladi */
  get webAppUrl(): string | null {
    const explicit = this.config.get<string>('TELEGRAM_WEBAPP_URL');
    const url = explicit || `${this.config.get<string>('CLIENT_URL') ?? ''}/parent`;
    return url.startsWith('https://') ? url : null;
  }

  onModuleInit(): void {
    if (!this.enabled || this.config.get('NODE_ENV') === 'test') return;
    this.running = true;
    void this.pollLoop();
    void this.setupMenuButton();
    this.logger.log('Telegram bot polling boshlandi');
  }

  /** Chat menyu tugmasi → Mini App (bir marta, best-effort) */
  private async setupMenuButton(): Promise<void> {
    const url = this.webAppUrl;
    if (!url) return;
    try {
      await this.api('setChatMenuButton', {
        menu_button: { type: 'web_app', text: '📊 Davomat', web_app: { url } },
      });
    } catch (err) {
      this.logger.warn(`setChatMenuButton xatosi: ${(err as Error).message}`);
    }
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  // ---------- Yuborish ----------

  /** Xabarni telefon raqamiga bog'langan chatga yuboradi (bog'lanmagan bo'lsa jim o'tadi) */
  async sendToPhone(phone: string | null | undefined, text: string): Promise<boolean> {
    if (!this.enabled) return false;
    const normalized = this.normalizePhone(phone);
    if (!normalized) return false;
    const contact = await this.contactRepository.findOne({ where: { phone: normalized } });
    if (!contact) return false;
    return this.sendMessage(contact.chatId, text);
  }

  /** Xabarni bir nechta telefonning har biriga yuboradi */
  private async sendToPhones(phones: string[] | null | undefined, text: string): Promise<void> {
    for (const phone of phones ?? []) {
      await this.sendToPhone(phone, text).catch(() => false);
    }
  }

  /** O'quvchi kioskdan o'tganda ota-ona(lar)ga xabar */
  async notifyStudentEvent(params: {
    student: Employee;
    group: Group | null;
    type: AttendanceEventType;
    timestamp: Date;
    minutesLate: number;
    companyName: string;
    timezone: string;
  }): Promise<void> {
    if (!this.enabled || (params.student.parentPhones ?? []).length === 0) return;
    const time = this.timeInTz(params.timestamp, params.timezone);
    const groupPart = params.group ? ` — «${params.group.name}»` : '';
    const text =
      params.type === AttendanceEventType.CHECK_IN
        ? params.minutesLate > 0
          ? `⏰ ${params.student.fullName} bugun ${time}da darsga ${params.minutesLate} daqiqa kechikib keldi${groupPart}\n🏫 ${params.companyName}`
          : `✅ ${params.student.fullName} bugun ${time}da darsga keldi${groupPart}\n🏫 ${params.companyName}`
        : `🚪 ${params.student.fullName} bugun ${time}da darsdan chiqdi${groupPart}\n🏫 ${params.companyName}`;
    await this.sendToPhones(params.student.parentPhones, text);
  }

  /** Dars boshlanib absentAfterMinutes o'tgach kelmagan o'quvchi haqida xabar */
  async notifyStudentAbsent(params: {
    student: Employee;
    group: Group;
    startTime: string;
    companyName: string;
  }): Promise<void> {
    if (!this.enabled || (params.student.parentPhones ?? []).length === 0) return;
    const text = `❗ ${params.student.fullName} bugun «${params.group.name}» darsiga hali kelmadi (dars ${params.startTime}da boshlangan)\n🏫 ${params.companyName}`;
    await this.sendToPhones(params.student.parentPhones, text);
  }

  // ---------- Polling ----------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.api<TgUpdate[]>('getUpdates', {
          offset: this.offset,
          timeout: 25,
          allowed_updates: ['message'],
        });
        for (const update of updates ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handleUpdate(update).catch((err) =>
            this.logger.warn(`Update qayta ishlashda xato: ${(err as Error).message}`),
          );
        }
      } catch (err) {
        if (!this.running) return;
        this.logger.warn(`getUpdates xatosi: ${(err as Error).message} — 5s dan keyin qayta`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private async handleUpdate(update: TgUpdate): Promise<void> {
    const msg = update.message;
    if (!msg) return;
    const chatId = String(msg.chat.id);

    if (msg.contact) {
      const phone = this.normalizePhone(msg.contact.phone_number);
      if (!phone) {
        await this.sendMessage(chatId, 'Kechirasiz, faqat O‘zbekiston (+998) raqamlari qo‘llab-quvvatlanadi.');
        return;
      }
      const existing = await this.contactRepository.findOne({ where: { phone } });
      if (existing) {
        existing.chatId = chatId;
        existing.firstName = msg.contact.first_name ?? existing.firstName;
        await this.contactRepository.save(existing);
      } else {
        await this.contactRepository.save(
          this.contactRepository.create({
            phone,
            chatId,
            firstName: msg.contact.first_name ?? null,
          }),
        );
      }
      const students = await this.findStudentsByPhone(phone);
      const text =
        students.length > 0
          ? `✅ Raqamingiz ulandi!\n\nQuyidagi o‘quvchi(lar)ning davomat xabarlari shu yerga keladi:\n${students
              .map((s) => `• ${[s.lastName, s.firstName].filter(Boolean).join(' ')}`)
              .join('\n')}`
          : '✅ Raqamingiz ulandi. Bu raqamga biriktirilgan o‘quvchi hozircha topilmadi — o‘quv markazi ma’lumotlaringizni kiritgach xabarlar kela boshlaydi.';
      await this.sendMessage(chatId, text, { remove_keyboard: true });
      // Mini App tugmasi — davomat statistikasi kabineti
      const url = this.webAppUrl;
      if (url && students.length > 0) {
        await this.sendMessage(
          chatId,
          '📊 Farzandingizning to‘liq davomat statistikasi (qaysi kunlari kelgan/kelmagani) — quyidagi tugma orqali:',
          undefined,
          { inline_keyboard: [[{ text: '📊 Davomat statistikasi', web_app: { url } }]] },
        );
      }
      return;
    }

    // /start yoki boshqa istalgan matn — kontakt so'raymiz
    await this.sendMessage(
      chatId,
      'Assalomu alaykum! Bu — FaceID davomat boti.\n\nFarzandingiz darsga kelgan-kelmagani haqida xabar olish uchun telefon raqamingizni yuboring 👇',
      {
        keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    );
  }

  // ---------- Past darajali yordamchilar ----------

  /** Telefon raqami parentPhones massivida bo'lgan o'quvchilar (jsonb containment, GIN index) */
  async findStudentsByPhone(phone: string): Promise<Employee[]> {
    return this.employeeRepository
      .createQueryBuilder('e')
      .where(`e."parentPhones" @> :phone::jsonb`, { phone: JSON.stringify([phone]) })
      .andWhere('e."personType" = :pt', { pt: PersonType.STUDENT })
      .andWhere('e."deletedAt" IS NULL')
      .getMany();
  }

  /** chatId bo'yicha ulangan telefon(lar) — Mini App kim ekanini shu orqali aniqlaydi */
  async findContactsByChatId(chatId: string): Promise<TelegramContact[]> {
    return this.contactRepository.find({ where: { chatId } });
  }

  private async sendMessage(
    chatId: string,
    text: string,
    replyMarkup?: Record<string, unknown>,
    inlineKeyboard?: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const markup = inlineKeyboard ?? replyMarkup;
      await this.api('sendMessage', {
        chat_id: Number(chatId),
        text,
        ...(markup ? { reply_markup: markup } : {}),
      });
      return true;
    } catch (err) {
      this.logger.warn(`sendMessage xatosi (chat ${chatId}): ${(err as Error).message}`);
      return false;
    }
  }

  private async api<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
      if (!json.ok) throw new Error(json.description ?? `Telegram API: ${res.status}`);
      return json.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** '998901234567' / '+998 90 123-45-67' / '901234567' → '+998901234567' */
  private normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
    if (digits.length === 9) return `+998${digits}`;
    return null;
  }

  private timeInTz(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }
}
