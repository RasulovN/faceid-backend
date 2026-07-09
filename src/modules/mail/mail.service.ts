import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  employeeCredentialsTemplate,
  leadApprovedTemplate,
  leadRejectedTemplate,
  passwordResetTemplate,
  paymentRevokedTemplate,
  paymentSuccessTemplate,
  subscriptionCancelledTemplate,
  subscriptionExpiringTemplate,
  subscriptionExtendedTemplate,
  verificationEmailTemplate,
} from './mail.templates';

/** tiyin → "1 250 000 so'm" (email uchun) */
function formatSom(tiyin: number): string {
  return `${Math.round(tiyin / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>('SMTP_HOST'),
      port: this.config.getOrThrow<number>('SMTP_PORT'),
      secure: String(this.config.get('SMTP_SECURE')) === 'true',
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.getOrThrow<string>('SMTP_FROM'),
        to,
        subject,
        html,
      });
      this.logger.log(`Email yuborildi: "${subject}" → ${to}`);
    } catch (err) {
      // Email xatosi asosiy oqimni to'xtatmasligi kerak
      this.logger.error(`Email yuborishda xato (${to}): ${(err as Error).message}`);
    }
  }

  /**
   * Dev rejimda (NODE_ENV=development) muhim havolani konsolga chiqaradi —
   * SMTP sozlanmagan yoki manzil soxta bo'lsa ham oqimni sinash mumkin bo'lsin.
   * Production'da hech narsa loglanmaydi (token oshkor bo'lmaydi).
   */
  private logDevLink(label: string, to: string, url: string): void {
    if (this.config.get<string>('NODE_ENV') === 'development') {
      this.logger.warn(`[DEV] ${label} (${to}): ${url}`);
    }
  }

  async sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
    const url = `${this.config.getOrThrow<string>('CLIENT_URL')}/verify-email?token=${token}`;
    this.logDevLink('Email tasdiqlash havolasi', to, url);
    await this.send(to, 'FaceID — Email manzilingizni tasdiqlang', verificationEmailTemplate(name, url));
  }

  async sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
    const url = `${this.config.getOrThrow<string>('CLIENT_URL')}/reset-password?token=${token}`;
    this.logDevLink('Parolni tiklash havolasi', to, url);
    await this.send(to, 'FaceID — Parolni tiklash', passwordResetTemplate(name, url));
  }

  async sendEmployeeCredentials(
    to: string,
    name: string,
    companyName: string,
    username: string,
    password: string,
  ): Promise<void> {
    const loginUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/login`;
    await this.send(
      to,
      'FaceID — Tizimga kirish ma’lumotlaringiz',
      employeeCredentialsTemplate(name, companyName, username, password, loginUrl),
    );
  }

  async sendSubscriptionExpiring(
    to: string,
    companyName: string,
    daysLeft: number,
    endsAt: Date,
  ): Promise<void> {
    const payUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/app/subscription`;
    await this.send(
      to,
      `FaceID — Obuna tugashiga ${daysLeft} kun qoldi`,
      subscriptionExpiringTemplate(companyName, daysLeft, endsAt.toISOString().slice(0, 10), payUrl),
    );
  }

  /** To'lov muvaffaqiyatli bajarilganda — chek havolasi bilan tasdiq xati */
  async sendPaymentSuccess(
    to: string,
    companyName: string,
    amountTiyin: number,
    tariffName: string,
    months: number,
  ): Promise<void> {
    const receiptUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/app/subscription`;
    await this.send(
      to,
      `FaceID — To'lov qabul qilindi (${formatSom(amountTiyin)})`,
      paymentSuccessTemplate(companyName, formatSom(amountTiyin), tariffName, months, receiptUrl),
    );
  }

  /** To'lov Payme tomonidan qaytarilganda (cancel-after-perform) */
  async sendPaymentRevoked(
    to: string,
    companyName: string,
    amountTiyin: number,
    tariffName: string,
  ): Promise<void> {
    const payUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/app/subscription`;
    await this.send(
      to,
      `FaceID — To'lov qaytarildi (${formatSom(amountTiyin)})`,
      paymentRevokedTemplate(companyName, formatSom(amountTiyin), tariffName, payUrl),
    );
  }

  /** Admin obunani qo'lda uzaytirganda */
  async sendSubscriptionExtended(
    to: string,
    companyName: string,
    tariffName: string,
    endsAt: Date,
  ): Promise<void> {
    const panelUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/app/subscription`;
    await this.send(
      to,
      'FaceID — Obunangiz uzaytirildi',
      subscriptionExtendedTemplate(
        companyName,
        tariffName,
        endsAt.toISOString().slice(0, 10),
        panelUrl,
      ),
    );
  }

  /** Admin obunani qo'lda bekor qilganda */
  async sendSubscriptionCancelled(
    to: string,
    companyName: string,
    tariffName: string,
  ): Promise<void> {
    const payUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/app/subscription`;
    await this.send(
      to,
      'FaceID — Obuna bekor qilindi',
      subscriptionCancelledTemplate(companyName, tariffName, payUrl),
    );
  }

  /** Landing murojaati (lead) tasdiqlanganda — rasmiy tasdiq xati */
  async sendLeadApproved(to: string, name: string): Promise<void> {
    const registerUrl = `${this.config.getOrThrow<string>('CLIENT_URL')}/register`;
    await this.send(to, 'FaceID — Murojaatingiz tasdiqlandi', leadApprovedTemplate(name, registerUrl));
  }

  /** Landing murojaati (lead) rad etilganda — muloyim rad xati */
  async sendLeadRejected(to: string, name: string): Promise<void> {
    await this.send(to, 'FaceID — Murojaatingiz bo‘yicha javob', leadRejectedTemplate(name));
  }
}
