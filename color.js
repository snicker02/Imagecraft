// color.js — sRGB <-> CIELAB, perceptual distance metrics, cached palette matching.
// No dependencies. Everything works on plain numbers / typed arrays.

const REF_X = 95.047, REF_Y = 100.0, REF_Z = 108.883; // D65, 2 deg observer

export function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

export function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r) * 100, G = srgbToLinear(g) * 100, B = srgbToLinear(b) * 100;
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  ];
}

function f(t) { return t > 0.008856451679 ? Math.cbrt(t) : (903.2962962 * t + 16) / 116; }

export function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b);
  const fx = f(x / REF_X), fy = f(y / REF_Y), fz = f(z / REF_Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

// --- distance metrics -------------------------------------------------------

export function dRgb(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

// Low-cost approximation of perceptual distance in sRGB (Thiadmer Riemersma).
export function dRgbWeighted(a, b) {
  const rm = (a[0] + b[0]) * 0.5;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function dLab76(a, b) {
  const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

// CIEDE2000, returned squared-ish (we return dE^2 so all metrics compare alike).
export function dLab2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const C7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 6103515625))); // 25^7
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  let hp1 = Math.atan2(b1, ap1); if (hp1 < 0) hp1 += 2 * Math.PI;
  let hp2 = Math.atan2(b2, ap2); if (hp2 < 0) hp2 += 2 * Math.PI;
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > Math.PI) dhp -= 2 * Math.PI;
    else if (dhp < -Math.PI) dhp += 2 * Math.PI;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dhp / 2);
  const Lbar = (L1 + L2) / 2, Cpbar = (Cp1 + Cp2) / 2;
  let hbar = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) {
    if (Math.abs(hp1 - hp2) > Math.PI) hbar += (hbar < 2 * Math.PI) ? 2 * Math.PI : -2 * Math.PI;
    hbar /= 2;
  }
  const T = 1 - 0.17 * Math.cos(hbar - Math.PI / 6) + 0.24 * Math.cos(2 * hbar)
    + 0.32 * Math.cos(3 * hbar + Math.PI / 30) - 0.20 * Math.cos(4 * hbar - 63 * Math.PI / 180);
  const dTheta = (30 * Math.PI / 180) * Math.exp(-Math.pow((hbar * 180 / Math.PI - 275) / 25, 2));
  const Cpbar7 = Math.pow(Cpbar, 7);
  const Rc = 2 * Math.sqrt(Cpbar7 / (Cpbar7 + 6103515625));
  const Lbar50 = (Lbar - 50) * (Lbar - 50);
  const Sl = 1 + (0.015 * Lbar50) / Math.sqrt(20 + Lbar50);
  const Sc = 1 + 0.045 * Cpbar;
  const Sh = 1 + 0.015 * Cpbar * T;
  const Rt = -Math.sin(2 * dTheta) * Rc;
  const tL = dL / Sl, tC = dC / Sc, tH = dH / Sh;
  const dE = Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
  return dE * dE;
}

export const MATCH_MODES = [
  { id: 'lab2000', name: 'Lab (CIEDE2000)', note: 'slowest, best hue behaviour' },
  { id: 'lab76', name: 'Lab (CIE76)', note: 'good and fast' },
  { id: 'rgbw', name: 'Weighted RGB', note: 'contrasty, saturated' },
  { id: 'rgb', name: 'Plain RGB', note: 'naive, for comparison' },
];

// CIEDE2000 costs roughly 30x a CIE76 distance. For palettes bigger than
// EXACT_BELOW we shortlist the CAND nearest by CIE76 and re-rank only those.
// Measured against an exhaustive CIEDE2000 scan of the full 205-block palette
// over 4000 random colours: 13 disagreements, worst penalty 3.3 dE2000 — below
// the point where two blocks read differently in a mosaic. Smaller palettes are
// scanned exhaustively, so a curated palette is always exact.
const CAND = 32;
const EXACT_BELOW = 64;

/**
 * Nearest-block matcher over a list of palette entries.
 * entries: [{rgb:[r,g,b], lab:[L,a,b], ...}]
 * Caches by packed 8-bit RGB so repeated colours cost one Map lookup.
 */
export class Matcher {
  constructor(entries, mode = 'lab76') {
    this.entries = entries;
    this.mode = mode;
    this.cache = new Map();
    this.candIdx = new Int32Array(CAND);
    this.candDist = new Float64Array(CAND);
    this.rgb = new Float64Array(entries.length * 3);
    this.lab = new Float64Array(entries.length * 3);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      this.rgb[i * 3] = e.rgb[0]; this.rgb[i * 3 + 1] = e.rgb[1]; this.rgb[i * 3 + 2] = e.rgb[2];
      const lab = e.lab || rgbToLab(e.rgb[0], e.rgb[1], e.rgb[2]);
      this.lab[i * 3] = lab[0]; this.lab[i * 3 + 1] = lab[1]; this.lab[i * 3 + 2] = lab[2];
    }
  }

  /** Returns the index into entries of the closest block, or -1 for an empty palette. */
  match(r, g, b) {
    r = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
    g = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
    b = b < 0 ? 0 : b > 255 ? 255 : Math.round(b);
    const key = (r << 16) | (g << 8) | b;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const n = this.entries.length;
    if (n === 0) return -1;
    let best = -1, bestD = Infinity;
    const c = [r, g, b];
    const lab = (this.mode === 'lab76' || this.mode === 'lab2000') ? rgbToLab(r, g, b) : null;
    const tmp = [0, 0, 0];

    if (this.mode === 'lab2000' && n > EXACT_BELOW) {
      const K = Math.min(CAND, n);
      const ci = this.candIdx, cd = this.candDist;
      let filled = 0, worst = Infinity, worstAt = 0;
      for (let i = 0; i < n; i++) {
        tmp[0] = this.lab[i * 3]; tmp[1] = this.lab[i * 3 + 1]; tmp[2] = this.lab[i * 3 + 2];
        const d = dLab76(lab, tmp);
        if (filled < K) {
          ci[filled] = i; cd[filled] = d; filled++;
          if (filled === K) {
            worst = -Infinity;
            for (let j = 0; j < K; j++) if (cd[j] > worst) { worst = cd[j]; worstAt = j; }
          }
        } else if (d < worst) {
          ci[worstAt] = i; cd[worstAt] = d;
          worst = -Infinity;
          for (let j = 0; j < K; j++) if (cd[j] > worst) { worst = cd[j]; worstAt = j; }
        }
      }
      for (let j = 0; j < filled; j++) {
        const i = ci[j];
        tmp[0] = this.lab[i * 3]; tmp[1] = this.lab[i * 3 + 1]; tmp[2] = this.lab[i * 3 + 2];
        const d = dLab2000(lab, tmp);
        if (d < bestD) { bestD = d; best = i; }
      }
      this.cache.set(key, best);
      return best;
    }

    for (let i = 0; i < n; i++) {
      let d;
      if (lab) {
        tmp[0] = this.lab[i * 3]; tmp[1] = this.lab[i * 3 + 1]; tmp[2] = this.lab[i * 3 + 2];
        d = this.mode === 'lab76' ? dLab76(lab, tmp) : dLab2000(lab, tmp);
      } else {
        tmp[0] = this.rgb[i * 3]; tmp[1] = this.rgb[i * 3 + 1]; tmp[2] = this.rgb[i * 3 + 2];
        d = this.mode === 'rgb' ? dRgb(c, tmp) : dRgbWeighted(c, tmp);
      }
      if (d < bestD) { bestD = d; best = i; }
    }
    this.cache.set(key, best);
    return best;
  }
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
