// exporters.js — everything that leaves the browser as a file.

import { zip, uuid4 } from './zip.js';
import { buildStructure, splitVolume, loadCommands, MAX_XZ, MAX_Y } from './mcstructure.js';

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeName(s) {
  return (s || 'imagecraft').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'imagecraft';
}

/**
 * Build a behaviour pack containing one structure per tile.
 * Returns { bytes, tiles, commands, files:[names] }
 */
export function buildMcPack(vox, blocks, opts) {
  const base = safeName(opts.name);
  const ns = safeName(opts.namespace || 'imagecraft');
  const tiles = splitVolume(vox, opts.maxXZ || MAX_XZ, opts.maxY || MAX_Y);
  const files = [];

  for (const t of tiles) {
    const fname = tiles.length === 1 ? base : `${base}_${t.col}_${t.row}_${t.layer}`;
    files.push({
      name: `structures/${ns}/${fname}.mcstructure`,
      data: buildStructure(t.vox, blocks, opts),
    });
  }

  const commands = loadCommands(tiles, ns, base);
  const manifest = {
    format_version: 2,
    header: {
      name: opts.name || 'Imagecraft build',
      description: `${vox.sx}x${vox.sy}x${vox.sz} — ${tiles.length} structure${tiles.length === 1 ? '' : 's'}`,
      uuid: uuid4(),
      version: [1, 0, 0],
      min_engine_version: [1, 21, 0],
    },
    modules: [{ type: 'data', uuid: uuid4(), version: [1, 0, 0] }],
  };

  files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  files.push({ name: 'README.txt', data: readme(commands, ns, base, tiles) });
  return { bytes: zip(files), tiles, commands, files: files.map(f => f.name) };
}

function readme(commands, ns, base, tiles) {
  return [
    'Imagecraft build',
    '================',
    '',
    'Installing (Bedrock):',
    '  1. Open the .mcpack file — Minecraft imports it as a behaviour pack.',
    '  2. In the world settings, turn the pack on under Behaviour Packs.',
    '  3. Enable cheats, join the world, stand where the build should start.',
    '  4. Run the commands below in order.',
    '',
    `Namespace: ${ns}   Base name: ${base}   Structures: ${tiles.length}`,
    '',
    commands,
    'Offsets are relative to you. Face south (positive Z) so a wall build faces you.',
    'If a structure will not load, check the pack is enabled and the id is spelled',
    'exactly as above, including the namespace.',
    '',
  ].join('\n');
}

/** Human-readable shopping list. */
export function blockListText(counts, blocks, title) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const lines = [
    `${title} — materials`,
    `${total.toLocaleString()} blocks, ${rows.length} kinds`,
    '',
    'count    stacks   shulkers  block',
  ];
  for (const [id, n] of rows) {
    const b = byId.get(id);
    const stacks = (n / 64).toFixed(1);
    const shulkers = (n / 1728).toFixed(2);
    lines.push(
      String(n).padStart(8) + '   ' + stacks.padStart(6) + '   ' + shulkers.padStart(8) +
      '  ' + (b ? b.name : id) + `  (${b ? b.bedrock : id})`
    );
  }
  return lines.join('\n') + '\n';
}

export function blockListCsv(counts, blocks) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const out = ['block,id,count,stacks,shulker_boxes'];
  for (const [id, n] of rows) {
    const b = byId.get(id);
    out.push(`"${b ? b.name : id}",${b ? b.bedrock : id},${n},${(n / 64).toFixed(2)},${(n / 1728).toFixed(3)}`);
  }
  return out.join('\n') + '\n';
}

/** Flat PNG of the mapped grid at `scale` pixels per block. */
export function gridToPngBlob(grid, scale, gridLines) {
  const c = document.createElement('canvas');
  c.width = grid.w * scale; c.height = grid.h * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const i = y * grid.w + x;
      if (grid.index[i] < 0) continue;
      ctx.fillStyle = `rgb(${grid.rgb[i * 3]},${grid.rgb[i * 3 + 1]},${grid.rgb[i * 3 + 2]})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  if (gridLines && scale >= 6) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= grid.w; x++) { ctx.beginPath(); ctx.moveTo(x * scale + 0.5, 0); ctx.lineTo(x * scale + 0.5, c.height); ctx.stroke(); }
    for (let y = 0; y <= grid.h; y++) { ctx.beginPath(); ctx.moveTo(0, y * scale + 0.5); ctx.lineTo(c.width, y * scale + 0.5); ctx.stroke(); }
  }
  return new Promise(res => c.toBlob(res, 'image/png'));
}

export function canvasToPngBlob(canvas) {
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
