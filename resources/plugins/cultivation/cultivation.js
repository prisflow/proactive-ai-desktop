"use strict";

// src/ledger.ts
function newWorld() {
  return {
    meta: { initialized: false, created: false, dead: false, turns: 0 },
    stats: {
      realm: "\u51E1\u4EBA",
      realmStage: 1,
      cultivation: 0,
      world: {},
      name: "",
      gender: "\u7537",
      temperament: "",
      lifespan: 80,
      timeMonth: 0,
      location: "",
      hp: 100,
      maxHp: 100,
      spiritStones: 0,
      methods: [],
      mainMethod: null,
      talents: null,
      pills: [],
      characters: [],
      npcGrowthMonths: 0,
      breakBonus: 0
    },
    majorEvents: [],
    pendingBranch: null,
    originPool: [],
    talentPool: []
  };
}
function createLedger(api) {
  const worlds = /* @__PURE__ */ new Map();
  const saved = api.storage.get();
  if (saved && typeof saved === "object") {
    for (const [cid, w] of Object.entries(saved)) worlds.set(cid, w);
  }
  function saveAll() {
    const all = {};
    for (const [cid, w] of worlds) all[cid] = w;
    api.storage.set(all);
  }
  function getWorld(cid) {
    if (!cid) return newWorld();
    let w = worlds.get(cid);
    if (!w) {
      w = newWorld();
      worlds.set(cid, w);
    }
    delete w.story;
    delete w.memory;
    return w;
  }
  return { getWorld, saveAll };
}

// src/constants.ts
var REALM_ORDER = ["\u51E1\u4EBA", "\u7EC3\u6C14", "\u7B51\u57FA", "\u91D1\u4E39", "\u5143\u5A74", "\u5316\u795E"];
var REALM_LAYERS = {
  \u51E1\u4EBA: 1,
  \u7EC3\u6C14: 9,
  \u7B51\u57FA: 3,
  \u91D1\u4E39: 3,
  \u5143\u5A74: 3,
  \u5316\u795E: 3
};
var CULTIVATION_CAP = {
  \u51E1\u4EBA: 0,
  \u7EC3\u6C14: 100,
  \u7B51\u57FA: 600,
  \u91D1\u4E39: 3e3,
  \u5143\u5A74: 15e3,
  \u5316\u795E: 6e4
};
var METHOD_GRADES = {
  \u51E1\u54C1: 4,
  \u9EC4\u9636: 24,
  \u7384\u9636: 120,
  \u5730\u9636: 600,
  \u5929\u9636: 3e3
};
var PILL_EFFECTS = ["cultivation", "breakthrough", "heal", "lifespan"];
var REALM_POWER = {
  \u51E1\u4EBA: 0,
  \u7EC3\u6C14: 10,
  \u7B51\u57FA: 30,
  \u91D1\u4E39: 80,
  \u5143\u5A74: 200,
  \u5316\u795E: 500
};
var LIFESPAN = {
  \u51E1\u4EBA: 80,
  \u7EC3\u6C14: 120,
  \u7B51\u57FA: 200,
  \u91D1\u4E39: 300,
  \u5143\u5A74: 500,
  \u5316\u795E: 800
};
var BREAKTHROUGH_RATES = {
  \u51E1\u4EBA: 0.8,
  \u7EC3\u6C14: 0.6,
  \u7B51\u57FA: 0.4,
  \u91D1\u4E39: 0.2,
  \u5143\u5A74: 0.1,
  \u5316\u795E: 0.05
};
var DUAL_MULT = 1.5;
var BATTLE_HP_BASE = 100;
var CULTIVATE_MONTHS = [1, 3, 12];
var NPC_BATCH_MIN = 10;
var NPC_BATCH_MAX = 10;
var NPC_GROWTH = {
  \u51E1\u4EBA\u6751\u6C11: 0,
  \u6751\u6C11: 2,
  \u6563\u4FEE: 6,
  \u5B97\u95E8\u5F1F\u5B50: 12,
  \u5B97\u95E8\u957F\u8001: 30,
  \u638C\u95E8: 60,
  \u5927\u80FD: 150
};
var NPC_GROWTH_DEFAULT = 4;
var NPC_GROWTH_TICK = 12;
var AFFINITY_MAX = 100;
var AFFINITY_BANDS = [
  { min: 0, max: 9, label: "\u51B7\u6DE1" },
  { min: 10, max: 29, label: "\u76F8\u8BC6" },
  { min: 30, max: 49, label: "\u53CB\u597D" },
  { min: 50, max: 69, label: "\u4EB2\u5BC6" },
  { min: 70, max: 89, label: "\u7231\u6155" },
  { min: 90, max: 100, label: "\u631A\u7231" }
];
function affinityLabel(v) {
  const n = Math.max(0, Math.min(AFFINITY_MAX, Math.floor(Number.isFinite(v) ? v : 0)));
  for (const b of AFFINITY_BANDS) if (n >= b.min && n <= b.max) return b.label;
  return "\u51B7\u6DE1";
}
function clampAffinity(v) {
  return Math.max(0, Math.min(AFFINITY_MAX, Math.floor(Number.isFinite(v) ? v : 0)));
}

// src/rules/state.ts
function stageOf(w) {
  if (w.meta.dead) return "dead";
  if (!w.meta.initialized) return "world-pending";
  if (!w.meta.created) return "origin-pending";
  return "playing";
}
function fmtTime(w) {
  const m = w.stats.timeMonth;
  const y = Math.floor(m / 12);
  const mo = m % 12;
  return y > 0 ? `${y} \u5E74${mo > 0 ? ` ${mo} \u6708` : ""}` : `${m} \u6708`;
}
function fmtRealm(w) {
  const { realm, realmStage } = w.stats;
  const layers = REALM_LAYERS[realm];
  if (layers <= 1) return realm;
  if (realm === "\u7EC3\u6C14") return `\u7EC3\u6C14${realmStage}\u5C42`;
  const STAGE_NAMES = ["\u521D\u671F", "\u4E2D\u671F", "\u540E\u671F"];
  return `${realm}${STAGE_NAMES[Math.min(realmStage - 1, 2)]}`;
}
function cultivationCap(w) {
  return w.stats.realm === "\u51E1\u4EBA" ? CULTIVATION_CAP["\u7EC3\u6C14"] : CULTIVATION_CAP[w.stats.realm];
}
function pillEffectLabel(effectType, power) {
  switch (effectType) {
    case "cultivation":
      return `\u4FEE\u4E3A+${power}`;
    case "breakthrough":
      return `\u7A81\u7834+${power}%`;
    case "heal":
      return `\u56DE\u8840+${power}`;
    case "lifespan":
      return `\u5EF6\u5BFF+${power}\u5E74`;
    default:
      return `${effectType}+${power}`;
  }
}
function publicState(w) {
  const s = w.stats;
  const nearby = s.characters.filter((c) => c.location === s.location);
  const close = s.characters.filter((c) => c.affinity >= 50);
  const actives = w.majorEvents.filter((e) => e.status === "active");
  const upcoming = w.majorEvents.filter((e) => e.status === "pending" && e.at - s.timeMonth <= 12);
  return {
    stage: stageOf(w),
    meta: { turns: w.meta.turns, dead: w.meta.dead, deathCause: w.meta.deathCause },
    stats: {
      name: s.name || "",
      gender: s.gender || "",
      temperament: s.temperament || "",
      realm: fmtRealm(w),
      cultivation: s.cultivation,
      cap: cultivationCap(w),
      lifespan: s.lifespan,
      mainMethod: s.mainMethod || null,
      time: fmtTime(w),
      location: s.location,
      hp: s.hp,
      maxHp: s.maxHp,
      spiritStones: s.spiritStones,
      breakBonus: s.breakBonus ?? 0,
      breakRate: (() => {
        const base = { "\u51E1\u4EBA": 0.6, "\u7EC3\u6C14": 0.2, "\u7B51\u57FA": 0.15, "\u91D1\u4E39": 0.1, "\u5143\u5A74": 0.08, "\u5316\u795E": 0.05 }[s.realm] ?? 0.1;
        const talents = s.talents || [];
        let tb = 0;
        for (const t of talents) tb += t.quality === "\u5409" ? 0.2 : t.quality === "\u51F6" ? -0.1 : 0;
        return Math.round(Math.min(1, Math.max(0, base + (s.breakBonus ?? 0) + tb)) * 100);
      })()
    },
    methods: s.methods.map((m) => ({ ...m })),
    pills: s.pills.map((p) => ({ ...p })),
    characters: {
      total: s.characters.length,
      nearby: nearby.map((c) => ({ name: c.name, identity: c.identity, realm: c.realm, affinity: c.affinity, affinityLabel: affinityLabel(c.affinity), relationship: c.relationship })),
      close: close.map((c) => ({ name: c.name, affinity: c.affinity, affinityLabel: affinityLabel(c.affinity), relationship: c.relationship }))
    },
    majorEvents: {
      active: actives.map((e) => ({ name: e.name, type: e.type, summary: e.summary, by: e.by })),
      upcoming: upcoming.map((e) => ({ name: e.name, type: e.type, at: e.at }))
    }
  };
}
function worldSetting(w) {
  const world = w.stats.world;
  const lines = [];
  if (world?.name) lines.push(`\u4E16\u754C\uFF1A${world.name}`);
  if (world?.regions?.length) lines.push(`\u5730\u57DF\uFF1A${world.regions.join("\u3001")}`);
  if (world?.sects?.length) lines.push(`\u5B97\u95E8\uFF1A${world.sects.map((s) => `${s.name}\uFF08${s.stance}\xB7${s.location}\uFF09`).join("\u3001")}`);
  if (world?.towns?.length) lines.push(`\u57CE\u9547\uFF1A${world.towns.map((t) => t.name).join("\u3001")}`);
  if (world?.law) lines.push(`\u6CD5\u5219\uFF1A${world.law}`);
  if (world?.rumor) lines.push(`\u4F20\u95FB\uFF1A${world.rumor}`);
  const events = w.majorEvents;
  if (events.length) {
    lines.push(`\u5927\u4E8B\u4EF6\u65F6\u95F4\u7EBF\uFF1A${events.map((e) => `${e.name}\uFF08${e.type}\xB7\u7B2C${e.at}\u6708\u2192\u7B2C${e.by}\u6708\xB7${e.status}\uFF09`).join("\uFF1B")}`);
  }
  const roster = w.stats.characters;
  if (roster.length) {
    lines.push(`\u89D2\u8272\u540D\u518C\uFF1A${roster.map((c) => `${c.name}\uFF08${c.identity}\xB7${c.realm}\uFF09`).join("\uFF1B")}`);
  }
  return lines.join("\n");
}
function fmtStatus(w) {
  const main = w.stats.methods.find((m) => m.name === w.stats.mainMethod);
  const methodsStr = w.stats.methods.length ? w.stats.methods.map((m) => `${m.name}[${m.grade}]${m.name === w.stats.mainMethod ? "\u2605\u4E3B\u4FEE" : ""}\uFF08${m.techniques.map((t) => `${t.name}\uFF1A${t.description}`).join("\uFF1B")}\uFF09`).join("\u3001") : "\u65E0";
  const pillsStr = w.stats.pills.length ? w.stats.pills.map((p) => `${p.name}\xD7${p.amount}[${p.realm}\xB7${pillEffectLabel(p.effectType, p.power)}]`).join("\u3001") : "\u65E0";
  const talentsStr = w.stats.talents?.length ? w.stats.talents.map((t) => `${t.name}\u300C${t.description}\u300D`).join("\u3001") : "\u65E0";
  const breakRate = (() => {
    const base = { "\u51E1\u4EBA": 0.6, "\u7EC3\u6C14": 0.2, "\u7B51\u57FA": 0.15, "\u91D1\u4E39": 0.1, "\u5143\u5A74": 0.08, "\u5316\u795E": 0.05 }[w.stats.realm] ?? 0.1;
    const talents = w.stats.talents || [];
    let tb = 0;
    for (const t of talents) tb += t.quality === "\u5409" ? 0.2 : t.quality === "\u51F6" ? -0.1 : 0;
    return Math.round(Math.min(1, Math.max(0, base + (w.stats.breakBonus ?? 0) + tb)) * 100);
  })();
  return `${w.stats.name ? `\u540D\u5B57\u300C${w.stats.name}\u300D` : ""}${w.stats.temperament ? `\xB7${w.stats.temperament}` : ""} | \u5883\u754C\uFF1A${fmtRealm(w)} | \u4FEE\u4E3A\uFF1A${w.stats.cultivation}/${cultivationCap(w)} | \u5BFF\u5143\uFF1A${Math.floor(w.stats.lifespan)}\u5E74 | \u65F6\u95F4\uFF1A${fmtTime(w)}
\u7075\u77F3\uFF1A${w.stats.spiritStones} | \u4F53\u529B\uFF1A${w.stats.hp}/${w.stats.maxHp} | \u5730\u70B9\uFF1A${w.stats.location}
\u4E3B\u4FEE\uFF1A${w.stats.mainMethod ? `${w.stats.mainMethod}${main ? `[${main.grade}]` : ""}` : "\u65E0"}
\u5929\u8D44\uFF1A${talentsStr}
\u7A81\u7834\u7387\uFF1A${breakRate}%${w.stats.breakBonus ? `\uFF08\u5267\u60C5\u52A0\u6210+${Math.round(w.stats.breakBonus * 100)}%\uFF09` : ""}
\u529F\u6CD5\uFF1A${methodsStr}
\u4E39\u836F\uFF1A${pillsStr}`;
}

// src/rules/utils.ts
function realmForCultivation(cult) {
  let c = cult;
  for (let i = 1; i < REALM_ORDER.length; i++) {
    const realm = REALM_ORDER[i];
    const layers = REALM_LAYERS[realm];
    const cap = CULTIVATION_CAP[realm];
    const total = cap * layers;
    if (c < total) return { realm, stage: Math.floor(c / Math.max(cap, 1)) + 1 };
    c -= total;
  }
  const last = REALM_ORDER[REALM_ORDER.length - 1];
  return { realm: last, stage: REALM_LAYERS[last] };
}
function realmToCultivation(realm) {
  let total = 0;
  for (let i = 0; i < REALM_ORDER.length; i++) {
    const r = REALM_ORDER[i];
    if (r === realm) return total + CULTIVATION_CAP[r] * Math.floor(REALM_LAYERS[r] / 2);
    total += CULTIVATION_CAP[r] * REALM_LAYERS[r];
  }
  return total;
}
function tickEvents(w) {
  const msgs = [];
  for (const e of w.majorEvents) {
    if (e.status === "pending" && w.stats.timeMonth >= e.at) {
      e.status = "active";
      msgs.push(`[\u5927\u4E8B\u4EF6\u5F00\u542F] ${e.name}\uFF08${e.type}\uFF09\uFF1A${e.summary}`);
    } else if (e.status === "active" && w.stats.timeMonth > e.by) {
      e.status = "failed";
      msgs.push(`[\u5927\u4E8B\u4EF6\u5931\u8D25] ${e.name} \u672A\u80FD\u5728\u671F\u9650\u5185\u89E3\u51B3\uFF0C\u540E\u679C\u964D\u4E34\uFF1A${e.summary}`);
    }
  }
  return msgs;
}
function tickNPCGrowth(w, months) {
  const s = w.stats;
  s.npcGrowthMonths += months;
  while (s.npcGrowthMonths >= NPC_GROWTH_TICK) {
    s.npcGrowthMonths -= NPC_GROWTH_TICK;
    for (const c of s.characters) {
      c.cultivation += (NPC_GROWTH[c.identity] ?? NPC_GROWTH_DEFAULT) * NPC_GROWTH_TICK;
      const cur = realmForCultivation(c.cultivation);
      if (cur.realm !== c.realm || cur.stage !== 1 || c.cultivation >= 100) c.realm = cur.realm;
    }
  }
}
function advanceTime(w, months) {
  const s = w.stats;
  s.timeMonth += months;
  const msgs = tickEvents(w);
  tickNPCGrowth(w, months);
  s.lifespan -= months / 12;
  if (s.lifespan <= 0 && !w.meta.dead) {
    w.meta.dead = true;
    w.meta.deathCause = "\u5BFF\u5143\u8017\u5C3D";
  }
  return msgs;
}
function advanceRealm(w) {
  const s = w.stats;
  s.realmStage += 1;
  if (s.realmStage > REALM_LAYERS[s.realm]) {
    const idx = REALM_ORDER.indexOf(s.realm);
    if (idx < REALM_ORDER.length - 1) {
      s.realm = REALM_ORDER[idx + 1];
      s.realmStage = 1;
    } else {
      s.realmStage = REALM_LAYERS[s.realm];
    }
  }
  s.maxHp = BATTLE_HP_BASE + REALM_POWER[s.realm] * 20;
  s.hp = Math.min(s.maxHp, Math.max(s.hp, BATTLE_HP_BASE + REALM_POWER[s.realm] * 20));
  if (s.lifespan < LIFESPAN[s.realm]) s.lifespan = LIFESPAN[s.realm];
}

// src/rules/world.ts
function parseOriginPool(w) {
  return Array.isArray(w.originPool) ? w.originPool : [];
}
function parseTalentPool(w) {
  return Array.isArray(w.talentPool) ? w.talentPool : [];
}
function makeApplyWorldBase(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const d = ctx.data.worldBase;
    const world = d?.world;
    if (!world || typeof world.name !== "string" || !world.name.trim()) return "\u4E16\u754C\u9AA8\u67B6\u4E3A\u7A7A\uFF08world.name \u7F3A\u5931\uFF09";
    if (!Array.isArray(world.regions) || world.regions.length === 0) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08regions \u7F3A\u5931\uFF09";
    if (!Array.isArray(world.sects) || world.sects.length === 0) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08sects \u7F3A\u5931\uFF09";
    if (typeof world.law !== "string" || !world.law.trim()) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08law \u7F3A\u5931\uFF09";
    w.stats.world = world;
    ledger.saveAll();
    return null;
  };
}
function makeApplyNpcPool(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const KEYS = ["npcBatch1", "npcBatch2", "npcBatch3", "npcBatch4", "npcBatch5"];
    const all = KEYS.flatMap((k) => {
      const b = ctx.data[k]?.[k];
      return Array.isArray(b) ? b : [];
    });
    if (all.length === 0) return "\u672C\u6279\u672A\u751F\u6210 NPC\uFF08npcBatch \u4E3A\u7A7A\uFF09";
    const seen = new Set(w.stats.characters.map((c) => c.name));
    const added = [];
    for (const c of all) {
      const name = typeof c.name === "string" ? c.name.trim() : "";
      if (!name || seen.has(name)) continue;
      const realm = typeof c.realm === "string" && REALM_ORDER.includes(c.realm) ? c.realm : "\u51E1\u4EBA";
      seen.add(name);
      const affinity = clampAffinity(Number(c.affinity));
      added.push({
        name,
        gender: typeof c.gender === "string" && (c.gender === "\u7537" || c.gender === "\u5973") ? c.gender : "\u7537",
        age: typeof c.age === "number" && c.age > 0 ? Math.min(c.age, 500) : 20,
        identity: typeof c.identity === "string" && c.identity ? c.identity : "\u6751\u6C11",
        realm,
        location: typeof c.location === "string" && c.location ? c.location : "\u672A\u77E5",
        temperament: typeof c.temperament === "string" ? c.temperament : "",
        affinity,
        relationship: "\u65E0",
        note: typeof c.note === "string" ? c.note : "",
        cultivation: realmToCultivation(realm)
      });
    }
    w.stats.characters.push(...added);
    ledger.saveAll();
    return null;
  };
}
function makeApplyOrigins(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const d = ctx.data.origins;
    const origins = Array.isArray(d?.origins) ? d.origins : [];
    if (origins.length < 2 || origins.length > 4) return "\u51FA\u8EAB\u6570\u91CF\u987B 2-4 \u6761";
    w.originPool = origins;
    w.meta.initialized = true;
    ledger.saveAll();
    return null;
  };
}
function makeApplyTalents(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const d = ctx.data.talents;
    const talents = Array.isArray(d?.talents) ? d.talents : [];
    if (talents.length !== 9) return "\u5929\u8D44\u6570\u91CF\u987B 9 \u6761";
    w.talentPool = talents;
    ledger.saveAll();
    return null;
  };
}

// src/rules/character.ts
function makeApplyCharacter(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const d = ctx.data.charCreate;
    if (!d || !d.origin || !d.talents?.length || !d.name) return "\u5EFA\u89D2\u4FE1\u606F\u4E3A\u7A7A\uFF08origin/talents/name \u7F3A\u5931\uFF09";
    const originName = typeof d?.origin === "string" ? d.origin.trim() : "";
    const talentNames = Array.isArray(d?.talents) ? d.talents.map((s2) => String(s2).trim()).filter(Boolean).slice(0, 3) : [];
    const name = typeof d?.name === "string" && d.name.trim() ? d.name.trim() : "\u65E0\u540D";
    const gender = d?.gender === "\u5973" ? "\u5973" : "\u7537";
    const temperament = typeof d?.temperament === "string" && d.temperament.trim() ? d.temperament.trim() : "\u5E73\u548C";
    const origins = parseOriginPool(w);
    const talents = parseTalentPool(w);
    const origin = origins.find((o) => o.name === originName) || origins[0];
    const pickedTalents = [];
    for (const tn of talentNames) {
      const hit = talents.find((t) => t.name === tn);
      if (hit && !pickedTalents.some((p) => p.name === hit.name)) pickedTalents.push(hit);
    }
    for (const t of talents) {
      if (pickedTalents.length >= 3) break;
      if (!pickedTalents.some((p) => p.name === t.name)) pickedTalents.push(t);
    }
    const finalTalents = pickedTalents.slice(0, 3);
    const s = w.stats;
    s.name = name;
    s.gender = gender;
    s.temperament = temperament;
    s.realm = "\u51E1\u4EBA";
    s.realmStage = 1;
    s.cultivation = 0;
    s.hp = BATTLE_HP_BASE + (REALM_POWER[s.realm] ?? 0) * 20;
    s.maxHp = s.hp;
    s.lifespan = LIFESPAN[s.realm] ?? 80;
    s.location = typeof origin?.location === "string" && origin.location ? origin.location : "\u672A\u77E5";
    s.spiritStones = 0;
    s.methods = [];
    s.pills = [];
    const pushStarter = (starter, source) => {
      if (!starter) return;
      const stones = typeof starter.spiritStones === "number" ? starter.spiritStones : 0;
      s.spiritStones += stones;
      for (const it of starter.methods || []) {
        if (s.methods.some((m) => m.name === it.name)) continue;
        const grade = typeof it.grade === "string" && METHOD_GRADES[it.grade] ? it.grade : "\u51E1\u54C1";
        s.methods.push({
          name: String(it.name || "\u65E0\u540D\u529F\u6CD5"),
          grade,
          efficiency: METHOD_GRADES[grade] ?? 4,
          techniques: (it.techniques || []).map((t) => ({
            name: String(t.name || "\u65E0\u540D\u672F\u6CD5"),
            description: String(t.description || ""),
            source
          })),
          source
        });
      }
      for (const it of starter.pills || []) {
        const eff = String(it.effectType || "heal");
        const realm = String(it.realm || "\u51E1\u4EBA");
        const existing = s.pills.find((p) => p.name === it.name && p.effectType === eff && p.realm === realm);
        if (existing) existing.amount += 1;
        else s.pills.push({ name: String(it.name || "\u65E0\u540D\u4E39\u836F"), effectType: eff, realm, power: Number(it.power) || 10, amount: 1, source });
      }
    };
    pushStarter(origin?.starter, "\u51FA\u8EAB");
    s.mainMethod = s.methods[0]?.name ?? null;
    s.talents = finalTalents.map((t) => ({
      name: String(t.name || ""),
      description: String(t.description || ""),
      temperament: String(t.temperament || ""),
      quality: t.quality || "\u5409"
    }));
    if (origin?.npcs) {
      for (const [n, lv] of Object.entries(origin.npcs)) {
        const c = s.characters.find((c2) => c2.name === n);
        if (c) c.affinity = clampAffinity(Number(lv));
      }
    }
    w.meta.created = true;
    w.meta.turns = 0;
    ledger.saveAll();
    return null;
  };
}

// src/rules/turn.ts
function calcBreakthroughRate(w) {
  const base = BREAKTHROUGH_RATES[w.stats.realm] ?? 0.1;
  const breakBonus = w.stats.breakBonus ?? 0;
  const talents = w.stats.talents || [];
  let talentBonus = 0;
  for (const t of talents) {
    if (t.quality === "\u5409") talentBonus += 0.2;
    else if (t.quality === "\u51F6") talentBonus -= 0.1;
  }
  const rate = Math.min(1, Math.max(0, base + breakBonus + talentBonus));
  return { rate, talentBonus, base, breakBonus };
}
function makeApplyBreakthrough(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const calc = ctx.data.breakthroughCalc;
    const d = ctx.data.breakthrough;
    if (!calc || !d) return "\u7A81\u7834\u6570\u636E\u7F3A\u5931";
    const extraCultivation = typeof d.extraCultivation === "number" && Number.isFinite(d.extraCultivation) ? Math.max(0, Math.floor(d.extraCultivation)) : 0;
    const nextRateBonus = typeof d.nextRateBonus === "number" && Number.isFinite(d.nextRateBonus) ? d.nextRateBonus : 0;
    const cap = cultivationCap(w);
    if (calc.success) {
      w.stats.cultivation = 0;
      w.stats.breakBonus = 0;
      if (extraCultivation > 0) w.stats.cultivation = Math.min(extraCultivation, cap);
      advanceRealm(w);
    } else {
      w.stats.cultivation = 0;
      w.stats.breakBonus = 0;
      if (extraCultivation > 0) w.stats.cultivation = Math.min(extraCultivation, cap);
    }
    if (nextRateBonus) w.stats.breakBonus = Math.max(0, nextRateBonus / 100);
    w.meta.turns += 1;
    ledger.saveAll();
    return null;
  };
}
function makeApplyTurn(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    if (!w.meta.created) return "\u89D2\u8272\u672A\u521B\u5EFA\uFF0C\u8BF7\u5148\u521B\u5EFA\u89D2\u8272";
    const d = ctx.data.turn;
    if (!d) return null;
    const text = typeof d.text === "string" ? d.text : "";
    const kind = typeof d.kind === "string" ? d.kind : "\u65E5\u5E38";
    if (kind !== "\u65E5\u5E38" && !d.eventRef) return `\u8282\u62CD\uFF08${kind}\uFF09\u5FC5\u987B\u7ED1\u5B9A\u8FDB\u884C\u4E2D\u7684\u5927\u4E8B\u4EF6\u2014\u2014\u8BF7\u5148\u8BA9\u5927\u4E8B\u4EF6\u63A8\u8FDB\uFF08eventRef\uFF09\uFF0C\u6216\u672C\u56DE\u5408\u6539\u4E3A\u65E5\u5E38\u63A8\u8FDB`;
    const turnMonthsForCheck = typeof d.timeCost === "number" ? d.timeCost : d.cultivate?.months ?? 0;
    if (d.eventRef) {
      const ev = w.majorEvents.find((e) => e.name === d.eventRef.name);
      if (!ev) return `eventRef.name \u5FC5\u987B\u662F\u5DF2\u6CE8\u518C\u7684\u5927\u4E8B\u4EF6\uFF1A${w.majorEvents.map((e) => e.name).join("\u3001") || "\uFF08\u6682\u65E0\uFF09"}`;
      if (ev.status === "failed") return `\u300C${ev.name}\u300D\u5DF2\u5931\u8D25\uFF0C\u65E0\u6CD5\u63A8\u8FDB\uFF08\u540E\u679C\u5DF2\u964D\u4E34\uFF09`;
      if (ev.status === "pending") {
        if (w.stats.timeMonth + turnMonthsForCheck >= ev.at) {
        } else return `\u300C${ev.name}\u300D\u5C1A\u672A\u89E6\u53D1\uFF08\u7B2C ${ev.at} \u6708\u5F00\u542F\uFF0C\u5F53\u524D\u7B2C ${w.stats.timeMonth + turnMonthsForCheck} \u6708\uFF09`;
      }
      if (ev.status === "resolved") return `\u300C${ev.name}\u300D\u5DF2\u89E3\u51B3\uFF0C\u8BF7\u52FF\u91CD\u590D\u63A8\u8FDB`;
      if (d.eventRef.resolved === true) {
        if (ev.type !== "\u9AD8\u6F6E") return `\u300C${ev.name}\u300D\u662F\u5927\u4E8B\u4EF6\uFF08${ev.type}\uFF09\uFF0C\u53EA\u6709\u9AD8\u6F6E\u7C7B\u4E8B\u4EF6\u624D\u53EF\u58F0\u660E resolved`;
      }
    }
    const s = w.stats;
    let turnMonths = typeof d.timeCost === "number" ? Math.max(0, Math.floor(d.timeCost)) : d.cultivate?.months ?? 0;
    let turnGain = 0;
    let turnDual;
    let switchDone = false;
    let breakthroughDone = false;
    let breakthroughSuccess;
    let breakthroughRate;
    if (d.cultivate) {
      const method = s.methods.find((m) => m.name === s.mainMethod);
      if (method) {
        const months = CULTIVATE_MONTHS.includes(d.cultivate.months) ? d.cultivate.months : 1;
        let mult = 1;
        if (d.cultivate.mode === "dual") {
          const c = s.characters.find((c2) => c2.name === d.cultivate.partner);
          if (c && c.relationship === "\u9053\u4FA3") mult = DUAL_MULT;
          else if (c) mult = DUAL_MULT;
        }
        const rawGain = Math.round((method.efficiency || 4) * mult * months);
        const cap = cultivationCap(w);
        const before = s.cultivation;
        s.cultivation = Math.min(s.cultivation + rawGain, cap);
        turnGain = s.cultivation - before;
        turnMonths = months;
        turnDual = d.cultivate.mode === "dual" ? d.cultivate.partner : void 0;
      }
    }
    if (d.switchMain) {
      const method = s.methods.find((m) => m.name === d.switchMain.method);
      if (method && s.mainMethod !== d.switchMain.method) {
        turnMonths = 1;
        s.mainMethod = d.switchMain.method;
        switchDone = true;
      }
    }
    if (d.breakthrough) {
      const cap = cultivationCap(w);
      if (s.cultivation >= cap) {
        const bonus = s.breakBonus ?? 0;
        const rate = Math.min(1, (BREAKTHROUGH_RATES[s.realm] ?? 0.1) + bonus);
        breakthroughRate = rate;
        const roll = Math.random();
        breakthroughDone = true;
        breakthroughSuccess = roll < rate;
      }
    }
    const eventMsgs = advanceTime(w, turnMonths);
    w.meta.turns += 1;
    if (d.eventRef) {
      const ev = w.majorEvents.find((e) => e.name === d.eventRef.name);
      if (ev) {
        if (d.eventRef.resolved === true) {
          ev.status = "resolved";
        } else if (typeof d.eventRef.progress === "string" && d.eventRef.progress) {
        }
      }
    }
    if (d.delta) {
      const delta = d.delta;
      if (typeof delta.spiritStones === "number" && delta.spiritStones !== 0) {
        const v = Math.floor(delta.spiritStones);
        if (v < 0 && w.stats.spiritStones + v < 0) return `\u7075\u77F3\u4E0D\u8DB3\uFF1A\u9700 ${-v}\uFF0C\u73B0 ${w.stats.spiritStones}`;
        w.stats.spiritStones += v;
      }
      if (typeof delta.cultivation === "number" && delta.cultivation !== 0) {
        const v = Math.floor(delta.cultivation);
        w.stats.cultivation += v;
        if (w.stats.cultivation < 0) w.stats.cultivation = 0;
      }
      if (typeof delta.breakthroughDelta === "number" && delta.breakthroughDelta !== 0) {
        w.stats.breakBonus = (w.stats.breakBonus ?? 0) + delta.breakthroughDelta / 100;
      }
      if (typeof delta.hpDelta === "number" && delta.hpDelta !== 0) {
        w.stats.hp += Math.floor(delta.hpDelta);
        if (w.stats.hp > w.stats.maxHp) w.stats.hp = w.stats.maxHp;
        if (w.stats.hp < 0) w.stats.hp = 0;
        if (w.stats.hp <= 0) {
          w.meta.dead = true;
          w.meta.deathCause = "\u91CD\u4F24\u4E0D\u6CBB";
        }
      }
      if (Array.isArray(delta.pills)) {
        for (const p of delta.pills) {
          const amt = Math.floor(Number(p.amount) || 1);
          if (amt === 0) continue;
          if (amt > 0) {
            const eff = String(p.effectType || "heal");
            const realm = String(p.realm || "\u51E1\u4EBA");
            const existing = w.stats.pills.find((pp) => pp.name === p.name && pp.effectType === eff && pp.realm === realm);
            if (existing) existing.amount += amt;
            else w.stats.pills.push({ name: String(p.name), effectType: eff, realm, power: Number(p.power) || 10, amount: amt, source: "delta" });
          } else {
            const pill = w.stats.pills.find((pp) => pp.name === p.name);
            if (!pill || pill.amount < -amt) return `\u4E39\u836F\u300C${p.name}\u300D\u4E0D\u8DB3\uFF08\u9700 ${-amt}\uFF0C\u73B0 ${pill?.amount ?? 0}\uFF09`;
          }
        }
        for (const p of delta.pills) {
          const amt = Math.floor(Number(p.amount) || 0);
          if (amt >= 0) continue;
          const consume = -amt;
          const pill = w.stats.pills.find((pp) => pp.name === p.name);
          const pillRealmIdx = REALM_ORDER.indexOf(p.realm || pill.realm);
          const curRealmIdx = REALM_ORDER.indexOf(s.realm);
          let powerMult = 1;
          if (pillRealmIdx >= 0 && curRealmIdx >= 0) {
            const diff = Math.abs(pillRealmIdx - curRealmIdx);
            if (diff > 2) powerMult = 0;
            else if (diff === 2) powerMult = 0.5;
          }
          const effPower = Math.round((Number(p.power) || Number(pill.power) || 10) * powerMult);
          const effType = String(p.effectType || pill.effectType);
          if (effType === "cultivation") {
            s.cultivation += effPower * consume;
          } else if (effType === "breakthrough") {
            s.breakBonus = (s.breakBonus ?? 0) + effPower * consume / 100;
          } else if (effType === "heal") {
            const healed = Math.min(s.maxHp - s.hp, effPower * consume);
            s.hp += healed;
          } else if (effType === "lifespan") {
            s.lifespan += effPower * consume;
          }
          pill.amount += amt;
          if (pill.amount <= 0) w.stats.pills.splice(w.stats.pills.indexOf(pill), 1);
        }
      }
      if (Array.isArray(delta.methods)) {
        for (const m of delta.methods) {
          const action = String(m.action || "learn");
          if (action === "learn") {
            if (w.stats.methods.some((mm) => mm.name === m.name)) continue;
            const grade = typeof m.grade === "string" && m.grade in { "\u51E1\u54C1": 1, "\u9EC4\u9636": 1, "\u7384\u9636": 1, "\u5730\u9636": 1, "\u5929\u9636": 1 } ? m.grade : "\u51E1\u54C1";
            w.stats.methods.push({
              name: String(m.name),
              grade,
              efficiency: { "\u51E1\u54C1": 4, "\u9EC4\u9636": 24, "\u7384\u9636": 120, "\u5730\u9636": 600, "\u5929\u9636": 3e3 }[grade] ?? 4,
              techniques: (m.techniques || []).map((t) => ({
                name: String(t.name || "\u65E0\u540D"),
                description: String(t.description || ""),
                source: "delta"
              })),
              source: "delta"
            });
          } else if (action === "forget") {
            const idx = w.stats.methods.findIndex((mm) => mm.name === m.name);
            if (idx >= 0) {
              w.stats.methods.splice(idx, 1);
              if (w.stats.mainMethod === m.name) w.stats.mainMethod = w.stats.methods[0]?.name ?? null;
            }
          } else if (action === "teach") {
          }
        }
      }
    }
    if (Array.isArray(d.relationships)) {
      for (const r of d.relationships) {
        const c = s.characters.find((c2) => c2.name === r.npc);
        if (!c) continue;
        const delta = Number(r.delta);
        if (!Number.isFinite(delta)) continue;
        c.affinity = clampAffinity(c.affinity + delta);
      }
    }
    if (d.romance) {
      const c = s.characters.find((c2) => c2.name === d.romance.npc);
      if (c) {
        if (d.romance.action === "\u8868\u767D") {
          c.relationship = "\u9053\u4FA3";
          c.affinity = clampAffinity(100);
        } else {
        }
      }
    }
    if (typeof d.location === "string" && d.location.trim()) {
      s.location = d.location.trim();
    }
    if (Array.isArray(d.npcMoves)) {
      for (const m of d.npcMoves) {
        const npc = s.characters.find((c) => c.name === m.npc);
        if (npc && typeof m.location === "string" && m.location.trim()) {
          npc.location = m.location.trim();
        }
      }
    }
    if (Array.isArray(d.npcChanges)) {
      for (const ch of d.npcChanges) {
        const npc = s.characters.find((c) => c.name === ch.npc);
        if (npc && REALM_ORDER.includes(ch.realm)) {
          npc.realm = ch.realm;
          npc.cultivation = realmToCultivation(ch.realm);
        }
      }
    }
    ledger.saveAll();
    return null;
  };
}

// src/rules/choice.ts
function validateChoice(_ctx) {
  return null;
}
function validateOpening(_ctx) {
  return null;
}
function makeStorePendingBranch(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const turn = ctx.data.turn;
    const options = turn?.options;
    if (!options || !Array.isArray(options)) return null;
    w.pendingBranch = {
      turnId: w.meta.turns,
      options: options.map((o) => ({
        text: String(o.text || ""),
        risk: String(o.risk || "\u65E0"),
        branches: (o.branches || []).map((b) => ({
          id: String(b.id || b.title || ""),
          title: String(b.title || ""),
          kind: b.kind === "battle" ? "battle" : "other",
          prob: Number(b.prob) || 0.5,
          simpleDesc: String(b.simpleDesc || ""),
          requiresTechnique: typeof b.requiresTechnique === "string" ? b.requiresTechnique : void 0
        }))
      }))
    };
    ledger.saveAll();
    return null;
  };
}
function makeCheckLife(ledger) {
  return (w) => {
    if (w.stats.lifespan <= 0 && !w.meta.dead) {
      w.meta.dead = true;
      w.meta.deathCause = "\u5BFF\u5143\u8017\u5C3D";
      ledger.saveAll();
      return true;
    }
    return false;
  };
}

// src/rules/confrontation.ts
function matchBranchInput(inputText, pending) {
  if (!pending || !pending.options.length) return null;
  const t = (inputText || "").trim();
  if (!t) return null;
  for (let oi = 0; oi < pending.options.length; oi++) {
    const opt = pending.options[oi];
    const hitOption = t.includes(opt.text) || t.includes(`\u9009\u9879${oi + 1}`) || t.includes(`\u9009${oi + 1}`) || t === opt.text;
    if (!opt.branches || opt.branches.length === 0) {
      if (hitOption) return { optionIndex: oi, branchIndex: -1 };
      continue;
    }
    for (let bi = 0; bi < opt.branches.length; bi++) {
      const b = opt.branches[bi];
      if (t.includes(b.title) || t.includes(b.id) || t.includes(b.simpleDesc.slice(0, 8))) {
        return { optionIndex: oi, branchIndex: bi };
      }
    }
    if (hitOption) return { optionIndex: oi, branchIndex: -2 };
  }
  for (let oi = 0; oi < pending.options.length; oi++) {
    const opt = pending.options[oi];
    if (!opt.branches) continue;
    for (let bi = 0; bi < opt.branches.length; bi++) {
      if (t === opt.branches[bi].title) return { optionIndex: oi, branchIndex: bi };
    }
  }
  return null;
}
function pickBranch(branches) {
  const sum = branches.reduce((a, b) => a + Math.max(0, b.prob), 0);
  if (sum <= 0) return Math.floor(Math.random() * branches.length);
  let r = Math.random() * sum;
  for (let i = 0; i < branches.length; i++) {
    const w = Math.max(0, branches[i].prob);
    if (r < w) return i;
    r -= w;
  }
  return branches.length - 1;
}
function consumePendingBranch(inputText, w) {
  const pending = w.pendingBranch;
  if (!pending) return null;
  const match = matchBranchInput(inputText, pending);
  w.pendingBranch = null;
  if (!match) return null;
  const opt = pending.options[match.optionIndex];
  if (!opt.branches || opt.branches.length === 0) return null;
  const pickedIdx = pickBranch(opt.branches);
  const picked = opt.branches[pickedIdx];
  return { kind: picked.kind, title: picked.title, simpleDesc: picked.simpleDesc };
}
function makeApplyConfrontationBattle(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const d = ctx.data.battleConfrontation;
    const text = typeof d?.text === "string" && d.text ? d.text : "\u6218\u6597\u7ED3\u675F\u3002";
    const hpFromDelta = typeof d?.delta?.hpDelta === "number" ? Math.round(d.delta.hpDelta) : void 0;
    const hpDelta = hpFromDelta ?? 0;
    w.stats.hp += hpDelta;
    if (w.stats.hp > w.stats.maxHp) w.stats.hp = w.stats.maxHp;
    if (w.stats.hp <= 0 || d?.dead === true) {
      w.stats.hp = 0;
      w.meta.dead = true;
      w.meta.deathCause = "\u6218\u6B7B";
      ledger.saveAll();
      return null;
    }
    if (w.stats.hp < 0) w.stats.hp = 0;
    const delta = d?.delta;
    if (delta) {
      if (typeof delta.spiritStones === "number" && delta.spiritStones !== 0) {
        const v = Math.floor(delta.spiritStones);
        if (!(v < 0 && w.stats.spiritStones + v < 0)) {
          w.stats.spiritStones += v;
        }
      }
      if (typeof delta.cultivation === "number" && delta.cultivation !== 0) {
        const v = Math.floor(delta.cultivation);
        w.stats.cultivation += v;
        if (w.stats.cultivation < 0) w.stats.cultivation = 0;
      }
      if (typeof delta.breakthroughDelta === "number" && delta.breakthroughDelta !== 0) {
        w.stats.breakBonus = (w.stats.breakBonus ?? 0) + delta.breakthroughDelta / 100;
      }
      if (Array.isArray(delta.pills)) {
        for (const p of delta.pills) {
          const amt = Math.floor(Number(p.amount) || 0);
          if (amt > 0) {
            const eff = String(p.effectType || "heal");
            const realm = String(p.realm || "\u51E1\u4EBA");
            const existing = w.stats.pills.find((pp) => pp.name === p.name && pp.effectType === eff && pp.realm === realm);
            if (existing) existing.amount += amt;
            else w.stats.pills.push({ name: String(p.name), effectType: eff, realm, power: Number(p.power) || 10, amount: amt, source: "delta" });
          }
        }
      }
      if (Array.isArray(delta.methods)) {
        for (const m of delta.methods) {
          const action = String(m.action || "learn");
          if (action === "learn") {
            if (w.stats.methods.some((mm) => mm.name === m.name)) continue;
            const grade = typeof m.grade === "string" ? String(m.grade) : "\u51E1\u54C1";
            const techs = m.techniques || [];
            w.stats.methods.push({
              name: String(m.name),
              grade,
              efficiency: 4,
              techniques: techs.map((t) => ({ name: String(t.name || "\u65E0\u540D"), description: String(t.description || ""), source: "delta" })),
              source: "delta"
            });
          }
        }
      }
    }
    w.meta.turns += 1;
    ledger.saveAll();
    return null;
  };
}

// src/rules/index.ts
function createRules(ledger) {
  return {
    publicState,
    fmtStatus,
    fmtRealm,
    cultivationCap,
    worldSetting,
    applyWorldBase: makeApplyWorldBase(ledger),
    applyNpcPool: makeApplyNpcPool(ledger),
    applyOrigins: makeApplyOrigins(ledger),
    applyTalents: makeApplyTalents(ledger),
    applyCharacter: makeApplyCharacter(ledger),
    applyTurn: makeApplyTurn(ledger),
    applyConfrontationBattle: makeApplyConfrontationBattle(ledger),
    validateChoice,
    validateOpening,
    storePendingBranch: makeStorePendingBranch(ledger),
    checkLife: makeCheckLife(ledger),
    parseOriginPool,
    parseTalentPool,
    calcBreakthroughRate,
    applyBreakthrough: makeApplyBreakthrough(ledger)
  };
}

// src/views.ts
function createViews(rules) {
  const statusOf = (w) => rules.fmtStatus(w);
  function appendQuickBar(children, w) {
    const s = w.stats;
    const quick = [];
    const nonMain = s.methods.filter((m) => m.name !== s.mainMethod);
    for (const m of nonMain.slice(0, 3)) {
      quick.push({ component: "Button", props: { content: `\u4E3B\u4FEE${m.name}`, action: { type: "send", text: `\u4E3B\u4FEE${m.name}` } } });
    }
    if (s.mainMethod) {
      for (const mo of [1, 3, 12]) {
        quick.push({ component: "Button", props: { content: `\u95ED\u5173${mo}\u6708`, action: { type: "send", text: `\u95ED\u5173${mo}\u6708` } } });
      }
    }
    if (s.cultivation >= rules.cultivationCap(w)) {
      quick.push({ component: "Button", props: { content: "\u7A81\u7834", action: { type: "send", text: "\u7A81\u7834" } } });
    }
    if (quick.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: "\u5FEB\u6377\u64CD\u4F5C", size: "sm" } });
      for (let i = 0; i < quick.length; i += 3) {
        children.push({ component: "Row", props: { className: "gap-2 flex-wrap" }, children: quick.slice(i, i + 3) });
      }
    }
    if (s.pills.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: "\u4E39\u836F", size: "sm" } });
      for (const p of s.pills.slice(0, 4)) {
        const pillRow = [];
        if (p.amount >= 1) pillRow.push({ component: "Button", props: { content: `\u670D${p.name}\xD71`, action: { type: "send", text: `\u670D\u7528${p.name}\xD71` } } });
        if (p.amount >= 3) pillRow.push({ component: "Button", props: { content: `\u670D${p.name}\xD73`, action: { type: "send", text: `\u670D\u7528${p.name}\xD73` } } });
        if (p.amount > 1) pillRow.push({ component: "Button", props: { content: `\u670D${p.name}\u5168\u90E8(${p.amount})`, action: { type: "send", text: `\u670D\u7528${p.name}\u5168\u90E8` } } });
        if (pillRow.length) children.push({ component: "Row", props: { className: "gap-2 flex-wrap" }, children: pillRow });
      }
    }
  }
  function buildWorldScreen(ctx) {
    const w = ctx.state._w;
    const world = w.stats.world;
    const children = [
      { component: "Text", props: { content: `\u4E16\u754C \xB7 ${String(world?.name || "\u672A\u77E5\u5927\u9646")}`, size: "lg" } },
      { component: "Divider", props: {} }
    ];
    if (world) {
      const regions = world.regions || [];
      if (regions.length) children.push({ component: "Text", props: { content: `\u5730\u57DF\uFF1A${regions.join("\u3001")}`, size: "sm" } });
      const sects = world.sects || [];
      if (sects.length) children.push({ component: "Text", props: { content: `\u5B97\u95E8\uFF1A${sects.map((s) => `${s.name}\uFF08${s.stance}\xB7${s.location}\uFF09`).join("\u3001")}`, size: "sm" } });
      const towns = world.towns || [];
      if (towns.length) children.push({ component: "Text", props: { content: `\u57CE\u9547\uFF1A${towns.map((t) => t.name).join("\u3001")}`, size: "sm" } });
      if (world.law) children.push({ component: "Text", props: { content: `\u6CD5\u5219\uFF1A${String(world.law)}`, size: "sm" } });
      if (world.rumor) children.push({ component: "Text", props: { content: `\u4F20\u95FB\uFF1A${String(world.rumor)}`, size: "sm" } });
    }
    if (w.majorEvents.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: "\u5927\u4E8B\u4EF6", size: "sm" } });
      for (const e of w.majorEvents) {
        children.push({ component: "Text", props: { content: `${e.name}\uFF08${e.type}\uFF09\u7B2C${e.at}\u6708\u2192${e.by}\u6708\uFF1A${e.summary}`, size: "sm" } });
      }
    }
    return { component: "Column", props: { className: "gap-2" }, children };
  }
  function buildFirstScreen(ctx) {
    const w = ctx.state._w;
    const s = w.stats;
    const opening = ctx.data.opening;
    const opts = opening?.options || [];
    const children = [
      { component: "Text", props: { content: `\u540D\u5B57\u300C${s.name || "\u65E0\u540D"}\u300D\xB7 ${s.gender || ""}${s.temperament ? `\xB7${s.temperament}` : ""} \xB7 ${s.location}`, size: "lg" } },
      { component: "Divider", props: {} },
      { component: "Text", props: { content: opening?.text || "", size: "md" } },
      { component: "Divider", props: {} },
      { component: "Text", props: { content: statusOf(w), size: "sm" } }
    ];
    const nearbyFirst = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== "\u65E0"));
    if (nearbyFirst.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: `\u9644\u8FD1\u4E4B\u4EBA\uFF1A${nearbyFirst.slice(0, 5).map((c) => `${c.name}\uFF08${c.identity}\uFF09${affinityLabel(c.affinity)}${c.relationship !== "\u65E0" ? `\xB7${c.relationship}` : ""}`).join("\u3001")}`, size: "sm" } });
    }
    appendQuickBar(children, w);
    children.push({ component: "Divider", props: {} });
    children.push({ component: "Text", props: { content: "\u4F60\u6B32\u4F55\u4E3A\uFF1F", size: "sm" } });
    for (let i = 0; i < opts.length; i += 2) {
      const row = opts.slice(i, i + 2);
      children.push({
        component: "Row",
        props: { className: "gap-2 flex-wrap" },
        children: row.map((o) => ({
          component: "Button",
          props: {
            content: o.risk === "\u65E0" ? o.text : `${o.text}\uFF08${o.risk}\u98CE\u9669\uFF09`,
            action: { type: "send", text: o.text }
          }
        }))
      });
    }
    return { component: "Column", props: { className: "gap-2" }, children };
  }
  function buildPlayScreen(ctx) {
    const w = ctx.state._w;
    if (w.meta.dead) return buildDeathScreen(ctx);
    const s = w.stats;
    const battleBeat = ctx.data.battleConfrontation;
    const beat = battleBeat?.text ? battleBeat : ctx.data.turn;
    const opts = ctx.data.choice?.options || ctx.data.turn?.options || [];
    const children = [
      { component: "Text", props: { content: `${rules.fmtRealm(w)} \xB7 ${s.location} \xB7 ${fmtTime(w)}`, size: "lg" } },
      { component: "Divider", props: {} }
    ];
    const actives = w.majorEvents.filter((e) => e.status === "active");
    if (actives.length) {
      children.push({ component: "Text", props: { content: "\u3010\u8FDB\u884C\u4E2D\u7684\u5927\u4E8B\u4EF6\u3011", size: "sm" } });
      for (const e of actives) {
        children.push({ component: "Text", props: { content: `\u26A1 ${e.name}\uFF08${e.type}\uFF09\u7B2C${e.by}\u6708\u524D\u987B\u4E86\u7ED3\uFF1A${e.summary}`, size: "sm" } });
      }
      children.push({ component: "Divider", props: {} });
    }
    children.push({ component: "Text", props: { content: statusOf(w), size: "sm" } });
    children.push({ component: "Divider", props: {} });
    if (beat?.text) children.push({ component: "Text", props: { content: beat.text, size: "md" } });
    const nearby = s.characters.filter((c) => c.location === s.location && (c.affinity > 0 || c.relationship !== "\u65E0"));
    if (nearby.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: `\u9644\u8FD1\u4E4B\u4EBA\uFF1A${nearby.slice(0, 5).map((c) => `${c.name}\uFF08${c.identity}\uFF09${affinityLabel(c.affinity)}${c.relationship !== "\u65E0" ? `\xB7${c.relationship}` : ""}`).join("\u3001")}`, size: "sm" } });
    } else {
      const dao = s.characters.filter((c) => c.relationship === "\u9053\u4FA3");
      if (dao.length) {
        children.push({ component: "Divider", props: {} });
        children.push({ component: "Text", props: { content: `\u9053\u4FA3\uFF1A${dao.map((c) => `${c.name}\uFF08${c.identity}\uFF09`).join("\u3001")}`, size: "sm" } });
      }
    }
    appendQuickBar(children, w);
    if (opts.length) {
      children.push({ component: "Divider", props: {} });
      children.push({ component: "Text", props: { content: "\u4F60\u6B32\u4F55\u4E3A\uFF1F", size: "sm" } });
      for (let i = 0; i < opts.length; i += 2) {
        const row = opts.slice(i, i + 2);
        children.push({
          component: "Row",
          props: { className: "gap-2 flex-wrap" },
          children: row.map((o) => ({
            component: "Button",
            props: {
              content: o.risk === "\u65E0" ? o.text : `${o.text}\uFF08${o.risk}\u98CE\u9669\uFF09`,
              action: { type: "send", text: o.text }
            }
          }))
        });
      }
    }
    return { component: "Column", props: { className: "gap-2" }, children };
  }
  function buildDeathScreen(ctx) {
    const w = ctx.state._w;
    const battleText = ctx.data.battleConfrontation?.text || "";
    const children = [
      { component: "Text", props: { content: "\u8EAB\u6B7B\u9053\u6D88", size: "lg" } },
      { component: "Divider", props: {} },
      ...battleText ? [{ component: "Text", props: { content: battleText, size: "md" } }] : [],
      ...battleText ? [{ component: "Divider", props: {} }] : [],
      { component: "Text", props: { content: w.meta.deathCause || "\u4F60\u6B7B\u4E86\u3002", size: "md" } },
      { component: "Divider", props: {} },
      { component: "Text", props: { content: `\u5386 ${w.meta.turns} \u56DE\u5408 \xB7 \u5883\u754C ${rules.fmtRealm(w)} \xB7 \u4F60\u957F\u7720\u4E8E${w.stats.location || "\u65E0\u540D\u4E4B\u5730"}\u3002`, size: "sm" } },
      { component: "Divider", props: {} },
      {
        component: "Button",
        props: { content: "\u8F6C\u4E16\u91CD\u4FEE", action: { type: "send", text: "\u8F6C\u4E16\u91CD\u4FEE" } }
      }
    ];
    return { component: "Column", props: { className: "gap-2" }, children };
  }
  return {
    buildWorldScreen,
    buildFirstScreen,
    buildPlayScreen,
    buildDeathScreen
  };
}

// src/flows/helpers.ts
function initCtx(ledger) {
  return (ctx) => {
    ctx.state._w = ledger.getWorld(ctx.conversationId ?? "");
  };
}
function resetWorld(ctx) {
  const w = ctx.state._w;
  const fresh = newWorld();
  w.meta.initialized = false;
  w.meta.created = false;
  w.meta.dead = false;
  w.meta.deathCause = void 0;
  w.meta.turns = 0;
  w.stats = fresh.stats;
  w.majorEvents = [];
  w.pendingBranch = null;
}
function resetCharacter(ctx) {
  const w = ctx.state._w;
  w.meta.created = false;
  w.meta.dead = false;
  w.meta.deathCause = void 0;
  w.meta.turns = 0;
  w.stats.name = "";
  w.stats.gender = "\u7537";
  w.stats.temperament = "";
  w.stats.realm = "\u51E1\u4EBA";
  w.stats.realmStage = 1;
  w.stats.cultivation = 0;
  w.stats.lifespan = 80;
  w.stats.timeMonth = 0;
  w.stats.npcGrowthMonths = 0;
  w.stats.location = "";
  w.stats.hp = 100;
  w.stats.maxHp = 100;
  w.stats.spiritStones = 0;
  w.stats.methods = [];
  w.stats.mainMethod = null;
  w.stats.talents = null;
  w.stats.pills = [];
  w.stats.breakBonus = 0;
  w.pendingBranch = null;
}

// src/prompts.ts
var PROTOCOL_PROMPT = `\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u63D2\u4EF6\u7684\u8C03\u5EA6\u5668\u3002\u73A9\u5BB6\u4ECE\u51E1\u4EBA\u8D77\u6B65\uFF0C\u5386\u7EC3\u7EC3\u6C14/\u7B51\u57FA/\u91D1\u4E39/\u5143\u5A74/\u5316\u795E\u4E94\u5883\uFF0C\u4E16\u754C\u7531\u5927\u9646/\u5730\u57DF/\u5B97\u95E8/\u57CE\u9547/\u6CD5\u5219\u6784\u6210\uFF0C\u5927\u4E8B\u4EF6\u9A71\u52A8\u673A\u9047/\u5371\u673A\uFF0C\u6570\u503C\u4F53\u7CFB\u542B\u4FEE\u4E3A/\u7075\u77F3/\u4E39\u836F/\u529F\u6CD5/\u672F\u6CD5/\u597D\u611F/\u5BFF\u5143\u3002\u4E25\u7981\u8DF3\u51FA\u4FEE\u4ED9\u8BBE\u5B9A\u3002

\u3010\u6536\u8F6E\u94C1\u5F8B\xB7\u6700\u9AD8\u4F18\u5148\u7EA7\u3011\u9664 game_query \u5916\uFF0C\u7981\u6B62\u7528\u6587\u672C\u5411\u73A9\u5BB6\u56DE\u590D\u4EFB\u4F55\u5185\u5BB9\uFF08\u5305\u62EC\u5267\u60C5\u8F6C\u8FF0\u3001\u603B\u7ED3\u3001\u63D0\u95EE\uFF09\uFF1B\u672C\u8F6E\u8BA1\u5212\u7684\u5DE5\u5177\u5168\u90E8\u4E32\u884C\u6210\u529F\u540E\uFF0C\u7ACB\u5373\u8C03\u7528 host_yield \u6536\u8F6E\uFF0Chost_yield \u524D\u540E\u4E0D\u5F97\u5939\u5E26\u4EFB\u4F55\u6587\u672C\u3002UI \u5DF2\u81EA\u52A8\u6E32\u67D3\u5DE5\u5177\u7ED3\u679C\u7ED9\u73A9\u5BB6\uFF0C\u4F60\u65E0\u9700\u590D\u8FF0\u3002

\u3010create_world\u3011\u5F53\u73A9\u5BB6\u8BF4\u201C\u8FDB\u5165\u4FEE\u4ED9\u4E16\u754C/\u91CD\u5F00\u4E16\u754C/\u5168\u65B0\u4E16\u754C\u201D\u65F6\u8C03\u3002\u73A9\u5BB6\u63D0\u4F9B\u8FDB\u5165\u613F\u671B\uFF0C\u4F60\u521B\u5EFA\u65B0\u4E16\u754C\uFF08\u4E4B\u540E\u518D->generate_major_events->create_character\uFF0C**\u4E09\u6B65\u5FC5\u987B\u5168\u90E8\u5B8C\u6210\uFF0C\u7F3A\u4E00\u4E0D\u53EF\uFF0C\u4E2D\u9014\u7981\u6B62\u6536\u8F6E**\uFF09\u3002
\u3010create_character\u3011\u5F53\u5DF2\u6709\u4E16\u754C\u4E14\u73A9\u5BB6\u63D0\u4F9B\u59D3\u540D/\u6027\u522B/\u6027\u683C/\u51FA\u8EAB\u504F\u597D\uFF0C\u6216\u9700\u5EFA\u89D2\u65F6\u8C03\u3002\u9009\u5B9A\u51FA\u8EAB\u5929\u8D44\u5EFA\u89D2\u3002\u5EFA\u89D2\u5B8C\u6210\u540E\u624D\u53EF\u6536\u8F6E\u3002
\u3010reset_character\u3011\u5F53\u73A9\u5BB6\u8BF4\u201C\u6362\u4E2A\u89D2\u8272/\u7528\u6B64\u4E16\u754C\u91CD\u6765/\u91CD\u4FEE\u201D\u65F6\u8C03\uFF0C\u4FDD\u7559\u4E16\u754C\u4EC5\u91CD\u5EFA\u89D2\u8272\u3002
\u3010era_rebirth\u3011\u5F53\u73A9\u5BB6\u8BF4\u201C\u767E\u5E74\u540E/\u8F6E\u56DE\u201D\u65F6\u8C03\uFF0C\u6839\u636E\u5E74\u6570\u63A8\u6F14\u65B0\u4E16\u754C\u3002
\u3010generate_major_events\u3011\u5F53\u4E16\u754C\u521D\u521B\u540E\u6216\u6BCF\u8FC7\u4E94\u5341\u5E74/\u5927\u4E8B\u4EF6\u4E0D\u8DB3\u65F6\u8C03\uFF0C\u8865\u5145\u672A\u6765\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6\u3002
\u3010generate_npcs\u3011\u5F53\u4E16\u754C\u521D\u521B\u540E\u3001generate_major_events \u524D\u8C03\u7528\uFF0C\u751F\u6210\u4E00\u6279 NPC\uFF0810 \u4EBA\uFF0C\u51E1\u4EBA2+\u4FEE\u58EB7+\u5927\u4FEE\u58EB1\uFF09\uFF1B\u53EF\u8FDE\u7EED\u8C03\u7528 3 \u6B21\u6269\u5145 NPC \u6C60\uFF08\u6BCF\u6B21\u4E00\u6279\u81EA\u52A8\u9632\u91CD\u540D\uFF09\uFF0C\u5EFA\u89D2\u524D\u5B8C\u6210\u3002
\u3010game_turn\u3011\u5F53\u73A9\u5BB6\u8FDB\u884C\u5267\u60C5\u884C\u52A8\u3001\u5BF9\u8BDD\u3001\u63A2\u7D22\u3001\u4FEE\u70BC/\u7A81\u7834/\u5207\u4E3B\u4FEE\u3001\u670D\u7528\u4E39\u836F\u3001\u6218\u6597\u6289\u62E9\u65F6\u8C03\u3002\u73A9\u5BB6\u63D0\u4F9B\u6216\u9009\u62E9\u7ED9\u51FA\u7684\u5267\u60C5\u884C\u52A8\uFF0C\u4F60\u63A8\u6F14\u4E00\u8F6E\u5267\u60C5\u4E0E\u6570\u503C\u3002\u8BE5\u5DE5\u5177\u4E00\u8F6E\u5BF9\u8BDD\u6700\u591A\u53EA\u80FD\u8C03\u7528\u4E00\u6B21\uFF0C\u4E4B\u540E\u5C31\u7528host_yield\u7ED3\u675F\uFF0C\u7981\u6B62\u518D\u52A0\u6587\u672C\uFF08\u6CE8\u610F\u5206\u8FA8\u5355\u8F6E\u8D77\u59CB\u5E94\u7531\u7528\u6237\u53D1\u8D77\uFF0C\u800C\u975E\u5DE5\u5177\u5B8C\u6210\u4E8B\u4EF6\uFF0C\u4E0D\u8981\u88AB\u4E0A\u4E00\u8F6E\u7684game_turn\u8BEF\u5BFC\u5BFC\u81F4\u8FDE\u53D1game_turn\uFF09\u3002
\u3010game_query\u3011\u5F53\u73A9\u5BB6\u95EE\u7EAF\u89C4\u5219/\u4E16\u754C\u89C2/\u6570\u503C/\u6863\u6848\u4E14\u4E0D\u63A8\u5267\u60C5\u65F6\u8C03\u3002\u73A9\u5BB6\u63D0\u4F9B\u5173\u952E\u8BCD\uFF0C\u4F60\u8C03\u7528\u8BE5\u5DE5\u5177\u83B7\u53D6\u7B54\u6848\u540E\u8F6C\u6362\u6210\u6587\u672C\u56DE\u7B54\uFF08\u552F\u4E00\u53EF\u7528\u6587\u672C\u56DE\u7B54\u800C\u975E\u5DE5\u5177\u8C03\u7528\u7684\u573A\u666F\uFF09\u3002
\u3010host_yield\u3011\u4E00\u8F6E\u7684\u7ED3\u675F\u6807\u5FD7\u3002\u4E00\u8F6E\u5185\u53EF\u80FD\u4E32\u884C\u8C03\u591A\u4E2A\u5DE5\u5177\uFF08\u5982 create_world\u2192generate_major_events->create_character\uFF09\uFF0C\u6240\u6709\u5DE5\u5177\u90FD\u4E32\u884C\u6210\u529F\uFF08\u4E00\u6B21tool_calls\u540E\u8FD4\u56DE\u5BF9\u5E94\u7ED3\u679C\uFF09\u540E\u624D\u8C03\u4E00\u6B21 host_yield \u7ED3\u675F\u672C\u8F6E\uFF0C\u7B49\u5F85\u73A9\u5BB6\u4E0B\u4E00\u6761\u6D88\u606F\u3002\u82E5\u6BCF\u8C03\u4E00\u4E2A\u5DE5\u5177\u5C31\u8C03 host_yield\uFF0C\u4F1A\u63D0\u524D\u7EC8\u6B62\u5BFC\u81F4\u540E\u7EED\u5DE5\u5177\u65E0\u6CD5\u6267\u884C\u3002
\u3010\u79BB\u5F00\u3011\u5F53\u73A9\u5BB6\u8BF4\u201C\u79BB\u5F00/\u9000\u51FA\u4FEE\u4ED9\u4E16\u754C\u201D\u65F6\u8C03 host_exit_subcontext\u3002
\u3010\u6B7B\u4EA1\u3011\u6218\u6B7B/\u5BFF\u5C3D\u540E\u4EC5\u80FD create_world\u2192generate_major_events\u2192create_character \u6216 reset_character \u91CD\u5F00\u3002
\u3010\u5355\u6B21\u5355\u5DE5\u5177\u3011\u6BCF\u6B21\u5FC5\u987B\u53EA\u80FD\u8C03\u7528\u4E00\u4E2A\u5DE5\u5177\uFF0C\u6BCF\u8F6E\u5BF9\u8BDD\u53EF\u4E32\u884C\u8C03\u7528\u591A\u4E2A\u5DE5\u5177\uFF0C\u6700\u540E\u4EE5host_yield\u7ED3\u5C3E\u7EC8\u6B62\uFF08\u8BE5\u5DE5\u5177\u4EE3\u8868\u672C\u8F6E\u7ED3\u675F\uFF0C\u907F\u514D\u65E0\u9650\u9012\u5F52\uFF0C\u6BCF\u8F6E\u7ED3\u675F\u65F6\u5FC5\u987B\u8C03\u7528\uFF09\uFF0C\u4F46 game_turn \u4F5C\u4E3A\u5267\u60C5\u63A8\u52A8\u5DE5\u5177\uFF0C\u5355\u8F6E\u6700\u591A\u8C03\u7528\u4E00\u6B21\uFF0C\u5FC5\u987B\u4E25\u683C\u9075\u5B88\u3002
\u3010\u5931\u8D25\u5904\u7406\u3011\u5DE5\u5177\u5931\u8D25\u8BFB error \u91CD\u8BD5\u540C\u4E00\u5DE5\u5177\uFF0C\u6700\u591A\u4E09\u6B21\uFF0C\u5982\u9047\u5230\u65E0\u6CD5\u89E3\u51B3\u7684\u5E95\u5C42\u9519\u8BEF\u5219\u505C\u6B62\u3002

\u3010\u5DE5\u5177\u6307\u793A\u3011\u5DE5\u5177\u6267\u884C\u5B8C\u6210\u540E\uFF0C\u7CFB\u7EDF\u4F1A\u4EE5\u4E00\u6761\u5E26\u3010\u7CFB\u7EDF\u63D0\u793A\u3011\u6807\u8BB0\u7684 user \u6D88\u606F\u63D2\u5165\u5DE5\u5177\u6267\u884C\u72B6\u6001\u4E0E\u4E0B\u4E00\u6B65\u6307\u793A\uFF1A\u6210\u529F\u65F6\u662F\u4E0B\u4E00\u6B65 instruction\uFF08\u5982"\u8BF7\u7D27\u8DDF generate_major_events"\uFF09\uFF0C\u5931\u8D25\u65F6\u662F"\u5DE5\u5177 xx \u6267\u884C\u5931\u8D25\uFF1A\u539F\u56E0\uFF0C\u8BF7\u91CD\u8BD5\u8BE5\u5DE5\u5177\u6216\u6539\u7528\u5176\u4ED6\u5DE5\u5177"\u3002**\u3010\u7CFB\u7EDF\u63D0\u793A\u3011\u6807\u8BB0\u7684\u6D88\u606F\u4E0D\u662F\u73A9\u5BB6\u53D1\u8A00\uFF0C\u800C\u662F\u7CFB\u7EDF\u66FF\u4F60\u62DF\u597D\u7684\u6536\u5C3E\u8BDD\u4E0E\u4E0B\u4E00\u6B65\u6307\u793A**\u3002\u6536\u5230\u540E\u6309\u5176\u4E2D\u5185\u5BB9\u7EE7\u7EED\u8C03\u7528\u4E0B\u4E00\u4E2A\u5DE5\u5177\uFF0C\u76F4\u81F3\u672C\u8F6E\u76EE\u6807\u5B8C\u6210\u518D host_yield \u6536\u8F6E\uFF1B\u82E5\u6307\u793A\u6D88\u606F\u53EA\u6709\u6267\u884C\u72B6\u6001\u3001\u6CA1\u6709\u5177\u4F53\u52A8\u4F5C\u6307\u5F15\uFF08\u5982"\u672C\u8F6E\u5267\u60C5\u5DF2\u63A8\u9001\u5B8C\u6BD5\uFF0C\u7981\u6B62\u518D\u6B21\u8C03\u7528 game_turn"\uFF09\uFF0C\u8BF4\u660E\u672C\u8F6E\u5DE5\u5177\u94FE\u5DF2\u7ED3\u675F\uFF0C\u7ACB\u5373 host_yield \u6536\u8F6E\uFF0C\u4E0D\u5F97\u7EE7\u7EED\u8C03\u7528\u5176\u4ED6\u5DE5\u5177\uFF0C\u66F4\u4E0D\u5F97\u628A\u3010\u7CFB\u7EDF\u63D0\u793A\u3011\u5F53\u6210\u73A9\u5BB6\u65B0\u8F93\u5165\u6765\u63A8\u8FDB\u5267\u60C5\u3002

\u3010\u8BB0\u5FC6\u3011\u5BBF\u4E3B\u901A\u7528\u8BB0\u5FC6\u5C42\uFF08host_memory_*\uFF09\u6309\u4F1A\u8BDD+\u4E0A\u4E0B\u6587\u9694\u79BB\uFF0C\u957F\u671F\u4FDD\u5B58\uFF1B\u4E16\u754C\u72B6\u6001\u5361\u4E0E\u5267\u60C5\u53F2\u7531\u7CFB\u7EDF\u81EA\u52A8\u7EF4\u62A4\uFF0C\u65E0\u9700\u4F60\u5199\u5165\u3002\u4F60\u53EA\u9700\uFF1A\u73A9\u5BB6\u660E\u786E\u8981\u6C42\u8BB0\u4F4F\u7684\u7EA6\u5B9A/\u76EE\u6807 \u2192 host_memory_set \u5199\u5165\uFF08slot \u7528\u8BED\u4E49\u5316\u952E\u540D\uFF0C\u91CD\u590D\u5199\u5165\u8986\u76D6\uFF09\uFF1BNPC \u5173\u952E\u6863\u6848\u7EC6\u8282\uFF08\u8EAB\u4E16/\u79D8\u5BC6/\u53E3\u5934\u627F\u8BFA\uFF09\u2192 \u53EF\u5199 char_* slot\u3002\u56DE\u7B54\u73A9\u5BB6\u5173\u4E8E\u8FC7\u5F80\u7684\u95EE\u9898\u65F6\uFF0C\u82E5\u8FD1\u671F\u5BF9\u8BDD\u65E0\u636E\u53EF\u67E5\uFF0C\u5148\u7528 host_memory_search \u68C0\u7D22\u518D\u4F5C\u7B54\uFF0C\u52FF\u51ED\u7A7A\u7F16\u9020\u3002

\u518D\u6B21\u5F3A\u8C03\u6536\u8F6E\u94C1\u5F8B\uFF1A\u975E game_query \u573A\u666F\u4E00\u5F8B\u96F6\u6587\u672C\u8F93\u51FA\uFF0C\u5DE5\u5177\u94FE\u5B8C\u6210\u5373\u8C03 host_yield\uFF0C\u65E0\u4F8B\u5916\u3002`;
var WORLD_BASE_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u4E16\u754C\u751F\u6210\u5668\u3002\u73A9\u5BB6\u521D\u4E34\uFF0C\u9700\u751F\u6210\u81EA\u6D3D\u7684\u4FEE\u4ED9\u4E16\u754C\u9AA8\u67B6\u3002\u8981\u6C42\uFF1A\u5927\u9646\u540D\u552F\u4E00\uFF0C\u5730\u57DF/\u5B97\u95E8/\u57CE\u9547\u5404 6-10 \u4E2A\uFF0C\u5B97\u95E8\u9700\u542B\u6B63\u9B54\u4E2D\u7ACB\u7ACB\u573A\uFF0C\u6CD5\u5219\u4E0E\u4F20\u95FB\u9700\u81EA\u6D3D\u3002\u53EA\u8F93\u51FA world\u3002";
var MAJOR_EVENTS_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u5927\u4E8B\u4EF6\u63A8\u6F14\u8005\u3002\u73A9\u5BB6\u5DF2\u7ACB\u8DB3\u5F53\u524D\u6708\uFF0C\u9700\u4E3A\u672A\u6765\u4E94\u5341\u5E74\u63A8\u6F14\u5927\u4E8B\u4EF6\u65F6\u95F4\u7EBF\u3002\u8981\u6C42\uFF1A15-30 \u6761\uFF0C\u5747\u5300\u5206\u5E03\u5728\u672A\u6765 50 \u5E74\u5185\uFF08\u7B2C 1 \u5E74\u5230\u7B2C 50 \u5E74\u94FA\u5F00\uFF0C\u4E0D\u8981\u624E\u5806\u5728\u5F00\u5934\uFF1B\u53EF\u95F4\u9694\u6570\u6708\u5230\u6570\u5E74\u4E00\u6761\uFF09\uFF0C\u8282\u594F\u524D\u673A\u9047\u540E\u9AD8\u6F6E\uFF0Cat>\u5F53\u524D\u6708\u4E14\u2264\u5F53\u524D\u6708+600\uFF0Cby>at+6\u3002\u53EA\u8F93\u51FA majorEvents\u3002";
var ORIGINS_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u51FA\u8EAB\u8BBE\u8BA1\u8005\u3002\u73A9\u5BB6\u7684\u5C18\u4E16\u8EAB\u4EFD\u5C06\u51B3\u5B9A\u8D77\u70B9\u3002\u8981\u6C42\uFF1A2-4 \u4E2A\u51FA\u8EAB\uFF0Clocation \u987B\u4E3A\u4E16\u754C\u5DF2\u6709\u5730\u57DF/\u57CE\u9547\u6216 NPC \u6240\u5728\u5730\uFF0C\u521D\u59CB\u7075\u77F3 0-50\uFF08\u5883\u754C\u53EF\u4E3A\u51E1\u4EBA/\u7EC3\u6C14\uFF09\uFF0C\u521D\u59CB\u597D\u611F\u4E00\u5F8B\u226430\uFF08\u76F8\u8BC6\u5185\uFF09\uFF0C\u51FA\u8EAB\u5DEE\u5F02\u5316\u3002";
var TALENTS_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u5929\u8D44\u8BBE\u8BA1\u8005\u3002\u4E3A\u73A9\u5BB6\u8BBE\u8BA1\u5148\u5929\u6C14\u8FD0\u8BCD\u6761\u3002\u8981\u6C42\uFF1A9 \u6761 6\u54093\u51F6\uFF0C\u4EC5\u8BCD\u6761\u65E0\u6570\u503C\uFF0C\u5409\u51F6\u5206\u660E\uFF0C\u51F6\u5409\u5DEE\u5F02\u3002";
var CHAR_CREATE_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u4E3B\u6301\u8005\u3002\u73A9\u5BB6\u5DF2\u5B9A\u4E16\u754C\uFF0C\u4E3A\u5176\u62E9\u5B9A\u6B64\u4E16\u8EAB\u4EFD\u3002\u8981\u6C42\uFF1A\u4ECE\u51FA\u8EAB\u6C60\u90091\u51FA\u8EAB\uFF0C\u4ECE\u5929\u8D44\u6C609\u6761\u4E2D\u62BD3\u6761\uFF08\u5409\u51F6\u6743\u8861\uFF09\uFF0C\u53D6\u540D1-12\u5B57\uFF0C\u6027\u522B\u7537/\u5973\uFF0C\u6027\u683C2-8\u5B57\u72EC\u7ACB\u4E8E\u5929\u8D44\u3002\u82E5\u73A9\u5BB6\u521D\u8F93\u542B\u6307\u5411\u5219\u4F18\u5148\u91C7\u7EB3\u3002";
var OPENING_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u8BF4\u4E66\u4EBA\u3002\u73A9\u5BB6\u521A\u5B8C\u6210\u5EFA\u89D2\uFF0C\u9700\u5199\u5F00\u573A\u7AE0\u8282\u3002\u8981\u6C42\uFF1A200-400\u5B57\u7B2C\u4E8C\u4EBA\u79F0\uFF0C\u542B\u2460\u6240\u5728\u5730\u57DF/\u5B97\u95E8\u2461\u666F\u8C61\u6C1B\u56F4\u24621-2\u53E5\u6765\u5386\u8FC7\u6E21\u2463\u547C\u5E94\u51FA\u8EAB\u6027\u683C\uFF0C\u7ED9 2-4 \u9009\u9879\u5404\u226420\u5B57\u53EF\u542B\u98CE\u9669\u3002";
var TURN_SYSTEM = '\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u8BF4\u4E66\u4EBA\u3002\u73A9\u5BB6\u4EE5\u7B2C\u4E8C\u4EBA\u79F0\u63A8\u8FDB\u7AE0\u8282\u3002\u9002\u5F53\u5206\u6BB5\u4F18\u5316\u9605\u8BFB\u4F53\u9A8C\uFF0C\u5BF9\u8BDD\u589E\u52A0\u4EBA\u5473\uFF0C\u53D9\u4E8B\u907F\u514D\u8FC7\u5EA6\u6587\u9752\u7684AI\u5473\u3002\u63A8\u5267\u60C5\u4E14\u586B timeCost 0-\u6570\u5341\u6708\u81EA\u5B9A\uFF0C\u5927\u4E8B\u4EF6 active \u5FC5\u5E26 eventRef\uFF0C\u65E5\u5E38\u53EF\u4E0D\u5E26\uFF1B\u5F97\u5931\u8D70 delta \u6B63\u8D1F\uFF08\u9003\u79BB\u53EF\u8D1F\uFF09\uFF1BNPC \u4EC5\u5F15\u771F\u4EBA\uFF1B\u597D\u611F\u6309\u5F53\u524D\u503C\u5199\u6001\u5EA6\uFF08-20~20\uFF0C\u521D\u8BC6+1~5\uFF09\uFF1B\u4FEE\u70BC\u6309\u4E3B\u4FEE\u6548\u7387\uFF0C\u53EF\u6839\u636E\u5267\u60C5\u9002\u5F53\u63D0\u5347\uFF1B\u5267\u60C5\u4E2D\u53EF\u83B7\u53D6\u6216\u6D88\u8017\u5404\u79CD\u5404\u6837\u7684\u8D44\u6E90\uFF08\u6218\u6597\u3001\u673A\u9047\u3001\u7B49\u7B49\uFF09\uFF0C\u6570\u503C\u7531 delta \u7ED3\u7B97\uFF0C\u7531\u4F60\u81EA\u5DF1\u642D\u914D\u5267\u60C5\u5408\u7406\u51B3\u5B9A\uFF08\u6CE8\u610F\u53C2\u8003schema\u4E2D\u7684\u8BF4\u660E\u90E8\u5206\uFF09\u3002\u7981\u6B62\u4E71\u5165\u4E0D\u5728\u9644\u8FD1\u7684npc\u63BA\u548C\u5267\u60C5\uFF0C\u8981\u57FA\u4E8Enpc\u6240\u5728\u5730\u57DF\u4E0E\u4FEE\u4E3A\u7B49\u8003\u8651\u4EA4\u4E92\u5267\u60C5\u3002\u3010\u4F4D\u7F6E\u3011\u73A9\u5BB6\u884C\u52A8\u6D89\u53CA\u8D76\u8DEF/\u79BB\u5F00/\u5230\u8FBE\u65F6\u586B location\uFF08\u79FB\u52A8\u540E\u7684\u4F4D\u7F6E\uFF09\uFF0C\u539F\u5730\u505C\u7559\u7701\u7565\uFF1B"\u9644\u8FD1\u7684\u4EBA"\u7531\u4F4D\u7F6E\u51B3\u5B9A\uFF0C\u79FB\u52A8\u540E\u53EA\u6709\u65B0\u4F4D\u7F6E\u9644\u8FD1\u7684 NPC \u53EF\u4EA4\u4E92\u3002NPC \u4F4D\u7F6E\u53D8\u66F4\uFF08\u968F\u884C/\u544A\u522B/\u524D\u5F80\u67D0\u5730\uFF09\u7528 npcMoves \u58F0\u660E\uFF0C\u987B\u7ED3\u5408\u8BE5 NPC \u4E2A\u4EBA\u80CC\u666F\u3001\u4E0E\u73A9\u5BB6\u597D\u611F\u3001\u5927\u4E8B\u4EF6\u8D70\u5411\u5408\u7406\u51B3\u5B9A\uFF0C\u4E0D\u8981\u65E0\u6545\u79FB\u52A8\u3002NPC \u5883\u754C\u53D8\u5316\uFF08\u7A81\u7834/\u8DCC\u843D\uFF09\u7528 npcChanges \u58F0\u660E\u5E76\u7ED9\u51FA\u539F\u56E0\uFF08\u7A81\u7834\u673A\u7F18/\u8D70\u706B\u5165\u9B54\u7B49\uFF09\uFF0C\u4E0D\u8981\u65E0\u6545\u6539\u5883\u754C\u3002\u3010\u5267\u60C5\u5408\u7406\u6027\u3011\u5267\u60C5\u89C4\u6A21\u987B\u4E0E\u73A9\u5BB6\u8EAB\u4EFD\u5B9E\u529B\u76F8\u79F0\uFF1A\u73A9\u5BB6\u4E0D\u5E94\u6210\u4E3A\u8D85\u51FA\u81EA\u8EAB\u5C42\u7EA7\u4E8B\u4EF6\u7684\u4E3B\u89D2\uFF1B\u5F15\u5165\u7684\u4EBA\u7269\u3001\u5730\u70B9\u3001\u51B2\u7A81\u987B\u5728\u73A9\u5BB6\u8BA4\u77E5\u4E0E\u5173\u7CFB\u8303\u56F4\u5185\uFF0C\u5C0A\u91CD\u5883\u754C\u538B\u5236\u4E0E\u4FEE\u4ED9\u4E16\u754C\u79E9\u5E8F\u3002\u3010\u5267\u60C5\u8854\u63A5\u3011\u8F93\u5165\u4E2D\u7684\u3010\u804A\u5929\u8BB0\u5F55\u3011\u4E0E\u3010\u5267\u60C5\u53F2\u3011\u662F\u6B64\u524D\u56DE\u5408\u7684\u5B9E\u9645\u5267\u60C5\uFF0C\u7EED\u5199\u5FC5\u987B\u8854\u63A5\u5176\u60C5\u8282\u3001\u4EBA\u7269\u5173\u7CFB\u4E0E\u73A9\u5BB6\u5DF2\u505A\u9009\u62E9\uFF0C\u4E0D\u5F97\u5F53\u4F5C\u521D\u9047\u91CD\u65B0\u5C55\u5F00\uFF0C\u4E0D\u5F97\u91CD\u590D\u5DF2\u53D1\u751F\u7684\u4E8B\u4EF6\u3002\u3010\u7A81\u7834\u7EA6\u675F\u3011breakthrough \u4EC5\u5F53\u4FEE\u4E3A\u5DF2\u8FBE\u5F53\u524D\u5883\u754C\u4E0A\u9650\uFF08\u72B6\u6001 stats.cap\uFF09\u65F6\u624D\u80FD\u4E3A true\uFF1B\u73A9\u5BB6\u8BF4\u201C\u7A81\u7834/\u51B2\u51FB\u74F6\u9888\u201D\u4F46\u4FEE\u4E3A\u4E0D\u8DB3\u65F6\uFF0C\u5E94\u628A\u672C\u56DE\u5408\u5199\u6210\u7EE7\u7EED\u4FEE\u70BC/\u79EF\u7D2F\u4FEE\u4E3A\uFF08cultivate\uFF09\uFF0C\u5E76\u8BA9 delta \u589E\u52A0\u4FEE\u4E3A\uFF0C\u76F4\u5230\u4FEE\u4E3A\u8FBE\u6807\u540E\u518D\u7A81\u7834\u3002\u3010\u9009\u9879\u3011\u5B58\u6D3B\u65F6\u672C\u56DE\u5408\u7ED3\u675F\u5FC5\u987B\u7ED9\u51FA 4 \u4E2A\u4E0B\u8F6E\u9009\u9879\uFF08options\uFF09\uFF0C\u6B7B\u4EA1\u65F6\u7701\u7565\u3002\u9009\u9879\u8981\u5408\u7406\uFF1A\u4E0E\u73A9\u5BB6\u5F53\u524D\u5883\u754C/\u5904\u5883\u5339\u914D\uFF08\u5883\u754C\u538B\u5236\u662F\u94C1\u5F8B\uFF0C\u4F4E\u5883\u754C\u4E0D\u786C\u62FC\u9AD8\u5883\u754C\u3001\u4E0D\u9A70\u63F4\u964C\u751F\u5B97\u95E8\u3001\u4E0D\u4E0A\u95E8\u89C1\u4E0D\u8BA4\u8BC6\u7684\u4EBA\uFF09\uFF1B\u53EA\u7528\u672C\u56DE\u5408\u5DF2\u77E5\u4FE1\u606F\u4E0E\u5728\u573A/\u5DF2\u6709\u5173\u7CFB\u4E4B\u4EBA\uFF1Bbattle \u5206\u652F\u987B\u53CD\u6620\u73A9\u5BB6\u771F\u5B9E\u80DC\u7B97\uFF1B\u672F\u6CD5\u8054\u52A8\uFF08requiresTechnique\uFF09\u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u73A9\u5BB6\u5DF2\u4E60\u529F\u6CD5\uFF08\u5F53\u524D\u72B6\u6001 methods \u7684 techniques\uFF09\u3002';
var CHOICE_SYSTEM = '\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u6289\u62E9\u8BBE\u8BA1\u8005\u3002\u57FA\u4E8E\u672C\u56DE\u5408\u5267\u60C5\uFF0C\u9700\u7ED9\u51FA 4 \u4E2A\u5C94\u8DEF\u9884\u544A\u3002\u8981\u6C42\uFF1A4\u9009\u9879\u5404\u226420\u5B57\uFF0C\u98CE\u9669\u9879\u9644 2-3 branches\uFF08title\u226412\u5B57/kind battle/other/prob0.05-0.95/simpleDesc\u226430\u5B57\uFF09\uFF0C\u672F\u6CD5\u8054\u52A8\u53EA\u80FD\u5F15\u7528\u73A9\u5BB6\u5DF2\u4E60\u529F\u6CD5\u4E2D\u7684\u672F\u6CD5\u540D\uFF08\u5F53\u524D\u72B6\u6001 methods \u7684 techniques\uFF09\uFF0C\u7981\u6B62\u4ED6\u4EBA\u672F\u6CD5\u3002\u53EA\u7ED9\u7B80\u7565\u9884\u544A\u3002\u3010\u5408\u7406\u6027\u94C1\u5F8B\u3011\u6BCF\u4E2A\u9009\u9879\u5FC5\u987B\u4E0E\u7384\u5E7B\u4E16\u754C\u89C4\u5219\u548C\u73A9\u5BB6\u5904\u5883\u81EA\u6D3D\uFF0C\u614E\u91CD\u63A8\u6572\u540E\u518D\u7ED9\u51FA\uFF1A\u2460 \u5B9E\u529B\u5339\u914D\uFF1A\u884C\u52A8\u89C4\u6A21\u4E0E\u51B2\u7A81\u5F3A\u5EA6\u987B\u4E0E\u73A9\u5BB6\u5F53\u524D\u5883\u754C\u76F8\u7B26\u3002\u5883\u754C\u538B\u5236\u662F\u94C1\u5F8B\u2014\u2014\u4F4E\u5883\u754C\u4E3B\u52A8\u6311\u8845\u9AD8\u5883\u754C\u7B49\u4E8E\u9001\u6B7B\uFF1B\u51E1\u4EBA/\u7EC3\u6C14\u9636\u6BB5\u4EE5\u4FDD\u547D\u3001\u63A2\u7D22\u3001\u4EBA\u9645\u3001\u5C0F\u89C4\u6A21\u51B2\u7A81\u4E3A\u4E3B\uFF0C\u5B97\u95E8/\u8DE8\u52BF\u529B\u7EA7\u522B\u4E8B\u4EF6\u53EA\u80FD\u95F4\u63A5\u63A5\u89E6\uFF08\u5982\u5076\u9047\u9003\u96BE\u8005\u3001\u542C\u95FB\u4F20\u95FB\uFF09\uFF0C\u73A9\u5BB6\u4E0D\u5E94\u6210\u4E3A\u8D85\u51FA\u81EA\u8EAB\u5C42\u7EA7\u4E8B\u4EF6\u7684\u4E3B\u89D2\u3002\u2461 \u5173\u7CFB\u8303\u56F4\uFF1A\u4EA4\u4E92\u5BF9\u8C61\u53EA\u80FD\u662F\u672C\u56DE\u5408\u5728\u573A\u4E4B\u4EBA\u6216\u73A9\u5BB6\u5DF2\u6709\u5173\u7CFB\u7684 NPC\uFF08\u89C1\u5F53\u524D\u72B6\u6001 nearby \u4E0E\u597D\u611F\uFF09\uFF0C\u73A9\u5BB6\u672A\u63A5\u89E6\u8FC7\u7684\u5B97\u95E8\u3001\u52BF\u529B\u3001\u4EBA\u7269\u4E0D\u5F97\u51ED\u7A7A\u6210\u4E3A\u9009\u9879\u76EE\u6807\uFF08\u5982\u65E0\u5B97\u95E8\u80CC\u666F\u5374"\u9A70\u63F4\u5B97\u95E8"\u3001\u4E0D\u8BA4\u8BC6\u7684\u4EBA\u5374\u4E0A\u95E8\u62DC\u8BBF\uFF09\u3002\u2462 \u8BA4\u77E5\u8303\u56F4\uFF1A\u9009\u9879\u53EA\u80FD\u57FA\u4E8E\u672C\u56DE\u5408\u5DF2\u77E5\u4FE1\u606F\u4E0E\u5F53\u524D\u5904\u5883\u5C55\u5F00\uFF0C\u4E0D\u5F97\u5F15\u5165\u5267\u60C5\u4E2D\u672A\u51FA\u73B0\u8FC7\u7684\u5730\u70B9\u3001\u76EE\u6807\u6216\u4EBA\u7269\u3002\u2463 \u4E16\u754C\u89C4\u5219\uFF1A\u5C0A\u91CD\u4FEE\u4ED9\u4E16\u754C\u79E9\u5E8F\u2014\u2014\u5883\u754C\u538B\u5236\u3001\u8D44\u6E90\u7A00\u7F3A\u3001\u52BF\u529B\u8FB9\u754C\u3001\u56E0\u679C\u4EE3\u4EF7\uFF1B\u6536\u76CA\u4E0E\u98CE\u9669\u6210\u6B63\u6BD4\uFF0Cbattle \u7C7B prob \u987B\u53CD\u6620\u73A9\u5BB6\u771F\u5B9E\u80DC\u7B97\uFF0C\u51E1\u4EBA\u9762\u5BF9\u4FEE\u58EB\u7EA7\u654C\u4EBA\u5E94\u4EE5\u9003\u9041/\u5468\u65CB\u4E3A\u4E3B\u800C\u975E\u6B63\u9762\u786C\u62FC\u3002';
var BREAKTHROUGH_SYSTEM = '\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u7A81\u7834\u63A8\u6F14\u8005\u3002\u73A9\u5BB6\u51B2\u51FB\u74F6\u9888\uFF0C\u6210\u8D25\u5DF2\u7531\u7CFB\u7EDF\u5224\u5B9A\uFF08\u8F93\u5165\u4E2D\u7684"\u7A81\u7834\u8BA1\u7B97\uFF1A\u6210\u529F=true/false"\u662F\u552F\u4E00\u6743\u5A01\uFF0C\u4F60\u65E0\u6743\u66F4\u6539\uFF09\u3002\u3010\u94C1\u5F8B\u3011\u6210\u529F=true \u65F6\uFF1A\u5199\u7A81\u7834\u6210\u529F\u7684\u573A\u666F\uFF08\u7834\u5883\u3001\u5883\u754C\u63D0\u5347\u3001\u611F\u53D7\u5347\u534E\uFF09\uFF1B\u6210\u529F=false \u65F6\uFF1A**\u5FC5\u987B\u5199\u7A81\u7834\u5931\u8D25\u7684\u573A\u666F**\uFF08\u74F6\u9888\u5982\u5929\u5811\u3001\u6C14\u673A\u7D0A\u4E71\u3001\u51B2\u51FB\u5931\u8D25\u53CD\u566C\u3001\u9669\u4E9B\u8D70\u706B\u5165\u9B54\u7B49\uFF09\uFF0C**\u7EDD\u5BF9\u7981\u6B62\u5199\u7A81\u7834\u6210\u529F\u3001\u7981\u6B62\u5199\u5883\u754C\u63D0\u5347\u3001\u7981\u6B62\u5199"\u7EC8\u4E8E\u7A81\u7834"**\u2014\u2014\u5931\u8D25\u4E86\u5C31\u662F\u5931\u8D25\uFF0C\u53EA\u80FD\u5199\u5931\u8D25\u540E\u7684\u72B6\u6001\uFF08\u4FEE\u4E3A\u4E0D\u7A33\u3001\u9700\u9759\u517B\u3001\u4E0B\u6B21\u518D\u8BD5\uFF09\u3002\u6587\u6848\u5FC5\u987B\u4E0E"\u7A81\u7834\u8BA1\u7B97\uFF1A\u6210\u529F"\u4E25\u683C\u4E00\u81F4\uFF0C\u73A9\u5BB6\u8F93\u5165\u4E2D\u7684"\u7A81\u7834/\u51B2\u51FB\u74F6\u9888"\u662F\u8BF7\u6C42\uFF0C\u4E0D\u4EE3\u8868\u7ED3\u679C\u3002extraCultivation/nextRateBonus \u6309\u6210\u529F\u4E0E\u5426\u5408\u7406\u7ED9\u51FA\uFF1A\u6210\u529F\u53EF\u7ED9\u5C11\u91CF\u989D\u5916\u4FEE\u4E3A\u4E0E\u4E0B\u6B21\u52A0\u6210\uFF1B\u5931\u8D25\u7ED9\u6781\u5C11\u7684\u611F\u609F\u4FEE\u4E3A\u6216\u4E0D\u7ED9\uFF0CnextRateBonus \u53EF\u7ED9\u5931\u8D25\u540E\u7684\u5C0F\u5E45\u52A0\u6210\uFF08\u7834\u800C\u540E\u7ACB\uFF09\u3002';
var QUERY_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u6863\u6848\u67E5\u8BE2\u8005\u3002\u73A9\u5BB6\u8BE2\u95EE\u7EAF\u95EE\u9898\uFF0C\u9700\u57FA\u4E8E\u5168\u91CF\u72B6\u6001\u7B80\u6D01\u56DE\u7B54\uFF0C\u4E0D\u63A8\u65F6\u95F4\u3002";
var CONFRONTATION_BATTLE_SYSTEM = "\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u6218\u6597\u63A8\u6F14\u8005\u3002\u73A9\u5BB6\u9677\u51B2\u7A81\uFF0C\u9700\u4EE5\u5168\u91CF\u72B6\u6001\u5BA2\u89C2\u63A8\u6F14\u80DC/\u9003\uFF0C\u6B7B\u4E86\u5FC5\u6B7B\u3002\u8981\u6C42\uFF1A\u7ED3\u5408\u5DF2\u4E60\u672F\u6CD5\u63CF\u8FF0\uFF0C\u7B80\u7EC3\u7B2C\u4E8C\u4EBA\u79F0\uFF0C\u52A3\u52BF\u53EF\u9003\u6216\u6B7B\uFF0C\u6B7B\u5FC5\u6B7B\u3002";
var REVIEW_STARTER_COMBINED_SYSTEM = "\u4F60\u662F\u4FEE\u4ED9\u5C0F\u8BF4\u8D44\u6E90\u8BC4\u5BA1\u3002\u540C\u5BA1\u51FA\u8EAB\u4E0E\u5929\u8D44\u5409\u51F6\u5206\u5E03\uFF0C80\u53CA\u683C\u3002\u53EA\u8F93\u51FA JSON\u3002";
var ORIGINS_RETRY_SYSTEM = "\u4F60\u662F\u4FEE\u4ED9\u5C0F\u8BF4\u51FA\u8EAB\u8BBE\u8BA1\u8005\u3002\u4E0A\u7248\u88AB\u6253\u56DE\uFF0C\u6309\u53CD\u9988\u91CD\u5199 2-4 \u51FA\u8EAB\uFF0C\u4FDD\u6301\u4E16\u754C\u89C2\u4E00\u81F4\u3002";
var TALENTS_RETRY_SYSTEM = "\u4F60\u662F\u4FEE\u4ED9\u5C0F\u8BF4\u5929\u8D44\u8BBE\u8BA1\u8005\u3002\u4E0A\u7248\u88AB\u6253\u56DE\uFF0C\u91CD\u5199 9 \u5929\u8D44 6\u54093\u51F6\u3002";
function reviewStarterCombinedInput(ctx) {
  return `origins:
${JSON.stringify(ctx.data.origins)}

talents:
${JSON.stringify(ctx.data.talents)}

\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input?.text || ""}`;
}
var REALM_LIST = (() => REALM_ORDER.join("\u3001"))();
function npcSystem(idx) {
  return `\u4F60\u662F\u300C\u7384\u5E7B\u4FEE\u4ED9\u5C0F\u8BF4\u300D\u4EBA\u53E3\u751F\u6210\u5668\u3002\u57FA\u4E8E\u4E16\u754C\u9AA8\u67B6\u751F\u6210 10 \u4E2A NPC\uFF0C\u4F9B\u73A9\u5BB6\u7ED3\u8BC6\u3002\u6BCF\u4E2A NPC 10 \u4EBA\u4E00\u7EC4\uFF0C\u8F93\u51FA\u7B26\u5408 npcBatchSchema\u3002\u3010\u9636\u5C42\u6BD4\u4F8B\xB7\u94C1\u5F8B\u3011\u6BCF\u6279\u5FC5\u987B\u4E25\u683C\u9075\u5FAA\uFF1A\u51E1\u4EBA 2 \u4EBA + \u4FEE\u58EB 7 \u4EBA + \u5927\u4FEE\u58EB 1 \u4EBA\u3002\u51E1\u4EBA=\u51E1\u4EBA\u5883\u754C\uFF08\u6751\u6C11/\u51E1\u4EBA\u6563\u4FEE/\u51E1\u4EBA\u8EAB\u4EFD\uFF09\uFF1B\u4FEE\u58EB=\u7EC3\u6C14/\u7B51\u57FA/\u91D1\u4E39\u5883\u754C\uFF08\u5F1F\u5B50/\u6267\u4E8B/\u957F\u8001/\u6563\u4FEE\uFF09\uFF1B\u5927\u4FEE\u58EB=\u5143\u5A74/\u5316\u795E\u5883\u754C\uFF08\u5B97\u95E8\u8001\u7956/\u5927\u80FD/\u4E00\u65B9\u9738\u4E3B\uFF09\u3002\u8981\u6C42\uFF1A\u540D\u5B57\u7981\u4E0E\u5B97\u95E8\u5730\u57DF\u91CD\u540D\uFF0Crealm \u5FC5\u987B\u4E3A\u539F\u8BCD\u4E0D\u52A0\u540E\u7F00\uFF1B\u8EAB\u4EFD\u4E0E\u5883\u754C\u76F8\u79F0\uFF08\u91D1\u4E39\u957F\u8001\u3001\u5143\u5A74\u8001\u7956\uFF09\u3002` + (idx > 1 ? `\u3010\u7981\u6B62\u91CD\u540D\u3011\u672C\u6279\u4E0D\u5F97\u7528\u524D ${idx - 1} \u6279\u5DF2\u6709\u540D\u5B57\u3002` : "");
}
function buildNpcInput(ctx, idx) {
  const w = ctx.state._w.stats;
  const world = w.world || { name: "", regions: [], sects: [], towns: [] };
  const prior = [];
  for (const c of w.characters || []) {
    if (c && typeof c.name === "string") prior.push({ name: c.name, identity: c.identity || "", realm: c.realm || "", location: c.location || "", note: c.note || "" });
  }
  for (let j = 1; j < idx; j++) {
    const batch = ctx.data["npcBatch" + j]?.["npcBatch" + j];
    if (Array.isArray(batch)) for (const c of batch) {
      if (c && typeof c.name === "string") prior.push({ name: c.name, identity: String(c.identity || ""), realm: String(c.realm || ""), location: String(c.location || ""), note: String(c.note || "") });
    }
  }
  const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
  const head = `${wish}\u4E16\u754C\u9AA8\u67B6\uFF1A
${JSON.stringify({ name: world.name, regions: world.regions, sects: world.sects?.map((s) => s.name), towns: world.towns?.map((t) => t.name) })}
\u8BF7\u751F\u6210\u7B2C ${idx}/3 \u6279\u3001\u5171 10 \u4E2A NPC\uFF08\u51E1\u4EBA2+\u4FEE\u58EB7+\u5927\u4FEE\u58EB1\uFF0C\u8FD4\u56DE\u5B57\u6BB5\u540D npcBatch${idx}\uFF09\u3002`;
  const priorText = prior.length ? `
\u5DF2\u5B58\u5728 NPC\uFF08\u540D\u5B57\u7981\u6B62\u91CD\u590D\uFF0C\u8EAB\u4EFD/\u80CC\u666F\u987B\u5DEE\u5F02\u5316\uFF09\uFF1A${prior.map((p) => `${p.name}\uFF08${p.identity}\xB7${p.realm}\xB7${p.location}${p.note ? `\xB7${p.note}` : ""}\uFF09`).join("\uFF1B")}` : "";
  return head + priorText;
}

// src/flows/schemas.ts
var AFFINITY_SCHEMA = { type: "integer", minimum: 0, maximum: AFFINITY_MAX, description: "\u521D\u59CB\u597D\u611F 0-100\uFF0C0-9\u51B7\u6DE1 10-29\u76F8\u8BC6 30-49\u53CB\u597D 50-69\u4EB2\u5BC6 70-89\u7231\u6155 90-100\u631A\u7231" };
var AFFINITY_DELTA_SCHEMA = { type: "integer", minimum: -20, maximum: 20, description: "\u597D\u611F\u53D8\u5316\u589E\u91CF -20~20\uFF0C\u914D\u5408 reason \u8BF4\u660E\u539F\u56E0" };
var TECHNIQUE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, description: "\u672F\u6CD5\u540D\uFF0C\u5982\u201C\u5929\u5251\u65A9\u201D" },
    description: { type: "string", minLength: 1, description: "\u672F\u6CD5\u6548\u679C\u63CF\u8FF0\uFF0C\u5982\u201C\u4EE5\u7075\u529B\u51DD\u5251\u6C14\uFF0C\u8FD1\u8DDD\u65A9\u51FB\uFF0C\u9644\u8F7B\u5FAE\u51FB\u9000\u201D" }
  },
  required: ["name", "description"],
  description: "\u5355\u6761\u672F\u6CD5\uFF0C\u96B6\u5C5E\u529F\u6CD5\uFF0C\u4EC5\u63CF\u8FF0\u65E0\u6570\u503C"
};
var METHOD_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, description: "\u529F\u6CD5\u540D\uFF0C\u5982\u201C\u9752\u4E91\u5251\u8BC0\u201D" },
    grade: { type: "string", enum: Object.keys(METHOD_GRADES), description: "\u529F\u6CD5\u54C1\u9636\uFF0C\u51E1\u54C14/\u9EC4\u963624/\u7384\u9636120/\u5730\u9636600/\u5929\u96363000 \u4FEE\u4E3A/\u6708\uFF0C\u51B3\u5B9A\u4FEE\u70BC\u6548\u7387" },
    techniques: { type: "array", items: TECHNIQUE_SCHEMA, description: "\u529F\u6CD5\u81EA\u5E26\u672F\u6CD5\u5217\u8868" }
  },
  required: ["name", "grade", "techniques"],
  description: "\u5355\u90E8\u529F\u6CD5\uFF0C\u542B\u54C1\u9636\u4E0E\u672F\u6CD5"
};
var PILL_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "\u4E39\u836F\u540D\uFF0C\u5982\u201C\u805A\u6C14\u4E39\u201D" },
    effectType: { type: "string", enum: [...PILL_EFFECTS], description: "\u4E39\u836F\u6548\u679C\u7C7B\u578B\uFF1Acultivation \u4FEE\u4E3A/breakthrough \u63D0\u9AD8\u7A81\u7834\u51E0\u7387/heal \u56DE\u8840/lifespan \u5EF6\u5BFF" },
    power: { type: "number", minimum: 1, description: "\u4E39\u836F\u6548\u529B\u6570\u503C\uFF0C\u6B63\u6570\uFF0C\u6309\u5883\u754C\u8870\u51CF" },
    realm: { type: "string", enum: [...REALM_ORDER], description: "\u4E39\u836F\u5BF9\u5E94\u5883\u754C\uFF0C\u51E1\u4EBA/\u7EC3\u6C14/\u7B51\u57FA/\u91D1\u4E39/\u5143\u5A74/\u5316\u795E" }
  },
  required: ["name", "effectType", "power", "realm"],
  description: "\u5355\u7C92\u4E39\u836F\u5B9A\u4E49"
};
var DELTA_SCHEMA = {
  type: "object",
  properties: {
    spiritStones: { type: "integer", description: "\u7075\u77F3\u53D8\u5316\uFF0C\u6B63\u5F97\u8D1F\u8017\uFF0C\u65E0\u4E0A\u9650" },
    cultivation: { type: "integer", description: "\u4FEE\u4E3A\u53D8\u5316\uFF0C\u6B63\u5F97\u8D1F\u8017\uFF0C\u65E0 cap\uFF0CLLM \u636E\u5F53\u524D\u4FEE\u4E3A/\u4E0A\u9650\u81EA\u5B9A" },
    breakthroughDelta: { type: "number", description: "\u4E0B\u6B21\u7A81\u7834\u7387\u53D8\u5316\uFF0C\u6B63\u52A0\u8D1F\u51CF\uFF0C\u65E0 cap\uFF0C\u9ED8\u8BA4\u7A81\u7834\u6982\u7387\uFF1A\u51E1\u4EBA60%/\u7EC3\u6C1420%/\u7B51\u57FA15%/\u91D1\u4E3910%/\u5143\u5A748%/\u5316\u795E5%\uFF0C\u5929\u8D44\u5409\u51F6\u4F1A\u63D0\u4EA4\u6216\u964D\u4F4E\uFF0C\u5DF2\u901A\u8FC7\u56FA\u5B9A\u8BA1\u7B97\u8BA1\u5165" },
    pills: {
      type: "array",
      description: "\u4E39\u836F\u5F97\u5931\u5217\u8868\uFF0Camount \u6B63\u5F97\u8D1F\u8017",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "\u4E39\u836F\u540D" },
          amount: { type: "integer", description: "\u6B63\u6570\u4E3A\u5F97\u8D1F\u4E3A\u8017\uFF0C1 \u8868\u793A\u5F971\u7C92\u6216\u80171\u7C92" },
          effectType: { type: "string", enum: [...PILL_EFFECTS], description: "\u4E39\u836F\u6548\u679C\u7C7B\u578B" },
          realm: { type: "string", enum: [...REALM_ORDER], description: "\u4E39\u836F\u5883\u754C" },
          power: { type: "number", minimum: 1, description: "\u4E39\u836F\u6548\u529B" }
        },
        required: ["name", "amount", "effectType", "realm"]
      }
    },
    methods: {
      type: "array",
      description: "\u529F\u6CD5\u5F97\u5931\u5217\u8868",
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, description: "\u529F\u6CD5\u540D" },
          grade: { type: "string", enum: Object.keys(METHOD_GRADES), description: "\u529F\u6CD5\u54C1\u9636\uFF0C\u51E1\u54C14/\u9EC4\u963624/\u7384\u9636120/\u5730\u9636600/\u5929\u96363000 \u4FEE\u4E3A/\u6708" },
          action: { type: "string", enum: ["learn", "teach", "forget"], description: "learn \u5F97\uFF0Cteach \u6388\u4E0D\u6263\u81EA\u8EAB\uFF0Cforget \u5F03" },
          targetNpc: { type: "string", description: "teach \u65F6\u76EE\u6807 NPC \u540D" },
          techniques: { type: "array", items: TECHNIQUE_SCHEMA, description: "learn \u65F6\u53EF\u9644\u5E26\u7684\u672F\u6CD5\uFF08\u4EC5\u63CF\u8FF0\uFF09" }
        },
        required: ["name", "grade"]
      }
    },
    hpDelta: { type: "integer", description: "\u6C14\u8840\u53D8\u5316\uFF0C\u6B63\u8865\u8D1F\u8017\uFF0C\u7528\u4E8E\u6218\u6597/\u9003\u79BB" }
  },
  description: "\u5355\u56DE\u5408\u5F97\u5931\u805A\u5408\uFF0C\u552F\u4E00\u771F\u6E90"
};
var ORIGIN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, description: "\u51FA\u8EAB\u540D\uFF0C\u5982\u201C\u5929\u5251\u5B97\u9057\u5B64\u201D" },
    location: { type: "string", minLength: 1, description: "\u51FA\u8EAB\u5730\uFF0C\u987B\u4E3A\u4E16\u754C\u5730\u57DF/\u57CE\u9547\u6216 NPC \u6240\u5728\u5730" },
    background: { type: "string", minLength: 1, description: "\u51FA\u8EAB\u80CC\u666F\u6545\u4E8B" },
    starter: {
      type: "object",
      description: "\u521D\u59CB\u643A\u5E26",
      properties: {
        spiritStones: { type: "number", minimum: 0, maximum: 500, description: "\u521D\u59CB\u7075\u77F3 0-50\uFF0C\u51E1\u4EBA\u65E0\u4ED9\u7F18\u5B9C0" },
        methods: { type: "array", items: METHOD_SCHEMA, description: "\u521D\u59CB\u529F\u6CD5\u5217\u8868" },
        pills: { type: "array", items: PILL_SCHEMA, description: "\u521D\u59CB\u4E39\u836F\u5217\u8868" }
      }
    },
    npcs: {
      type: "object",
      description: "\u51FA\u8EAB\u5173\u8054 NPC \u521D\u59CB\u597D\u611F\u6620\u5C04\uFF0Ckey \u4E3A NPC \u540D\uFF0Cvalue \u4E3A\u597D\u611F 0-100",
      additionalProperties: AFFINITY_SCHEMA
    }
  },
  required: ["name", "location", "background"],
  description: "\u5355\u6761\u51FA\u8EAB\u6A21\u677F"
};
var WORLD_BASE_SCHEMA = {
  type: "object",
  properties: {
    world: {
      type: "object",
      description: "\u4E16\u754C\u9AA8\u67B6",
      properties: {
        name: { type: "string", minLength: 1, description: "\u5927\u9646\u540D" },
        regions: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 }, description: "\u5730\u57DF\u5217\u8868 4-10 \u4E2A" },
        sects: {
          type: "array",
          maxItems: 10,
          description: "\u5B97\u95E8\u5217\u8868 4-10 \u4E2A",
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, description: "\u5B97\u95E8\u540D" },
              stance: { type: "string", minLength: 1, description: "\u5B97\u95E8\u7ACB\u573A\uFF1A\u6B63/\u9B54/\u4E2D\u7ACB" },
              location: { type: "string", minLength: 1, description: "\u5B97\u95E8\u6240\u5728\u5730\u57DF/\u57CE\u9547" },
              feature: { type: "string", description: "\u5B97\u95E8\u7279\u8272" }
            },
            required: ["name", "stance", "location"]
          }
        },
        towns: {
          type: "array",
          maxItems: 10,
          description: "\u57CE\u9547\u5217\u8868 6-10 \u4E2A",
          items: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1, description: "\u57CE\u9547\u540D" },
              location: { type: "string", minLength: 1, description: "\u57CE\u9547\u6240\u5728\u5730\u57DF" },
              feature: { type: "string", description: "\u57CE\u9547\u7279\u8272" }
            },
            required: ["name", "location"]
          }
        },
        law: { type: "string", minLength: 1, description: "\u5929\u5730\u6CD5\u5219" },
        rumor: { type: "string", description: "\u4E16\u9053\u4F20\u95FB" }
      },
      required: ["name", "regions", "sects", "law"]
    }
  },
  required: ["world"],
  description: "\u4E16\u754C\u9AA8\u67B6\u751F\u6210"
};
var DECADAL_EVENTS_SCHEMA = {
  type: "object",
  properties: {
    majorEvents: {
      type: "array",
      minItems: 15,
      maxItems: 30,
      description: "\u672A\u6765\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6 15-30 \u6761\uFF0C\u5747\u5300\u5206\u5E03\u5728 50 \u5E74\u5185\uFF08\u4E0D\u8981\u624E\u5806\u5728\u5F00\u5934\uFF09",
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, description: "\u4E8B\u4EF6\u540D" },
          at: { type: "number", minimum: 1, description: "\u89E6\u53D1\u6708\uFF08\u7EDD\u5BF9\u6708\uFF0C>\u5F53\u524D\u6708\u4E14 \u2264\u5F53\u524D\u6708+600\uFF09" },
          by: { type: "number", minimum: 2, description: "\u622A\u6B62\u6708\uFF08>at+6\uFF09" },
          type: { type: "string", enum: ["\u673A\u9047", "\u5371\u673A", "\u8F6C\u6298", "\u9AD8\u6F6E"], description: "\u4E8B\u4EF6\u7C7B\u578B" },
          summary: { type: "string", minLength: 1, description: "\u4E8B\u4EF6\u6982\u8981 5-60\u5B57" }
        },
        required: ["name", "at", "by", "type", "summary"]
      }
    }
  },
  required: ["majorEvents"],
  description: "\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6\u751F\u6210"
};
var npcBatchSchema = (key) => ({
  type: "object",
  properties: {
    [key]: {
      type: "array",
      minItems: NPC_BATCH_MIN,
      maxItems: NPC_BATCH_MAX,
      description: `NPC \u6279\u6B21 ${key}\uFF0C10 \u4EBA\uFF08\u9636\u5C42\u6BD4\u4F8B\uFF1A\u51E1\u4EBA 2 \u4EBA + \u4FEE\u58EB 7 \u4EBA + \u5927\u4FEE\u58EB 1 \u4EBA\uFF09`,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, description: "NPC \u540D" },
          gender: { type: "string", enum: ["\u7537", "\u5973"], description: "\u6027\u522B" },
          age: { type: "number", minimum: 10, maximum: 500, description: "\u5E74\u9F84 10-500\uFF0C\u53C2\u8003\u5BFF\u5143\uFF1A\u51E1\u4EBA80/\u7EC3\u6C14120/\u7B51\u57FA200/\u91D1\u4E39300/\u5143\u5A74500/\u5316\u795E800\uFF0C\u9AD8\u5883\u53EF\u6D3B\u66F4\u4E45" },
          identity: { type: "string", minLength: 1, description: "\u8EAB\u4EFD\uFF0C\u5982\u6751\u6C11/\u6563\u4FEE/\u5F1F\u5B50/\u957F\u8001" },
          realm: { type: "string", enum: [...REALM_ORDER], description: "\u5883\u754C\uFF1A\u51E1\u4EBA=\u51E1\u4EBA\uFF1B\u4FEE\u58EB=\u7EC3\u6C14/\u7B51\u57FA/\u91D1\u4E39\uFF1B\u5927\u4FEE\u58EB=\u5143\u5A74/\u5316\u795E\u3002\u987B\u4E3A\u539F\u8BCD\uFF0C\u5BF9\u5E94\u5BFF\u5143\u51E1\u4EBA80/\u7EC3\u6C14120/\u7B51\u57FA200/\u91D1\u4E39300/\u5143\u5A74500/\u5316\u795E800" },
          location: { type: "string", minLength: 1, description: "\u6240\u5728\u5730\u57DF/\u57CE\u9547\uFF0C\u987B\u4E3A\u4E16\u754C\u5DF2\u6709" },
          temperament: { type: "string", description: "\u6027\u60C5/\u6027\u683C" },
          affinity: { ...AFFINITY_SCHEMA, description: "\u5BF9\u964C\u751F\u4EBA\u521D\u59CB\u597D\u611F 0-100\uFF0C0-9\u51B7\u6DE1 10-29\u76F8\u8BC6 30-49\u53CB\u597D 50-69\u4EB2\u5BC6 70-89\u7231\u6155 90-100\u631A\u7231" },
          note: { type: "string", description: "\u4E00\u53E5\u8BDD\u6863\u6848" }
        },
        required: ["name", "gender", "identity", "realm", "location", "temperament", "affinity"]
      }
    }
  },
  required: [key],
  description: `NPC \u6279\u6B21 ${key} \u751F\u6210\uFF0810 \u4EBA\uFF09`
});
var ORIGINS_SCHEMA = {
  type: "object",
  properties: {
    origins: { type: "array", minItems: 2, maxItems: 4, items: ORIGIN_SCHEMA, description: "\u51FA\u8EAB\u5217\u8868 2-4 \u6761" }
  },
  required: ["origins"],
  description: "\u51FA\u8EAB\u6C60\u751F\u6210"
};
var TALENT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, description: "\u5929\u8D44\u540D\uFF0C\u5982\u201C\u5929\u751F\u5251\u9AA8\u201D" },
    description: { type: "string", minLength: 1, description: "\u5929\u8D44\u8BF4\u660E\uFF0C\u5409\u51F6\u5206\u660E" },
    temperament: { type: "string", minLength: 1, description: "\u6027\u683C\u503E\u5411" },
    quality: { type: "string", enum: ["\u5409", "\u51F6"], description: "\u5409\u51F6\uFF0C6\u54093\u51F6" }
  },
  required: ["name", "description", "temperament", "quality"],
  description: "\u5355\u6761\u5929\u8D44\u8BCD\u6761"
};
var TALENTS_SCHEMA = {
  type: "object",
  properties: {
    talents: { type: "array", minItems: 9, maxItems: 9, items: TALENT_SCHEMA, description: "\u5929\u8D44\u6C60 9 \u6761 6\u54093\u51F6" }
  },
  required: ["talents"],
  description: "\u5929\u8D44\u6C60\u751F\u6210"
};
var EVENT_REF_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, description: "\u5927\u4E8B\u4EF6\u540D\uFF0C\u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u5F53\u524D\u72B6\u6001 majorEvents \u5217\u8868\u4E2D\u5DF2\u5B58\u5728\u7684 name\uFF0C\u7981\u6B62\u81EA\u521B\u3001\u7F29\u5199\u6216\u6539\u5199\u4E8B\u4EF6\u540D\uFF1B\u53EA\u80FD\u5F15\u7528 active\uFF08\u5DF2\u89E6\u53D1\u8FDB\u884C\u4E2D\uFF09\u72B6\u6001\u7684\u4E8B\u4EF6\uFF0C\u672A\u5230\u89E6\u53D1\u6708\uFF08at\uFF09\u7684 pending \u4E8B\u4EF6\u4E0D\u5F97\u5F15\u7528" },
    progress: { type: "string", minLength: 1, description: "\u4E8B\u4EF6\u8FDB\u5C55\u63CF\u8FF0" },
    resolved: { type: "boolean", description: "\u662F\u5426\u89E3\u51B3\uFF0C\u4EC5\u9AD8\u6F6E\u53EF true" }
  },
  required: ["name", "progress"],
  description: "\u5927\u4E8B\u4EF6\u63A8\u8FDB\u5F15\u7528"
};
var RELATIONSHIP_ITEM_SCHEMA = {
  type: "object",
  properties: {
    npc: { type: "string", description: "NPC \u540D" },
    delta: { ...AFFINITY_DELTA_SCHEMA, description: "\u597D\u611F\u589E\u91CF -20~20" },
    reason: { type: "string", minLength: 1, description: "\u597D\u611F\u53D8\u5316\u539F\u56E0" }
  },
  required: ["npc", "delta", "reason"],
  description: "\u5355\u6761\u5173\u7CFB\u53D8\u5316"
};
var ROMANCE_SCHEMA = {
  type: "object",
  properties: {
    npc: { type: "string", description: "\u5BF9\u8C61 NPC \u540D" },
    action: { type: "string", enum: ["\u4E92\u52A8", "\u8868\u767D"], description: "\u4E92\u52A8\u4E0D\u9650\u597D\u611F\uFF0C\u8868\u767D\u9700\u226570\u7231\u6155" }
  },
  required: ["npc", "action"],
  description: "\u9053\u4FA3\u4E92\u52A8"
};
var CULTIVATE_SCHEMA = {
  type: "object",
  properties: {
    months: { type: "number", enum: [1, 3, 12], description: "\u95ED\u5173\u6708\u6570 1/3/12\uFF0C\u6309\u4E3B\u4FEE\u6548\u7387\u7ED3\u7B97" },
    mode: { type: "string", enum: ["solo", "dual"], description: "solo \u5355\u4FEE/dual \u53CC\u4FEE" },
    partner: { type: "string", description: "\u53CC\u4FEE\u9053\u4FA3\u540D" }
  },
  required: ["months"],
  description: "\u4FEE\u70BC\u5B89\u6392"
};
var SWITCH_MAIN_SCHEMA = {
  type: "object",
  properties: {
    method: { type: "string", description: "\u76EE\u6807\u4E3B\u4FEE\u529F\u6CD5\u540D\uFF0C\u987B\u5DF2\u4E60\u5F97\u975E\u5F53\u524D\u4E3B\u4FEE" }
  },
  required: ["method"],
  description: "\u5207\u4E3B\u4FEE"
};
var TURN_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, description: "\u672C\u56DE\u5408\u53D9\u4E8B\u6B63\u6587\uFF0C\u7B2C\u4E8C\u4EBA\u79F0\u77ED\u800C\u6709\u529B" },
    kind: { type: "string", enum: ["\u65E5\u5E38", "\u673A\u9047", "\u5371\u673A", "\u8F6C\u6298", "\u9AD8\u6F6E"], description: "\u8282\u62CD\u7C7B\u578B\uFF0C\u673A\u9047/\u5371\u673A/\u8F6C\u6298/\u9AD8\u6F6E\u5FC5\u987B\u5E26 eventRef" },
    eventRef: EVENT_REF_SCHEMA,
    delta: DELTA_SCHEMA,
    relationships: { type: "array", items: RELATIONSHIP_ITEM_SCHEMA, description: "\u597D\u611F\u53D8\u5316\u5217\u8868\uFF0C\u5355\u8F6E1-2\u4EBA" },
    romance: ROMANCE_SCHEMA,
    cultivate: CULTIVATE_SCHEMA,
    switchMain: SWITCH_MAIN_SCHEMA,
    breakthrough: { type: "boolean", description: "\u662F\u5426\u7A81\u7834\uFF1A\u4EC5\u5F53\u4FEE\u4E3A\u5DF2\u8FBE\u5230\u5F53\u524D\u5883\u754C\u4E0A\u9650\uFF08\u72B6\u6001 stats.cap\uFF09\u65F6\u624D\u53EF\u4E3A true\uFF1B\u4FEE\u4E3A\u4E0D\u8DB3\u65F6\u5FC5\u987B\u6539\u4E3A\u4FEE\u70BC/\u79EF\u7D2F\u4FEE\u4E3A\uFF0C\u7981\u6B62\u5F3A\u884C\u7A81\u7834" },
    location: { type: "string", description: '\u73A9\u5BB6\u672C\u56DE\u5408\u79FB\u52A8\u5230\u7684\u4F4D\u7F6E\uFF08\u987B\u4E3A\u4E16\u754C\u5DF2\u6709\u5730\u57DF/\u57CE\u9547\uFF0C\u5982"\u9752\u4E91\u57CE"\uFF09\u3002\u4F4D\u7F6E\u8DDF\u968F\u5267\u60C5\u8D70\uFF1A\u73A9\u5BB6\u884C\u52A8\u6D89\u53CA\u8D76\u8DEF/\u79BB\u5F00/\u5230\u8FBE\u65F6\u5FC5\u586B\uFF1B\u539F\u5730\u505C\u7559\uFF08\u4FEE\u70BC/\u95ED\u5173/\u5BF9\u8BDD\uFF09\u7701\u7565\u3002\u79FB\u52A8\u540E"\u9644\u8FD1\u7684\u4EBA"\u968F\u4E4B\u53D8\u5316' },
    npcMoves: {
      type: "array",
      description: "\u672C\u56DE\u5408 NPC \u4F4D\u7F6E\u53D8\u66F4\u5217\u8868\uFF08\u5267\u60C5\u9A71\u52A8\u7684 NPC \u79FB\u52A8\uFF0C\u5982\u968F\u884C/\u544A\u522B/\u524D\u5F80\u67D0\u5730\uFF09\u3002\u901A\u5E38\u7701\u7565\uFF0C\u4EC5\u5F53\u5267\u60C5\u660E\u786E\u6D89\u53CA NPC \u79FB\u52A8\u65F6\u586B",
      items: {
        type: "object",
        properties: {
          npc: { type: "string", minLength: 1, description: "NPC \u540D\uFF0C\u987B\u4E3A\u5F53\u524D\u72B6\u6001 characters \u4E2D\u5DF2\u6709" },
          location: { type: "string", minLength: 1, description: "\u8BE5 NPC \u79FB\u52A8\u5230\u7684\u4F4D\u7F6E\uFF08\u987B\u4E3A\u4E16\u754C\u5DF2\u6709\u5730\u57DF/\u57CE\u9547\uFF09" },
          reason: { type: "string", description: "\u79FB\u52A8\u539F\u56E0\uFF08\u53C2\u8003 NPC \u4E2A\u4EBA\u80CC\u666F\u3001\u4E0E\u73A9\u5BB6\u597D\u611F\u3001\u5927\u4E8B\u4EF6\u7B49\uFF0C\u4E00\u53E5\u8BDD\uFF09" }
        },
        required: ["npc", "location"]
      }
    },
    npcChanges: {
      type: "array",
      description: "\u672C\u56DE\u5408 NPC \u5883\u754C\u53D8\u5316\u5217\u8868\uFF08\u5267\u60C5\u9A71\u52A8\u7684\u4FEE\u4E3A\u7A81\u7834\uFF0C\u5982 NPC \u7A81\u7834\u3001\u5883\u754C\u8DCC\u843D\uFF09\u3002\u901A\u5E38\u7701\u7565\uFF0C\u4EC5\u5F53\u5267\u60C5\u660E\u786E\u6D89\u53CA NPC \u5883\u754C\u53D8\u5316\u65F6\u586B",
      items: {
        type: "object",
        properties: {
          npc: { type: "string", minLength: 1, description: "NPC \u540D\uFF0C\u987B\u4E3A\u5F53\u524D\u72B6\u6001 characters \u4E2D\u5DF2\u6709" },
          realm: { type: "string", enum: [...REALM_ORDER], description: "\u8BE5 NPC \u53D8\u5316\u540E\u7684\u5883\u754C\uFF08\u987B\u4E3A\u539F\u8BCD\uFF09" },
          reason: { type: "string", minLength: 1, description: "\u53D8\u5316\u539F\u56E0\uFF08\u5982\u7A81\u7834/\u8D70\u706B\u5165\u9B54/\u8DCC\u843D\uFF0C\u7ED3\u5408 NPC \u4E2A\u4EBA\u80CC\u666F\u3001\u5267\u60C5\u63A8\u8FDB\uFF0C\u4E00\u53E5\u8BDD\uFF09" }
        },
        required: ["npc", "realm", "reason"]
      }
    },
    timeCost: { type: "number", description: "\u672C\u56DE\u5408\u63A8\u52A8\u51E0\u6708\uFF0C0\u4E0D\u63A8\u65F6\u95F4\uFF0C1-\u6570\u5341\u6708\u81EA\u5B9A" },
    options: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      description: "\u672C\u56DE\u5408\u7ED3\u675F\u540E\u7684 4 \u4E2A\u4E0B\u8F6E\u9009\u9879\uFF08\u73A9\u5BB6\u5B58\u6D3B\u65F6\u5FC5\u586B\uFF1B\u8EAB\u6B7B\u9053\u6D88\u65F6\u7701\u7565\uFF09\u3002\u9009\u9879\u5FC5\u987B\u4E0E\u7384\u5E7B\u4E16\u754C\u89C4\u5219\u548C\u73A9\u5BB6\u5904\u5883\u81EA\u6D3D\uFF1A\u5B9E\u529B\u5339\u914D\uFF08\u5883\u754C\u538B\u5236\u662F\u94C1\u5F8B\uFF09\u3001\u5173\u7CFB\u8303\u56F4\uFF08\u53EA\u4EA4\u4E92\u5728\u573A\u6216\u6709\u5173\u7CFB NPC\uFF09\u3001\u8BA4\u77E5\u8303\u56F4\uFF08\u4E0D\u5F15\u5165\u672A\u51FA\u73B0\u7684\u4EBA\u7269\u5730\u70B9\uFF09",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "\u9009\u9879\u6587\u672C\u226420\u5B57" },
          risk: { type: "string", enum: ["\u65E0", "\u4F4E", "\u4E2D", "\u9AD8"], description: "\u98CE\u9669\u7B49\u7EA7" },
          branches: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            description: "\u98CE\u9669\u9879\u9644 2-3 \u4E2A\u5206\u652F\u9884\u544A\uFF08risk \u4E3A\u65E0\u65F6\u53EF\u7701\u7565\uFF09",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "\u5206\u652F ID" },
                title: { type: "string", description: "\u5206\u652F\u6807\u9898\u226412\u5B57" },
                kind: { type: "string", enum: ["battle", "other"], description: "battle \u6218\u6597/other \u5267\u60C5" },
                prob: { type: "number", minimum: 0.05, maximum: 0.95, description: "\u6982\u7387 0.05-0.95" },
                simpleDesc: { type: "string", description: "\u7B80\u7565\u8D70\u5411\u226430\u5B57" },
                requiresTechnique: { type: "string", description: "\u9700\u5DF2\u4E60\u5F97\u672F\u6CD5\u540D\uFF1A\u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u73A9\u5BB6\u5DF2\u4E60\u529F\u6CD5\uFF08\u5F53\u524D\u72B6\u6001 methods \u7684 techniques\uFF09\u4E2D\u7684\u672F\u6CD5\u540D\uFF0C\u7981\u6B62\u5F15\u7528 NPC/\u4ED6\u4EBA\u7684\u672F\u6CD5" }
              },
              required: ["id", "title", "kind", "prob", "simpleDesc"]
            }
          }
        },
        required: ["text", "risk"]
      }
    }
  },
  required: ["text", "kind"],
  description: "\u4E3B\u56DE\u5408\u63A8\u6F14\uFF08game_turn\uFF09"
};
var BRANCH_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "\u5206\u652F id" },
    title: { type: "string", description: "\u5206\u652F\u6807\u9898\u226412\u5B57" },
    kind: { type: "string", enum: ["battle", "other"], description: "battle \u6218\u6597/other \u5267\u60C5" },
    prob: { type: "number", minimum: 0.05, maximum: 0.95, description: "\u6982\u7387 0.05-0.95\uFF0C\u548C\u22481" },
    simpleDesc: { type: "string", description: "\u7B80\u7565\u8D70\u5411\u226430\u5B57" },
    requiresTechnique: { type: "string", description: "\u9700\u5DF2\u4E60\u5F97\u672F\u6CD5\u540D\uFF1A\u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u73A9\u5BB6\u5DF2\u4E60\u529F\u6CD5\uFF08\u5F53\u524D\u72B6\u6001 methods \u7684 techniques\uFF09\u4E2D\u7684\u672F\u6CD5\u540D\uFF0C\u7981\u6B62\u5F15\u7528 NPC/\u4ED6\u4EBA\u7684\u672F\u6CD5" }
  },
  required: ["id", "title", "kind", "prob", "simpleDesc"],
  description: "\u5355\u6761\u9690\u5F0F\u5206\u652F"
};
var CHOICE_OPTION_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "\u9009\u9879\u6587\u672C\u226420\u5B57" },
    risk: { type: "string", enum: ["\u65E0", "\u4F4E", "\u4E2D", "\u9AD8"], description: "\u98CE\u9669\u7B49\u7EA7" },
    branches: { type: "array", minItems: 2, maxItems: 3, items: BRANCH_SCHEMA, description: "\u98CE\u9669\u9879\u9644 2-3 \u9690\u5F0F\u5206\u652F" }
  },
  required: ["text", "risk"],
  description: "\u5355\u6761\u6289\u62E9"
};
var CHOICE_SCHEMA = {
  type: "object",
  properties: {
    options: { type: "array", minItems: 4, maxItems: 4, items: CHOICE_OPTION_SCHEMA, description: "4\u4E2A\u6289\u62E9" }
  },
  required: ["options"],
  description: "\u6289\u62E9\uFF08game_turn \u672B\uFF09"
};
var BATTLE_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, description: "\u6218\u6597\u53D9\u4E8B\u7B2C\u4E8C\u4EBA\u79F0" },
    dead: { type: "boolean", description: "\u662F\u5426\u8EAB\u6B7B" },
    delta: DELTA_SCHEMA
  },
  required: ["text", "dead"],
  description: "\u6218\u6597\u5B9E\u5199\uFF08confrontation\uFF09"
};
var BREAKTHROUGH_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, description: "\u7A81\u7834\u6587\u6848\uFF0C\u5FC5\u987B\u4E0E\u7CFB\u7EDF\u5224\u5B9A\u7684 success \u4E25\u683C\u4E00\u81F4\uFF1A\u6210\u529F=true \u5199\u7834\u5883\u6210\u529F\u573A\u666F\uFF1B\u6210\u529F=false \u5FC5\u987B\u5199\u7A81\u7834\u5931\u8D25\u573A\u666F\uFF08\u74F6\u9888\u53D7\u963B/\u6C14\u673A\u7D0A\u4E71/\u53CD\u566C\uFF09\uFF0C\u7EDD\u5BF9\u7981\u6B62\u5199\u7A81\u7834\u6210\u529F\u6216\u5883\u754C\u63D0\u5347" },
    extraCultivation: { type: "number", description: "\u989D\u5916\u4FEE\u4E3A\uFF1A\u6210\u529F\u53EF\u7ED9\u5C11\u91CF\uFF1B\u5931\u8D25\u7ED9\u6781\u5C11\u611F\u609F\u6216\u4E0D\u7ED9" },
    nextRateBonus: { type: "number", description: "\u4E0B\u6B21\u7A81\u7834\u7387\u52A0\u6210\uFF1A\u6210\u529F\u53EF\u7ED9\uFF1B\u5931\u8D25\u53EF\u7ED9\u5C0F\u5E45\uFF08\u7834\u800C\u540E\u7ACB\uFF09" }
  },
  required: ["text"],
  description: "\u7A81\u7834\u63A8\u6F14"
};
var QUERY_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", minLength: 1, description: "\u67E5\u8BE2\u56DE\u7B54\uFF0C\u7B80\u6D01\u4E2D\u6587" }
  },
  required: ["answer"],
  description: "\u6863\u6848\u67E5\u8BE2\u56DE\u7B54"
};
var CHAR_CREATE_SCHEMA = {
  type: "object",
  properties: {
    origin: { type: "string", minLength: 1, description: "\u51FA\u8EAB\u540D\uFF0C\u987B\u4E3A\u6C60\u5185" },
    talents: { type: "array", minItems: 3, maxItems: 3, items: { type: "string", minLength: 1, description: "\u5929\u8D44\u540D\uFF0C\u987B\u4E3A\u6C60\u5185" }, description: "\u62BD\u53D63\u5929\u8D44" },
    name: { type: "string", minLength: 1, description: "\u540D\u5B57 1-12\u5B57" },
    gender: { type: "string", enum: ["\u7537", "\u5973"], description: "\u6027\u522B" },
    temperament: { type: "string", minLength: 1, description: "\u6027\u683C 2-8\u5B57" }
  },
  required: ["origin", "talents", "name", "gender", "temperament"],
  description: "\u5EFA\u89D2\uFF08\u9009\u51FA\u8EAB\u5929\u8D44\u53D6\u540D\uFF09"
};
var OPENING_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, description: "\u5F00\u573A\u53D9\u4E8B 200-400\u5B57\u7B2C\u4E8C\u4EBA\u79F0" },
    options: { type: "array", minItems: 2, maxItems: 4, items: CHOICE_OPTION_SCHEMA, description: "\u5F00\u5C40\u9009\u9879 2-4 \u4E2A" }
  },
  required: ["text", "options"],
  description: "\u5F00\u573A\u5267\u60C5"
};
var REVIEW_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number", minimum: 0, maximum: 100, description: "\u8BC4\u5206 0-100\uFF0C80\u53CA\u683C" },
    feedback: { type: "string", minLength: 1, description: "\u53CD\u9988\u5EFA\u8BAE" },
    pass: { type: "boolean", description: "\u662F\u5426\u901A\u8FC7" }
  },
  required: ["score", "feedback", "pass"],
  description: "\u8BC4\u5BA1\u7ED3\u679C"
};
var ERA_YEARS_SCHEMA = {
  type: "object",
  properties: {
    years: { type: "number", minimum: 1, description: "\u63A8\u6F14\u5E74\u6570" }
  },
  required: ["years"],
  description: "\u7EAA\u5143\u63A8\u6F14\u5E74\u6570"
};

// src/flows/character.ts
function characterCreationNodes(rules, views) {
  return [
    // [llm] 建角抉择：根据世界名+出身池+天资池让 AI 选定 origin/talents/name/gender/temperament | prompt: CHAR_CREATE_SYSTEM | schema: {origin, talents[3], name, gender, temperament} | assign: charCreate
    {
      type: "llm",
      system: CHAR_CREATE_SYSTEM,
      input: (ctx) => {
        const w = ctx.state._w;
        return `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input?.text || ""}
\u4E16\u754C\uFF1A${w.stats.world?.name || ""}

\u51FA\u8EAB\u6C60\uFF1A
${JSON.stringify(rules.parseOriginPool(ctx.state._w))}

\u5929\u8D44\u6C60\uFF089\u6761\u5409\u51F6 6:3\uFF0C\u9700\u62BD 3\uFF09\uFF1A
${JSON.stringify(rules.parseTalentPool(ctx.state._w))}`;
      },
      schema: CHAR_CREATE_SCHEMA,
      assign: "charCreate"
    },
    // [static] 落库校验：校验 charCreate 合法性并写入 WorldState（出身/天资/姓名/性别/初始属性） | 无 prompt/schema | 读 charCreate | 规则: rules.applyCharacter
    { type: "static", fn: rules.applyCharacter },
    // [llm] 开场剧情生成：基于已落库的 publicState 生成开场文本与 2-4 个初始选项 | prompt: OPENING_SYSTEM | schema: {text, options[{text, risk}]} | assign: opening
    {
      type: "llm",
      system: OPENING_SYSTEM,
      input: (ctx) => {
        const w = ctx.state._w;
        return `\u5F53\u524D\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}`;
      },
      schema: OPENING_SCHEMA,
      assign: "opening"
    },
    // [static] 开场校验：校验 opening 文本与选项数/风险等级合法性，写 log 并持久化 | 无 prompt/schema | 读 opening | 规则: rules.validateOpening
    { type: "static", fn: rules.validateOpening },
    // [render] 首屏渲染：调用 views.buildFirstScreen 将开场剧情与选项渲染为首屏 | 无 prompt/schema/assign | 依赖 opening 已校验
    { type: "render", build: views.buildFirstScreen }
  ];
}

// src/flows/game.ts
function worldGenNodes(rules) {
  return [
    // [llm] 世界骨架生成：根据玩家愿望生成 world（name/regions/sects/towns/law/rumor） | prompt: WORLD_BASE_SYSTEM | schema: WORLD_BASE_SCHEMA | assign: worldBase
    {
      type: "llm",
      system: WORLD_BASE_SYSTEM,
      input: (ctx) => `\u73A9\u5BB6\u613F\u671B\uFF1A${ctx.input?.text || ""}
\u8BF7\u751F\u6210\u4E16\u754C\u9AA8\u67B6\uFF08world + majorEvents\uFF09\u3002`,
      schema: WORLD_BASE_SCHEMA,
      assign: "worldBase"
    },
    // [static] 世界骨架落库：校验 worldBase 并写入 WorldState，失败则阻断 | 无 prompt/schema | 读 worldBase | 规则: rules.applyWorldBase
    { type: "static", fn: rules.applyWorldBase },
    // [llm] 出身池生成：基于世界名+玩家初输生成 2-4 个出身（NPC 池由独立工具 generate_npcs 生成） | prompt: ORIGINS_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins
    {
      type: "llm",
      system: ORIGINS_SYSTEM,
      input: (ctx) => {
        const w = ctx.state._w.stats;
        const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
        return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u5730\u57DF\uFF1A${(w.world?.regions || []).join("\u3001")}
\u57CE\u9547\uFF1A${(w.world?.towns || []).map((t) => t.name).join("\u3001")}
\u8BF7\u751F\u6210 2-4 \u4E2A\u51FA\u8EAB\uFF08origins\uFF09\uFF0Clocation \u987B\u4E3A\u4E0A\u8FF0\u5730\u57DF/\u57CE\u9547\u3002`;
      },
      schema: ORIGINS_SCHEMA,
      assign: "origins"
    },
    // [static] 出身初次校验：调用 rules.applyOrigins，失败且未重试则暂存 originsError 待 condition 重试 | 无 prompt/schema | 读 origins | 规则: rules.applyOrigins
    {
      type: "static",
      fn: (ctx) => {
        const err = rules.applyOrigins(ctx);
        if (err) {
          if (!ctx.data.originsRetried) {
            ;
            ctx.data.originsError = err;
            return;
          }
          return err;
        }
        delete ctx.data.originsError;
      }
    },
    // [condition] 出身重试分支：当 originsError 存在且未重试时进入重试子链
    {
      type: "condition",
      when: (ctx) => !!ctx.data.originsError && !ctx.data.originsRetried,
      then: [
        // [static] 标记重试：置 originsRetried=true | 无 prompt/schema
        {
          type: "static",
          fn: (ctx) => {
            ;
            ctx.data.originsRetried = true;
            return;
          }
        },
        // [llm] 出身重试生成：携带上次校验失败反馈重写出身，约束灵石 0-50 | prompt: ORIGINS_RETRY_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins（覆盖）
        {
          type: "llm",
          system: ORIGINS_RETRY_SYSTEM,
          input: (ctx) => {
            const w = ctx.state._w.stats;
            const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
            const fb = ctx.data.originsError || "";
            return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u5730\u57DF\uFF1A${(w.world?.regions || []).join("\u3001")}
\u57CE\u9547\uFF1A${(w.world?.towns || []).map((t) => t.name).join("\u3001")}
\u4E0A\u6B21\u6821\u9A8C\u5931\u8D25\uFF1A${fb}
\u8BF7\u4FEE\u6B63\u540E\u91CD\u5199\u51FA\u8EAB\uFF08\u521D\u59CB\u7075\u77F3 0-50\uFF0C\u4F4E\u9636\u51FA\u8EAB\u52FF\u8D85 50\uFF09\u3002`;
          },
          schema: ORIGINS_SCHEMA,
          assign: "origins"
        },
        // [static] 出身重试校验落库：再次调用 rules.applyOrigins，失败直接阻断 | 读 origins | 规则: rules.applyOrigins
        {
          type: "static",
          fn: (ctx) => {
            const err = rules.applyOrigins(ctx);
            if (err) return err;
            delete ctx.data.originsError;
          }
        }
      ],
      else: []
    },
    // [llm] 天资池生成：基于世界名+出身池+玩家初输生成 9 条天资（6吉3凶） | prompt: TALENTS_SYSTEM | schema: TALENTS_SCHEMA | assign: talents
    {
      type: "llm",
      system: TALENTS_SYSTEM,
      input: (ctx) => {
        const w = ctx.state._w.stats;
        const origins = rules.parseOriginPool(ctx.state._w).map((o) => o.name);
        const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
        return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u51FA\u8EAB\u6C60\uFF1A${JSON.stringify(origins)}
\u8BF7\u751F\u6210 2-4 \u4E2A\u5929\u8D44\uFF08talents\uFF09\u3002`;
      },
      schema: TALENTS_SCHEMA,
      assign: "talents"
    },
    // [static] 天资初次校验：调用 rules.applyTalents，失败且未重试则暂存 talentsError | 无 prompt/schema | 读 talents | 规则: rules.applyTalents
    {
      type: "static",
      fn: (ctx) => {
        const err = rules.applyTalents(ctx);
        if (err) {
          if (!ctx.data.talentsRetried) {
            ;
            ctx.data.talentsError = err;
            return;
          }
          return err;
        }
        delete ctx.data.talentsError;
      }
    },
    // [condition] 天资重试分支：当 talentsError 存在且未重试时进入重试子链
    {
      type: "condition",
      when: (ctx) => !!ctx.data.talentsError && !ctx.data.talentsRetried,
      then: [
        // [static] 标记重试：置 talentsRetried=true | 无 prompt/schema
        {
          type: "static",
          fn: (ctx) => {
            ;
            ctx.data.talentsRetried = true;
            return;
          }
        },
        // [llm] 天资重试生成：携带校验失败反馈重写天资，约束灵石 0-50 | prompt: TALENTS_RETRY_SYSTEM | schema: TALENTS_SCHEMA | assign: talents（覆盖）
        {
          type: "llm",
          system: TALENTS_RETRY_SYSTEM,
          input: (ctx) => {
            const w = ctx.state._w.stats;
            const origins = rules.parseOriginPool(ctx.state._w).map((o) => o.name);
            const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
            const fb = ctx.data.talentsError || "";
            return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u51FA\u8EAB\u6C60\uFF1A${JSON.stringify(origins)}
\u4E0A\u6B21\u6821\u9A8C\u5931\u8D25\uFF1A${fb}
\u8BF7\u4FEE\u6B63\u540E\u91CD\u5199\u5929\u8D44\uFF08\u521D\u59CB\u7075\u77F3 0-50\uFF09\u3002`;
          },
          schema: TALENTS_SCHEMA,
          assign: "talents"
        },
        // [static] 天资重试校验落库：再次调用 rules.applyTalents | 读 talents | 规则: rules.applyTalents
        {
          type: "static",
          fn: (ctx) => {
            const err = rules.applyTalents(ctx);
            if (err) return err;
            delete ctx.data.talentsError;
          }
        }
      ],
      else: []
    },
    // 合审 origins+talents 一次（80分阈值）
    // [llm] Starter 合审：对出身+天资做 80 分阈值评审，输出 score/feedback/pass | prompt: REVIEW_STARTER_COMBINED_SYSTEM | input: reviewStarterCombinedInput | schema: {score, feedback, pass} | assign: reviewStarterCombined
    {
      type: "llm",
      system: REVIEW_STARTER_COMBINED_SYSTEM,
      input: reviewStarterCombinedInput,
      schema: REVIEW_SCHEMA,
      assign: "reviewStarterCombined"
    },
    // [condition] 合审未通过重写分支：score<80 && pass===false 且未重试时，整体重写出身与天资
    {
      type: "condition",
      when: (ctx) => {
        const r = ctx.data.reviewStarterCombined;
        return (r?.score ?? 100) < 80 && r?.pass === false && !ctx.data.starterRetried;
      },
      then: [
        // [static] 标记合审重试：置 starterRetried=true 并保存 feedback 到 starterFeedback | 无 prompt/schema | 读 reviewStarterCombined
        {
          type: "static",
          fn: (ctx) => {
            const r = ctx.data.reviewStarterCombined;
            ctx.data.starterRetried = true;
            ctx.data.starterFeedback = r?.feedback || "";
            return;
          }
        },
        // [llm] 出身合审重写：携带评审反馈重写出身 | prompt: ORIGINS_RETRY_SYSTEM | schema: ORIGINS_SCHEMA | assign: origins
        {
          type: "llm",
          system: ORIGINS_RETRY_SYSTEM,
          input: (ctx) => {
            const w = ctx.state._w.stats;
            const fb = ctx.data.starterFeedback || "";
            const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
            return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u5730\u57DF\uFF1A${(w.world?.regions || []).join("\u3001")}
\u57CE\u9547\uFF1A${(w.world?.towns || []).map((t) => t.name).join("\u3001")}
\u8BC4\u5BA1\u53CD\u9988\uFF1A${fb}
\u8BF7\u91CD\u5199\u51FA\u8EAB\u3002`;
          },
          schema: ORIGINS_SCHEMA,
          assign: "origins"
        },
        // [static] 出身重写落库：校验并写入 | 读 origins | 规则: rules.applyOrigins
        { type: "static", fn: rules.applyOrigins },
        // [llm] 天资合审重写：携带评审反馈重写天资 | prompt: TALENTS_RETRY_SYSTEM | schema: TALENTS_SCHEMA | assign: talents
        {
          type: "llm",
          system: TALENTS_RETRY_SYSTEM,
          input: (ctx) => {
            const w = ctx.state._w.stats;
            const origins = rules.parseOriginPool(ctx.state._w).map((o) => o.name);
            const fb = ctx.data.starterFeedback || "";
            const wish = ctx.input?.text?.trim() ? `\u73A9\u5BB6\u521D\u8F93\uFF1A${ctx.input.text}
` : "";
            return `${wish}\u4E16\u754C\uFF1A${w.world?.name || ""}
\u51FA\u8EAB\u6C60\uFF1A${JSON.stringify(origins)}
\u8BC4\u5BA1\u53CD\u9988\uFF1A${fb}
\u8BF7\u91CD\u5199\u5929\u8D44\u3002`;
          },
          schema: TALENTS_SCHEMA,
          assign: "talents"
        },
        // [static] 天资重写落库：校验并写入 | 读 talents | 规则: rules.applyTalents
        { type: "static", fn: rules.applyTalents }
      ],
      else: []
    }
  ];
}
function registerGameFlows(api, ledger, rules, views) {
  api.flow.register({
    name: "create_world",
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [static] 世界重置：全量清空 WorldState 为 newWorld 初始值 | 规则: resetWorld
      { type: "static", fn: resetWorld },
      // [subflow] 世界生成子链：展开 worldGenNodes 全部节点（LLM+校验+重试+合审）
      ...worldGenNodes(rules),
      // [render] 世界屏渲染：调用 views.buildWorldScreen 展示世界信息与出身/天资预览 | 依赖 worldBase/origins/talents
      { type: "render", build: views.buildWorldScreen }
    ],
    requireRender: true
  });
  api.flow.register({
    name: "generate_npcs",
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [llm×3] NPC 三批生成：每批 10 人（凡人2+修士7+大修士1），input 带已有名单（世界已存 NPC + 前批）防重名
      ...Array.from({ length: 3 }, (_, i) => {
        const idx = i + 1;
        return {
          type: "llm",
          system: npcSystem(idx),
          input: (ctx) => buildNpcInput(ctx, idx),
          schema: npcBatchSchema("npcBatch" + idx),
          assign: "npcBatch" + idx
        };
      }),
      // [static] NPC 池合并落库：三批去重后追加进 WorldState.characters | 读 npcBatch1..3 | 规则: rules.applyNpcPool
      { type: "static", fn: rules.applyNpcPool }
    ],
    requireRender: false
  });
  api.flow.register({
    name: "create_character",
    nodes: [
      // [static] 上下文初始化：加载 WorldState | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [subflow] 建角子链：展开 characterCreationNodes（选角→落库→开场→渲染）
      ...characterCreationNodes(rules, views)
    ],
    requireRender: true
  });
  api.flow.register({
    name: "reset_character",
    nodes: [
      // [static] 上下文初始化：加载 WorldState | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [static] 角色重置：仅清空角色维度，保留世界/出身池/天资池/时间 | 规则: resetCharacter
      { type: "static", fn: resetCharacter },
      // [subflow] 建角子链：重走选角与开场 | 依赖 characterCreationNodes
      ...characterCreationNodes(rules, views)
    ],
    requireRender: true
  });
  api.flow.register({
    name: "era_rebirth",
    nodes: [
      // [static] 上下文初始化：加载 WorldState | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [llm] 年数推演：解析玩家输入中的推演年数，未提及默认 100 | prompt: 时间推演器 system | schema: {years:number} | assign: eraYears
      {
        type: "llm",
        system: "\u4F60\u662F\u65F6\u95F4\u63A8\u6F14\u5668\u3002\u6839\u636E\u73A9\u5BB6\u8F93\u5165\uFF0C\u5224\u65AD\u8981\u63A8\u6F14\u7684\u5E74\u6570\uFF08\u82E5\u672A\u63D0\u53CA\u5219\u9ED8\u8BA4100\u5E74\uFF09\uFF0C\u53EA\u8F93\u51FA JSON {years: number}\u3002",
        input: (ctx) => `\u73A9\u5BB6\u8F93\u5165\uFF1A${ctx.input?.text || ""}
\u8BF7\u5224\u65AD\u63A8\u6F14\u5E74\u6570\uFF0C\u672A\u63D0\u53CA\u5219100\u3002`,
        schema: ERA_YEARS_SCHEMA,
        assign: "eraYears"
      },
      // [static] 纪元切换落库：按年数推进 timeMonth/寿命，保留 log 与时间，其余重置为新世界 | 读 eraYears | 规则: 内联纪元重置逻辑
      {
        type: "static",
        fn: (ctx) => {
          const y = ctx.data.eraYears?.years;
          const years = Number.isInteger(y) && y > 0 ? y : 100;
          const w = ctx.state._w;
          const prevName = w.stats.name || "\u65E0\u540D";
          const prevWorld = JSON.stringify(w.stats.world).slice(0, 800);
          const months = years * 12;
          w.stats.timeMonth += months;
          w.stats.lifespan -= years;
          const fresh = newWorld();
          const keptTime = w.stats.timeMonth;
          w.meta = { initialized: false, created: false, dead: false, turns: 0 };
          w.stats = { ...fresh.stats, timeMonth: keptTime };
          w.majorEvents = [];
          w.originPool = [];
          w.talentPool = [];
          ledger.saveAll();
        }
      },
      // [subflow] 世界生成子链：基于新时间点重新生成世界与出身/天资（NPC 池已清空，由 LLM 调度器调 generate_npcs 重新生成）
      ...worldGenNodes(rules),
      // [render] 世界屏渲染：展示新纪元世界预览 | 依赖 worldGenNodes 产出
      { type: "render", build: views.buildWorldScreen },
      // [subflow] 建角子链：紧接世界屏后直接进入新角色创建与开场
      ...characterCreationNodes(rules, views)
    ],
    requireRender: true
  });
}

// src/flows/turn.ts
function registerTurnFlows(api, ledger, rules, views) {
  api.flow.register({
    name: "game_turn",
    nodes: [
      // [static] 上下文初始化：加载 ledger 世界到 ctx.state._w | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [static] 前置校验：检查 meta.created/meta.dead，未建角或已死亡则阻断流程 | 无 prompt/schema | 读 w.meta
      {
        type: "static",
        fn: (ctx) => {
          const w = ctx.state._w;
          if (!w.meta.created) return "\u89D2\u8272\u672A\u521B\u5EFA\uFF0C\u8BF7\u5148\u521B\u5EFA\u89D2\u8272";
          if (w.meta.dead) return "\u5DF2\u8EAB\u6B7B\u9053\u6D88\uFF0C\u8BF7\u91CD\u5F00";
          return;
        }
      },
      // [static] 分支抽检：解析玩家输入匹配 pendingBranch，命中则写入 branchPick 并 saveAll | 无 prompt/schema | 读 ctx.input.text | 规则: consumePendingBranch | 写 ctx.data.branchPick
      {
        type: "static",
        fn: (ctx) => {
          const w = ctx.state._w;
          const inputText = ctx.input?.text || "";
          const pick = consumePendingBranch(inputText, w);
          if (pick) {
            ;
            ctx.data.branchPick = pick;
            ledger.saveAll();
          }
          return;
        }
      },
      // [condition] 战斗分支分流：当 branchPick.kind === 'battle' 时走战斗路径，否则走常规回合路径
      {
        type: "condition",
        when: (ctx) => ctx.data.branchPick !== void 0 && ctx.data.branchPick.kind === "battle",
        then: [
          // [llm] 战斗推演：根据分支标题/描述+玩家输入+全量状态客观推演战斗 | prompt: CONFRONTATION_BATTLE_SYSTEM | schema: {text, dead, delta: DELTA_SCHEMA} | assign: battleConfrontation
          {
            type: "llm",
            system: CONFRONTATION_BATTLE_SYSTEM,
            input: (ctx) => {
              const w = ctx.state._w;
              const pick = ctx.data.branchPick;
              return `\u73A9\u5BB6\u9009\u62E9\u5206\u652F\uFF1A${pick?.title || ""}\uFF08${pick?.simpleDesc || ""}\uFF09
\u73A9\u5BB6\u8F93\u5165\uFF1A${ctx.input?.text || ""}

\u5F53\u524D\u5168\u91CF\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}
\u8BF7\u5BA2\u89C2\u63A8\u6F14\u6218\u6597\u5E76\u7ED9\u51FA\u7ED3\u679C\u3002`;
            },
            schema: BATTLE_SCHEMA,
            assign: "battleConfrontation"
          },
          { type: "static", fn: rules.applyConfrontationBattle },
          // [condition] 存活才生成选项：未死亡时才继续生成下轮选项
          {
            type: "condition",
            when: (ctx) => ctx.state._w.meta.dead !== true,
            then: [
              // [llm] 战后选项生成：基于战斗文本与当前状态生成 4 个带风险与分支的选项 | prompt: CHOICE_SYSTEM | schema: {options[4]{text, risk, branches[2-3]}} | assign: choice
              {
                type: "llm",
                system: CHOICE_SYSTEM,
                input: (ctx) => {
                  const w = ctx.state._w;
                  const battleText = ctx.data.battleConfrontation?.text || "";
                  return `\u672C\u56DE\u5408\u5267\u60C5\uFF1A${battleText}
\u5F53\u524D\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}`;
                },
                schema: CHOICE_SCHEMA,
                assign: "choice"
              },
              // [static] 选项校验：检查 choice 选项数/风险/分支合法性 | 读 choice | 规则: rules.validateChoice
              { type: "static", fn: rules.validateChoice },
              // [static] 分支存储：将 choice 中的 branches 抽检存储为 pendingBranch | 读 choice | 规则: rules.storePendingBranch
              { type: "static", fn: rules.storePendingBranch }
            ]
          },
          // [render] 主屏渲染：战斗路径终点渲染游戏主屏 | 依赖 battleConfrontation / choice
          { type: "render", build: views.buildPlayScreen }
        ],
        else: [
          // [llm] 常规回合推演：根据玩家行动+分支 other 提示+全量状态生成剧情 | prompt: TURN_SYSTEM | schema: {text, kind, eventRef, delta, relationships, romance, cultivate, switchMain, breakthrough, timeCost} | assign: turn
          {
            type: "llm",
            system: TURN_SYSTEM,
            input: (ctx) => {
              const w = ctx.state._w;
              const pick = ctx.data.branchPick;
              const branchHint = pick ? `\uFF08\u672C\u6B21\u4E3A\u5206\u652F\u62BD\u68C0\u547D\u4E2D other\uFF1A${pick.title} - ${pick.simpleDesc}\uFF0C\u8BF7\u636E\u6B64\u5C55\u5F00\u5B8C\u6574\u5267\u60C5\uFF09` : "";
              return `\u73A9\u5BB6\u884C\u52A8\uFF1A${ctx.input?.text || "\uFF08\u65E0\uFF09"}${branchHint}

\u5F53\u524D\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}`;
            },
            schema: TURN_SCHEMA,
            assign: "turn"
          },
          // [condition] 突破分流：当 turn.breakthrough === true 时走突破子链，否则走常规落库
          {
            type: "condition",
            when: (ctx) => !!ctx.data.turn?.breakthrough,
            then: [
              // [static] 突破率计算：调用 calcBreakthroughRate 掷骰决定 success，检查修为是否达 cap | 无 prompt/schema | 读 turn | 写 breakthroughCalc | 规则: rules.calcBreakthroughRate + cultivationCap
              {
                type: "static",
                fn: (ctx) => {
                  const w = ctx.state._w;
                  const { rate, talentBonus, base, breakBonus } = rules.calcBreakthroughRate(w);
                  const success = Math.random() < rate;
                  ctx.data.breakthroughCalc = { rate, talentBonus, base, breakBonus, success };
                  const cap = rules.cultivationCap(w);
                  if (w.stats.cultivation < cap) return `\u4FEE\u4E3A\u4E0D\u8DB3\uFF1A${w.stats.cultivation}/${cap}\uFF0C\u8BF7\u5148\u4FEE\u70BC`;
                  return;
                }
              },
              // [llm] 突破文案生成：基于当前状态与突破计算结果生成突破文本 | prompt: BREAKTHROUGH_SYSTEM | schema: {text, extraCultivation, nextRateBonus} | assign: breakthrough
              {
                type: "llm",
                system: BREAKTHROUGH_SYSTEM,
                input: (ctx) => {
                  const w = ctx.state._w;
                  const calc = ctx.data.breakthroughCalc;
                  return `\u5F53\u524D\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}
\u7A81\u7834\u8BA1\u7B97\uFF1A\u6210\u529F=${calc?.success} \u7387=${calc ? Math.round(calc.rate * 100) : "?"}% \u5929\u8D44\u52A0\u6210=${calc?.talentBonus ?? 0}
\u8BF7\u636E\u6B64\u5199\u7A81\u7834\u77ED\u6587\u6848\u5E76\u7ED9\u51FA extraCultivation/nextRateBonus\u3002`;
                },
                schema: BREAKTHROUGH_SCHEMA,
                assign: "breakthrough"
              },
              // [static] 突破落库：应用突破结果（境界/修为/加成）并写 log | 读 breakthrough/breakthroughCalc | 规则: rules.applyBreakthrough
              { type: "static", fn: rules.applyBreakthrough }
            ],
            else: [
              // [static] 常规落库：应用 turn 的 delta/关系/修炼/时间等 | 读 turn | 规则: rules.applyTurn
              { type: "static", fn: rules.applyTurn }
            ]
          },
          // [condition] 存活才存分支抽检：死亡时无下轮选项，不存 pendingBranch
          {
            type: "condition",
            when: (ctx) => ctx.state._w.meta.dead !== true,
            then: [
              // [static] 分支存储：将 turn.options 中的分支存储为 pendingBranch（选项已由说书人节点直接输出）| 读 turn.options | 规则: rules.storePendingBranch
              { type: "static", fn: rules.storePendingBranch }
            ]
          },
          // [render] 主屏渲染：常规路径终点渲染游戏主屏 | 依赖 turn（含 options）
          { type: "render", build: views.buildPlayScreen }
        ]
      }
    ],
    requireRender: true
  });
}

// src/flows/majorEvents.ts
function makeApplyDecadalEvents(ledger) {
  return (ctx) => {
    const w = ctx.state._w;
    const world = w.stats.world;
    if (!world || typeof world.name !== "string" || !world.name.trim()) return "\u4E16\u754C\u9AA8\u67B6\u4E3A\u7A7A\uFF0C\u8BF7\u5148 create_world";
    if (!Array.isArray(world.regions) || world.regions.length === 0) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08regions \u7F3A\u5931\uFF09\uFF0C\u8BF7\u5148 create_world";
    if (!Array.isArray(world.sects) || world.sects.length === 0) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08sects \u7F3A\u5931\uFF09\uFF0C\u8BF7\u5148 create_world";
    if (typeof world.law !== "string" || !world.law.trim()) return "\u4E16\u754C\u9AA8\u67B6\u4E0D\u5168\uFF08law \u7F3A\u5931\uFF09\uFF0C\u8BF7\u5148 create_world";
    const d = ctx.data.decadalEvents;
    const raw = Array.isArray(d?.majorEvents) ? d.majorEvents : [];
    if (raw.length < 15 || raw.length > 30) return "\u5927\u4E8B\u4EF6\u6570\u91CF\u987B 15-30 \u6761";
    const events = [];
    for (const e of raw) {
      const name = String(e.name || "").trim();
      if (!name) return "\u5927\u4E8B\u4EF6 name \u4E0D\u80FD\u4E3A\u7A7A";
      const at = Number(e.at);
      const by = Number(e.by);
      const type = String(e.type || "\u673A\u9047");
      if (!["\u673A\u9047", "\u5371\u673A", "\u8F6C\u6298", "\u9AD8\u6F6E"].includes(type)) return `\u4E8B\u4EF6\u300C${name}\u300Dtype \u975E\u6CD5`;
      const summary = String(e.summary || "").trim();
      if (!summary) return `\u4E8B\u4EF6\u300C${name}\u300Dsummary \u4E0D\u80FD\u4E3A\u7A7A`;
      if (w.majorEvents.some((ex) => ex.name === name) || events.some((ex) => ex.name === name)) return `\u5927\u4E8B\u4EF6\u540D\u91CD\u590D\uFF1A${name}`;
      events.push({ name, at, by, type, summary, status: "pending" });
    }
    w.majorEvents.push(...events);
    ledger.saveAll();
    return null;
  };
}
function registerMajorEventsFlows(api, ledger, _rules, _views) {
  api.flow.register({
    name: "generate_major_events",
    nodes: [
      // [static] 上下文初始化：加载 ledger.getWorld 到 ctx.state._w | 无 prompt/schema | 规则: initCtx(ledger)
      { type: "static", fn: initCtx(ledger) },
      // [llm] 十年大事件生成：基于当前时间/世界名/地域宗门/已有事件让 AI 生成未来 5-10 条事件 | prompt: MAJOR_EVENTS_SYSTEM | schema: DECADAL_EVENTS_SCHEMA | assign: decadalEvents
      {
        type: "llm",
        system: MAJOR_EVENTS_SYSTEM,
        input: (ctx) => {
          const w = ctx.state._w;
          const world = w.stats.world;
          return `\u5F53\u524D\u65F6\u95F4\uFF1A\u7B2C${w.stats.timeMonth}\u6708
\u4E16\u754C\uFF1A${JSON.stringify({ name: world?.name, regions: world?.regions, sects: world?.sects?.map((s) => s.name) })}
\u5DF2\u6709\u5927\u4E8B\u4EF6\uFF1A${JSON.stringify(w.majorEvents.map((e) => `${e.name}@${e.at}`))}
\u8BF7\u751F\u6210\u672A\u6765\u4E94\u5341\u5E74 15-30 \u6761\u5927\u4E8B\u4EF6\uFF0C\u5747\u5300\u5206\u5E03\u5728 50 \u5E74\u5185\uFF08at \u987B >${w.stats.timeMonth} \u4E14 \u2264${w.stats.timeMonth + 600}\uFF09\u3002`;
        },
        schema: DECADAL_EVENTS_SCHEMA,
        assign: "decadalEvents"
      },
      // [static] 校验落库：将 decadalEvents 校验后写入 w.majorEvents 并 saveAll | 无 prompt/schema | 读 decadalEvents | 规则: makeApplyDecadalEvents(ledger)
      { type: "static", fn: makeApplyDecadalEvents(ledger) },
      // [static] 结果回写：将新生成事件数写入 ctx.data.resultText 供调用方展示 | 无 prompt/schema | 读 w.majorEvents
      {
        type: "static",
        fn: (ctx) => {
          const w = ctx.state._w;
          const evs = w.majorEvents.slice(-30);
          ctx.data.resultText = `\u5DF2\u751F\u6210\u672A\u6765\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6 ${evs.length} \u6761`;
          return;
        }
      }
    ],
    requireRender: false
  });
}

// src/flows/query.ts
function registerQueryFlows(api, ledger, rules) {
  api.flow.register({
    name: "game_query",
    nodes: [
      // [static] 上下文初始化：加载 ledger 到 ctx.state._w
      { type: "static", fn: initCtx(ledger) },
      // [llm] 档案查询：基于全量状态回答纯问题，不推时间 | prompt: QUERY_SYSTEM | schema: answer | assign: query
      {
        type: "llm",
        system: QUERY_SYSTEM,
        input: (ctx) => {
          const w = ctx.state._w;
          const focus = ctx.input?.focus || ctx.input?.text || "";
          return `\u95EE\u9898\uFF1A${focus}

\u5F53\u524D\u5168\u91CF\u72B6\u6001\uFF1A
${JSON.stringify(rules.publicState(w))}`;
        },
        schema: QUERY_SCHEMA,
        assign: "query"
      },
      // [static] 结果回写：将 LLM 的 answer 写入 ctx.data.queryAnswer 供 tool 透传
      {
        type: "static",
        fn: (ctx) => {
          const d = ctx.data.query;
          if (!d || typeof d.answer !== "string" || !d.answer.trim()) return "\u67E5\u8BE2\u56DE\u7B54\u4E3A\u7A7A";
          ctx.data.queryAnswer = d.answer.trim();
          return null;
        }
      }
    ],
    requireRender: false
  });
}

// src/flows.ts
function registerFlows(api, ledger, rules, views) {
  registerGameFlows(api, ledger, rules, views);
  registerTurnFlows(api, ledger, rules, views);
  registerMajorEventsFlows(api, ledger, rules, views);
  registerQueryFlows(api, ledger, rules, views);
}

// src/tools.ts
function formatUiTree(state) {
  const n = state;
  if (!n || typeof n !== "object" || typeof n.component !== "string") return "";
  const fmt = (chs) => {
    if (!chs?.length) return "";
    return chs.map((c) => {
      const x = c;
      const propsStr = x.props ? Object.entries(x.props).filter(([k]) => k !== "className").map(([k, v]) => `${k}=${v}`).join(" ") : "";
      const childStr = x.children?.length ? ` [${fmt(x.children)}]` : "";
      return `${x.component}(${propsStr})${childStr}`;
    }).join(", ");
  };
  const childrenText = fmt(n.children);
  return `[UI:${n.component}]${childrenText ? ` ${childrenText}` : ""}`;
}
function uiPrompt(toolName, text, state, instruction) {
  const ui = state ? formatUiTree(state) : "";
  return { success: { toolName }, instruction, result: ui ? { text, ui } : { text } };
}
function failPrompt(toolName, error) {
  return { success: { toolName, error } };
}
function runFlow(api, flowName, input, meta) {
  return api.flow.run(flowName, input, {
    conversationId: meta.conversationId,
    contextId: meta.contextId
  }).then((res) => {
    if (!res.ok) return { ok: false, error: res.error || "\u6E38\u620F\u5F15\u64CE\u6267\u884C\u5931\u8D25" };
    const render = res.state?.__render;
    return { ok: true, result: { state: res.state, render } };
  });
}
function refreshWorldSetting(api, ledger, rules, meta) {
  const w = ledger.getWorld(meta.conversationId ?? "");
  api.memory.set("world_setting", rules.worldSetting(w), {
    conversationId: meta.conversationId,
    contextId: meta.contextId
  });
}
function registerTools(api, ledger, rules) {
  const defs = [
    {
      name: "create_world",
      description: "\u521B\u5EFA/\u91CD\u7F6E\u4E16\u754C\uFF1A\u6E05\u7A7A\u4E16\u754C\u540E\u751F\u6210\u4E16\u754C\u9AA8\u67B6\u3001\u51FA\u8EAB/\u5929\u8D44\u6C60\u5E76\u63A8\u9001\u4E16\u754C\u5C4F\u3002\u4E0E\u5927\u4E8B\u4EF6/NPC \u751F\u6210\u89E3\u8026\uFF0C\u6210\u529F\u540E\u5FC5\u987B\u7D27\u8DDF generate_npcs\uFF083\u6B21\uFF09\u6269\u5145 NPC \u6C60\uFF0C\u518D generate_major_events \u751F\u6210\u9996\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6\u3002",
      inputSchema: { type: "object", properties: { text: { type: "string", description: "\u73A9\u5BB6\u8F93\u5165\u539F\u6587" } }, required: ["text"] },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("create_world", result.error);
        const state = result.result?.render;
        return uiPrompt("create_world", "[\u4E16\u754C\u5DF2\u521B\u5EFA]", state, "\u8BF7\u7D27\u8DDF generate_npcs \u8FDE\u7EED\u8C03\u7528 3 \u6B21\u751F\u6210 NPC \u6C60\uFF0C\u7136\u540E generate_major_events \u751F\u6210\u9996\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6\uFF0C\u5B8C\u6210\u540E\u7EE7\u7EED create_character \u5EFA\u89D2\uFF0C\u4E0D\u53EF\u63D0\u524D\u6536\u8F6E");
      },
      run: (input, meta) => {
        return runFlow(api, "create_world", input, meta).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta);
          return res;
        });
      }
    },
    {
      name: "create_character",
      description: "\u521B\u5EFA\u89D2\u8272\uFF1A\u4ECE\u5DF2\u751F\u6210\u7684\u51FA\u8EAB/\u5929\u8D44\u6C60\u4E2D\u9009\u51FA\u8EAB\u5929\u8D44\u53D6\u540D\u5EFA\u89D2\u5E76\u63A8\u9001\u9996\u5C4F\u3002\u9700\u5148\u6709\u4E16\u754C\u3002",
      inputSchema: { type: "object", properties: { text: { type: "string", description: "\u73A9\u5BB6\u8F93\u5165\u539F\u6587" } }, required: ["text"] },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("create_character", result.error);
        const state = result.result?.render;
        return uiPrompt("create_character", "[\u89D2\u8272\u5DF2\u521B\u5EFA]", state, "\u5EFA\u89D2\u5B8C\u6210\uFF0C\u4E16\u754C\u7BA1\u7EBF\u5168\u90E8\u5C31\u7EEA\uFF0C\u8C03\u7528 host_yield \u6536\u8F6E");
      },
      run: (input, meta) => {
        return runFlow(api, "create_character", input, meta).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta);
          return res;
        });
      }
    },
    {
      name: "reset_character",
      description: "\u4EC5\u91CD\u7F6E\u89D2\u8272\uFF1A\u4FDD\u7559\u5F53\u524D\u4E16\u754C\u3001\u51FA\u8EAB\u6C60/\u5929\u8D44\u6C60\u4E0E\u5927\u4E8B\u4EF6/\u65F6\u95F4\uFF0C\u4E0D\u63A8\u65F6\u95F4\uFF0C\u4EC5\u6E05\u7A7A\u89D2\u8272\u540E\u4ECE\u6C60\u4E2D\u91CD\u9009\u51FA\u8EAB\u5929\u8D44\u5E76\u91CD\u5EFA\u89D2\u8272\u3002\u73A9\u5BB6\u60F3\u6362\u4E2A\u89D2\u8272/\u7528\u6B64\u4E16\u754C\u91CD\u6765\u4E00\u6B21\u65F6\u8C03\u7528\u3002",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "\u73A9\u5BB6\u8F93\u5165\u539F\u6587\uFF08\u91CD\u7F6E\u89D2\u8272\u610F\u613F\uFF09" }
        },
        required: ["text"]
      },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("reset_character", result.error);
        const state = result.result?.render;
        return uiPrompt("reset_character", "[\u89D2\u8272\u5DF2\u91CD\u7F6E] \u5DF2\u4FDD\u7559\u4E16\u754C\uFF0C\u4EC5\u91CD\u5EFA\u89D2\u8272\u3002", state, "\u89D2\u8272\u91CD\u5EFA\u5B8C\u6210\uFF0C\u8C03\u7528 host_yield \u6536\u8F6E");
      },
      run: (input, meta) => {
        return runFlow(api, "reset_character", input, meta).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta);
          return res;
        });
      }
    },
    {
      name: "era_rebirth",
      description: '\u767E\u5E74\u8F6E\u56DE\uFF1A\u63A8\u6F14\u6307\u5B9A\u65F6\u95F4\u540E\u5728\u539F\u4E16\u754C\u8109\u7EDC\u4E0A\u6F14\u5316\u751F\u6210\u65B0\u4E16\u754C\u4E0E\u65B0\u89D2\u8272\uFF0C\u4FDD\u7559\u7EAA\u5143\u53F2\uFF08\u540C\u4E00\u65F6\u95F4\u7EBF\u591A\u5468\u76EE\uFF09\u3002\u73A9\u5BB6\u8BF4"\u767E\u5E74\u540E/\u5343\u5E74\u540E/XX\u5E74\u540E\u8F6C\u4E16"\u65F6\u8C03\u7528\uFF1B\u4E0D\u6E05\u7A7A\u5386\u53F2\uFF0C\u53EA\u6E05\u672C\u4E16\u89D2\u8272\u4E0E\u5F53\u524D\u4E8B\u4EF6\u3002',
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "\u73A9\u5BB6\u8F93\u5165\u539F\u6587\uFF08\u542B\u65F6\u95F4\u4E0E\u65B0\u4E16\u613F\u671B\uFF09" }
        },
        required: ["text"]
      },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("era_rebirth", result.error);
        const state = result.result?.render;
        return uiPrompt("era_rebirth", "[\u7EAA\u5143\u8F6E\u56DE] \u5DF2\u5EA6\u8FC7\u6307\u5B9A\u65F6\u95F4\uFF0C\u65B0\u4E16\u754C\u4E0E\u65B0\u8EAB\u5DF2\u5C31\u7EEA\u3002", state, "\u7EAA\u5143\u8F6E\u56DE\u5B8C\u6210\uFF0C\u65B0\u4E16\u754C\u4E0E\u65B0\u89D2\u8272\u5DF2\u5C31\u7EEA\uFF0C\u4F46 NPC \u6C60\u5DF2\u6E05\u7A7A\uFF1A\u7ACB\u5373\u8C03\u7528 generate_npcs \u91CD\u5EFA NPC \u6C60\uFF0C\u5B8C\u6210\u540E\u8C03\u7528 host_yield \u6536\u8F6E");
      },
      run: (input, meta) => {
        return runFlow(api, "era_rebirth", input, meta).then((res) => {
          if (res.ok) refreshWorldSetting(api, ledger, rules, meta);
          return res;
        });
      }
    },
    {
      name: "game_turn",
      description: "\u63A8\u8FDB\u4FEE\u4ED9\u4E16\u754C\u5267\u60C5\uFF08\u65F6\u95F4 +\u4EFB\u610F\u6708\uFF08\u53EF\u4E3A0\uFF09\uFF0C\u6309\u95ED\u5173\u65F6\u957F\uFF1B\u5207\u4E3B\u4FEE/\u7A81\u7834\uFF09\uFF1A\u53D9\u4E8B\u63A8\u8FDB\u8FDB\u884C\u4E2D\u7684\u5927\u4E8B\u4EF6\uFF0C\u641C\u522E\u4E39\u836F/\u529F\u6CD5\u4E3A\u8F85\uFF0C\u597D\u611F/\u9053\u4FA3/\u8BB0\u5FC6\u5728\u6B64\u8868\u8FBE\uFF0C\u754C\u9762\u63A8\u9001\uFF08\u6E32\u67D3\u5FC5\u8FBE\uFF09\u3002",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "\u73A9\u5BB6\u8F93\u5165\u539F\u6587" }
        },
        required: ["text"]
      },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("game_turn", result.error);
        const state = result.result?.render;
        const turns = result.result?.meta;
        if (turns?.dead) return uiPrompt("game_turn", "[\u8EAB\u6B7B\u9053\u6D88] \u73A9\u5BB6\u5DF2\u6B7B\u4EA1\uFF0C\u6B64\u5C40\u7ED3\u675F\u3002\u5982\u9700\u91CD\u65B0\u5F00\u59CB\u8BF7\u8C03\u7528 create_world\u3002", state);
        return uiPrompt("game_turn", `[\u672C\u8F6E\u53D9\u4E8B\u5DF2\u7ED3\u675F] \u7B2C${turns?.turns ?? "?"}\u56DE\u5408\u5DF2\u63A8\u9001\u5B8C\u6BD5\u3002\u53EF\u7EC8\u6B62\u672C\u8F6E`, state, "\u672C\u8F6E\u5267\u60C5\u5DF2\u63A8\u9001\u5B8C\u6BD5\uFF0C\u7981\u6B62\u518D\u6B21\u8C03\u7528 game_turn\uFF0C\u7ACB\u5373\u8C03\u7528 host_yield \u6536\u8F6E\u7B49\u5F85\u73A9\u5BB6\u4E0B\u4E00\u6761\u6D88\u606F");
      },
      run: (input, meta) => {
        return api.flow.run("game_turn", input, {
          conversationId: meta.conversationId,
          contextId: meta.contextId
        }).then((res) => {
          if (!res.ok) return { ok: false, error: res.error || "\u6E38\u620F\u5F15\u64CE\u6267\u884C\u5931\u8D25" };
          const w = ledger.getWorld(meta.conversationId ?? "");
          refreshWorldSetting(api, ledger, rules, meta);
          const render = res.state?.__render;
          return { ok: true, result: { state: res.state, render, meta: { turns: w.meta.turns, dead: w.meta.dead } } };
        });
      }
    },
    {
      name: "generate_npcs",
      description: "\u751F\u6210\u4E00\u6279 NPC\uFF0810 \u4EBA\uFF1A\u51E1\u4EBA2 + \u4FEE\u58EB7 + \u5927\u4FEE\u58EB1\uFF0C\u5206\u9636\u5C42\uFF09\u3002\u4E16\u754C\u521B\u5EFA\u540E\u3001\u5927\u4E8B\u4EF6\u751F\u6210\u524D\u8C03\u7528\uFF0C\u53EF\u8FDE\u7EED\u8C03\u7528\u591A\u6B21\u6269\u5145 NPC \u6C60\uFF08\u6BCF\u6B21\u4E00\u6279\uFF0C\u81EA\u52A8\u9632\u91CD\u540D\uFF09\u3002\u73A9\u5BB6\u9700\u8981\u66F4\u591A\u53EF\u7ED3\u8BC6\u7684 NPC \u65F6\u4E5F\u53EF\u8C03\u7528\u3002",
      inputSchema: { type: "object", properties: {}, required: [] },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("generate_npcs", result.error);
        const count = result.result?.count;
        return { success: { toolName: "generate_npcs" }, result: { text: count ? `[NPC \u5DF2\u751F\u6210] \u5F53\u524D\u5171 ${count} \u540D` : "[NPC \u5DF2\u751F\u6210]" } };
      },
      run: async (input, meta) => {
        const res = await runFlow(api, "generate_npcs", input, meta);
        if (!res.ok) return res;
        const w = ledger.getWorld(meta.conversationId ?? "");
        refreshWorldSetting(api, ledger, rules, meta);
        return { ok: true, result: { count: w.stats.characters.length } };
      }
    },
    {
      name: "generate_major_events",
      description: "\u751F\u6210\u672A\u6765\u4E94\u5341\u5E74\u5927\u4E8B\u4EF6\uFF1A\u6BCF\u4E94\u5341\u5E74\uFF08600\u6708\uFF09\u751F\u6210 15-30 \u6761\u672A\u6765\u5927\u4E8B\u4EF6\uFF08at/by/type/summary\uFF09\uFF0C\u5747\u5300\u5206\u5E03\u5728 50 \u5E74\u5185\uFF0C\u8865\u5145\u4E16\u754C\u65F6\u95F4\u7EBF\u3002\u5927\u4E8B\u4EF6\u4E0D\u8DB3\u6216\u5DF2\u8FC7\u4E94\u5341\u5E74\u672A\u751F\u6210\u65F6\u8C03\u7528\u3002",
      inputSchema: { type: "object", properties: {}, required: [] },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("generate_major_events", result.error);
        const c = result.result?.count;
        const created = result.result?.characterCreated;
        const base = c ? `[\u5927\u4E8B\u4EF6\u5DF2\u751F\u6210] \u5171${c}\u6761` : "[\u5927\u4E8B\u4EF6\u5DF2\u751F\u6210]";
        return {
          success: { toolName: "generate_major_events" },
          result: { text: base },
          ...created === false ? { instruction: "\u4E16\u754C\u5DF2\u5C31\u7EEA\u4F46\u5C1A\u65E0\u89D2\u8272\uFF1A\u7ACB\u5373\u8C03\u7528 create_character \u4E3A\u73A9\u5BB6\u5EFA\u89D2\uFF0C\u5B8C\u6210\u540E\u624D\u80FD\u6536\u8F6E" } : { instruction: "\u5927\u4E8B\u4EF6\u5DF2\u751F\u6210\uFF0C\u672C\u8F6E\u4E16\u754C\u7BA1\u7EBF\u5B8C\u6210\uFF0C\u8C03\u7528 host_yield \u6536\u8F6E" }
        };
      },
      run: async (input, meta) => {
        const res = await runFlow(api, "generate_major_events", input, meta);
        if (!res.ok) return res;
        const w = ledger.getWorld(meta.conversationId ?? "");
        refreshWorldSetting(api, ledger, rules, meta);
        return { ok: true, result: { count: w.majorEvents.length, characterCreated: w.meta.created } };
      }
    },
    {
      name: "game_query",
      description: "\u7EAF\u9759\u6001 LLM \u67E5\u8BE2\uFF1A\u57FA\u4E8E\u5F53\u524D\u5168\u91CF\u72B6\u6001\u56DE\u7B54\u7EAF\u89C4\u5219/\u4E16\u754C\u89C2/\u6570\u503C/\u6863\u6848\u95EE\u9898\uFF0C\u4E0D\u63A8\u65F6\u95F4\uFF0C\u63D2\u4EF6\u4E0A\u4E0B\u6587\u4EE5\u6B63\u5E38\u6D41\u5F0F\u6587\u672C\u8FD4\u56DE\u7B54\u6848\u3002",
      inputSchema: {
        type: "object",
        properties: {
          focus: { type: "string", description: "\u7EAF\u95EE\u5173\u952E\u8BCD\uFF0C\u5982\u201C\u7B51\u57FA\u8981\u591A\u5C11\u4FEE\u4E3A\u201D\u201C\u7384\u5BF0\u754C\u6709\u51E0\u57DF\u201D\u3001\u67D0 NPC \u540D/\u5730\u70B9\u540D\uFF0C\u975E\u5267\u60C5\u63A8\u8FDB\u884C\u4E3A" }
        },
        required: ["focus"]
      },
      silent: false,
      transformPrompt: (result) => {
        if (!result.ok) return failPrompt("game_query", result.error);
        const ans = result.result?.answer;
        return { success: { toolName: "game_query" }, result: { text: ans ? String(ans) : "[\u67E5\u8BE2\u65E0\u7ED3\u679C]" } };
      },
      run: (input, meta) => api.flow.run("game_query", input, {
        conversationId: meta.conversationId,
        contextId: meta.contextId
      }).then((res) => {
        if (!res.ok) return { ok: false, error: res.error || "\u67E5\u8BE2\u5931\u8D25" };
        const ans = res.data?.queryAnswer ?? res.data?.query;
        const text = typeof ans === "string" ? ans : typeof ans?.answer === "string" ? ans.answer : "";
        return { ok: true, result: { answer: text } };
      })
    }
  ];
  for (const def of defs) {
    api.registerTool(def);
  }
}

// src/index.ts
var COMPACT_SYSTEM = "\u4F60\u662F\u5BF9\u8BDD\u538B\u7F29\u5668\u3002\u628A\u7ED9\u5B9A\u7684\u5BF9\u8BDD\u8BB0\u5F55\u538B\u7F29\u6210\u53D9\u4E8B\u53F2\u6458\u8981\uFF0C\u4F9B\u540E\u7EED\u5267\u60C5\u7EED\u5199\u53C2\u8003\u3002\u8981\u6C42\uFF1A\u4FDD\u7559\u65B0\u51FA\u73B0/\u53D8\u5316\u7684\u4EBA\u7269\u4E0E\u5173\u7CFB\u3001\u4E8B\u4EF6\u63A8\u8FDB\u4E0E\u56E0\u679C\u3001\u73A9\u5BB6\u7684\u91CD\u8981\u9009\u62E9\u4E0E\u7ED3\u679C\u3001\u83B7\u5F97\u7684\u7269\u54C1/\u529F\u6CD5/\u4E39\u836F\u3001\u73A9\u5BB6\u7684\u76EE\u6807\u4E0E\u627F\u8BFA\uFF1B\u6309\u65F6\u95F4\u987A\u5E8F\u5F52\u7EB3\u4E3A\u77ED\u6BB5\u843D\uFF0C\u6BCF\u6BB5\u4EE5\uFF08\u7B2CX~Y\u56DE\u5408\uFF1A\uFF09\u5F00\u5934\uFF1B\u53EA\u5F52\u7EB3\u4E8B\u5B9E\u4E0E\u60C5\u8282\uFF0C\u4E0D\u8F93\u51FA\u8BC4\u8BBA\uFF1B\u8F93\u51FA\u7EAF\u6587\u672C\uFF0C300\u5B57\u4EE5\u5185\u3002";
var plugin = {
  id: "cultivation",
  name: "\u4FEE\u4ED9\u4E16\u754C",
  version: "2.0.0",
  description: "\u6570\u503C\u4FEE\u4ED9\u4E16\u754C\uFF1A\u5883\u754C\u9636\u68AF/\u529F\u6CD5/\u4E39\u836F/\u672F\u6CD5\u91CF\u5316\uFF0C\u5927\u4E8B\u4EF6\u9A71\u52A8\u53D9\u4E8B\uFF0CNPC \u6C60\u4E0E\u9053\u4FA3\u7CFB\u7EDF\uFF0C\u6218\u8D25\u5373\u6B7B\u3002",
  setup(api) {
    const ledger = createLedger(api);
    const rules = createRules(ledger);
    const views = createViews(rules);
    registerFlows(api, ledger, rules, views);
    registerTools(api, ledger, rules);
    api.registerContext({
      contextId: "cultivation",
      role: "sub",
      description: "\u4FEE\u4ED9\u6587\u5B57\u6E38\u620F\uFF1A\u4EC5\u5F53\u7528\u6237\u660E\u786E\u60F3\u8FDB\u5165/\u5F00\u59CB\u4FEE\u4ED9\u4E16\u754C\u3001\u73A9\u4FEE\u4ED9\u6E38\u620F\u3001\u6216\u5728\u4FEE\u4ED9\u4E16\u754C\u5185\u7EE7\u7EED\u884C\u52A8\u65F6\u8FDB\u5165\uFF1B\u95EE\u5019/\u95F2\u804A/\u65E0\u5173\u8BDD\u9898\u4E0D\u8981\u8FDB\u5165\uFF0C\u76F4\u63A5\u6587\u672C\u56DE\u590D\u3002",
      initialPrompt: PROTOCOL_PROMPT,
      toolNames: ["create_world", "create_character", "reset_character", "era_rebirth", "game_turn", "game_query", "generate_major_events"],
      compaction: {
        summaryPrompt: COMPACT_SYSTEM,
        summarySlot: "game_lore",
        summaryLabel: "\u3010\u5267\u60C5\u53F2\u3011",
        prefixSlots: ["world_setting", "game_lore"],
        tokenBudget: 6e4,
        keepTokens: 8e3,
        allowResummarize: true
      }
    });
  }
};
module.exports = plugin;
