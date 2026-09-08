/**
 * js/data/schema.js —— 数据结构定义 / 默认值工厂 / 版本迁移
 *
 * ⚠️ 本文件由 **A 组（T02）** 实现，当前为 **stub**。
 *    所有函数签名已冻结（设计文档 §4、§3.1 的 Schema 类），A 组**只能填空、不得改名改签名**。
 *    当前实现全部返回安全默认值，保证 B/C/D 组在 T02 未完成时也能跑通页面。
 *
 * 跨组约定（§9.3 耦合点 5）：
 *   · Profile.push 的 JSON 结构在 defPushConfig() 里**逐字段冻结**，D 组的 dingtalk-push.yml
 *     与 manage.html 推送配置 UI 都以此为准：
 *       push.leadMinutes:int（默认 30，提前量分钟）
 *       push.slots:[{key, enabled, target:"HH:MM", dayOffset:int}]（6 个槽，见 PUSH_SLOTS）
 *       push.calibration:{avgLateMin:int, suggestedLead:int, updatedAt:ms}
 *   · 默认只开 4 个槽：morning 07:00 / night 21:30 / final 22:30 / midnight 00:00(+1d)。
 *
 * 迁移原则（§8.4）：只增不删；未知字段原样保留；坏数据降级为默认值而不是崩溃。
 */
(function (RF) {
  "use strict";

  /** @constant {number} 当前 schema 版本（v2） */
  var SCHEMA_VERSION = 2;

  /** @constant {Array<string>} 花朵 5 阶段（0 种子 → 4 盛开） */
  var FLOWER_STAGE_NAMES = ["种子", "发芽", "花苞", "初开", "盛开"];

  /** @constant {Array<string>} 精灵 5 形态 key */
  var PET_STAGE_KEYS = ["egg", "baby", "grow", "mature", "evolve"];

  /** @constant {Array<string>} 精灵状态机 */
  var PET_STATES = ["normal", "sleep", "sick", "faded", "gone"];

  /**
   * 6 个推送槽位定义（顺序即 UI 展示顺序）。
   * midnight 的 dayOffset=1：它总结「刚过去的这一天」，触发时刻落在次日 00:00 前 leadMinutes 分钟。
   * @constant {Array<{key:string,enabled:boolean,target:string,dayOffset:number,label:string}>}
   */
  var PUSH_SLOTS = [
    { key: "morning", enabled: true, target: "07:00", dayOffset: 0, label: "早安" },
    { key: "noon", enabled: false, target: "12:00", dayOffset: 0, label: "午间" },
    { key: "dusk", enabled: false, target: "18:00", dayOffset: 0, label: "黄昏" },
    { key: "night", enabled: true, target: "21:30", dayOffset: 0, label: "夜晚提醒" },
    { key: "final", enabled: true, target: "22:30", dayOffset: 0, label: "最后机会" },
    { key: "midnight", enabled: true, target: "00:00", dayOffset: 1, label: "今日总结" }
  ];

  /** @return {number} */
  function now() {
    return Date.now();
  }

  /**
   * 默认推送配置（冻结结构）。
   * @return {{leadMinutes:number, slots:Array, calibration:Object}}
   */
  function defPushConfig() {
    return {
      leadMinutes: 30,
      slots: PUSH_SLOTS.map(function (s) {
        return { key: s.key, enabled: s.enabled, target: s.target, dayOffset: s.dayOffset };
      }),
      calibration: { avgLateMin: 0, suggestedLead: 30, updatedAt: 0 }
    };
  }

  /**
   * 默认任务。
   * @param {Object=} patch 覆盖字段
   * @return {Object} Plan
   */
  function defPlan(patch) {
    var t = now();
    var base = {
      id: "",
      name: "",
      icon: "🌟",
      freq: "daily",
      time: "08:00",
      day: 0,
      enabled: true,
      desc: "",
      image: "",
      core: true,
      difficulty: 3,
      estMinutes: 5,
      order: 0,
      createdAt: t,
      updatedAt: t
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 默认打卡记录。
   * @param {Object=} patch
   * @return {Object} Checkin
   */
  function defCheckin(patch) {
    var t = now();
    var base = {
      id: "",
      planId: null,
      planName: "",
      planIcon: "🌟",
      dayKey: "",
      ts: t,
      note: "",
      image: "",
      points: 0,
      updatedAt: t
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 默认精灵状态。
   * @param {Object=} patch
   * @return {Object} PetState
   */
  function defPet(patch) {
    var t = now();
    var base = {
      name: "小光",
      bornAt: t,
      food: 70,
      mood: 70,
      energy: 70,
      bond: 10,
      stage: "egg",
      state: "normal",
      sleepingSince: null,
      lastVisit: t,
      lastDecayAt: t,
      updatedAt: t
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 默认花园状态。
   * @param {Object=} patch
   * @return {Object} GardenState
   */
  function defGarden(patch) {
    var base = {
      flowers: [],
      decor: [],
      season: "summer",
      varieties: ["daisy"],
      witherRatio: 0,
      lastFullBloomDay: "",
      updatedAt: now()
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 单朵花。
   * @param {string=} planId
   * @param {Object=} patch
   * @return {{planId:string, stage:number, variety:string, withered:boolean, wateredDay:string}}
   */
  function defFlower(planId, patch) {
    var base = {
      planId: planId || "",
      stage: 0,
      variety: "daisy",
      withered: false,
      wateredDay: ""
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 野餐篮美食券。
   * @param {Object=} patch
   * @return {Object} Coupon
   */
  function defCoupon(patch) {
    var t = now();
    var base = {
      id: "",
      kind: "basic",
      amount: 50,
      source: "streak7",
      grantedAt: t,
      expireAt: t + 180 * 86400000,
      usedAt: null,
      usedAmount: 0,
      note: "",
      updatedAt: t
    };
    return mergeDefaults(base, patch);
  }

  /**
   * 默认档案（含推送配置）。
   * @param {Object=} patch
   * @return {Object} Profile
   */
  function defProfile(patch) {
    var base = {
      schema: SCHEMA_VERSION,
      owner: "主理人",
      points: 0,
      totalPoints: 0,
      achievements: [],
      inventory: {
        seeds: ["daisy"],
        decor: [],
        skins: ["default"],
        props: { timeDew: 0, memoryFlower: 0, doubleHappy: 0 }
      },
      settings: {
        reduceMotion: false,
        sound: true,
        waterGoalMl: 2000,
        wakeTarget: "07:00",
        sleepTarget: "23:00",
        focusMinutes: 25
      },
      push: defPushConfig(),
      granted: {},
      lastEventDay: "",
      updatedAt: now()
    };
    return mergeDefaults(base, patch);
  }

  /** 默认墓碑表。 @return {Object} */
  function defTombstones() {
    return { plans: {}, checkins: {}, memos: {}, coupons: {} };
  }

  /**
   * 浅合并：只覆盖 base 里已有的键，未知字段**保留**（迁移只增不删）。
   * @param {Object} base
   * @param {Object=} patch
   * @return {Object}
   */
  function mergeDefaults(base, patch) {
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = base[k];
    });
    if (patch && typeof patch === "object") {
      Object.keys(patch).forEach(function (k) {
        if (patch[k] !== undefined) out[k] = patch[k];
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * A 组实现：normalize / migrate（坏数据降级，绝不抛异常）                *
   * ------------------------------------------------------------------ */

  /** 合法频率集合。 @type {Object<string,boolean>} */
  var FREQ_SET = { daily: true, weekly: true, monthly: true };
  /** 合法精灵状态。 @type {Object<string,boolean>} */
  var STATE_SET = {};
  PET_STATES.forEach(function (s) { STATE_SET[s] = true; });

  /**
   * 补全 Plan 的 v2 新字段（core / difficulty / estMinutes / order），并做类型兜底。
   * @param {Object} raw 可能是 v1 的老结构
   * @return {Object} Plan
   */
  function normalizePlan(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defPlan(src);
    // id 必须有
    if (typeof src.id === "string" && src.id) base.id = src.id;
    else if (!base.id) base.id = RF.util.genId();
    base.name = typeof src.name === "string" ? src.name.slice(0, 60) : base.name;
    if (typeof src.icon === "string" && src.icon) base.icon = src.icon.slice(0, 8);
    base.freq = FREQ_SET[src.freq] ? src.freq : "daily";
    base.time = typeof src.time === "string" ? src.time : "08:00";
    base.day = Number.isFinite(Number(src.day)) ? Number(src.day) : 0;
    base.enabled = src.enabled === undefined ? true : !!src.enabled;
    // 核心任务：缺省视为 true（决策 2 —— 老任务默认算核心）
    base.core = src.core === undefined ? true : !!src.core;
    base.difficulty = RF.util.clamp(parseInt(src.difficulty, 10) || 3, 1, 5);
    base.estMinutes = RF.util.clamp(parseInt(src.estMinutes, 10) || 5, 1, 240);
    base.order = Number.isFinite(Number(src.order)) ? Number(src.order) : 0;
    base.desc = typeof src.desc === "string" ? src.desc.slice(0, 200) : "";
    base.createdAt = Number(src.createdAt) || now();
    base.updatedAt = Number(src.updatedAt) || base.createdAt;
    return base;
  }

  /**
   * 补全 Checkin：缺 dayKey 由 ts 反推（本地时区）；缺 points 补 0。
   * @param {Object} raw
   * @return {Object} Checkin
   */
  function normalizeCheckin(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defCheckin(src);
    if (typeof src.id === "string" && src.id) base.id = src.id;
    else if (!base.id) base.id = RF.util.genId();
    base.planId = (src.planId === null || src.planId === undefined) ? null : String(src.planId);
    base.planName = typeof src.planName === "string" ? src.planName : "";
    base.planIcon = typeof src.planIcon === "string" ? src.planIcon : "🌟";
    base.ts = Number(src.ts) || now();
    base.dayKey = typeof src.dayKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(src.dayKey)
      ? src.dayKey
      : RF.util.dayKey(base.ts);
    base.note = typeof src.note === "string" ? src.note.slice(0, 500) : "";
    base.image = typeof src.image === "string" ? src.image : "";
    base.points = Number.isFinite(Number(src.points)) ? Number(src.points) : 0;
    base.updatedAt = Number(src.updatedAt) || base.ts;
    return base;
  }

  /**
   * 补全单朵花。
   * @param {Object} raw
   * @return {Object} Flower（结构见 defFlower）
   */
  function normalizeFlower(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defFlower(src.planId);
    if (typeof src.planId === "string") base.planId = src.planId;
    base.stage = RF.util.clamp(parseInt(src.stage, 10) || 0, 0, 4);
    base.variety = typeof src.variety === "string" && src.variety ? src.variety : "daisy";
    base.withered = !!src.withered;
    base.wateredDay = typeof src.wateredDay === "string" ? src.wateredDay : "";
    return base;
  }

  /**
   * 补全 PetState 并 clamp 四项状态到 0-100；stage/state 非法回落默认。
   * @param {Object} raw
   * @return {Object} PetState
   */
  function normalizePet(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defPet(src);
    base.food = RF.util.clamp(Number(src.food), 0, 100);
    base.mood = RF.util.clamp(Number(src.mood), 0, 100);
    base.energy = RF.util.clamp(Number(src.energy), 0, 100);
    base.bond = RF.util.clamp(Number(src.bond), 0, 100);
    base.stage = PET_STAGE_KEYS.indexOf(src.stage) >= 0 ? src.stage : "egg";
    base.state = STATE_SET[src.state] ? src.state : "normal";
    base.bornAt = Number(src.bornAt) || now();
    base.sleepingSince = src.sleepingSince ? Number(src.sleepingSince) : null;
    base.lastVisit = Number(src.lastVisit) || base.bornAt;
    base.lastDecayAt = Number(src.lastDecayAt) || base.bornAt;
    base.updatedAt = Number(src.updatedAt) || now();
    return base;
  }

  /**
   * 补全 GardenState（flowers 必须是数组且每项过 normalizeFlower）。
   * @param {Object} raw
   * @return {Object} GardenState
   */
  function normalizeGarden(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defGarden(src);
    base.flowers = Array.isArray(src.flowers)
      ? src.flowers.map(normalizeFlower).filter(function (f) { return !!f.planId; })
      : [];
    base.decor = Array.isArray(src.decor) ? src.decor.filter(function (d) { return typeof d === "string"; }) : [];
    base.season = typeof src.season === "string" ? src.season : "summer";
    base.varieties = Array.isArray(src.varieties) ? src.varieties.map(String) : ["daisy"];
    base.witherRatio = RF.util.clamp(Number(src.witherRatio) || 0, 0, 1);
    base.lastFullBloomDay = typeof src.lastFullBloomDay === "string" ? src.lastFullBloomDay : "";
    base.updatedAt = Number(src.updatedAt) || now();
    return base;
  }

  /**
   * 补全 Profile：深合并 settings / inventory / push 三层；push.slots 按 key 对齐 PUSH_SLOTS。
   * @param {Object} raw
   * @return {Object} Profile
   */
  function normalizeProfile(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var base = defProfile(src);
    // owner
    if (typeof src.owner === "string" && src.owner) base.owner = src.owner.slice(0, 40);
    base.points = RF.util.clamp(Number(src.points) || 0, 0, 1e9);
    base.totalPoints = Math.max(base.points, Number(src.totalPoints) || 0);
    // achievements
    if (Array.isArray(src.achievements)) {
      base.achievements = src.achievements.filter(function (a) {
        return a && typeof a.id === "string";
      }).map(function (a) {
        return { id: a.id, unlockedAt: Number(a.unlockedAt) || now() };
      });
    }
    // inventory 深合并
    if (src.inventory && typeof src.inventory === "object") {
      if (Array.isArray(src.inventory.seeds)) base.inventory.seeds = src.inventory.seeds.map(String);
      if (Array.isArray(src.inventory.decor)) base.inventory.decor = src.inventory.decor.map(String);
      if (Array.isArray(src.inventory.skins)) base.inventory.skins = src.inventory.skins.map(String);
      if (src.inventory.props && typeof src.inventory.props === "object") {
        Object.keys(base.inventory.props).forEach(function (k) {
          if (Number.isFinite(Number(src.inventory.props[k]))) {
            base.inventory.props[k] = Number(src.inventory.props[k]);
          }
        });
      }
    }
    // settings 深合并
    if (src.settings && typeof src.settings === "object") {
      Object.keys(base.settings).forEach(function (k) {
        if (src.settings[k] !== undefined) base.settings[k] = src.settings[k];
      });
    }
    // push 深合并 + slots 对齐
    if (src.push && typeof src.push === "object") {
      base.push.leadMinutes = RF.util.clamp(parseInt(src.push.leadMinutes, 10) || 30, 0, 120);
      if (Array.isArray(src.push.slots)) {
        var byKey = {};
        PUSH_SLOTS.forEach(function (s) { byKey[s.key] = { key: s.key, enabled: s.enabled, target: s.target, dayOffset: s.dayOffset }; });
        src.push.slots.forEach(function (sl) {
          if (sl && byKey[sl.key]) {
            byKey[sl.key].enabled = !!sl.enabled;
            if (typeof sl.target === "string") byKey[sl.key].target = sl.target;
            if (Number.isFinite(Number(sl.dayOffset))) byKey[sl.key].dayOffset = Number(sl.dayOffset);
          }
        });
        base.push.slots = PUSH_SLOTS.map(function (s) { return byKey[s.key]; });
      }
      if (src.push.calibration && typeof src.push.calibration === "object") {
        base.push.calibration.avgLateMin = Number(src.push.calibration.avgLateMin) || 0;
        base.push.calibration.suggestedLead = Number(src.push.calibration.suggestedLead) || 30;
        base.push.calibration.updatedAt = Number(src.push.calibration.updatedAt) || 0;
      }
    }
    if (src.granted && typeof src.granted === "object") base.granted = src.granted;
    base.lastEventDay = typeof src.lastEventDay === "string" ? src.lastEventDay : "";
    base.updatedAt = Number(src.updatedAt) || now();
    return base;
  }

  /**
   * v1 → v2 迁移。
   * · 无 runform_schema 但存在 runform_checkins → 判为 v1 老用户：
   *   补全 Plan/Checkin 新字段，初始化 Pet/Garden/Coupons/Profile，
   *   **bornAt 取最早一条 checkin 的 ts**（主理人决策 9）。
   * · 全新用户 → 返回全默认结果，由 store 走引导流程。
   * @param {Object} raw {plans, checkins, version}
   * @return {{plans:Array, checkins:Array, pet:Object, garden:Object, coupons:Array, profile:Object, version:number}}
   */
  function migrate(raw) {
    var src = raw && typeof raw === "object" ? raw : {};
    var plans = Array.isArray(src.plans) ? src.plans.map(normalizePlan) : [];
    var checkins = Array.isArray(src.checkins) ? src.checkins.map(normalizeCheckin) : [];
    var earliest = null;
    checkins.forEach(function (c) {
      if (earliest === null || c.ts < earliest) earliest = c.ts;
    });
    var profile = normalizeProfile(src.profile || {});
    if (earliest !== null && !profile.granted.__migrated) {
      profile.granted.__migrated = earliest; // 标记已迁移，避免重复
    }
    return {
      plans: plans,
      checkins: checkins,
      pet: normalizePet(earliest !== null ? { bornAt: earliest } : {}),
      garden: normalizeGarden({}),
      coupons: [],
      profile: profile,
      version: SCHEMA_VERSION
    };
  }

  RF.schema = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    FLOWER_STAGE_NAMES: FLOWER_STAGE_NAMES,
    PET_STAGE_KEYS: PET_STAGE_KEYS,
    PET_STATES: PET_STATES,
    PUSH_SLOTS: PUSH_SLOTS,
    defPushConfig: defPushConfig,
    defPlan: defPlan,
    defCheckin: defCheckin,
    defPet: defPet,
    defGarden: defGarden,
    defFlower: defFlower,
    defCoupon: defCoupon,
    defProfile: defProfile,
    defTombstones: defTombstones,
    mergeDefaults: mergeDefaults,
    normalizePlan: normalizePlan,
    normalizeCheckin: normalizeCheckin,
    normalizeFlower: normalizeFlower,
    normalizePet: normalizePet,
    normalizeGarden: normalizeGarden,
    normalizeProfile: normalizeProfile,
    migrate: migrate
  };
})(window.RF = window.RF || {});
