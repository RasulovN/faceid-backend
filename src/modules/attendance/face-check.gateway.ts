import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Employee } from '../../entities/employee.entity';
import { FaceEmbedding } from '../../entities/face-embedding.entity';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCodes } from '../../common/constants/error-codes';
import { AttendanceEventType } from '../../common/enums';
import { FaceService } from '../face/face.service';
import { AttendanceService } from './attendance.service';
import { ServerFaceGate, type ServerGateTrigger } from './face-gate';

/** WS orqali keladigan bitta kadr uchun maksimal hajm (base64'dan keyin). */
const MAX_FRAME_BYTES = 1_500_000;
/** Bufferda saqlanadigan yuzli kadrlar soni (verifikatsiya uchun tanlov). */
const FRAME_BUFFER_SIZE = 8;
/** Bitta sessiyada maksimal verifikatsiya urinishlari. */
const MAX_VERIFY_ATTEMPTS = 8;
/** Sessiya TTL — shu vaqtdan keyin avtomatik yakunlanadi. */
const SESSION_TTL_MS = 120_000;

interface BufferedFrame {
  data: Buffer;
  ear: number | null;
  yaw: number | null;
  detScore: number;
  timestamp: number;
}

interface FaceCheckSession {
  userId: string;
  employee: Employee;
  embeddings: FaceEmbedding[];
  type: AttendanceEventType;
  latitude: number;
  longitude: number;
  gate: ServerFaceGate;
  buffer: BufferedFrame[];
  verifying: boolean;
  /** Bir vaqtда faqat bitta /analyze — pipelined klient kadrlari tashlanadi */
  analyzing: boolean;
  /** Kadr rotatsiyasi (skipProcessing kalibrlash): null — hali aniqlanmagan */
  rotation: number | null;
  /** Qabul qilingan kadrlar hisobi — anti-spoof har 2-kadrda (tezlik) */
  frameCount: number;
  attempts: number;
  ttlTimer: NodeJS.Timeout;
}

interface StartBody {
  type?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  isMockLocation?: boolean;
}

interface StartAck {
  ok: boolean;
  code?: string;
  message?: string;
  details?: unknown;
}

interface FrameAck {
  state: string;
  box?: { x: number; y: number; width: number; height: number } | null;
  /** 106 ta normalized [x,y] landmark — real-time mesh rendering */
  landmarks?: number[][] | null;
  /** Bosh og'ishi (gradus) — klient kvadratni shu bilan aylantiradi */
  roll?: number | null;
  frameWidth?: number;
  frameHeight?: number;
  multiple?: boolean;
  quality?: { brightness: number | null; sharpness: number | null };
  liveness?: { progress: number; passiveOk: boolean };
  /** Server tomonda kadrga ketgan vaqt (ms) — HUD latency ko'rsatkichi */
  processingMs?: number;
}

/**
 * Mobil REAL-TIME yuz tekshiruvi gateway'i (socket.io, path: /ws — mavjud
 * EventsGateway bilan bitta server; u handshake'da JWT'ni tekshirib
 * client.data.userId ni o'rnatadi).
 *
 * Protokol:
 *  - `face:start` {type, latitude, longitude, isMockLocation} → ack {ok|code}
 *    (geofence/mock/subscription/embeddings/debounce shu yerda tekshiriladi)
 *  - `face:frame` {image: base64} → ack {state, box, frameWidth, frameHeight}
 *    Har kadr face-service /analyze'dan o'tadi; klient kvadratni shu bbox'dan
 *    chizadi. Jonlilik darvozasi (blink/burilish) trigger bo'lganda state
 *    'verifying' bo'ladi va yakun `face:result` eventida keladi.
 *  - `face:result` {ok, event?} yoki {ok:false, code, message} — muvaffaqiyat
 *    yoki xato; transient xatolarda sessiya davom etadi (klient qaror qiladi).
 *  - `face:stop` → sessiya tozalanadi.
 *
 * MUHIM: verifikatsiya faqat darvoza jonlilik dalilini ko'rgandagina ishlaydi —
 * kamera oldida odam bo'lmasa yoki statik rasm ko'rsatilsa faqat engil
 * /analyze chaqiruvlari bo'ladi, DB/identifikatsiya UMUMAN ishlamaydi.
 */
@WebSocketGateway({
  path: '/ws',
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 6_000_000,
})
export class FaceCheckGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(FaceCheckGateway.name);
  private readonly sessions = new Map<string, FaceCheckSession>();

  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly faceService: FaceService,
  ) {}

  handleDisconnect(client: Socket): void {
    this.destroySession(client.id);
  }

  @SubscribeMessage('face:start')
  async start(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: StartBody,
  ): Promise<StartAck> {
    const data = client.data as { userId?: string } | undefined;
    if (!data?.userId) {
      return { ok: false, code: ErrorCodes.UNAUTHORIZED, message: 'Avtorizatsiya talab qilinadi' };
    }
    const type =
      body?.type === AttendanceEventType.CHECK_OUT
        ? AttendanceEventType.CHECK_OUT
        : AttendanceEventType.CHECK_IN;
    const latitude = Number(body?.latitude);
    const longitude = Number(body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        ok: false,
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'latitude/longitude noto‘g‘ri',
      };
    }

    // Bitta socket — bitta sessiya
    this.destroySession(client.id);

    try {
      const { employee, embeddings } = await this.attendanceService.prepareMobileSession(
        data.userId,
        {
          latitude,
          longitude,
          isMockLocation: body?.isMockLocation === true,
        },
      );
      // Debounce'ni boshidayoq bildirish — foydalanuvchi bekorga skanerlamasin
      if (await this.attendanceService.isDebounced(employee.id)) {
        return {
          ok: false,
          code: ErrorCodes.DEBOUNCE,
          message: 'Yaqinda davomat qayd etilgan. Biroz kuting.',
        };
      }

      const session: FaceCheckSession = {
        userId: data.userId,
        employee,
        embeddings,
        type,
        latitude,
        longitude,
        gate: new ServerFaceGate(),
        buffer: [],
        verifying: false,
        analyzing: false,
        rotation: null,
        frameCount: 0,
        attempts: 0,
        ttlTimer: setTimeout(() => {
          client.emit('face:result', {
            ok: false,
            code: ErrorCodes.TOO_MANY_REQUESTS,
            message: 'Sessiya vaqti tugadi. Qayta urinib ko‘ring.',
            terminal: true,
          });
          this.destroySession(client.id);
        }, SESSION_TTL_MS),
      };
      this.sessions.set(client.id, session);
      return { ok: true };
    } catch (err) {
      if (err instanceof AppException) {
        return { ok: false, code: err.code, message: err.message, details: err.details };
      }
      this.logger.error(`face:start xatosi: ${(err as Error).message}`);
      return { ok: false, code: ErrorCodes.INTERNAL_ERROR, message: 'Ichki xatolik' };
    }
  }

  @SubscribeMessage('face:frame')
  async frame(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { image?: string },
  ): Promise<FrameAck> {
    const session = this.sessions.get(client.id);
    if (!session) return { state: 'no_session' };
    if (session.verifying) return { state: 'verifying' };
    // Pipelined klient: oldingi kadr hali tahlilda — bu kadrni tashlaymiz
    // (gate tartibi buzilmasin), klient 'skipped'ni e'tiborsiz qoldiradi.
    if (session.analyzing) return { state: 'skipped' };
    if (!body?.image) return { state: 'no_face', box: null };

    let image: Buffer;
    try {
      image = Buffer.from(body.image, 'base64');
    } catch {
      return { state: 'no_face', box: null };
    }
    if (image.length === 0 || image.length > MAX_FRAME_BYTES) {
      return { state: 'no_face', box: null };
    }

    const startedAt = Date.now();
    let analysis;
    session.analyzing = true;
    try {
      // Birinchi yuzli kadrgacha rotatsiya kalibrlanadi (try_rotations),
      // keyin topilgan qiymat har kadrga qo'llanadi (skipProcessing kadrlari).
      // Anti-spoof (MiniFASNet ansambl) HAR IKKINCHI kadrda — javob ~2x tez;
      // gate passiv o'rtachani baribir bir necha kadr bo'yicha yig'adi.
      session.frameCount += 1;
      analysis = await this.faceService.analyze(image, {
        rotation: session.rotation ?? 0,
        tryRotations: session.rotation === null,
        checkLiveness: session.frameCount % 2 === 1,
      });
      if (session.rotation === null && analysis.found) {
        session.rotation = analysis.rotationApplied;
      }
    } catch {
      // face-service vaqtincha ishlamayapti — klientga neytral holat
      return { state: 'no_face', box: null };
    } finally {
      session.analyzing = false;
    }

    // Yuzli kadrlarni verifikatsiya uchun buferda saqlaymiz
    if (analysis.found) {
      session.buffer.push({
        data: image,
        ear: analysis.ear,
        yaw: analysis.yaw,
        detScore: analysis.detScore,
        timestamp: Date.now(),
      });
      if (session.buffer.length > FRAME_BUFFER_SIZE) session.buffer.shift();
    }

    const result = session.gate.push({
      present: analysis.found,
      multiple: analysis.multiple,
      centerX: analysis.x + analysis.width / 2,
      centerY: analysis.y + analysis.height / 2,
      widthRatio: analysis.width,
      yaw: analysis.yaw,
      pitch: analysis.pitch,
      roll: analysis.roll,
      ear: analysis.ear,
      brightness: analysis.brightness,
      livenessScore: analysis.livenessScore,
      timestamp: Date.now(),
    });

    const box = analysis.found
      ? { x: analysis.x, y: analysis.y, width: analysis.width, height: analysis.height }
      : null;
    const enriched: Omit<FrameAck, 'state'> = {
      box,
      landmarks: analysis.landmarks,
      roll: analysis.roll,
      frameWidth: analysis.frameWidth,
      frameHeight: analysis.frameHeight,
      multiple: analysis.multiple,
      quality: { brightness: analysis.brightness, sharpness: analysis.sharpness },
      liveness: {
        progress: Math.min(1, result.evidencePoints / result.evidenceRequired),
        passiveOk: result.passiveMean === null || result.passiveMean >= 0.45,
      },
      processingMs: Date.now() - startedAt,
    };

    if (result.status === 'triggered') {
      session.verifying = true;
      void this.runVerification(client, session, result.trigger);
      return { state: 'verifying', ...enriched };
    }

    return { state: result.status, ...enriched };
  }

  @SubscribeMessage('face:stop')
  stop(@ConnectedSocket() client: Socket): { ok: boolean } {
    this.destroySession(client.id);
    return { ok: true };
  }

  /**
   * Darvoza trigger bo'lgach: buferdan eng ma'lumotli kadrlarni tanlab
   * to'liq verifikatsiya (identity + passiv anti-spoof + challenge dalili) va
   * muvaffaqiyatda davomat eventini yaratish. Natija 'face:result' bilan.
   */
  private async runVerification(
    client: Socket,
    session: FaceCheckSession,
    trigger: ServerGateTrigger,
  ): Promise<void> {
    session.attempts += 1;
    try {
      const frames = this.selectFrames(session.buffer, trigger);
      if (frames.length < 3) {
        throw new AppException(
          ErrorCodes.FACE_NOT_DETECTED,
          'Kadrlar yetarli emas. Yuzingizni ramkada tuting.',
          422,
        );
      }
      const result = await this.attendanceService.verifyAndFinalize(
        session.userId,
        session.employee,
        frames,
        session.embeddings,
        { latitude: session.latitude, longitude: session.longitude, type: session.type },
        session.rotation ?? 0,
      );
      client.emit('face:result', {
        ok: true,
        event: {
          id: result.event.id,
          type: result.event.type,
          timestamp: result.event.timestamp,
        },
      });
      this.destroySession(client.id);
    } catch (err) {
      const isApp = err instanceof AppException;
      const code = isApp ? err.code : ErrorCodes.INTERNAL_ERROR;
      if (!isApp) {
        this.logger.error(`face:verify xatosi: ${(err as Error).message}`);
      }
      const terminal = session.attempts >= MAX_VERIFY_ATTEMPTS;
      client.emit('face:result', {
        ok: false,
        code,
        message: isApp ? err.message : 'Ichki xatolik',
        details: isApp ? err.details : undefined,
        terminal,
      });
      if (terminal) {
        this.destroySession(client.id);
        return;
      }
      // Sessiya davom etadi: darvoza qayta qurollanadi, keyingi blink → yangi urinish
      session.buffer = [];
      session.gate.reset();
      session.verifying = false;
    }
  }

  /**
   * Buferdan verifikatsiya uchun kadrlar tanlovi:
   * blink triggerida ENG YOPIQ ko'zli kadr majburiy kiradi (serverdagi EAR
   * blink dalili), qolganlari eng yuqori det_score bo'yicha — jami 4 tagacha,
   * xronologik tartibda.
   */
  private selectFrames(buffer: BufferedFrame[], trigger: ServerGateTrigger): Buffer[] {
    if (buffer.length === 0) return [];
    const chosen = new Set<BufferedFrame>();

    if (trigger === 'blink') {
      const withEar = buffer.filter((f) => f.ear !== null);
      if (withEar.length > 0) {
        chosen.add(withEar.reduce((min, f) => ((f.ear as number) < (min.ear as number) ? f : min)));
      }
      // Ochiq-ko'z dalili uchun eng katta EAR'li kadr ham kiritiladi
      if (withEar.length > 1) {
        chosen.add(withEar.reduce((max, f) => ((f.ear as number) > (max.ear as number) ? f : max)));
      }
    }

    const bySharpness = [...buffer].sort((a, b) => b.detScore - a.detScore);
    for (const frame of bySharpness) {
      if (chosen.size >= 4) break;
      chosen.add(frame);
    }

    return [...chosen]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((f) => f.data);
  }

  private destroySession(clientId: string): void {
    const session = this.sessions.get(clientId);
    if (!session) return;
    clearTimeout(session.ttlTimer);
    this.sessions.delete(clientId);
  }
}
