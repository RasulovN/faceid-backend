import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/constants/error-codes';

export interface ExtractResult {
  ok: boolean;
  embedding?: number[];
  quality?: number;
  errorCode?: 'FACE_NOT_FOUND' | 'FACE_MULTIPLE' | 'FACE_LOW_QUALITY';
}

export interface IdentifyResult {
  matched: boolean;
  employeeId?: string;
  confidence?: number;
  livenessScore?: number;
  reason?: 'FACE_NOT_RECOGNIZED' | 'FACE_NOT_FOUND' | 'LIVENESS_FAILED';
}

export interface VerifyResult {
  match: boolean;
  confidence: number;
  livenessScore: number;
}

/** Python face-service mikroservisi bilan ichki HTTP klient */
@Injectable()
export class FaceService {
  private readonly logger = new Logger(FaceService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.getOrThrow<string>('FACE_SERVICE_URL').replace(/\/$/, '');
    this.apiKey = this.config.getOrThrow<string>('INTERNAL_API_KEY');
  }

  /** Face-service javobini xom holda oladi (envelope YO'Q — u to'g'ridan-to'g'ri JSON) */
  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'X-Internal-Api-Key': this.apiKey, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.error(`Face-service so‘rovi muvaffaqiyatsiz (${path}): ${(err as Error).message}`);
      throw new AppException(
        ErrorCodes.FACE_SERVICE_UNAVAILABLE,
        'Yuzni tanish servisi vaqtincha ishlamayapti',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.error(`Face-service ${path} → HTTP ${response.status}: ${text}`);
      throw new AppException(
        ErrorCodes.FACE_SERVICE_UNAVAILABLE,
        'Yuzni tanish servisi xato qaytardi',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return (await response.json()) as T;
  }

  private postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * Rasmdan 512 o'lchamli embedding chiqarish.
   * Face-service `/extract` MULTIPART `images` kutadi va `{results:[{ok,embedding,quality,error}]}`
   * qaytaradi — bittalik natijaga map qilamiz.
   */
  async extract(image: Buffer): Promise<ExtractResult> {
    const form = new FormData();
    form.append('images', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'photo.jpg');
    const res = await this.request<{
      results: { ok: boolean; embedding?: number[]; quality?: number; error?: string | null }[];
    }>('/extract', { method: 'POST', body: form });
    const item = res.results?.[0];
    if (!item) return { ok: false, errorCode: 'FACE_NOT_FOUND' };
    return {
      ok: item.ok,
      embedding: item.embedding,
      quality: item.quality,
      errorCode: (item.error as ExtractResult['errorCode']) ?? undefined,
    };
  }

  /**
   * 1:N identifikatsiya — kompaniya (va berilsa FILIAL) scope'ida pgvector orqali.
   * branchId berilsa faqat shu filial xodimlari nomzod bo'ladi.
   */
  async identify(image: Buffer, companyId: string, branchId?: string | null): Promise<IdentifyResult> {
    const res = await this.postJson<{
      found: boolean;
      employee_id?: string | null;
      similarity?: number;
      liveness_score?: number;
      liveness_passed?: boolean;
      error?: string | null;
    }>('/identify', {
      image_b64: image.toString('base64'),
      company_id: companyId,
      branch_id: branchId ?? null,
      check_liveness: true,
    });
    let reason: IdentifyResult['reason'] | undefined;
    if (!res.found) {
      reason =
        res.error === 'FACE_NOT_FOUND'
          ? 'FACE_NOT_FOUND'
          : res.liveness_passed === false
            ? 'LIVENESS_FAILED'
            : 'FACE_NOT_RECOGNIZED';
    }
    return {
      matched: res.found,
      employeeId: res.employee_id ?? undefined,
      confidence: res.similarity,
      livenessScore: res.liveness_score,
      reason,
    };
  }

  /** 1:1 verifikatsiya — xodimning mavjud embeddinglariga qarshi */
  async verify(image: Buffer, embeddings: number[][]): Promise<VerifyResult> {
    const res = await this.postJson<{
      match: boolean;
      similarity?: number;
      liveness_score?: number;
      liveness_passed?: boolean;
    }>('/verify', {
      image_b64: image.toString('base64'),
      embeddings,
      check_liveness: true,
    });
    return {
      match: res.match,
      confidence: res.similarity ?? 0,
      livenessScore: res.liveness_score ?? 0,
    };
  }

  /** Health check — /health */
  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
