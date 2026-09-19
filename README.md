# Imagecraft

Turn an image into a Minecraft build. Upload a picture, pixelize it to a block
grid, match every cell to the closest real block, look at it in 3D, then export
a Bedrock `.mcpack` you can load straight into a world.

No dependencies, no build step, WebGL1. Same layout as IFScraft: `index.html`
+ `main.js` + `engine/`.

## Running it

ES modules need a server, so `file://` will not work:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Layout

```
index.html            markup + stylesheet
main.js               state, pipeline scheduling, canvases, UI wiring
engine/
  color.js            sRGB <-> CIELAB, CIE76 / CIEDE2000 / weighted RGB, cached matcher
  palette.js          205 blocks: colours, groups, tags, modern + legacy Bedrock ids
  pixelize.js         adjustments (brightness/contrast/saturation/gamma/hue/posterize/sharpen)
                      and four resampling modes down to the block grid
  mapper.js           image -> palette indices, with eight dithering modes
  mesh.js             voxelising (wall / floor / relief / free plane) + face-culled mesh + OBJ
  renderer.js         WebGL1 orbit viewer
  nbt.js              little-endian NBT reader and writer
  mcstructure.js      .mcstructure assembly, 64³ tiling, /structure load commands
  zip.js              ZIP + CRC32, deflated via CompressionStream (a .mcpack is a renamed zip)
  exporters.js        pack assembly, materials list, PNG, downloads
tools/
  validate.mjs        headless engine checks — node tools/validate.mjs
  smoke.mjs           jsdom boot + interaction test — npm i jsdom && node tools/smoke.mjs
```

The pipeline is staged: `adjust -> grid -> map -> vox -> draw`. A control only
invalidates its own stage and everything downstream, so moving a dither slider
does not re-resample the image.

## Build shapes

- **Wall** — stands up, faces south.
- **Floor** — lies flat, read from above, image top to the north.
- **Relief** — a wall where brightness pushes blocks forward.
- **Plane** — free orientation. Tilt 0 reproduces Wall exactly and tilt 90
  reproduces Floor exactly, block for block; anything between is an angled
  plane, and Turn spins it about the vertical axis. Relief works here too,
  measured along the plane's own normal.

Angled planes are filled by inverse mapping — every voxel in the bounding box is
projected back into plane space — and the slab is widened by half the L1 norm of
its normal, which is the condition for a face-connected rasterised plane. So no
angle leaves pin-holes; `tools/validate.mjs` flood-fills 55 tilt/turn pairs to
prove it. One caveat that is geometry, not a bug: at a turn that is not a right
angle the picture is resampled onto a cubic lattice, so on very small grids a
cell can merge into its neighbour. At build sizes nothing is lost.

## Pack size

A .mcstructure stores one integer per cell of its bounding box, whether or not
there is a block there. A wall is one cell deep and completely full, so its file
is tiny. An angled plane fills maybe 3% of its bounding box and the other 97%
still costs bytes — a 256-wide picture at 45 degrees came to 36 MB uncompressed,
against 0.4 MB for the same picture as a wall, which is well past the point
where the game will quietly decline to import the pack.

Two things keep that in check. Every tile is shrink-wrapped to the blocks it
actually holds, with the offset folded into its `/structure load` line, and
every pack entry is deflated with the platform's own CompressionStream. The same
256-wide plane now packs to 0.09 MB. The export toast reports the finished size,
so an unexpectedly large number is visible before it reaches Minecraft.

## Getting a build into Bedrock

1. **Export .mcpack**. Oversized builds are cut into tiles automatically — a
   structure block cannot load more than 64 × 384 × 64.
2. Open the file. Minecraft imports it as a behaviour pack.
3. Turn the pack on in the world's settings and enable cheats.
4. Stand at the bottom-north-west corner of where the build should go, facing
   south, and run the commands from `README.txt` inside the pack:
   `/structure load imagecraft:yourname ~ ~ ~`

`.mcstructure` on its own is there for structure-block workflows and for other
editors. Old worlds that predate the 1.21.40 block flattening need the
**Old block ids** toggle.

## Block colours

Palette colours are hand-calibrated averages of the vanilla textures — close,
but not exact. **Use my textures** in the palette panel re-averages every entry
whose filename matches a block id (`white_concrete.png`, `oak_planks.png`), so
pointing it at a resource pack makes the matching exact for the pack you
actually play with.

## Notes on the matching

`Lab (CIEDE2000)` is the most faithful metric but roughly thirty times the cost
of CIE76. For palettes over 64 blocks it shortlists the 32 nearest by CIE76 and
re-ranks only those; measured against an exhaustive scan over 4000 random
colours that disagrees 13 times, worst case 3.3 ΔE2000. Palettes of 64 blocks
or fewer are always scanned exhaustively. `Lab (CIE76)` is the sensible default.

Dithering deliberately raises per-pixel error to lower local error — that is the
trade, and `tools/validate.mjs` asserts both halves of it.
