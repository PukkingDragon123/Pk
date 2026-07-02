// ── data.js ── all static game data: types, species, moves, passives, items ──
const DATA = (() => {

  // ── Type chart (attacker → defender → multiplier, 1 if absent) ──
  const TYPES = {
    normal:   { name: 'Normal',   color: '#a8a090', icon: '⚪' },
    fire:     { name: 'Fire',     color: '#f05030', icon: '🔥' },
    water:    { name: 'Water',    color: '#3899f8', icon: '💧' },
    grass:    { name: 'Grass',    color: '#68c840', icon: '🌿' },
    electric: { name: 'Electric', color: '#f0c020', icon: '⚡' },
    ice:      { name: 'Ice',      color: '#58c8e0', icon: '❄️' },
    fighting: { name: 'Fighting', color: '#b05038', icon: '🥊' },
    poison:   { name: 'Poison',   color: '#a860c8', icon: '☠️' },
    ground:   { name: 'Ground',   color: '#d8b860', icon: '⛰️' },
    flying:   { name: 'Flying',   color: '#98a8f0', icon: '🪽' },
    psychic:  { name: 'Psychic',  color: '#f860a8', icon: '🌀' },
    bug:      { name: 'Bug',      color: '#a8b820', icon: '🐛' },
    rock:     { name: 'Rock',     color: '#b8a058', icon: '🪨' },
    ghost:    { name: 'Ghost',    color: '#7060b8', icon: '👻' },
    dragon:   { name: 'Dragon',   color: '#7848f8', icon: '🐉' },
  };

  const CHART = {
    normal:   { rock: .5, ghost: 0 },
    fire:     { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5 },
    water:    { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
    grass:    { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5 },
    electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
    ice:      { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2 },
    fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0 },
    poison:   { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5 },
    ground:   { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2 },
    flying:   { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5 },
    psychic:  { fighting: 2, poison: 2, psychic: .5 },
    bug:      { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5 },
    rock:     { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2 },
    ghost:    { normal: 0, psychic: 2, ghost: 2 },
    dragon:   { dragon: 2 },
  };
  const typeMult = (att, def) => (CHART[att] && CHART[att][def] !== undefined) ? CHART[att][def] : 1;

  // ── Passive abilities (implemented in battle.js / shop.js) ──
  const PASSIVES = {
    pinch:        { name: 'Pinch Power',  desc: 'Deals +50% damage while below half HP.' },
    sturdy:       { name: 'Sturdy',       desc: 'The first lethal hit each battle leaves it at 1 HP.' },
    static:       { name: 'Static',       desc: 'When struck, 30% chance to paralyze the attacker.' },
    spore:        { name: 'Effect Spore', desc: 'When struck, 30% chance to poison the attacker.' },
    levitate:     { name: 'Levitate',     desc: 'Immune to Ground-type damage.' },
    speedster:    { name: 'Speedster',    desc: 'Strikes first in an exchange — a kill prevents the counter-hit.' },
    pickup:       { name: 'Pickup',       desc: 'Scrounges +2 extra berries after each battle won.' },
    guts:         { name: 'Guts',         desc: '+2 attack while burned, poisoned or paralyzed.' },
    thickFat:     { name: 'Thick Fat',    desc: 'Takes 2 less damage from Fire and Ice attacks.' },
    thickSkin:    { name: 'Thick Skin',   desc: 'Takes 1 less damage from every hit (min 1).' },
    regen:        { name: 'Regenerator',  desc: 'Recovers 1 HP at the end of every exchange.' },
    immuneStatus: { name: 'Shield Dust',  desc: 'Cannot be burned, poisoned or paralyzed.' },
    immuneFire:   { name: 'Flash Fire',   desc: 'Immune to Fire-type damage.' },
    immuneWater:  { name: 'Water Absorb', desc: 'Immune to Water-type damage.' },
    immuneElectric:{ name: 'Lightning Rod', desc: 'Immune to Electric-type damage.' },
    dodge20:      { name: 'Sand Veil',    desc: '20% chance to dodge any strike.' },
    blink:        { name: 'Blink',        desc: 'Dodges the first strike aimed at it each battle.' },
    moxie:        { name: 'Moxie',        desc: 'Gains +1 attack whenever any enemy faints.' },
    intimidate:   { name: 'Intimidate',   desc: 'At battle start, the enemy front unit loses 1 attack.' },
    vengeful:     { name: 'Vengeful',     desc: 'Gains +2 attack whenever an ally faints.' },
    multiscale:   { name: 'Multiscale',   desc: 'Takes half damage while at full HP.' },
    technician:   { name: 'Technician',   desc: 'All damage it deals is increased by 1.' },
    scrappy:      { name: 'Scrappy',      desc: 'Its attacks ignore type immunities.' },
    noFlinch:     { name: 'Inner Focus',  desc: 'Cannot flinch.' },
    noDebuff:     { name: 'Hyper Cutter', desc: 'Its attack cannot be lowered.' },
    pressure:     { name: 'Pressure',     desc: 'All hits against it deal 2 less damage (min 1).' },
  };

  // Move triggers: start | attack | hurt | faint | turnEnd
  // Move keys are implemented in battle.js. Params may be [lv1,lv2,lv3] arrays.
  // Species: line(id, tier, type, stages[[name,emoji,atk,hp]...], move, passiveKey, opts)
  const LINES = [];
  function line(id, tier, type, stages, move, passive, opts) {
    LINES.push(Object.assign({ id, tier, type, stages, move, passive }, opts || {}));
  }

  // ── Tier 1 ──
  line('caterpie', 1, 'bug',
    [['Caterpie', '🐛', 1, 3], ['Metapod', '🫛', 2, 6], ['Butterfree', '🦋', 4, 7]],
    { name: 'String Shot', trigger: 'start', key: 'debuffAtk', amt: [1, 2, 3], desc: 'Battle start: the enemy front unit loses {amt} attack.' },
    'immuneStatus');
  line('pidgey', 1, 'flying',
    [['Pidgey', '🐦', 2, 2], ['Pidgeotto', '🕊️', 4, 4], ['Pidgeot', '🦅', 6, 7]],
    { name: 'Gust', trigger: 'attack', key: 'splash', dmg: [1, 2, 4], desc: 'On attack: also hits the unit behind the target for {dmg}.' },
    'thickSkin');
  line('rattata', 1, 'normal',
    [['Rattata', '🐀', 2, 2], ['Raticate', '🦫', 5, 4]],
    { name: 'Hyper Fang', trigger: 'attack', key: 'crit', chance: [.25, .35, .5], mult: 2, desc: '{chance}% chance to land a critical hit for double damage.' },
    'pickup');
  line('magikarp', 1, 'water',
    [['Magikarp', '🐟', 1, 3], ['Gyarados', '🦈', 9, 8]],
    { name: 'Flail', trigger: 'hurt', key: 'flail', amt: [1, 1, 2], desc: 'When struck: gains +{amt} attack. It dreams of the sea…' },
    'moxie');
  line('zubat', 1, 'poison',
    [['Zubat', '🦇', 2, 2], ['Golbat', '🦇', 4, 4], ['Crobat', '🧛', 7, 6]],
    { name: 'Leech Life', trigger: 'attack', key: 'lifesteal', pct: [.34, .5, .75], desc: 'On attack: heals for {pct}% of the damage dealt.' },
    'noFlinch');
  line('sandshrew', 1, 'ground',
    [['Sandshrew', '🦔', 2, 3], ['Sandslash', '🦡', 5, 6]],
    { name: 'Rollout', trigger: 'turnEnd', key: 'ramp', atk: [1, 1, 2], hp: 0, desc: 'End of each exchange: gains +{atk} attack as it rolls faster.' },
    'dodge20');
  line('vulpix', 1, 'fire',
    [['Vulpix', '🦊', 2, 3], ['Ninetales', '🦊✨', 6, 6]],
    { name: 'Will-O-Wisp', trigger: 'start', key: 'burnFront', chance: [.7, .85, 1], desc: 'Battle start: {chance}% chance to burn the enemy front unit.' },
    'immuneFire');
  line('oddish', 1, 'grass',
    [['Oddish', '☘️', 1, 4], ['Gloom', '🥀', 3, 6], ['Vileplume', '🌺', 5, 9]],
    { name: 'Mega Drain', trigger: 'attack', key: 'lifesteal', pct: [.5, .75, 1], desc: 'On attack: heals for {pct}% of the damage dealt.' },
    'spore');

  // ── Tier 2 ──
  line('bulbasaur', 2, 'grass',
    [['Bulbasaur', '🦕', 2, 4], ['Ivysaur', '🪴', 4, 6], ['Venusaur', '🌳', 6, 9]],
    { name: 'Razor Leaf', trigger: 'attack', key: 'splash', dmg: [2, 3, 5], desc: 'On attack: also hits the unit behind the target for {dmg}.' },
    'pinch');
  line('charmander', 2, 'fire',
    [['Charmander', '🦎', 3, 3], ['Charmeleon', '🦖', 5, 5], ['Charizard', '🐲', 8, 7]],
    { name: 'Ember', trigger: 'attack', key: 'burnHit', chance: [.4, .6, .8], names: ['Ember', 'Flamethrower', 'Fire Blast'], desc: 'On attack: {chance}% chance to burn the target.' },
    'pinch');
  line('squirtle', 2, 'water',
    [['Squirtle', '🐢', 2, 4], ['Wartortle', '💦', 4, 6], ['Blastoise', '🌊', 6, 10]],
    { name: 'Withdraw', trigger: 'start', key: 'shieldSelf', amt: [2, 4, 7], desc: 'Battle start: gains a {amt} HP shell shield.' },
    'pinch');
  line('pikachu', 2, 'electric',
    [['Pikachu', '🐭', 3, 2], ['Raichu', '⚡', 6, 5]],
    { name: 'Thunder Shock', trigger: 'attack', key: 'paraHit', chance: [.3, .45, .6], names: ['Thunder Shock', 'Thunderbolt', 'Thunder'], desc: 'On attack: {chance}% chance to paralyze the target.' },
    'static');
  line('machop', 2, 'fighting',
    [['Machop', '🥊', 3, 3], ['Machoke', '💪', 5, 5], ['Machamp', '🦾', 8, 8]],
    { name: 'Bulk Up', trigger: 'start', key: 'buffSelf', atk: [1, 2, 3], hp: [1, 2, 3], desc: 'Battle start: gains +{atk} attack and +{hp} HP.' },
    'guts');
  line('geodude', 2, 'rock',
    [['Geodude', '🪨', 2, 4], ['Graveler', '🗿', 4, 7], ['Golem', '⛰️', 6, 11]],
    { name: 'Explosion', trigger: 'faint', key: 'explode', dmg: [3, 5, 8], desc: 'On faint: deals {dmg} Rock damage to the two nearest enemies.' },
    'sturdy');

  // ── Tier 3 ──
  line('abra', 3, 'psychic',
    [['Abra', '🥄', 4, 2], ['Kadabra', '🔮', 6, 4], ['Alakazam', '🧙', 9, 5]],
    { name: 'Psybeam', trigger: 'start', key: 'hitFront', dmg: [2, 4, 6], names: ['Psybeam', 'Psychic', 'Future Sight'], desc: 'Battle start: blasts the enemy front unit for {dmg} Psychic damage.' },
    'blink');
  line('gastly', 3, 'ghost',
    [['Gastly', '👻', 4, 2], ['Haunter', '😱', 6, 4], ['Gengar', '😈', 8, 6]],
    { name: 'Curse', trigger: 'start', key: 'curseFront', turns: [3, 4, 6], desc: 'Battle start: curses the enemy front unit — it takes 2 damage at the end of each exchange for {turns} exchanges.' },
    'levitate');
  line('growlithe', 3, 'fire',
    [['Growlithe', '🐶', 4, 3], ['Arcanine', '🦁', 7, 7]],
    { name: 'Flare Blitz', trigger: 'attack', key: 'recoilBonus', dmg: [2, 3, 5], self: 1, desc: 'On attack: deals +{dmg} bonus Fire damage but takes 1 recoil.' },
    'intimidate');
  line('staryu', 3, 'water',
    [['Staryu', '⭐', 3, 4], ['Starmie', '🌟', 6, 7]],
    { name: 'Swift', trigger: 'attack', key: 'hitAll', dmg: [1, 2, 3], desc: 'On attack: star-bolts hit every enemy for {dmg}.' },
    'regen');
  line('doduo', 3, 'flying',
    [['Doduo', '🐔', 4, 3], ['Dodrio', '🦃', 7, 5]],
    { name: 'Fury Attack', trigger: 'attack', key: 'strikeAgain', chance: [.35, .5, .7], desc: 'On attack: {chance}% chance to strike again at half power.' },
    'speedster');
  line('seel', 3, 'ice',
    [['Seel', '🦭', 3, 5], ['Dewgong', '🐬', 5, 9]],
    { name: 'Ice Shard', trigger: 'start', key: 'hitFront', dmg: [2, 3, 5], desc: 'Battle start: hurls an ice shard at the enemy front unit for {dmg} Ice damage.' },
    'thickFat');

  // ── Tier 4 ──
  line('onix', 4, 'rock',
    [['Onix', '🐍', 4, 9]],
    { name: 'Rock Tomb', trigger: 'attack', key: 'flinchHit', chance: [.25, .35, .5], desc: 'On attack: {chance}% chance to make the target flinch and skip its next strike.' },
    'thickSkin');
  line('rhyhorn', 4, 'ground',
    [['Rhyhorn', '🦏', 5, 6], ['Rhydon', '🦣', 8, 10]],
    { name: 'Earthquake', trigger: 'turnEnd', key: 'quake', every: 3, dmg: [1, 2, 3], desc: 'Every 3rd exchange: deals {dmg} Ground damage to all enemies.' },
    'immuneElectric');
  line('scyther', 4, 'bug',
    [['Scyther', '🦗', 7, 4]],
    { name: 'Ambush', trigger: 'attack', key: 'ambush', mult: 2, desc: 'Its first strike of the battle deals double damage.' },
    'technician');
  line('magnemite', 4, 'electric',
    [['Magnemite', '🧲', 4, 4], ['Magneton', '⚙️', 7, 7]],
    { name: 'Thunder Wave', trigger: 'start', key: 'paraFront', chance: [.6, .8, 1], desc: 'Battle start: {chance}% chance to paralyze the enemy front unit.' },
    'sturdy');
  line('cubone', 4, 'ground',
    [['Cubone', '🦴', 4, 5], ['Marowak', '💀', 7, 8]],
    { name: 'Bone Club', trigger: 'attack', key: 'hitBack', dmg: [2, 3, 5], desc: 'On attack: hurls a bone at the enemy\'s rearmost unit for {dmg} Ground damage.' },
    'vengeful');
  line('kangaskhan', 4, 'normal',
    [['Kangaskhan', '🦘', 5, 7]],
    { name: 'Counter', trigger: 'hurt', key: 'reflect', dmg: [1, 2, 3], desc: 'When struck in melee: strikes back for {dmg} damage.' },
    'scrappy');

  // ── Tier 5 ──
  line('dratini', 5, 'dragon',
    [['Dratini', '🐍', 4, 4], ['Dragonair', '💠', 6, 6], ['Dragonite', '🐉', 9, 10]],
    { name: 'Dragon Dance', trigger: 'turnEnd', key: 'ramp', atk: [1, 1, 2], hp: [0, 1, 1], desc: 'End of each exchange: gains +{atk} attack and +{hp} HP.' },
    'multiscale');
  line('lapras', 5, 'water',
    [['Lapras', '⛵', 5, 9]],
    { name: 'Sing', trigger: 'start', key: 'flinchFront', count: [1, 2, 3], desc: 'Battle start: lulls the enemy front unit — it skips its next {count} strike(s).' },
    'immuneWater');
  line('snorlax', 5, 'normal',
    [['Snorlax', '😴', 4, 12]],
    { name: 'Rest', trigger: 'hurt', key: 'rest', amt: [4, 7, 12], desc: 'Once per battle, when below 40% HP: naps and heals {amt} HP.' },
    'immuneStatus');
  line('aerodactyl', 5, 'rock',
    [['Aerodactyl', '🪽', 8, 5]],
    { name: 'Sky Drop', trigger: 'start', key: 'hitBack', dmg: [3, 5, 8], desc: 'Battle start: dive-bombs the enemy\'s rearmost unit for {dmg} Rock damage.' },
    'speedster');
  line('electabuzz', 5, 'electric',
    [['Electabuzz', '🔋', 6, 6]],
    { name: 'Discharge', trigger: 'turnEnd', key: 'quake', every: 3, dmg: [1, 2, 3], desc: 'Every 3rd exchange: zaps all enemies for {dmg} Electric damage.' },
    'noFlinch');

  // ── Tier 6 ──
  line('tauros', 6, 'normal',
    [['Tauros', '🐂', 8, 7]],
    { name: 'Take Down', trigger: 'attack', key: 'recoilBonus', dmg: [3, 5, 8], self: 1, desc: 'On attack: deals +{dmg} bonus damage but takes 1 recoil.' },
    'intimidate');
  line('pinsir', 6, 'bug',
    [['Pinsir', '🪲', 9, 6]],
    { name: 'Guillotine', trigger: 'attack', key: 'guillotine', chance: [.1, .15, .22], desc: 'On attack: {chance}% chance to instantly take the target down to 0 HP.' },
    'noDebuff');

  // ── Legendaries (egg / trophy exclusive — never in the shop) ──
  line('articuno', 6, 'ice',
    [['Articuno', '❄️', 8, 9]],
    { name: 'Blizzard', trigger: 'start', key: 'hitAll', dmg: [3, 4, 6], desc: 'Battle start: an ice storm hits every enemy for {dmg} Ice damage.' },
    'pressure', { legendary: true });
  line('zapdos', 6, 'electric',
    [['Zapdos', '🌩️', 9, 8]],
    { name: 'Thunder', trigger: 'attack', key: 'paraHit', chance: [.5, .65, .8], desc: 'On attack: {chance}% chance to paralyze the target.' },
    'pressure', { legendary: true });
  line('moltres', 6, 'fire',
    [['Moltres', '🔥', 9, 8]],
    { name: 'Heat Wave', trigger: 'start', key: 'burnAll', chance: [.6, .8, 1], desc: 'Battle start: {chance}% chance to burn each enemy.' },
    'pressure', { legendary: true });
  line('mewtwo', 6, 'psychic',
    [['Mewtwo', '🧬', 12, 8]],
    { name: 'Psystrike', trigger: 'attack', key: 'recoilBonus', dmg: [4, 6, 9], self: 0, desc: 'On attack: deals +{dmg} bonus Psychic damage.' },
    'pressure', { legendary: true });
  line('mew', 6, 'psychic',
    [['Mew', '💫', 8, 8]],
    { name: 'Metronome', trigger: 'attack', key: 'metronome', desc: 'On attack: waggles a finger and does something random — burn, paralyze, heal the team, power up, or a bonus blast.' },
    'pressure', { legendary: true });

  // ── Derived lookups ──
  const LINE_MAP = {}, SPECIES = {};
  for (const ln of LINES) {
    LINE_MAP[ln.id] = ln;
    ln.stages.forEach((st, i) => {
      const sid = st[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      ln.stageIds = ln.stageIds || [];
      ln.stageIds.push(sid);
      SPECIES[sid] = { id: sid, name: st[0], emoji: st[1], atk: st[2], hp: st[3], line: ln.id, stageIndex: i, tier: ln.tier, type: ln.type, legendary: !!ln.legendary };
    });
  }
  // Which evolution stage a unit shows at a given level (1..3).
  // 3-stage lines evolve at lv2 and lv3; 2-stage lines evolve at lv3; singles never.
  function stageForLevel(lineId, level) {
    const n = LINE_MAP[lineId].stages.length;
    if (n === 1) return 0;
    if (n === 2) return level >= 3 ? 1 : 0;
    return Math.min(level - 1, 2);
  }
  const speciesAt = (lineId, level) => SPECIES[LINE_MAP[lineId].stageIds[stageForLevel(lineId, level)]];
  const moveNameAt = (ln, level) => (ln.move.names ? ln.move.names[Math.min(level, 3) - 1] : ln.move.name);

  const shopLines = LINES.filter(l => !l.legendary);
  const dexOrder = LINES.slice().sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));

  // ── Materials ──
  const MATS = {
    berry:    { name: 'Berry',    icon: '🫐', desc: 'Sweet forest berries. Snack, currency, crafting base.' },
    apricorn: { name: 'Apricorn', icon: '🍈', desc: 'Hard-shelled fruit — the raw casing of every Poké Ball.' },
    stardust: { name: 'Stardust', icon: '✨', desc: 'Glittering dust that hums with energy.' },
    iron:     { name: 'Iron Chunk', icon: '🔩', desc: 'Scrap metal for sturdy gear.' },
    essence:  { name: 'Essence',  icon: '🔮', desc: 'Condensed life energy from released Pokémon.' },
  };

  // ── Items: balls, consumables, held gear ──
  const ITEMS = {
    pokeball:   { name: 'Poké Ball',   icon: '⚪', kind: 'ball', rate: .40, desc: 'A standard capture ball. 40% base catch rate.' },
    greatball:  { name: 'Great Ball',  icon: '🔵', kind: 'ball', rate: .60, desc: 'A finer ball. 60% base catch rate.' },
    ultraball:  { name: 'Ultra Ball',  icon: '🟡', kind: 'ball', rate: .80, desc: 'Top-shelf capture tech. 80% base catch rate.' },
    masterball: { name: 'Master Ball', icon: '🟣', kind: 'ball', rate: 1.0, desc: 'Never misses. Not even on legendaries.' },
    expcandy:   { name: 'EXP Candy',   icon: '🍬', kind: 'consumable', xp: 1, desc: 'Feeds a team Pokémon +1 XP.' },
    rarecandy:  { name: 'Rare Candy',  icon: '🍭', kind: 'consumable', xp: 3, desc: 'Feeds a team Pokémon +3 XP. Delicious progress.' },
    // held items
    oranberry:   { name: 'Oran Berry',   icon: '🍊', kind: 'held', desc: 'Held: once per battle, heals 5 HP when dropping below half.' },
    charcoal:    { name: 'Charcoal',     icon: '🪵', kind: 'held', boost: 'fire', desc: 'Held by a Fire type: +2 attack.' },
    mysticwater: { name: 'Mystic Water', icon: '💧', kind: 'held', boost: 'water', desc: 'Held by a Water type: +2 attack.' },
    miracleseed: { name: 'Miracle Seed', icon: '🌱', kind: 'held', boost: 'grass', desc: 'Held by a Grass type: +2 attack.' },
    magnet:      { name: 'Magnet',       icon: '🧲', kind: 'held', boost: 'electric', desc: 'Held by an Electric type: +2 attack.' },
    leftovers:   { name: 'Leftovers',    icon: '🍱', kind: 'held', desc: 'Held: recovers 1 HP at the end of every exchange.' },
    focussash:   { name: 'Focus Sash',   icon: '🎗️', kind: 'held', desc: 'Held: the first lethal hit each battle leaves the holder at 1 HP.' },
    rockyhelmet: { name: 'Rocky Helmet', icon: '⛑️', kind: 'held', desc: 'Held: melee attackers take 2 damage.' },
    shellbell:   { name: 'Shell Bell',   icon: '🔔', kind: 'held', desc: 'Held: heals 2 HP every time the holder attacks.' },
    choiceband:  { name: 'Choice Band',  icon: '🎽', kind: 'held', desc: 'Held: +3 attack.' },
    assaultvest: { name: 'Assault Vest', icon: '🦺', kind: 'held', desc: 'Held: +6 max HP.' },
    quickclaw:   { name: 'Quick Claw',   icon: '🪝', kind: 'held', desc: 'Held: strike first in exchanges — a kill prevents the counter-hit.' },
    expshare:    { name: 'EXP Share',    icon: '📿', kind: 'held', desc: 'Held: the holder gains +1 XP after every battle won.' },
  };

  // ── Crafting recipes: { out, n, cost:{mat:qty} } ──
  const RECIPES = [
    { out: 'pokeball',   cost: { apricorn: 2, iron: 1 } },
    { out: 'greatball',  cost: { apricorn: 4, iron: 2, stardust: 1 } },
    { out: 'ultraball',  cost: { apricorn: 6, iron: 3, stardust: 3 } },
    { out: 'expcandy',   cost: { berry: 4, essence: 2 } },
    { out: 'rarecandy',  cost: { berry: 10, essence: 5, stardust: 2 } },
    { out: 'oranberry',  cost: { berry: 3 } },
    { out: 'charcoal',   cost: { berry: 1, iron: 1, stardust: 2 } },
    { out: 'mysticwater',cost: { berry: 1, iron: 1, stardust: 2 } },
    { out: 'miracleseed',cost: { berry: 1, iron: 1, stardust: 2 } },
    { out: 'magnet',     cost: { iron: 2, stardust: 2 } },
    { out: 'leftovers',  cost: { berry: 4, iron: 1 } },
    { out: 'focussash',  cost: { stardust: 3, iron: 2 } },
    { out: 'rockyhelmet',cost: { iron: 4 } },
    { out: 'shellbell',  cost: { iron: 2, stardust: 2 } },
    { out: 'choiceband', cost: { iron: 3, stardust: 3 } },
    { out: 'assaultvest',cost: { iron: 3, berry: 3 } },
    { out: 'quickclaw',  cost: { iron: 2, stardust: 4 } },
    { out: 'expshare',   cost: { stardust: 5, essence: 2 } },
  ];

  // ── Eggs (hatch into Box Pokémon) & Chests (loot) — real-time timers ──
  const EGGS = {
    basicegg:  { name: 'Basic Egg',     icon: '🥚', color: '#8fbf6f', mins: 15,  tiers: [1, 2], legendChance: 0,   lv2Chance: 0 },
    rareegg:   { name: 'Rare Egg',      icon: '🥚', color: '#4a9de8', mins: 60,  tiers: [2, 3], legendChance: 0,   lv2Chance: .1 },
    epicegg:   { name: 'Epic Egg',      icon: '🥚', color: '#a86fe0', mins: 240, tiers: [3, 4, 5], legendChance: .05, lv2Chance: .25 },
    legendegg: { name: 'Legendary Egg', icon: '🥚', color: '#f0b03a', mins: 720, tiers: [5, 6], legendChance: .35, lv2Chance: .5 },
  };
  const CHESTS = {
    woodchest:   { name: 'Wooden Chest', icon: '📦', color: '#a07850', mins: 5 },
    silverchest: { name: 'Silver Chest', icon: '🧰', color: '#9fb2c8', mins: 30 },
    goldchest:   { name: 'Golden Chest', icon: '🎁', color: '#e8b83a', mins: 120 },
    mysticchest: { name: 'Mystic Chest', icon: '💠', color: '#7f6fe8', mins: 360 },
  };

  // ── Trophy shop (meta currency 🎖️) ──
  const TROPHY_SHOP = [
    { id: 'woodchest',  kind: 'chest', cost: 2 },
    { id: 'silverchest',kind: 'chest', cost: 5 },
    { id: 'goldchest',  kind: 'chest', cost: 12 },
    { id: 'mysticchest',kind: 'chest', cost: 25 },
    { id: 'basicegg',   kind: 'egg',  cost: 3 },
    { id: 'rareegg',    kind: 'egg',  cost: 8 },
    { id: 'epicegg',    kind: 'egg',  cost: 20 },
    { id: 'legendegg',  kind: 'egg',  cost: 50 },
    { id: 'masterball', kind: 'item', cost: 40 },
    { id: 'nurseryslot',kind: 'slot', cost: 15, name: 'Nursery Slot', icon: '🪺', desc: 'One more egg/chest can tick at the same time (max 6).' },
  ];

  const TRAINER_CLASSES = ['Youngster', 'Lass', 'Bug Catcher', 'Hiker', 'Picnicker', 'Swimmer', 'Camper', 'Sailor', 'Bird Keeper', 'Fisher', 'Ace Trainer', 'Mystic', 'Black Belt', 'Ranger', 'Scientist', 'Dragon Tamer'];
  const TRAINER_NAMES = ['Joey', 'Mina', 'Rex', 'Tara', 'Bruno', 'Wes', 'Ivy', 'Koa', 'Sal', 'June', 'Pico', 'Nell', 'Otto', 'Ruby', 'Gus', 'Faye', 'Dex', 'Lulu', 'Moe', 'Zia'];

  // fill {tokens} in move descriptions for a given level
  function moveDesc(ln, level) {
    const mv = ln.move;
    return mv.desc.replace(/\{(\w+)\}/g, (_, k) => {
      let v = U.byLevel(mv[k], level);
      if (v === undefined) return '?';
      if (k === 'chance' || k === 'pct') v = Math.round(v * 100);
      return v;
    });
  }

  return { TYPES, CHART, typeMult, PASSIVES, LINES, LINE_MAP, SPECIES, stageForLevel, speciesAt, moveNameAt, moveDesc, shopLines, dexOrder, MATS, ITEMS, RECIPES, EGGS, CHESTS, TROPHY_SHOP, TRAINER_CLASSES, TRAINER_NAMES };
})();
