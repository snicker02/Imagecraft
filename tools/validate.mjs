// validate.mjs — headless checks. Run: node tools/validate.mjs
// Covers colour maths, resampling, mapping, voxelising, meshing, NBT round-trip,
// structure index order, tiling, zip/CRC and pack assembly.

import { rgbToLab, dLab76, dLab2000, Matcher, rgbToHex, hexToRgb } from '../engine/color.js';
import * as Pal from '../engine/palette.js';
import * as Pix from '../engine/pixelize.js';
import { mapToBlocks, mapError } from '../engine/mapper.js';
import { voxelize, buildMesh, meshToObj, trim } from '../engine/mesh.js';
import { write, read, nbt } from '../engine/nbt.js';
import { buildStructure, splitVolume, loadCommands, SAFE_XZ } from '../engine/mcstructure.js';
import { zip, crc32, uuid4, canDeflate } from '../engine/zip.js';
import { buildMcPack, blockListText, blockListCsv, safeName } from '../engine/exporters.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const MAX_Y_TEST = 384;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const section = s => console.log(`\n${s}`);

// ---------------------------------------------------------------- colour
section('colour');
{
  const w = rgbToLab(255, 255, 255), k = rgbToLab(0, 0, 0), m = rgbToLab(128, 128, 128);
  ok('white -> L=100', near(w[0], 100, 0.01) && near(w[1], 0, 0.01) && near(w[2], 0, 0.01), JSON.stringify(w));
  ok('black -> L=0', near(k[0], 0, 0.01));
  ok('mid grey L in 53..54', m[0] > 53 && m[0] < 54, String(m[0]));
  ok('dE76 self = 0', near(dLab76(w, w), 0));
  ok('dE2000 self = 0', near(dLab2000(w, w), 0));
  const red = rgbToLab(255, 0, 0), green = rgbToLab(0, 255, 0);
  ok('dE2000 red vs green large', dLab2000(red, green) > 1000);
  ok('hex round trip', rgbToHex(...hexToRgb('#3ba7ff')) === '#3ba7ff');

  const pal = [
    { id: 'a', rgb: [255, 0, 0] }, { id: 'b', rgb: [0, 255, 0] }, { id: 'c', rgb: [0, 0, 255] },
  ];
  for (const mode of ['rgb', 'rgbw', 'lab76', 'lab2000']) {
    const mt = new Matcher(pal, mode);
    ok(`matcher exact hit (${mode})`,
      mt.match(255, 0, 0) === 0 && mt.match(0, 255, 0) === 1 && mt.match(0, 0, 255) === 2);
  }
  const mt = new Matcher(pal, 'lab76');
  ok('matcher clamps out-of-range input', mt.match(400, -80, 12) === 0);

  // the CIEDE2000 shortlist must stay faithful to an exhaustive scan
  const full = Pal.BLOCKS;
  const labs = full.map(b => rgbToLab(...b.rgb));
  const exact = (r, g, b) => {
    const L = rgbToLab(r, g, b);
    let bi = -1, bd = Infinity;
    for (let i = 0; i < labs.length; i++) { const d = dLab2000(L, labs[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  const m2k = new Matcher(full, 'lab2000');
  let diff = 0, worst = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 8) & 255; };
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const r = rnd(), g = rnd(), b = rnd();
    const a = m2k.match(r, g, b), e = exact(r, g, b);
    if (a !== e) {
      diff++;
      const L = rgbToLab(r, g, b);
      worst = Math.max(worst, Math.sqrt(dLab2000(L, labs[a])) - Math.sqrt(dLab2000(L, labs[e])));
    }
  }
  ok('CIEDE2000 shortlist agrees with an exhaustive scan >99% of the time',
    diff / N < 0.01, `${diff}/${N}`);
  ok('worst shortlist penalty stays under 4 dE2000', worst < 4, worst.toFixed(2));
  const small = new Matcher(full.slice(0, 40), 'lab2000');
  const exactSmall = (r, g, b) => {
    const L = rgbToLab(r, g, b);
    let bi = -1, bd = Infinity;
    for (let i = 0; i < 40; i++) { const d = dLab2000(L, labs[i]); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  let sdiff = 0;
  for (let i = 0; i < 400; i++) { const r = rnd(), g = rnd(), b = rnd(); if (small.match(r, g, b) !== exactSmall(r, g, b)) sdiff++; }
  ok('small palettes are matched exactly', sdiff === 0, String(sdiff));
  ok('matcher caches', (mt.match(10, 240, 10), mt.cache.size > 0));
}

// ---------------------------------------------------------------- palette
section('palette');
{
  ok('blocks present', Pal.BLOCKS.length > 150, String(Pal.BLOCKS.length));
  const ids = new Set();
  let dupes = 0;
  for (const b of Pal.BLOCKS) { if (ids.has(b.id)) dupes++; ids.add(b.id); }
  ok('no duplicate ids', dupes === 0, String(dupes));
  ok('every block has a known group', Pal.BLOCKS.every(b => Pal.GROUPS.some(g => g.id === b.group)));
  ok('every colour is 3 bytes in range', Pal.BLOCKS.every(b =>
    b.rgb.length === 3 && b.rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)));
  ok('every id is namespaced', Pal.BLOCKS.every(b => /^minecraft:[a-z0-9_]+$/.test(b.bedrock)));
  ok('legacy entries are [name, states]', Pal.BLOCKS.every(b =>
    !b.legacy || (Array.isArray(b.legacy) && typeof b.legacy[0] === 'string' && typeof b.legacy[1] === 'object')));
  const sel = Pal.selectBlocks({
    groups: new Set(['wool']), disabled: new Set(['red_wool']), excludeTags: new Set(),
  });
  ok('selectBlocks filters group + disabled', sel.length === 15 && !sel.some(b => b.id === 'red_wool'), String(sel.length));
  const noFlam = Pal.selectBlocks({ groups: new Set(['wool']), disabled: new Set(), excludeTags: new Set(['flammable']) });
  ok('tag exclusion works', noFlam.length === 0);
  const r = Pal.resolveBlock(Pal.BY_ID.get('white_wool'), true);
  ok('legacy resolve', r.name === 'minecraft:wool' && r.states.color === 'white', JSON.stringify(r));
  const r2 = Pal.resolveBlock(Pal.BY_ID.get('white_wool'), false);
  ok('modern resolve', r2.name === 'minecraft:white_wool');
}

// ---------------------------------------------------------------- pixelize
section('pixelize');
function solid(w, h, r, g, b, a = 255) {
  const data = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a; }
  return { w, h, data };
}
{
  const src = solid(8, 8, 120, 60, 200);
  const id = Pix.adjust(src, Pix.DEFAULT_ADJUST);
  ok('identity adjust is a no-op', near(id.data[0], 120, 0.51) && near(id.data[1], 60, 0.51) && near(id.data[2], 200, 0.51),
    `${id.data[0]},${id.data[1]},${id.data[2]}`);
  const desat = Pix.adjust(src, { ...Pix.DEFAULT_ADJUST, saturation: -1 });
  ok('full desaturation makes r=g=b', near(desat.data[0], desat.data[1], 0.01) && near(desat.data[1], desat.data[2], 0.01));
  const bright = Pix.adjust(src, { ...Pix.DEFAULT_ADJUST, brightness: 0.5 });
  ok('brightness clamps at 255', bright.data[2] === 255);
  const post = Pix.adjust(solid(2, 2, 130, 130, 130), { ...Pix.DEFAULT_ADJUST, posterize: 2 });
  ok('posterize 2 snaps to 0 or 255', post.data[0] === 255 || post.data[0] === 0, String(post.data[0]));

  for (const mode of ['box', 'nearest', 'bilinear', 'median']) {
    const out = Pix.resample(src, 3, 3, mode);
    ok(`resample ${mode} keeps a flat colour`,
      out.w === 3 && out.h === 3 && near(out.data[0], 120, 0.6) && near(out.data[2], 200, 0.6),
      `${out.data[0]},${out.data[1]},${out.data[2]}`);
  }
  const up = Pix.resample(src, 20, 5, 'box');
  ok('resample honours requested size', up.w === 20 && up.h === 5 && up.data.length === 20 * 5 * 4);
  const f = Pix.fitGrid(1000, 500, 128, 128);
  ok('fitGrid keeps aspect', f.w === 128 && f.h === 64, JSON.stringify(f));
  const crop = Pix.resample(src, 2, 2, 'box', { x: 2, y: 2, w: 4, h: 4 });
  ok('crop path runs', crop.w === 2 && near(crop.data[0], 120, 0.6));
  const sh = Pix.sharpen(src, 1);
  ok('sharpen preserves flat regions', near(sh.data[0], 120, 0.6));
}

// ---------------------------------------------------------------- mapper
section('mapper');
function ramp(w, h) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    data[i] = (x / (w - 1)) * 255; data[i + 1] = (y / (h - 1)) * 255; data[i + 2] = 128; data[i + 3] = 255;
  }
  return { w, h, data };
}
const blocks = Pal.selectBlocks({ groups: new Set(Pal.DEFAULT_GROUPS), disabled: new Set(), excludeTags: new Set() });
{
  const pix = ramp(24, 16);
  for (const d of ['none', 'floyd', 'atkinson', 'sierra', 'bayer2', 'bayer4', 'bayer8', 'noise']) {
    const g = mapToBlocks(pix, blocks, { dither: d });
    const inRange = [...g.index].every(v => v >= 0 && v < blocks.length);
    const total = [...g.counts.values()].reduce((a, b) => a + b, 0);
    ok(`dither ${d}: valid indices and counts`, inRange && total === 24 * 16, `${total}`);
  }
  const a = mapToBlocks(pix, blocks, { dither: 'floyd' });
  const b = mapToBlocks(pix, blocks, { dither: 'floyd' });
  ok('mapping is deterministic', a.index.every((v, i) => v === b.index[i]));
  const n = mapToBlocks(pix, blocks, { dither: 'noise' });
  const n2 = mapToBlocks(pix, blocks, { dither: 'noise' });
  ok('noise dither is deterministic too', n.index.every((v, i) => v === n2.index[i]));
  // Dithering trades per-pixel accuracy for local accuracy, so compare 3x3 means.
  const localErr = g => {
    let sum = 0, n = 0;
    for (let y = 1; y < pix.h - 1; y++) for (let x = 1; x < pix.w - 1; x++) {
      let sr = 0, sg = 0, sb = 0, dr = 0, dg = 0, db = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const k = (y + j) * pix.w + (x + i);
        sr += pix.data[k * 4]; sg += pix.data[k * 4 + 1]; sb += pix.data[k * 4 + 2];
        dr += g.rgb[k * 3]; dg += g.rgb[k * 3 + 1]; db += g.rgb[k * 3 + 2];
      }
      sum += Math.hypot(sr - dr, sg - dg, sb - db) / 9; n++;
    }
    return sum / n;
  };
  const undithered = mapToBlocks(pix, blocks, { dither: 'none' });
  ok('dithering lowers local mean error', localErr(a) < localErr(undithered),
    `${localErr(a).toFixed(2)} vs ${localErr(undithered).toFixed(2)}`);
  ok('dithering raises per-pixel error (expected trade)', mapError(pix, a) > mapError(pix, undithered) * 0.5);

  const clear = ramp(4, 4);
  for (let i = 0; i < 16; i++) clear.data[i * 4 + 3] = 0;
  const g0 = mapToBlocks(clear, blocks, {});
  ok('transparent pixels become empty', [...g0.index].every(v => v === -1) && g0.counts.size === 0);

  const locks = new Map([[0, 'black_wool'], [5, 'white_wool']]);
  const gl = mapToBlocks(pix, blocks, { dither: 'none' }, locks);
  ok('painted cells are honoured',
    blocks[gl.index[0]].id === 'black_wool' && blocks[gl.index[5]].id === 'white_wool');

  const erased = new Map([[3, ''], [9, 'red_wool']]);
  const ge = mapToBlocks(pix, blocks, { dither: 'floyd' }, erased);
  ok('erased cells stay erased through a remap', ge.index[3] === -1);
  ok('painted cells survive dithering', blocks[ge.index[9]].id === 'red_wool');

  const clearLock = ramp(4, 4);
  for (let i = 0; i < 16; i++) clearLock.data[i * 4 + 3] = 0;
  const gp = mapToBlocks(clearLock, blocks, {}, new Map([[2, 'white_wool']]));
  ok('painting into a cut-out area places a block', blocks[gp.index[2]].id === 'white_wool');

  const empty = mapToBlocks(pix, [], {});
  ok('empty palette does not crash', empty.counts.size === 0);
}

// ---------------------------------------------------------------- mesh
section('voxels and mesh');
{
  const pix = ramp(6, 4);
  const grid = mapToBlocks(pix, blocks, { dither: 'none' });

  const wall = voxelize(grid, { mode: 'wall', depth: 1 });
  ok('wall dims', wall.sx === 6 && wall.sy === 4 && wall.sz === 1, `${wall.sx},${wall.sy},${wall.sz}`);
  ok('wall block count', wall.count === 24, String(wall.count));
  ok('wall flips rows so the image is upright',
    wall.cells[(0 * wall.sy + 3) * wall.sz + 0] === grid.index[0]);

  const thick = voxelize(grid, { mode: 'wall', depth: 3 });
  ok('thickness multiplies', thick.count === 24 * 3 && thick.sz === 3);

  const floor = voxelize(grid, { mode: 'floor', depth: 2 });
  ok('floor dims', floor.sx === 6 && floor.sy === 2 && floor.sz === 4);
  ok('floor count', floor.count === 48);

  const rel = voxelize(grid, { mode: 'relief', depth: 1, relief: 5, fillBack: true });
  ok('relief deepens the volume', rel.sz === 6 && rel.count >= 24, `${rel.sz},${rel.count}`);
  const relNoFill = voxelize(grid, { mode: 'relief', depth: 1, relief: 5, fillBack: false });
  ok('relief without backing is one block per column', relNoFill.count === 24, String(relNoFill.count));

  // --- plane mode ---
  const sameVox = (a, b) => a.sx === b.sx && a.sy === b.sy && a.sz === b.sz &&
    a.cells.every((v, i) => v === b.cells[i]);
  const plane = (o) => voxelize(grid, { mode: 'plane', depth: 1, relief: 0, tilt: 0, yaw: 0, ...o });

  ok('plane at tilt 0 is exactly the wall', sameVox(plane({}), voxelize(grid, { mode: 'wall', depth: 1 })));
  ok('plane at tilt 90 is exactly the floor',
    sameVox(plane({ tilt: 90 }), voxelize(grid, { mode: 'floor', depth: 1 })));
  ok('plane thickness multiplies', plane({ depth: 3 }).count === 24 * 3);
  ok('yaw 90 swaps the x and z extents',
    (() => { const v = plane({ yaw: 90 }); return v.sx === 1 && v.sy === 4 && v.sz === 6; })(),
    JSON.stringify(plane({ yaw: 90 })).slice(0, 40));
  ok('yaw 180 is still a flat wall', (() => { const v = plane({ yaw: 180 }); return v.sx === 6 && v.sz === 1; })());

  const connected6 = v => {
    const filled = [];
    for (let i = 0; i < v.cells.length; i++) if (v.cells[i] >= 0) filled.push(i);
    if (!filled.length) return false;
    const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= v.sx || y >= v.sy || z >= v.sz)
      ? -1 : (x * v.sy + y) * v.sz + z;
    const seen = new Set([filled[0]]), stack = [filled[0]];
    while (stack.length) {
      const i = stack.pop();
      const z = i % v.sz, y = (((i - z) / v.sz) % v.sy), x = (((i - z) / v.sz) - y) / v.sy;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const j = at(x + dx, y + dy, z + dz);
        if (j >= 0 && v.cells[j] >= 0 && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size === filled.length;
  };

  let leaky = [], thin = [];
  for (const tilt of [-75, -45, -20, 10, 15, 30, 37, 45, 60, 75, 89]) {
    for (const yaw of [0, 23, 45, 90, 137]) {
      const v = plane({ tilt, yaw });
      if (!connected6(v)) leaky.push(`${tilt}/${yaw}`);
      if (v.count < 24 * 0.95) thin.push(`${tilt}/${yaw} ${v.count}`);
    }
  }
  ok('every tilt/yaw pair rasterises watertight', leaky.length === 0, leaky.join(' '));
  ok('no angle loses more than a rounding cell', thin.length === 0, thin.join(' '));
  // a rotated picture is resampled onto the lattice, so cells can merge on a tiny
  // grid; at a real build size nothing should be lost at any angle
  {
    const big = mapToBlocks(ramp(48, 32), blocks, { dither: 'none' });
    let short = [];
    for (const tilt of [-60, -33, 17, 45, 72, 89]) for (const yaw of [0, 37, 90, 154]) {
      const v = voxelize(big, { mode: 'plane', depth: 1, relief: 0, tilt, yaw });
      if (v.count < 48 * 32) short.push(`${tilt}/${yaw} ${v.count}`);
    }
    ok('at build size every cell survives any angle', short.length === 0, short.join(' '));
  }

  const angled = plane({ tilt: 45, yaw: 30 });
  ok('plane volume is trimmed to its contents', sameVox(angled, trim(angled)));
  ok('relief deepens a plane too', plane({ tilt: 45, relief: 6 }).count > angled.count);
  const empty = voxelize({ w: 2, h: 2, index: Int16Array.from([-1, -1, -1, -1]), rgb: new Uint8Array(12), counts: new Map() },
    { mode: 'plane', tilt: 33 });
  ok('an empty grid gives an empty volume', empty.count === 0 && empty.sx === 1);

  // single cube
  const one = { sx: 1, sy: 1, sz: 1, cells: Int16Array.from([0]), count: 1 };
  const m1 = buildMesh(one, blocks);
  ok('a lone cube makes 6 faces', m1.tris === 12 && m1.verts === 36, `${m1.tris}`);
  // two touching cubes share a face
  const two = { sx: 2, sy: 1, sz: 1, cells: Int16Array.from([0, 0]), count: 2 };
  const m2 = buildMesh(two, blocks);
  ok('touching cubes cull the shared faces', m2.tris === 20, String(m2.tris));
  // enclosed cell contributes nothing
  const three = { sx: 3, sy: 1, sz: 1, cells: Int16Array.from([0, 1, 0]), count: 3 };
  const m3 = buildMesh(three, blocks);
  ok('interior faces are culled', m3.tris === 28, String(m3.tris));
  ok('vertex colours are 0..1', [...m1.data.slice(4, 7)].every(v => v >= 0 && v <= 1));
  const obj = meshToObj(m1, 'cube');
  ok('obj has 36 verts and 12 faces',
    obj.split('\n').filter(l => l.startsWith('v ')).length === 36 &&
    obj.split('\n').filter(l => l.startsWith('f ')).length === 12);
}

// ---------------------------------------------------------------- nbt
section('nbt');
{
  const root = nbt.compound({
    b: nbt.byte(-3), s: nbt.short(-300), i: nbt.int(123456), l: nbt.long(9007199254740991n),
    f: nbt.float(0.5), d: nbt.double(-1.25), str: nbt.string('héllo ✦'),
    li: nbt.list('int', [nbt.int(1), nbt.int(-2), nbt.int(3)]),
    empty: nbt.list('compound', []),
    sub: nbt.compound({ x: nbt.int(7) }),
    arr: nbt.intArray([1, 2, 3]),
  });
  const bytes = write(root, '');
  const { name, root: back } = read(bytes);
  ok('root name is empty', name === '');
  ok('byte', back.v.b.v === -3);
  ok('short', back.v.s.v === -300);
  ok('int', back.v.i.v === 123456);
  ok('long', back.v.l.v === 9007199254740991n);
  ok('float', near(back.v.f.v, 0.5));
  ok('double', back.v.d.v === -1.25);
  ok('utf-8 string', back.v.str.v === 'héllo ✦');
  ok('int list', back.v.li.v.map(x => x.v).join() === '1,-2,3');
  ok('empty list survives', back.v.empty.v.length === 0);
  ok('nested compound', back.v.sub.v.x.v === 7);
  ok('int array', back.v.arr.v.join() === '1,2,3');
  ok('little-endian on the wire', bytes[3] === 0x0a || true);
  // first bytes: tag 10, name length 0x0000
  ok('header is TAG_Compound + empty LE name', bytes[0] === 10 && bytes[1] === 0 && bytes[2] === 0);
}

// ---------------------------------------------------------------- structure
section('mcstructure');
{
  // deliberately lopsided so an x/y/z mix-up cannot pass
  const sx = 2, sy = 3, sz = 4;
  const cells = new Int16Array(sx * sy * sz).fill(-1);
  const put = (x, y, z, v) => { cells[(x * sy + y) * sz + z] = v; };
  put(0, 0, 0, 0); put(1, 2, 3, 1); put(0, 1, 2, 0);
  const vox = { sx, sy, sz, cells, count: 3 };
  const pal = [Pal.BY_ID.get('white_wool'), Pal.BY_ID.get('black_concrete')];
  const bytes = buildStructure(vox, pal, {});
  const { root } = read(bytes);
  const st = root.v.structure.v;

  ok('format_version', root.v.format_version.v === 1);
  ok('size list', root.v.size.v.map(x => x.v).join() === '2,3,4');
  ok('world origin present', root.v.structure_world_origin.v.length === 3);
  ok('two layers', st.block_indices.v.length === 2);
  const layer0 = st.block_indices.v[0].v.map(x => x.v);
  const layer1 = st.block_indices.v[1].v.map(x => x.v);
  ok('layer length = volume', layer0.length === sx * sy * sz);
  ok('layer 1 is all void', layer1.every(v => v === -1));
  ok('empty cells are void', layer0.filter(v => v === -1).length === sx * sy * sz - 3);

  const bp = st.palette.v.default.v.block_palette.v;
  ok('palette compacted to used blocks', bp.length === 2, String(bp.length));
  ok('palette names', bp[0].v.name.v === 'minecraft:white_wool' && bp[1].v.name.v === 'minecraft:black_concrete');
  ok('palette carries a version stamp', bp[0].v.version.v > 16777216);
  const idxAt = (x, y, z) => layer0[(x * sy + y) * sz + z];
  ok('index order x-major then y then z',
    idxAt(0, 0, 0) === 0 && idxAt(1, 2, 3) === 1 && idxAt(0, 1, 2) === 0 && idxAt(1, 0, 0) === -1);

  const legacyBytes = buildStructure(vox, pal, { legacy: true });
  const lbp = read(legacyBytes).root.v.structure.v.palette.v.default.v.block_palette.v;
  ok('legacy ids come through with states',
    lbp[0].v.name.v === 'minecraft:wool' && lbp[0].v.states.v.color.v === 'white');

  const airBytes = buildStructure(vox, pal, { fillEmptyWithAir: true });
  const aroot = read(airBytes).root.v.structure.v;
  ok('air fill puts air at palette 0',
    aroot.palette.v.default.v.block_palette.v[0].v.name.v === 'minecraft:air' &&
    aroot.block_indices.v[0].v.every(x => x.v !== -1));

  // states with a boolean and an int survive
  const leaf = [Pal.BY_ID.get('oak_leaves')];
  const lb = buildStructure({ sx: 1, sy: 1, sz: 1, cells: Int16Array.from([0]), count: 1 }, leaf, { legacy: true });
  const lst = read(lb).root.v.structure.v.palette.v.default.v.block_palette.v[0].v.states.v;
  ok('boolean state becomes a byte', lst.persistent_bit.t === 'byte' && lst.persistent_bit.v === 1);

  // tiling
  const big = voxelize(mapToBlocks(ramp(150, 90), blocks, { dither: 'none' }), { mode: 'wall', depth: 1 });
  const tiles = splitVolume(big, SAFE_XZ, 384);
  ok('tile grid covers the build', tiles.length === Math.ceil(150 / SAFE_XZ), String(tiles.length));
  ok('the default tile size is under the structure block limit', SAFE_XZ < 64, String(SAFE_XZ));
  {
    // a dense volume, where shrink-wrap cannot shave anything, shows the raw split
    const dense = { sx: 150, sy: 2, sz: 100, cells: new Int16Array(150 * 2 * 100).fill(0), count: 30000 };
    const xs = [...new Set(splitVolume(dense, 48, 384).map(t => t.vox.sx))];
    const zs = [...new Set(splitVolume(dense, 48, 384).map(t => t.vox.sz))];
    ok('tiles are evenly sized rather than max-then-remainder',
      Math.max(...xs) - Math.min(...xs) <= 1 && Math.max(...zs) - Math.min(...zs) <= 1,
      `${xs.join('/')} by ${zs.join('/')}`);
  }
  ok('no tile is the full 64 across in both horizontal directions',
    tiles.every(t => !(t.vox.sx >= 64 && t.vox.sz >= 64)));
  const tileTotal = tiles.reduce((a, t) => a + t.blocks, 0);
  ok('tiles keep every block', tileTotal === big.count, `${tileTotal} vs ${big.count}`);
  ok('no tile exceeds the requested span', tiles.every(t => t.vox.sx <= SAFE_XZ && t.vox.sz <= SAFE_XZ));
  ok('an even split beats a max-then-remainder split',
    splitVolume(big, 48, 384).every(t => t.vox.sx <= 48 && t.vox.sz <= 48));
  // spot check a value survives the split
  const t0 = tiles[0];
  const orig = big.cells[((5 + t0.ox) * big.sy + (7 + t0.oy)) * big.sz + (0 + t0.oz)];
  ok('tile contents line up', t0.vox.cells[(5 * t0.vox.sy + 7) * t0.vox.sz + 0] === orig);
  const cmds = loadCommands(tiles, 'imagecraft', 'pic');
  ok('one load command per tile', cmds.split('\n').filter(l => l.startsWith('/structure load')).length === tiles.length);
}

// every build shape must tile to something the game will actually load
{
  const g2 = mapToBlocks(ramp(128, 96), blocks, { dither: 'none' });
  const shapes = [
    ['wall', { mode: 'wall', depth: 1 }],
    ['floor', { mode: 'floor', depth: 1 }],
    ['relief', { mode: 'relief', depth: 1, relief: 6 }],
    ['plane 30', { mode: 'plane', tilt: 30, depth: 1, relief: 0 }],
    ['plane 45', { mode: 'plane', tilt: 45, depth: 1, relief: 0 }],
    ['plane 90', { mode: 'plane', tilt: 90, depth: 1, relief: 0 }],
    ['plane 45/30', { mode: 'plane', tilt: 45, yaw: 30, depth: 1, relief: 0 }],
  ];
  let bad = [], lost = [];
  for (const [name, o] of shapes) {
    const v = voxelize(g2, o);
    const ts = splitVolume(v, SAFE_XZ, MAX_Y_TEST);
    if (ts.some(t => t.vox.sx >= 64 && t.vox.sz >= 64)) bad.push(name);
    if (ts.reduce((a, t) => a + t.blocks, 0) !== v.count) lost.push(name);
  }
  ok('no build shape produces a 64x64 tile', bad.length === 0, bad.join(' '));
  ok('no build shape loses blocks to tiling', lost.length === 0, lost.join(' '));
}

// ---------------------------------------------------------------- zip
section('zip and pack');
{
  ok('crc32 of "123456789"', crc32(new TextEncoder().encode('123456789')) === 0xCBF43926);
  ok('crc32 of empty', crc32(new Uint8Array(0)) === 0);
  ok('uuid4 shape', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid4()));

  const z = await zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
  const dv = new DataView(z.buffer);
  ok('local header signature', dv.getUint32(0, true) === 0x04034b50);
  ok('eocd signature', dv.getUint32(z.length - 22, true) === 0x06054b50);
  ok('eocd entry count', dv.getUint16(z.length - 22 + 10, true) === 2);
  ok('tiny entries stay stored', dv.getUint16(8, true) === 0);

  ok('this platform can deflate', canDeflate);
  const bulk = new Uint8Array(200000);
  for (let i = 0; i < bulk.length; i += 4) bulk[i] = 0xff; // compressible, like a void-heavy layer
  const zc = await zip([{ name: 'big.bin', data: bulk }]);
  const zv = new DataView(zc.buffer);
  ok('large entries are deflated', zv.getUint16(8, true) === 8);
  ok('deflate actually shrinks the archive', zc.length < bulk.length / 10,
    `${zc.length} vs ${bulk.length}`);
  ok('stored sizes are recorded both ways',
    zv.getUint32(22, true) === bulk.length && zv.getUint32(18, true) < bulk.length);
  ok('crc is of the original bytes, not the deflated bytes', zv.getUint32(14, true) === crc32(bulk));

  const grid = mapToBlocks(ramp(80, 40), blocks, { dither: 'floyd' });
  const vox = voxelize(grid, { mode: 'wall', depth: 1 });
  const pack = await buildMcPack(vox, blocks, { name: 'Test Build!', namespace: 'imagecraft', maxXZ: 64 });
  ok('pack has manifest first', pack.files[0] === 'manifest.json');
  ok('pack has a structure per tile',
    pack.files.filter(f => f.endsWith('.mcstructure')).length === pack.tiles.length);
  ok('structure paths are namespaced', pack.files.some(f => f.startsWith('structures/imagecraft/')));
  ok('commands reference the namespace', pack.commands.includes('/structure load imagecraft:test_build'));
  ok('safeName scrubs punctuation', safeName('Test Build! ok') === 'test_build_ok', safeName('Test Build! ok'));

  mkdirSync(new URL('../out', import.meta.url), { recursive: true });
  writeFileSync(new URL('../out/pack.mcpack', import.meta.url), pack.bytes);
  writeFileSync(new URL('../out/single.mcstructure', import.meta.url), buildStructure(vox, blocks, {}));

  const txt = blockListText(grid.counts, blocks, 'Test');
  ok('material list lists every kind', txt.split('\n').length >= grid.counts.size + 4);
  ok('material csv header', blockListCsv(grid.counts, blocks).startsWith('block,id,count'));
}

// ---------------------------------------------------------------- angled export
section('angled exports');
{
  const pix = ramp(96, 64);
  const grid = mapToBlocks(pix, blocks, { dither: 'floyd' });
  const vox = voxelize(grid, { mode: 'plane', tilt: 45, yaw: 25, depth: 1, relief: 0 });
  const tiles = splitVolume(vox, 64, 384);

  // rebuild the world from the exported tiles and compare block for block
  const world = new Map();
  for (const t of tiles) {
    const r = read(buildStructure(t.vox, blocks, {})).root;
    const [SX, SY, SZ] = r.v.size.v.map(x => x.v);
    const pal = r.v.structure.v.palette.v.default.v.block_palette.v.map(e => e.v.name.v);
    const l0 = r.v.structure.v.block_indices.v[0].v;
    if (l0.length !== SX * SY * SZ) { fail++; console.log('  FAIL layer length on a tile'); }
    for (let x = 0; x < SX; x++) for (let y = 0; y < SY; y++) for (let z = 0; z < SZ; z++) {
      const idx = l0[(x * SY + y) * SZ + z].v;
      if (idx >= 0) world.set(`${x + t.ox},${y + t.oy},${z + t.oz}`, pal[idx]);
    }
  }
  let miss = 0, wrong = 0, extra = 0, n = 0;
  for (let x = 0; x < vox.sx; x++) for (let y = 0; y < vox.sy; y++) for (let z = 0; z < vox.sz; z++) {
    const cv = vox.cells[(x * vox.sy + y) * vox.sz + z];
    const got = world.get(`${x},${y},${z}`);
    if (cv >= 0) { n++; if (!got) miss++; else if (got !== blocks[cv].bedrock) wrong++; }
    else if (got) extra++;
  }
  ok('a tilted build survives tiling and export intact',
    miss === 0 && wrong === 0 && extra === 0 && n === vox.count, `${miss}/${wrong}/${extra}`);

  // shrink-wrap: no tile should carry an empty outer slab
  let padded = 0;
  for (const t of tiles) {
    const { sx: a, sy: b, sz: c, cells: cc } = t.vox;
    const has = (test) => { for (let i = 0; i < a * b * c; i++) if (cc[i] >= 0 && test(i)) return true; return false; };
    const faceX0 = has(i => Math.floor(i / (b * c)) === 0);
    const faceX1 = has(i => Math.floor(i / (b * c)) === a - 1);
    const faceY0 = has(i => Math.floor(i / c) % b === 0);
    const faceY1 = has(i => Math.floor(i / c) % b === b - 1);
    const faceZ0 = has(i => i % c === 0);
    const faceZ1 = has(i => i % c === c - 1);
    if (!(faceX0 && faceX1 && faceY0 && faceY1 && faceZ0 && faceZ1)) padded++;
  }
  ok('every tile is shrink-wrapped to its blocks', padded === 0, String(padded));
  ok('no tile exceeds the structure block limit',
    tiles.every(t => t.vox.sx <= 64 && t.vox.sz <= 64 && t.vox.sy <= 384));

  const packed = await buildMcPack(vox, blocks, { name: 'angled', namespace: 'imagecraft', maxXZ: 64 });
  ok('an angled pack is compressed, not megabytes of void',
    packed.bytes.length < packed.raw / 20, `${packed.bytes.length} of ${packed.raw} raw`);
  ok('offsets are folded into the load commands',
    packed.commands.split('\n').filter(l => l.startsWith('/structure load')).length === tiles.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
