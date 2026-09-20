# Imagecraft 1.5.0

Turn an image into a Minecraft build. Upload a picture, pixelize it to a block
grid, match every cell to the closest real block, look at it in 3D, then export
a Bedrock `.mcpack` you can load straight into a world.

No dependencies, no build step, WebGL1. Same layout as IFScraft: `index.html`
+ `main.js` + `engine/`.

## Versions

- **1.5.0** — OBJ export rewritten as OBJ + MTL + palette image in a zip.
- **1.4.0** — Smooth, a block-unit Gaussian applied to the grid before matching.
- **1.3.0** — Tiles .zip export, fit reporting, Fit to one structure.
- **1.2.0** — Even tiling under 48 across, per-tile shrink-wrap, deflated packs.
- **1.1.0** — Plane build shape with free tilt and turn.
- **1.0.0** — First build.

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

## Tile size

A structure block tops out at 64 x 384 x 64, but a tile that is the full 64
across in *both* horizontal directions is the shape the game turns down in
practice. Height is not the problem — a 96-tall wall loads fine.

That is why tiles default to 48 across rather than 64, and why the splitter
divides evenly: a 128-wide build becomes three 43/43/42 tiles instead of
64/64. Nothing it emits sits on the limit. The control goes up to 64 if you
want to try a wider tile, and the stats line warns above 56.

Shapes whose bounding box is deep as well as wide — Floor, and Plane past about
40 degrees — are the ones that used to hit this; a Wall is one block deep, so it
never did.

## Smoothing

**Smooth** in the Grid panel is a Gaussian blur applied after the picture is
resampled to the block grid and before the blocks are chosen, with its radius
measured in blocks rather than source pixels — 0.8 means eight tenths of a
block whatever the original resolution. That is what takes the speckle out of a
grainy photograph: on a noisy test scene it cut isolated single blocks by more
than half. Colour is weighted by alpha, so a cut-out edge does not pull
transparent black into the blocks beside it. Around 0.4 to 0.8 tidies a photo
without softening edges; past about 1.5 it starts flattening detail. The
Photograph preset sets 0.4.

Sharpen, up in Adjust, works on the full-resolution image before resampling, so
the two are complementary rather than opposed: sharpen the picture, smooth the
blocks.

## Why a tilt can outgrow a structure block

Tilting rotates image height into depth. A 64-wide, 64-tall picture standing up
occupies 64 x 64 x 1 — one block deep. Lay it flat and the same picture occupies
64 x 1 x 64, and that full-64 horizontal footprint is the shape a structure
block turns down. In between:

    tilt      0     30     45     60     90
    depth     1     33     46     56     64

So the same build can load as one file at 30 degrees and need splitting at 90 —
nothing about the export changed, the picture simply got deeper.

**Fit to one structure** in the Grid panel sets the grid to the largest width
that still loads as a single file at the current angle, and says when that size
is sitting on the 64 limit rather than clear of it. Press it again after
changing the tilt, since the answer moves with the tilt. At 48 across, every
angle fits with room to spare.

## Which export to use

- **.mcstructure** — one file, for builds that fit a structure block on their
  own (up to 48 across, 384 tall) and for other editors. The Build panel says
  up front whether the current build fits; the export says so again.
- **Tiles .zip** — the same build cut into loadable pieces as plain
  .mcstructure files, for the structure block's Import button. `placement.txt`
  inside lists the offset, size and block count for every piece.
- **.mcpack** — the same pieces as a behaviour pack, loaded with
  `/structure load`. Least clicking for a big build.
- **OBJ .zip** — the mesh for a 3D program: `.obj`, `.mtl` and a palette PNG.
  Keep the three together; the .obj names the .mtl and the .mtl names the PNG,
  so a lone .obj opens untextured grey. Colour is written twice over — a Kd per
  material and a one-texel-per-block image through map_Kd — because some
  viewers shade only what is textured and others read only Kd. Y is up, one
  unit is one block.

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
