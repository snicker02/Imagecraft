// main.js — Imagecraft. Ties the engine modules to the interface.

import * as Pal from './engine/palette.js';
import * as Pix from './engine/pixelize.js';
import { mapToBlocks, mapError, DITHER_MODES, DEFAULT_MAP_OPTS } from './engine/mapper.js';
import { voxelize, buildMesh, meshToObj, BUILD_MODES, DEFAULT_BUILD } from './engine/mesh.js';
import { Viewer } from './engine/renderer.js';
import { MATCH_MODES } from './engine/color.js';
import { buildStructure, splitVolume } from './engine/mcstructure.js';
import * as Ex from './engine/exporters.js';

const $ = id => document.getElementById(id);

const S = {
  source: null, adjusted: null, pix: null, grid: null, vox: null, mesh: null,
  blocks: [],
  groups: new Set(Pal.DEFAULT_GROUPS),
  disabled: new Set(),
  excludeTags: new Set(),
  locks: new Map(),
  brush: null,
  imgName: '',
  adjust: { ...Pix.DEFAULT_ADJUST },
  gw: 128, gh: 128, lockAspect: true, resample: 'box',
  map: { ...DEFAULT_MAP_OPTS },
  build: { ...DEFAULT_BUILD },
  legacy: false, airfill: false, maxtile: 64, budget: 1000000,
  view2d: { scale: 4, ox: 0, oy: 0, fitted: false, lines: false },
  meshSkipped: false,
};

const TAGS = [
  ['gravity', 'falling blocks'],
  ['flammable', 'flammable'],
  ['transparent', 'see-through'],
  ['glow', 'light-emitting'],
  ['rare', 'expensive'],
];

const PRESETS = {
  'photo': {
    label: 'Photograph', groups: ['concrete', 'terracotta', 'wool', 'stone'],
    map: { dither: 'floyd', strength: 0.85, matchMode: 'lab76' }, resample: 'box',
    adjust: { saturation: 0.05, contrast: 0.05 },
  },
  'poster': {
    label: 'Flat poster', groups: ['concrete', 'wool'],
    map: { dither: 'none', matchMode: 'lab2000' }, resample: 'median',
    adjust: { posterize: 8, saturation: 0.2, sharpen: 0.3 },
  },
  'wool-only': {
    label: 'Wool only', groups: ['wool'],
    map: { dither: 'atkinson', strength: 0.9, matchMode: 'lab76' }, resample: 'box',
    adjust: { saturation: 0.15 },
  },
  'terrain': {
    label: 'Terrain & wood', groups: ['nature', 'stone', 'wood', 'leaves'],
    map: { dither: 'floyd', strength: 0.8, matchMode: 'lab76' }, resample: 'box', adjust: {},
  },
  'grayscale': {
    label: 'Greyscale stone', groups: ['stone', 'mineral'],
    map: { dither: 'bayer4', strength: 0.6, matchMode: 'lab76' }, resample: 'box',
    adjust: { saturation: -1, contrast: 0.1 },
  },
  'nether': {
    label: 'Nether', groups: ['nether', 'stone'],
    map: { dither: 'floyd', strength: 0.85, matchMode: 'lab76' }, resample: 'box',
    adjust: { saturation: 0.1 },
  },
  'survival': {
    label: 'Easy to gather', groups: ['wool', 'terracotta', 'stone', 'wood', 'nature'],
    excludeTags: ['rare', 'gravity'],
    map: { dither: 'floyd', strength: 0.85, matchMode: 'lab76' }, resample: 'box', adjust: {},
  },
  'everything': {
    label: 'Every block', groups: Pal.GROUPS.map(g => g.id),
    map: { dither: 'floyd', strength: 0.85, matchMode: 'lab76' }, resample: 'box', adjust: {},
  },
};

// ---------------------------------------------------------------- scheduling
const LEVELS = { adjust: 0, grid: 1, map: 2, vox: 3, draw: 4 };
let pending = 99, queued = false;

function schedule(level) {
  pending = Math.min(pending, LEVELS[level]);
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; const p = pending; pending = 99; run(p); });
}

function run(from) {
  if (!S.source) { updateStats(); return; }
  try {
    if (from <= LEVELS.adjust) {
      S.adjusted = Pix.adjust(S.source, S.adjust);
      drawSource();
    }
    if (from <= LEVELS.grid) {
      if (S.lockAspect) {
        S.gh = Math.max(1, Math.round(S.gw * S.source.h / S.source.w));
        $('gh').value = S.gh; $('gh-r').value = Math.min(512, S.gh);
      }
      S.pix = Pix.resample(S.adjusted, S.gw, S.gh, S.resample);
      S.view2d.fitted = false;
    }
    if (from <= LEVELS.map) {
      S.blocks = Pal.selectBlocks({ groups: S.groups, disabled: S.disabled, excludeTags: S.excludeTags });
      S.grid = mapToBlocks(S.pix, S.blocks, S.map, S.locks);
      renderMaterials();
      refreshCounts();
    }
    if (from <= LEVELS.vox) {
      S.vox = voxelize(S.grid, S.build);
      buildAndUpload();
    }
    draw2D();
    updateStats();
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), true);
  }
}

function buildAndUpload() {
  S.meshSkipped = S.vox.count > 900000;
  S.mesh = S.meshSkipped ? null : buildMesh(S.vox, S.blocks);
  if (!viewer) return;
  viewer.setMesh(S.mesh || { data: new Float32Array(0), verts: 0, stride: 7 }, S.vox);
  if (S.mesh && !viewerFramed) { viewer.frame(); viewerFramed = true; }
}

// ---------------------------------------------------------------- 2D preview
const off = document.createElement('canvas');
const offCtx = off.getContext('2d');

function paintOffscreen() {
  const g = S.grid;
  if (!g) return;
  if (off.width !== g.w || off.height !== g.h) { off.width = g.w; off.height = g.h; }
  const img = offCtx.createImageData(g.w, g.h);
  for (let i = 0; i < g.w * g.h; i++) {
    const o = i * 4;
    if (g.index[i] < 0) { img.data[o + 3] = 0; continue; }
    img.data[o] = g.rgb[i * 3]; img.data[o + 1] = g.rgb[i * 3 + 1];
    img.data[o + 2] = g.rgb[i * 3 + 2]; img.data[o + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
}

function fit2d() {
  const c = $('c2d'), g = S.grid;
  if (!g) return;
  const w = c.clientWidth, h = c.clientHeight;
  const s = Math.min(w / g.w, h / g.h) * 0.92;
  S.view2d.scale = s;
  S.view2d.ox = (w - g.w * s) / 2;
  S.view2d.oy = (h - g.h * s) / 2;
  S.view2d.fitted = true;
}

function draw2D() {
  const c = $('c2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
  ctx.fillStyle = '#0e1015';
  ctx.fillRect(0, 0, c.clientWidth, c.clientHeight);
  if (!S.grid) return;
  if (!S.view2d.fitted) fit2d();
  paintOffscreen();

  const { scale, ox, oy } = S.view2d;
  const gw = S.grid.w * scale, gh = S.grid.h * scale;

  // checkerboard behind so cut-out areas read as empty
  const t = 8;
  ctx.save();
  ctx.beginPath(); ctx.rect(ox, oy, gw, gh); ctx.clip();
  for (let y = 0; y < gh; y += t) for (let x = 0; x < gw; x += t) {
    ctx.fillStyle = ((x / t + y / t) & 1) ? '#181b22' : '#141720';
    ctx.fillRect(ox + x, oy + y, t, t);
  }
  ctx.restore();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, ox, oy, gw, gh);

  if (S.view2d.lines && scale >= 5) {
    ctx.strokeStyle = 'rgba(0,0,0,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= S.grid.w; x++) { const px = Math.round(ox + x * scale) + .5; ctx.moveTo(px, oy); ctx.lineTo(px, oy + gh); }
    for (let y = 0; y <= S.grid.h; y++) { const py = Math.round(oy + y * scale) + .5; ctx.moveTo(ox, py); ctx.lineTo(ox + gw, py); }
    ctx.stroke();
  }
  // painted cells get a corner tick
  if (S.locks.size && scale >= 4) {
    ctx.fillStyle = 'rgba(91,141,209,.9)';
    for (const ci of S.locks.keys()) {
      const x = ci % S.grid.w, y = (ci / S.grid.w) | 0;
      ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(2, scale * 0.22), Math.max(2, scale * 0.22));
    }
  }
  ctx.strokeStyle = '#2a2f3b';
  ctx.strokeRect(ox - .5, oy - .5, gw + 1, gh + 1);
}

function drawSource() {
  const c = $('csrc');
  if (!S.adjusted) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(c.clientWidth * dpr); c.height = Math.round(c.clientHeight * dpr);
  const ctx = c.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = S.adjusted.w; tmp.height = S.adjusted.h;
  tmp.getContext('2d').putImageData(Pix.toImageData(S.adjusted), 0, 0);
  const s = Math.min(c.width / tmp.width, c.height / tmp.height) * 0.94;
  ctx.fillStyle = '#0e1015'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, (c.width - tmp.width * s) / 2, (c.height - tmp.height * s) / 2, tmp.width * s, tmp.height * s);
}

function cellAt(ev) {
  const c = $('c2d'), r = c.getBoundingClientRect();
  const x = Math.floor((ev.clientX - r.left - S.view2d.ox) / S.view2d.scale);
  const y = Math.floor((ev.clientY - r.top - S.view2d.oy) / S.view2d.scale);
  if (!S.grid || x < 0 || y < 0 || x >= S.grid.w || y >= S.grid.h) return null;
  return { x, y, i: y * S.grid.w + x };
}

// ---------------------------------------------------------------- stats & UI
function updateStats() {
  const g = S.grid;
  $('stat-size').textContent = g ? `${g.w}×${g.h}` : '—';
  const n = S.vox ? S.vox.count : 0;
  $('stat-blocks').textContent = n ? n.toLocaleString() : '—';
  $('stat-kinds').textContent = g ? String(g.counts.size) : '—';
  $('stat-error').textContent = (g && S.pix) ? mapError(S.pix, g).toFixed(1) : '—';

  const note = $('budget-note');
  const parts = [];
  if (S.vox) {
    const tiles = S.vox.count ? splitVolume(S.vox, S.maxtile).length : 0;
    parts.push(`${tiles} structure${tiles === 1 ? '' : 's'} at ${S.maxtile}³`);
    if (n > S.budget) parts.push(`over budget by ${(n - S.budget).toLocaleString()}`);
    if (S.meshSkipped) parts.push('3D preview off above 900k blocks');
  }
  note.textContent = parts.join(' · ');
  note.className = 'note' + (S.vox && n > S.budget ? ' warn' : '');
  $('empty').classList.toggle('hidden', !!S.source);
}

let toastEl = null, toastTimer = 0;
function toast(msg, bad) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);' +
      'background:#1f232d;border:1px solid #2a2f3b;border-radius:5px;padding:8px 14px;z-index:50;' +
      'font-size:12.5px;max-width:70vw;box-shadow:0 8px 24px rgba(0,0,0,.45)';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.color = bad ? '#cf6b5c' : '#d7dbe4';
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.display = 'none'; }, 4200);
}

// ---------------------------------------------------------------- palette UI
const rowEls = new Map();

function buildPaletteUI() {
  const groups = $('groups');
  for (const g of Pal.GROUPS) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" data-group="${g.id}"${S.groups.has(g.id) ? ' checked' : ''}><span>${g.name}</span>`;
    l.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) S.groups.add(g.id); else S.groups.delete(g.id);
      refreshRows(); schedule('map');
    });
    groups.appendChild(l);
  }

  const tf = $('tagfilters');
  tf.innerHTML = '<div class="note" style="margin:0 0 4px">Leave out</div>';
  const wrap = document.createElement('div');
  wrap.className = 'checks';
  for (const [tag, label] of TAGS) {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = `<input type="checkbox" data-tag="${tag}"><span>${label}</span>`;
    l.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) S.excludeTags.add(tag); else S.excludeTags.delete(tag);
      refreshRows(); schedule('map');
    });
    wrap.appendChild(l);
  }
  tf.appendChild(wrap);

  const listEl = $('blocklist');
  for (const g of Pal.GROUPS) {
    const head = document.createElement('div');
    head.className = 'grouphead';
    head.textContent = g.name;
    head.dataset.grouphead = g.id;
    listEl.appendChild(head);
    for (const b of Pal.BLOCKS.filter(b => b.group === g.id)) {
      const row = document.createElement('div');
      row.className = 'blockrow';
      row.dataset.id = b.id;
      row.innerHTML =
        `<input type="checkbox" checked aria-label="use ${b.name}">` +
        `<span class="swatch"></span><span class="nm"></span><span class="ct"></span>`;
      row.querySelector('.nm').textContent = b.name;
      row.title = b.bedrock;
      row.querySelector('input').addEventListener('change', e => {
        if (e.target.checked) S.disabled.delete(b.id); else S.disabled.add(b.id);
        refreshRows(); schedule('map');
      });
      row.addEventListener('click', e => {
        if (e.target.tagName === 'INPUT') return;
        S.brush = S.brush === b.id ? null : b.id;
        refreshRows();
        $('hover').innerHTML = S.brush
          ? `Brush: <b>${b.name}</b> — click the grid to place, right-click to erase.`
          : 'Brush cleared.';
      });
      listEl.appendChild(row);
      rowEls.set(b.id, row);
    }
  }
  refreshRows();
}

function refreshRows() {
  const q = $('psearch').value.trim().toLowerCase();
  let shown = 0;
  for (const b of Pal.BLOCKS) {
    const row = rowEls.get(b.id);
    const match = !q || b.name.toLowerCase().includes(q) || b.id.includes(q);
    const groupOn = S.groups.has(b.group);
    const tagOk = !b.tags.some(t => S.excludeTags.has(t));
    row.classList.toggle('hidden', !match);
    row.classList.toggle('off', !groupOn || !tagOk || S.disabled.has(b.id));
    row.classList.toggle('brush', S.brush === b.id);
    row.querySelector('.swatch').style.background = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`;
    row.querySelector('input').checked = !S.disabled.has(b.id);
    if (match && groupOn && tagOk && !S.disabled.has(b.id)) shown++;
  }
  for (const head of document.querySelectorAll('.grouphead')) {
    head.classList.toggle('hidden', !!q);
    head.style.opacity = S.groups.has(head.dataset.grouphead) ? 1 : 0.4;
  }
  $('pal-note').textContent = `${shown} block${shown === 1 ? '' : 's'} in play`;
  $('pal-note').className = 'note' + (shown === 0 ? ' bad' : '');
}

function refreshCounts() {
  const counts = S.grid ? S.grid.counts : new Map();
  for (const b of Pal.BLOCKS) {
    const el = rowEls.get(b.id).querySelector('.ct');
    const n = counts.get(b.id);
    el.textContent = n ? n.toLocaleString() : '';
  }
}

function renderMaterials() {
  const host = $('materials');
  host.innerHTML = '';
  if (!S.grid) return;
  const rows = [...S.grid.counts.entries()].sort((a, b) => b[1] - a[1]);
  const max = rows.length ? rows[0][1] : 1;
  const byId = new Map(Pal.BLOCKS.map(b => [b.id, b]));
  for (const [id, n] of rows) {
    const b = byId.get(id);
    const el = document.createElement('div');
    el.className = 'matrow';
    el.innerHTML = `<span class="swatch"></span><span class="nm" style="flex:1"></span>` +
      `<span class="ct" style="font-family:var(--mono);font-size:11px;color:var(--muted)"></span>`;
    el.querySelector('.swatch').style.background = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`;
    el.querySelector('.nm').textContent = b.name;
    el.querySelector('.ct').textContent = `${n.toLocaleString()} · ${(n / 64).toFixed(1)}st`;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = `${Math.max(2, 46 * n / max)}px`;
    el.insertBefore(bar, el.lastChild);
    host.appendChild(el);
  }
}

// ---------------------------------------------------------------- image load
function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    const cap = 2048;
    const s = Math.min(1, cap / Math.max(img.width, img.height));
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    setSource(Pix.fromImageData(ctx.getImageData(0, 0, c.width, c.height)), file.name, img.width, img.height);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { toast('That file would not decode as an image.', true); URL.revokeObjectURL(url); };
  img.src = url;
}

function setSource(buf, label, ow, oh) {
  S.source = buf;
  S.imgName = label;
  S.locks.clear();
  viewerFramed = false;
  $('img-info').textContent = `${label} — ${ow || buf.w}×${oh || buf.h} px`;
  const base = label.replace(/\.[^.]+$/, '');
  if ($('name').value === 'imagecraft' || !$('name').value) $('name').value = Ex.safeName(base);
  schedule('adjust');
}

function testPattern() {
  const w = 384, h = 256;
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hue = x / w * 360;
      const v = 1 - y / h * 0.9;
      const sat = y < h * 0.12 ? 0 : 1;
      const [r, g, b] = hsv(hue, sat, y < h * 0.12 ? x / w : v);
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  setSource({ w, h, data }, 'test-pattern', w, h);
}

function hsv(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ---------------------------------------------------------------- controls
function fillSelect(el, items, value) {
  el.innerHTML = '';
  for (const it of items) {
    const o = document.createElement('option');
    o.value = it.id;
    o.textContent = it.note ? `${it.name} — ${it.note}` : it.name;
    el.appendChild(o);
  }
  el.value = value;
}

function bindRange(id, get, set, fmt) {
  const el = $(id), out = $('v-' + id);
  el.value = get();
  if (out) out.textContent = fmt(get());
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    if (out) out.textContent = fmt(v);
    set(v);
  });
}

function wire() {
  fillSelect($('resample'), Pix.RESAMPLE_MODES, S.resample);
  fillSelect($('match'), MATCH_MODES, S.map.matchMode);
  fillSelect($('dither'), DITHER_MODES, S.map.dither);
  fillSelect($('bmode'), BUILD_MODES, S.build.mode);
  fillSelect($('preset'), [{ id: '', name: 'Choose a preset' },
    ...Object.entries(PRESETS).map(([id, p]) => ({ id, name: p.label }))], '');

  // image
  $('drop').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', e => { if (e.target.files[0]) loadImageFile(e.target.files[0]); });
  $('btn-sample').addEventListener('click', testPattern);
  for (const ev of ['dragenter', 'dragover']) {
    document.addEventListener(ev, e => { e.preventDefault(); $('drop').classList.add('over'); });
  }
  document.addEventListener('dragleave', e => { if (e.relatedTarget === null) $('drop').classList.remove('over'); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    $('drop').classList.remove('over');
    const f = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
    if (f) loadImageFile(f);
  });

  // grid
  const syncW = v => {
    S.gw = Math.max(1, Math.min(1024, Math.round(v)));
    $('gw').value = S.gw; $('gw-r').value = Math.min(512, S.gw);
    schedule('grid');
  };
  $('gw-r').addEventListener('input', e => syncW(+e.target.value));
  $('gw').addEventListener('change', e => syncW(+e.target.value));
  const syncH = v => {
    S.gh = Math.max(1, Math.min(1024, Math.round(v)));
    $('gh').value = S.gh; $('gh-r').value = Math.min(512, S.gh);
    schedule('grid');
  };
  $('gh-r').addEventListener('input', e => syncH(+e.target.value));
  $('gh').addEventListener('change', e => syncH(+e.target.value));
  $('lock-aspect').addEventListener('change', e => {
    S.lockAspect = e.target.checked;
    $('gh').disabled = S.lockAspect; $('gh-r').disabled = S.lockAspect;
    schedule('grid');
  });
  $('resample').addEventListener('change', e => { S.resample = e.target.value; schedule('grid'); });

  // adjustments
  const A = (id, key, fmt = v => v.toFixed(2)) =>
    bindRange(id, () => S.adjust[key], v => { S.adjust[key] = v; schedule('adjust'); }, fmt);
  A('brightness', 'brightness');
  A('contrast', 'contrast');
  A('saturation', 'saturation');
  A('gamma', 'gamma');
  A('hue', 'hue', v => String(v | 0));
  A('sharpen', 'sharpen');
  bindRange('posterize', () => S.adjust.posterize,
    v => { S.adjust.posterize = v; schedule('adjust'); },
    v => v < 2 ? 'off' : String(v | 0));
  $('btn-reset-adjust').addEventListener('click', () => {
    S.adjust = { ...Pix.DEFAULT_ADJUST };
    for (const k of ['brightness', 'contrast', 'saturation', 'gamma', 'hue', 'sharpen', 'posterize']) {
      $(k).value = S.adjust[k];
      const out = $('v-' + k);
      if (out) out.textContent = k === 'posterize' ? 'off' : (k === 'hue' ? '0' : (+S.adjust[k]).toFixed(2));
    }
    schedule('adjust');
  });

  // matching
  $('match').addEventListener('change', e => { S.map.matchMode = e.target.value; schedule('map'); });
  $('dither').addEventListener('change', e => { S.map.dither = e.target.value; schedule('map'); });
  bindRange('dstrength', () => S.map.strength, v => { S.map.strength = v; schedule('map'); }, v => v.toFixed(2));
  $('serp').addEventListener('change', e => { S.map.serpentine = e.target.checked; schedule('map'); });
  bindRange('alpha', () => S.map.alphaCutoff, v => { S.map.alphaCutoff = v; schedule('map'); }, v => String(v | 0));

  // build
  $('bmode').addEventListener('change', e => { S.build.mode = e.target.value; reliefVisibility(); schedule('vox'); });
  bindRange('bdepth', () => S.build.depth, v => { S.build.depth = v; schedule('vox'); }, v => String(v | 0));
  bindRange('brelief', () => S.build.relief, v => { S.build.relief = v; schedule('vox'); }, v => String(v | 0));
  $('binvert').addEventListener('change', e => { S.build.reliefInvert = e.target.checked; schedule('vox'); });
  $('bfill').addEventListener('change', e => { S.build.fillBack = e.target.checked; schedule('vox'); });
  $('maxtile').addEventListener('change', e => {
    S.maxtile = Math.max(8, Math.min(64, +e.target.value | 0));
    e.target.value = S.maxtile; updateStats();
  });
  $('airfill').addEventListener('change', e => { S.airfill = e.target.checked; });
  $('legacy').addEventListener('change', e => { S.legacy = e.target.checked; });
  $('budget').addEventListener('change', e => { S.budget = Math.max(1000, +e.target.value | 0); updateStats(); });
  reliefVisibility();

  // presets
  $('preset').addEventListener('change', e => {
    const p = PRESETS[e.target.value];
    if (!p) return;
    S.groups = new Set(p.groups);
    S.excludeTags = new Set(p.excludeTags || []);
    S.disabled.clear();
    S.map = { ...DEFAULT_MAP_OPTS, ...p.map };
    S.adjust = { ...Pix.DEFAULT_ADJUST, ...p.adjust };
    S.resample = p.resample;
    syncControlsFromState();
    refreshRows();
    schedule('adjust');
    toast(`Preset: ${p.label}`);
  });

  // palette panel
  $('psearch').addEventListener('input', refreshRows);
  $('btn-all').addEventListener('click', () => {
    S.groups = new Set(Pal.GROUPS.map(g => g.id));
    S.disabled.clear();
    for (const el of document.querySelectorAll('[data-group]')) el.checked = true;
    refreshRows(); schedule('map');
  });
  $('btn-none').addEventListener('click', () => {
    S.groups.clear();
    for (const el of document.querySelectorAll('[data-group]')) el.checked = false;
    refreshRows(); schedule('map');
  });
  $('btn-calib').addEventListener('click', () => $('calibfiles').click());
  $('calibfiles').addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    const loaded = [];
    for (const f of files) {
      try { loaded.push({ name: f.name, imageData: await fileToImageData(f) }); } catch { /* skip */ }
    }
    const n = Pal.calibrate(loaded);
    refreshRows();
    schedule('map');
    toast(n ? `Re-averaged ${n} block colours from your textures.`
      : 'No filenames matched a block id — expect names like white_concrete.png.', !n);
  });

  // tabs
  tabGroup([['tab-2d', 'view-2d'], ['tab-3d', 'view-3d'], ['tab-src', 'view-src']], id => {
    if (id === 'view-2d') draw2D();
    if (id === 'view-src') drawSource();
    if (id === 'view-3d' && viewer) viewer.dirty = true;
  });
  tabGroup([['tab-pal', 'pane-pal'], ['tab-mat', 'pane-mat']]);

  // 2D interaction
  const c = $('c2d');
  let drag = null;
  c.addEventListener('pointerdown', e => {
    const cell = cellAt(e);
    if (e.button === 2 || (e.button === 0 && S.brush && !e.altKey)) {
      if (cell) { paintCell(cell.i, e.button === 2 ? null : S.brush); drag = { paint: e.button === 2 ? null : S.brush }; }
      c.setPointerCapture(e.pointerId);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, ox: S.view2d.ox, oy: S.view2d.oy };
    c.setPointerCapture(e.pointerId);
  });
  c.addEventListener('pointermove', e => {
    const cell = cellAt(e);
    if (drag && 'paint' in drag) { if (cell) paintCell(cell.i, drag.paint); }
    else if (drag) {
      S.view2d.ox = drag.ox + (e.clientX - drag.x);
      S.view2d.oy = drag.oy + (e.clientY - drag.y);
      draw2D();
    }
    if (!drag) showHover(cell);
  });
  const endDrag = e => { if (drag) { c.releasePointerCapture(e.pointerId); drag = null; } };
  c.addEventListener('pointerup', endDrag);
  c.addEventListener('pointercancel', endDrag);
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.max(0.2, Math.min(64, S.view2d.scale * k));
    S.view2d.ox = mx - (mx - S.view2d.ox) * (ns / S.view2d.scale);
    S.view2d.oy = my - (my - S.view2d.oy) * (ns / S.view2d.scale);
    S.view2d.scale = ns;
    draw2D();
  }, { passive: false });

  $('btn-fit2d').addEventListener('click', () => { fit2d(); draw2D(); });
  $('btn-grid').addEventListener('click', () => { S.view2d.lines = !S.view2d.lines; draw2D(); });
  $('btn-clear-paint').addEventListener('click', () => {
    if (!S.locks.size) return toast('Nothing has been painted.');
    S.locks.clear(); schedule('map');
  });
  $('btn-frame').addEventListener('click', () => viewer && viewer.frame());
  $('btn-shot').addEventListener('click', async () => {
    if (!viewer) return;
    viewer.draw();
    const blob = await Ex.canvasToPngBlob($('c3d'));
    Ex.download(`${Ex.safeName($('name').value)}_view.png`, blob, 'image/png');
  });

  window.addEventListener('resize', () => { draw2D(); drawSource(); });

  // exports
  $('btn-png').addEventListener('click', exportPng);
  $('btn-list').addEventListener('click', exportList);
  $('btn-obj').addEventListener('click', exportObj);
  $('btn-structure').addEventListener('click', exportStructure);
  $('btn-mcpack').addEventListener('click', exportPack);
}

function reliefVisibility() {
  const on = S.build.mode === 'relief';
  $('row-relief').classList.toggle('hidden', !on);
  $('row-invert').classList.toggle('hidden', !on);
  $('row-fill').classList.toggle('hidden', !on);
}

function syncControlsFromState() {
  $('resample').value = S.resample;
  $('match').value = S.map.matchMode;
  $('dither').value = S.map.dither;
  $('dstrength').value = S.map.strength; $('v-dstrength').textContent = S.map.strength.toFixed(2);
  for (const k of ['brightness', 'contrast', 'saturation', 'gamma', 'hue', 'sharpen', 'posterize']) {
    $(k).value = S.adjust[k];
    const out = $('v-' + k);
    if (out) out.textContent = k === 'posterize' ? (S.adjust[k] < 2 ? 'off' : String(S.adjust[k] | 0))
      : (k === 'hue' ? String(S.adjust[k] | 0) : (+S.adjust[k]).toFixed(2));
  }
  for (const el of document.querySelectorAll('[data-group]')) el.checked = S.groups.has(el.dataset.group);
  for (const el of document.querySelectorAll('[data-tag]')) el.checked = S.excludeTags.has(el.dataset.tag);
}

function paintCell(i, blockId) {
  if (blockId === null) {
    if (S.locks.get(i) === '') return;
    S.locks.set(i, '');            // '' = forced empty
    S.grid.index[i] = -1;
    S.grid.rgb[i * 3] = S.grid.rgb[i * 3 + 1] = S.grid.rgb[i * 3 + 2] = 0;
  } else {
    if (S.locks.get(i) === blockId) return;
    const pi = S.blocks.findIndex(b => b.id === blockId);
    if (pi < 0) return toast('That block is switched off in the palette.', true);
    S.locks.set(i, blockId);
    S.grid.index[i] = pi;
    const c = S.blocks[pi].rgb;
    S.grid.rgb[i * 3] = c[0]; S.grid.rgb[i * 3 + 1] = c[1]; S.grid.rgb[i * 3 + 2] = c[2];
  }
  draw2D();
  schedule('vox');
}

function showHover(cell) {
  const el = $('hover');
  if (!cell || !S.grid) { return; }
  const i = cell.i, pi = S.grid.index[i];
  const b = pi >= 0 ? S.blocks[pi] : null;
  const src = S.pix ? [S.pix.data[i * 4], S.pix.data[i * 4 + 1], S.pix.data[i * 4 + 2]].map(v => Math.round(v)) : null;
  el.innerHTML = b
    ? `<b>${b.name}</b> ${b.bedrock}<br>x ${cell.x}, y ${cell.y} — wanted rgb(${src.join(', ')}), got rgb(${b.rgb.join(', ')})`
    : `x ${cell.x}, y ${cell.y} — empty`;
}

function tabGroup(pairs, onChange) {
  for (const [tabId, viewId] of pairs) {
    $(tabId).addEventListener('click', () => {
      for (const [t, v] of pairs) {
        const on = t === tabId;
        $(t).setAttribute('aria-selected', String(on));
        $(v).classList.toggle('on', on);
      }
      if (onChange) onChange(viewId);
    });
  }
}

async function fileToImageData(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c.getContext('2d').getImageData(0, 0, c.width, c.height);
}

// ---------------------------------------------------------------- exports
function guard() {
  if (!S.grid || !S.vox || !S.vox.count) { toast('Load an image first.', true); return false; }
  return true;
}

async function exportPng() {
  if (!guard()) return;
  const scale = Math.max(1, Math.min(16, Math.round(2048 / Math.max(S.grid.w, S.grid.h))));
  const blob = await Ex.gridToPngBlob(S.grid, scale, S.view2d.lines);
  Ex.download(`${Ex.safeName($('name').value)}.png`, blob, 'image/png');
}

function exportList() {
  if (!guard()) return;
  const name = Ex.safeName($('name').value);
  Ex.download(`${name}_materials.txt`,
    Ex.blockListText(S.grid.counts, S.blocks, $('name').value), 'text/plain');
}

function exportObj() {
  if (!guard()) return;
  if (!S.mesh) return toast('The mesh is too big to export. Lower the grid size.', true);
  Ex.download(`${Ex.safeName($('name').value)}.obj`, meshToObj(S.mesh, Ex.safeName($('name').value)), 'text/plain');
}

function exportStructure() {
  if (!guard()) return;
  const bytes = buildStructure(S.vox, S.blocks, { legacy: S.legacy, fillEmptyWithAir: S.airfill });
  Ex.download(`${Ex.safeName($('name').value)}.mcstructure`, bytes);
  const big = S.vox.sx > 64 || S.vox.sz > 64 || S.vox.sy > 384;
  toast(big
    ? 'Saved — but it is larger than a structure block can load. Use the .mcpack for a tiled version.'
    : `Saved ${S.vox.sx}×${S.vox.sy}×${S.vox.sz}.`, big);
}

function exportPack() {
  if (!guard()) return;
  const name = $('name').value || 'imagecraft';
  const pack = Ex.buildMcPack(S.vox, S.blocks, {
    name, namespace: 'imagecraft', legacy: S.legacy,
    fillEmptyWithAir: S.airfill, maxXZ: S.maxtile,
  });
  Ex.download(`${Ex.safeName(name)}.mcpack`, pack.bytes);
  toast(`${pack.tiles.length} structure${pack.tiles.length === 1 ? '' : 's'} packed. ` +
    `Open the file to import, then run the commands in README.txt.`);
}

// ---------------------------------------------------------------- boot
let viewer = null, viewerFramed = false;
try {
  viewer = new Viewer($('c3d'));
} catch (e) {
  console.warn(e);
  $('hint3d').textContent = e.message;
}
buildPaletteUI();
wire();
syncControlsFromState();
updateStats();
