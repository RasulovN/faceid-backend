/**
 * start:dev launcheri: NestJS (watch) bilan birga face-service (FastAPI/uvicorn)
 * ni ham avtomatik ko'taradi — alohida terminalda qo'lda `uvicorn` yozish shart emas.
 *
 * Mantiq:
 *   1) FACE_SERVICE_PORT aniqlanadi (env > face-service/.env > backend/.env > 8000)
 *      va `GET /health` so'raladi — servis allaqachon ishlayotgan bo'lsa qayta ochilmaydi.
 *   2) Port band, lekin health javob bermasa: portni ushlab turgan jarayon FAQAT
 *      python.exe bo'lsa o'ldiriladi (free-port.mjs falsafasi), boshqasiga tegilmaydi.
 *   3) face-service/.venv topilmasa — ogohlantirish chiqadi va faqat backend ishlaydi
 *      (backend o'zi face-service'siz ham ko'tariladi, faqat yuz endpointlari ishlamaydi).
 *   4) Backend (nest start --watch) to'xtaganda face-service ham to'xtatiladi.
 *
 * Faqat backend kerak bo'lsa: FACE_SERVICE_AUTOSTART=false pnpm start:dev
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const faceDir = path.resolve(backendDir, '..', 'face-service');
const isWin = process.platform === 'win32';

function readEnvFile(file) {
  const map = {};
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return map;
}

const faceEnv = readEnvFile(path.join(faceDir, '.env'));
const backendEnv = readEnvFile(path.join(backendDir, '.env'));
const facePort = Number(
  process.env.FACE_SERVICE_PORT ?? faceEnv.FACE_SERVICE_PORT ?? backendEnv.FACE_SERVICE_PORT ?? 8000,
);
const autostart = (process.env.FACE_SERVICE_AUTOSTART ?? 'true').toLowerCase() !== 'false';

const log = (msg) => console.log(`[face-service] ${msg}`);

async function faceHealthy() {
  try {
    const res = await fetch(`http://127.0.0.1:${facePort}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Portni ushlab turgan, lekin health bermayotgan ESKI python jarayonini tozalash. */
function freeFacePort() {
  if (!isWin) {
    for (const pid of run(`lsof -ti tcp:${facePort} -s tcp:listen`).split(/\s+/).filter(Boolean)) {
      run(`kill -9 ${pid}`);
      log(`${facePort}-portni ushlab turgan PID ${pid} to'xtatildi`);
    }
    return true;
  }
  const netstat = run('netstat -ano -p tcp');
  const pids = new Set();
  for (const line of netstat.split(/\r?\n/)) {
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (m && Number(m[1]) === facePort) pids.add(m[2]);
  }
  let free = true;
  for (const pid of pids) {
    const task = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
    if (/"python\.exe"/i.test(task)) {
      run(`taskkill /PID ${pid} /T /F`);
      log(`${facePort}-portni ushlab turgan eski python jarayoni (PID ${pid}) to'xtatildi`);
    } else {
      console.warn(
        `[face-service] DIQQAT: ${facePort}-portni python bo'lmagan jarayon (PID ${pid}) band qilgan — tegilmadi:\n${task.trim()}`,
      );
      free = false;
    }
  }
  return free;
}

let faceProc = null;

/** Jarayonni butun daraxt bilan to'xtatish (Windows'da child'lar orphan qolmasin). */
function killTree(proc) {
  if (proc === null || proc.exitCode !== null) return;
  if (isWin) {
    run(`taskkill /PID ${proc.pid} /T /F`);
  } else {
    proc.kill('SIGTERM');
  }
}

const killFace = () => killTree(faceProc);

/** face-service stdout/stderr'ini prefiks bilan oqizish. */
function pipePrefixed(stream, out) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) out(`[face-service] ${line}`);
  });
}

async function startFaceService() {
  if (!autostart) {
    log('FACE_SERVICE_AUTOSTART=false — face-service qo\'lda boshqariladi');
    return;
  }
  if (await faceHealthy()) {
    log(`allaqachon ${facePort}-portda ishlayapti — qayta ochilmadi`);
    return;
  }
  const python = path.join(faceDir, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');
  if (!existsSync(python)) {
    console.warn(
      `[face-service] DIQQAT: ${python} topilmadi — face-service ishga tushirilmadi.\n` +
        `[face-service] O'rnatish: cd face-service && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt`,
    );
    return;
  }
  if (!freeFacePort()) return; // port begona jarayonda — spawn baribir yiqilardi

  log(`ishga tushirilmoqda: uvicorn app.main:app --port ${facePort} (modellar yuklanishi biroz vaqt oladi)`);
  faceProc = spawn(
    python,
    ['-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', String(facePort)],
    {
      cwd: faceDir, // pydantic-settings face-service/.env ni shu yerdan o'qiydi
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  pipePrefixed(faceProc.stdout, console.log);
  pipePrefixed(faceProc.stderr, console.error);
  faceProc.on('close', (code) => {
    // Backend ishlashda davom etadi — face endpointlari 503 qaytaradi xolos.
    if (code !== null && code !== 0) log(`kutilmaganda to'xtadi (exit=${code}) — backend ishlashda davom etadi`);
  });
}

await startFaceService();

const nest = spawn(
  process.execPath,
  [path.join(backendDir, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js'), 'start', '--watch'],
  { cwd: backendDir, stdio: 'inherit' },
);

const shutdown = () => {
  killFace();
  killTree(nest);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', killFace);

nest.on('close', (code) => {
  killFace();
  process.exit(code ?? 0);
});
