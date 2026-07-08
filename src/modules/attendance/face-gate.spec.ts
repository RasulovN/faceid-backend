import { ServerFaceGate, type ServerFaceSample } from './face-gate';

/** Standart "yaxshi" kadr namunasi — testlar kerakli maydonlarni bosib yozadi. */
function sample(overrides: Partial<ServerFaceSample> = {}): ServerFaceSample {
  return {
    present: true,
    multiple: false,
    centerX: 0.5,
    centerY: 0.5,
    widthRatio: 0.4,
    yaw: 0,
    pitch: 0,
    roll: 0,
    ear: 0.3,
    brightness: 120,
    livenessScore: 0.9,
    timestamp: 0,
    ...overrides,
  };
}

/** t ms qadam bilan ketma-ket kadrlar beradi (mikro-harakat bilan). */
function feed(
  gate: ServerFaceGate,
  count: number,
  make: (i: number) => Partial<ServerFaceSample>,
  stepMs = 500,
) {
  let last;
  for (let i = 0; i < count; i += 1) {
    // Tabiiy mikro-harakat: markaz ozgina drift qiladi
    const jitter = (i % 2 === 0 ? 1 : -1) * 0.004;
    last = gate.push(
      sample({ timestamp: i * stepMs, centerX: 0.5 + jitter, ...make(i) }),
    );
  }
  return last!;
}

describe('ServerFaceGate (ko\'p-signalli jonlilik darvozasi)', () => {
  it('yuz yo\'q kadrlar hech qachon trigger bermaydi', () => {
    const gate = new ServerFaceGate();
    const res = feed(gate, 10, () => ({ present: false }));
    expect(res.status).toBe('no_face');
  });

  it('blink + mikro-harakat → triggered (blink)', () => {
    const gate = new ServerFaceGate();
    // 4 kadr ochiq ko'z (barqarorlik), keyin yopiq ko'z kadri
    const res = feed(gate, 6, (i) => ({ ear: i === 5 ? 0.15 : 0.3 }));
    expect(res.status).toBe('triggered');
    expect(res.trigger).toBe('blink');
  });

  it('faqat mikro-harakat (1 ball) yetarli EMAS — statik rasm qo\'lda', () => {
    const gate = new ServerFaceGate();
    const res = feed(gate, 12, () => ({ ear: 0.3, yaw: 0 }));
    expect(res.status).not.toBe('triggered');
  });

  it('mutlaqo qotgan kadr (tripod-rasm): mikro-harakat ham yo\'q → trigger yo\'q', () => {
    const gate = new ServerFaceGate();
    let res;
    for (let i = 0; i < 12; i += 1) {
      res = gate.push(sample({ timestamp: i * 500, centerX: 0.5, ear: 0.3 }));
    }
    expect(res!.status).not.toBe('triggered');
    expect(res!.evidencePoints).toBe(0);
  });

  it('bosh burilishi + mikro-harakat → triggered (turn)', () => {
    const gate = new ServerFaceGate();
    // Trigger BIRINCHI otilgan kadrda keladi (keyingilari locked bo'ladi)
    let first = null;
    for (let i = 0; i < 8; i += 1) {
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.004;
      const res = gate.push(
        sample({ timestamp: i * 500, centerX: 0.5 + jitter, yaw: i * 4 - 12, ear: 0.3 }),
      );
      if (res.status === 'triggered' && first === null) first = res;
    }
    expect(first).not.toBeNull();
    expect(first!.trigger).toBe('turn');
  });

  it('passiv anti-spoof past bo\'lsa blink ham triggerni ochmaydi', () => {
    const gate = new ServerFaceGate();
    const res = feed(gate, 8, (i) => ({
      ear: i === 6 ? 0.15 : 0.3,
      livenessScore: 0.2, // rasm/ekran — ansambl past skor beryapti
    }));
    expect(res.status).toBe('spoof_suspected');
  });

  it('juda qorong\'i kadr → too_dark va barqarorlik reset', () => {
    const gate = new ServerFaceGate();
    const res = feed(gate, 5, () => ({ brightness: 30 }));
    expect(res.status).toBe('too_dark');
  });

  it('bir nechta yuz → multiple', () => {
    const gate = new ServerFaceGate();
    const res = feed(gate, 4, () => ({ multiple: true }));
    expect(res.status).toBe('multiple');
  });

  it('reset() dan keyin blink dalili ham qayta yig\'iladi', () => {
    const gate = new ServerFaceGate();
    feed(gate, 6, (i) => ({ ear: i === 5 ? 0.15 : 0.3 }));
    gate.reset();
    const res = feed(gate, 4, () => ({ ear: 0.3 }));
    expect(res.status).not.toBe('triggered');
  });
});
