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
function spawnActor(b, unit, team, id) {
  const a = makeActor(unit, team, id, 0);
  a.attackTimer = a.weapon.interval;
  b.actors.push(a);
  return a;
}
function removeActor(b, id) {
  const i = b.actors.findIndex((a) => a.id === id);
  if (i >= 0) b.actors.splice(i, 1);
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
function branchOk(b, req, a, tgt) {
  if (req.target_below_health != null) return tgt.hp / tgt.maxHp < req.target_below_health;
  if (req.target_health_above_self) return tgt.hp > a.hp;
  if (req.target === "bleeding") return hasCond(tgt, "bleeding");
  if (req.target === "casting_spell") return !!tgt.casting;
  if (req.target === "moving") return !!tgt.moving;
  if (req.target === "knocked_down") return isKd(b, tgt);
  if (req.target === "hexed") return hasHex(b, tgt);
  if (req.target === "attacking") return tgt.attackedAt != null && b.t - tgt.attackedAt < 1.2;
  if (req.self === "enchanted") return hasModKind(b, a, "cap") || hasModKind(b, a, "convert");
  return true;
}
function reasonOf(req) {
  if (!req) return "";
  if (req.target_below_health != null) return `foe <${req.target_below_health * 100}%`;
  if (req.target_health_above_self) return "foe has more HP";
  if (req.target === "bleeding") return "foe Bleeding";
  if (req.target === "casting_spell") return "foe casting";
  if (req.target === "moving") return "foe moving";
  if (req.target === "knocked_down") return "knocked down";
  if (req.target === "hexed") return "foe hexed";
  if (req.target === "attacking") return "foe attacking";
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
function playerActionReason(b, a, action) {
  if (!a || !action) return null;
  const foe = nearestFoe(b, a);
  if (action === "basic") return !foe || edgeGap(a, foe) > reachOf(a) ? "no-target" : null;
  const s = a.bar.find((x) => x.id === action);
  if (!s) return null;
  if (s.cost?.adrenaline && a.adrenaline < s.cost.adrenaline) return "need-adrenaline";
  if (s.cost?.energy && a.energy < s.cost.energy) return "need-energy";
  if (b.t < (a.recharge[s.name] || 0)) return "recharging";
  const aoe = (s.effects || []).find((e) => e.scope === "area_around_caster");
  if (aoe) {
    const r = aoe.range || 180;
    return b.actors.some((x) => x.alive && x.team !== a.team && dist(a, x) <= r) ? null : "no-target";
  }
  if (isAttack(s)) return !foe || edgeGap(a, foe) > reachOf(a) ? "no-target" : null;
  if (!isSupport(s)) return !foe || dist(a, foe) > SPELL_RANGE ? "no-target" : null;
  return null;
}
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
function runToEnd(opts, dt = 0.05, maxT = 120) {
  const b = makeTeamBattle(opts);
  while (!b.over && b.t < maxT) step(b, dt);
  return b;
}
export {
  CLASS_TEMPLATES,
  COLLISION_Y_WEIGHT,
  FIELD,
  isSupport,
  makeTeamBattle,
  playerActionReason,
  removeActor,
  runToEnd,
  setInput,
  skillById,
  spawnActor,
  step,
  val
};
