import { Engine, bufferOf } from './audio/engine.js';
import { Synth, SYNTH_PRESETS } from './audio/synth.js';
import { Recorder, countDropouts } from './audio/recorder.js';
import { startNative, stopNative } from './audio/native.js';
import { LivePlayer } from './audio/liveplayer.js';
import { VOICES, playDrum, emptyPattern, PRESETS as BEATS } from './audio/drums.js';
import { NOTE_NAMES, SCALES, correctionCurve, detectKey, mixToMono, hzToMidi } from './dsp/autotune.js';
import { runDsp } from './dsp/client.js';
import { encodeWav } from './dsp/wav.js';
import * as store from './store.js';
import { ICON } from './icons.js';

// ---------------------------------------------------------------------------
// setup
export const APP_VERSION = 2;
const $ = (q, el = document) => el.querySelector(q);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIC = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
const engine = new Engine();
const ctx = engine.ctx;
const synth = new Synth(ctx, engine.master);
const recorder = new Recorder(ctx);
const perfRecorder = new Recorder(ctx);
const live = new LivePlayer(ctx, engine.master);
const previewOut = ctx.createGain();
previewOut.connect(engine.master);

let project = null;
let tab = 'studio';
let rec = null;
let preview = null;
const ui = { tuneTrackId: null, screwSource: 'mix', screwResult: null, busy: false, keysOctave: 3, perfRec: false, lastTake: null };
const settings = loadSettings();

function loadSettings() {
  try { return Object.assign({ latencyMs: null, lastProject: null }, JSON.parse(localStorage.getItem('e-studio-settings') || '{}')); }
  catch { return { latencyMs: null, lastProject: null }; }
}
function saveSettings() { try { localStorage.setItem('e-studio-settings', JSON.stringify(settings)); } catch { /* private mode */ } }

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function newProjectData(name = 'Untitled') {
  return {
    id: uid(), name, bpm: 90, bars: 8, loop: true, metronome: false, countIn: true, recSource: 'mic', monitor: false, master: 0.9,
    key: 0, scale: 'minor',
    drums: { pattern: emptyPattern(), vol: 0.8, mute: false, solo: false, swing: 0, tune: 0 },
    screw: { rate: 0.75, style: 'repeat', every: 2, beats: 1, echo: 0.3, muffle: 0.25, bpm: null },
    tracks: [], created: Date.now(), updated: Date.now(),
  };
}

function serialize(p) {
  return { ...p, tracks: p.tracks.map(({ raw, tuned, _analysis, ...t }) => ({ ...t, hasTuned: !!tuned })) };
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    project.updated = Date.now();
    store.saveProject(serialize(project)).catch((e) => toast('Could not save: ' + e.message));
  }, 500);
}
const changed = () => { scheduleSave(); render(); };
const changedQuiet = () => scheduleSave();
const audioKey = (t, kind) => `${project.id}/${t.id}/${kind}`;

async function loadProject(id) {
  const p = await store.getProject(id);
  if (!p) return false;
  const base = newProjectData();
  p.drums = Object.assign(base.drums, p.drums);
  p.screw = Object.assign(base.screw, p.screw);
  for (const t of p.tracks) {
    t.raw = await store.getAudio(`${p.id}/${t.id}/raw`, ctx);
    t.tuned = t.hasTuned ? await store.getAudio(`${p.id}/${t.id}/tuned`, ctx) : null;
  }
  p.tracks = p.tracks.filter((t) => t.raw);
  openProject(p);
  return true;
}

function openProject(p) {
  live.load(ctx.createBuffer(1, 1, ctx.sampleRate), 0.5);
  ui.screwResult = null;
  ui.tuneTrackId = null;
  ui.screwSource = 'mix';
  project = p;
  engine.setProject(p);
  settings.lastProject = p.id;
  saveSettings();
  render();
}

// ---------------------------------------------------------------------------
// DOM helpers
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  if (value !== undefined) el.value = value;
  return el;
}

function slider(label, value, min, max, step, onInput, fmt) {
  const out = h('span', { class: 'val' }, fmt ? fmt(value) : '');
  const inp = h('input', { type: 'range', min, max, step, value, 'aria-label': label,
    oninput: (e) => { const v = +e.target.value; onInput(v); if (fmt) out.textContent = fmt(v); } });
  return h('label', { class: 'slider' }, h('span', { class: 'lbl' }, label), inp, out);
}

function seg(options, current, onPick) {
  return h('div', { class: 'seg', role: 'group' }, options.map(([v, label]) =>
    h('button', { class: v === current ? 'on' : '', 'aria-pressed': String(v === current), onclick: () => onPick(v) }, label)));
}

function chip(label, on, onToggle) {
  return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(!!on), onclick: () => onToggle(!on) }, label);
}

function select(options, current, onPick, label) {
  return h('select', { 'aria-label': label, onchange: (e) => onPick(e.target.value), value: String(current) },
    options.map(([v, l]) => h('option', { value: String(v) }, l)));
}

const field = (label, control) => h('label', { class: 'field' }, label, control);

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openSheet(title, ...content) {
  $('#sheetBody').replaceChildren(title ? h('h3', {}, title) : '', ...content.flat().filter((c) => c != null && c !== false));
  $('#sheetWrap').hidden = false;
}
function closeSheet() { $('#sheetWrap').hidden = true; }

const fmtTime = (s) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// drawing
let drawQueue = [];
const queueDraw = (fn) => drawQueue.push(fn);
function flushDraws() { const q = drawQueue; drawQueue = []; q.forEach((f) => f()); }

function setupCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const hh = c.clientHeight;
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(hh * dpr));
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hh);
  return { g, w, h: hh };
}

function drawBars(g, w, hh, L) {
  const bar = engine.barSec;
  g.strokeStyle = 'rgba(255,255,255,.06)';
  g.lineWidth = 1;
  for (let t = bar; t < L; t += bar) {
    const x = Math.round((t / L) * w) + 0.5;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke();
  }
}

function drawWave(c, buf, start, L, color) {
  const { g, w, h: hh } = setupCanvas(c);
  drawBars(g, w, hh, L);
  if (!buf) return;
  const x0 = (start / L) * w;
  const px = Math.max(1, Math.round((buf.duration / L) * w));
  const data = buf.getChannelData(0);
  const spp = data.length / px;
  const stride = Math.max(1, Math.floor(spp / 48));
  g.fillStyle = color + '22';
  g.fillRect(x0, 4, px, hh - 8);
  g.fillStyle = color;
  const mid = hh / 2;
  for (let i = 0; i < px; i++) {
    let lo = 0, hi = 0;
    const a = Math.floor(i * spp), b = Math.min(data.length, Math.floor((i + 1) * spp));
    for (let j = a; j < b; j += stride) { const v = data[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y1 = mid - hi * (mid - 4);
    const y2 = mid - lo * (mid - 4);
    g.fillRect(x0 + i, y1, 1, Math.max(1, y2 - y1));
  }
}

function drawBeatLane(c, L) {
  const { g, w, h: hh } = setupCanvas(c);
  drawBars(g, w, hh, L);
  const step = engine.stepSec;
  const total = Math.round(L / step);
  const pat = project.drums.pattern;
  VOICES.forEach((v, r) => {
    const y = 6 + r * ((hh - 12) / VOICES.length);
    const rh = Math.max(2, (hh - 12) / VOICES.length - 2);
    g.fillStyle = r < 2 ? '#F06617' : '#4da3ff';
    for (let s = 0; s < total; s++) if (pat[v.id][s % 16]) g.fillRect((s / total) * w, y, Math.max(2, w / total - 1), rh);
  });
}

function drawPitch(c, t) {
  const { g, w, h: hh } = setupCanvas(c);
  const a = t._analysis;
  g.fillStyle = '#8b98a9';
  g.font = '13px -apple-system, system-ui, sans-serif';
  g.textAlign = 'center';
  if (!a) { g.fillText('Tap Apply or Detect key to see your pitch', w / 2, hh / 2); return; }
  const f0 = a.f0;
  const midi = Array.from(f0, (f) => (f > 0 ? hzToMidi(f) : NaN));
  const valid = midi.filter((m) => !Number.isNaN(m));
  if (!valid.length) { g.fillText('No singing found in this track', w / 2, hh / 2); return; }
  const sorted = valid.slice().sort((x, y) => x - y);
  let lo = sorted[Math.floor(sorted.length * 0.02)] - 2;
  let hi = sorted[Math.floor(sorted.length * 0.98)] + 2;
  if (hi - lo < 8) { const m = (hi + lo) / 2; lo = m - 4; hi = m + 4; }
  const Y = (m) => hh - 8 - ((m - lo) / (hi - lo)) * (hh - 16);
  const allowed = new Set((SCALES[t.tune.scale] || SCALES.chromatic).map((s) => (s + t.tune.key) % 12));
  g.textAlign = 'left';
  g.font = '10px -apple-system, system-ui, sans-serif';
  for (let n = Math.ceil(lo); n <= Math.floor(hi); n++) {
    if (!allowed.has(((n % 12) + 12) % 12)) continue;
    const y = Math.round(Y(n)) + 0.5;
    g.strokeStyle = n % 12 === t.tune.key ? 'rgba(240,102,23,.35)' : 'rgba(255,255,255,.08)';
    g.beginPath(); g.moveTo(26, y); g.lineTo(w, y); g.stroke();
    g.fillStyle = '#6c7888';
    g.fillText(NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1), 2, y + 3);
  }
  const X = (i) => 26 + (i / Math.max(1, f0.length - 1)) * (w - 28);
  const line = (vals, color, width) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    vals.forEach((m, i) => {
      if (Number.isNaN(m) || !m) { pen = false; return; }
      if (pen) g.lineTo(X(i), Y(m)); else { g.moveTo(X(i), Y(m)); pen = true; }
    });
    g.stroke();
  };
  line(midi, 'rgba(200,210,222,.55)', 1.5);
  const { target } = correctionCurve(f0, a.hop / ctx.sampleRate, t.tune);
  line(Array.from(target), '#F06617', 2);
}

// ---------------------------------------------------------------------------
// render
function render() {
  if (!project) return;
  $('#projName').textContent = project.name;
  $('#bpmBtn').textContent = `${project.bpm} BPM`;
  renderTransport();
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const builders = { studio: studioTab, beat: beatTab, keys: keysTab, tune: tuneTab, screw: screwTab };
  drawQueue = [];
  $('#tab-' + tab).replaceChildren(builders[tab]());
  requestAnimationFrame(flushDraws);
}

function renderTransport() {
  $('#btnPlay').innerHTML = engine.playing && !rec ? ICON.pause : ICON.play;
  $('#btnPlay').setAttribute('aria-label', engine.playing ? 'Pause' : 'Play');
  $('#btnRec').innerHTML = rec ? ICON.stop : ICON.rec;
  $('#btnRec').classList.toggle('on', !!rec);
  $('#btnMetro').classList.toggle('on', !!project.metronome);
  $('#btnLoop').classList.toggle('on', !!project.loop);
}

function seekFrom(e, el) {
  if (rec) return;
  const r = el.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  stopPreview();
  engine.seek(pct * engine.songLength());
}

// --- Studio ---------------------------------------------------------------
function studioTab() {
  const L = engine.songLength();
  const p = project;
  const wrap = h('div', { class: 'stack' });

  wrap.append(h('div', { class: 'card recopts' },
    h('span', { class: 'hint' }, 'Record'),
    seg([['mic', 'Mic'], ['keys', 'Keys']], p.recSource, (v) => { p.recSource = v; changed(); }),
    chip('Count-in', p.countIn, (v) => { p.countIn = v; changed(); }),
    p.recSource === 'mic' ? chip('Hear mic', p.monitor, (v) => { p.monitor = v; changed(); if (v) toast('Use headphones, or it will feed back'); }) : null));

  const lanes = h('div', {});
  const bars = Math.round(L / engine.barSec);
  const every = bars <= 16 ? 1 : bars <= 32 ? 2 : bars <= 64 ? 4 : 8;
  const ruler = h('div', { class: 'ruler', onpointerdown: (e) => seekFrom(e, ruler), 'aria-label': 'Timeline, tap to move the playhead' });
  for (let b = 0; b < bars; b += every) ruler.append(h('span', { style: `left:${(b / bars) * 100}%` }, String(b + 1)));
  ruler.append(h('div', { class: 'ph' }));
  lanes.append(ruler);

  if (rec) lanes.append(h('div', { class: 'track recording' }, h('span', { class: 'dot' }), 'Recording', h('span', { class: 'grow' }), h('span', { id: 'recTime' }, '')));

  const d = p.drums;
  const beatC = h('canvas', {});
  const beatWave = h('div', { class: 'wave', onpointerdown: (e) => seekFrom(e, beatWave) }, beatC, h('div', { class: 'ph' }));
  queueDraw(() => drawBeatLane(beatC, L));
  lanes.append(h('div', { class: 'track' },
    h('div', { class: 'track-head' },
      h('button', { class: 'tname', onclick: () => { tab = 'beat'; render(); } }, 'Beat'),
      h('span', { class: 'badge blue' }, 'DRUMS'),
      h('span', { class: 'grow' }),
      h('button', { class: 'ms mute' + (d.mute ? ' on' : ''), 'aria-label': 'Mute beat', onclick: () => { d.mute = !d.mute; engine.updateMix(); changed(); } }, 'M'),
      h('button', { class: 'ms solo' + (d.solo ? ' on' : ''), 'aria-label': 'Solo beat', onclick: () => { d.solo = !d.solo; engine.updateMix(); changed(); } }, 'S')),
    beatWave,
    h('div', { class: 'track-mix' }, slider('Vol', d.vol, 0, 1.5, 0.01, (v) => { d.vol = v; engine.updateMix(); changedQuiet(); }))));

  for (const t of p.tracks) lanes.append(trackCard(t, L));
  wrap.append(lanes);

  if (!p.tracks.length) {
    wrap.append(h('div', { class: 'empty' }, 'Tap the red ● to record your first take. ', h('br'), 'Use headphones so the beat stays out of the mic.'));
  }

  const file = h('input', { type: 'file', accept: 'audio/*', hidden: true, onchange: (e) => { if (e.target.files[0]) importAudio(e.target.files[0]); e.target.value = ''; } });
  wrap.append(h('div', { class: 'row' },
    h('button', { class: 'btn', onclick: () => file.click() }, '+ Import audio'),
    h('button', { class: 'btn', onclick: exportMix }, 'Export mix'),
    file));
  wrap.append(h('div', { class: 'card' }, slider('Master', p.master, 0, 1.2, 0.01, (v) => { p.master = v; engine.updateMix(); changedQuiet(); }, (v) => `${Math.round(v * 100)}%`)));
  return wrap;
}

function trackCard(t, L) {
  const c = h('canvas', {});
  const wave = h('div', { class: 'wave', onpointerdown: (e) => seekFrom(e, wave) }, c, h('div', { class: 'ph' }));
  const tuned = !!(t.tuned && t.useTuned);
  queueDraw(() => drawWave(c, bufferOf(t), t.start, L, tuned ? '#F06617' : '#4da3ff'));
  return h('div', { class: 'track' },
    h('div', { class: 'track-head' },
      h('button', { class: 'tname', onclick: () => trackMenu(t) }, t.name),
      tuned ? h('span', { class: 'badge' }, 'AUTO-TUNE') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'ms mute' + (t.mute ? ' on' : ''), 'aria-label': 'Mute ' + t.name, onclick: () => { t.mute = !t.mute; engine.updateMix(); changed(); } }, 'M'),
      h('button', { class: 'ms solo' + (t.solo ? ' on' : ''), 'aria-label': 'Solo ' + t.name, onclick: () => { t.solo = !t.solo; engine.updateMix(); changed(); } }, 'S'),
      h('button', { class: 'icon-btn sm', html: ICON.more, 'aria-label': 'Options for ' + t.name, onclick: () => trackMenu(t) })),
    wave,
    h('div', { class: 'track-mix' },
      slider('Vol', t.vol, 0, 1.5, 0.01, (v) => { t.vol = v; engine.updateMix(); changedQuiet(); }),
      slider('Pan', t.pan, -1, 1, 0.01, (v) => { t.pan = v; engine.updateMix(); changedQuiet(); })));
}

function trackMenu(t) {
  const nudge = (ms) => { t.start = Math.max(0, t.start + ms / 1000); changed(); toast(`Moved ${ms > 0 ? 'later' : 'earlier'} ${Math.abs(ms)} ms`); };
  openSheet(t.name,
    h('button', { class: 'mi', onclick: () => { closeSheet(); ui.tuneTrackId = t.id; tab = 'tune'; render(); } }, 'Auto-Tune this track'),
    h('button', { class: 'mi', onclick: () => { closeSheet(); ui.screwSource = t.id; tab = 'screw'; render(); } }, 'Chop & Screw this track'),
    t.tuned ? h('button', { class: 'mi', onclick: () => { t.useTuned = !t.useTuned; closeSheet(); changed(); } }, t.useTuned ? 'Use the original (untuned) take' : 'Use the tuned take') : null,
    h('button', { class: 'mi', onclick: () => { const n = prompt('Track name', t.name); if (n && n.trim()) { t.name = n.trim().slice(0, 40); closeSheet(); changed(); } } }, 'Rename'),
    h('div', { class: 'row', style: 'padding:12px 0;border-bottom:1px solid var(--line)' },
      h('span', { class: 'hint grow' }, `Starts at ${fmtTime(t.start)}`),
      h('button', { class: 'chip', onclick: () => nudge(-10) }, '−10 ms'),
      h('button', { class: 'chip', onclick: () => nudge(10) }, '+10 ms'),
      h('button', { class: 'chip', onclick: () => { t.start = Math.round(t.start / engine.barSec) * engine.barSec; changed(); toast('Snapped to the bar'); } }, 'Snap to bar')),
    h('button', { class: 'mi', onclick: () => duplicateTrack(t) }, 'Duplicate'),
    h('button', { class: 'mi danger', onclick: () => deleteTrack(t) }, 'Delete track'));
}

async function addTrack(name, buffer, start = 0, extra = {}) {
  const t = { id: uid(), name, start, vol: 0.9, pan: 0, mute: false, solo: false, useTuned: false,
    tune: { key: project.key, scale: project.scale, speed: 0, amount: 1 }, raw: buffer, tuned: null, ...extra };
  project.tracks.push(t);
  engine.updateMix();
  await store.putAudio(audioKey(t, 'raw'), buffer);
  if (t.tuned) await store.putAudio(audioKey(t, 'tuned'), t.tuned);
  changed();
  return t;
}

async function duplicateTrack(t) {
  closeSheet();
  await addTrack(t.name + ' copy', t.raw, t.start, { tuned: t.tuned, useTuned: t.useTuned, tune: { ...t.tune }, vol: t.vol, pan: t.pan });
  toast('Duplicated');
}

async function deleteTrack(t) {
  if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
  closeSheet();
  engine.stop();
  project.tracks = project.tracks.filter((x) => x !== t);
  engine.removeTrack(t.id);
  engine.updateMix();
  await store.deleteAudio(`${project.id}/${t.id}/`);
  changed();
}

function nextName(base) {
  let n = 1;
  while (project.tracks.some((t) => t.name === `${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function decode(ab) {
  return new Promise((res, rej) => {
    const r = ctx.decodeAudioData(ab, res, rej);
    if (r && r.then) r.then(res, rej);
  });
}

async function importAudio(file) {
  toast('Importing…');
  try {
    const buf = await decode(await file.arrayBuffer());
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 32) || 'Import';
    await addTrack(name, buf, 0);
    toast(`Imported ${name}`);
  } catch (e) {
    toast("Couldn't read that file. Try a WAV, MP3 or M4A.");
  }
}

// --- recording -------------------------------------------------------------
function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* Safari < 16.4 */ } }

function latencySec() {
  if (settings.latencyMs != null) return settings.latencyMs / 1000;
  return (ctx.baseLatency || 0) + (ctx.outputLatency || 0) + 0.01;
}

async function startRecording() {
  if (rec) return;
  stopPreview();
  live.pause();
  await ctx.resume();
  const p = project;
  let input;
  let stream = null;
  if (p.recSource === 'mic') {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('This browser cannot record. Open E-Studio in Safari.'); return; }
    setSession('play-and-record');
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC);
    } catch {
      setSession('playback');
      toast('Microphone blocked. Allow it in Settings › Safari › Microphone.');
      return;
    }
    input = ctx.createMediaStreamSource(stream);
    if (p.monitor) input.connect(engine.master);
  } else {
    input = synth.out;
    if (tab !== 'keys') { tab = 'keys'; }
  }
  await recorder.start(input);
  const native = stream ? startNative(stream, ctx) : null;
  const from = engine.position();
  engine.play(from, { record: true, countIn: p.countIn ? engine.barSec : 0 });
  rec = { from, t0: engine.t0, stream, input, source: p.recSource, native };
  render();
}

function micSettings(stream) {
  try { return stream.getAudioTracks()[0].getSettings() || {}; } catch { return {}; }
}

// Pick the cleanest copy of a mic take and the audio-clock time of its first sample.
// Prefers the phone's own recorder, lined up against the Web Audio copy.
async function bestTake(data, nat, settings) {
  const sr = ctx.sampleRate;
  const info = {
    when: new Date().toLocaleTimeString(), appRate: sr, micRate: settings.sampleRate || null,
    echoCancellation: settings.echoCancellation, webAudioDropouts: countDropouts(data.l) + data.gaps,
    method: 'Web Audio', confidence: null,
  };
  if (nat && nat.buf) {
    const x = nat.buf.getChannelData(0);
    let res = null;
    const expect = nat.startCtx != null ? Math.round((nat.startCtx - data.startTime) * sr) : null;
    try { res = await runDsp('align', { ref: data.l, x, sr, expect }); } catch (e) { console.warn('align failed', e); }
    info.confidence = res ? Math.round(res.confidence * 100) : 0;
    if (res && res.confidence >= 0.3) {
      info.method = 'iPhone recorder, synced to the beat';
      return { l: x, startTime: data.startTime + res.lag / sr, info };
    }
    if (nat.startCtx != null) {
      info.method = 'iPhone recorder, timing estimated';
      return { l: x, startTime: nat.startCtx, info };
    }
  }
  return { l: data.l, r: data.r, startTime: data.startTime, info };
}

async function stopRecording() {
  if (!rec) return;
  const r = rec;
  rec = null;
  engine.stop();
  const data = await recorder.stop();
  const nat = await stopNative(r.native, decode);
  const settingsNow = r.stream ? micSettings(r.stream) : {};
  if (r.stream) { r.stream.getTracks().forEach((t) => t.stop()); try { r.input.disconnect(); } catch { /* fine */ } }
  setSession('playback');
  const sr = ctx.sampleRate;
  let take = { l: data.l, r: data.r, startTime: data.startTime };
  if (r.source === 'mic') {
    toast('Cleaning up the take…');
    take = await bestTake(data, nat, settingsNow);
    ui.lastTake = take.info;
  }
  const drop = Math.round((r.t0 + (r.source === 'mic' ? latencySec() : 0) - take.startTime) * sr);
  let l = take.l, rr = take.r || take.l;
  if (drop > 0) { l = l.subarray(drop); rr = rr.subarray(drop); }
  if (l.length < sr * 0.25) { engine.pos = r.from; toast('Take too short, nothing saved'); render(); return; }
  const stereo = r.source !== 'mic';
  const buf = ctx.createBuffer(stereo ? 2 : 1, l.length, sr);
  buf.getChannelData(0).set(l);
  if (stereo) buf.getChannelData(1).set(rr);
  const start = drop < 0 ? r.from + -drop / sr : r.from;
  await addTrack(nextName(r.source === 'mic' ? 'Vocal' : 'Keys'), buf, start);
  engine.pos = r.from;
  toast('Take saved');
  render();
}

// --- Beat ------------------------------------------------------------------
function beatTab() {
  const d = project.drums;
  const grid = h('div', { class: 'grid' });
  for (const v of VOICES) {
    const row = h('div', { class: 'grid-row' }, h('button', { class: 'vlabel', onpointerdown: () => audition(v.id) }, v.name));
    for (let i = 0; i < 16; i++) {
      row.append(h('button', {
        class: 'step' + (i % 4 === 0 ? ' q' : '') + (d.pattern[v.id][i] ? ' on' : ''),
        'data-step': i, 'aria-label': `${v.name} step ${i + 1}`,
        onpointerdown: (e) => {
          d.pattern[v.id][i] = !d.pattern[v.id][i];
          e.currentTarget.classList.toggle('on', d.pattern[v.id][i]);
          if (d.pattern[v.id][i] && !engine.playing) audition(v.id);
          changedQuiet();
        },
      }));
    }
    grid.append(row);
  }
  const loadBeat = (name) => {
    const src = BEATS[name];
    d.pattern = name === 'Clear' ? emptyPattern() : Object.fromEntries(VOICES.map((v) => [v.id, src[v.id].slice()]));
    if (!project.tracks.length) {
      if (name === 'Screw') project.bpm = 68;
      if (name === 'Trap') project.bpm = 140;
      if (name === 'Boom bap') project.bpm = 90;
    }
    changed();
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Beat'), h('span', { class: 'hint' }, 'Tap a name to hear it')),
      h('div', { class: 'chips' }, ['Trap', 'Boom bap', 'Screw', 'Clear'].map((n) => h('button', { class: 'chip', onclick: () => loadBeat(n) }, n))),
      grid),
    h('div', { class: 'card' },
      slider('Volume', d.vol, 0, 1.5, 0.01, (v) => { d.vol = v; engine.updateMix(); changedQuiet(); }, (v) => `${Math.round(v * 100)}%`),
      slider('Swing', d.swing, 0, 0.5, 0.01, (v) => { d.swing = v; changedQuiet(); }, (v) => `${Math.round(v * 200)}%`),
      slider('808 tune', d.tune, -12, 12, 1, (v) => { d.tune = v; changedQuiet(); audition('808'); }, (v) => `${v > 0 ? '+' : ''}${v} st`),
      h('p', { class: 'hint' }, 'Press play up top to hear the beat loop under your tracks.')));
}

function audition(id) {
  ctx.resume();
  playDrum(ctx, engine.drumBus, id, ctx.currentTime + 0.01, { tune: project.drums.tune });
}

// --- Keys ------------------------------------------------------------------
function keysTab() {
  const kb = h('div', { class: 'kb', 'aria-label': 'Piano keyboard' });
  const base = 12 * (ui.keysOctave + 1);
  const whites = 15;
  const BLACK = [1, 3, 6, 8, 10];
  let wi = 0;
  for (let n = 0; n <= 24; n++) {
    const pc = n % 12;
    if (BLACK.includes(pc)) {
      kb.append(h('div', { class: 'key black', 'data-midi': base + n, style: `left:calc(${(wi / whites) * 100}% - 2.2%)` }));
    } else {
      kb.append(h('div', { class: 'key white', 'data-midi': base + n }, pc === 0 ? h('span', { class: 'kl' }, 'C' + (ui.keysOctave + n / 12)) : null));
      wi++;
    }
  }
  const active = new Map();
  const press = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest ? el.closest('.key') : null;
    const m = k ? +k.dataset.midi : null;
    const prev = active.get(e.pointerId);
    if (prev && prev.m === m) return;
    if (prev && prev.m != null) { synth.noteOff(prev.m); prev.el.classList.remove('down'); }
    if (m != null) { synth.noteOn(m); k.classList.add('down'); }
    active.set(e.pointerId, { m, el: k });
  };
  const release = (e) => {
    const prev = active.get(e.pointerId);
    if (prev && prev.m != null) { synth.noteOff(prev.m); prev.el.classList.remove('down'); }
    active.delete(e.pointerId);
  };
  kb.addEventListener('pointerdown', (e) => { e.preventDefault(); ctx.resume(); try { kb.setPointerCapture(e.pointerId); } catch { /* fine */ } press(e); });
  kb.addEventListener('pointermove', (e) => { if (active.has(e.pointerId)) press(e); });
  kb.addEventListener('pointerup', release);
  kb.addEventListener('pointercancel', release);

  const recBtn = h('button', { class: 'btn big ' + (rec ? 'recording' : 'primary'), onclick: () => {
    if (rec) return stopRecording();
    project.recSource = 'keys';
    startRecording();
  } }, rec ? '■ Stop recording' : '● Record keys');

  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h2', {}, 'Keys'),
      seg(Object.entries(SYNTH_PRESETS).map(([k, v]) => [k, v.name]), synth.preset, (v) => { synth.preset = v; render(); }),
      h('div', { class: 'row' },
        h('button', { class: 'chip', onclick: () => { ui.keysOctave = Math.max(1, ui.keysOctave - 1); render(); } }, '− Octave'),
        h('span', { class: 'grow', style: 'text-align:center;font-weight:600' }, `C${ui.keysOctave} – C${ui.keysOctave + 2}`),
        h('button', { class: 'chip', onclick: () => { ui.keysOctave = Math.min(6, ui.keysOctave + 1); render(); } }, '+ Octave')),
      slider('Tone', synth.tone, 0.2, 2.5, 0.01, (v) => { synth.tone = v; }, (v) => (v < 0.8 ? 'Dark' : v > 1.4 ? 'Bright' : 'Warm')),
      slider('Volume', synth.out.gain.value, 0, 1, 0.01, (v) => { synth.out.gain.value = v; }, (v) => `${Math.round(v * 100)}%`)),
    kb,
    recBtn,
    h('p', { class: 'hint' }, 'Recording keys plays the beat with a count-in and saves what you play as a new track.'));
}

const KEYMAP = 'awsedftgyhujkolp;';
const held = new Set();
window.addEventListener('keydown', (e) => {
  if (tab !== 'keys' || e.repeat || e.target.tagName === 'INPUT') return;
  const i = KEYMAP.indexOf(e.key);
  if (i < 0) return;
  ctx.resume();
  const m = 12 * (ui.keysOctave + 1) + i;
  held.add(m);
  synth.noteOn(m);
});
window.addEventListener('keyup', (e) => {
  const i = KEYMAP.indexOf(e.key);
  if (i < 0) return;
  const m = 12 * (ui.keysOctave + 1) + i;
  if (held.delete(m)) synth.noteOff(m);
});

// --- Auto-Tune ---------------------------------------------------------------
function tuneTab() {
  const tracks = project.tracks;
  if (!tracks.length) {
    return h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', {}, 'Auto-Tune'),
      h('p', { class: 'hint' }, 'Record or import a vocal first, then tune it here.'),
      h('button', { class: 'btn primary', onclick: () => { tab = 'studio'; render(); } }, 'Go to Studio')));
  }
  const t = tracks.find((x) => x.id === ui.tuneTrackId) || tracks[0];
  ui.tuneTrackId = t.id;
  t.tune = Object.assign({ key: project.key, scale: project.scale, speed: 0, amount: 1 }, t.tune);
  const graph = h('canvas', { class: 'pitch', 'aria-label': 'Pitch graph' });
  queueDraw(() => drawPitch(graph, t));
  const onParam = () => { changedQuiet(); drawPitch(graph, t); };
  const preset = (label, speed, amount) => h('button', {
    class: 'chip' + (t.tune.speed === speed && t.tune.amount === amount ? ' on' : ''),
    onclick: () => { t.tune.speed = speed; t.tune.amount = amount; changed(); },
  }, label);

  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('h2', {}, 'Auto-Tune'),
      h('p', { class: 'hint' }, 'Snaps your voice to the notes of the key. Speed 0 is the hard, robotic sound; slower speeds sound natural.'),
      field('Track', select(tracks.map((x) => [x.id, x.name]), t.id, (v) => { ui.tuneTrackId = v; render(); }, 'Track')),
      h('div', { class: 'chips' }, preset('Hard (robot)', 0, 1), preset('Natural', 60, 0.9), preset('Subtle', 120, 0.6)),
      h('div', { class: 'row2' },
        field('Key', select(NOTE_NAMES.map((n, i) => [i, n]), t.tune.key, (v) => { t.tune.key = +v; project.key = +v; onParam(); }, 'Key')),
        field('Scale', select(Object.keys(SCALES).map((s) => [s, cap(s)]), t.tune.scale, (v) => { t.tune.scale = v; project.scale = v; onParam(); }, 'Scale'))),
      h('button', { class: 'btn', disabled: ui.busy, onclick: () => detectKeyFor(t) }, 'Detect key from the vocal'),
      slider('Speed', t.tune.speed, 0, 200, 1, (v) => { t.tune.speed = v; onParam(); }, (v) => (v === 0 ? 'Robot' : `${v} ms`)),
      slider('Amount', t.tune.amount, 0, 1, 0.01, (v) => { t.tune.amount = v; onParam(); }, (v) => `${Math.round(v * 100)}%`),
      h('button', { class: 'btn primary big', disabled: ui.busy, onclick: () => applyTune(t) }, t.tuned ? 'Re-apply Auto-Tune' : 'Apply Auto-Tune'),
      h('div', { class: 'status', id: 'tuneStatus' }, t.tuned ? (t.useTuned ? 'Tuned take is playing in the mix.' : 'Tuned take saved; the mix is using the original.') : '')),
    h('div', { class: 'card' },
      h('div', { class: 'card-title' }, 'Pitch'),
      graph,
      h('div', { class: 'legend' }, h('span', {}, h('i', { style: 'background:rgba(200,210,222,.7)' }), 'Your voice'), h('span', {}, h('i', { style: 'background:#F06617' }), 'Tuned'))),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => togglePreview(t.raw, 'orig') }, preview && preview.tag === 'orig' ? '■ Stop' : '▶ Original'),
        h('button', { class: 'btn', disabled: !t.tuned, onclick: () => togglePreview(t.tuned, 'tuned') }, preview && preview.tag === 'tuned' ? '■ Stop' : '▶ Tuned')),
      t.tuned ? h('div', { class: 'row' },
        chip('Use tuned take in the mix', t.useTuned, (v) => { t.useTuned = v; changed(); }),
        h('button', { class: 'btn danger', style: 'flex:0 0 auto', onclick: () => removeTune(t) }, 'Remove tune')) : null));
}

function setStatus(id, text, busy) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('busy', !!busy);
}

function monoOf(buf) {
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  return mixToMono(chans);
}

async function analyze(t) {
  if (t._analysis) return t._analysis;
  setStatus('tuneStatus', 'Finding the pitch…', true);
  t._analysis = await runDsp('analyzePitch', { mono: monoOf(t.raw), sr: t.raw.sampleRate },
    (v) => setStatus('tuneStatus', `Finding the pitch… ${Math.round(v * 100)}%`, true));
  return t._analysis;
}

async function detectKeyFor(t) {
  ui.busy = true;
  render();
  try {
    const a = await analyze(t);
    const k = detectKey(a.f0);
    ui.busy = false;
    if (!k) { render(); setStatus('tuneStatus', 'Not enough singing to find the key.'); return; }
    t.tune.key = k.key; t.tune.scale = k.scale;
    project.key = k.key; project.scale = k.scale;
    changed();
    setStatus('tuneStatus', `Sounds like ${NOTE_NAMES[k.key]} ${k.scale}.`);
  } catch (e) {
    ui.busy = false;
    render();
    setStatus('tuneStatus', 'Key detection failed: ' + e.message);
  }
}

async function applyTune(t) {
  ui.busy = true;
  stopPreview();
  render();
  try {
    const a = await analyze(t);
    setStatus('tuneStatus', 'Tuning…', true);
    const mono = monoOf(t.raw);
    const res = await runDsp('applyTune', { mono, sr: t.raw.sampleRate, f0: a.f0, hop: a.hop, opts: { ...t.tune } });
    const buf = ctx.createBuffer(1, res.out.length, t.raw.sampleRate);
    buf.getChannelData(0).set(res.out);
    t.tuned = buf;
    t.useTuned = true;
    await store.putAudio(audioKey(t, 'tuned'), buf);
    ui.busy = false;
    changed();
    setStatus('tuneStatus', 'Done. The tuned take is in the mix. Tap ▶ Tuned to hear it alone.');
  } catch (e) {
    ui.busy = false;
    render();
    setStatus('tuneStatus', 'Auto-Tune failed: ' + e.message);
  }
}

async function removeTune(t) {
  t.tuned = null;
  t.useTuned = false;
  await store.putAudio(audioKey(t, 'tuned'), null);
  changed();
}

function togglePreview(buf, tag) {
  if (preview && preview.tag === tag) { stopPreview(); render(); return; }
  stopPreview();
  if (!buf) return;
  engine.stop();
  live.pause();
  ctx.resume();
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(previewOut);
  s.start();
  s.onended = () => { if (preview && preview.src === s) { preview = null; render(); } };
  preview = { src: s, tag };
  render();
}

function stopPreview() {
  if (!preview) return;
  const p = preview;
  preview = null;
  p.src.onended = null;
  try { p.src.stop(); } catch { /* done */ }
}

// --- Chopped & Screwed --------------------------------------------------------
function screwTab() {
  const p = project;
  const s = p.screw;
  const sources = [['mix', 'Full mix (beat + all tracks)'], ...p.tracks.map((t) => [t.id, t.name])];
  if (!sources.some(([v]) => v === ui.screwSource)) ui.screwSource = 'mix';
  const songBpm = () => s.bpm || p.bpm;
  const info = h('div', { class: 'screw-info' });
  const setInfo = () => { info.textContent = `Plays at ${Math.round(songBpm() * s.rate)} BPM, ${(12 * Math.log2(s.rate)).toFixed(1)} semitones lower`; };
  setInfo();
  const sourceIsImport = ui.screwSource !== 'mix';

  const card = h('div', { class: 'card' },
    h('h2', {}, 'Chopped & Screwed'),
    h('p', { class: 'hint' }, 'Slows the record down so it drops in pitch, chops it on the beat, and adds a dark echo. Then chop it live with the pads.'),
    field('What to screw', select(sources, ui.screwSource, (v) => { ui.screwSource = v; render(); }, 'Source')),
    sourceIsImport ? field("Song's BPM (for the chops)", h('input', { type: 'number', inputmode: 'decimal', min: 40, max: 220, value: songBpm(),
      onchange: (e) => { const v = +e.target.value; s.bpm = v >= 40 && v <= 220 ? v : null; changedQuiet(); setInfo(); } })) : null,
    slider('Slow down', s.rate, 0.5, 1, 0.01, (v) => { s.rate = v; changedQuiet(); setInfo(); }, (v) => `${Math.round(v * 100)}%`),
    info,
    h('div', { class: 'field' }, 'Chops',
      seg([['none', 'None'], ['repeat', 'Repeat'], ['stutter', 'Stutter'], ['backspin', 'Spin'], ['mix', 'Mix']], s.style, (v) => { s.style = v; changed(); })),
    s.style !== 'none' ? h('div', { class: 'row2' },
      h('div', { class: 'field' }, 'Every', seg([[1, '1 bar'], [2, '2'], [4, '4']], s.every, (v) => { s.every = v; changed(); })),
      h('div', { class: 'field' }, 'Chop length', seg([[0.5, '½ beat'], [1, '1'], [2, '2']], s.beats, (v) => { s.beats = v; changed(); }))) : null,
    slider('Echo', s.echo, 0, 1, 0.01, (v) => { s.echo = v; changedQuiet(); }, (v) => `${Math.round(v * 100)}%`),
    slider('Muffle', s.muffle, 0, 1, 0.01, (v) => { s.muffle = v; changedQuiet(); }, (v) => `${Math.round(v * 100)}%`),
    h('button', { class: 'btn primary big', disabled: ui.busy, onclick: makeScrewed }, ui.screwResult ? 'Screw it again' : 'Screw it'),
    h('div', { class: 'status', id: 'screwStatus' }));

  const out = h('div', { class: 'stack' }, card);
  const r = ui.screwResult;
  if (r) {
    const c = h('canvas', {});
    const wave = h('div', { class: 'wave', style: 'height:70px', onpointerdown: (e) => {
      const rc = wave.getBoundingClientRect();
      live.offset = Math.min(1, Math.max(0, (e.clientX - rc.left) / rc.width)) * live.duration;
      if (live.playing) live.play();
    } }, c, h('div', { class: 'ph ph-live' }));
    queueDraw(() => drawWave(c, r.buffer, 0, r.buffer.duration, '#F06617'));
    const pad = (label, sub, fn) => h('button', { class: 'pad', onpointerdown: (e) => { e.preventDefault(); fn(); flash(e.currentTarget); } }, label, h('small', {}, sub));
    out.append(h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', { class: 'card-title grow' }, `Screwed · ${fmtTime(r.buffer.duration)} · ${Math.round(r.bpm)} BPM`)),
      wave,
      h('div', { class: 'row' },
        h('button', { class: 'btn', id: 'livePlay', onclick: () => { engine.stop(); stopPreview(); ctx.resume(); live.toggle(); } }, live.playing ? '❚❚ Pause' : '▶ Play'),
        h('button', { class: 'btn', onclick: () => live.rewind() }, '⏮ Start')),
      h('div', { class: 'pads' },
        pad('CHOP', 'back 1 beat', () => live.chop(1)),
        pad('DOUBLE', 'back ½ beat', () => live.chop(0.5)),
        pad('SPIN', 'backspin', () => live.spin()),
        pad('BRAKE', 'tape stop', () => live.brake())),
      h('button', { class: 'btn big ' + (ui.perfRec ? 'recording' : ''), id: 'perfBtn', onclick: togglePerfRec },
        ui.perfRec ? '■ Stop and save my chops' : '● Record my chops'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: saveScrewAsTrack }, 'Save as track'),
        h('button', { class: 'btn', onclick: () => fileReady(encodeWav(chansOf(r.buffer), r.buffer.sampleRate), `${safeName(project.name)} (chopped and screwed).wav`) }, 'Export WAV'))));
  }
  return out;
}

function flash(el) { el.classList.add('hit'); setTimeout(() => el.classList.remove('hit'), 120); }
const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim() || 'E-Studio';
function chansOf(buf) {
  const c = [];
  for (let i = 0; i < buf.numberOfChannels; i++) c.push(buf.getChannelData(i));
  return c;
}

async function makeScrewed() {
  ui.busy = true;
  engine.stop();
  stopPreview();
  live.pause();
  render();
  try {
    let buf;
    if (ui.screwSource === 'mix') {
      setStatus('screwStatus', 'Mixing down…', true);
      buf = await engine.renderMix();
      const chans = ceiling(chansOf(buf));
      chans.forEach((c, i) => buf.getChannelData(i).set(c));
    } else {
      buf = bufferOf(project.tracks.find((t) => t.id === ui.screwSource));
    }
    setStatus('screwStatus', 'Screwing it down…', true);
    const s = project.screw;
    const bpm = ui.screwSource === 'mix' ? project.bpm : (s.bpm || project.bpm);
    const chans = chansOf(buf).map((c) => c.slice());
    if (chans.length === 1) chans.push(chans[0].slice());
    const res = await runDsp('screw', { chans, sr: buf.sampleRate, bpm, opts: { ...s } });
    const out = ctx.createBuffer(2, res.chans[0].length, buf.sampleRate);
    out.getChannelData(0).set(res.chans[0]);
    out.getChannelData(1).set(res.chans[1]);
    ui.screwResult = { buffer: out, bpm: bpm * s.rate };
    live.load(out, 60 / (bpm * s.rate));
    ui.busy = false;
    render();
    setStatus('screwStatus', 'Ready. Press play and hit the pads.');
  } catch (e) {
    ui.busy = false;
    render();
    setStatus('screwStatus', 'Something went wrong: ' + e.message);
  }
}

async function saveScrewAsTrack() {
  if (!ui.screwResult) return;
  await addTrack(nextName('Screwed'), ui.screwResult.buffer, 0);
  toast('Saved as a track in Studio');
}

async function togglePerfRec() {
  if (!ui.perfRec) {
    await ctx.resume();
    await perfRecorder.start(live.out);
    ui.perfRec = true;
    if (!live.playing) live.play();
    render();
    toast('Recording your chops');
    return;
  }
  ui.perfRec = false;
  const data = await perfRecorder.stop();
  render();
  if (!data || data.l.length < ctx.sampleRate * 0.5) { toast('Nothing recorded'); return; }
  const buf = ctx.createBuffer(2, data.l.length, data.sr);
  buf.getChannelData(0).set(data.l);
  buf.getChannelData(1).set(data.r);
  await addTrack(nextName('Chops'), buf, 0);
  toast('Your chops are saved as a track');
}

live.onstate = () => {
  const b = document.getElementById('livePlay');
  if (b) b.textContent = live.playing ? '❚❚ Pause' : '▶ Play';
};

// --- export / share --------------------------------------------------------------
async function exportMix() {
  closeSheet();
  if (!project.tracks.length && !VOICES.some((v) => project.drums.pattern[v.id].some(Boolean))) { toast('Nothing to export yet'); return; }
  toast('Mixing down…');
  const buf = await engine.renderMix();
  fileReady(encodeWav(ceiling(chansOf(buf)), buf.sampleRate), `${safeName(project.name)}.wav`);
}

// Keep the exported mix out of clipping.
function ceiling(chans) {
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
  if (peak <= 0.98) return chans;
  const g = 0.98 / peak;
  return chans.map((c) => c.map((v) => v * g));
}

// The share has to come from a fresh tap on iPhone, so the file waits on a button.
function fileReady(blob, name) {
  const file = new File([blob], name, { type: 'audio/wav' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const mb = (blob.size / 1048576).toFixed(1);
  openSheet('Your WAV is ready',
    h('p', { class: 'hint', style: 'margin-bottom:12px' }, `${name} · ${mb} MB`),
    canShare ? h('button', { class: 'btn primary big', onclick: async () => {
      try { await navigator.share({ files: [file], title: name }); closeSheet(); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message); }
    } }, 'Share or Save to Files') : null,
    h('button', { class: 'btn big', style: 'margin-top:8px', onclick: () => {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } }, 'Download'));
}

// --- sheets: menu, projects, tempo, settings ------------------------------------
function logoTile() { return h('span', { class: 'logo-tile', html: $('.top .logo-tile').innerHTML }); }

function openMenu() {
  openSheet(null,
    h('button', { class: 'mi', onclick: exportMix }, 'Export mix as WAV', h('small', {}, 'Share it, AirDrop it or save it to Files')),
    h('button', { class: 'mi', onclick: openProjects }, 'Projects', h('small', {}, 'Open or delete saved songs')),
    h('button', { class: 'mi', onclick: newProject }, 'New project'),
    h('button', { class: 'mi', onclick: openSettings }, 'Recording and mic test', h('small', {}, 'Check the mic, see how the last take was recorded, fix late takes')),
    h('button', { class: 'mi', onclick: openInstall }, 'Install on iPhone'),
    h('div', { class: 'about' }, logoTile(), h('div', {}, h('b', { style: 'color:var(--text)' }, 'E-Studio'), h('br'), `by E-Estimating LLC · version ${APP_VERSION}. Everything stays on this phone.`)));
}

async function openProjects() {
  const list = await store.listProjects();
  openSheet('Projects',
    h('button', { class: 'btn primary', style: 'width:100%;margin-bottom:8px', onclick: newProject }, '+ New project'),
    list.map((pr) => h('div', { class: 'proj-row' },
      h('div', { class: 'grow' }, pr.name + (pr.id === project.id ? ' (open)' : ''), h('small', {}, `${pr.tracks.length} tracks · ${pr.bpm} BPM · ${new Date(pr.updated).toLocaleDateString()}`)),
      pr.id !== project.id ? h('button', { class: 'chip', onclick: async () => { closeSheet(); engine.stop(); await loadProject(pr.id); } }, 'Open') : null,
      h('button', { class: 'chip', style: 'color:#ff6b61', onclick: async () => {
        if (!confirm(`Delete "${pr.name}" and all its takes? This can't be undone.`)) return;
        await store.deleteProject(pr.id);
        if (pr.id === project.id) { const np = newProjectData(); await store.saveProject(serialize(np)); openProject(np); }
        openProjects();
      } }, 'Delete'))));
}

async function newProject() {
  closeSheet();
  engine.stop();
  const name = prompt('Name your song', 'Untitled');
  if (name === null) return;
  const np = newProjectData(name.trim().slice(0, 40) || 'Untitled');
  await store.saveProject(serialize(np));
  openProject(np);
}

function openTempo() {
  const p = project;
  const big = h('div', { class: 'big-bpm' }, String(p.bpm));
  const barsEl = h('b', {}, String(p.bars));
  const set = (v) => { p.bpm = Math.max(40, Math.min(220, Math.round(v))); big.textContent = p.bpm; rng.value = p.bpm; if (engine.playing) engine.play(engine.position()); changed(); };
  const rng = h('input', { type: 'range', min: 40, max: 220, step: 1, value: p.bpm, 'aria-label': 'Tempo', oninput: (e) => set(+e.target.value) });
  const taps = [];
  openSheet('Tempo',
    big,
    rng,
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn', onclick: () => set(p.bpm - 1) }, '−1'),
      h('button', { class: 'btn primary', onclick: () => {
        const now = performance.now();
        if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
        taps.push(now);
        if (taps.length > 5) taps.shift();
        if (taps.length >= 2) set(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
      } }, 'Tap'),
      h('button', { class: 'btn', onclick: () => set(p.bpm + 1) }, '+1')),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('span', { class: 'grow' }, 'Song length: ', barsEl, ' bars'),
      h('button', { class: 'chip', onclick: () => { p.bars = Math.max(1, p.bars - 1); barsEl.textContent = p.bars; changed(); } }, '−'),
      h('button', { class: 'chip', onclick: () => { p.bars = Math.min(256, p.bars + 1); barsEl.textContent = p.bars; changed(); } }, '+')),
    h('p', { class: 'hint', style: 'margin-top:10px' }, 'Recorded takes keep their timing if you change the tempo later.'));
}

function takeReport(info) {
  if (!info) return null;
  const rate = (r) => (r ? `${r.toLocaleString()} Hz` : 'unknown');
  return h('div', { class: 'card', style: 'margin-bottom:12px;gap:6px' },
    h('div', { class: 'card-title' }, `Last take (${info.when})`),
    h('div', {}, 'Recorded with: ', h('b', {}, info.method)),
    h('div', { class: 'hint' }, `Mic ${rate(info.micRate)} · app ${rate(info.appRate)}${info.micRate && info.micRate !== info.appRate ? ' (different rates)' : ''}`),
    h('div', { class: 'hint' }, `Web Audio dropouts: ${info.webAudioDropouts}${info.confidence != null ? ` · sync match ${info.confidence}%` : ''} · echo cancel ${info.echoCancellation === undefined ? 'unknown' : info.echoCancellation ? 'on' : 'off'}`));
}

function playOnce(buf) {
  stopPreview();
  if (!buf) return;
  engine.stop();
  live.pause();
  ctx.resume();
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.connect(previewOut);
  s.start();
  s.onended = () => { if (preview && preview.src === s) preview = null; };
  preview = { src: s, tag: 'test' };
}

// Records 4 seconds both ways (the phone's recorder and Web Audio) so you can hear
// which one is clean, with or without the beat playing through the speaker.
async function micTest(withBeat) {
  const status = h('div', { class: 'status busy' }, 'Getting the mic…');
  const result = h('div', { class: 'stack', style: 'margin-top:12px' });
  openSheet('Mic test',
    h('p', { class: 'hint', style: 'margin-bottom:10px' }, withBeat
      ? 'Sing or talk for 4 seconds while the beat plays through the speaker.'
      : 'Sing or talk for 4 seconds. Nothing plays, so this tests the mic alone.'),
    status, result);
  if (rec) { status.textContent = 'Stop recording first.'; status.classList.remove('busy'); return; }
  engine.stop();
  live.pause();
  stopPreview();
  await ctx.resume();
  setSession('play-and-record');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(MIC); } catch {
    setSession('playback');
    status.classList.remove('busy');
    status.textContent = 'Microphone blocked. Allow it in Settings › Safari › Microphone.';
    return;
  }
  const input = ctx.createMediaStreamSource(stream);
  await recorder.start(input);
  const nat = startNative(stream, ctx);
  if (withBeat) engine.play(0);
  for (let s = 4; s > 0; s--) { status.textContent = `Recording… ${s}`; await wait(1000); }
  if (withBeat) engine.stop();
  const data = await recorder.stop();
  const n = await stopNative(nat, decode);
  const st = micSettings(stream);
  stream.getTracks().forEach((t) => t.stop());
  try { input.disconnect(); } catch { /* fine */ }
  setSession('playback');
  status.classList.remove('busy');
  status.textContent = 'Done. Play both and compare.';
  const wa = ctx.createBuffer(1, Math.max(1, data.l.length), ctx.sampleRate);
  wa.getChannelData(0).set(data.l);
  const info = { when: 'mic test', appRate: ctx.sampleRate, micRate: st.sampleRate || null, echoCancellation: st.echoCancellation,
    webAudioDropouts: countDropouts(data.l) + data.gaps, method: n ? `iPhone recorder works (${n.mime || 'audio'})` : 'iPhone recorder not available, Web Audio only', confidence: null };
  result.replaceChildren(
    takeReport(info),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: !n, onclick: () => playOnce(n && n.buf) }, '▶ iPhone recorder'),
      h('button', { class: 'btn', onclick: () => playOnce(wa) }, '▶ Web Audio')),
    h('p', { class: 'hint' }, 'Takes now use the iPhone recorder copy. If it is clean here but choppy with the beat, the phone is ducking your voice under the speaker: wear headphones.'));
}

function openSettings() {
  const auto = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0) + 0.01) * 1000);
  const cur = settings.latencyMs ?? auto;
  openSheet('Recording',
    takeReport(ui.lastTake),
    h('div', { class: 'row', style: 'margin-bottom:14px' },
      h('button', { class: 'btn', onclick: () => micTest(false) }, 'Test mic'),
      h('button', { class: 'btn', onclick: () => micTest(true) }, 'Test with beat')),
    h('div', { class: 'card-title', style: 'margin-bottom:6px' }, 'Timing'),
    h('p', { class: 'hint', style: 'margin-bottom:10px' }, 'If your vocals land behind the beat, raise this. If they land early, lower it. Bluetooth headphones need much more (200 ms or so); wired headphones are best.'),
    slider('Shift', cur, 0, 400, 1, (v) => { settings.latencyMs = v; saveSettings(); }, (v) => `${v} ms`),
    h('button', { class: 'btn', style: 'margin-top:10px', onclick: () => { settings.latencyMs = null; saveSettings(); openSettings(); } }, `Reset to automatic (${auto} ms)`),
    h('p', { class: 'hint', style: 'margin-top:10px' }, 'Takes you already recorded can be nudged from the track menu (••• › ±10 ms).'));
}

function openInstall() {
  openSheet('Install on iPhone',
    h('ol', { class: 'steps-list' },
      h('li', {}, 'Open this page in Safari.'),
      h('li', {}, 'Tap the Share button (the square with the arrow).'),
      h('li', {}, 'Tap “Add to Home Screen”, then “Add”.'),
      h('li', {}, 'Open E-Studio from your home screen. It runs full screen and works offline.')),
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'The first time you record, iPhone asks for the microphone. Tap Allow.'));
}

// ---------------------------------------------------------------------------
// wiring
function wire() {
  $('#btnHome').innerHTML = ICON.home;
  $('#btnMetro').innerHTML = ICON.metro;
  $('#btnLoop').innerHTML = ICON.loop;
  $('#menuBtn').innerHTML = ICON.more;
  document.querySelectorAll('[data-icon]').forEach((i) => { i.innerHTML = ICON[i.dataset.icon]; });

  $('#btnPlay').addEventListener('click', async () => {
    await ctx.resume();
    if (rec) return stopRecording();
    stopPreview();
    live.pause();
    if (engine.playing) engine.stop(); else engine.play(engine.pos);
    renderTransport();
  });
  $('#btnRec').addEventListener('click', () => (rec ? stopRecording() : startRecording()));
  $('#btnHome').addEventListener('click', () => { if (rec) return; engine.seek(0); });
  $('#btnMetro').addEventListener('click', () => { project.metronome = !project.metronome; changed(); });
  $('#btnLoop').addEventListener('click', () => { project.loop = !project.loop; if (engine.playing) engine.play(engine.position()); changed(); });
  $('#bpmBtn').addEventListener('click', openTempo);
  $('#menuBtn').addEventListener('click', openMenu);
  $('#projName').addEventListener('click', () => {
    const n = prompt('Song name', project.name);
    if (n && n.trim()) { project.name = n.trim().slice(0, 40); changed(); }
  });
  $('.sheet-backdrop').addEventListener('click', closeSheet);
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; synth.allOff(); render(); $('#main').scrollTop = 0; }));
  engine.onEnded = () => renderTransport();

  // iOS starts audio only from a tap; also let it play with the silent switch on.
  const unlock = () => {
    setSession('playback');
    ctx.resume();
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start();
    if (ctx.state === 'running') document.removeEventListener('pointerdown', unlock, true);
  };
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ctx.resume(); });

  let lastW = window.innerWidth;
  window.addEventListener('resize', () => { if (Math.abs(window.innerWidth - lastW) > 20) { lastW = window.innerWidth; render(); } });
}

// Animation: clock, playheads, the current beat step.
let lastStep = -1;
function frame() {
  if (project) {
    const pos = engine.position();
    const L = engine.playing ? engine.L || engine.songLength() : engine.songLength();
    const counting = engine.playing && pos < engine.from;
    $('#clockTime').textContent = counting ? 'Count-in' : fmtTime(pos);
    const bar = engine.barSec;
    const pp = Math.max(0, pos);
    $('#clockBar').textContent = `bar ${Math.floor(pp / bar) + 1}.${Math.floor((pp % bar) / engine.beatSec) + 1}`;
    const pct = Math.min(100, (Math.max(0, pos) / L) * 100);
    document.querySelectorAll('#tab-studio .ph').forEach((el) => { el.style.left = pct + '%'; });
    if (rec) {
      const rt = document.getElementById('recTime');
      if (rt) rt.textContent = counting ? 'count-in…' : fmtTime(pos - rec.from);
    }
    const step = engine.playing && !counting ? Math.floor(pos / engine.stepSec) % 16 : -1;
    if (step !== lastStep && tab === 'beat') {
      document.querySelectorAll('.step.cur').forEach((el) => el.classList.remove('cur'));
      if (step >= 0) document.querySelectorAll(`.step[data-step="${step}"]`).forEach((el) => el.classList.add('cur'));
      lastStep = step;
    }
    if (tab === 'screw' && live.duration > 0) {
      const lp = document.querySelector('.ph-live');
      if (lp) lp.style.left = (live.position() / live.duration) * 100 + '%';
    }
    if (engine.playing !== frame.wasPlaying) { frame.wasPlaying = engine.playing; renderTransport(); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  wire();
  store.askPersistent();
  let ok = false;
  try { if (settings.lastProject) ok = await loadProject(settings.lastProject); } catch (e) { console.warn(e); }
  if (!ok) {
    const p = newProjectData('My first song');
    p.drums.pattern = Object.fromEntries(VOICES.map((v) => [v.id, BEATS.Trap[v.id].slice()]));
    try { await store.saveProject(serialize(p)); } catch { /* storage blocked */ }
    openProject(p);
  }
  requestAnimationFrame(frame);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && !local && location.protocol === 'https:') {
    // When a new version takes over, reload once so it's the one running.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !rec) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => { /* offline mode is optional */ });
  }
}

boot();
window.__estudio = { engine, live, recorder, bestTake, startNative, stopNative, decode, get project() { return project; } };
