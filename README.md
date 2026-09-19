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
  mesh.js             voxelising (wall / floor / relief) + face-culled mesh + OBJ
  renderer.js         WebGL1 orbit viewer
  nbt.js              little-endian NBT reader and writer
  mcstructure.js      .mcstructure assembly, 64³ tiling, /structure load commands
  zip.js              store-only ZIP + CRC32 (a .mcpack is a renamed zip)
  exporters.js        pack assembly, materials list, PNG, downloads
tools/
  validate.mjs        headless engine checks — node tools/validate.mjs
  smoke.mjs           jsdom boot + interaction test — npm i jsdom && node tools/smoke.mjs
```

The pipeline is staged: `adjust -> grid -> map -> vox -> draw`. A control only
invalidates its own stage and everything downstream, so moving a dither slider
does not re-resample the image.

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
