/**
 * ServerFaceGate — WS oqimidagi kadrlar uchun KO'P-SIGNALLI jonlilik darvozasi
 * (sof mantiq, professional Face ID pipeline'iga mos).
 *
 * Har kadr face-service `/analyze` dan o'tib {bbox, poza, EAR, sifat, passiv
 * anti-spoof skori} qaytaradi. Darvoza qatlamlari:
 *
 *  1. SIFAT: yorug'lik yetarli, poza normal (|pitch|/|roll| chegarada),
 *     bitta yuz, yetarli o'lcham, markazda — aks holda kontekstga mos holat.
 *  2. BARQARORLIK: yuz kamida N kadr / T ms kuzatilgan bo'lishi kerak.
 *  3. DALIL YIG'ISH (bitta signalga ISHONILMAYDI, ballar yig'iladi):
 *       blink (EAR yuqori→past)            = 2 ball
 *       bosh burilishi (yaw diapazoni)     = 2 ball
 *       tabiiy mikro-harakat (markaz drift) = 1 ball
 *     Trigger uchun kamida `evidenceRequired` (default 3) ball kerak —
 *     ya'ni blink+mikro, burilish+mikro yoki blink+burilish.
 *  4. PASSIV ANTI-SPOOF OQIMDA: kadrlar bo'yicha ansambl skorining o'rtachasi
 *     `passiveMin` dan past bo'lsa trigger BLOKLANADI; juda past bo'lsa
 *     'spoof_suspected' holati qaytadi (rasm/ekran oqim davomidayoq sezialdi).
 *
 * Trigger'dan keyingina backend yakuniy tanib olishni (/verify-live:
 * identity + passiv ansambl + izchillik + challenge dalili) ishga tushiradi.
 */

export interface ServerFaceSample {
  present: boolean;
  multiple: boolean;
  /** Yuz markazi kadrga nisbatan 0..1 */
  centerX: number;
  centerY: number;
  /** Yuz kengligi / kadr kengligi */
  widthRatio: number;
  yaw: number | null;
  pitch: number | null;
  roll: number | null;
  /** Eye aspect ratio (InsightFace 68-landmark); yo'q bo'lsa null */
  ear: number | null;
  /** Yuz hududi o'rtacha yorqinligi 0..255 */
  brightness: number | null;
  /** Shu kadrning passiv anti-spoof skori (0..1) */
  livenessScore: number | null;
  timestamp: number;
}

export type ServerGateStatus =
  | 'no_face'
  | 'multiple'
  | 'too_small'
  | 'off_center'
  | 'too_dark'
  | 'hold'
  | 'hold_long'
  | 'spoof_suspected'
  | 'triggered';

export type ServerGateTrigger = 'blink' | 'turn' | null;

export interface ServerGateResult {
  status: ServerGateStatus;
  trigger: ServerGateTrigger;
  /** Yig'ilgan jonlilik dalili ballari (progress ko'rsatkichi uchun) */
  evidencePoints: number;
  evidenceRequired: number;
  /** Oqimdagi passiv anti-spoof o'rtachasi (null — ma'lumot yo'q) */
  passiveMean: number | null;
}

export interface ServerGateConfig {
  minWidthRatio: number;
  centerToleranceX: number;
  centerToleranceY: number;
  /** Yuz hududi minimal yorqinligi (0..255) */
  minBrightness: number;
  /** Poza chegaralari (gradus) — undan katta og'ish dalil yig'ishni to'xtatadi */
  maxAbsPitch: number;
  maxAbsRoll: number;
  /** Trigger oldidan barqarorlik: vaqt va kadr soni */
  stableMs: number;
  stableMinSamples: number;
  /** Blink (EAR) chegaralari */
  earOpen: number;
  earClosed: number;
  yawRangeDeg: number;
  /** Tabiiy mikro-harakat: markaz og'ishi shu oraliqda bo'lsin (juda qotib
   * turgan tripod-rasm ham, silkinayotgan qo'l-rasm ham chetlashadi) */
  microMotionMin: number;
  microMotionMax: number;
  /** Trigger uchun kerakli dalil ballari (blink=2, turn=2, micro=1) */
  evidenceRequired: number;
  /** Oqimdagi passiv skor o'rtachasi trigger uchun kamida shu bo'lsin */
  passiveMin: number;
  /** Undan past o'rtacha → 'spoof_suspected' */
  passiveWarn: number;
  windowMs: number;
  longHoldMs: number;
}

export const DEFAULT_SERVER_GATE_CONFIG: ServerGateConfig = {
  minWidthRatio: 0.18,
  centerToleranceX: 0.28,
  centerToleranceY: 0.3,
  minBrightness: 55,
  maxAbsPitch: 30,
  maxAbsRoll: 30,
  stableMs: 800,
  stableMinSamples: 3,
  earOpen: 0.26,
  earClosed: 0.2,
  yawRangeDeg: 15,
  microMotionMin: 0.0015,
  microMotionMax: 0.06,
  evidenceRequired: 3,
  passiveMin: 0.45,
  passiveWarn: 0.3,
  windowMs: 6000,
  longHoldMs: 5000,
};

interface HistoryEntry {
  timestamp: number;
  yaw: number | null;
  ear: number | null;
  liveness: number | null;
  centerX: number;
  centerY: number;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export class ServerFaceGate {
  private readonly config: ServerGateConfig;
  private history: HistoryEntry[] = [];
  private stableSince: number | null = null;
  private locked = false;
  /** Blink bir marta isbotlangach sessiya davomida saqlanadi */
  private blinkSeen = false;

  constructor(config: Partial<ServerGateConfig> = {}) {
    this.config = { ...DEFAULT_SERVER_GATE_CONFIG, ...config };
  }

  /** Verifikatsiya muvaffaqiyatsiz yakunlangach to'liq qayta qurollantirish. */
  reset(): void {
    this.history = [];
    this.stableSince = null;
    this.locked = false;
    this.blinkSeen = false;
  }

  push(sample: ServerFaceSample): ServerGateResult {
    const cfg = this.config;
    if (this.locked) return this.result('triggered', null);

    // --- 1) Mavjudlik va SIFAT gatelari ---
    if (!sample.present) {
      this.resetStability();
      return this.result('no_face', null);
    }
    if (sample.multiple) {
      this.resetStability();
      return this.result('multiple', null);
    }
    if (sample.widthRatio < cfg.minWidthRatio) {
      this.resetStability();
      return this.result('too_small', null);
    }
    if (
      Math.abs(sample.centerX - 0.5) > cfg.centerToleranceX ||
      Math.abs(sample.centerY - 0.5) > cfg.centerToleranceY
    ) {
      this.resetStability();
      return this.result('off_center', null);
    }
    if (sample.brightness !== null && sample.brightness < cfg.minBrightness) {
      this.resetStability();
      return this.result('too_dark', null);
    }
    // Poza juda og'gan — dalil yig'ilmaydi, foydalanuvchi to'g'ri qarasin
    // (stableSince saqlanadi: bosh burilishi challenge'ining o'zi shu og'ishdan o'tadi)
    const badPose =
      (sample.pitch !== null && Math.abs(sample.pitch) > cfg.maxAbsPitch) ||
      (sample.roll !== null && Math.abs(sample.roll) > cfg.maxAbsRoll);

    // --- 2) Barqarorlik oynasi ---
    if (this.stableSince === null) this.stableSince = sample.timestamp;
    if (!badPose) {
      this.history.push({
        timestamp: sample.timestamp,
        yaw: sample.yaw,
        ear: sample.ear,
        liveness: sample.livenessScore,
        centerX: sample.centerX,
        centerY: sample.centerY,
      });
      const cutoff = sample.timestamp - cfg.windowMs;
      while (this.history.length > 0 && this.history[0].timestamp < cutoff) {
        this.history.shift();
      }
    }

    const stableFor = sample.timestamp - this.stableSince;
    if (stableFor < cfg.stableMs || this.history.length < cfg.stableMinSamples) {
      return this.result('hold', null);
    }

    // --- 4) Passiv anti-spoof oqim nazorati ---
    const passiveMean = this.passiveMean();
    if (
      passiveMean !== null &&
      this.history.filter((h) => h.liveness !== null).length >= 4 &&
      passiveMean < cfg.passiveWarn
    ) {
      return this.result('spoof_suspected', null);
    }

    // --- 3) Dalil yig'ish ---
    if (!this.blinkSeen && sample.ear !== null && sample.ear <= cfg.earClosed) {
      const sawOpen = this.history.some(
        (h) => h.ear !== null && h.ear >= cfg.earOpen && h.timestamp < sample.timestamp,
      );
      if (sawOpen) this.blinkSeen = true;
    }

    const yaws = this.history
      .map((h) => h.yaw)
      .filter((y): y is number => y !== null && Number.isFinite(y));
    const turnSeen =
      yaws.length >= 3 && Math.max(...yaws) - Math.min(...yaws) >= cfg.yawRangeDeg;

    let microSeen = false;
    if (this.history.length >= 4) {
      const drift = Math.max(
        stddev(this.history.map((h) => h.centerX)),
        stddev(this.history.map((h) => h.centerY)),
      );
      microSeen = drift >= cfg.microMotionMin && drift <= cfg.microMotionMax;
    }

    const points = (this.blinkSeen ? 2 : 0) + (turnSeen ? 2 : 0) + (microSeen ? 1 : 0);
    const passiveOk = passiveMean === null || passiveMean >= cfg.passiveMin;

    if (points >= cfg.evidenceRequired && passiveOk && !badPose) {
      this.locked = true;
      return this.result('triggered', this.blinkSeen ? 'blink' : 'turn', points);
    }

    return this.result(stableFor >= cfg.longHoldMs ? 'hold_long' : 'hold', null, points);
  }

  private passiveMean(): number | null {
    const scores = this.history
      .map((h) => h.liveness)
      .filter((s): s is number => s !== null && Number.isFinite(s));
    if (scores.length === 0) return null;
    return scores.reduce((sum, s) => sum + s, 0) / scores.length;
  }

  private result(
    status: ServerGateStatus,
    trigger: ServerGateTrigger,
    points = 0,
  ): ServerGateResult {
    return {
      status,
      trigger,
      evidencePoints: points,
      evidenceRequired: this.config.evidenceRequired,
      passiveMean: this.passiveMean(),
    };
  }

  private resetStability(): void {
    this.stableSince = null;
    this.history = [];
  }
}
