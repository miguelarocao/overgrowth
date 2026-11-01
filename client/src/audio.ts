// Every sound is synthesized with WebAudio: no asset files. Captures pluck notes on
// a pentatonic scale (which always sounds pleasant, whatever order the notes come in),
// and a capture streak climbs the scale.

const PENTA = [0, 2, 4, 7, 9]; // major pentatonic, in semitones
const MUTE_KEY = 'og-muted';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  private noise: AudioBuffer | null = null;
  muted = (() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  })();

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.scheduleBirds();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  private get ok() {
    return !!this.ctx && !this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'triangle', vol = 0.3, when = 0, glideTo?: number) {
    if (!this.ok) return;
    const c = this.ctx!, t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, vol: number, freq: number, q = 1, when = 0, sweepTo?: number) {
    if (!this.ok || !this.noise) return;
    const c = this.ctx!, t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A plucked note: degree n on the pentatonic scale above C5. */
  pluck(n: number, vol = 0.22) {
    const semi = PENTA[((n % 5) + 5) % 5] + 12 * Math.floor(n / 5);
    const f = 523.25 * 2 ** (Math.min(semi, 30) / 12);
    this.tone(f, 0.35, 'triangle', vol);
    this.tone(f * 2, 0.12, 'sine', vol * 0.3);
  }

  tick(n = 0) {
    this.tone(880 + n * 30, 0.04, 'square', 0.04);
  }

  select() {
    this.tone(660, 0.06, 'sine', 0.12, 0, 990);
  }

  thud() {
    this.tone(140, 0.25, 'sine', 0.35, 0, 60);
    this.hiss(0.12, 0.15, 400);
  }

  lose() {
    this.tone(330, 0.18, 'sawtooth', 0.06, 0, 220);
  }

  splash() {
    this.hiss(0.5, 0.35, 2400, 0.8, 0, 500);
    for (let k = 0; k < 4; k++) this.tone(500 + Math.random() * 700, 0.08, 'sine', 0.12, 0.05 + k * 0.06, 1400);
  }

  chime() {
    [1, 2.76, 5.4].forEach((m, k) => this.tone(784 * m, 1.2 - k * 0.3, 'sine', 0.18 / (k + 1)));
  }

  callout(level: number) {
    [0, 2, 4].forEach((n, k) => setTimeout(() => this.pluck(n + level * 2, 0.18), k * 70));
  }

  fanfare() {
    [0, 2, 4, 5, 7].forEach((n, k) => setTimeout(() => this.pluck(n, 0.3), k * 120));
    setTimeout(() => this.chime(), 650);
  }

  sadTrombone() {
    [392, 370, 349, 330].forEach((f, k) => {
      const dur = k === 3 ? 1.0 : 0.35;
      setTimeout(() => {
        this.tone(f, dur, 'sawtooth', 0.08);
        if (k === 3) this.tone(f * 1.01, dur, 'sawtooth', 0.05);
      }, k * 380);
    });
  }

  emote() {
    this.tone(1040, 0.08, 'sine', 0.15, 0, 1560);
  }

  purr() {
    if (!this.ok) return;
    for (let k = 0; k < 8; k++) this.hiss(0.09, 0.25, 180, 2, k * 0.11);
  }

  meow() {
    this.tone(700, 0.18, 'sawtooth', 0.06, 0, 1100);
    this.tone(1100, 0.3, 'sawtooth', 0.05, 0.18, 600);
  }

  sneeze() {
    this.tone(400, 0.25, 'sine', 0.15, 0, 700);
    this.tone(600, 0.25, 'sine', 0.15, 0.3, 1000);
    this.hiss(0.35, 0.6, 3000, 0.6, 0.6, 1200);
  }

  coo() {
    this.tone(420, 0.25, 'sine', 0.12, 0, 380);
    this.tone(400, 0.35, 'sine', 0.12, 0.3, 330);
  }

  flap() {
    for (let k = 0; k < 5; k++) this.hiss(0.05, 0.2, 900, 1.5, k * 0.06);
  }

  coin() {
    this.tone(988, 0.08, 'square', 0.08);
    this.tone(1319, 0.4, 'square', 0.08, 0.08);
    setTimeout(() => this.splash(), 450);
  }

  buzz() {
    this.tone(220, 0.6, 'sawtooth', 0.04, 0, 240);
  }

  boo() {
    this.tone(200, 0.9, 'sine', 0.2, 0, 120);
    this.tone(300, 0.9, 'triangle', 0.08, 0, 180);
  }

  disco() {
    const seq = [0, 4, 7, 9, 7, 4, 2, 5];
    seq.forEach((n, k) => setTimeout(() => this.pluck(n, 0.16), k * 140));
  }

  /** Start or stop the rain loop for spring showers. */
  setRain(on: boolean) {
    if (!this.ctx || !this.noise) return;
    if (on && !this.rain) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800;
      const gain = c.createGain();
      gain.gain.value = 0.0001;
      gain.gain.setTargetAtTime(0.06, c.currentTime, 1.2);
      src.connect(f).connect(gain).connect(this.master!);
      src.start();
      this.rain = { gain, src };
    } else if (!on && this.rain) {
      const r = this.rain;
      this.rain = null;
      r.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.8);
      setTimeout(() => r.src.stop(), 3000);
    }
  }

  /** Very occasional, quiet birdsong. The city is abandoned, not dead. */
  private scheduleBirds() {
    setTimeout(() => {
      if (this.ok && document.visibilityState === 'visible') {
        const base = 2200 + Math.random() * 1500;
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) this.tone(base, 0.09, 'sine', 0.035, k * 0.13, base * (1.2 + Math.random() * 0.4));
      }
      this.scheduleBirds();
    }, 9000 + Math.random() * 16000);
  }
}

export const sfx = new Sfx();
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sfx.unlock(), { capture: true });
