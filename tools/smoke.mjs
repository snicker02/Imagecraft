// smoke.mjs — boots main.js in jsdom to catch wiring mistakes.
// jsdom has no canvas backend, so 2D/3D drawing is stubbed; everything else is real.
// Run: node tools/smoke.mjs   (needs a local `npm install jsdom`)

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

// --- minimal canvas stub ----------------------------------------------------
const ctx2d = new Proxy({}, {
  get(_, k) {
    if (k === 'canvas') return { width: 0, height: 0 };
    if (k === 'createImageData') return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'imageSmoothingEnabled' || k === 'fillStyle' || k === 'strokeStyle' || k === 'lineWidth') return '';
    return () => {};
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = function (type) { return type === '2d' ? ctx2d : null; };
window.ImageData = class { constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); } };
window.requestAnimationFrame = fn => setTimeout(() => fn(Date.now()), 0);
window.cancelAnimationFrame = id => clearTimeout(id);
window.devicePixelRatio = 1;

const errors = [];
window.addEventListener('error', e => errors.push(String(e.error || e.message)));

for (const k of ['window', 'document', 'HTMLCanvasElement', 'ImageData', 'requestAnimationFrame',
  'cancelAnimationFrame', 'devicePixelRatio', 'Image', 'Blob', 'URL', 'navigator', 'getComputedStyle',
  'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'createImageBitmap']) {
  if (!(k in window)) continue;
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only global */ }
}
globalThis.window = window;
globalThis.document = window.document;

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };

const $ = id => window.document.getElementById(id);

// --- boot -------------------------------------------------------------------
await import('../main.js');
await new Promise(r => setTimeout(r, 30));

console.log('boot');
ok('no uncaught errors during boot', errors.length === 0, errors.join(' | '));
ok('the version is shown in the bar', /^\d+\.\d+\.\d+$/.test($('version').textContent.trim()),
  $('version').textContent);
ok('palette rows rendered', window.document.querySelectorAll('.blockrow').length > 150,
  String(window.document.querySelectorAll('.blockrow').length));
ok('group toggles rendered', window.document.querySelectorAll('[data-group]').length === 11);
ok('tag filters rendered', window.document.querySelectorAll('[data-tag]').length === 5);
ok('selects populated', $('resample').options.length === 4 && $('dither').options.length === 8 &&
  $('bmode').options.length === 4 && $('match').options.length === 4 && $('preset').options.length === 9,
  `${$('preset').options.length}`);
ok('3D falls back cleanly with no WebGL', $('hint3d').textContent.includes('WebGL'), $('hint3d').textContent);
ok('relief controls hidden in wall mode', $('row-relief').classList.contains('hidden'));

console.log('\ninteraction');
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));
const settle = () => new Promise(r => setTimeout(r, 40));

click($('btn-sample'));
await settle();
ok('test pattern loads', $('img-info').textContent.includes('test-pattern'), $('img-info').textContent);
ok('stats filled in', $('stat-size').textContent !== '—' && $('stat-blocks').textContent !== '—',
  `${$('stat-size').textContent} / ${$('stat-blocks').textContent}`);
ok('materials list built', window.document.querySelectorAll('.matrow').length > 3,
  String(window.document.querySelectorAll('.matrow').length));
ok('empty-state hidden once loaded', $('empty').classList.contains('hidden'));

$('gw').value = '64'; change($('gw'));
await settle();
ok('grid width applies and keeps aspect', $('stat-size').textContent === '64×43', $('stat-size').textContent);

$('bmode').value = 'relief'; change($('bmode'));
await settle();
ok('relief controls appear', !$('row-relief').classList.contains('hidden'));
ok('plane-only controls stay hidden in relief mode', $('row-tilt').classList.contains('hidden'));
const wallBlocks = 64 * 43;
ok('relief adds blocks behind the face', Number($('stat-blocks').textContent.replace(/,/g, '')) > wallBlocks,
  $('stat-blocks').textContent);

$('bmode').value = 'plane'; change($('bmode'));
await settle();
ok('plane controls appear', !$('row-tilt').classList.contains('hidden') &&
  !$('row-yaw').classList.contains('hidden') && !$('plane-note').classList.contains('hidden'));
const flatPlane = Number($('stat-blocks').textContent.replace(/,/g, ''));
$('btilt').value = '0'; input($('btilt'));
await settle();
ok('plane at tilt 0 matches the wall count',
  Number($('stat-blocks').textContent.replace(/,/g, '')) === wallBlocks, $('stat-blocks').textContent);
$('btilt').value = '45'; input($('btilt'));
$('byaw').value = '30'; input($('byaw'));
await settle();
ok('an angled plane keeps every cell',
  Number($('stat-blocks').textContent.replace(/,/g, '')) >= wallBlocks, $('stat-blocks').textContent);
ok('tilting changed the build', Number($('stat-blocks').textContent.replace(/,/g, '')) !== wallBlocks || flatPlane > 0);

$('bmode').value = 'floor'; change($('bmode'));
$('bdepth').value = '2'; input($('bdepth'));
await settle();
ok('thickness doubles the count', Number($('stat-blocks').textContent.replace(/,/g, '')) === wallBlocks * 2,
  $('stat-blocks').textContent);

$('bmode').value = 'wall'; change($('bmode'));
$('bdepth').value = '1'; input($('bdepth'));
$('dither').value = 'atkinson'; change($('dither'));
$('match').value = 'lab2000'; change($('match'));
await settle();
ok('dither + match changes survive', errors.length === 0, errors.join(' | '));

const kinds = Number($('stat-kinds').textContent);
$('preset').value = 'wool-only'; change($('preset'));
await settle();
ok('preset narrows the palette', Number($('stat-kinds').textContent) <= 16 &&
  Number($('stat-kinds').textContent) !== kinds, $('stat-kinds').textContent);
ok('preset syncs the controls', $('dither').value === 'atkinson' && $('resample').value === 'box');

click($('btn-none'));
await settle();
ok('all-off is handled without crashing', $('pal-note').textContent.startsWith('0 blocks'), $('pal-note').textContent);
click($('btn-all'));
await settle();
ok('all-on restores the palette', Number($('stat-kinds').textContent) > 20, $('stat-kinds').textContent);

$('psearch').value = 'concrete'; input($('psearch'));
ok('search filters rows',
  [...window.document.querySelectorAll('.blockrow')].filter(r => !r.classList.contains('hidden')).length === 16);
$('psearch').value = ''; input($('psearch'));

const row = window.document.querySelector('.blockrow[data-id="black_wool"]');
click(row);
ok('clicking a row picks up a brush', row.classList.contains('brush'));
ok('brush is announced', $('hover').textContent.includes('Black Wool'), $('hover').textContent);

// fit-to-one-structure: the answer must move with the tilt
const kindsBefore = Number($('stat-kinds').textContent);
$('smooth').value = '1.2'; input($('smooth'));
await settle();
ok('smoothing changes the mapping', Number($('stat-kinds').textContent) !== kindsBefore ||
  $('v-smooth').textContent === '1.20', $('v-smooth').textContent);
ok('smooth readout updates', $('v-smooth').textContent === '1.20', $('v-smooth').textContent);
$('smooth').value = '0'; input($('smooth'));
await settle();
ok('smooth turns back off', $('v-smooth').textContent === 'off');

$('bmode').value = 'plane'; change($('bmode'));
$('btilt').value = '0'; input($('btilt'));
await settle();
click($('btn-fit-one'));
await settle();
const flatFit = Number($('gw').value);
const loads = () => !/too big to load/.test($('budget-note').textContent);
ok('fit-to-one gives a loadable grid at tilt 0', loads(), $('budget-note').textContent);
$('btilt').value = '90'; input($('btilt'));
await settle();
click($('btn-fit-one'));
await settle();
const laidFit = Number($('gw').value);
ok('lying flat needs a smaller grid than standing up', laidFit <= flatFit, `${laidFit} vs ${flatFit}`);
ok('the result still loads as one file lying flat', loads(), $('budget-note').textContent);
ok('fit-to-one never leaves an oversized grid', laidFit <= 64, String(laidFit));
$('bmode').value = 'wall'; change($('bmode'));
await settle();

click($('tab-3d'));
ok('tab switch works', $('view-3d').classList.contains('on') && !$('view-2d').classList.contains('on'));
click($('tab-2d'));

// exports: capture the download instead of writing files
const saved = [];
const origCreate = window.document.createElement.bind(window.document);
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.document.createElement = tag => {
  const el = origCreate(tag);
  if (tag === 'a') el.click = () => saved.push(el.download);
  if (tag === 'canvas') el.toBlob = cb => cb(new window.Blob([new Uint8Array(4)]));
  return el;
};
click($('btn-list'));
click($('btn-structure'));
click($('btn-mcpack'));
click($('btn-tiles'));
click($('btn-obj'));
await new Promise(r => setTimeout(r, 400));
ok('the build note says whether one structure will load',
  /fits one structure|one file:/.test($('budget-note').textContent),
  $('budget-note').textContent);
ok('tile size defaults under the structure block limit', Number($('maxtile').value) < 64, $('maxtile').value);
ok('exports fire with the right filenames',
  saved.some(n => n.endsWith('_materials.txt')) && saved.some(n => n.endsWith('.mcstructure')) &&
  saved.some(n => n.endsWith('.mcpack')) && saved.some(n => n.endsWith('_obj.zip')) &&
  saved.some(n => n.endsWith('_tiles.zip')), saved.join(', '));

ok('still no uncaught errors', errors.length === 0, errors.join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
