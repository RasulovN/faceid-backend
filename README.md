# FaceID Backend

FaceID davomat SaaS platformasining NestJS backendi. API kontrakti: [`docs/API_CONTRACT.md`](../docs/API_CONTRACT.md) — barcha endpointlar, envelope va WebSocket eventlari shu hujjatga aynan mos implement qilingan.

## Stack

- **NestJS 10 + Fastify** (`@nestjs/platform-fastify`), TypeScript strict
- **TypeORM + PostgreSQL 16 + pgvector** — migration-first (`synchronize: false`)
- **Redis + BullMQ** — kesh, debounce, pairing kodlari, repeatable joblar
- **MinIO** — xodim rasmlari va davomat snapshotlari (bucketlar avtomatik yaratiladi)
- **Socket.IO** (path `/ws`) — real-time davomat/qurilma/bildirishnoma eventlari
- **Payme Merchant API** (JSON-RPC) — to‘liq state machine
- Argon2, @nestjs/throttler (global 100/min, login 5/min), Joi env validatsiya, Swagger (`/api/docs`)

## Modullar

| Modul | Vazifasi |
|---|---|
| `auth` | Register (Company + owner tranzaksiyada), login (username/email/telefon avtodetect), JWT refresh rotation, email verification, parol tiklash |
| `users` | Kompaniya foydalanuvchilari, superadmin user CRUD |
| `tariffs` | Public tariflar, superadmin CRUD, `TariffLimitsService` (filial/xodim/qurilma limitlari → 402 TARIFF_LIMIT_EXCEEDED) |
| `companies` | Superadmin kompaniya boshqaruvi (owner, obuna tarixi, to‘lovlar, statistika bilan), kompaniya profili |
| `branches` | Filiallar CRUD + geofence sozlamalari + limit check |
| `employees` | Xodim yaratish (User+Employee bitta tranzaksiyada, parol avtogen + email), rasmlar → MinIO → face-service `/extract` → FaceEmbedding (obyekt kaliti = embeddingId), soft delete |
| `schedules` | Ish grafiklari CRUD (FIXED/SHIFT/FLEXIBLE) |
| `workdays` | Kunlik hisob yadrosi: grafik resolutsiyasi (individual > filial > default), late/early/overtime hisobi |
| `attendance` | Kiosk recognize (identify + debounce + IN/OUT toggle), mobil check (geofence → mock → verify → liveness), eventlar CRUD, daily/monthly agregatlar, xlsx export |
| `rules` | Jarima (LATE_FIXED/LATE_PER_MINUTE/ABSENT), bonus, overtime qoidalari |
| `payroll` | BullMQ joblar: har kecha 00:30 WorkDay, oy boshi 02:00 PayrollRecord DRAFT; approve/mark-paid, xlsx export |
| `payments` | Payme JSON-RPC (CheckPerform/Create/Perform/Cancel/Check/GetStatement), checkout link, obuna eslatmalari + suspend job, `GET /admin/subscriptions` |
| `devices` | Pairing kod (Redis, 10 min TTL), pair → deviceToken, heartbeat + WS `device:status` |
| `audit` | `AuditInterceptor` — barcha mutatsion so‘rovlar avtomatik log, mock-location urinishlar ham |
| `notifications` | Bildirishnomalar + WS `notification:new` |
| `stats` | Kompaniya dashboard, superadmin dashboard (MRR, revenue chart, growth) |
| `files` | MinIO presigned PUT + public GET URL |
| `health` | `GET /health` (prefikssiz): DB, Redis, face-service, MinIO |
| `ws` | Socket.IO gateway: JWT yoki deviceToken handshake, `company:{id}` / `branch:{id}` / `user:{id}` roomlar |
| `mail` | Nodemailer, o‘zbek tilidagi HTML shablonlar |
| `face` | face-service ichki klienti (`X-Internal-Api-Key`) |

### RBAC qatlami

Global guard zanjiri (tartib muhim): `ThrottlerGuard → JwtAuthGuard (@Public istisno) → RolesGuard → PermissionsGuard (rol→permission mapping: src/common/constants/permissions.ts) → TenantGuard (companyId scope majburiy) → SubscriptionGuard (SUSPENDED/EXPIRED → faqat GET, yozish 402)`.

## Scriptlar

```bash
pnpm install            # dependencylar
pnpm start:dev          # dev server (watch) + face-service (uvicorn) avto-start
pnpm start:dev:solo     # faqat backend (face-service'siz)
pnpm build              # production build
pnpm start:prod         # dist/main.js
pnpm lint               # ESLint
pnpm test               # Jest (61 test)
```

`start:dev` face-service'ni ham avtomatik ko'taradi (`scripts/dev-with-face.mjs`):
allaqachon ishlayotgan bo'lsa qayta ochmaydi, `face-service/.venv` bo'lmasa
ogohlantirib faqat backend'ni ishga tushiradi. O'chirish:
`FACE_SERVICE_AUTOSTART=false pnpm start:dev` (yoki `pnpm start:dev:solo`).

```bash
pnpm seed               # superadmin + 3 tarif + demo kompaniya
```

## Migration workflow

```bash
# .env faylini tayyorlang (ildizdagi .env.example asosida)
pnpm migration:run                                          # barcha migrationlar
pnpm migration:generate src/database/migrations/NomiBuYerda # entity o'zgarishidan generatsiya
pnpm migration:revert                                       # oxirgisini qaytarish
```

- DataSource: `src/database/data-source.ts` (CLI ham, runtime ham shundan foydalanadi)
- Boshlang‘ich migration pgvector extension, barcha jadval/indekslar va `face_embeddings.embedding vector(512)` ustuniga ivfflat indeksni yaratadi.
- Docker imageda entrypoint avval `migration:run` (dist orqali), keyin `start:prod` qiladi.

## Seed ma'lumotlari

- Superadmin: `SEED_SUPERADMIN_*` env kalitlaridan
- Tariflar: Start (199 000 so‘m: 1/15/1), Business (499 000: 5/100/5), Enterprise (1 499 000: 50/1000/50) — narxlar DB'da tiyinda
- Demo kompaniya: owner `demo` / `Demo123!` (ACTIVE, Business trial), 2 filial (Toshkent koordinatalari), 5 xodim (`emp1..emp5` / `Demo123!`, har birida 2 ta fake normalizatsiyalangan 512-dim embedding), Du–Ju 09:00–18:00 grafik, 2 jarima qoidasi, FULL_ATTENDANCE bonusi, overtime 1.5x

## Face-service integratsiyasi

Backend face-service'ga JSON (base64 rasm) yuboradi, `X-Internal-Api-Key` header bilan:

- `POST /extract` `{ image }` → `{ ok, embedding[512], quality, errorCode? }`
- `POST /identify` `{ image, companyId }` → `{ matched, employeeId?, confidence?, livenessScore?, reason? }` (pgvector qidiruv face-service tomonida)
- `POST /verify` `{ image, embeddings[][] }` → `{ match, confidence, livenessScore }`
- `GET /health`

pgvector qidiruvi uchun jadval nomlari: `face_embeddings`, `employees` (ustunlar camelCase quoted: `"employeeId"`, `"companyId"`, `"deletedAt"`, `"status"`).

## Eslatmalar

- Barcha pul summalari **tiyin**da saqlanadi (integer).
- `Employee.passportSeries` AES-256-GCM bilan shifrlanadi (kalit `JWT_ACCESS_SECRET`dan derive qilinadi — alohida env kerak emas).
- Davomat eventi yozilganda tegishli kunning `WorkDay`i darhol qayta hisoblanadi; tungi job kelmagan xodimlar uchun ABSENT yozuvlarni yakunlaydi.
- Qo‘lda kiritilgan eventlar `isManual=true` bilan belgilanadi (kontrakt `source`ni KIOSK|MOBILE bilan cheklagani uchun source konvensiya bo‘yicha KIOSK).
# faceid-backend
