// mesh.js — block grid -> voxel volume -> face-culled triangle mesh.
//
// Volume indexing matches the .mcstructure layout exactly:
//   i = (x * sy + y) * sz + z
// so the exporter can walk the same array with no re-ordering.

export const BUILD_MODES = [
  { id: 'wall', name: 'Wall', note: 'stands up, faces +Z (south)' },
  { id: 'floor', name: 'Floor', note: 'lies flat, read from above' },
  { id: 'relief', name: 'Relief', note: 'brightness pushes blocks forward' },
  { id: 'plane', name: 'Plane', note: 'tilt and turn it to any angle' },
];

export const DEFAULT_BUILD = {
  mode: 'wall', depth: 1, relief: 4, reliefInvert: false, fillBack: true,
  tilt: 30, yaw: 0,
};

const DEG = Math.PI / 180;

function reliefOffset(grid, ci, o, relief) {
  if (relief <= 0) return 0;
  const { rgb } = grid;
  const l = (0.2126 * rgb[ci * 3] + 0.7152 * rgb[ci * 3 + 1] + 0.0722 * rgb[ci * 3 + 2]) / 255;
  return Math.round((o.reliefInvert ? 1 - l : l) * relief);
}

/**
 * grid: from mapper.mapToBlocks
 * returns { sx, sy, sz, cells:Int16Array, count }
 */
export function voxelize(grid, opts = {}) {
  const o = { ...DEFAULT_BUILD, ...opts };
  if (o.mode === 'plane') return voxelizePlane(grid, o);

  const { w, h, index } = grid;
  const depth = Math.max(1, o.depth | 0);
  const relief = o.mode === 'relief' ? Math.max(0, o.relief | 0) : 0;

  let sx, sy, sz;
  if (o.mode === 'floor') { sx = w; sy = depth; sz = h; }
  else { sx = w; sy = h; sz = depth + relief; }

  const cells = new Int16Array(sx * sy * sz).fill(-1);
  let count = 0;
  const put = (x, y, z, v) => {
    const i = (x * sy + y) * sz + z;
    if (cells[i] === -1) count++;
    cells[i] = v;
  };

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ci = row * w + col;
      const v = index[ci];
      if (v < 0) continue;
      if (o.mode === 'floor') {
        for (let y = 0; y < depth; y++) put(col, y, row, v);
        continue;
      }
      // wall / relief: image row 0 is the top, so flip to world +Y up
      const y = h - 1 - row;
      const off = reliefOffset(grid, ci, o, relief);
      const z0 = o.fillBack ? 0 : off;
      for (let z = z0; z < off + depth; z++) put(col, y, z, v);
    }
  }
  return { sx, sy, sz, cells, count };
}

/**
 * Free-orientation plane. tilt 0 stands the image up exactly like Wall mode;
 * tilt 90 lays it down exactly like Floor mode; yaw spins the whole thing about
 * the vertical axis. Relief still applies, measured along the plane's normal.
 *
 * The volume is filled by inverse mapping — every voxel in the bounding box is
 * projected back into plane space — so no rotation angle can leave pin-holes the
 * way stamping cells forward would. The slab is widened by half the L1 norm of
 * the normal, which is the standard condition for a face-connected (watertight)
 * rasterised plane; at right angles that term is zero and nothing changes.
 */
function voxelizePlane(grid, o) {
  const { w, h, index } = grid;
  const depth = Math.max(1, o.depth | 0);
  const relief = Math.max(0, o.relief | 0);

  const t = (o.tilt || 0) * DEG, a = (o.yaw || 0) * DEG;
  const ct = Math.cos(t), st = Math.sin(t), ca = Math.cos(a), sa = Math.sin(a);
  // right angles should come out exactly axis-aligned, not 6e-17 off
  const snap = x => Math.abs(x) < 1e-9 ? 0 : (Math.abs(Math.abs(x) - 1) < 1e-9 ? Math.sign(x) : x);
  const ry = ([x, y, z]) => [snap(x * ca + z * sa), snap(y), snap(-x * sa + z * ca)];
  const u = ry([1, 0, 0]);          // image +X
  const v = ry([0, ct, -st]);       // image up
  const n = ry([0, st, ct]);        // out of the picture

  // bounding box of the rotated slab
  const hi = [w, h, depth + relief];
  const lo = [Infinity, Infinity, Infinity], up = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const uu = (c & 1) ? hi[0] : 0, vv = (c & 2) ? hi[1] : 0, ww = (c & 4) ? hi[2] : 0;
    for (let k = 0; k < 3; k++) {
      const p = uu * u[k] + vv * v[k] + ww * n[k];
      if (p < lo[k]) lo[k] = p;
      if (p > up[k]) up[k] = p;
    }
  }
  const pad = (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) - 1) / 2;
  for (let k = 0; k < 3; k++) {
    const e = pad * Math.abs(n[k]);
    lo[k] -= e; up[k] += e;
  }
  const sx = Math.max(1, Math.ceil(up[0] - lo[0]));
  const sy = Math.max(1, Math.ceil(up[1] - lo[1]));
  const sz = Math.max(1, Math.ceil(up[2] - lo[2]));

  const cells = new Int16Array(sx * sy * sz).fill(-1);
  const covered = new Uint8Array(w * h);
  let count = 0;

  // voxel (x,y,z) sits at plane-space point lo + (x+0.5, y+0.5, z+0.5)
  const ox = lo[0], oy = lo[1], oz = lo[2];
  // A voxel centre can land exactly on a slab boundary — at 45 degrees it often
  // does — and which side it falls on then depends on the sign of the rotation.
  // Nudging both ends outward keeps those centres in, which is what makes the
  // staircase face-connected rather than joined corner to corner.
  const EPS = 1e-6;

  for (let x = 0; x < sx; x++) {
    const px = x + 0.5 + ox;
    for (let y = 0; y < sy; y++) {
      const py = y + 0.5 + oy;
      // plane coordinates of (x, y, 0), then step along +Z incrementally
      let uu = px * u[0] + py * u[1] + (0.5 + oz) * u[2];
      let vv = px * v[0] + py * v[1] + (0.5 + oz) * v[2];
      let ww = px * n[0] + py * n[1] + (0.5 + oz) * n[2];
      const base = (x * sy + y) * sz;
      for (let z = 0; z < sz; z++, uu += u[2], vv += v[2], ww += n[2]) {
        if (uu < 0 || vv < 0 || uu >= w || vv >= h) continue;
        const col = uu | 0, row = h - 1 - (vv | 0);
        const ci = row * w + col;
        const val = index[ci];
        if (val < 0) continue;
        const off = reliefOffset(grid, ci, o, relief);
        const lo2 = (o.fillBack ? 0 : off) - pad - EPS;
        const hi2 = off + depth + pad + EPS;
        if (ww < lo2 || ww >= hi2) continue;
        cells[base + z] = val;
        covered[ci] = 1;
        count++;
      }
    }
  }
  // Near-right angles can step past a row between voxel centres. Any cell the
  // sweep missed gets stamped at its own centre so no part of the picture is lost.
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const ci = row * w + col;
      const val = index[ci];
      if (val < 0 || covered[ci]) continue;
      const uu = col + 0.5, vv = (h - 1 - row) + 0.5;
      const ww = reliefOffset(grid, ci, o, relief) + depth * 0.5;
      const x = Math.min(sx - 1, Math.max(0, Math.floor(uu * u[0] + vv * v[0] + ww * n[0] - ox)));
      const y = Math.min(sy - 1, Math.max(0, Math.floor(uu * u[1] + vv * v[1] + ww * n[1] - oy)));
      const z = Math.min(sz - 1, Math.max(0, Math.floor(uu * u[2] + vv * v[2] + ww * n[2] - oz)));
      const i = (x * sy + y) * sz + z;
      if (cells[i] === -1) { cells[i] = val; count++; }
    }
  }

  return trim({ sx, sy, sz, cells, count });
}

/** Crop a volume to the blocks it actually holds, so no empty slabs get exported. */
export function trim(vox) {
  const { sx, sy, sz, cells } = vox;
  let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    if (cells[(x * sy + y) * sz + z] < 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (x1 < 0) return { sx: 1, sy: 1, sz: 1, cells: Int16Array.from([-1]), count: 0 };
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1;
  if (nx === sx && ny === sy && nz === sz) return vox;
  const out = new Int16Array(nx * ny * nz).fill(-1);
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    out[(x * ny + y) * nz + z] = cells[((x + x0) * sy + (y + y0)) * sz + (z + z0)];
  }
  return { sx: nx, sy: ny, sz: nz, cells: out, count: vox.count };
}

const FACES = [
  // dir, shade, 4 corner offsets (CCW seen from outside)
  { n: [1, 0, 0], s: 0.82, v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], s: 0.72, v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], s: 1.0, v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], s: 0.5, v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], s: 0.92, v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], s: 0.62, v: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 0]] },
];

/**
 * vox: from voxelize.  blocks: palette entries (for colours)
 * returns { data:Float32Array interleaved [x,y,z,shade,r,g,b], verts, tris }
 */
export function buildMesh(vox, blocks) {
  const { sx, sy, sz, cells } = vox;
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz)
    ? -1 : cells[(x * sy + y) * sz + z];

  // count faces first so we can allocate exactly once
  let faces = 0;
  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    if (at(x, y, z) < 0) continue;
    for (const f of FACES) if (at(x + f.n[0], y + f.n[1], z + f.n[2]) < 0) faces++;
  }

  const stride = 7;
  const data = new Float32Array(faces * 6 * stride);
  let p = 0;
  const push = (x, y, z, s, c) => {
    data[p] = x; data[p + 1] = y; data[p + 2] = z; data[p + 3] = s;
    data[p + 4] = c[0] / 255; data[p + 5] = c[1] / 255; data[p + 6] = c[2] / 255;
    p += stride;
  };

  for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
    const v = at(x, y, z);
    if (v < 0) continue;
    const col = (blocks[v] && blocks[v].rgb) || [255, 0, 255];
    for (const f of FACES) {
      if (at(x + f.n[0], y + f.n[1], z + f.n[2]) >= 0) continue;
      const q = f.v;
      const tri = [0, 1, 2, 0, 2, 3];
      for (const k of tri) push(x + q[k][0], y + q[k][1], z + q[k][2], f.s, col);
    }
  }
  return { data, verts: faces * 6, tris: faces * 2, stride };
}

/** Wavefront OBJ of the same mesh, one grey material (colours go in vertex colours). */
export function meshToObj(mesh, name = 'imagecraft') {
  const { data, verts, stride } = mesh;
  const out = [`# ${name} — exported by Imagecraft`, `o ${name}`];
  for (let i = 0; i < verts; i++) {
    const o = i * stride;
    out.push(`v ${data[o].toFixed(3)} ${data[o + 1].toFixed(3)} ${data[o + 2].toFixed(3)} ` +
      `${data[o + 4].toFixed(4)} ${data[o + 5].toFixed(4)} ${data[o + 6].toFixed(4)}`);
  }
  for (let i = 0; i < verts; i += 3) out.push(`f ${i + 1} ${i + 2} ${i + 3}`);
  return out.join('\n') + '\n';
}
