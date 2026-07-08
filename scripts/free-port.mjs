/**
 * Dev portini bo'shatish (Windows'dagi orphan `node dist/main` dardiga dava).
 *
 * `nest start --watch` Windows'da ba'zan qayta yuklashda/terminal yopilganda
 * eski child jarayonni o'ldirmay qoldiradi — keyingi start EADDRINUSE bilan
 * yiqiladi. Bu skript start:dev'dan OLDIN ishlaydi: portni tinglayotgan
 * jarayon(lar)ni topadi va FAQAT node.exe bo'lsa o'ldiradi (boshqa dastur
 * bo'lsa tegmaydi, ogohlantirib chiqadi).
 */
import { execSync } from 'node:child_process';
import process from 'node:process';

const port = Number(process.env.PORT ?? 3000);

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

if (process.platform !== 'win32') {
  // Unix: lsof bilan (mavjud bo'lsa)
  const out = run(`lsof -ti tcp:${port} -s tcp:listen`);
  for (const pid of out.split(/\s+/).filter(Boolean)) {
    run(`kill -9 ${pid}`);
    console.log(`[free-port] ${port}-portni ushlab turgan PID ${pid} to'xtatildi`);
  }
  process.exit(0);
}

// Windows: netstat -ano dan LISTENING holatidagi PID'larni yig'amiz
const netstat = run('netstat -ano -p tcp');
const pids = new Set();
for (const line of netstat.split(/\r?\n/)) {
  // TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
  const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
  if (m && Number(m[1]) === port) pids.add(m[2]);
}

if (pids.size === 0) {
  process.exit(0);
}

for (const pid of pids) {
  const task = run(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`);
  const isNode = /"node\.exe"/i.test(task);
  if (!isNode) {
    console.warn(
      `[free-port] DIQQAT: ${port}-portni node bo'lmagan jarayon (PID ${pid}) ushlab turibdi — tegilmadi:\n${task.trim()}`,
    );
    continue;
  }
  run(`taskkill /PID ${pid} /F`);
  console.log(`[free-port] ${port}-portni ushlab turgan eski node jarayoni (PID ${pid}) to'xtatildi`);
}
