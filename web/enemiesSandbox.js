// ../auto-battler/src/gw.js
var PROFESSION_BY_ID = [
  "Common",
  "Warrior",
  "Ranger",
  "Monk",
  "Necromancer",
  "Mesmer",
  "Elementalist",
  "Assassin",
  "Ritualist",
  "Paragon",
  "Dervish"
];
var iconUrl = (id) => `/gw/skills/${id}.jpg`;
var COST_GLYPH = {
  energy: "/gw/icons/tango-energy.png",
  adrenaline: "/gw/icons/tango-adrenaline.png",
  activation: "/gw/icons/tango-activation.png",
  recharge: "/gw/icons/tango-recharge.png",
  sacrifice: "/gw/icons/tango-sacrifice.png",
  overcast: "/gw/icons/tango-overcast.png",
  upkeep: "/gw/icons/tango-upkeep.png"
};

// ../auto-battler/src/engine/skills.js
var FIRST_15 = [
  // ── Warrior: adrenaline-fuelled condition → spike (Swordsmanship line) ──
  {
    id: 382,
    name: "Sever Artery",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 4 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [5, 25] } }]
  },
  {
    id: 384,
    name: "Gash",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 6 },
    cast: 0,
    recharge: 0,
    // The payoff: bonus damage + Deep Wound, but only on an already-Bleeding foe.
    requires: ["on_hit", { target: "bleeding" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [5, 20] } },
      { op: "apply_condition", condition: "deepWound", duration: { scale: [5, 20] } }
    ]
  },
  {
    id: 385,
    name: "Final Thrust",
    profession: "Warrior",
    attribute: "Swordsmanship",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 10 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [
      { op: "lose_all_adrenaline" },
      { op: "bonus_damage", amount: { scale: [1, 40] } },
      // "doubled if below 50%" — applying the same bonus a second time, gated.
      { op: "bonus_damage", amount: { scale: [1, 40] }, if: { target_below_health: 0.5 } }
    ]
  },
  // ── Ranger: preparations + ranged conditions/interrupt ──
  {
    id: 435,
    name: "Apply Poison",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "preparation",
    target: "self",
    cost: { energy: 15 },
    cast: 2,
    recharge: 12,
    // The differentiator: a self rider — future physical attacks inflict Poison.
    effects: [{
      op: "preparation",
      duration: { fixed: 24 },
      on_attack: [{ op: "apply_condition", condition: "poison", duration: { scale: [3, 15] } }]
    }]
  },
  {
    id: 391,
    name: "Hunter's Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 10,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [3, 25] } }]
  },
  {
    id: 426,
    name: "Savage Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0.5,
    recharge: 5,
    requires: ["on_hit"],
    effects: [
      { op: "interrupt" },
      // Bonus only if the interrupted action was a spell.
      { op: "bonus_damage", amount: { scale: [13, 28] }, if: { target: "casting_spell" } }
    ]
  },
  // ── Necromancer: trigger-hexes (the event bus / physway) ──
  {
    id: 121,
    name: "Spiteful Spirit",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 15 },
    cast: 2,
    recharge: 10,
    elite: true,
    effects: [{
      op: "hex",
      duration: { scale: [8, 20] },
      trigger: "on_action",
      payload: [{ op: "damage", damageType: "shadow", amount: { scale: [5, 35] }, scope: "target_and_adjacent" }]
    }]
  },
  {
    id: 101,
    name: "Barbs",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 2,
    recharge: 5,
    effects: [{
      op: "hex",
      duration: { fixed: 30 },
      // Passive amplifier — no discrete trigger; the damage pipeline reads it.
      payload: [{ op: "amplify_damage", amount: { scale: [1, 15] }, vs: "physical" }]
    }]
  },
  {
    id: 150,
    name: "Mark of Pain",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 20,
    effects: [{
      op: "hex",
      duration: { fixed: 30 },
      trigger: "on_physical_hit",
      payload: [{ op: "damage", damageType: "shadow", amount: { scale: [10, 40] }, scope: "adjacent_to_target" }]
    }]
  },
  // ── Monk: the damage-interception pipeline ──
  {
    id: 245,
    name: "Protective Spirit",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 10 },
    cast: 0.25,
    recharge: 5,
    effects: [{
      op: "enchant",
      duration: { scale: [5, 23] },
      // Cap: a single hit can't remove more than 10% of max Health.
      payload: [{ op: "cap_damage", maxFraction: 0.1 }]
    }]
  },
  {
    id: 307,
    name: "Reversal of Fortune",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 5 },
    cast: 0.25,
    recharge: 2,
    effects: [{
      op: "enchant",
      duration: { fixed: 8 },
      charges: 1,
      trigger: "on_incoming_damage",
      payload: [{ op: "convert_damage_to_heal", cap: { scale: [15, 80] } }]
    }]
  },
  {
    id: 1114,
    name: "Spirit Bond",
    profession: "Monk",
    attribute: "Protection Prayers",
    category: "enchantment",
    target: "ally",
    cost: { energy: 10 },
    cast: 0.25,
    recharge: 2,
    effects: [{
      op: "enchant",
      duration: { fixed: 8 },
      charges: 10,
      trigger: "on_incoming_damage",
      threshold: { perHitDamageOver: 50 },
      payload: [{ op: "heal", amount: { scale: [30, 90] }, scope: "target" }]
    }]
  },
  // ── Assassin: the combo chain (lead → off-hand → dual) ──
  {
    id: 782,
    name: "Jagged Strike",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "lead_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.5,
    recharge: 1,
    requires: ["on_hit"],
    effects: [
      { op: "apply_condition", condition: "bleeding", duration: { scale: [5, 20] } },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  {
    id: 780,
    name: "Fox Fangs",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "offhand_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.5,
    recharge: 3,
    requires: ["on_hit", { combo_follows: "lead" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 35] }, unblockable: true },
      { op: "set_combo_mark", stage: "offhand" }
    ]
  },
  {
    id: 775,
    name: "Death Blossom",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "dual_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 2,
    requires: ["on_hit", { combo_follows: "offhand" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [20, 45] } },
      { op: "damage", amount: { scale: [20, 45] }, scope: "adjacent_to_target" }
    ]
  }
];
var VARIANT_EXTRA = [
  // ── Warrior · Sentinel (soak / protect) ──
  {
    id: 348,
    name: '"Watch Yourself!"',
    profession: "Warrior",
    attribute: "Tactics",
    category: "shout",
    target: "party",
    cost: { adrenaline: 4 },
    cast: 0,
    recharge: 4,
    // Party armor for 10s, but the buff also ends after 10 incoming attacks.
    effects: [{ op: "armor_mod", amount: { scale: [5, 25] }, duration: { fixed: 10 }, attacksLeft: 10, scope: "party" }]
  },
  {
    id: 372,
    name: "Gladiator's Defense",
    profession: "Warrior",
    attribute: "Tactics",
    category: "stance",
    target: "self",
    cost: { energy: 5 },
    cast: 0,
    recharge: 30,
    elite: true,
    // 75% block; whoever you block in melee takes 5…35 back.
    effects: [{ op: "block", chance: 0.75, vs: "melee", reflect: { scale: [5, 35] }, duration: { scale: [5, 11] } }]
  },
  {
    id: 1,
    name: "Healing Signet",
    profession: "Warrior",
    attribute: "Tactics",
    category: "signet",
    target: "self",
    cost: {},
    cast: 2,
    recharge: 4,
    effects: [{ op: "heal", amount: { scale: [82, 172] }, scope: "self" }],
    whileActivating: [{ op: "armor_mod", amount: -40, duration: { fixed: 0 }, scope: "self" }]
    // −40 armor while using
  },
  // ── Warrior · Breaker (knockdown control) ──
  {
    id: 332,
    name: "Bull's Strike",
    profession: "Warrior",
    attribute: "Strength",
    category: "melee_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 10,
    requires: ["on_hit", { target: "moving" }],
    effects: [
      { op: "bonus_damage", amount: { scale: [5, 30] } },
      { op: "knockdown", duration: { fixed: 2 } }
    ]
  },
  {
    id: 331,
    name: "Hammer Bash",
    profession: "Warrior",
    attribute: "Hammer Mastery",
    category: "melee_attack",
    target: "foe",
    cost: { adrenaline: 6 },
    cast: 0,
    recharge: 0,
    requires: ["on_hit"],
    effects: [
      { op: "knockdown", duration: { fixed: 2 } },
      { op: "lose_all_adrenaline" }
    ]
  },
  {
    id: 352,
    name: "Crushing Blow",
    profession: "Warrior",
    attribute: "Hammer Mastery",
    category: "melee_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 0,
    recharge: 10,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [1, 20] } },
      { op: "apply_condition", condition: "deepWound", duration: { scale: [5, 20] }, if: { target: "knocked_down" } }
    ]
  },
  // ── Ranger · Sharpshooter (Punishing Shot completes the interrupt bar) ──
  {
    id: 409,
    name: "Punishing Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0.5,
    recharge: 5,
    elite: true,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 20] } },
      { op: "interrupt" }
    ]
  },
  // ── Ranger · Toxicologist (stacked degen) ──
  {
    id: 1470,
    name: "Barbed Arrows",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "preparation",
    target: "self",
    cost: { energy: 10 },
    cast: 2,
    recharge: 12,
    effects: [{
      op: "preparation",
      duration: { fixed: 24 },
      on_attack: [{ op: "apply_condition", condition: "bleeding", duration: { scale: [3, 15] } }]
    }],
    whileActivating: [{ op: "armor_mod", amount: -40, duration: { fixed: 0 }, scope: "self" }]
    // −40 armor while activating
  },
  {
    id: 1466,
    name: "Burning Arrow",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0,
    recharge: 5,
    elite: true,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [10, 30] } },
      { op: "apply_condition", condition: "burning", duration: { scale: [1, 7] } }
    ]
  },
  // ── Ranger · Survivalist (sustain / kite) ──
  {
    id: 446,
    name: "Troll Unguent",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "skill",
    target: "self",
    cost: { energy: 5 },
    cast: 3,
    recharge: 10,
    effects: [{ op: "regen_mod", pips: { scale: [3, 10] }, duration: { fixed: 13 }, scope: "self" }]
  },
  {
    id: 1727,
    name: "Natural Stride",
    profession: "Ranger",
    attribute: "Wilderness Survival",
    category: "stance",
    target: "self",
    cost: { energy: 5 },
    cast: 0,
    recharge: 12,
    // Move 33% faster + 50% block; the stance ends if you become hexed/enchanted.
    effects: [
      { op: "move_speed", mult: 1.33, duration: { scale: [1, 8] }, endsOnHexEnchant: true },
      { op: "block", chance: 0.5, vs: "all", duration: { scale: [1, 8] }, endsOnHexEnchant: true }
    ]
  },
  {
    id: 393,
    name: "Crippling Shot",
    profession: "Ranger",
    attribute: "Marksmanship",
    category: "bow_attack",
    target: "foe",
    cost: { energy: 10 },
    cast: 0,
    recharge: 2,
    elite: true,
    requires: ["on_hit"],
    effects: [{ op: "apply_condition", condition: "crippled", duration: { scale: [1, 12] }, unblockable: true }]
  },
  // ── Necromancer · Vampire (life-steal sustain) ──
  {
    id: 153,
    name: "Vampiric Gaze",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 8,
    effects: [{ op: "life_steal", amount: { scale: [18, 60] } }]
  },
  {
    id: 109,
    name: "Life Siphon",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 5,
    effects: [
      { op: "regen_mod", pips: { scale: [-1, -3] }, duration: { scale: [12, 24] }, scope: "target" },
      { op: "regen_mod", pips: { scale: [1, 3] }, duration: { scale: [12, 24] }, scope: "self" }
    ]
  },
  {
    id: 115,
    name: "Blood Renewal",
    profession: "Necromancer",
    attribute: "Blood Magic",
    category: "enchantment",
    target: "self",
    cost: { energy: 1, sacrifice: 15 },
    cast: 1,
    recharge: 7,
    // +3…6 regen for 7s, then a burst heal of 40…190 when the enchant ends.
    effects: [
      { op: "regen_mod", pips: { scale: [3, 6] }, duration: { fixed: 7 }, scope: "self" },
      { op: "enchant", duration: { fixed: 7 }, trigger: "on_end", payload: [{ op: "heal", amount: { scale: [40, 190] }, scope: "self" }] }
    ]
  },
  // ── Necromancer · Plaguebearer (condition spread) ──
  {
    id: 118,
    name: "Enfeebling Blood",
    profession: "Necromancer",
    attribute: "Curses",
    category: "spell",
    target: "foe",
    cost: { energy: 1, sacrifice: 10 },
    cast: 1,
    recharge: 8,
    effects: [{ op: "apply_condition", condition: "weakness", duration: { scale: [5, 20] }, scope: "target_and_adjacent" }]
  },
  {
    id: 106,
    name: "Rotting Flesh",
    profession: "Necromancer",
    attribute: "Death Magic",
    category: "spell",
    target: "foe",
    cost: { energy: 15 },
    cast: 3,
    recharge: 3,
    effects: [{ op: "apply_condition", condition: "disease", duration: { scale: [10, 25] } }]
  },
  {
    id: 135,
    name: "Faintheartedness",
    profession: "Necromancer",
    attribute: "Curses",
    category: "hex",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 8,
    effects: [
      { op: "regen_mod", pips: { scale: [0, -3] }, duration: { scale: [3, 16] }, scope: "target" },
      { op: "attack_speed", mult: 2, duration: { scale: [3, 16] }, scope: "target" }
    ]
  },
  // ── Monk · Healer (raw healing) ──
  {
    id: 281,
    name: "Orison of Healing",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "ally",
    cost: { energy: 5 },
    cast: 1,
    recharge: 2,
    effects: [{ op: "heal", amount: { scale: [20, 70] }, scope: "target" }]
  },
  {
    id: 283,
    name: "Dwayna's Kiss",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "other_ally",
    cost: { energy: 5 },
    cast: 1,
    recharge: 3,
    // Heal, +10…35 more for each enchantment and hex on the target ally.
    effects: [{ op: "heal", amount: { scale: [15, 60] }, scope: "target", plusPerMod: { kinds: ["enchant", "hex"], amount: { scale: [10, 35] } } }]
  },
  {
    id: 282,
    name: "Word of Healing",
    profession: "Monk",
    attribute: "Healing Prayers",
    category: "spell",
    target: "ally",
    cost: { energy: 5 },
    cast: 0.75,
    recharge: 3,
    elite: true,
    // Conditional bonus first so the "<50% Health" check reads the pre-heal HP
    // (the base heal below would otherwise lift the ally over the threshold).
    effects: [
      { op: "heal", amount: { scale: [30, 115] }, scope: "target", if: { target_below_health: 0.5 } },
      { op: "heal", amount: { scale: [5, 100] }, scope: "target" }
    ]
  },
  // ── Monk · Smiter (holy offense) ──
  {
    id: 312,
    name: "Holy Strike",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.75,
    recharge: 8,
    effects: [
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target" },
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target", if: { target: "knocked_down" } }
    ]
  },
  {
    id: 240,
    name: "Smite",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 10,
    effects: [
      { op: "damage", damageType: "holy", amount: { scale: [10, 55] }, scope: "target_and_adjacent" },
      { op: "damage", damageType: "holy", amount: { scale: [10, 35] }, scope: "target_and_adjacent", if: { target: "attacking" } }
    ]
  },
  {
    id: 252,
    name: "Banish",
    profession: "Monk",
    attribute: "Smiting Prayers",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 10,
    // Double vs summoned creatures — a no-op until summons exist, but recorded.
    effects: [{ op: "damage", damageType: "holy", amount: { scale: [20, 56] }, scope: "target", vsSummoned: 2 }]
  },
  // ── Assassin · Nightstalker (shadow-step burst) ──
  {
    id: 952,
    name: "Death's Charge",
    profession: "Assassin",
    attribute: "Shadow Arts",
    category: "skill",
    target: "foe",
    cost: { energy: 5 },
    cast: 0.25,
    recharge: 30,
    // Shadow-step to the foe; heal only if that foe has more Health than you.
    effects: [
      { op: "shadow_step", to: "foe" },
      { op: "heal", amount: { scale: [65, 200] }, scope: "self", if: { target_health_above_self: true } }
    ]
  },
  {
    id: 1024,
    name: "Black Mantis Thrust",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "lead_attack",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 6,
    requires: ["on_hit"],
    effects: [
      { op: "bonus_damage", amount: { scale: [8, 20] } },
      { op: "apply_condition", condition: "crippled", duration: { scale: [3, 15] }, if: { target: "hexed" } },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  // ── Assassin · Saboteur (control / Deadly Arts) ──
  {
    id: 858,
    name: "Dancing Daggers",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "spell",
    target: "foe",
    cost: { energy: 5 },
    cast: 1,
    recharge: 5,
    // Three earth projectiles, each 5…35; counts as a lead attack.
    effects: [
      { op: "damage", damageType: "earth", amount: { scale: [5, 35] }, projectiles: 3, delivery: "projectile_spell", scope: "target" },
      { op: "set_combo_mark", stage: "lead" }
    ]
  },
  {
    id: 784,
    name: "Entangling Asp",
    profession: "Assassin",
    attribute: "Deadly Arts",
    category: "spell",
    target: "foe",
    cost: { energy: 10 },
    cast: 1,
    recharge: 20,
    requires: [{ combo_follows: "lead" }],
    effects: [
      { op: "knockdown", duration: { fixed: 2 } },
      { op: "apply_condition", condition: "poison", duration: { scale: [5, 20] } }
    ]
  },
  {
    id: 988,
    name: "Temple Strike",
    profession: "Assassin",
    attribute: "Dagger Mastery",
    category: "offhand_attack",
    target: "foe",
    cost: { energy: 15 },
    cast: 0,
    recharge: 20,
    elite: true,
    requires: ["on_hit", { combo_follows: "lead" }],
    effects: [
      { op: "interrupt", if: { target: "casting_spell" } },
      // interrupts a spell
      { op: "apply_condition", condition: "dazed", duration: { scale: [1, 10] } },
      { op: "apply_condition", condition: "blind", duration: { scale: [1, 10] } }
    ]
  }
];
var CB_SKILLS = [...FIRST_15, ...VARIANT_EXTRA];

// ../auto-battler/src/engine/rng.js
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ../auto-battler/src/engine/range.js
var MELEE_GW = 144;
var BASIC_MELEE_GW = MELEE_GW / 2;
var BOW_GW = 1e3;
var SPELL_GW = 1010;

// ../auto-battler/src/engine/teamBattle.js
var byId = Object.fromEntries(CB_SKILLS.map((s) => [s.id, s]));
var skillById = (id) => byId[id] || null;
var FIELD = { w: 1e3, h: 600 };
var FORMATION = [
  { x: 0.31, y: 0.66 },
  { x: 0.47, y: 0.74 },
  { x: 0.13, y: 0.73 },
  { x: 0.28, y: 0.82 },
  { x: 0.44, y: 0.91 }
];
var HIT_TOLERANCE = 130;
function val(v, rank = 12) {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  if (v.fixed != null) return v.fixed;
  if (v.scale) {
    const [a, b] = v.scale;
    return Math.round(a + (b - a) * rank / 15);
  }
  return 0;
}
var DEGEN = { bleeding: 4, poison: 4, burning: 8, disease: 4 };
var ATTACK_CATEGORIES = ["melee_attack", "bow_attack", "lead_attack", "offhand_attack", "dual_attack", "scythe_attack", "spear_attack"];
var isAttack = (s) => ATTACK_CATEGORIES.includes(s.category);
var CLASS_TEMPLATES = {
  Warrior: { maxHp: 520, role: "melee", weapon: { min: 15, max: 22, interval: 1.5, range: BASIC_MELEE_GW }, moveSpeed: 130, maxEnergy: 25, energyRegen: 0.5, armor: 80 },
  Assassin: { maxHp: 480, role: "melee", weapon: { min: 7, max: 17, interval: 1.33, range: BASIC_MELEE_GW }, moveSpeed: 175, maxEnergy: 30, energyRegen: 1.2, armor: 55 },
  Ranger: { maxHp: 430, role: "ranged", weapon: { min: 12, max: 28, interval: 1.9, range: BOW_GW, projSpeed: 850 }, moveSpeed: 155, preferredRange: 620, maxEnergy: 35, energyRegen: 1, armor: 45 },
  Monk: { maxHp: 470, role: "melee", weapon: { min: 8, max: 14, interval: 1.6, range: BASIC_MELEE_GW }, moveSpeed: 140, maxEnergy: 40, energyRegen: 1.4, armor: 60 },
  Necromancer: { maxHp: 450, role: "ranged", weapon: { min: 10, max: 20, interval: 1.8, range: BOW_GW, projSpeed: 720 }, moveSpeed: 140, preferredRange: 520, maxEnergy: 35, energyRegen: 1, armor: 45 }
};
var DEFAULT_TEMPLATE = { maxHp: 300, role: "melee", weapon: { min: 10, max: 16, interval: 1.5, range: BASIC_MELEE_GW }, moveSpeed: 150, maxEnergy: 30, energyRegen: 1, armor: 50 };
function templateFor(unit) {
  if (unit.template) return unit.template;
  if (unit.profession && CLASS_TEMPLATES[unit.profession]) return CLASS_TEMPLATES[unit.profession];
  if (unit.stats) {
    const s = unit.stats;
    const basic = s.basicDamage ?? 12;
    const ranged = unit.attackType === "ranged";
    return {
      maxHp: s.hp ?? 100,
      role: ranged ? "ranged" : "melee",
      armor: s.armor ?? 40,
      moveSpeed: 150,
      maxEnergy: 30,
      energyRegen: 1,
      preferredRange: ranged ? 600 : void 0,
      weapon: {
        min: Math.max(1, Math.round(basic * 0.8)),
        max: Math.round(basic * 1.3),
        interval: 1.4,
        range: ranged ? BOW_GW : BASIC_MELEE_GW,
        ...ranged ? { projSpeed: 800 } : {}
      }
    };
  }
  return DEFAULT_TEMPLATE;
}
function makeActor(unit, team, id, slot) {
  const tpl = templateFor(unit);
  const hpMul = unit.hpMul ?? unit.statMul ?? 1;
  const dmgMul = unit.dmgMul ?? unit.statMul ?? 1;
  const maxHp = Math.max(1, Math.round(tpl.maxHp * hpMul));
  const rangeMul = unit.rangeMul ?? 1;
  const ranged = tpl.role === "ranged";
  const weapon = { ...tpl.weapon, min: Math.max(1, Math.round(tpl.weapon.min * dmgMul)), max: Math.max(1, Math.round(tpl.weapon.max * dmgMul)), range: Math.round((tpl.weapon.range ?? 0) * (ranged ? rangeMul : 1)) };
  const preferredRange = tpl.preferredRange != null ? Math.round(tpl.preferredRange * rangeMul) : void 0;
  const p = FORMATION[slot % FORMATION.length];
  const pt = team === "player" ? { x: p.x, y: p.y } : { x: 1 - p.x, y: 1 - p.y };
  const bar = (unit.skills || []).map((s) => s && typeof s === "object" ? s : skillById(s)).filter(Boolean);
  return {
    id,
    team,
    name: unit.name || id,
    profession: unit.profession || null,
    // control: 'ai' (autonomous), 'player' (driven by b.input via setInput) or
    // 'dummy' (passive target — takes damage, never acts). Sandboxes use the
    // latter two so the Classes/Enemies hero fights real engine dummies.
    control: unit.control || "ai",
    role: tpl.role,
    rank: unit.rank ?? 12,
    armor: tpl.armor ?? 0,
    weapon,
    moveSpeed: Math.round(tpl.moveSpeed * (unit.speedMul ?? 1)),
    preferredRange,
    radius: radiusOf(unit, tpl),
    maxEnergy: tpl.maxEnergy,
    energyRegen: tpl.energyRegen,
    baseMaxHp: maxHp,
    maxHp,
    hp: maxHp,
    energy: tpl.maxEnergy,
    adrenaline: 0,
    bar,
    x: pt.x * FIELD.w,
    y: pt.y * FIELD.h,
    facing: team === "player" ? 1 : -1,
    faceX: team === "player" ? 1 : -1,
    faceY: team === "player" ? -1 : 1,
    // players look up-right, enemies down-left
    attackTimer: tpl.weapon.interval,
    casting: null,
    recharge: {},
    conds: [],
    marks: {},
    prep: null,
    alive: true,
    mods: [],
    kd: 0,
    aggroRadius: unit.aggroRadius ?? null,
    // optional: idle until a foe is within this distance (else always engage)
    noKite: !!unit.noKite
    // ranged: hold ground in range instead of backing away (kiting)
  };
}
function makeTeamBattle({ seed = 1, players = [], enemies = [], sandbox = false, respawnDummies = 0, freeCast = false, world = null, field = null } = {}) {
  const actors = [];
  players.filter(Boolean).slice(0, 5).forEach((u, i) => actors.push(makeActor(u, "player", `P${i}`, i)));
  enemies.filter(Boolean).slice(0, 5).forEach((u, i) => actors.push(makeActor(u, "enemy", `E${i}`, i)));
  return { t: 0, rng: makeRng(seed), actors, projectiles: [], log: [], over: false, winner: null, sandbox, respawnDummies, freeCast, input: {}, world, field: field || FIELD };
}
function setInput(b, id, cmd) {
  if (!b.input) b.input = {};
  b.input[id] = { ...b.input[id] || {}, ...cmd };
}
var ADJACENT_GW = 140;
var BODY_RADIUS = { melee: 35, ranged: 32 };
var DEFAULT_RADIUS = 32;
var DEOVERLAP_ITERS = 3;
var DEOVERLAP_FRACTION = 0.5;
var CONTACT_SLOP = 2;
var MAX_BATTLE_T = 90;
var COLLISION_Y_WEIGHT = 3.2;
var radiusOf = (unit, tpl) => unit.template?.radius ?? unit.stats?.radius ?? tpl.radius ?? BODY_RADIUS[tpl.role] ?? DEFAULT_RADIUS;
var edgeGap = (a, t) => dist(a, t) - (a.radius || 0) - (t.radius || 0);
var MELEE_REACH = 2;
var reachOf = (a) => a.role === "ranged" ? a.weapon.range : MELEE_REACH;
var SPELL_RANGE = 900;
var ARMOR_IGNORING = /* @__PURE__ */ new Set(["shadow", "holy", "dark", "chaos"]);
var dist = (a, e) => Math.hypot(a.x - e.x, a.y - e.y);
var hasCond = (a, type) => a.conds.some((c) => c.type === type);
var isKd = (b, a) => a.kd > b.t;
var gainAdr = (a, n) => {
  a.adrenaline = Math.min(25, a.adrenaline + n);
};
var livingFoes = (b, a) => b.actors.filter((x) => x.alive && x.team !== a.team);
var alliesOf = (b, a) => b.actors.filter((x) => x.alive && x.team === a.team);
function nearestFoe(b, a) {
  let best = null, bd = Infinity;
  for (const x of livingFoes(b, a)) {
    const d = dist(a, x);
    if (d < bd) {
      bd = d;
      best = x;
    }
  }
  return best;
}
function mostWoundedAlly(b, a, includeSelf = true) {
  let best = null, bf = Infinity;
  for (const x of alliesOf(b, a)) {
    if (!includeSelf && x === a) continue;
    const f = x.hp / x.maxHp;
    if (f < bf) {
      bf = f;
      best = x;
    }
  }
  return best;
}
var adjacentTo = (b, tgt) => b.actors.filter((x) => x.alive && x.team === tgt.team && x !== tgt && dist(x, tgt) <= ADJACENT_GW);
var addMod = (b, a, m) => a.mods.push({ until: b.t + (m.dur ?? 0), ...m });
var activeMods = (b, a, kind) => a.mods.filter((m) => m.kind === kind && m.until > b.t);
var hasModKind = (b, a, kind) => a.mods.some((m) => m.kind === kind && m.until > b.t);
var sumRegenPips = (b, a) => activeMods(b, a, "regen").reduce((n, m) => n + m.pips, 0);
var bonusArmor = (b, a) => activeMods(b, a, "armor").reduce((n, m) => n + m.amount, 0);
var attackSpeedMult = (b, a) => activeMods(b, a, "attackSpeed").reduce((n, m) => n * m.mult, 1);
var moveSpeedMult = (b, a) => (hasCond(a, "crippled") ? 0.5 : 1) * activeMods(b, a, "moveSpeed").reduce((n, m) => n * m.mult, 1);
var hasHex = (b, a) => hasModKind(b, a, "hex");
var countCat = (b, a, kinds) => a.mods.filter((m) => m.until > b.t && kinds.includes(m.cat)).length;
var mitigate = (dmg, armor) => dmg * (100 / (100 + (armor || 0)));
function log(b, kind, who, extra = {}) {
  b.log.push({ t: Math.round(b.t * 100) / 100, kind, who: who?.id, ...extra });
}
function applyCondition(b, tgt, type, dur, empowered) {
  if (!tgt.alive) return;
  const ex = tgt.conds.find((c) => c.type === type);
  if (ex) {
    ex.until = Math.max(ex.until, b.t + dur);
    return;
  }
  tgt.conds.push({ type, until: b.t + dur });
  if (type === "deepWound") {
    tgt.maxHp = Math.round(tgt.baseMaxHp * 0.8);
    if (tgt.hp > tgt.maxHp) tgt.hp = tgt.maxHp;
  }
  log(b, "cond", tgt, { cond: type, amount: Math.round(dur), ...empowered ? { empowered: true } : {} });
}
function expireConds(b, a) {
  for (const c of a.conds) if (c.until <= b.t && c.type === "deepWound") a.maxHp = a.baseMaxHp;
  a.conds = a.conds.filter((c) => c.until > b.t);
  for (const m of a.mods) if (m.kind === "onEnd" && m.until <= b.t && !m.fired) {
    m.fired = true;
    const src = b.actors.find((x) => x.id === m.srcId) || a;
    for (const e of m.payload || []) applyEffect(b, src, a, e, "spell");
  }
  a.mods = a.mods.filter((m) => m.until > b.t);
}
function healActor(b, a, amount, empowered) {
  if (!a.alive || amount <= 0) return;
  a.hp = Math.min(a.maxHp, a.hp + Math.round(amount));
  log(b, "heal", a, { amount: Math.round(amount), ...empowered ? { empowered: true } : {} });
}
function dealDamage(b, src, tgt, amount, label, opts = {}) {
  if (!tgt.alive) return 0;
  if (tgt.invulnUntil && b.t < tgt.invulnUntil) {
    log(b, "miss", tgt, { name: label });
    return 0;
  }
  const { damageType = "physical", delivery = "spell", armorIgnoring = false, empowered = false } = opts;
  const physical = delivery === "melee" || delivery === "projectile";
  if (physical) {
    const blk = blockRoll(b, tgt, delivery);
    if (blk) {
      if (blk.reflect && delivery === "melee") dealDamage(b, tgt, src, blk.reflect, "reflect", { delivery: "spell", armorIgnoring: true });
      log(b, "miss", tgt, { name: label });
      return 0;
    }
  }
  let dmg = amount;
  if (physical) {
    for (const m of activeMods(b, tgt, "amplify")) if (m.vs === "physical") dmg += m.amount;
  }
  if (!(armorIgnoring || ARMOR_IGNORING.has(damageType))) dmg = mitigate(dmg, tgt.armor + bonusArmor(b, tgt));
  const cap = activeMods(b, tgt, "cap")[0];
  if (cap) dmg = Math.min(dmg, cap.fraction * tgt.maxHp);
  const conv = activeMods(b, tgt, "convert").find((m) => m.charges > 0);
  if (conv) {
    healActor(b, tgt, Math.min(dmg, conv.cap));
    conv.charges--;
    dmg = 0;
  }
  for (const m of activeMods(b, tgt, "onIncomingHeal")) {
    if (m.charges > 0 && dmg > m.threshold) {
      healActor(b, tgt, m.amount);
      m.charges--;
    }
  }
  dmg = Math.max(0, Math.round(dmg));
  tgt.hp -= dmg;
  log(b, "hit", tgt, { src: src.id, amount: dmg, name: label, ...empowered ? { empowered: true } : {} });
  gainAdr(tgt, 1);
  if (physical) {
    for (const m of activeMods(b, tgt, "armor")) if (m.attacksLeft != null && --m.attacksLeft <= 0) m.until = b.t;
    fireTrigger(b, tgt, "onPhysicalHit");
  }
  if (tgt.hp <= 0) kill(b, tgt);
  return dmg;
}
function blockRoll(b, tgt, delivery) {
  for (const m of activeMods(b, tgt, "block")) {
    if (m.vs === "all" || m.vs === delivery) {
      if (b.rng() < m.chance) return m;
    }
  }
  return null;
}
function kill(b, a) {
  if (!a.alive) return;
  a.alive = false;
  a.hp = 0;
  a.deadAt = b.t;
  log(b, "death", a);
  if (hasCond(a, "disease")) for (const x of adjacentTo(b, a)) applyCondition(b, x, "disease", 10);
}
function applyContainer(b, src, tgt, e) {
  const dur = val(e.duration, src.rank);
  const cat = e.op;
  const p = e.payload?.[0] || {};
  if (e.op === "hex") addMod(b, tgt, { kind: "hex", cat, dur });
  for (const m of tgt.mods) if (m.endsOnHexEnchant && m.until > b.t) m.until = b.t;
  if (p.op === "amplify_damage") {
    addMod(b, tgt, { kind: "amplify", cat, vs: p.vs || "physical", amount: val(p.amount, src.rank), dur });
    return;
  }
  if (p.op === "cap_damage") {
    addMod(b, tgt, { kind: "cap", cat, fraction: p.maxFraction, dur });
    return;
  }
  if (p.op === "convert_damage_to_heal") {
    addMod(b, tgt, { kind: "convert", cat, cap: val(p.cap, src.rank), charges: e.charges ?? 1, dur });
    return;
  }
  if (e.trigger === "on_end") {
    addMod(b, tgt, { kind: "onEnd", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  if (e.trigger === "on_incoming_damage" && p.op === "heal") {
    addMod(b, tgt, { kind: "onIncomingHeal", cat, amount: val(p.amount, src.rank), threshold: e.threshold?.perHitDamageOver ?? 0, charges: e.charges ?? 1, dur });
    return;
  }
  if (e.trigger === "on_action") {
    addMod(b, tgt, { kind: "onAction", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  if (e.trigger === "on_physical_hit") {
    addMod(b, tgt, { kind: "onPhysicalHit", cat, payload: e.payload, srcId: src.id, srcRank: src.rank, dur });
    return;
  }
  addMod(b, tgt, { kind: "enchant", cat, dur });
}
function fireTrigger(b, a, kind) {
  for (const m of activeMods(b, a, kind)) {
    const fakeSrc = b.actors.find((x) => x.id === m.srcId) || { id: m.srcId, rank: m.srcRank };
    for (const e of m.payload || []) applyEffect(b, fakeSrc, a, e, "spell");
  }
}
function resolveScope(b, src, tgt, scope, range) {
  switch (scope) {
    case "self":
      return [src];
    case "party":
      return alliesOf(b, src);
    case "target_and_adjacent":
      return [tgt, ...adjacentTo(b, tgt)];
    case "adjacent_to_target":
      return adjacentTo(b, tgt);
    case "nearby":
    case "area":
      return [tgt, ...adjacentTo(b, tgt)];
    case "area_around_caster": {
      const r = range || 180;
      return b.actors.filter((x) => x.alive && x.team !== src.team && dist(src, x) <= r);
    }
    default:
      return [tgt];
  }
}
function applyEffect(b, src, tgt, e, delivery = "spell", s = null) {
  if (e.if && !branchOk(b, e.if, src, tgt)) return;
  if (e.if && s) logEmpower(b, src, tgt, s, empowerLabel(e, src.rank), reasonOf(e.if));
  const emp = !!e.if;
  const targets = resolveScope(b, src, tgt, e.scope, e.range);
  for (const t of targets) {
    if (!t || !t.alive) continue;
    const dur = e.duration != null ? val(e.duration, src.rank) : 0;
    switch (e.op) {
      case "damage": {
        const amt = val(e.amount, src.rank);
        const n = e.projectiles || 0;
        if (n > 1 || e.delivery === "projectile_spell") fireSpellProjectiles(b, src, t, amt, e, n || 1);
        else dealDamage(b, src, t, amt, src.name || "spell", { damageType: e.damageType, delivery, empowered: emp });
        break;
      }
      case "life_steal": {
        const dealt = dealDamage(b, src, t, val(e.amount, src.rank), src.name || "steal", { delivery, armorIgnoring: true });
        healActor(b, src, dealt);
        break;
      }
      case "heal": {
        let amt = val(e.amount, src.rank);
        let scaled = 0;
        if (e.plusPerMod) {
          scaled = countCat(b, t, e.plusPerMod.kinds) * val(e.plusPerMod.amount, src.rank);
          amt += scaled;
        }
        if (s && scaled > 0) logEmpower(b, src, t, s, `+${scaled} heal`, `${countCat(b, t, e.plusPerMod.kinds)} effects`);
        healActor(b, t, amt, emp || scaled > 0);
        break;
      }
      case "apply_condition":
        applyCondition(b, t, e.condition, dur, emp);
        break;
      case "knockdown":
        t.kd = Math.max(t.kd, b.t + dur);
        t.casting = null;
        break;
      case "interrupt":
        if (t.casting) {
          t.casting = null;
          log(b, "cond", t, { cond: "interrupted", amount: 0, ...emp ? { empowered: true } : {} });
        }
        break;
      case "regen_mod":
        addMod(b, t, { kind: "regen", pips: val(e.pips, src.rank), dur });
        break;
      case "attack_speed":
        addMod(b, t, { kind: "attackSpeed", mult: e.mult, dur });
        break;
      case "armor_mod":
        addMod(b, t, { kind: "armor", amount: val(e.amount, src.rank), attacksLeft: e.attacksLeft, dur });
        break;
      case "move_speed":
        addMod(b, src, { kind: "moveSpeed", mult: e.mult, endsOnHexEnchant: e.endsOnHexEnchant, dur });
        break;
      case "block":
        addMod(b, src, { kind: "block", chance: e.chance, vs: e.vs || "all", reflect: e.reflect ? val(e.reflect, src.rank) : 0, endsOnHexEnchant: e.endsOnHexEnchant, dur });
        break;
      case "shadow_step":
        shadowStep(b, src, t);
        break;
      case "set_combo_mark":
        src.marks[t.id] = { stage: e.stage, until: b.t + 20 };
        break;
      case "lose_all_adrenaline":
        src.adrenaline = 0;
        break;
      case "preparation":
        src.prep = { on_attack: e.on_attack, until: b.t + dur };
        break;
      case "hex":
      case "enchant":
        applyContainer(b, src, t, e);
        break;
      default:
        break;
    }
  }
}
function shadowStep(b, a, tgt) {
  const f = b.field || FIELD;
  const dx = a.x - tgt.x, dy = a.y - tgt.y, len = Math.hypot(dx, dy) || 1;
  a.x = Math.max(0, Math.min(f.w, tgt.x + dx / len * (BASIC_MELEE_GW * 0.8)));
  a.y = Math.max(0, Math.min(f.h, tgt.y + dy / len * (BASIC_MELEE_GW * 0.8)));
}
function fireSpellProjectiles(b, src, tgt, amt, e, n) {
  const base = dist(src, tgt) / 900;
  for (let i = 0; i < n; i++) {
    b.projectiles.push({
      srcId: src.id,
      tgtId: tgt.id,
      aimX: tgt.x,
      aimY: tgt.y,
      bornT: b.t,
      hitT: b.t + base + i * 0.1,
      spell: true,
      amount: amt,
      damageType: e.damageType,
      label: src.name || "spell"
    });
  }
  log(b, "shoot", src, { name: src.name });
}
function branchOk(b, req2, a, tgt) {
  if (req2.target_below_health != null) return tgt.hp / tgt.maxHp < req2.target_below_health;
  if (req2.target_health_above_self) return tgt.hp > a.hp;
  if (req2.target === "bleeding") return hasCond(tgt, "bleeding");
  if (req2.target === "casting_spell") return !!tgt.casting;
  if (req2.target === "moving") return !!tgt.moving;
  if (req2.target === "knocked_down") return isKd(b, tgt);
  if (req2.target === "hexed") return hasHex(b, tgt);
  if (req2.target === "attacking") return tgt.attackedAt != null && b.t - tgt.attackedAt < 1.2;
  if (req2.self === "enchanted") return hasModKind(b, a, "cap") || hasModKind(b, a, "convert");
  return true;
}
function reasonOf(req2) {
  if (!req2) return "";
  if (req2.target_below_health != null) return `foe <${req2.target_below_health * 100}%`;
  if (req2.target_health_above_self) return "foe has more HP";
  if (req2.target === "bleeding") return "foe Bleeding";
  if (req2.target === "casting_spell") return "foe casting";
  if (req2.target === "moving") return "foe moving";
  if (req2.target === "knocked_down") return "knocked down";
  if (req2.target === "hexed") return "foe hexed";
  if (req2.target === "attacking") return "foe attacking";
  return "";
}
function empowerLabel(e, rank) {
  switch (e.op) {
    case "bonus_damage":
    case "damage":
      return `+${val(e.amount, rank)} dmg`;
    case "apply_condition":
      return `+${e.condition}`;
    case "heal":
      return `+${val(e.amount, rank)} heal`;
    case "interrupt":
      return "INTERRUPT";
    default:
      return "bonus";
  }
}
function logEmpower(b, src, tgt, s, label, reason) {
  log(b, "empower", src, { tgt: tgt?.id, skillId: s?.id, name: s?.name, label, reason });
}
function strike(b, a, enemy, s) {
  a.attackTimer = a.weapon.interval * attackSpeedMult(b, a);
  a.attackedAt = b.t;
  if (hasCond(a, "blind") && b.rng() < 0.9) {
    if (a.role !== "ranged") log(b, "swing", a, { name: s ? s.name : "attack" });
    log(b, "miss", enemy, { name: s ? s.name : "attack" });
    return;
  }
  let weaponDmg = a.weapon.min + b.rng() * (a.weapon.max - a.weapon.min);
  if (hasCond(a, "weakness")) weaponDmg *= 0.75;
  let bonus = 0, empEffect = null;
  if (s) {
    for (const e of s.effects) if (e.op === "bonus_damage" && (!e.if || branchOk(b, e.if, a, enemy))) {
      bonus += val(e.amount, a.rank);
      if (e.if) empEffect = e;
    }
  }
  if (a.role === "ranged") {
    const flight = dist(a, enemy) / (a.weapon.projSpeed || 800);
    b.projectiles.push({ srcId: a.id, tgtId: enemy.id, fromX: a.x, fromY: a.y, aimX: enemy.x, aimY: enemy.y, bornT: b.t, hitT: b.t + flight, weaponDmg, bonus, s, empEffect });
    log(b, "shoot", a, { name: s ? s.name : "shot", skillId: s?.id });
  } else {
    log(b, "swing", a, { name: s ? s.name : "attack" });
    applyHit(b, a, enemy, s, weaponDmg, bonus, empEffect);
  }
}
function applyHit(b, a, enemy, s, weaponDmg, bonus, empEffect = null) {
  if (!enemy.alive) return;
  const delivery = a.role === "ranged" ? "projectile" : "melee";
  if (empEffect) logEmpower(b, a, enemy, s, empowerLabel(empEffect, a.rank), reasonOf(empEffect.if));
  dealDamage(b, a, enemy, weaponDmg + bonus, s ? s.name : "attack", { delivery, empowered: !!empEffect });
  if (s) {
    for (const e of s.effects) {
      if (e.op === "bonus_damage") continue;
      if (e.if && !branchOk(b, e.if, a, enemy)) continue;
      const emp = !!e.if;
      if (emp && e.op !== "damage") logEmpower(b, a, enemy, s, empowerLabel(e, a.rank), reasonOf(e.if));
      switch (e.op) {
        case "apply_condition":
          for (const t of resolveScope(b, a, enemy, e.scope)) applyCondition(b, t, e.condition, val(e.duration, a.rank), emp);
          break;
        case "set_combo_mark":
          a.marks[enemy.id] = { stage: e.stage, until: b.t + 20 };
          break;
        case "lose_all_adrenaline":
          a.adrenaline = 0;
          break;
        case "knockdown":
          enemy.kd = Math.max(enemy.kd, b.t + val(e.duration, a.rank));
          enemy.casting = null;
          break;
        case "interrupt":
          if (enemy.casting) {
            enemy.casting = null;
            log(b, "cond", enemy, { cond: "interrupted", amount: 0, ...emp ? { empowered: true } : {} });
          }
          break;
        case "damage":
          applyEffect(b, a, enemy, e, "melee", s);
          break;
        default:
          break;
      }
    }
    if (s.category === "dual_attack") delete a.marks[enemy.id];
  }
  if (a.prep && a.prep.until > b.t) for (const e of a.prep.on_attack) {
    if (e.op === "apply_condition") applyCondition(b, enemy, e.condition, val(e.duration, a.rank));
  }
  gainAdr(a, 1);
}
function advanceProjectiles(b) {
  const live = [];
  for (const p of b.projectiles) {
    if (b.t < p.hitT) {
      live.push(p);
      continue;
    }
    const src = b.actors.find((x) => x.id === p.srcId);
    const tgt = b.actors.find((x) => x.id === p.tgtId);
    if (!src || !tgt || !tgt.alive) continue;
    if (Math.hypot(tgt.x - p.aimX, tgt.y - p.aimY) > HIT_TOLERANCE) {
      log(b, "miss", tgt, { name: p.label || p.s?.name || "shot" });
      continue;
    }
    if (p.spell) dealDamage(b, src, tgt, p.amount, p.label, { damageType: p.damageType, delivery: "spell" });
    else applyHit(b, src, tgt, p.s, p.weaponDmg, p.bonus, p.empEffect);
  }
  b.projectiles = live;
}
var fireOnAction = (b, a) => fireTrigger(b, a, "onAction");
function applyActivationPenalty(b, a, s, cast) {
  for (const e of s.whileActivating || []) {
    if (e.op === "armor_mod") addMod(b, a, { kind: "armor", amount: val(e.amount, a.rank), dur: cast });
  }
}
var COMBO_STAGE = { lead_attack: "lead", offhand_attack: "offhand", dual_attack: "dual" };
function performSkill(b, a, tgt, s) {
  if (s.cost?.energy) a.energy -= s.cost.energy;
  if (s.cost?.adrenaline) a.adrenaline -= s.cost.adrenaline;
  if (s.cost?.sacrifice) a.hp = Math.max(1, a.hp - Math.round(a.maxHp * s.cost.sacrifice / 100));
  log(b, "cast", a, { name: s.name, elite: !!s.elite, skillId: s.id, tgt: tgt.id, ...COMBO_STAGE[s.category] ? { combo: COMBO_STAGE[s.category] } : {} });
  a.recharge[s.name] = b.t + (s.recharge || 0);
  fireOnAction(b, a);
  if (isAttack(s)) {
    strike(b, a, tgt, s);
    return;
  }
  for (const e of s.effects) applyEffect(b, a, tgt, e, "spell", s);
}
var isSupport = (s) => !!s && ["self", "ally", "other_ally", "party"].includes(s.target);
var enchantModKind = (e) => {
  const p = e.payload?.[0] || {};
  if (p.op === "cap_damage") return "cap";
  if (p.op === "convert_damage_to_heal") return "convert";
  if (e.trigger === "on_incoming_damage") return "onIncomingHeal";
  return null;
};
function skillTarget(b, a, s, foe) {
  if (s.target === "self" || s.target === "party") return a;
  if (s.target === "ally") return mostWoundedAlly(b, a, true);
  if (s.target === "other_ally") return mostWoundedAlly(b, a, false);
  return foe;
}
function usable(b, a, s, tgt, foe, free = false) {
  if (!tgt) return false;
  if (free) return true;
  if (b.t < (a.recharge[s.name] || 0)) return false;
  if (s.cost?.energy && a.energy < s.cost.energy) return false;
  if (s.cost?.adrenaline && a.adrenaline < s.cost.adrenaline) return false;
  if (isAttack(s) && edgeGap(a, foe) > reachOf(a)) return false;
  if (!isAttack(s) && !isSupport(s) && dist(a, foe) > SPELL_RANGE) return false;
  for (const r of s.requires || []) {
    if (r === "on_hit") continue;
    if (r.combo_follows && a.marks[foe.id]?.stage !== r.combo_follows) return false;
    if (r.target === "bleeding" && !hasCond(foe, "bleeding")) return false;
    if (r.target === "casting_spell" && !foe.casting) return false;
    if (r.target === "moving" && !foe.moving) return false;
    if (r.target === "knocked_down" && !isKd(b, foe)) return false;
  }
  if (s.effects.some((e) => e.op === "preparation") && a.prep && a.prep.until > b.t) return false;
  if (isSupport(s)) {
    if (s.effects.some((e) => e.op === "heal") && tgt.hp / tgt.maxHp >= 0.7 && s.effects.every((e) => e.op === "heal" || e.op === "shadow_step")) return false;
    for (const e of s.effects) {
      if (e.op === "enchant") {
        const k = enchantModKind(e);
        if (k && hasModKind(b, tgt, k)) return false;
      }
      const selfBuffKind = { block: "block", armor_mod: "armor", regen_mod: "regen", attack_speed: "attackSpeed", move_speed: "moveSpeed" }[e.op];
      if (selfBuffKind && hasModKind(b, a, selfBuffKind)) return false;
    }
  } else {
    const meaningful = s.effects.filter((e) => e.op !== "set_combo_mark" && e.op !== "preparation");
    if (meaningful.length && meaningful.every((e) => e.op === "apply_condition" && hasCond(foe, e.condition))) return false;
  }
  return true;
}
function chooseAction(b, a, foe) {
  for (const s of a.bar) {
    const tgt = skillTarget(b, a, s, foe);
    if (usable(b, a, s, tgt, foe)) return { skill: s, target: tgt };
  }
  return null;
}
function moveActor(b, a, enemy, dt) {
  const d = dist(a, enemy);
  let toward = 0;
  if (a.role === "ranged") {
    if (a.noKite) toward = d > a.weapon.range ? 1 : 0;
    else if (d < (a.preferredRange ?? a.weapon.range * 0.7)) toward = -1;
    else if (d > a.weapon.range) toward = 1;
  } else if (edgeGap(a, enemy) > reachOf(a)) {
    toward = 1;
  }
  if (!toward) {
    a.vx = 0;
    a.vy = 0;
    return;
  }
  const speed = a.moveSpeed * moveSpeedMult(b, a);
  const dx = enemy.x - a.x, dy = enemy.y - a.y, len = Math.hypot(dx, dy) || 1;
  const desVx = dx / len * speed * toward, desVy = dy / len * speed * toward;
  const [vx, vy] = avoidVelocity(b, a, enemy, desVx, desVy, speed);
  const px = a.x, py = a.y;
  stepMove(b, a, vx, vy, dt);
  a.vx = vx;
  a.vy = vy;
  a.moving = b.world ? a.x !== px || a.y !== py : true;
}
var RVO_TAU = 1.6;
var RVO_RANGE = 280;
var RVO_W = 240;
var RVO_ANGLES = [0, 0.3, -0.3, 0.62, -0.62, 0.98, -0.98, 1.4, -1.4];
var RVO_SPEEDS = [1, 0.6];
function avoidVelocity(b, a, enemy, desVx, desVy, speed) {
  const KY = COLLISION_Y_WEIGHT;
  const obs = [];
  for (const o of b.actors) {
    if (o === a || !o.alive || o === enemy) continue;
    const rpx = o.x - a.x, rpy = (o.y - a.y) * KY;
    if (rpx * rpx + rpy * rpy > RVO_RANGE * RVO_RANGE) continue;
    obs.push({ rpx, rpy, ovx: o.vx || 0, ovy: (o.vy || 0) * KY, R: a.radius + o.radius });
  }
  if (!obs.length) return [desVx, desVy];
  const baseAng = Math.atan2(desVy, desVx);
  let best = [desVx, desVy], bestPen = Infinity;
  for (const da of RVO_ANGLES) {
    const ang = baseAng + da, cs = Math.cos(ang), sn = Math.sin(ang);
    for (const sf of RVO_SPEEDS) {
      const cvx = cs * speed * sf, cvy = sn * speed * sf;
      const cvxw = cvx, cvyw = cvy * KY;
      let minTtc = Infinity;
      for (const o of obs) {
        const t = timeToHit(o.rpx, o.rpy, o.ovx - cvxw, o.ovy - cvyw, o.R);
        if (t < minTtc) minTtc = t;
      }
      const collPen = minTtc <= RVO_TAU ? RVO_W / Math.max(minTtc, 0.05) : 0;
      const dev = Math.hypot(cvx - desVx, cvy - desVy);
      const pen = collPen + dev;
      if (pen < bestPen) {
        bestPen = pen;
        best = [cvx, cvy];
      }
    }
  }
  return best;
}
function timeToHit(px, py, rvx, rvy, R) {
  const c = px * px + py * py - R * R;
  if (c <= 0) return 0;
  const a2 = rvx * rvx + rvy * rvy;
  if (a2 < 1e-6) return Infinity;
  const b2 = px * rvx + py * rvy;
  if (b2 >= 0) return Infinity;
  const disc = b2 * b2 - a2 * c;
  if (disc <= 0) return Infinity;
  return (-b2 - Math.sqrt(disc)) / a2;
}
var clampField = (v, r, max) => Math.max(r, Math.min(max - r, v));
function stepMove(b, a, vx, vy, dt) {
  const f = b.field || FIELD;
  const w = b.world && b.world.walkable;
  let nx = clampField(a.x + vx * dt, a.radius, f.w);
  let ny = clampField(a.y + vy * dt, a.radius, f.h);
  if (w) {
    if (!w(nx, a.y)) nx = a.x;
    if (!w(nx, ny)) ny = a.y;
  }
  a.x = nx;
  a.y = ny;
}
function resolveOverlaps(b) {
  const f = b.field || FIELD;
  const live = b.actors.filter((a) => a.alive);
  for (let it = 0; it < DEOVERLAP_ITERS; it++) {
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], o = live[j];
        const dx = o.x - a.x, dy = (o.y - a.y) * COLLISION_Y_WEIGHT;
        const d = Math.hypot(dx, dy) || 0.01;
        const overlap = a.radius + o.radius - d;
        if (overlap <= CONTACT_SLOP) continue;
        const ux = dx / d, uy = dy / d;
        const aFix = isImmovable(b, a), oFix = isImmovable(b, o);
        const push = overlap * DEOVERLAP_FRACTION;
        const aShare = aFix ? 0 : oFix ? 1 : 0.5;
        const oShare = oFix ? 0 : aFix ? 1 : 0.5;
        const yPush = uy / COLLISION_Y_WEIGHT;
        a.x = clampField(a.x - ux * push * aShare, a.radius, f.w);
        a.y = clampField(a.y - yPush * push * aShare, a.radius, f.h);
        o.x = clampField(o.x + ux * push * oShare, o.radius, f.w);
        o.y = clampField(o.y + yPush * push * oShare, o.radius, f.h);
      }
    }
  }
}
var isImmovable = (b, a) => !!a.casting || isKd(b, a);
function stepPlayer(b, a, foe, dt) {
  const cmd = b.input && b.input[a.id] || {};
  const mx = cmd.moveX || 0, my = cmd.moveY || 0;
  if (mx || my) {
    const len = Math.hypot(mx, my) || 1;
    const speed = a.moveSpeed * moveSpeedMult(b, a);
    const px = a.x, py = a.y;
    stepMove(b, a, mx / len * speed, my / len * speed, dt);
    a.moving = b.world ? a.x !== px || a.y !== py : true;
    a.faceX = mx < 0 ? -1 : mx > 0 ? 1 : a.faceX;
    a.faceY = my < 0 ? -1 : my > 0 ? 1 : a.faceY;
    a.facing = a.faceX;
  }
  if (a.casting) {
    a.casting.left -= dt;
    if (a.casting.left <= 0) {
      const { skill, target } = a.casting;
      a.casting = null;
      performSkill(b, a, target?.alive ? target : foe, skill);
    }
    return;
  }
  const action = cmd.action;
  if (!action) return;
  const free = !!b.freeCast;
  if (free) {
    a.energy = a.maxEnergy;
    a.adrenaline = 25;
  }
  const clear = () => {
    if (b.input) b.input[a.id] = { ...cmd, action: null };
  };
  if (action === "basic") {
    if (!free && a.role !== "ranged" && edgeGap(a, foe) > reachOf(a)) {
      clear();
      return;
    }
    fireOnAction(b, a);
    strike(b, a, foe, null);
    clear();
    return;
  }
  const s = a.bar.find((x) => x.id === action);
  if (!s) {
    clear();
    return;
  }
  const tgt = skillTarget(b, a, s, foe);
  if (!usable(b, a, s, tgt, foe, free)) return;
  const cast = (s.cast || 0) * (hasCond(a, "dazed") ? 2 : 1);
  if (cast <= 0) performSkill(b, a, tgt, s);
  else {
    applyActivationPenalty(b, a, s, cast);
    a.casting = { skill: s, target: tgt, left: cast };
  }
  clear();
}
function reviveDummy(b, a) {
  a.alive = true;
  a.hp = a.maxHp = a.baseMaxHp;
  a.energy = a.maxEnergy;
  a.adrenaline = 0;
  a.conds = [];
  a.marks = {};
  a.mods = [];
  a.casting = null;
  a.kd = 0;
  a.deadAt = null;
}
function step(b, dt) {
  if (b.over) return;
  b.t += dt;
  if (b.sandbox && b.respawnDummies) {
    for (const a of b.actors) if (!a.alive && a.control === "dummy" && a.deadAt != null && b.t - a.deadAt >= b.respawnDummies) reviveDummy(b, a);
  }
  for (const a of b.actors) {
    if (!a.alive) continue;
    a.energy = Math.min(a.maxEnergy, a.energy + a.energyRegen * dt);
    let degen = 0;
    for (const c of a.conds) if (c.until > b.t) degen += DEGEN[c.type] || 0;
    const rate = degen - sumRegenPips(b, a) * 2;
    if (rate) {
      a.hp = Math.min(a.maxHp, a.hp - rate * dt);
      if (a.hp <= 0) kill(b, a);
    }
    expireConds(b, a);
    a.attackTimer -= dt;
    for (const id of Object.keys(a.marks)) if (a.marks[id]?.until <= b.t) delete a.marks[id];
  }
  advanceProjectiles(b);
  for (const a of b.actors) {
    if (!a.alive || b.over) continue;
    const enemy = nearestFoe(b, a);
    if (!enemy && a.control !== "player") continue;
    if (a.aggroRadius != null && a.control !== "player" && dist(a, enemy) > a.aggroRadius) {
      a.moving = false;
      continue;
    }
    if (enemy) {
      a.facing = enemy.x < a.x ? -1 : 1;
      a.faceX = a.facing;
      a.faceY = enemy.y < a.y ? -1 : 1;
    }
    a.moving = false;
    if (isKd(b, a)) {
      a.casting = null;
      continue;
    }
    if (a.control === "dummy") continue;
    if (a.control === "player") {
      stepPlayer(b, a, enemy, dt);
      continue;
    }
    if (a.casting) {
      a.casting.left -= dt;
      if (a.casting.left <= 0) {
        const { skill, target } = a.casting;
        a.casting = null;
        performSkill(b, a, target?.alive ? target : enemy, skill);
      }
      continue;
    }
    const action = chooseAction(b, a, enemy);
    if (action) {
      const cast = (action.skill.cast || 0) * (hasCond(a, "dazed") ? 2 : 1);
      if (cast <= 0) performSkill(b, a, action.target, action.skill);
      else {
        applyActivationPenalty(b, a, action.skill, cast);
        a.casting = { skill: action.skill, target: action.target, left: cast };
      }
    } else if (edgeGap(a, enemy) <= reachOf(a) && a.attackTimer <= 0) {
      fireOnAction(b, a);
      strike(b, a, enemy, null);
    } else {
      moveActor(b, a, enemy, dt);
    }
  }
  resolveOverlaps(b);
  if (b.sandbox) return;
  const playerAlive = b.actors.some((a) => a.alive && a.team === "player");
  const enemyAlive = b.actors.some((a) => a.alive && a.team === "enemy");
  if (!playerAlive || !enemyAlive) {
    b.over = true;
    b.winner = playerAlive ? "player" : enemyAlive ? "enemy" : null;
  } else if (b.t >= MAX_BATTLE_T) {
    const hp = (team) => b.actors.filter((a) => a.alive && a.team === team).reduce((n, a) => n + a.hp, 0);
    const ph = hp("player"), eh = hp("enemy");
    b.over = true;
    b.winner = ph === eh ? null : ph > eh ? "player" : "enemy";
  }
}

// ../auto-battler/src/engine/describe.js
function val2(v) {
  if (typeof v === "number") return String(v);
  if (v && v.fixed !== void 0) return String(v.fixed);
  if (v && v.scale) return `${v.scale[0]}\u2026${v.scale[1]}`;
  return "?";
}
function req(r) {
  if (r === "on_hit") return "on hit";
  if (r.combo_follows) return `follows a ${r.combo_follows} attack`;
  if (r.target) return `target is ${r.target}`;
  if (r.target_below_health !== void 0) return `target < ${r.target_below_health * 100}% HP`;
  if (r.target_health_above_self) return "target has more HP than you";
  if (r.self) return `you are ${r.self}`;
  return JSON.stringify(r);
}
function effect(e) {
  const ifc = e.if ? ` (if ${req(e.if)})` : "";
  const sc = e.scope && e.scope !== "target" ? ` [${e.scope.replace(/_/g, " ")}]` : "";
  let s;
  switch (e.op) {
    case "bonus_damage":
      s = `+${val2(e.amount)} damage${e.unblockable ? " (unblockable)" : ""}`;
      break;
    case "damage":
      s = `${val2(e.amount)}${e.projectiles ? `\xD7${e.projectiles}` : ""} ${e.damageType || ""} damage`.trim();
      break;
    case "amplify_damage":
      s = `+${val2(e.amount)} damage taken from ${e.vs}`;
      break;
    case "apply_condition":
      s = `${e.condition} ${val2(e.duration)}s`;
      break;
    case "heal":
      s = `heal ${val2(e.amount)}${e.plusPerMod ? ` (+${val2(e.plusPerMod.amount)} per ${e.plusPerMod.kinds.join("/")})` : ""}`;
      break;
    case "life_steal":
      s = `steal ${val2(e.amount)} Health`;
      break;
    case "knockdown":
      s = `knock down ${val2(e.duration)}s`;
      break;
    case "block":
      s = `block ${Math.round(e.chance * 100)}% vs ${e.vs || "all"} for ${val2(e.duration)}s${e.reflect ? ` (reflect ${val2(e.reflect)})` : ""}`;
      break;
    case "armor_mod":
      s = `+${val2(e.amount)} armor for ${val2(e.duration)}s${e.attacksLeft ? ` or ${e.attacksLeft} hits` : ""}`;
      break;
    case "regen_mod":
      s = `${val2(e.pips)} health regen for ${val2(e.duration)}s`;
      break;
    case "attack_speed":
      s = `attack ${e.mult}\xD7 speed for ${val2(e.duration)}s`;
      break;
    case "move_speed":
      s = `move ${e.mult}\xD7 speed for ${val2(e.duration)}s`;
      break;
    case "shadow_step":
      s = `shadow step to ${e.to || "foe"}`;
      break;
    case "convert_damage_to_heal":
      s = `convert next damage \u2192 heal (max ${val2(e.cap)})`;
      break;
    case "cap_damage":
      s = `cap each hit at ${e.maxFraction * 100}% max HP`;
      break;
    case "interrupt":
      s = "interrupt";
      break;
    case "set_combo_mark":
      s = `mark: ${e.stage}`;
      break;
    case "lose_all_adrenaline":
      s = "lose all adrenaline";
      break;
    case "hex":
    case "enchant": {
      const trig = e.trigger ? ` ${e.trigger.replace(/_/g, " ")}` : " (passive)";
      const ch = e.charges ? `, ${e.charges}\xD7` : "";
      const th = e.threshold ? `, when hit >${e.threshold.perHitDamageOver}` : "";
      s = `${e.op} ${val2(e.duration)}s${ch}${th}${trig}: [${e.payload.map(effect).join("; ")}]`;
      break;
    }
    case "preparation":
      s = `prep ${val2(e.duration)}s: each attack \u2192 [${e.on_attack.map(effect).join("; ")}]`;
      break;
    default:
      s = e.op;
  }
  return s + sc + ifc;
}

// ../auto-battler/src/lib/skillVisuals.js
var CONDITION_COLOR = {
  bleeding: "#e0584a",
  deepWound: "#b3402f",
  poison: "#6fae3f",
  disease: "#9aa83a",
  burning: "#e0822a",
  dazed: "#e0c64f",
  blind: "#9aa0a8",
  crippled: "#5bb6c0",
  weakness: "#b08a5a",
  crackedArmor: "#c9a36a"
};
var KIND = {
  damage: { color: "#e0584a", label: "Damage" },
  condition: { color: "#e0584a", label: "Condition" },
  // overridden per-condition
  heal: { color: "#6fbf73", label: "Heal" },
  defense: { color: "#5b9fd6", label: "Defense" },
  haste: { color: "#4fc0c0", label: "Speed" },
  vuln: { color: "#e0905a", label: "Weaken" },
  control: { color: "#b06fd8", label: "Control" },
  hex: { color: "#a05fd0", label: "Hex" },
  enchant: { color: "#e0c64f", label: "Enchant" },
  prep: { color: "#4fb0a0", label: "Prep" },
  utility: { color: "#9aa0a8", label: "Effect" }
};
var OP_KIND = {
  damage: "damage",
  bonus_damage: "damage",
  life_steal: "damage",
  apply_condition: "condition",
  heal: "heal",
  regen_mod: "heal",
  convert_damage_to_heal: "heal",
  armor_mod: "defense",
  block: "defense",
  cap_damage: "defense",
  attack_speed: "haste",
  move_speed: "haste",
  amplify_damage: "vuln",
  knockdown: "control",
  interrupt: "control",
  hex: "hex",
  enchant: "enchant",
  preparation: "prep"
};
var effectKind = (e) => OP_KIND[e?.op] ?? "utility";
function effectStyle(e) {
  const kind = effectKind(e);
  if (kind === "condition") {
    const color = CONDITION_COLOR[e.condition] ?? KIND.condition.color;
    const label = e.condition ? e.condition.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) : "Condition";
    return { color, label };
  }
  return KIND[kind];
}
var conditionIcon = (condition) => `/gw/icons/condition-${condition.replace(/([A-Z])/g, "-$1").toLowerCase()}.jpg`;

// ../auto-battler/src/lib/recolor.js
var QUANT = 24;
var SAT_MIN = 0.2;
var L_MIN = 0.1;
var L_MAX = 0.95;
var SWATCH_N = 5;
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(hue(h + 1 / 3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1 / 3) * 255)];
}
var hexToRgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
var rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
var isMaterial = (s, l) => s >= SAT_MIN && l >= L_MIN && l <= L_MAX;
var _imgCache = /* @__PURE__ */ new Map();
function loadImage(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  const p = new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
  _imgCache.set(url, p);
  return p;
}
function pixels(img) {
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { cv, ctx, data: ctx.getImageData(0, 0, cv.width, cv.height) };
}
var _analysis = /* @__PURE__ */ new Map();
function analyze(idleUrl) {
  if (_analysis.has(idleUrl)) return _analysis.get(idleUrl);
  const p = (async () => {
    const { data } = pixels(await loadImage(idleUrl));
    const d = data.data;
    const counts = /* @__PURE__ */ new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const r = d[i] - d[i] % QUANT, g = d[i + 1] - d[i + 1] % QUANT, b = d[i + 2] - d[i + 2] % QUANT;
      const [h, s, l] = rgbToHsl(r, g, b);
      if (!isMaterial(s, l)) continue;
      const k = r << 16 | g << 8 | b;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!counts.size) return { anchor: null, swatches: [] };
    const entries = [...counts.entries()].map(([k, c]) => ({ k, c, hsl: rgbToHsl(k >> 16 & 255, k >> 8 & 255, k & 255) })).sort((a, b) => b.c - a.c);
    const anchor = entries[0].hsl;
    const swatches = entries.slice(0, SWATCH_N).sort((a, b) => a.hsl[0] - b.hsl[0] || a.hsl[2] - b.hsl[2]).map(({ k }) => rgbToHex(k >> 16 & 255, k >> 8 & 255, k & 255));
    return { anchor, swatches };
  })();
  _analysis.set(idleUrl, p);
  return p;
}
function xform([h, s, l], anchor, tH, tS) {
  const nh = ((h + (tH - anchor[0])) % 360 + 360) % 360;
  const ns = Math.min(1, Math.max(0, s + (tS - anchor[1])));
  return hslToRgb(nh, ns, l);
}
var _canvasCache = /* @__PURE__ */ new Map();
function recoloredCanvas(url, idleUrl, targetHex) {
  const key = `${url}#${idleUrl}#${targetHex}`;
  if (_canvasCache.has(key)) return _canvasCache.get(key);
  const p = (async () => {
    const [img, { anchor }] = await Promise.all([loadImage(url), analyze(idleUrl)]);
    const { cv, ctx, data } = pixels(img);
    if (anchor) {
      const [tH, tS] = rgbToHsl(...hexToRgb(targetHex));
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (!isMaterial(s, l)) continue;
        const [r, g, b] = xform([h, s, l], anchor, tH, tS);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
      ctx.putImageData(data, 0, 0);
    }
    return cv;
  })();
  _canvasCache.set(key, p);
  return p;
}
async function recoloredTexture(Texture, url, idleUrl, targetHex) {
  const cv = targetHex ? await recoloredCanvas(url, idleUrl, targetHex) : await loadImage(url);
  const t = Texture.from(cv);
  t.source.scaleMode = "nearest";
  return t;
}

// ../auto-battler/src/render/spriteSheet.js
var SHEET_ROWS = 4;
var cellOf = (height) => Math.round(height / SHEET_ROWS);
function sliceGridWith(pixi, texture, cell = cellOf(texture.source.height)) {
  const { Texture, Rectangle } = pixi;
  const src = texture.source;
  const rows = Math.max(1, Math.round(src.height / cell));
  const cols = Math.max(1, Math.round(src.width / cell));
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_2, c) => new Texture({ source: src, frame: new Rectangle(c * cell, r * cell, cell, cell) })));
}
var ANIM = { idle: 0.12, walk: 0.18, attack: 0.3, dmg: 0.25, die: 0.28 };
var ROW_FOR = { "front-right": 0, "front-left": 1, "back-right": 2, "back-left": 3 };
var rowFor = (grid, facing) => grid[ROW_FOR[facing]] ?? grid[0];
var facingFor = (faceX, faceY) => (faceY < 0 ? "back" : "front") + "-" + (faceX < 0 ? "left" : "right");

// ../auto-battler/src/render/combatRenderer.js
var COND_ICON = {
  bleeding: "bleeding",
  poison: "poison",
  burning: "burning",
  deepWound: "deep-wound",
  disease: "disease",
  dazed: "dazed",
  crippled: "crippled",
  weakness: "weakness",
  blind: "blind",
  crackedArmor: "cracked-armor"
};
var COND_STATUS = {
  bleeding: "bleeding",
  poison: "poison",
  burning: "fire",
  disease: "sickness",
  deepWound: "petrification",
  dazed: "stun",
  crippled: "ice",
  weakness: "nature",
  blind: "fear",
  crackedArmor: "shock"
};
var COND_PRIORITY = ["deepWound", "burning", "poison", "bleeding", "disease", "dazed", "crippled", "blind", "crackedArmor", "weakness"];
var OUT_OFF = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
var MAT_RED = [0, 0, 0, 0, 0.86, 0, 0, 0, 0, 0.12, 0, 0, 0, 0, 0.12, 0, 0, 0, 1, 0];
var MAT_YELLOW = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0.84, 0, 0, 0, 0, 0.1, 0, 0, 0, 1, 0];
var GOLD = 16767050;
var BAR_TOP = 3;
var GHOST_HOLD = 220;
var GHOST_TAU = 150;
var GHOST_FADE = 400;
var ICON_SIZE = 18;
var _footCache = /* @__PURE__ */ new Map();
async function footFracOf(url) {
  if (!url) return 1;
  if (_footCache.has(url)) return _footCache.get(url);
  try {
    const img = await new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = no;
      i.src = url;
    });
    const cell = Math.round(img.naturalHeight / 4);
    const cv = document.createElement("canvas");
    cv.width = cell;
    cv.height = cell;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cell, cell, 0, 0, cell, cell);
    const d = ctx.getImageData(0, 0, cell, cell).data;
    let bottom = cell - 1;
    for (let y = cell - 1; y >= 0; y--) {
      let any = false;
      for (let x = 0; x < cell; x++) if (d[(y * cell + x) * 4 + 3] > 16) {
        any = true;
        break;
      }
      if (any) {
        bottom = y;
        break;
      }
    }
    const frac = Math.min(1, (bottom + 1.5) / cell);
    _footCache.set(url, frac);
    return frac;
  } catch {
    return 1;
  }
}
var facingOf = (a) => facingFor(a.faceX, a.faceY);
async function createCombatRenderer({ pixi, defsById = {}, layers, coords, getBattle }) {
  const { Assets, Texture, Rectangle, AnimatedSprite, Sprite, Container, Graphics, Text, ColorMatrixFilter } = pixi;
  const sliceGrid = (texture, cell) => sliceGridWith({ Texture, Rectangle }, texture, cell);
  const rowFramesH = (texture, cell) => {
    const src = texture.source;
    const cols = Math.max(1, Math.round(src.width / cell));
    const h = Math.min(cell, src.height);
    return Array.from({ length: cols }, (_, c) => new Texture({ source: src, frame: new Rectangle(c * cell, 0, cell, h) }));
  };
  const { units, fx, projLayer } = layers;
  const { mapX, mapY, depthOf } = coords;
  const actorOf = (id) => getBattle()?.actors.find((x) => x.id === id);
  const floats = [];
  const sheetsById = {};
  async function loadSheets(id, def) {
    if (!def?.idle) {
      sheetsById[id] = null;
      return;
    }
    try {
      const load = (url) => url ? recoloredTexture(Texture, url, def.idle, def.recolor) : null;
      const [idle, walk, attack, dmg, die] = await Promise.all([
        load(def.idle),
        load(def.walk),
        load(def.attack),
        load(def.dmg),
        load(def.die)
      ]);
      for (const tx of [idle, walk, attack, dmg, die]) if (tx) tx.source.scaleMode = "nearest";
      const cell = Math.round(idle.source.height / 4);
      sheetsById[id] = {
        idle: sliceGrid(idle, cell),
        walk: walk ? sliceGrid(walk, cell) : sliceGrid(idle, cell),
        attack: attack ? sliceGrid(attack, cell) : sliceGrid(idle, cell),
        dmg: dmg ? sliceGrid(dmg, cell) : null,
        die: die ? sliceGrid(die, cell) : null,
        cell,
        footFrac: await footFracOf(def.idle)
      };
    } catch {
      sheetsById[id] = null;
    }
  }
  for (const [id, def] of Object.entries(defsById)) await loadSheets(id, def);
  const skillIcons = {};
  for (const s of CB_SKILLS) {
    try {
      const t = await Assets.load(iconUrl(s.id));
      t.source.scaleMode = "linear";
      skillIcons[s.id] = t;
    } catch {
    }
  }
  const condIcons = {};
  for (const [type, file] of Object.entries(COND_ICON)) {
    try {
      const t = await Assets.load(`/gw/icons/condition-${file}.jpg`);
      t.source.scaleMode = "linear";
      condIcons[type] = t;
    } catch {
    }
  }
  const condFrames = {};
  try {
    const catalogue = await fetch("/assets/effects.json").then((r) => r.json()).then((d) => d.effects || []);
    const byKey = Object.fromEntries(catalogue.filter((e) => e.category === "status").map((e) => [e.key, e]));
    for (const [type, statusKey] of Object.entries(COND_STATUS)) {
      const e = byKey[statusKey];
      if (!e) continue;
      try {
        const t = await Assets.load(e.url);
        t.source.scaleMode = "nearest";
        condFrames[type] = rowFramesH(t, e.cell || t.source.height);
      } catch {
      }
    }
  } catch {
  }
  const skillPlay = {};
  async function buildSkillPlay(id, def) {
    const cell = sheetsById[id]?.cell;
    const map = {};
    for (const [skillId, fxCfg] of Object.entries(def.skillFx || {})) {
      let animGrid = null;
      if (fxCfg.animUrl && cell) {
        try {
          const t = await recoloredTexture(Texture, fxCfg.animUrl, def.idle, def.recolor);
          animGrid = sliceGrid(t, cell);
        } catch {
        }
      }
      const effects = [];
      for (const ef of fxCfg.effects || []) {
        try {
          const t = await Assets.load(ef.url);
          t.source.scaleMode = "nearest";
          effects.push(sliceGrid(t, ef.cell || 32)[0]);
        } catch {
        }
      }
      map[skillId] = { animGrid, effects };
    }
    skillPlay[id] = map;
  }
  for (const [id, def] of Object.entries(defsById)) await buildSkillPlay(id, def);
  const view = {};
  function buildView(id, def) {
    const sh = sheetsById[id];
    const c = new Container();
    let sp;
    if (sh) {
      sp = new AnimatedSprite(rowFor(sh.idle, "front-right"));
      sp.anchor.set(0.5, sh.footFrac ?? 1);
      sp.animationSpeed = ANIM.idle;
      sp.play();
    } else {
      sp = new Container();
      const g = new Graphics();
      g.circle(0, -16, 16).fill(def?.color || 8947848);
      const t = new Text({ text: (def?.name || "?")[0], style: { fill: 16777215, fontSize: 15, fontWeight: "700" } });
      t.anchor.set(0.5);
      t.y = -16;
      sp.addChild(g, t);
    }
    const bars = new Graphics();
    const status = new Container();
    const overlay = new AnimatedSprite([Texture.EMPTY]);
    overlay.anchor.set(0.5, sh?.footFrac ?? 1);
    overlay.visible = false;
    overlay.loop = true;
    overlay.animationSpeed = 0.15;
    const makeOutline = (matrix) => {
      if (!sh) return null;
      const o = { container: new Container(), copies: [] };
      const filter = new ColorMatrixFilter();
      filter.matrix = matrix;
      o.container.filters = [filter];
      o.container.visible = false;
      o.container.alpha = 0.75;
      for (let i = 0; i < OUT_OFF.length; i++) {
        const s = new Sprite(Texture.EMPTY);
        s.anchor.set(0.5, sh.footFrac ?? 1);
        o.container.addChild(s);
        o.copies.push(s);
      }
      return o;
    };
    const castOutline = makeOutline(MAT_YELLOW);
    const outline = makeOutline(MAT_RED);
    if (castOutline) c.addChild(castOutline.container);
    if (outline) c.addChild(outline.container);
    c.addChild(sp, overlay, bars, status);
    units.addChild(c);
    view[id] = { def, sheets: sh, container: c, sprite: sp, overlay, overlayKey: null, bars, status, statusSprites: {}, outline, castOutline, mode: null, facing: null, flash: 0, dead: false };
  }
  for (const [id, def] of Object.entries(defsById)) buildView(id, def);
  async function addActor(id, def) {
    if (view[id]) return view[id];
    defsById[id] = def;
    await loadSheets(id, def);
    await buildSkillPlay(id, def);
    buildView(id, def);
    return view[id];
  }
  function removeActor(id) {
    const v = view[id];
    if (!v) return;
    units.removeChild(v.container);
    v.container.destroy({ children: true });
    delete view[id];
    delete sheetsById[id];
    delete skillPlay[id];
    delete defsById[id];
  }
  function setLoop(v, mode, facing) {
    if (v.mode === mode && v.facing === facing) return;
    v.mode = mode;
    v.facing = facing;
    v.sprite.textures = rowFor(v.sheets[mode], facing);
    v.sprite.loop = true;
    v.sprite.animationSpeed = ANIM[mode];
    v.sprite.play();
  }
  function playOnce(v, mode, facing, onDone, speedMul = 1) {
    v.mode = mode;
    v.facing = facing;
    v.sprite.onComplete = null;
    v.sprite.textures = rowFor(v.sheets[mode], facing);
    v.sprite.loop = false;
    v.sprite.animationSpeed = ANIM[mode] * speedMul;
    v.sprite.onComplete = () => {
      v.sprite.onComplete = null;
      onDone && onDone();
    };
    v.sprite.gotoAndPlay(0);
  }
  const resume = (v) => {
    v.mode = null;
  };
  function playAttack(id, a, onDone = null, speedMul = 1) {
    const v = view[id];
    if (!v?.sheets || v.dead) return;
    playOnce(v, "attack", facingOf(a), () => {
      resume(v);
      onDone && onDone();
    }, speedMul);
  }
  function playHurt(id, a) {
    const v = view[id];
    if (!v?.sheets?.dmg || v.dead || v.skillAnim || v.mode !== "idle") return;
    playOnce(v, "dmg", facingOf(a), () => resume(v));
  }
  function playDie(id, a) {
    const v = view[id];
    if (!v || v.dead) return;
    v.dead = true;
    v.mode = "die";
    const facing = facingOf(a);
    v.facing = facing;
    if (!v.sheets) return;
    const crumple = () => {
      if (!v.sheets.die) return;
      const frames = rowFor(v.sheets.die, facing);
      v.sprite.onComplete = null;
      v.sprite.textures = frames;
      v.sprite.loop = false;
      v.sprite.animationSpeed = ANIM.die * 0.75;
      v.sprite.onComplete = () => {
        v.sprite.onComplete = null;
        v.sprite.gotoAndStop(frames.length - 1);
      };
      v.sprite.gotoAndPlay(0);
    };
    if (v.sheets.dmg) {
      const hit = rowFor(v.sheets.dmg, facing);
      v.sprite.onComplete = null;
      v.sprite.textures = hit;
      v.sprite.loop = false;
      v.sprite.animationSpeed = ANIM.dmg;
      v.sprite.onComplete = () => {
        v.sprite.onComplete = null;
        crumple();
      };
      v.sprite.gotoAndPlay(0);
    } else crumple();
  }
  function playGridOnce(v, grid, { speedMul = 1, hold = false, onDone = null } = {}) {
    if (!grid || !v || v.dead) return false;
    v.mode = "attack";
    v.skillAnim = true;
    v.sprite.onComplete = null;
    v.sprite.textures = grid[0];
    v.sprite.loop = false;
    v.sprite.animationSpeed = ANIM.attack * speedMul;
    v.sprite.onComplete = () => {
      v.sprite.onComplete = null;
      if (hold) v.sprite.gotoAndStop(grid[0].length - 1);
      else {
        v.skillAnim = false;
        resume(v);
      }
      onDone && onDone();
    };
    v.sprite.gotoAndPlay(0);
    return true;
  }
  function spawnEffects(casterId, framesList) {
    const a = actorOf(casterId);
    const v = view[casterId];
    if (!a || !v || !framesList?.length) return;
    const cell = v.sheets?.cell ?? 24, ff = v.sheets?.footFrac ?? 1, depth = depthOf(a);
    const cx = mapX(a.x), cy = mapY(a.y) - (ff - 0.5) * cell * depth;
    for (const frames of framesList) {
      if (!frames?.length) continue;
      const s = new AnimatedSprite(frames);
      s.anchor.set(0.5);
      s.loop = false;
      s.animationSpeed = 0.3;
      s.scale.set(depth);
      s.position.set(cx, cy);
      s.onComplete = () => fx.removeChild(s);
      fx.addChild(s);
      s.gotoAndPlay(0);
    }
  }
  const headY = (id, a) => {
    const v = view[id], cell = v?.sheets?.cell ?? 24, ff = v?.sheets?.footFrac ?? 1;
    return mapY(a.y) - ff * cell * depthOf(a) - 2;
  };
  function floatText(id, text, color, opts = {}) {
    const a = actorOf(id);
    if (!a) return;
    const t = new Text({ text, style: { fill: color, fontSize: opts.big ? 20 : 14, fontFamily: "monospace", fontWeight: "700", stroke: opts.big ? { color: 2760448, width: 3 } : void 0 } });
    t.anchor.set(0.5);
    t.x = mapX(a.x) + (Math.random() * 20 - 10);
    t.y = headY(id, a) - (opts.big ? 6 : 0);
    fx.addChild(t);
    floats.push({ t, life: opts.big ? 1.25 : 1, max: opts.big ? 1.25 : 1 });
  }
  function floatIcon(id, skillId) {
    const a = actorOf(id);
    const tex = skillId && skillIcons[skillId];
    if (!a || !tex) return false;
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.width = ICON_SIZE;
    s.height = ICON_SIZE;
    s.x = mapX(a.x);
    s.y = headY(id, a) - 8;
    fx.addChild(s);
    floats.push({ t: s, life: 1.2, max: 1.2, icon: true, size: ICON_SIZE, who: id });
    return true;
  }
  function flagEmpower(id) {
    for (const f of floats) if (f.icon && f.who === id) {
      f.t.tint = GOLD;
      f.empower = true;
      f.size = ICON_SIZE + 6;
    }
    floatText(id, "\u26A1", GOLD);
  }
  function spawnEcho(id) {
    const a = actorOf(id), v = view[id];
    if (!a || !v?.sheets) return;
    const depth = depthOf(a);
    for (const cfg of [{ life: 0.55, scaleTo: 2.2, a0: 0.85 }, { life: 0.8, scaleTo: 3.1, a0: 0.55 }]) {
      const s = new Sprite(v.sprite.texture);
      s.anchor.set(0.5, v.sheets.footFrac ?? 1);
      s.tint = 10473727;
      s.x = mapX(a.x);
      s.y = mapY(a.y);
      fx.addChild(s);
      floats.push({ t: s, life: cfg.life, max: cfg.life, echo: true, baseScale: depth, scaleTo: cfg.scaleTo, alpha0: cfg.a0, dir: a.facing || 1 });
    }
  }
  function drawBars(id, a, dt, now) {
    const v = view[id];
    const g = v.bars;
    g.clear();
    const w = 40;
    const cur = Math.max(0, a.hp / a.baseMaxHp);
    if (v.hpGhost == null || cur >= v.hpGhost) {
      v.hpGhost = cur;
      v.hpLast = cur;
      v.hpGhostT = GHOST_HOLD;
    }
    if (cur < (v.hpLast ?? cur) - 8e-3) v.hpGhostT = 0;
    v.hpLast = cur;
    v.hpGhostT = (v.hpGhostT ?? GHOST_HOLD) + dt;
    if (v.hpGhost > cur && v.hpGhostT > GHOST_HOLD) {
      v.hpGhost = cur + (v.hpGhost - cur) * Math.max(0, 1 - dt / GHOST_TAU);
      if (v.hpGhost - cur < 4e-3) v.hpGhost = cur;
    }
    g.rect(-w / 2, BAR_TOP, w, 5).fill(1316897);
    if (v.hpGhost > cur + 1e-4) {
      const fade = v.hpGhostT <= GHOST_HOLD ? 1 : Math.max(0, 1 - (v.hpGhostT - GHOST_HOLD) / GHOST_FADE);
      g.rect(-w / 2 + 1 + (w - 2) * cur, BAR_TOP + 1, (w - 2) * (v.hpGhost - cur), 3).fill({ color: 16777215, alpha: 0.85 * fade });
    }
    g.rect(-w / 2 + 1, BAR_TOP + 1, (w - 2) * cur, 3).fill(cur > 0.4 ? 12113482 : 14165786);
    const res = a.profession === "Warrior" ? a.adrenaline / 25 : a.energy / a.maxEnergy;
    g.rect(-w / 2, BAR_TOP + 6, w, 3).fill(1316897);
    g.rect(-w / 2 + 1, BAR_TOP + 7, (w - 2) * Math.max(0, Math.min(1, res)), 1.5).fill(a.profession === "Warrior" ? 15247146 : 3832997);
    const mark = Object.values(a.marks || {}).find((m) => m && m.until > now);
    if (mark) for (let i = 0; i < (mark.stage === "offhand" ? 2 : 1); i++) g.circle(w / 2 - 2 - i * 3, BAR_TOP - 2, 1.3).fill(16767050);
    const headRel = -((v.sheets?.footFrac ?? 1) * (v.sheets?.cell ?? 24) * depthOf(a)) - 4;
    if (a.kd > now) {
      const cy = headRel + 2;
      for (let i = 0; i < 3; i++) {
        const ang = now * 6 + i * 2 * Math.PI / 3;
        g.circle(Math.cos(ang) * 6, cy + Math.sin(ang) * 2.2, 1.5).fill(16110658);
      }
    }
    if (a.casting && a.casting.skill) {
      const total = a.casting.skill.cast || 1;
      const prog = Math.max(0, Math.min(1, 1 - (a.casting.left ?? 0) / total));
      g.rect(-11, headRel, 22, 3).fill(1316897);
      g.rect(-10, headRel + 0.75, 20 * prog, 1.5).fill(7325664);
    }
  }
  function drawStatus(id, a, t, depth) {
    const v = view[id];
    const active = a.conds.filter((c) => c.until > t && condIcons[c.type]);
    const sz = 11, gap = 2, totalW = active.length * sz + Math.max(0, active.length - 1) * gap;
    active.forEach((c, i) => {
      let s = v.statusSprites[c.type];
      if (!s) {
        s = new Sprite(condIcons[c.type]);
        s.anchor.set(0.5);
        s.width = sz;
        s.height = sz;
        v.status.addChild(s);
        v.statusSprites[c.type] = s;
      }
      s.x = -totalW / 2 + sz / 2 + i * (sz + gap);
      s.y = BAR_TOP + 15;
      const left = c.until - t;
      s.visible = left >= 1.2 || Math.floor(t * 6) % 2 === 0;
    });
    for (const type in v.statusSprites) if (!active.find((c) => c.type === type)) v.statusSprites[type].visible = false;
    let key = null;
    if (!v.dead) {
      for (const type of COND_PRIORITY) if (condFrames[type] && active.some((c) => c.type === type)) {
        key = type;
        break;
      }
    }
    if (key !== v.overlayKey) {
      v.overlayKey = key;
      if (key) {
        v.overlay.textures = condFrames[key];
        v.overlay.visible = true;
        v.overlay.gotoAndPlay(0);
      } else {
        v.overlay.visible = false;
      }
    }
    if (key) v.overlay.scale.set(depth);
  }
  function resetForNewBattle() {
    for (const id in view) {
      const v = view[id];
      v.dead = false;
      v.mode = null;
      v.facing = null;
      v.flash = 0;
      v.skillAnim = false;
      for (const k in v.statusSprites) v.statusSprites[k].visible = false;
      v.overlay.visible = false;
      v.overlayKey = null;
      if (v.sheets) {
        v.sprite.onComplete = null;
        v.sprite.tint = 16777215;
        v.sprite.alpha = 1;
      }
    }
  }
  function syncActors(b, dtMS, now, { cine = null, cineDim = 0, cineCfg = {} } = {}) {
    for (const a of b.actors) {
      const v = view[a.id];
      if (!v) continue;
      v.container.x = mapX(a.x);
      v.container.y = mapY(a.y);
      if (cine?.hit && a.id === cine.targetId && !v.dead) {
        v.container.x += (Math.random() * 2 - 1) * 2.5;
        v.container.y += (Math.random() * 2 - 1) * 2.5;
      }
      v.container.zIndex = a.y;
      const depth = depthOf(a);
      const dimmed = cine && cine.freeze && cineCfg.dim !== false && a.id !== cine.casterId && a.id !== cine.targetId;
      const dimTint = () => {
        const g = Math.round(255 * (1 - cineDim * 0.5));
        return g << 16 | g << 8 | g;
      };
      if (v.sheets) {
        v.sprite.scale.set(depth);
        if (v.dead) {
          v.sprite.tint = dimmed ? dimTint() : 16777215;
          v.sprite.alpha = 0.9;
        } else {
          if (v.mode !== "attack" && v.mode !== "dmg") {
            setLoop(v, a.moving ? "walk" : "idle", facingOf(a));
          }
          v.flash = Math.max(0, v.flash - dtMS);
          v.sprite.tint = dimmed ? dimTint() : v.flash > 0 && !v.skillAnim ? 16738922 : 16777215;
          v.sprite.alpha = 1;
        }
      } else {
        v.sprite.scale.set(1);
        v.sprite.alpha = a.alive ? 1 : 0.32;
      }
      drawBars(a.id, a, dtMS, b.t);
      drawStatus(a.id, a, b.t, depth);
    }
  }
  function updateFloats(dtMS) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dtMS / 1e3;
      const age = f.max - f.life;
      if (f.echo) {
        const p = Math.min(1, age / f.max);
        const sc = f.baseScale * (1 + (f.scaleTo - 1) * p);
        f.t.scale.set(sc * (f.dir < 0 ? -1 : 1), sc);
        f.t.alpha = f.alpha0 * (1 - p);
      } else {
        f.t.y -= dtMS * 0.022;
        const fin = Math.min(1, age / 0.18), fout = Math.min(1, f.life / 0.35);
        f.t.alpha = Math.max(0, Math.min(fin, fout));
        if (f.icon) {
          const sz = f.size * (0.6 + 0.4 * fin);
          f.t.width = sz;
          f.t.height = sz;
        }
      }
      if (f.life <= 0) {
        fx.removeChild(f.t);
        floats.splice(i, 1);
      }
    }
  }
  function drawProjectiles(b) {
    projLayer.clear();
    for (const p of b.projectiles) {
      const frac = Math.max(0, Math.min(1, (b.t - p.bornT) / (p.hitT - p.bornT)));
      const px = mapX(p.fromX + (p.aimX - p.fromX) * frac);
      const py = mapY(p.fromY + (p.aimY - p.fromY) * frac) - 26;
      projLayer.circle(px, py, 4).fill(15786176).stroke({ width: 1, color: 2764602 });
    }
  }
  function processLog(b, r, hooks = {}) {
    const log2 = b.log;
    for (; r.logIdx < log2.length; r.logIdx++) {
      const e = log2[r.logIdx];
      if (e.kind === "cast") {
        const h = hooks.onCast?.(e) || {};
        if (h.break) {
          r.logIdx++;
          return;
        }
        const v = view[e.who], a = actorOf(e.who), play = skillPlay[e.who]?.[e.skillId];
        if (!h.skipInline) {
          if (v && a) {
            if (!playGridOnce(v, play?.animGrid)) playAttack(e.who, a);
            spawnEffects(e.who, play?.effects);
          }
          if (!floatIcon(e.who, e.skillId)) floatText(e.who, e.name + (e.elite ? " \u2605" : ""), 16769357);
          if (e.combo === "dual") floatText(e.who, "\u2726", GOLD);
        }
      } else if (e.kind === "swing") {
        if (!e.skillId) playAttack(e.who, actorOf(e.who));
      } else if (e.kind === "shoot") {
        if (!e.skillId) playAttack(e.who, actorOf(e.who));
      } else if (e.kind === "hit" && e.amount > 0) {
        const v = view[e.who];
        if (v) v.flash = 130;
        playHurt(e.who, actorOf(e.who));
        hooks.onHit?.(e);
        e.empowered ? floatText(e.who, "-" + e.amount + "!", GOLD, { big: true }) : floatText(e.who, "-" + e.amount, 16743018);
      } else if (e.kind === "heal" && e.amount > 0) e.empowered ? floatText(e.who, "+" + e.amount + "!", GOLD, { big: true }) : floatText(e.who, "+" + e.amount, 9429896);
      else if (e.kind === "cond" && e.empowered) floatText(e.who, (e.cond === "interrupted" ? "INTERRUPT" : String(e.cond).toUpperCase()) + "!", GOLD, { big: true });
      else if (e.kind === "empower") flagEmpower(e.who);
      else if (e.kind === "miss") floatText(e.who, "dodge", 10405352);
      else if (e.kind === "death") {
        playDie(e.who, actorOf(e.who));
        hooks.onDeath?.(e);
      }
    }
  }
  return {
    view,
    floats,
    actorOf,
    skillPlay,
    addActor,
    removeActor,
    setLoop,
    playOnce,
    resume,
    playAttack,
    playHurt,
    playDie,
    playGridOnce,
    spawnEffects,
    floatText,
    floatIcon,
    flagEmpower,
    spawnEcho,
    drawBars,
    drawStatus,
    resetForNewBattle,
    syncActors,
    updateFloats,
    drawProjectiles,
    processLog
  };
}

// ../auto-battler/src/render/sandboxStage.js
var C_BASIC = 16777215;
var C_SKILL = 15774761;
var STEP = 0.05;
var MAT_WHITE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
var MAT_AMBER = [0, 0, 0, 0, 0.94, 0, 0, 0, 0, 0.71, 0, 0, 0, 0, 0.16, 0, 0, 0, 1, 0];
var OUT_OFF2 = [[-3, 0], [3, 0], [0, -3], [0, 3], [-3, -3], [3, -3], [-3, 3], [3, 3]];
function mountSandboxStage(pixi, stageEl, ctx) {
  const { Application, Sprite, Graphics, Text, Container, ColorMatrixFilter, Texture } = pixi;
  const { input, state } = ctx;
  let currentApp = null;
  let token = 0;
  const killApp = () => {
    if (currentApp) {
      try {
        currentApp.destroy({ removeView: true });
      } catch {
      }
      currentApp = null;
    }
  };
  function rebuild(buildBattle) {
    const myToken = ++token;
    killApp();
    stageEl.replaceChildren();
    const built = buildBattle();
    if (!built) return;
    const { battle, defsById } = built;
    const app = new Application();
    app.init({ background: 15524556, antialias: false, resizeTo: stageEl }).then(async () => {
      if (myToken !== token) {
        app.destroy({ removeView: true });
        return;
      }
      stageEl.appendChild(app.canvas);
      if (ctx.canvasTestId) app.canvas.setAttribute("data-testid", ctx.canvasTestId);
      currentApp = app;
      const W = app.screen.width, H = app.screen.height;
      const sx = W / FIELD.w, sy = H / FIELD.h;
      const mapX = (x) => x * sx, mapY = (y) => y * sy;
      const depthOf = (a) => Math.min(Math.max(W / 190, 1.6), 3) * (0.85 + 0.4 * (a.y / FIELD.h));
      const ranges = new Graphics();
      app.stage.addChild(ranges);
      const outlineLayer = new Container();
      app.stage.addChild(outlineLayer);
      const units = new Container();
      units.sortableChildren = true;
      app.stage.addChild(units);
      const projLayer = new Graphics();
      app.stage.addChild(projLayer);
      const fxLayer = new Container();
      app.stage.addChild(fxLayer);
      const chromeLayer = new Container();
      app.stage.addChild(chromeLayer);
      const p0 = battle.actors.find((a) => a.id === "P0");
      if (p0) {
        p0.attackTimer = 0;
        if (state.pos) {
          p0.x = state.pos.x;
          p0.y = state.pos.y;
        }
      }
      const R = await createCombatRenderer({ pixi, defsById, layers: { units, fx: fxLayer, projLayer }, coords: { mapX, mapY, depthOf }, getBattle: () => battle });
      if (myToken !== token) {
        app.destroy({ removeView: true });
        return;
      }
      const outlines = ["E0", "E1", "E2"].map(() => {
        const c = new Container();
        const filter = new ColorMatrixFilter();
        filter.matrix = MAT_WHITE;
        c.filters = [filter];
        c.visible = false;
        const copies = OUT_OFF2.map(() => {
          const s = new Sprite(Texture.EMPTY);
          s.anchor.set(0.5, R.view.E0?.sheets?.footFrac ?? 0.5);
          return s;
        });
        copies.forEach((s) => c.addChild(s));
        outlineLayer.addChild(c);
        return { c, filter, copies };
      });
      const reticles = new Graphics();
      chromeLayer.addChild(reticles);
      const hud = new Text({ text: "", style: { fill: 2765632, fontSize: 13, fontFamily: "monospace", lineHeight: 18 } });
      hud.position.set(12, 10);
      chromeLayer.addChild(hud);
      const cursor = { logIdx: 0 };
      let acc = 0;
      const foeActor = (i) => battle.actors.find((a) => a.id === "E" + i);
      const NAME = ctx.targetName || "foe";
      app.ticker.add((t) => {
        if (myToken !== token) return;
        const dtMS = t.deltaMS, dt = dtMS / 1e3;
        const player = battle.actors.find((a) => a.id === "P0");
        const tg = ctx.targeting();
        const selectedSkillId = ctx.getSelectedSkillId();
        const nearestFoeGw = [0, 1, 2].map(foeActor).filter((a) => a && a.alive).reduce((m, a) => Math.min(m, Math.hypot(a.x - (player?.x ?? 0), a.y - (player?.y ?? 0))), Infinity);
        setInput(battle, "P0", { moveX: input.keys.x, moveY: input.keys.y });
        if (input.req.attack) {
          input.req.attack = false;
          if (nearestFoeGw <= tg.basicGw) setInput(battle, "P0", { action: "basic" });
        }
        if (input.req.skill) {
          input.req.skill = false;
          if (selectedSkillId && (tg.skillSupport || tg.skillGw != null && nearestFoeGw <= tg.skillGw)) setInput(battle, "P0", { action: selectedSkillId });
        }
        if (input.req.reset) {
          input.req.reset = false;
          for (const a of battle.actors) if (a.control === "dummy") {
            a.alive = true;
            a.hp = a.maxHp = a.baseMaxHp;
            a.conds = [];
            a.marks = {};
            a.mods = [];
            a.casting = null;
            a.kd = 0;
            a.deadAt = null;
          }
          battle.log.length = 0;
          cursor.logIdx = 0;
          R.resetForNewBattle();
          state.targetId = null;
        }
        acc += Math.min(dt, 0.1);
        while (acc >= STEP) {
          step(battle, STEP);
          acc -= STEP;
        }
        if (player) state.pos = { x: player.x, y: player.y };
        R.syncActors(battle, dtMS, battle.t);
        R.updateFloats(dtMS);
        R.drawProjectiles(battle);
        R.processLog(battle, cursor);
        const { basicGw, skillGw } = tg;
        const px = mapX(player?.x ?? 0), py = mapY(player?.y ?? 0);
        ranges.clear();
        ranges.ellipse(px, py, basicGw * sx, basicGw * sy).fill({ color: C_BASIC, alpha: 0.05 });
        if (skillGw != null) ranges.ellipse(px, py, skillGw * sx, skillGw * sy).stroke({ width: 2, color: C_SKILL, alpha: 0.6 });
        ranges.ellipse(px, py, basicGw * sx, basicGw * sy).stroke({ width: 2, color: C_BASIC, alpha: 0.55 });
        const targetable = [];
        const infoArr = [0, 1, 2].map((i) => {
          const a = foeActor(i);
          if (!a) return null;
          const d = a.alive ? Math.hypot(a.x - (player?.x ?? 0), a.y - (player?.y ?? 0)) : Infinity;
          const inBasic = a.alive && d <= basicGw, inSkill = a.alive && skillGw != null && d <= skillGw;
          if (inBasic || inSkill) targetable.push(i);
          return { a, d, inBasic, inSkill };
        });
        if (input.req.f) {
          input.req.f = false;
          if (targetable.length) {
            const at = targetable.indexOf(state.targetId);
            state.targetId = targetable[(at + 1) % targetable.length];
          }
        }
        let cur = state.targetId;
        if (cur == null || !targetable.includes(cur)) cur = targetable.length ? targetable.reduce((b, i) => infoArr[i].d < infoArr[b].d ? i : b, targetable[0]) : null;
        state.targetId = cur;
        reticles.clear();
        infoArr.forEach((it, i) => {
          const o = outlines[i];
          if (!it) {
            o.c.visible = false;
            return;
          }
          const v = R.view["E" + i];
          const show = it.inBasic || it.inSkill;
          o.c.visible = show;
          if (show && v?.sprite) {
            o.filter.matrix = it.inSkill ? MAT_AMBER : MAT_WHITE;
            o.c.alpha = i === cur ? 1 : 0.55;
            const ax = mapX(it.a.x), ay = mapY(it.a.y);
            o.copies.forEach((s, k) => {
              s.texture = v.sprite.texture;
              s.scale.copyFrom(v.sprite.scale);
              s.position.set(ax + OUT_OFF2[k][0], ay + OUT_OFF2[k][1]);
            });
          }
          if (i === cur && it.a.alive) {
            const ax = mapX(it.a.x), top = mapY(it.a.y) - (v?.sheets ? v.sheets.footFrac * v.sheets.cell * depthOf(it.a) : 40) - 8;
            reticles.moveTo(ax, top + 6).lineTo(ax - 6, top - 3).lineTo(ax + 6, top - 3).fill({ color: it.inSkill ? C_SKILL : C_BASIC });
          }
        });
        const aliveN = [0, 1, 2].filter((i) => foeActor(i)?.alive).length;
        const tInfo = cur != null ? infoArr[cur] : null;
        hud.text = tInfo ? `Target: ${NAME} ${cur + 1}  \xB7  ${Math.round(tInfo.d)} gw  \xB7  ${Math.max(0, Math.round(tInfo.a.hp))}/${Math.round(tInfo.a.baseMaxHp)} hp
${tInfo.inSkill ? "\u25C6 in skill range" : "\u25C7 basic-attack range"}
F cycle target (${targetable.length} in range) \xB7 \` reset` : `${aliveN ? `No ${NAME.toLowerCase()} in range \u2014 move closer (WASD)` : `All ${NAME.toLowerCase()}s down \u2014 \` to reset`}
F cycle target \xB7 \` reset`;
      });
    });
  }
  return { rebuild, destroy() {
    token++;
    killApp();
  } };
}

// ../auto-battler/src/render/enemiesSandbox.js
var ATTACK_TYPES = ["melee", "ranged"];
var ENEMY_ACCENT = "#b5532e";
var TARGET_SLUG = "rts-humans-worker";
var ACO_MAXHP = 80;
var DEF_BASIC_DMG = 18;
var DEF_SKILL_DMG = 30;
var MELEE_CATS = /* @__PURE__ */ new Set(["melee_attack", "lead_attack", "offhand_attack", "dual_attack", "scythe_attack"]);
var RANGED_CATS = /* @__PURE__ */ new Set(["bow_attack", "spear_attack"]);
var STAT_FIELDS = [
  { key: "hp", label: "Health", def: 100 },
  { key: "armor", label: "Armor", def: 60 },
  { key: "basicDamage", label: "Basic dmg", def: DEF_BASIC_DMG },
  { key: "skillDamage", label: "Skill dmg", def: DEF_SKILL_DMG }
];
var SKILL_PROFESSIONS = PROFESSION_BY_ID.filter((p) => CB_SKILLS.some((s) => s.profession === p));
function skillRangeGw(skill) {
  if (!skill) return null;
  if (MELEE_CATS.has(skill.category)) return MELEE_GW;
  if (RANGED_CATS.has(skill.category)) return BOW_GW;
  return skill.target == null || /foe/.test(skill.target) ? SPELL_GW : null;
}
var flatChars = (packs) => (packs || []).flatMap((p) => p.characters || []).filter((c) => c.idle && c.walk);
var slugify = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "enemy";
function el(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) if (kid != null) n.append(kid);
  return n;
}
function renderSkillDetail(skill) {
  if (!skill) return null;
  const c = skill.cost || {};
  const chips = [];
  if (c.energy) chips.push({ glyph: COST_GLYPH.energy, text: c.energy, tone: "energy" });
  if (c.adrenaline) chips.push({ glyph: COST_GLYPH.adrenaline, text: c.adrenaline, tone: "adrenaline" });
  if (c.sacrifice) chips.push({ glyph: COST_GLYPH.sacrifice, text: `${c.sacrifice}%`, tone: "sacrifice" });
  if (skill.cast) chips.push({ glyph: COST_GLYPH.activation, text: `${skill.cast}s`, tone: "time" });
  if (skill.recharge) chips.push({ glyph: COST_GLYPH.recharge, text: `${skill.recharge}s`, tone: "time" });
  const reqs = skill.requires || [];
  const onHit = reqs.includes("on_hit");
  const gates = reqs.filter((r) => r !== "on_hit");
  return el("div", { class: "cbgame-skill-detail", "data-testid": "cbgame-skill-detail" }, [
    el("div", { class: "cbgame-skill-detail-head" }, [
      el("img", { src: iconUrl(skill.id), alt: "", class: `cbgame-skill-detail-icon${skill.elite ? " elite" : ""}`, width: 38, height: 38 }),
      el("div", { class: "cbgame-skill-detail-title" }, [
        el("div", { class: "cbgame-skill-detail-name" }, skill.name + (skill.elite ? " \u2605" : "")),
        el("div", { class: "cbgame-skill-detail-meta" }, [
          el("span", {}, skill.category.replace(/_/g, " ")),
          el("span", { class: "dot" }, "\xB7"),
          el("span", {}, skill.attribute),
          skill.target ? el("span", { class: "cbgame-skill-target" }, skill.target) : null
        ])
      ])
    ]),
    chips.length ? el("div", { class: "cbgame-skill-stats" }, chips.map((ch) => el("span", { class: `cbgame-skill-stat tone-${ch.tone}` }, [el("img", { src: ch.glyph, alt: "", width: 13, height: 13 }), String(ch.text)]))) : null,
    onHit || gates.length ? el("div", { class: "cbgame-skill-triggers" }, [
      onHit ? el("span", { class: "cbgame-skill-trigger" }, "\u2694 On hit") : null,
      ...gates.map((g) => el("span", { class: "cbgame-skill-trigger" }, "\u21B3 " + req(g)))
    ]) : null,
    el("div", { class: "cbgame-skill-fx" }, (skill.effects || []).map((e) => {
      const { color, label } = effectStyle(e);
      const isCond = effectKind(e) === "condition";
      return el("div", { class: "cbgame-skill-fx-row", style: { "--fx": color } }, [
        isCond ? el("img", { class: "cbgame-skill-fx-cond", src: conditionIcon(e.condition), alt: "", width: 16, height: 16 }) : el("span", { class: "cbgame-skill-fx-tag" }, label),
        el("span", { class: "cbgame-skill-fx-text" }, effect(e))
      ]);
    }))
  ]);
}
function mountEnemiesSandbox(pixi, host, opts = {}) {
  const packs = opts.packs || [];
  const fx = opts.fx || [];
  const editable = !!opts.editable;
  let config = opts.config && opts.config.enemies ? opts.config : { enemies: {} };
  const chars = flatChars(packs);
  let active = opts.selected && config.enemies?.[opts.selected] && opts.selected || Object.keys(config.enemies || {})[0] || null;
  let selectedSkillId = null;
  let skillFilter = "All";
  const keys = { x: 0, y: 0 };
  const req2 = { attack: false, skill: false, f: false, reset: false };
  const stageState = { pos: null, targetId: null };
  let targeting = { basicGw: MELEE_GW, skillGw: null };
  const enemyIds = () => Object.keys(config.enemies || {});
  const enemyOf = () => config.enemies?.[active] || {};
  const accentOf = () => enemyOf().color || ENEMY_ACCENT;
  const activeCharOf = () => chars.find((c) => c.slug === enemyOf().sprite) || chars[0] || null;
  const attackTypeOf = () => enemyOf().attackType || "melee";
  const statsOf = () => enemyOf().stats || {};
  const enemySkillIdsOf = () => enemyOf().skills || [];
  const enemySkillsOf = () => enemySkillIdsOf().map((id) => CB_SKILLS.find((s) => s.id === id)).filter(Boolean);
  const selectedSkillOf = () => enemySkillsOf().find((s) => s.id === selectedSkillId) || null;
  const animsOf = (ch) => {
    if (!ch) return [];
    const list = [];
    if (ch.attack) list.push({ key: "attack", name: "Attack", url: ch.attack, effect: ch.attackEffect || null });
    if (ch.jump) list.push({ key: "jump", name: "Jump", url: ch.jump, effect: null });
    for (const e of ch.extras || []) list.push({ key: e.key, name: e.name, url: e.url, effect: e.effect || null });
    return list;
  };
  const attackArcs = fx.filter((e) => e.category === "attack");
  const weaponArcs = fx.filter((e) => e.category === "weapon");
  const specialFx = fx.filter((e) => e.category === "special");
  const arrowVariants = fx.filter((e) => e.category === "projectile");
  const arcTypes = [...new Set(attackArcs.map((e) => e.type))];
  const weaponFamilies = [...new Set(weaponArcs.map((e) => e.label.includes(" \xB7 ") ? e.label.split(" \xB7 ")[0] : "legendary"))];
  const effectByKey = /* @__PURE__ */ new Map();
  for (const e of fx) if (e.category === "attack" || e.category === "weapon" || e.category === "special") effectByKey.set(e.key, e);
  const resolveAnim = (anims, key) => anims.find((a) => a.key === key) || anims[0] || null;
  const resolveEffectUrls = (animObj, list) => [...new Set((list || []).map((k) => k === "auto" ? animObj?.effect || null : effectByKey.get(k)?.url || null).filter(Boolean))];
  const stackOf = (cfg, key) => {
    if (Array.isArray(cfg?.[key])) return cfg[key].filter((k) => k && k !== "none");
    const single = cfg?.[key.replace(/s$/, "")];
    if (single === void 0 || single === null) return ["auto"];
    return single === "none" ? [] : [single];
  };
  function persist(next) {
    config = next;
    opts.onSave?.(next);
  }
  function save(next) {
    persist(next);
    syncTargeting();
    renderRoster();
    renderControls();
    renderSkills();
    renderCustomize();
    rebuildScene();
  }
  const updateEnemy = (patch) => save({ ...config, enemies: { ...config.enemies, [active]: { ...config.enemies?.[active] || {}, ...patch } } });
  const updateStats = (patch) => updateEnemy({ stats: { ...enemyOf().stats || {}, ...patch } });
  const updateSkillCfg = (id, patch) => updateEnemy({ skillCfg: { ...enemyOf().skillCfg || {}, [id]: { ...enemyOf().skillCfg?.[id] || {}, ...patch } } });
  function addEnemy() {
    if (!editable) return;
    const name = prompt("Enemy name?");
    if (!name) return;
    let id = slugify(name);
    let n = 2;
    while (config.enemies?.[id]) id = `${slugify(name)}-${n++}`;
    const def = { name, sprite: chars[0]?.slug || "", attackType: "melee", attackAnim: "attack", attackEffects: ["auto"], projectile: "auto", stats: { hp: 100, armor: 60, basicDamage: DEF_BASIC_DMG, skillDamage: DEF_SKILL_DMG }, skills: [], skillCfg: {} };
    persist({ ...config, enemies: { ...config.enemies, [id]: def } });
    active = id;
    selectedSkillId = null;
    syncTargeting();
    renderRoster();
    renderControls();
    renderSkills();
    renderCustomize();
    rebuildScene();
  }
  function deleteEnemy(id) {
    if (!editable || !confirm(`Delete "${config.enemies[id]?.name || id}"?`)) return;
    const next = { ...config.enemies };
    delete next[id];
    if (active === id) {
      active = Object.keys(next)[0] || null;
      selectedSkillId = null;
    }
    save({ ...config, enemies: next });
  }
  const removeSkill = (id) => {
    updateEnemy({ skills: enemySkillIdsOf().filter((s) => s !== id) });
    if (selectedSkillId === id) setSelectedSkill(null);
  };
  const toggleSkill = (id) => {
    if (!editable) {
      setSelectedSkill(id);
      return;
    }
    if (enemySkillIdsOf().includes(id)) removeSkill(id);
    else {
      updateEnemy({ skills: [...enemySkillIdsOf(), id] });
      setSelectedSkill(id);
    }
  };
  const listAside = el("aside", { class: "classes-list" });
  const stageEl = el("div", { class: "classes-stage" });
  const controlsEl = el("div", { class: "classes-controls" });
  const skillsEl = el("div", { class: "classes-skills enemies-skills" });
  const customizeEl = el("aside", { class: "classes-customize" });
  const root = el("div", { class: "classes" }, [listAside, el("div", { class: "classes-main" }, [stageEl, controlsEl, skillsEl]), customizeEl]);
  host.append(root);
  const labelFor = (k) => k === "auto" ? "animation effect" : effectByKey.get(k)?.label || k;
  const familyOf = (e) => e.label.includes(" \xB7 ") ? e.label.split(" \xB7 ")[0] : "legendary";
  function effectStack(list, onChange, tid) {
    const chips = el(
      "div",
      { class: "classes-fx-chips" },
      list.length === 0 ? el("span", { class: "muted" }, "none") : list.map((k, i) => el("span", { class: "classes-fx-chip" }, [labelFor(k), editable ? el("button", { onclick: () => onChange(list.filter((_, j) => j !== i)) }, "\xD7") : null]))
    );
    const kids = [chips];
    if (editable) {
      kids.push(el("select", { onchange: (e) => {
        const v = e.target.value;
        if (v && !list.includes(v)) onChange([...list, v]);
        e.target.value = "";
      } }, [
        el("option", { value: "" }, "+ add effect\u2026"),
        el("option", { value: "auto" }, "animation effect"),
        ...arcTypes.map((t) => el("optgroup", { label: `attack: ${t}` }, attackArcs.filter((e) => e.type === t).map((e) => el("option", { value: e.key }, e.element)))),
        ...weaponFamilies.map((f) => el("optgroup", { label: `weapon: ${f}` }, weaponArcs.filter((e) => familyOf(e) === f).map((e) => el("option", { value: e.key }, e.label.includes(" \xB7 ") ? e.label.split(" \xB7 ")[1] : e.label)))),
        specialFx.length ? el("optgroup", { label: "special (True Heroes)" }, specialFx.map((e) => el("option", { value: e.key }, e.label))) : null
      ]));
    }
    return el("div", { class: "classes-fx-stack", "data-testid": tid }, kids);
  }
  const selectField = (value, options, onChange, tid) => {
    const s = el("select", { "data-testid": tid, onchange: (e) => onChange(e.target.value) }, options.map(([v, label]) => el("option", { value: v }, label)));
    s.value = value;
    if (!editable) s.disabled = true;
    return s;
  };
  function renderRoster() {
    const head = el("div", { class: "enemies-roster-head" }, [el("h2", {}, "Enemies"), editable ? el("button", { class: "enemies-add", title: "New enemy", onclick: addEnemy }, "+") : null]);
    const ids = enemyIds();
    const ul = el("ul", {}, ids.length ? ids.map((id) => el("li", { class: "enemies-row" }, [
      el("button", { class: `classes-link${active === id ? " active" : ""}`, style: { "--c": config.enemies[id]?.color || ENEMY_ACCENT }, onclick: () => setActive(id) }, config.enemies[id]?.name || id),
      editable ? el("button", { class: "enemies-del", title: "Delete", onclick: () => deleteEnemy(id) }, "\xD7") : null
    ])) : el("li", { class: "enemies-empty" }, `No enemies yet.${editable ? " Click + to add one." : ""}`));
    listAside.replaceChildren(head, ul);
  }
  function renderControls() {
    const atkBtn = el("button", { class: "classes-attack-btn", "data-testid": "enemies-attack", onclick: () => {
      req2.attack = true;
    } }, "\u2694 Attack (Space)");
    const skBtn = el("button", { class: "classes-attack-btn", "data-testid": "enemies-play-skill", onclick: () => {
      req2.skill = true;
    } }, "\u25B6 Skill (E)");
    if (!selectedSkillOf()) skBtn.disabled = true;
    controlsEl.replaceChildren(atkBtn, skBtn, el("span", { class: "classes-taskbar-hint muted" }, "WASD move \xB7 Space attack \xB7 E skill \xB7 F target \xB7 ` reset"));
  }
  function renderSkills() {
    const assigned = enemySkillsOf();
    const catalog = skillFilter === "All" ? CB_SKILLS : CB_SKILLS.filter((s) => s.profession === skillFilter);
    const assignedRow = el("div", { class: "enemies-assigned", "data-testid": "enemies-assigned" }, assigned.length ? assigned.map((s) => el("span", { class: "enemies-skill-wrap" }, [
      el("button", { class: `classes-skill on-bar${s.elite ? " elite" : ""}${selectedSkillId === s.id ? " selected" : ""}`, title: `${s.name} \u2014 click to edit`, onclick: () => setSelectedSkill(s.id) }, el("img", { src: iconUrl(s.id), alt: s.name, loading: "lazy", width: 36, height: 36 })),
      editable ? el("button", { class: "enemies-remove-badge", title: `Remove ${s.name}`, onclick: () => removeSkill(s.id) }, "\xD7") : null
    ])) : el("span", { class: "muted" }, "No skills assigned \u2014 add some from the catalog below."));
    const catalogEl = el("div", { class: "enemies-catalog", "data-testid": "enemies-catalog" }, catalog.length ? catalog.map((s) => {
      const on = enemySkillIdsOf().includes(s.id);
      return el("button", { class: `classes-skill ${on ? "on-bar" : "off-bar"}${s.elite ? " elite" : ""}${selectedSkillId === s.id ? " selected" : ""}`, title: `${s.name} (${s.profession})`, onclick: () => toggleSkill(s.id) }, el("img", { src: iconUrl(s.id), alt: s.name, loading: "lazy", width: 36, height: 36 }));
    }) : el("span", { class: "muted" }, "No skills for this filter."));
    const filterEl = el("div", { class: "enemies-filter", "data-testid": "enemies-skill-filter" }, ["All", ...SKILL_PROFESSIONS].map((p) => el("button", { class: skillFilter === p ? "active" : "", onclick: () => {
      skillFilter = p;
      renderSkills();
    } }, p)));
    skillsEl.replaceChildren(
      el("div", { class: "classes-skills-head" }, [el("strong", { style: { color: accentOf() } }, enemyOf().name || "\u2014"), " skills", el("span", { class: "muted" }, ` \xB7 ${assigned.length} \xB7 click to select`)]),
      assignedRow,
      el("div", { class: "enemies-skill-sub" }, `Catalog \xB7 click to ${editable ? "add / remove" : "inspect"}`),
      catalogEl,
      filterEl
    );
  }
  function renderCustomize() {
    customizeEl.style.setProperty("--c", accentOf());
    if (!active) {
      customizeEl.replaceChildren(el("h2", {}, "Customize"), el("p", { class: "muted" }, "Select or add an enemy."));
      return;
    }
    const enemy = enemyOf();
    const activeChar = activeCharOf();
    const attackType = attackTypeOf();
    const stats = statsOf();
    const anims = animsOf(activeChar);
    const basicAnim = resolveAnim(anims, enemy.attackAnim);
    const selectedSkill = selectedSkillOf();
    const kids = [el("h2", {}, "Customize")];
    if (!editable) kids.push(el("p", { class: "classes-readonly" }, "read-only \xB7 edit locally and push"));
    const nameInput = el("input", { type: "text", value: enemy.name || "", "data-testid": "enemies-name", oninput: (e) => updateEnemy({ name: e.target.value }) });
    if (!editable) nameInput.disabled = true;
    kids.push(
      el("label", { class: "classes-field" }, ["Name", nameInput]),
      el("label", { class: "classes-field" }, ["Sprite", selectField(enemy.sprite || "", chars.map((c) => [c.slug, c.name]), (v) => updateEnemy({ sprite: v }), "enemies-sprite")]),
      el("label", { class: "classes-field" }, ["Attack type", selectField(attackType, ATTACK_TYPES.map((t) => [t, t]), (v) => updateEnemy({ attackType: v }), "enemies-attack-type")]),
      el("label", { class: "classes-field" }, ["Attack animation", selectField(basicAnim?.key || "", anims.length ? anims.map((a) => [a.key, a.name]) : [["", "(none)"]], (v) => updateEnemy({ attackAnim: v }), "enemies-attack-anim")]),
      el("div", { class: "classes-field" }, ["Attack effects ", el("small", { class: "muted" }, "(stack)"), effectStack(stackOf(enemy, "attackEffects"), (v) => updateEnemy({ attackEffects: v }), "enemies-attack-effect")])
    );
    if (attackType === "ranged") {
      kids.push(el("label", { class: "classes-field" }, ["Projectile", selectField(enemy.projectile || "auto", [["auto", "auto (character's / arrow)"], ["none", "none"], ...arrowVariants.map((e) => [e.key, `arrow \xB7 ${e.element}`])], (v) => updateEnemy({ projectile: v }), "enemies-projectile")]));
    }
    const statsGrid = el("div", { class: "enemies-stats", "data-testid": "enemies-stats" }, STAT_FIELDS.map((f) => {
      const inp = el("input", { type: "number", min: "0", value: String(stats[f.key] ?? f.def), "data-testid": `enemies-stat-${f.key}`, oninput: (e) => updateStats({ [f.key]: e.target.value === "" ? "" : Number(e.target.value) }) });
      if (!editable) inp.disabled = true;
      return el("label", { class: "enemies-stat" }, [f.label, inp]);
    }));
    kids.push(el("div", { class: "classes-field" }, "Stats"), statsGrid);
    if (selectedSkill) {
      const skillCfg = enemy.skillCfg?.[selectedSkill.id] || {};
      const skillAnim = resolveAnim(anims, skillCfg.anim);
      kids.push(el("div", { class: "classes-skill-detail", "data-testid": "enemies-skill-detail" }, [
        el("h2", {}, "Skill"),
        renderSkillDetail(selectedSkill),
        el("label", { class: "classes-field" }, ["Skill animation", selectField(skillAnim?.key || "", anims.map((a) => [a.key, a.name]), (v) => updateSkillCfg(selectedSkill.id, { anim: v }), "enemies-skill-anim")]),
        el("div", { class: "classes-field" }, ["Skill effects ", el("small", { class: "muted" }, "(stack)"), effectStack(stackOf(skillCfg, "effects"), (v) => updateSkillCfg(selectedSkill.id, { effects: v }), "enemies-skill-effect")]),
        editable ? el("div", { class: "classes-skill-actions" }, el("button", { class: "classes-skill-add", onclick: () => removeSkill(selectedSkill.id) }, "Remove from enemy")) : null
      ]));
    }
    customizeEl.replaceChildren(...kids);
  }
  function syncTargeting() {
    targeting = { basicGw: attackTypeOf() === "ranged" ? BOW_GW : MELEE_GW, skillGw: skillRangeGw(selectedSkillOf()), skillSupport: isSupport(selectedSkillOf()) };
  }
  function setActive(id) {
    if (id === active) return;
    active = id;
    selectedSkillId = null;
    syncTargeting();
    renderRoster();
    renderControls();
    renderSkills();
    renderCustomize();
    rebuildScene();
  }
  function setSelectedSkill(id) {
    selectedSkillId = id;
    syncTargeting();
    renderSkills();
    renderControls();
    renderCustomize();
    rebuildScene();
  }
  const stage = mountSandboxStage(pixi, stageEl, {
    input: { keys, req: req2 },
    targeting: () => targeting,
    getSelectedSkillId: () => selectedSkillId,
    targetName: "Worker",
    state: stageState,
    canvasTestId: "enemies-canvas"
  });
  function buildEnemiesBattle() {
    const activeChar = activeCharOf();
    if (!activeChar) return null;
    const attackType = attackTypeOf();
    const stats = statsOf();
    const worker = chars.find((c) => c.slug === TARGET_SLUG) || null;
    const anims = animsOf(activeChar);
    const basicAnim = resolveAnim(anims, enemyOf().attackAnim);
    const skillCfg = enemyOf().skillCfg?.[selectedSkillId] || {};
    const skillAnim = selectedSkillId ? resolveAnim(anims, skillCfg.anim) : null;
    const skillEffectUrls = selectedSkillId ? resolveEffectUrls(skillAnim, stackOf(skillCfg, "effects")) : [];
    const fxCellOf = (url) => fx.find((e) => e.url === url)?.cell || 32;
    const enemyUnit = { name: enemyOf().name || active, control: "player", attackType, stats: { hp: stats.hp ?? 100, armor: stats.armor ?? 60, basicDamage: stats.basicDamage ?? DEF_BASIC_DMG }, skills: selectedSkillId ? [selectedSkillId] : [] };
    const workerUnit = () => ({ name: "Worker", control: "dummy", stats: { hp: ACO_MAXHP, armor: 0, basicDamage: 0 }, attackType: "melee" });
    const battle = makeTeamBattle({ players: [enemyUnit], enemies: [workerUnit(), workerUnit(), workerUnit()], sandbox: true, freeCast: true });
    const defsById = {
      P0: {
        name: enemyOf().name || active,
        idle: activeChar.idle,
        walk: activeChar.walk,
        attack: activeChar.attack || activeChar.idle,
        dmg: activeChar.dmg,
        die: activeChar.die,
        recolor: null,
        skillFx: selectedSkillId ? { [selectedSkillId]: { animUrl: skillAnim?.url || basicAnim?.url, effects: skillEffectUrls.map((url) => ({ url, cell: fxCellOf(url) })) } } : {}
      }
    };
    ["E0", "E1", "E2"].forEach((id) => {
      defsById[id] = { name: "Worker", idle: worker?.idle, walk: worker?.walk || worker?.idle, attack: worker?.attack || worker?.idle, dmg: worker?.dmg, die: worker?.die, recolor: null };
    });
    return { battle, defsById };
  }
  const rebuildScene = () => stage.rebuild(buildEnemiesBattle);
  const keyMap = { w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
  const keyset = {};
  const applyKeys = () => {
    let x = 0, y = 0;
    for (const k in keyset) if (keyset[k]) {
      x += keyMap[k][0];
      y += keyMap[k][1];
    }
    keys.x = Math.sign(x);
    keys.y = Math.sign(y);
  };
  const onDown = (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space" || e.key === " ") {
      req2.attack = true;
      e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === "e") {
      req2.skill = true;
      e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === "f") {
      req2.f = true;
      e.preventDefault();
      return;
    }
    if (e.key === "`" || e.key === "~" || e.code === "Backquote") {
      req2.reset = true;
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (keyMap[k]) {
      keyset[k] = true;
      applyKeys();
      e.preventDefault();
    }
  };
  const onUp = (e) => {
    const k = e.key.toLowerCase();
    if (keyMap[k]) {
      keyset[k] = false;
      applyKeys();
    }
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);
  syncTargeting();
  renderRoster();
  renderControls();
  renderSkills();
  renderCustomize();
  rebuildScene();
  return {
    destroy() {
      stage.destroy();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      host.replaceChildren();
    }
  };
}
export {
  mountEnemiesSandbox
};
