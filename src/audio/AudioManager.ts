import { STORAGE_MUTE } from '../core/Config';

type Ctx = AudioContext;

/**
 * All audio is synthesised at runtime — no files, no network, no
 * licensing questions, and the game is fully playable if the Web Audio
 * API is unavailable (every method degrades to a no-op).
 *
 * The music is a four-chord loop in A minor with a plucked arpeggio and
 * a soft pulse; its filter cutoff and arpeggio rate follow the player's
 * speed, so the score tightens as the run does.
 */
export class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private started = false;

  // Scheduler state
  private nextNoteTime = 0;
  private step = 0;
  private tempo = 112;
  private intensity = 0;

  private coinChain = 0;
  private lastCoinAt = 0;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_MUTE) === '1';
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(ctx.destination);

      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 900;
      this.musicFilter.Q.value = 0.6;

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.0;
      this.musicFilter.connect(this.musicGain);
      this.musicGain.connect(this.master);

      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.master);

      this.noiseBuffer = createNoise(ctx);
      this.nextNoteTime = ctx.currentTime + 0.1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORAGE_MUTE, muted ? '1' : '0');
    } catch { /* storage unavailable */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  startMusic(): void {
    this.started = true;
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0.16, this.ctx.currentTime, 0.8);
    }
  }

  duckMusic(): void {
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.25);
    }
  }

  stopMusic(): void {
    this.started = false;
    if (this.ctx && this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.4);
    }
  }

  /** Drives the music scheduler; call once per frame. */
  update(intensity: number): void {
    this.intensity = intensity;
    const ctx = this.ctx;
    if (!ctx || !this.started || this.muted) return;

    if (this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(760 + intensity * 2400, ctx.currentTime, 0.4);
    }
    this.tempo = 112 + intensity * 26;
    const stepTime = 60 / this.tempo / 4; // sixteenth notes

    // Look-ahead scheduling keeps timing sample-accurate even when the
    // render loop hitches.
    while (this.nextNoteTime < ctx.currentTime + 0.15) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += stepTime;
      this.step = (this.step + 1) % 64;
    }
  }

  // ── Music ──────────────────────────────────────────────────────────
  private scheduleStep(step: number, time: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicFilter) return;

    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const chord = CHORDS[bar];

    // Pad: one sustained triad per bar.
    if (beat === 0) {
      for (const semitone of chord) {
        this.pad(midiToFreq(semitone + 48), time, 60 / this.tempo * 3.8);
      }
    }

    // Arpeggio: sparse at low speed, busier as the run intensifies.
    const density = this.intensity > 0.55 ? 2 : 4;
    if (beat % density === 0) {
      const note = chord[(step / density) % chord.length | 0] + 72;
      this.pluck(midiToFreq(note), time, 0.055 + this.intensity * 0.02);
    }

    // Pulse on the down-beats — felt more than heard.
    if (beat % 8 === 0) this.pulse(time);
  }

  private pad(freq: number, time: number, duration: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 8;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.035, time + 0.6);
    gain.gain.linearRampToValueAtTime(0, time + duration);
    osc.connect(gain);
    gain.connect(this.musicFilter!);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private pluck(freq: number, time: number, gainValue: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(gainValue, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain);
    gain.connect(this.musicFilter!);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  private pulse(time: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.11);
    gain.gain.setValueAtTime(0.16, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    osc.connect(gain);
    gain.connect(this.master!);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  // ── Effects ────────────────────────────────────────────────────────
  jump(): void {
    this.tone({ type: 'triangle', from: 380, to: 720, duration: 0.16, gain: 0.16, curve: 'exp' });
  }

  land(impact: number): void {
    this.noise({ duration: 0.13, gain: 0.06 + impact * 0.1, filter: 900, type: 'lowpass' });
    this.tone({ type: 'sine', from: 180, to: 90, duration: 0.11, gain: 0.1 + impact * 0.06, curve: 'exp' });
  }

  slide(): void {
    this.noise({ duration: 0.42, gain: 0.11, filter: 2400, type: 'bandpass', sweepTo: 700 });
  }

  laneChange(): void {
    this.tone({ type: 'sine', from: 620, to: 480, duration: 0.07, gain: 0.05, curve: 'lin' });
  }

  coin(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Rising pitch ladder over a coin run; resets after a short pause.
    if (now - this.lastCoinAt > 0.75) this.coinChain = 0;
    this.lastCoinAt = now;
    const stepIndex = Math.min(this.coinChain, 11);
    this.coinChain++;
    const freq = 880 * Math.pow(2, PENTATONIC[stepIndex % PENTATONIC.length] / 12)
      * (stepIndex >= 5 ? 2 : 1);
    this.tone({ type: 'sine', from: freq, to: freq, duration: 0.1, gain: 0.13, curve: 'exp' });
    this.tone({ type: 'sine', from: freq * 2, to: freq * 2, duration: 0.06, gain: 0.05, curve: 'exp' });
  }

  powerUp(): void {
    this.tone({ type: 'triangle', from: 320, to: 1280, duration: 0.34, gain: 0.16, curve: 'exp' });
    this.tone({ type: 'sine', from: 640, to: 2560, duration: 0.3, gain: 0.07, curve: 'exp' });
  }

  nearMiss(): void {
    this.noise({ duration: 0.16, gain: 0.055, filter: 3200, type: 'bandpass', sweepTo: 1200 });
  }

  shieldBreak(): void {
    this.tone({ type: 'square', from: 520, to: 140, duration: 0.26, gain: 0.12, curve: 'exp' });
    this.noise({ duration: 0.24, gain: 0.1, filter: 1800, type: 'bandpass' });
  }

  crash(): void {
    this.noise({ duration: 0.55, gain: 0.3, filter: 1400, type: 'lowpass', sweepTo: 220 });
    this.tone({ type: 'sawtooth', from: 180, to: 34, duration: 0.55, gain: 0.22, curve: 'exp' });
  }

  uiClick(): void {
    this.tone({ type: 'sine', from: 660, to: 880, duration: 0.07, gain: 0.09, curve: 'exp' });
  }

  uiBack(): void {
    this.tone({ type: 'sine', from: 660, to: 420, duration: 0.09, gain: 0.08, curve: 'exp' });
  }

  // ── Primitives ─────────────────────────────────────────────────────
  private tone(o: {
    type: OscillatorType; from: number; to: number;
    duration: number; gain: number; curve: 'exp' | 'lin';
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || this.muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.from, t);
    if (o.from !== o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(o.gain, t + 0.008);
    if (o.curve === 'exp') gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);
    else gain.gain.linearRampToValueAtTime(0.0001, t + o.duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + o.duration + 0.03);
  }

  private noise(o: {
    duration: number; gain: number; filter: number;
    type: BiquadFilterType; sweepTo?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || !this.noiseBuffer || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.setValueAtTime(o.filter, t);
    if (o.sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, o.sweepTo), t + o.duration);
    filter.Q.value = o.type === 'bandpass' ? 1.6 : 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(o.gain, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + o.duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(t);
    src.stop(t + o.duration + 0.02);
  }
}

// A minor · F major · C major · G major — one bar each.
const CHORDS: number[][] = [
  [9, 12, 16],
  [5, 9, 12],
  [0, 4, 7],
  [7, 11, 14],
];

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

function createNoise(ctx: Ctx): AudioBuffer {
  const length = ctx.sampleRate * 1;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
