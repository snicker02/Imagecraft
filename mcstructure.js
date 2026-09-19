// mcstructure.js — Bedrock structure files.
//
// Layout of a .mcstructure (uncompressed little-endian NBT):
//   format_version: int
//   size: list<int>[3]
//   structure:
//     block_indices: list< list<int> >   two layers; -1 = structure void
//     entities: list<compound>
//     palette: { default: { block_palette: list<compound>, block_position_data: {} } }
//   structure_world_origin: list<int>[3]
//
// Index order is x-major then y then z: i = (x * sy + y) * sz + z, which is the
// same order mesh.voxelize() writes, so no re-shuffling happens here.

import { write, nbt } from './nbt.js';
import { resolveBlock } from './palette.js';

/** Packed block version stamp. Bedrock accepts older stamps and upgrades them. */
export const BLOCK_VERSION = (1 << 24) | (21 << 16) | (60 << 8) | 0; // 1.21.60

/** A structure block can load 64 x 384 x 64 at most. */
export const MAX_XZ = 64;
export const MAX_Y = 384;

function statesToNbt(states) {
  const out = {};
  for (const [k, v] of Object.entries(states || {})) {
    if (typeof v === 'boolean') out[k] = nbt.byte(v ? 1 : 0);
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? nbt.int(v) : nbt.float(v);
    else out[k] = nbt.string(String(v));
  }
  return nbt.compound(out);
}

/**
 * vox: {sx,sy,sz,cells:Int16Array}  blocks: palette entries
 * opts: { legacy:false, fillEmptyWithAir:false, version:BLOCK_VERSION }
 * Returns Uint8Array ready to write as <name>.mcstructure
 */
export function buildStructure(vox, blocks, opts = {}) {
  const { sx, sy, sz, cells } = vox;
  const legacy = !!opts.legacy;
  const version = opts.version || BLOCK_VERSION;

  // Compact the palette down to the blocks this volume actually uses.
  const remap = new Map();       // palette entry index -> structure palette index
  const entries = [];
  const layer0 = new Array(sx * sy * sz);
  const layer1 = new Array(sx * sy * sz);

  let airIdx = -1;
  if (opts.fillEmptyWithAir) {
    airIdx = 0;
    entries.push(nbt.compound({
      name: nbt.string('minecraft:air'), states: nbt.compound({}), version: nbt.int(version),
    }));
  }

  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v < 0) { layer0[i] = nbt.int(airIdx); layer1[i] = nbt.int(-1); continue; }
    let pi = remap.get(v);
    if (pi === undefined) {
      const b = blocks[v];
      const { name, states } = resolveBlock(b, legacy);
      pi = entries.length;
      entries.push(nbt.compound({
        name: nbt.string(name), states: statesToNbt(states), version: nbt.int(version),
      }));
      remap.set(v, pi);
    }
    layer0[i] = nbt.int(pi);
    layer1[i] = nbt.int(-1);
  }

  const root = nbt.compound({
    format_version: nbt.int(1),
    size: nbt.list('int', [nbt.int(sx), nbt.int(sy), nbt.int(sz)]),
    structure: nbt.compound({
      block_indices: nbt.list('list', [nbt.list('int', layer0), nbt.list('int', layer1)]),
      entities: nbt.list('compound', []),
      palette: nbt.compound({
        default: nbt.compound({
          block_palette: nbt.list('compound', entries),
          block_position_data: nbt.compound({}),
        }),
      }),
    }),
    structure_world_origin: nbt.list('int', [nbt.int(0), nbt.int(0), nbt.int(0)]),
  });
  return write(root, '');
}

/** Cut a volume into loadable tiles. Returns [{ox,oy,oz,vox,row,col,layer}]. */
export function splitVolume(vox, maxXZ = MAX_XZ, maxY = MAX_Y) {
  const { sx, sy, sz, cells } = vox;
  const tiles = [];
  const nx = Math.ceil(sx / maxXZ), ny = Math.ceil(sy / maxY), nz = Math.ceil(sz / maxXZ);
  for (let tx = 0; tx < nx; tx++) {
    for (let ty = 0; ty < ny; ty++) {
      for (let tz = 0; tz < nz; tz++) {
        const ox = tx * maxXZ, oy = ty * maxY, oz = tz * maxXZ;
        const w = Math.min(maxXZ, sx - ox), hgt = Math.min(maxY, sy - oy), d = Math.min(maxXZ, sz - oz);
        const sub = new Int16Array(w * hgt * d).fill(-1);
        let used = 0;
        for (let x = 0; x < w; x++) for (let y = 0; y < hgt; y++) for (let z = 0; z < d; z++) {
          const v = cells[((x + ox) * sy + (y + oy)) * sz + (z + oz)];
          sub[(x * hgt + y) * d + z] = v;
          if (v >= 0) used++;
        }
        if (!used) continue;
        tiles.push({
          ox, oy, oz, row: ty, col: tx, layer: tz, blocks: used,
          vox: { sx: w, sy: hgt, sz: d, cells: sub, count: used },
        });
      }
    }
  }
  return tiles;
}

/** /structure load lines, relative to where the player stands. */
export function loadCommands(tiles, namespace, base) {
  const lines = [
    '# Stand at the bottom-north-west corner of where the build should go, facing south,',
    '# then run these in order. ~ ~ ~ is your own position.',
  ];
  for (const t of tiles) {
    const name = tiles.length === 1 ? base : `${base}_${t.col}_${t.row}_${t.layer}`;
    lines.push(`/structure load ${namespace}:${name} ~${t.ox} ~${t.oy} ~${t.oz}`);
  }
  return lines.join('\n') + '\n';
}
