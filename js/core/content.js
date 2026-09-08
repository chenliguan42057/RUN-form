/**
 * js/core/content.js —— 内容注册表（数据驱动内容层）
 * 归属：核心。紧跟 js/core/storage.js 之后加载（设计文档 §8.2）。
 *
 * 用途：把「用户可见内容」（市集道具、券里程碑、计划模板、精灵台词、段位、
 * 成就、花园品种、断签惩罚文案、种子任务、难度积分系数、每日语录……）从 JS
 * 硬编码搬到可编辑的 data/content.json。主理人无需改代码即可自由增删补充。
 *
 * 合并优先级：JS 内置 DEFAULTS ← data/content.json（全局，提交即全设备生效）
 *            ← localStorage 覆盖（本机优先，可选，manage 编辑器用）。
 * 任一环节失败一律 swallow，退回上一层，绝不白屏。
 *
 * 加载：本文件在 <script> 阶段用「同步 XMLHttpRequest 最优尝试」读取
 * data/content.json 并深合并进 _state，保证后续 system 在模块求值期就能拿到
 * 覆盖值（避免异步 fetch 导致顶层捕获到旧默认值）。若不可用（file://、离线、
 * 被 SW 拦截）则直接用 DEFAULTS。load() 仍返回 Promise 以兼容 await 写法。
 */
(function (RF) {
  "use strict";

  /* ============ 内置默认内容（与迁移前的 JS 字面量一致，作为兜底） ============ */
  var DEFAULTS = {
    coupon: {
      rules: {
        basic: { amount: 50, kind: "basic" },
        upgrade: { amount: 100, kind: "upgrade" },
        luxury: { amount: 200, kind: "luxury" }
      },
      milestones: [
        { days: 7, kind: "basic", amount: 50, source: "streak7", label: "连续 7 天 · 基础野餐篮" },
        { days: 14, kind: "upgrade", amount: 100, source: "streak14", label: "连续 14 天 · 升级野餐篮" },
        { days: 30, kind: "luxury", amount: 200, source: "streak30", label: "连续 30 天 · 豪华野餐篮" }
      ]
    },
    shop: {
      items: [
        { key: "timeDew", name: "时光露水", emoji: "💧", cost: 300, desc: "唤醒沉睡/ faded 的小光" },
        { key: "memoryFlower", name: "回忆之花", emoji: "🌸", cost: 800, desc: "召回已离开的小光（亲密度保留）" },
        { key: "doubleHappy", name: "双倍开心", emoji: "✨", cost: 200, desc: "下次打卡积分翻倍" }
      ]
    },
    planTemplates: {
      morning: { name: "晨间三件套：温水+拉伸", icon: "🌅", freq: "daily", time: "07:30", core: true, difficulty: 2, estMinutes: 10 },
      health: { name: "健康基础：运动", icon: "💪", freq: "daily", time: "08:00", core: true, difficulty: 4, estMinutes: 20 },
      study: { name: "学习专注：读书", icon: "📚", freq: "daily", time: "21:00", core: true, difficulty: 3, estMinutes: 15 }
    },
    pet: {
      lines: {
        gone: [
          "我走了，但花园里每一朵花都记得你。",
          "没关系，你路过的风我都收好了。",
          "下次见面，要更疼自己一点哦。"
        ],
        faded: [
          "我快看不清你了……你还在吗？",
          "再不来，我就要散成光点啦。",
          "明明说好一起开花的……"
        ],
        sleep: [
          "我先睡一会儿，你忙完记得叫我。",
          "zzz… 花园交给你了。",
          "今天先休息，明天再一起努力。"
        ],
        sick: [
          "我有点不舒服，想你陪陪我。",
          "今天没开花，我有点难过。",
          "你是不是太累了？我也跟着累。"
        ],
        night: [
          "夜深了，记得早点休息呀。",
          "萤火虫陪着你，别怕黑。",
          "今天也辛苦啦，晚安。"
        ],
        morning: [
          "早安！新的一天要开花咯～",
          "露水甜甜的，来喝一口？",
          "我醒啦，你呢？"
        ],
        lowFood: [
          "肚子咕咕叫……想吃你做的饭。",
          "我饿扁了，快去吃饭吧！",
          "吃饱才有力气陪你呀。"
        ],
        lowMood: [
          "今天心情有点灰灰的。",
          "你笑一笑，我就开心了。",
          "摸摸头，会好的。"
        ],
        pending: [
          "还差一项就全勤啦，冲！",
          "今天差一点点，别放弃哦。",
          "明天花园还在，慢慢来。"
        ],
        milestone: [
          "连续打卡达成啦！给你比心心💗",
          "你超棒的，连我都想鼓掌。",
          "看，花园因为你更亮了。"
        ],
        daily: [
          "今天也要一起开花呀～",
          "我在这里，陪你慢慢变好。",
          "你做的事，我都看得见。",
          "一步一步，就很了不起。"
        ]
      },
      stages: [
        { minDay: 0, key: "egg", emoji: "🥚", label: "蛋" },
        { minDay: 3, key: "baby", emoji: "🐣", label: "破壳" },
        { minDay: 10, key: "grow", emoji: "🌱", label: "成长" },
        { minDay: 21, key: "mature", emoji: "✨", label: "成熟" },
        { minDay: 40, key: "evolve", emoji: "🌟", label: "进化" }
      ]
    },
    rpg: {
      ranks: [
        { key: "novice", emoji: "🌱", name: "新手园丁", min: 0 },
        { key: "seedling", emoji: "🌿", name: "育苗学徒", min: 100 },
        { key: "sprout", emoji: "🍀", name: "抽芽园丁", min: 300 },
        { key: "bud", emoji: "🌸", name: "花苞守护", min: 700 },
        { key: "bloom", emoji: "🌺", name: "盛开花匠", min: 1500 },
        { key: "gardener", emoji: "🌻", name: "阳光园主", min: 3000 },
        { key: "keeper", emoji: "🌳", name: "森林看守", min: 6000 },
        { key: "legend", emoji: "🏵", name: "花海传说", min: 12000 }
      ],
      achievements: [
        { id: "first-checkin", name: "破土", emoji: "🌱" },
        { id: "first-flower", name: "第一朵花", emoji: "🌼" },
        { id: "streak7", name: "一周花开", emoji: "🔥" },
        { id: "streak14", name: "两周不辍", emoji: "⚡" },
        { id: "streak30", name: "月度园丁", emoji: "🌟" },
        { id: "points1k", name: "千分开外", emoji: "💎" },
        { id: "points5k", name: "积分富农", emoji: "👑" },
        { id: "perfect-week", name: "完美一周", emoji: "🏅" },
        { id: "all-bloom", name: "满园芬芳", emoji: "🌷" }
      ],
      dailyEvents: [
        { id: "sunny", name: "阳光加成", desc: "今天打卡积分 ×1.5", multiplier: 1.5 },
        { id: "rain", name: "细雨滋润", desc: "小光心情 +15", delta: { mood: 15 } },
        { id: "wind", name: "清风助力", desc: "小光能量 +15", delta: { energy: 15 } }
      ]
    },
    garden: {
      varieties: { daisy: "🌼", tulip: "🌷", rose: "🌹", sunflower: "🌻", lily: "🌸", lavender: "💜" },
      flowerStages: ["🌱 种子", "🌿 发芽", "🌸 花苞", "🌺 初开", "🌻 盛开"],
      difficultyVariety: ["daisy", "daisy", "lily", "tulip", "sunflower", "rose"],
      unlockThresholds: { tulip: 7, lily: 14, sunflower: 30, rose: 30, lamp: 7, fence: 14, fountain: 30 },
      season: "summer"
    },
    punishment: {
      levels: [
        { days: 0, pet: "sad", gardenRatio: 0.0, scene: "clear", msg: "今天还有任务没完成，小光有点失落……" },
        { days: 2, pet: "sick", gardenRatio: 0.3, scene: "cloudy", msg: "小光生病了，它说很想你……" },
        { days: 3, pet: "sleep", gardenRatio: 0.6, scene: "gray", msg: "小光沉睡了，花园快荒了……" },
        { days: 5, pet: "fade", gardenRatio: 0.9, scene: "fallen", msg: "小光快要消失了……" },
        { days: 7, pet: "gone", gardenRatio: 1.0, scene: "bw", msg: "小光走了。它留下了一封信。" }
      ],
      letter: [
        "亲爱的，这 {days} 天里你每一次打卡我都记着。",
        "花园也许会荒，但你不曾真的离开。",
        "想放纵的时候，记得先领好野餐篮——那是我留给你的放心许可。",
        "明天，我们重新一起开花吧。"
      ]
    },
    seed: {
      plans: [
        { name: "喝一杯温水", icon: "💧", freq: "daily", time: "07:30", core: true, difficulty: 1, estMinutes: 2 },
        { name: "运动 20 分钟", icon: "🏃", freq: "daily", time: "08:00", core: true, difficulty: 4, estMinutes: 20 },
        { name: "读 10 页书", icon: "📚", freq: "daily", time: "21:00", core: true, difficulty: 3, estMinutes: 15 },
        { name: "写一句今日感想", icon: "✍️", freq: "daily", time: "22:00", core: false, difficulty: 2, estMinutes: 5 }
      ]
    },
    tuning: {
      difficultyPoints: [1, 1.0, 1.2, 1.5, 1.8, 2.2]
    },
    quotes: {
      enabled: false,
      source: "data/quotes.json",
      mode: "home-greeting"
    }
  };

  /* ============================ 内部实现 ============================ */
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
  function deepMerge(base, over) {
    if (!isObj(base)) return over === undefined ? base : over;
    if (!isObj(over)) return over === undefined ? base : over;
    var out = {};
    for (var k in base) out[k] = deepMerge(base[k], over[k]);
    for (var k2 in over) if (!(k2 in base)) out[k2] = over[k2];
    return out;
  }

  var _state = clone(DEFAULTS);
  var _overrideKey = "runform_content_override";

  function loadSyncJson() {
    try {
      var hasXHR = typeof window !== "undefined" && window.XMLHttpRequest;
      var hasFetch = typeof window !== "undefined" && window.fetch;
      if (hasXHR) {
        var xhr = new window.XMLHttpRequest();
        xhr.open("GET", "data/content.json", false); // 同步最优尝试
        xhr.send();
        if (xhr.status === 200 || xhr.status === 0) {
          var json = JSON.parse(xhr.responseText);
          if (json && typeof json === "object") _state = deepMerge(_state, json);
        }
        return;
      }
      if (hasFetch) {
        // 退路：fetch 同步不可用，交给 load() 的异步分支（首屏先用 DEFAULTS）
      }
    } catch (e) { /* 离线 / file:// / 被拦截 → 保留 DEFAULTS */ }
  }

  function applyLocalOverride() {
    try {
      if (typeof RF !== "undefined" && RF.storage && RF.storage.getRaw) {
        var raw = RF.storage.getRaw(_overrideKey, "");
        if (raw) {
          var ov = JSON.parse(raw);
          if (ov && typeof ov === "object") _state = deepMerge(_state, ov);
        }
      }
    } catch (e) {}
  }

  // 模块求值期即尝试读取全局内容（同步），随后叠加本机 localStorage 覆盖
  loadSyncJson();
  applyLocalOverride();

  function get(path, fallback) {
    var cur = _state;
    var parts = String(path || "").split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  }

  /** 主理人编辑器用：写入本机覆盖（不提交仓库），立即生效 */
  function setLocalOverride(patch) {
    try {
      var cur = {};
      if (RF.storage && RF.storage.getRaw) {
        try { cur = JSON.parse(RF.storage.getRaw(_overrideKey, "") || "{}"); } catch (e) {}
      }
      var merged = deepMerge(cur, patch || {});
      if (RF.storage && RF.storage.setRaw) RF.storage.setRaw(_overrideKey, JSON.stringify(merged));
      _state = deepMerge(_state, merged);
      return true;
    } catch (e) { return false; }
  }

  /** 兼容 await 写法；内容已在模块求值期同步就位，这里直接 resolve */
  function load() {
    return Promise.resolve(_state);
  }

  RF.content = {
    DEFAULTS: DEFAULTS,
    get: get,
    load: load,
    setLocalOverride: setLocalOverride
  };
})(window.RF = window.RF || {});
