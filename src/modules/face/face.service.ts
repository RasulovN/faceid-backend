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
  /** null — face-service liveness'ni tekshirmagan (engine yo'q/o'chirilgan) */
  livenessScore?: number | null;
  reason?: 'FACE_NOT_RECOGNIZED' | 'FACE_NOT_FOUND' | 'LIVENESS_FAILED';
}

export interface VerifyResult {
  match: boolean;
  confidence: number;
  livenessScore: number;
  livenessPassed: boolean;
  /** Face-service xato kodi: FACE_NOT_FOUND / LIVENESS_FAILED / INVALID_IMAGE */
  errorCode?: string;
}

export interface AnalyzeResult {
  found: boolean;
  multiple: boolean;
  /** Normalized bbox (kadr o'lchamiga nisbatan 0..1) */
  x: number;
  y: number;
  width: number;
  height: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  /** Eye aspect ratio — blink (jonlilik) dalili uchun */
  ear: number | null;
  detScore: number;
  /** Yuz hududi o'rtacha yorqinligi 0..255 */
  brightness: number | null;
  /** Laplacian keskinligi (xiralik nazorati) */
  sharpness: number | null;
  /** Shu kadrning passiv anti-spoof skori (0..1) */
  livenessScore: number | null;
  /** 106 ta normalized [x,y] landmark — mesh rendering uchun */
  landmarks: number[][] | null;
  /** Kadrga amalda qo'llangan rotatsiya (kalibrlash natijasi, gradus) */
  rotationApplied: number;
  frameWidth: number;
  frameHeight: number;
  errorCode?: string;
}

export interface VerifyLiveResult {
  /** Yakuniy qaror: identity mos VA liveness o'tdi VA challenge bajarildi */
  match: boolean;
  confidence: number;
  livenessScore: number;
  livenessPassed: boolean;
  challengePassed: boolean;
  /** Kadrlararo "bir odam" izchilligi (0..1) */
  consistency: number;
  framesValid: number;
  framesTotal: number;
  /** FACE_NOT_FOUND / LIVENESS_FAILED / CHALLENGE_FAILED / FACE_NOT_RECOGNIZED */
  errorCode?: string;
  reasons: string[];
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
      liveness_score?: number | null;
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
      livenessScore: res.liveness_score ?? null,
      reason,
    };
  }

  /**
   * 1:1 verifikatsiya — xodimning mavjud embeddinglariga qarshi.
   * Face-service liveness o'tmagan yuzga HECH QACHON match=true qaytarmaydi;
   * error kodi (FACE_NOT_FOUND/LIVENESS_FAILED) chaqiruvchiga surface qilinadi.
   */
  async verify(image: Buffer, embeddings: number[][]): Promise<VerifyResult> {
    const res = await this.postJson<{
      match: boolean;
      similarity?: number;
      liveness_score?: number;
      liveness_passed?: boolean;
      error?: string | null;
    }>('/verify', {
      image_b64: image.toString('base64'),
      embeddings,
      check_liveness: true,
    });
    return {
      match: res.match,
      confidence: res.similarity ?? 0,
      livenessScore: res.liveness_score ?? 0,
      livenessPassed: res.liveness_passed ?? false,
      errorCode: res.error ?? undefined,
    };
  }

  /**
   * Bitta kadrni TEZKOR tahlil qilish (real-time WS oqimi): yuz bor-yo'qligi,
   * normalized bbox, yaw, EAR. Identifikatsiya QILINMAYDI — bu faqat jonlilik
   * darvozasi va yuz kvadratini chizish uchun.
   */
  async analyze(
    image: Buffer,
    opts: { rotation?: number; tryRotations?: boolean; checkLiveness?: boolean } = {},
  ): Promise<AnalyzeResult> {
    const res = await this.postJson<{
      found: boolean;
      multiple?: boolean;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      yaw?: number | null;
      pitch?: number | null;
      roll?: number | null;
      ear?: number | null;
      det_score?: number;
      brightness?: number | null;
      sharpness?: number | null;
      liveness_score?: number | null;
      landmarks?: number[][] | null;
      rotation_applied?: number;
      frame_width?: number;
      frame_height?: number;
      error?: string | null;
    }>('/analyze', {
      image_b64: image.toString('base64'),
      check_liveness: opts.checkLiveness ?? true,
      rotation: opts.rotation ?? 0,
      try_rotations: opts.tryRotations ?? false,
    });
    return {
      found: res.found,
      multiple: res.multiple ?? false,
      x: res.x ?? 0,
      y: res.y ?? 0,
      width: res.width ?? 0,
      height: res.height ?? 0,
      yaw: res.yaw ?? null,
      pitch: res.pitch ?? null,
      roll: res.roll ?? null,
      ear: res.ear ?? null,
      detScore: res.det_score ?? 0,
      brightness: res.brightness ?? null,
      sharpness: res.sharpness ?? null,
      livenessScore: res.liveness_score ?? null,
      landmarks: res.landmarks ?? null,
      rotationApplied: res.rotation_applied ?? 0,
      frameWidth: res.frame_width ?? 0,
      frameHeight: res.frame_height ?? 0,
      errorCode: res.error ?? undefined,
    };
  }

  /**
   * Ko'p kadrli (burst) verifikatsiya — haqiqiy jonlilik tekshiruvi:
   * passiv anti-spoof ansambl + kadrlararo izchillik + bosh burilishi/blink
   * challenge. Statik rasm/ekran bu zanjirdan o'tolmaydi.
   */
  async verifyLive(
    frames: Buffer[],
    embeddings: number[][],
    challenge: 'turn' | 'none' = 'turn',
    rotation = 0,
  ): Promise<VerifyLiveResult> {
    const form = new FormData();
    frames.forEach((frame, i) => {
      form.append(
        'frames',
        new Blob([new Uint8Array(frame)], { type: 'image/jpeg' }),
        `frame${i}.jpg`,
      );
    });
    form.append('embeddings', JSON.stringify(embeddings));
    form.append('challenge', challenge);
    form.append('rotation', String(rotation));
    const res = await this.request<{
      match: boolean;
      similarity?: number;
      liveness_score?: number;
      liveness_passed?: boolean;
      challenge_passed?: boolean;
      consistency?: number;
      frames_total?: number;
      frames_valid?: number;
      error?: string | null;
      reasons?: string[];
    }>('/verify-live', { method: 'POST', body: form });
    return {
      match: res.match,
      confidence: res.similarity ?? 0,
      livenessScore: res.liveness_score ?? 0,
      livenessPassed: res.liveness_passed ?? false,
      challengePassed: res.challenge_passed ?? false,
      consistency: res.consistency ?? 0,
      framesValid: res.frames_valid ?? 0,
      framesTotal: res.frames_total ?? 0,
      errorCode: res.error ?? undefined,
      reasons: res.reasons ?? [],
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
