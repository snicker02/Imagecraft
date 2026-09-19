// pixelize.js — image adjustments and resampling down to the block grid.
// Works on a plain {w, h, data:Float32Array(w*h*4)} RGBA buffer, 0..255.

export function fromImageData(img) {
  const n = img.width * img.height * 4;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = img.data[i];
  return { w: img.width, h: img.height, data };
}

export function toImageData(buf) {
  const out = new ImageData(buf.w, buf.h);
  for (let i = 0; i < buf.data.length; i++) out.data[i] = Math.max(0, Math.min(255, Math.round(buf.data[i])));
  return out;
}

export const DEFAULT_ADJUST = {
  brightness: 0, contrast: 0, saturation: 0, gamma: 1, hue: 0, posterize: 0, sharpen: 0,
};

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

/** Non-destructive: returns a new buffer. */
export function adjust(buf, a) {
  const o = { w: buf.w, h: buf.h, data: new Float32Array(buf.data.length) };
  const src = buf.data, dst = o.data;
  const c = Math.tan((Math.min(0.99, Math.max(-0.99, a.contrast)) + 1) * Math.PI / 4); // slope
  const bri = a.brightness * 255;
  const sat = a.saturation + 1;
  const invG = 1 / Math.max(0.05, a.gamma);
  const hue = (a.hue || 0) * Math.PI / 180;
  const cosH = Math.cos(hue), sinH = Math.sin(hue);
  const levels = a.posterize | 0;
  for (let i = 0; i < src.length; i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2];
    // gamma
    if (a.gamma !== 1) {
      r = 255 * Math.pow(r / 255, invG);
      g = 255 * Math.pow(g / 255, invG);
      b = 255 * Math.pow(b / 255, invG);
    }
    // brightness + contrast around mid grey
    r = (r - 128) * c + 128 + bri;
    g = (g - 128) * c + 128 + bri;
    b = (b - 128) * c + 128 + bri;
    // saturation
    if (sat !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    // hue rotation (YIQ)
    if (hue !== 0) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const I = 0.596 * r - 0.274 * g - 0.322 * b;
      const Q = 0.211 * r - 0.523 * g + 0.312 * b;
      const I2 = I * cosH - Q * sinH, Q2 = I * sinH + Q * cosH;
      r = y + 0.956 * I2 + 0.621 * Q2;
      g = y - 0.272 * I2 - 0.647 * Q2;
      b = y - 1.106 * I2 + 1.703 * Q2;
    }
    if (levels >= 2) {
      const s = 255 / (levels - 1);
      r = Math.round(r / s) * s; g = Math.round(g / s) * s; b = Math.round(b / s) * s;
    }
    dst[i] = clamp255(r); dst[i + 1] = clamp255(g); dst[i + 2] = clamp255(b); dst[i + 3] = src[i + 3];
  }
  if (a.sharpen > 0) return sharpen(o, a.sharpen);
  return o;
}

/** 3x3 unsharp-style kernel, amount 0..1.5 */
export function sharpen(buf, amount) {
  const { w, h, data } = buf;
  const out = new Float32Array(data.length);
  const k = amount;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            sum += data[(yy * w + xx) * 4 + ch];
          }
        }
        const blur = sum / 9;
        out[i + ch] = clamp255(data[i + ch] + (data[i + ch] - blur) * k * 2);
      }
      out[i + 3] = data[i + 3];
    }
  }
  return { w, h, data: out };
}

export const RESAMPLE_MODES = [
  { id: 'box', name: 'Area average', note: 'smooth, best for photos' },
  { id: 'nearest', name: 'Nearest pixel', note: 'crisp, best for pixel art' },
  { id: 'bilinear', name: 'Bilinear', note: 'soft' },
  { id: 'median', name: 'Dominant', note: 'flat, poster-like' },
];

/**
 * Resample to exactly w x h. Crop is applied first as {x,y,w,h} in source pixels.
 */
export function resample(buf, w, h, mode = 'box', crop = null) {
  const sx0 = crop ? crop.x : 0, sy0 = crop ? crop.y : 0;
  const sw = crop ? crop.w : buf.w, sh = crop ? crop.h : buf.h;
  const out = { w, h, data: new Float32Array(w * h * 4) };
  const s = buf.data, d = out.data, W = buf.w;

  const sampleNearest = (x, y, o) => {
    const px = Math.min(buf.w - 1, Math.max(0, Math.floor(sx0 + (x + 0.5) * sw / w)));
    const py = Math.min(buf.h - 1, Math.max(0, Math.floor(sy0 + (y + 0.5) * sh / h)));
    const i = (py * W + px) * 4;
    d[o] = s[i]; d[o + 1] = s[i + 1]; d[o + 2] = s[i + 2]; d[o + 3] = s[i + 3];
  };

  const sampleBox = (x, y, o) => {
    const x0 = sx0 + x * sw / w, x1 = sx0 + (x + 1) * sw / w;
    const y0 = sy0 + y * sh / h, y1 = sy0 + (y + 1) * sh / h;
    const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(buf.w, Math.max(ix0 + 1, Math.ceil(x1)));
    const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(buf.h, Math.max(iy0 + 1, Math.ceil(y1)));
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    for (let py = iy0; py < iy1; py++) {
      for (let px = ix0; px < ix1; px++) {
        const i = (py * W + px) * 4;
        const al = s[i + 3] / 255;
        r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += s[i + 3];
        wsum += al;
      }
    }
    const n = (ix1 - ix0) * (iy1 - iy0);
    if (wsum < 1e-6) { d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 0; return; }
    d[o] = r / wsum; d[o + 1] = g / wsum; d[o + 2] = b / wsum; d[o + 3] = a / n;
  };

  const sampleBilinear = (x, y, o) => {
    const fx = sx0 + (x + 0.5) * sw / w - 0.5, fy = sy0 + (y + 0.5) * sh / h - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const px = (cx, cy) => ((Math.min(buf.h - 1, Math.max(0, cy)) * W) + Math.min(buf.w - 1, Math.max(0, cx))) * 4;
    const i00 = px(x0, y0), i10 = px(x0 + 1, y0), i01 = px(x0, y0 + 1), i11 = px(x0 + 1, y0 + 1);
    for (let c = 0; c < 4; c++) {
      const top = s[i00 + c] * (1 - tx) + s[i10 + c] * tx;
      const bot = s[i01 + c] * (1 - tx) + s[i11 + c] * tx;
      d[o + c] = top * (1 - ty) + bot * ty;
    }
  };

  // Dominant: coarse 4-4-4 histogram over the cell, take the modal bucket mean.
  const hist = new Map();
  const sampleMedian = (x, y, o) => {
    hist.clear();
    const x0 = Math.max(0, Math.floor(sx0 + x * sw / w)), x1 = Math.min(buf.w, Math.ceil(sx0 + (x + 1) * sw / w));
    const y0 = Math.max(0, Math.floor(sy0 + y * sh / h)), y1 = Math.min(buf.h, Math.ceil(sy0 + (y + 1) * sh / h));
    let bestKey = -1, bestN = 0, alpha = 0, n = 0;
    for (let py = y0; py < Math.max(y1, y0 + 1); py++) {
      for (let px = x0; px < Math.max(x1, x0 + 1); px++) {
        const i = (Math.min(buf.h - 1, py) * W + Math.min(buf.w - 1, px)) * 4;
        const key = ((s[i] >> 4) << 8) | ((s[i + 1] >> 4) << 4) | (s[i + 2] >> 4);
        let e = hist.get(key);
        if (!e) { e = [0, 0, 0, 0]; hist.set(key, e); }
        e[0] += s[i]; e[1] += s[i + 1]; e[2] += s[i + 2]; e[3]++;
        if (e[3] > bestN) { bestN = e[3]; bestKey = key; }
        alpha += s[i + 3]; n++;
      }
    }
    const e = hist.get(bestKey) || [0, 0, 0, 1];
    d[o] = e[0] / e[3]; d[o + 1] = e[1] / e[3]; d[o + 2] = e[2] / e[3]; d[o + 3] = n ? alpha / n : 0;
  };

  const fn = mode === 'nearest' ? sampleNearest : mode === 'bilinear' ? sampleBilinear
    : mode === 'median' ? sampleMedian : sampleBox;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x, y, (y * w + x) * 4);
  return out;
}

/**
 * Separable Gaussian, with the radius measured in cells rather than source
 * pixels. Run after resampling, so "0.8" means eight tenths of a block however
 * big the original picture was — the smoothing you see is the smoothing you
 * asked for, and it is what takes the speckle out of a dithered or noisy
 * photograph before the blocks are chosen.
 *
 * Colour is weighted by alpha so a cut-out edge does not drag transparent
 * black into the blocks beside it.
 */
export function blur(buf, sigma) {
  if (!(sigma > 0.01)) return buf;
  const { w, h, data } = buf;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(rad * 2 + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + rad] = v; sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;

  // premultiply once, blur, then undo
  const pm = new Float32Array(data.length);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    pm[i * 4] = data[i * 4] * a;
    pm[i * 4 + 1] = data[i * 4 + 1] * a;
    pm[i * 4 + 2] = data[i * 4 + 2] * a;
    pm[i * 4 + 3] = data[i * 4 + 3];
  }

  const tmp = new Float32Array(data.length);
  const out = new Float32Array(data.length);
  const pass = (src, dst, W, H, stepX) => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let i = -rad; i <= rad; i++) {
          const sx = stepX ? Math.min(W - 1, Math.max(0, x + i)) : x;
          const sy = stepX ? y : Math.min(H - 1, Math.max(0, y + i));
          const o = (sy * W + sx) * 4, wt = k[i + rad];
          r += src[o] * wt; g += src[o + 1] * wt; b += src[o + 2] * wt; a += src[o + 3] * wt;
        }
        const o = (y * W + x) * 4;
        dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = a;
      }
    }
  };
  pass(pm, tmp, w, h, true);
  pass(tmp, out, w, h, false);

  for (let i = 0; i < w * h; i++) {
    const a = out[i * 4 + 3] / 255;
    if (a > 0.0001) {
      out[i * 4] /= a; out[i * 4 + 1] /= a; out[i * 4 + 2] /= a;
    }
  }
  return { w, h, data: out };
}

/** Fit an image of size (iw,ih) into a block grid of max width/height, keeping aspect. */
export function fitGrid(iw, ih, maxW, maxH, lockAspect = true) {
  if (!lockAspect) return { w: maxW, h: maxH };
  const s = Math.min(maxW / iw, maxH / ih);
  return { w: Math.max(1, Math.round(iw * s)), h: Math.max(1, Math.round(ih * s)) };
}
