// mesh.js — block grid -> voxel volume -> face-culled triangle mesh.
//
// Volume indexing matches the .mcstructure layout exactly:
//   i = (x * sy + y) * sz + z
// so the exporter can walk the same array with no re-ordering.

export const BUILD_MODES = [
  { id: 'wall', name: 'Wall', note: 'stands up, faces +Z (south)' },
  { id: 'floor', name: 'Floor', note: 'lies flat, read from above' },
  { id: 'relief', name: 'Relief', note: 'brightness pushes blocks forward' },
];

export const DEFAULT_BUILD = {
  mode: 'wall', depth: 1, relief: 4, reliefInvert: false, fillBack: true,
};

/**
 * grid: from mapper.mapToBlocks
 * returns { sx, sy, sz, cells:Int16Array, count }
 */
export function voxelize(grid, opts = {}) {
  const o = { ...DEFAULT_BUILD, ...opts };
  const { w, h, index, rgb } = grid;
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
      let off = 0;
      if (relief > 0) {
        const l = (0.2126 * rgb[ci * 3] + 0.7152 * rgb[ci * 3 + 1] + 0.0722 * rgb[ci * 3 + 2]) / 255;
        const t = o.reliefInvert ? 1 - l : l;
        off = Math.round(t * relief);
      }
      const z0 = o.fillBack ? 0 : off;
      for (let z = z0; z < off + depth; z++) put(col, y, z, v);
    }
  }
  return { sx, sy, sz, cells, count };
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
