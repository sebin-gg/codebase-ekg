import type { AlarmLevel } from '../shared/types.ts';

// Melodic alarm bursts in the spirit of IEC 60601-1-8: high priority = 3 + 2 pulses, medium = 3 pulses.
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
const BURSTS: Record<AlarmLevel, { notes: [number, number][]; pulse: number; every: number }> = {
  critical: { notes: [[0, C5], [0.2, E5], [0.4, G5], [0.85, G5], [1.05, C6]], pulse: 0.14, every: 4000 },
  warning: { notes: [[0, C5], [0.3, E5], [0.6, G5]], pulse: 0.2, every: 12000 },
};

export class MonitorAudio {
  private ctx: AudioContext | null = null;
  private muted = false;
  private wantFlatline = false;
  private flatline: OscillatorNode | null = null;
  private alarmLevel: AlarmLevel | null = null;
  private alarmTimer = 0;

  /** Must be called from a user gesture before anything is audible. */
  start() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume().then(() => this.syncFlatline());
  }

  get ready() {
    return this.ctx?.state === 'running';
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.syncFlatline();
    return this.muted;
  }

  private tone(freq: number, dur: number, at = 0, vol = 0.07, type: OscillatorType = 'sine') {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.005);
    gain.gain.setValueAtTime(vol, t + dur - 0.015);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Pulse-oximeter beep: pitch falls as saturation falls, just like the real thing. */
  beep(spo2: number | null) {
    this.tone(spo2 === null ? 760 : 300 + (spo2 - 70) * 20, 0.06);
  }

  setAlarm(level: AlarmLevel | null) {
    if (level === this.alarmLevel) return;
    this.alarmLevel = level;
    window.clearInterval(this.alarmTimer);
    if (!level) return;
    const burst = BURSTS[level];
    const play = () => burst.notes.forEach(([at, f]) => this.tone(f, burst.pulse, at, 0.045, 'square'));
    play();
    this.alarmTimer = window.setInterval(play, burst.every);
  }

  setFlatline(on: boolean) {
    this.wantFlatline = on;
    this.syncFlatline();
  }

  private syncFlatline() {
    const ctx = this.ctx;
    const audible = this.wantFlatline && !this.muted && ctx?.state === 'running';
    if (audible && !this.flatline && ctx) {
      const gain = ctx.createGain();
      gain.gain.value = 0.025;
      this.flatline = ctx.createOscillator();
      this.flatline.frequency.value = 880;
      this.flatline.connect(gain).connect(ctx.destination);
      this.flatline.start();
    } else if (!audible && this.flatline) {
      this.flatline.stop();
      this.flatline = null;
    }
  }

  charge() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(2600, t + 1.1);
    gain.gain.setValueAtTime(0.02, t);
    gain.gain.linearRampToValueAtTime(0.04, t + 1.1);
    gain.gain.linearRampToValueAtTime(0, t + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.2);
  }

  zap() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const len = Math.floor(ctx.sampleRate * 0.3);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const noise = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    noise.buffer = buffer;
    noise.connect(gain).connect(ctx.destination);
    noise.start();
    this.tone(70, 0.25, 0, 0.3, 'sine');
  }
}
