// mapper.js — turn a resampled RGBA buffer into a grid of palette indices.
// -1 means "no block" (air / structure void).

import { Matcher } from './color.js';

export const DITHER_MODES = [
  { id: 'none', name: 'None' },
  { id: 'floyd', name: 'Floyd–Steinberg' },
  { id: 'atkinson', name: 'Atkinson' },
  { id: 'sierra', name: 'Sierra Lite' },
  { id: 'bayer2', name: 'Ordered 2×2' },
  { id: 'bayer4', name: 'Ordered 4×4' },
  { id: 'bayer8', name: 'Ordered 8×8' },
  { id: 'noise', name: 'White noise' },
];

// Error-diffusion kernels: [dx, dy, weight]
const KERNELS = {
  floyd: { div: 16, taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  atkinson: { div: 8, taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  sierra: { div: 4, taps: [[1, 0, 2], [-1, 1, 1], [0, 1, 1]] },
};

function bayerMatrix(n) {
  if (n === 1) return [[0]];
  const s = bayerMatrix(n >> 1), m = [];
  for (let y = 0; y < n; y++) {
    m[y] = [];
    for (let x = 0; x < n; x++) {
      const q = (y < n / 2 ? 0 : 2) + (x < n / 2 ? 0 : 1);
      const base = [0, 2, 3, 1][q];
      m[y][x] = 4 * s[y % (n >> 1)][x % (n >> 1)] + base;
    }
  }
  return m;
}
const BAYER = { bayer2: bayerMatrix(2), bayer4: bayerMatrix(4), bayer8: bayerMatrix(8) };

// Deterministic hash noise so the same settings always give the same build.
function hashNoise(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 - 0.5;
}

export const DEFAULT_MAP_OPTS = {
  dither: 'floyd', strength: 0.85, matchMode: 'lab76', alphaCutoff: 128, serpentine: true,
};

/**
 * pix: {w,h,data:Float32Array}   blocks: palette entry array
 * locks: Map<cellIndex, blockId> forced choices (painted by hand)
 * returns { w, h, index:Int16Array, rgb:Uint8Array(w*h*3), counts:Map<blockId,int>, used:[] }
 */
export function mapToBlocks(pix, blocks, opts = {}, locks = null) {
  const o = { ...DEFAULT_MAP_OPTS, ...opts };
  const { w, h } = pix;
  const index = new Int16Array(w * h).fill(-1);
  const rgb = new Uint8Array(w * h * 3);
  const counts = new Map();
  if (!blocks.length) return { w, h, index, rgb, counts, blocks };

  const matcher = new Matcher(blocks, o.matchMode);
  const byId = new Map(blocks.map((b, i) => [b.id, i]));

  // working copy we can push error into
  const src = pix.data;
  const buf = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    buf[j] = src[i * 4]; buf[j + 1] = src[i * 4 + 1]; buf[j + 2] = src[i * 4 + 2];
  }

  const kernel = KERNELS[o.dither];
  const bayer = BAYER[o.dither];
  const bn = bayer ? bayer.length : 0;
  const amp = o.strength;

  for (let y = 0; y < h; y++) {
    const rev = o.serpentine && kernel && (y & 1) === 1;
    for (let k = 0; k < w; k++) {
      const x = rev ? w - 1 - k : k;
      const ci = y * w + x, bi = ci * 3;
      // A hand-painted cell wins over both the alpha cutoff and the matcher.
      // An empty-string lock means the user erased that cell on purpose.
      const lock = locks ? locks.get(ci) : undefined;
      if (lock === '') continue;
      if (lock === undefined && src[ci * 4 + 3] < o.alphaCutoff) continue;

      let r = buf[bi], g = buf[bi + 1], b = buf[bi + 2];
      if (bayer) {
        const t = (bayer[y % bn][x % bn] + 0.5) / (bn * bn) - 0.5;
        const d = t * 48 * amp;
        r += d; g += d; b += d;
      } else if (o.dither === 'noise') {
        const d = hashNoise(x, y) * 48 * amp;
        r += d; g += d; b += d;
      }

      const pi = (lock !== undefined && byId.has(lock)) ? byId.get(lock) : matcher.match(r, g, b);
      if (pi < 0) continue;

      const pal = blocks[pi].rgb;
      index[ci] = pi;
      rgb[bi] = pal[0]; rgb[bi + 1] = pal[1]; rgb[bi + 2] = pal[2];
      counts.set(blocks[pi].id, (counts.get(blocks[pi].id) || 0) + 1);

      if (kernel) {
        const er = (r - pal[0]) * amp, eg = (g - pal[1]) * amp, eb = (b - pal[2]) * amp;
        for (const [dx0, dy, wt] of kernel.taps) {
          const dx = rev ? -dx0 : dx0;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = (ny * w + nx) * 3, f = wt / kernel.div;
          buf[ni] += er * f; buf[ni + 1] += eg * f; buf[ni + 2] += eb * f;
        }
      }
    }
  }
  return { w, h, index, rgb, counts, blocks };
}

/** Mean CIE76-ish error of the mapping, in 0..100 Lab units. Cheap quality read-out. */
export function mapError(pix, grid) {
  const { w, h, index, rgb } = grid;
  let sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (index[i] < 0) continue;
    const dr = pix.data[i * 4] - rgb[i * 3];
    const dg = pix.data[i * 4 + 1] - rgb[i * 3 + 1];
    const db = pix.data[i * 4 + 2] - rgb[i * 3 + 2];
    sum += Math.sqrt(dr * dr + dg * dg + db * db); n++;
  }
  return n ? sum / n : 0;
}
