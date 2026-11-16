import './style.css';
import type { AlarmLevel, CommitNote, Reading, Rhythm } from '../shared/types.ts';
import { LIMITS } from '../shared/vitals.ts';
import { MonitorAudio } from './audio.ts';
import { SweepTrace } from './sweep.ts';
import { Heart } from './waveform.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const RHYTHM_LABEL: Record<Rhythm, string> = {
  sinus: 'SINUS RHYTHM',
  bradycardia: 'SINUS BRADY',
  tachycardia: 'SINUS TACHY',
  arrhythmia: 'IRREGULAR + PVCs',
  vfib: 'V-FIB',
  asystole: 'ASYSTOLE',
};
const PLACEHOLDER: Record<string, string> = { github: 'owner/repo', local: 'D:\\path\\to\\repo' };

const monitor = $('monitor');
const dialog = $<HTMLDialogElement>('admit');
const form = $<HTMLFormElement>('admit-form');
const sourceSelect = $<HTMLSelectElement>('admit-source');
const targetInput = $<HTMLInputElement>('admit-target');
const defib = $<HTMLButtonElement>('defib');

const heart = new Heart((Math.random() * 2 ** 31) | 0);
const audio = new MonitorAudio();
const ecg = new SweepTrace($<HTMLCanvasElement>('ecg'), { color: '#39ff7a', scale: 0.36, baseline: 0.62 });
const pleth = new SweepTrace($<HTMLCanvasElement>('pleth'), { color: '#2de2ff', scale: 0.55, baseline: 0.85 });

let reading: Reading | null = null;
let receivedAt = 0;
let events: EventSource | null = null;
let holdDiagnosisUntil = 0;

const text = (id: string, value: string | number) => { $(id).textContent = String(value); };
const el = (tag: string, className: string, content = '') => Object.assign(document.createElement(tag), { className, textContent: content });
const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const bedFor = (name: string) =>
  String((Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 13) + 1).padStart(2, '0');

function showAlarm(level: AlarmLevel, message: string, detail = '') {
  const banner = $('alarm');
  banner.hidden = false;
  banner.className = `alarm ${level}`;
  banner.textContent = message;
  banner.title = detail;
}

function admit(source: string, target: string) {
  const qs = new URLSearchParams({ source, target }).toString();
  history.replaceState(null, '', `?${qs}`);
  $<HTMLAnchorElement>('fhir').href = `/api/fhir?${qs}`;
  text('patient', target);
  text('source', source.toUpperCase());
  text('bed', bedFor(target));
  text('diagnosis', 'Attaching leads...');
  reading = null;

  events?.close();
  events = new EventSource(`/api/stream?${qs}`);
  events.addEventListener('reading', (e) => render(JSON.parse((e as MessageEvent<string>).data) as Reading));
  events.addEventListener('fault', (e) => {
    const { message, fatal } = JSON.parse((e as MessageEvent<string>).data) as { message: string; fatal: boolean };
    showAlarm('warning', `LEADS OFF: ${message}`.toUpperCase());
    if (fatal) {
      events?.close();
      text('diagnosis', 'Admission refused. Check the patient details and try again.');
    }
  });
  events.addEventListener('error', () => {
    if (events?.readyState === EventSource.CONNECTING) showAlarm('warning', 'LEADS OFF: MONITOR LINK LOST, RECONNECTING');
  });
}

function renderNotes(commits: CommitNote[]) {
  const list = $('notes');
  if (!commits.length) return list.replaceChildren(el('li', 'empty', 'No commits on the chart.'));
  list.replaceChildren(...commits.slice(0, 8).map((c) => {
    const li = el('li', (c.lines ?? 0) >= LIMITS.vfibDiffLines ? 'huge' : '');
    li.append(
      el('span', 'when', ago(Date.now() - c.at)),
      el('span', 'sha', c.sha.slice(0, 7)),
      el('span', 'who', c.author),
      el('span', 'size', c.lines === null ? '' : `\u00b1${c.lines.toLocaleString()}`),
      el('span', 'msg', c.message),
    );
    return li;
  }));
}

function render(r: Reading) {
  reading = r;
  receivedAt = Date.now();
  const { signals: s, vitals: v } = r;

  heart.bpm = v.bpm;
  heart.rhythm = v.rhythm;
  heart.perfusion = v.spo2 === null ? 0.8 : Math.max(0.2, (v.spo2 - 60) / 40);
  monitor.dataset.rhythm = v.rhythm;

  text('hr', v.rhythm === 'vfib' ? '---' : v.bpm);
  text('rhythm', RHYTHM_LABEL[v.rhythm]);
  text('spo2', v.spo2 ?? '--');
  text('nibp', v.bp ? `${v.bp.systolic}/${v.bp.diastolic}` : '--/--');
  text('temp', v.temp.toFixed(1));
  text('bleed', s.uncommittedFiles ?? '--');
  if (Date.now() >= holdDiagnosisUntil) text('diagnosis', v.diagnosis);
  text('insurance', s.rateLimitRemaining === null ? '' : `INSURANCE ${s.rateLimitRemaining} CALLS`);

  $('tod').hidden = v.rhythm !== 'asystole';
  text('tod-time', s.lastCommitAt === null ? 'NEVER BORN' : new Date(s.lastCommitAt).toLocaleString());
  defib.hidden = v.rhythm !== 'vfib' && v.rhythm !== 'asystole';

  const [top, ...rest] = v.alarms;
  if (top) showAlarm(top.level, `${top.message}${rest.length ? `   (+${rest.length} MORE)` : ''}`.toUpperCase(), v.alarms.map((a) => a.message).join('\n'));
  else $('alarm').hidden = true;
  audio.setAlarm(top?.level ?? null);
  audio.setFlatline(v.rhythm === 'asystole');
  renderNotes(s.recentCommits);
}

defib.addEventListener('click', async () => {
  audio.start();
  defib.disabled = true;
  defib.textContent = 'CHARGING...';
  audio.charge();
  await new Promise((r) => setTimeout(r, 1200));
  audio.zap();
  heart.shock(performance.now() / 1000);
  monitor.classList.remove('shock');
  void monitor.offsetWidth;
  monitor.classList.add('shock');
  defib.disabled = false;
  defib.textContent = 'CHARGE 200J';
  if (!reading) return;
  holdDiagnosisUntil = Date.now() + 8000;
  text('diagnosis', reading.vitals.rhythm === 'vfib'
    ? `Shock delivered. Still fibrillating: a ${reading.signals.largestRecentDiff.toLocaleString()}-line commit is still in there. Split it up.`
    : 'Shock delivered. No response. Only a fresh commit can resurrect this patient.');
});

$('mute').addEventListener('click', () => {
  audio.start();
  text('mute', audio.toggleMute() ? 'UNMUTE' : 'MUTE');
});

$('readmit').addEventListener('click', () => dialog.showModal());
sourceSelect.addEventListener('change', () => { targetInput.placeholder = PLACEHOLDER[sourceSelect.value] ?? ''; });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  audio.start();
  dialog.close();
  admit(sourceSelect.value, targetInput.value.trim());
});
window.addEventListener('pointerdown', () => audio.start(), { once: true });

setInterval(() => {
  text('clock', new Date().toLocaleTimeString([], { hour12: false }));
  text('sampled', reading ? `SAMPLED ${ago(Date.now() - receivedAt)} AGO` : '');
  text('sound', reading && !audio.ready ? 'CLICK FOR SOUND' : '');
}, 1000);

let last = performance.now() / 1000;
function frame(now: number) {
  const t = now / 1000;
  const from = Math.max(last, t - 2);
  heart.advance(t);
  if (heart.beatsBetween(from, t).length) {
    audio.beep(reading?.vitals.spo2 ?? null);
    const dot = $('heart');
    dot.classList.add('beat');
    setTimeout(() => dot.classList.remove('beat'), 120);
  }
  ecg.draw(from, t, (x) => heart.ecg(x));
  pleth.draw(from, t, (x) => heart.pleth(x));
  last = t;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

void fetch('/api/health')
  .then((r) => r.json() as Promise<{ allowLocal: boolean }>)
  .then(({ allowLocal }) => { if (!allowLocal) sourceSelect.querySelector('option[value="local"]')?.remove(); })
  .catch(() => {});

const params = new URLSearchParams(location.search);
const initialTarget = params.get('target');
if (initialTarget) {
  const source = params.get('source') ?? 'github';
  sourceSelect.value = source;
  targetInput.value = initialTarget;
  admit(source, initialTarget);
} else {
  dialog.showModal();
}
