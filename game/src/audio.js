// audio.js — all sound is synthesised with WebAudio: no files, no network.
// Short filtered-noise and oscillator voices for shots, hits, the charge and
// UI. One shared context, created lazily on the first user gesture.

let ctx = null;
let master = null;

export function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

function noiseBuffer(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function burst({ dur = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', sweepTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.frequency.setValueAtTime(freq, t);
  if (sweepTo) flt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t); src.stop(t + dur);
}

function tone({ freq = 440, dur = 0.15, gain = 0.25, type = 'square', sweepTo = null }) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (sweepTo) o.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur);
}

export const sfx = {
  shot(kind) { // kind: rifle | pistol | dmr | scatter | smg
    if (kind === 'scatter') { burst({ dur: 0.22, freq: 900, gain: 0.8, sweepTo: 200 }); }
    else if (kind === 'dmr') { burst({ dur: 0.18, freq: 2600, gain: 0.7, sweepTo: 300 }); tone({ freq: 120, dur: 0.12, gain: 0.4, type: 'triangle' }); }
    else if (kind === 'smg') { burst({ dur: 0.07, freq: 2200, gain: 0.4, sweepTo: 700 }); }
    else { burst({ dur: 0.11, freq: 2400, gain: 0.55, sweepTo: 500 }); }
  },
  dryFire() { tone({ freq: 1400, dur: 0.03, gain: 0.12 }); },
  reload() { tone({ freq: 300, dur: 0.06, gain: 0.2 }); setTimeout(() => tone({ freq: 520, dur: 0.06, gain: 0.2 }), 160); },
  hit() { tone({ freq: 900, dur: 0.05, gain: 0.18, type: 'sine' }); },
  kill() { tone({ freq: 660, dur: 0.09, gain: 0.22, type: 'sine' }); setTimeout(() => tone({ freq: 990, dur: 0.12, gain: 0.22, type: 'sine' }), 80); },
  hurt() { burst({ dur: 0.1, freq: 500, gain: 0.4 }); },
  step() { burst({ dur: 0.05, freq: 400, gain: 0.07 }); },
  buy() { tone({ freq: 780, dur: 0.07, gain: 0.2, type: 'sine' }); setTimeout(() => tone({ freq: 1180, dur: 0.1, gain: 0.2, type: 'sine' }), 60); },
  plantBeep() { tone({ freq: 1040, dur: 0.07, gain: 0.25, type: 'sine' }); },
  planted() { tone({ freq: 520, dur: 0.12, gain: 0.3 }); setTimeout(() => tone({ freq: 780, dur: 0.16, gain: 0.3 }), 120); },
  explode() { burst({ dur: 0.9, freq: 3000, gain: 1.0, sweepTo: 60 }); tone({ freq: 60, dur: 0.8, gain: 0.7, type: 'sine', sweepTo: 30 }); },
  flash() { tone({ freq: 2400, dur: 0.25, gain: 0.3, type: 'sine', sweepTo: 1800 }); },
  roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.22, type: 'triangle' }), i * 110)); },
  roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.16, gain: 0.22, type: 'triangle' }), i * 110)); },
};
