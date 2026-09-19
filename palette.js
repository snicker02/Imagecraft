// palette.js — the block palette.
//
// Colours are hand-calibrated averages of the vanilla textures. They are close
// enough to match well, but if you want them exact, drop your resource pack's
// block textures onto the palette panel and Imagecraft re-averages every entry
// whose id matches a filename (calibrate() below).
//
// `bedrock` is the modern flattened id (1.21.40+ naming). `legacy` is the old
// id + block state for worlds on older versions; the exporter picks one.
// tags: gravity (falls), flammable, transparent (lets light through / not full
// opaque), glow (emits light), rare (expensive or hard to farm).

const DYES = [
  ['white', 'White'], ['light_gray', 'Light Gray'], ['gray', 'Gray'], ['black', 'Black'],
  ['brown', 'Brown'], ['red', 'Red'], ['orange', 'Orange'], ['yellow', 'Yellow'],
  ['lime', 'Lime'], ['green', 'Green'], ['cyan', 'Cyan'], ['light_blue', 'Light Blue'],
  ['blue', 'Blue'], ['purple', 'Purple'], ['magenta', 'Magenta'], ['pink', 'Pink'],
];

const WOOL = {
  white: [233, 236, 236], light_gray: [142, 142, 134], gray: [62, 68, 71], black: [20, 21, 25],
  brown: [114, 71, 40], red: [160, 39, 34], orange: [240, 118, 19], yellow: [248, 197, 39],
  lime: [112, 185, 25], green: [84, 109, 27], cyan: [21, 137, 145], light_blue: [58, 175, 217],
  blue: [53, 57, 157], purple: [121, 42, 172], magenta: [189, 68, 179], pink: [237, 141, 172],
};

const CONCRETE = {
  white: [207, 213, 214], light_gray: [125, 125, 115], gray: [54, 57, 61], black: [8, 10, 15],
  brown: [96, 59, 31], red: [142, 32, 32], orange: [224, 97, 0], yellow: [240, 175, 21],
  lime: [94, 168, 24], green: [73, 91, 36], cyan: [21, 119, 136], light_blue: [35, 137, 198],
  blue: [44, 46, 143], purple: [100, 31, 156], magenta: [169, 48, 159], pink: [213, 101, 142],
};

const TERRACOTTA = {
  white: [209, 178, 161], light_gray: [135, 107, 98], gray: [58, 42, 36], black: [37, 23, 16],
  brown: [77, 51, 36], red: [143, 61, 47], orange: [162, 84, 38], yellow: [186, 133, 35],
  lime: [104, 118, 53], green: [76, 83, 42], cyan: [87, 91, 91], light_blue: [113, 109, 138],
  blue: [74, 60, 91], purple: [118, 70, 86], magenta: [149, 88, 108], pink: [161, 78, 78],
};

const GLASS = {
  white: [255, 255, 255], light_gray: [153, 153, 153], gray: [76, 76, 76], black: [25, 25, 25],
  brown: [102, 76, 51], red: [153, 51, 51], orange: [216, 127, 51], yellow: [229, 229, 51],
  lime: [127, 204, 25], green: [102, 127, 51], cyan: [76, 127, 153], light_blue: [102, 153, 216],
  blue: [51, 76, 178], purple: [127, 63, 178], magenta: [178, 76, 216], pink: [242, 127, 165],
};

export const GROUPS = [
  { id: 'wool', name: 'Wool' },
  { id: 'concrete', name: 'Concrete' },
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'glass', name: 'Stained glass' },
  { id: 'stone', name: 'Stone & brick' },
  { id: 'nether', name: 'Nether & end' },
  { id: 'wood', name: 'Wood' },
  { id: 'leaves', name: 'Leaves' },
  { id: 'nature', name: 'Terrain & nature' },
  { id: 'mineral', name: 'Mineral & metal' },
  { id: 'misc', name: 'Odds & ends' },
];

const list = [];

function B(id, name, rgb, group, extra = {}) {
  list.push({
    id, name, rgb, group,
    bedrock: extra.bedrock || 'minecraft:' + id,
    states: extra.states || {},
    legacy: extra.legacy || null,
    tags: extra.tags || [],
  });
}

for (const [k, label] of DYES) {
  B(`${k}_wool`, `${label} Wool`, WOOL[k], 'wool',
    { legacy: ['minecraft:wool', { color: k === 'light_gray' ? 'silver' : k }], tags: ['flammable'] });
  B(`${k}_concrete`, `${label} Concrete`, CONCRETE[k], 'concrete',
    { legacy: ['minecraft:concrete', { color: k === 'light_gray' ? 'silver' : k }] });
  B(`${k}_terracotta`, `${label} Terracotta`, TERRACOTTA[k], 'terracotta',
    { legacy: ['minecraft:stained_hardened_clay', { color: k === 'light_gray' ? 'silver' : k }] });
  B(`${k}_stained_glass`, `${label} Stained Glass`, GLASS[k], 'glass',
    { legacy: ['minecraft:stained_glass', { color: k === 'light_gray' ? 'silver' : k }], tags: ['transparent'] });
}

B('glass', 'Glass', [175, 213, 219], 'glass', { tags: ['transparent'] });
B('tinted_glass', 'Tinted Glass', [44, 39, 44], 'glass', { tags: ['transparent'] });
B('terracotta', 'Terracotta (plain)', [152, 94, 67], 'terracotta', { legacy: ['minecraft:hardened_clay', {}] });

// --- stone & brick ----------------------------------------------------------
B('stone', 'Stone', [125, 125, 125], 'stone', { legacy: ['minecraft:stone', { stone_type: 'stone' }] });
B('cobblestone', 'Cobblestone', [127, 127, 127], 'stone');
B('mossy_cobblestone', 'Mossy Cobblestone', [110, 118, 100], 'stone');
B('smooth_stone', 'Smooth Stone', [158, 158, 158], 'stone');
B('stone_bricks', 'Stone Bricks', [122, 122, 122], 'stone', { legacy: ['minecraft:stonebrick', { stone_brick_type: 'default' }] });
B('mossy_stone_bricks', 'Mossy Stone Bricks', [113, 119, 105], 'stone', { legacy: ['minecraft:stonebrick', { stone_brick_type: 'mossy' }] });
B('andesite', 'Andesite', [136, 136, 138], 'stone', { legacy: ['minecraft:stone', { stone_type: 'andesite' }] });
B('polished_andesite', 'Polished Andesite', [132, 135, 134], 'stone', { legacy: ['minecraft:stone', { stone_type: 'andesite_smooth' }] });
B('diorite', 'Diorite', [188, 188, 189], 'stone', { legacy: ['minecraft:stone', { stone_type: 'diorite' }] });
B('polished_diorite', 'Polished Diorite', [192, 193, 195], 'stone', { legacy: ['minecraft:stone', { stone_type: 'diorite_smooth' }] });
B('granite', 'Granite', [149, 103, 85], 'stone', { legacy: ['minecraft:stone', { stone_type: 'granite' }] });
B('polished_granite', 'Polished Granite', [154, 107, 89], 'stone', { legacy: ['minecraft:stone', { stone_type: 'granite_smooth' }] });
B('deepslate', 'Deepslate', [77, 77, 80], 'stone', { states: { pillar_axis: 'y' } });
B('cobbled_deepslate', 'Cobbled Deepslate', [83, 83, 86], 'stone');
B('polished_deepslate', 'Polished Deepslate', [72, 72, 76], 'stone');
B('deepslate_bricks', 'Deepslate Bricks', [71, 71, 74], 'stone');
B('deepslate_tiles', 'Deepslate Tiles', [54, 54, 57], 'stone');
B('tuff', 'Tuff', [108, 109, 102], 'stone');
B('calcite', 'Calcite', [223, 223, 218], 'stone');
B('dripstone_block', 'Dripstone Block', [134, 107, 92], 'stone');
B('bricks', 'Bricks', [150, 97, 83], 'stone', { legacy: ['minecraft:brick_block', {}] });
B('mud_bricks', 'Mud Bricks', [137, 105, 78], 'stone');
B('sandstone', 'Sandstone', [219, 207, 163], 'stone', { legacy: ['minecraft:sandstone', { sand_stone_type: 'default' }] });
B('smooth_sandstone', 'Smooth Sandstone', [224, 214, 173], 'stone', { legacy: ['minecraft:sandstone', { sand_stone_type: 'smooth' }] });
B('cut_sandstone', 'Cut Sandstone', [216, 206, 160], 'stone', { legacy: ['minecraft:sandstone', { sand_stone_type: 'cut' }] });
B('red_sandstone', 'Red Sandstone', [186, 99, 29], 'stone', { legacy: ['minecraft:red_sandstone', { sand_stone_type: 'default' }] });
B('smooth_red_sandstone', 'Smooth Red Sandstone', [190, 102, 33], 'stone', { legacy: ['minecraft:red_sandstone', { sand_stone_type: 'smooth' }] });
B('prismarine', 'Prismarine', [99, 156, 151], 'stone', { legacy: ['minecraft:prismarine', { prismarine_block_type: 'default' }] });
B('prismarine_bricks', 'Prismarine Bricks', [99, 171, 158], 'stone', { legacy: ['minecraft:prismarine', { prismarine_block_type: 'bricks' }] });
B('dark_prismarine', 'Dark Prismarine', [51, 91, 75], 'stone', { legacy: ['minecraft:prismarine', { prismarine_block_type: 'dark' }] });
B('quartz_block', 'Quartz Block', [236, 233, 226], 'stone', { legacy: ['minecraft:quartz_block', { chisel_type: 'default', pillar_axis: 'y' }] });
B('smooth_quartz', 'Smooth Quartz', [236, 232, 224], 'stone', { legacy: ['minecraft:quartz_block', { chisel_type: 'smooth', pillar_axis: 'y' }] });
B('chiseled_quartz_block', 'Chiseled Quartz', [231, 226, 216], 'stone', { legacy: ['minecraft:quartz_block', { chisel_type: 'chiseled', pillar_axis: 'y' }] });
B('obsidian', 'Obsidian', [21, 18, 30], 'stone');
B('crying_obsidian', 'Crying Obsidian', [32, 10, 60], 'stone', { tags: ['glow'] });
B('blackstone', 'Blackstone', [42, 36, 42], 'stone');
B('polished_blackstone', 'Polished Blackstone', [53, 49, 58], 'stone');
B('polished_blackstone_bricks', 'Polished Blackstone Bricks', [48, 43, 51], 'stone');
B('basalt', 'Basalt', [80, 79, 85], 'stone', { states: { pillar_axis: 'y' } });
B('smooth_basalt', 'Smooth Basalt', [72, 72, 78], 'stone');

// --- nether & end -----------------------------------------------------------
B('netherrack', 'Netherrack', [97, 38, 38], 'nether');
B('nether_bricks', 'Nether Bricks', [44, 22, 26], 'nether', { bedrock: 'minecraft:nether_brick' });
B('red_nether_bricks', 'Red Nether Bricks', [69, 7, 9], 'nether', { bedrock: 'minecraft:red_nether_brick' });
B('warped_nylium', 'Warped Nylium', [43, 114, 101], 'nether');
B('crimson_nylium', 'Crimson Nylium', [130, 31, 31], 'nether');
B('nether_wart_block', 'Nether Wart Block', [114, 1, 1], 'nether');
B('warped_wart_block', 'Warped Wart Block', [20, 110, 105], 'nether');
B('soul_sand', 'Soul Sand', [81, 62, 50], 'nether');
B('soul_soil', 'Soul Soil', [75, 57, 46], 'nether');
B('magma', 'Magma Block', [141, 71, 30], 'nether', { tags: ['glow'] });
B('glowstone', 'Glowstone', [171, 131, 84], 'nether', { tags: ['glow'] });
B('shroomlight', 'Shroomlight', [240, 146, 70], 'nether', { tags: ['glow'] });
B('end_stone', 'End Stone', [221, 223, 165], 'nether');
B('end_bricks', 'End Stone Bricks', [218, 224, 162], 'nether');
B('purpur_block', 'Purpur Block', [169, 125, 169], 'nether', { legacy: ['minecraft:purpur_block', { chisel_type: 'default', pillar_axis: 'y' }] });

// --- wood -------------------------------------------------------------------
const PLANKS = [
  ['oak', 'Oak', [162, 130, 78]], ['spruce', 'Spruce', [114, 84, 48]], ['birch', 'Birch', [192, 175, 121]],
  ['jungle', 'Jungle', [160, 115, 80]], ['acacia', 'Acacia', [168, 90, 50]], ['dark_oak', 'Dark Oak', [66, 43, 20]],
];
for (const [k, label, rgb] of PLANKS) {
  B(`${k}_planks`, `${label} Planks`, rgb, 'wood',
    { legacy: ['minecraft:planks', { wood_type: k }], tags: ['flammable'] });
}
B('mangrove_planks', 'Mangrove Planks', [117, 54, 48], 'wood', { tags: ['flammable'] });
B('cherry_planks', 'Cherry Planks', [226, 179, 170], 'wood', { tags: ['flammable'] });
B('bamboo_planks', 'Bamboo Planks', [193, 157, 72], 'wood', { tags: ['flammable'] });
B('crimson_planks', 'Crimson Planks', [101, 48, 70], 'wood');
B('warped_planks', 'Warped Planks', [43, 104, 99], 'wood');
B('oak_log', 'Oak Log', [109, 85, 50], 'wood', { states: { pillar_axis: 'y' }, legacy: ['minecraft:log', { old_log_type: 'oak', pillar_axis: 'y' }], tags: ['flammable'] });
B('spruce_log', 'Spruce Log', [58, 38, 20], 'wood', { states: { pillar_axis: 'y' }, legacy: ['minecraft:log', { old_log_type: 'spruce', pillar_axis: 'y' }], tags: ['flammable'] });
B('birch_log', 'Birch Log', [216, 215, 210], 'wood', { states: { pillar_axis: 'y' }, legacy: ['minecraft:log', { old_log_type: 'birch', pillar_axis: 'y' }], tags: ['flammable'] });
B('dark_oak_log', 'Dark Oak Log', [60, 46, 26], 'wood', { states: { pillar_axis: 'y' }, legacy: ['minecraft:log2', { new_log_type: 'dark_oak', pillar_axis: 'y' }], tags: ['flammable'] });
B('stripped_oak_log', 'Stripped Oak Log', [177, 143, 86], 'wood', { states: { pillar_axis: 'y' }, tags: ['flammable'] });
B('stripped_spruce_log', 'Stripped Spruce Log', [116, 90, 55], 'wood', { states: { pillar_axis: 'y' }, tags: ['flammable'] });
B('stripped_birch_log', 'Stripped Birch Log', [196, 173, 124], 'wood', { states: { pillar_axis: 'y' }, tags: ['flammable'] });
B('stripped_acacia_log', 'Stripped Acacia Log', [182, 98, 60], 'wood', { states: { pillar_axis: 'y' }, tags: ['flammable'] });
B('stripped_dark_oak_log', 'Stripped Dark Oak Log', [96, 73, 44], 'wood', { states: { pillar_axis: 'y' }, tags: ['flammable'] });
B('stripped_crimson_stem', 'Stripped Crimson Stem', [137, 66, 80], 'wood', { states: { pillar_axis: 'y' } });
B('stripped_warped_stem', 'Stripped Warped Stem', [56, 140, 140], 'wood', { states: { pillar_axis: 'y' } });
B('bookshelf', 'Bookshelf', [110, 86, 53], 'wood', { tags: ['flammable'] });

// --- leaves (all transparent, all flammable except nether/azalea) -----------
B('oak_leaves', 'Oak Leaves', [60, 110, 45], 'leaves', { legacy: ['minecraft:leaves', { old_leaf_type: 'oak', persistent_bit: true, update_bit: false }], tags: ['transparent', 'flammable'] });
B('spruce_leaves', 'Spruce Leaves', [46, 74, 46], 'leaves', { legacy: ['minecraft:leaves', { old_leaf_type: 'spruce', persistent_bit: true, update_bit: false }], tags: ['transparent', 'flammable'] });
B('birch_leaves', 'Birch Leaves', [128, 167, 85], 'leaves', { legacy: ['minecraft:leaves', { old_leaf_type: 'birch', persistent_bit: true, update_bit: false }], tags: ['transparent', 'flammable'] });
B('jungle_leaves', 'Jungle Leaves', [48, 116, 26], 'leaves', { legacy: ['minecraft:leaves', { old_leaf_type: 'jungle', persistent_bit: true, update_bit: false }], tags: ['transparent', 'flammable'] });
B('acacia_leaves', 'Acacia Leaves', [86, 133, 31], 'leaves', { legacy: ['minecraft:leaves2', { new_leaf_type: 'acacia', persistent_bit: true, update_bit: false }], tags: ['transparent', 'flammable'] });
B('cherry_leaves', 'Cherry Leaves', [236, 177, 203], 'leaves', { tags: ['transparent', 'flammable'] });
B('azalea_leaves', 'Azalea Leaves', [93, 121, 60], 'leaves', { tags: ['transparent', 'flammable'] });
B('flowering_azalea_leaves', 'Flowering Azalea Leaves', [110, 124, 72], 'leaves', { tags: ['transparent', 'flammable'] });
B('mangrove_leaves', 'Mangrove Leaves', [58, 140, 50], 'leaves', { tags: ['transparent', 'flammable'] });

// --- terrain & nature -------------------------------------------------------
B('grass_block', 'Grass Block', [127, 175, 79], 'nature', { legacy: ['minecraft:grass', {}] });
B('dirt', 'Dirt', [134, 96, 67], 'nature', { legacy: ['minecraft:dirt', { dirt_type: 'normal' }] });
B('coarse_dirt', 'Coarse Dirt', [119, 85, 59], 'nature', { legacy: ['minecraft:dirt', { dirt_type: 'coarse' }] });
B('rooted_dirt', 'Rooted Dirt', [144, 103, 76], 'nature');
B('podzol', 'Podzol', [91, 60, 22], 'nature', { legacy: ['minecraft:dirt', { dirt_type: 'podzol' }] });
B('mycelium', 'Mycelium', [111, 98, 101], 'nature');
B('moss_block', 'Moss Block', [89, 109, 45], 'nature');
B('sand', 'Sand', [220, 212, 163], 'nature', { legacy: ['minecraft:sand', { sand_type: 'normal' }], tags: ['gravity'] });
B('red_sand', 'Red Sand', [190, 102, 33], 'nature', { legacy: ['minecraft:sand', { sand_type: 'red' }], tags: ['gravity'] });
B('gravel', 'Gravel', [131, 127, 126], 'nature', { tags: ['gravity'] });
B('clay', 'Clay', [160, 166, 179], 'nature');
B('mud', 'Mud', [60, 52, 54], 'nature');
B('muddy_mangrove_roots', 'Muddy Mangrove Roots', [67, 54, 42], 'nature', { states: { pillar_axis: 'y' } });
B('snow', 'Snow Block', [249, 254, 254], 'nature', { bedrock: 'minecraft:snow' });
B('ice', 'Ice', [145, 183, 253], 'nature', { tags: ['transparent'] });
B('packed_ice', 'Packed Ice', [141, 180, 250], 'nature');
B('blue_ice', 'Blue Ice', [116, 167, 253], 'nature');
B('sculk', 'Sculk', [12, 24, 32], 'nature');
B('pumpkin', 'Pumpkin', [198, 118, 24], 'nature', { states: { 'minecraft:cardinal_direction': 'south' } });
B('melon_block', 'Melon', [111, 144, 30], 'nature', { bedrock: 'minecraft:melon_block' });
B('hay_block', 'Hay Bale', [166, 138, 20], 'nature', { states: { deprecated: 0, pillar_axis: 'y' }, tags: ['flammable'] });
B('dried_kelp_block', 'Dried Kelp Block', [48, 54, 38], 'nature');
B('sponge', 'Sponge', [195, 192, 74], 'nature', { legacy: ['minecraft:sponge', { sponge_type: 'dry' }] });

// --- mineral & metal --------------------------------------------------------
B('iron_block', 'Block of Iron', [220, 220, 220], 'mineral');
B('gold_block', 'Block of Gold', [249, 224, 84], 'mineral', { tags: ['rare'] });
B('diamond_block', 'Block of Diamond', [98, 237, 228], 'mineral', { tags: ['rare'] });
B('emerald_block', 'Block of Emerald', [42, 217, 104], 'mineral', { tags: ['rare'] });
B('lapis_block', 'Block of Lapis', [30, 67, 140], 'mineral');
B('redstone_block', 'Block of Redstone', [175, 24, 5], 'mineral');
B('coal_block', 'Block of Coal', [16, 16, 16], 'mineral');
B('netherite_block', 'Block of Netherite', [66, 61, 63], 'mineral', { tags: ['rare'] });
B('ancient_debris', 'Ancient Debris', [94, 66, 60], 'mineral', { tags: ['rare'] });
B('amethyst_block', 'Block of Amethyst', [134, 97, 189], 'mineral');
B('copper_block', 'Block of Copper', [192, 107, 79], 'mineral');
B('exposed_copper', 'Exposed Copper', [161, 125, 103], 'mineral');
B('weathered_copper', 'Weathered Copper', [108, 153, 121], 'mineral');
B('oxidized_copper', 'Oxidized Copper', [82, 162, 132], 'mineral');
B('bone_block', 'Bone Block', [229, 225, 203], 'mineral', { states: { pillar_axis: 'y' } });
B('sea_lantern', 'Sea Lantern', [172, 199, 190], 'mineral', { tags: ['glow'] });

// --- odds & ends ------------------------------------------------------------
B('honeycomb_block', 'Honeycomb Block', [229, 148, 29], 'misc');
B('honey_block', 'Honey Block', [251, 179, 44], 'misc', { tags: ['transparent'] });
B('slime', 'Slime Block', [111, 192, 91], 'misc', { bedrock: 'minecraft:slime', tags: ['transparent'] });
B('target', 'Target', [190, 153, 133], 'misc');
B('ochre_froglight', 'Ochre Froglight', [250, 244, 203], 'misc', { states: { pillar_axis: 'y' }, tags: ['glow'] });
B('verdant_froglight', 'Verdant Froglight', [217, 241, 199], 'misc', { states: { pillar_axis: 'y' }, tags: ['glow'] });
B('pearlescent_froglight', 'Pearlescent Froglight', [245, 222, 239], 'misc', { states: { pillar_axis: 'y' }, tags: ['glow'] });
B('note_block', 'Note Block', [92, 62, 42], 'misc', { tags: ['flammable'] });
B('white_glazed_terracotta', 'White Glazed Terracotta', [225, 227, 220], 'misc');
B('light_blue_glazed_terracotta', 'Light Blue Glazed Terracotta', [95, 164, 205], 'misc');
B('cyan_glazed_terracotta', 'Cyan Glazed Terracotta', [52, 118, 125], 'misc');
B('black_glazed_terracotta', 'Black Glazed Terracotta', [43, 29, 26], 'misc');

export const BLOCKS = list;
export const BY_ID = new Map(list.map(b => [b.id, b]));

/** Default enabled groups — the classic map-art set. */
export const DEFAULT_GROUPS = ['wool', 'concrete', 'terracotta', 'stone', 'wood', 'nature'];

/**
 * Filter the palette down to what the user allows.
 * opts: { groups:Set<string>, disabled:Set<string>, excludeTags:Set<string> }
 */
export function selectBlocks(opts) {
  const { groups, disabled, excludeTags } = opts;
  return BLOCKS.filter(b => {
    if (groups && !groups.has(b.group)) return false;
    if (disabled && disabled.has(b.id)) return false;
    if (excludeTags) for (const t of b.tags) if (excludeTags.has(t)) return false;
    return true;
  });
}

/** Resolve a block to the id + states actually written into a structure. */
export function resolveBlock(b, legacy) {
  if (legacy && b.legacy) return { name: b.legacy[0], states: b.legacy[1] || {} };
  return { name: b.bedrock, states: b.states || {} };
}

/**
 * Re-average palette colours from real texture images.
 * files: [{name:'white_concrete.png', imageData:ImageData}]
 * Returns the number of blocks updated. Ignores fully transparent pixels.
 */
export function calibrate(files) {
  let n = 0;
  for (const f of files) {
    const id = f.name.replace(/\.[^.]+$/, '').replace(/^minecraft[_:]/, '');
    const block = BY_ID.get(id);
    if (!block) continue;
    const d = f.imageData.data;
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      if (a < 0.5) continue;
      r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; w += a;
    }
    if (w === 0) continue;
    block.rgb = [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
    block.lab = null;
    n++;
  }
  return n;
}
