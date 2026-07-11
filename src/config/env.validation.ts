import * as Joi from 'joi';

/**
 * Barcha environment kalitlari uchun Joi validatsiya sxemasi.
 * Kalit nomlari loyiha ildizidagi `.env.example` bilan bir xil.
 */
export const envValidationSchema = Joi.object({
  // ---------- Umumiy ----------
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  APP_TIMEZONE: Joi.string().default('Asia/Tashkent'),

  // ---------- PostgreSQL ----------
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().port().default(5432),
  POSTGRES_USER: Joi.string().default('faceid'),
  POSTGRES_PASSWORD: Joi.string().default('faceid_dev_password'),
  POSTGRES_DB: Joi.string().default('faceid'),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .default('postgresql://faceid:faceid_dev_password@localhost:5432/faceid'),

  // ---------- Redis ----------
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),

  // ---------- JWT ----------
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // ---------- SMTP ----------
  SMTP_HOST: Joi.string().default('smtp.gmail.com'),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().default('FaceID Platform <noreply@faceid.local>'),

  // ---------- MinIO ----------
  MINIO_ENDPOINT: Joi.string().default('localhost'),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  MINIO_ACCESS_KEY: Joi.string().default('minioadmin'),
  MINIO_SECRET_KEY: Joi.string().default('minioadmin'),
  MINIO_BUCKET_EMPLOYEES: Joi.string().default('employee-photos'),
  MINIO_BUCKET_SNAPSHOTS: Joi.string().default('attendance-snapshots'),
  MINIO_PRESIGNED_EXPIRES: Joi.number().default(3600),
  /**
   * Brauzerga qaytariladigan public URL bazasi (ixtiyoriy), masalan
   * https://backend.timepro.uz/s3 — alohida s3 subdomen DNS'iga bog'liq qolmaslik
   * uchun rasm URL'lari backend domeni orqali (nginx /s3/ → MinIO) beriladi.
   * Bo'sh bo'lsa eski xatti-harakat: MINIO_ENDPOINT:MINIO_PORT (lokal dev).
   */
  MINIO_PUBLIC_URL: Joi.string().uri().allow('').default(''),

  // ---------- Face Service ----------
  FACE_SERVICE_URL: Joi.string().uri().default('http://localhost:8000'),
  INTERNAL_API_KEY: Joi.string().required(),
  FACE_MATCH_THRESHOLD: Joi.number().min(0).max(1).default(0.5),
  // Enroll'da dublikat yuz tekshiruvi: shu o'xshashlikdan yuqori bo'lsa —
  // rasm BOSHQA xodimga tegishli deb rad etiladi
  FACE_DUPLICATE_THRESHOLD: Joi.number().min(0).max(1).default(0.5),
  LIVENESS_THRESHOLD: Joi.number().min(0).max(1).default(0.7),
  // Mobil burst verifikatsiyasida aktiv challenge: 'turn' (bosh burilishi) yoki 'none'
  FACE_CHALLENGE: Joi.string().valid('turn', 'none').default('turn'),
  FACE_SERVICE_DATABASE_URL: Joi.string().optional(),
  FACE_USE_GPU: Joi.boolean().default(false),
  FACE_SERVICE_PORT: Joi.number().port().default(8000),

  // ---------- Payme ----------
  // Rejim almashtirgich: true/1 = TEST (sandbox), false/0 = PRODUCTION.
  // Kalit va checkout URL rejimga qarab avtomatik tanlanadi (payme.config.ts).
  PAYME_TEST_MODE: Joi.boolean().truthy('1').falsy('0').default(true),
  // Lokal (tizim ichidagi) checkout sahifasi: 1 → havola CLIENT_URL/payme ga boradi,
  // to'lov shu tizimning o'zidagi Payme-uslub sandbox interfeysida bajariladi.
  // FAQAT PAYME_TEST_MODE=1 da kuchga kiradi (production'da e'tiborsiz qoldiriladi).
  PAYME_LOCAL_CHECKOUT: Joi.boolean().truthy('1').falsy('0').default(false),
  PAYME_MERCHANT_ID: Joi.string().allow('').default(''),
  PAYME_MERCHANT_KEY: Joi.string().allow('').default(''),
  PAYME_TEST_MERCHANT_ID: Joi.string().allow('').default(''),
  PAYME_TEST_MERCHANT_KEY: Joi.string().allow('').default(''),
  // Ixtiyoriy override'lar — bo'sh qolsa rejim bo'yicha standart URL ishlatiladi
  PAYME_CHECKOUT_URL: Joi.string().uri().allow('').default(''),
  PAYME_TEST_CHECKOUT_URL: Joi.string().uri().allow('').default(''),
  // Payme kabinetidagi kassa "account" maydoni nomi (checkout ac.<field> va
  // Merchant API account[<field>]). Mavjud (boshqa loyihaning) kassasi bilan
  // ishlaganda o'sha kassaning maydoniga moslanadi (masalan order_id).
  PAYME_ACCOUNT_FIELD: Joi.string()
    .pattern(/^[a-zA-Z0-9_]+$/)
    .default('payment_id'),
  // Payme Merchant API endpointiga ruxsat etilgan IP'lar (vergul bilan, CIDR ham
  // bo'ladi, masalan: 185.234.113.0/27). Bo'sh = tekshiruv o'chiq (faqat Basic auth).
  PAYME_ALLOWED_IPS: Joi.string().allow('').default(''),
  // Subscribe API (tizim ichidagi karta to'lovi — modal). Odatda asosiy kassa
  // ma'lumotlari ishlatiladi; Payme alohida "virtual terminal" bergan bo'lsa
  // shu yerda almashtiriladi. URL bo'sh — rejim bo'yicha avtomatik.
  PAYME_SUBSCRIBE_MERCHANT_ID: Joi.string().allow('').default(''),
  PAYME_SUBSCRIBE_KEY: Joi.string().allow('').default(''),
  PAYME_SUBSCRIBE_URL: Joi.string().uri().allow('').default(''),
  // Fiskalizatsiya: MXIK (IKPU) 17 xonali — JS number aniqligidan katta, string saqlanadi
  PAYME_FISCAL_MXIK: Joi.string().allow('').default(''),
  PAYME_FISCAL_PACKAGE_CODE: Joi.string().allow('').default(''),
  PAYME_FISCAL_VAT_PERCENT: Joi.number().min(0).max(100).default(0),

  // ---------- Yandex Maps ----------
  YANDEX_MAPS_API_KEY: Joi.string().allow('').optional(),

  // ---------- Frontend URL'lar ----------
  LANDING_URL: Joi.string().uri().default('http://localhost:3001'),
  // client/ — yagona SPA (/superadmin, /app, /kiosk hammasi shu originda)
  CLIENT_URL: Joi.string().uri().default('http://localhost:5173'),

  // ---------- Biznes sozlamalar ----------
  AUTO_APPROVE_COMPANIES: Joi.boolean().default(true),
  // Storage Analytics: alert foizlari shu yumshoq limitdan hisoblanadi (GB)
  STORAGE_ALERT_LIMIT_GB: Joi.number().positive().default(50),
  TRIAL_DAYS: Joi.number().integer().min(0).default(14),
  GRACE_PERIOD_DAYS: Joi.number().integer().min(0).default(3),
  ATTENDANCE_DEBOUNCE_SECONDS: Joi.number().integer().min(1).default(60),

  // ---------- Seed ----------
  SEED_SUPERADMIN_USERNAME: Joi.string().default('superadmin'),
  SEED_SUPERADMIN_EMAIL: Joi.string().email().default('admin@example.com'),
  SEED_SUPERADMIN_PASSWORD: Joi.string().min(8).default('ChangeMe123!'),
}).unknown(true);
