/**
 * js/systems/pet.js —— 精灵状态 / 进化 / 台词 / 动画
 * 归属：B 组（T03）。订阅 bus "checkin:done" / "day:missed"。
 * 与 garden/coupon/rpg 不直接调用，只走 bus 与 store。
 */
(function (RF) {
  "use strict";

  var STAGE_EMOJI = { egg: "🥚", baby: "🐣", grow: "🌱", mature: "✨", evolve: "🌟" };

  /**
   * 进化阶段（按 minDay 升序）。stage() 仅按「出生天数」推进，
   * 与打卡是否中断无关；中断影响的是 state（normal/sick/faded/gone）。
   * 顺序必须与 STAGE_EMOJI 的 key 一一对应，并匹配 pet.css 的
   * g-pet__body--{egg,baby,grow,mature,evolve} 四个状态类。
   */
  var PET_STAGES = [
    { minDay: 0,  key: "egg",    emoji: "🥚", label: "蛋" },
    { minDay: 3,  key: "baby",   emoji: "🐣", label: "破壳" },
    { minDay: 10, key: "grow",   emoji: "🌱", label: "成长" },
    { minDay: 21, key: "mature", emoji: "✨", label: "成熟" },
    { minDay: 40, key: "evolve", emoji: "🌟", label: "进化" }
  ];

  /** 台词变体（按优先级分桶，稳定选取避免刷新跳变） */
  var LINES = {
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
  };

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function store() { return RF.store; }

  var _lastStage = "egg";
  try { _lastStage = (store().loadPet().stage) || "egg"; } catch (e) {}

  function get() { return store().loadPet(); }

  function create(name) {
    return store().savePet({
      name: name || "小光",
      bornAt: U().nowMs(),
      food: 70, mood: 70, energy: 70, bond: 10,
      stage: "egg", state: "normal", sleepingSince: null,
      lastVisit: U().nowMs(), lastDecayAt: U().nowMs()
    });
  }

  function stats() {
    var p = get();
    return {
      food: U().clamp(p.food, 0, 100),
      mood: U().clamp(p.mood, 0, 100),
      energy: U().clamp(p.energy, 0, 100),
      bond: U().clamp(p.bond, 0, 100)
    };
  }

  function applyDelta(delta, reason) {
    var p = get();
    var d = delta || {};
    p.food = U().clamp(p.food + (d.food || 0), 0, 100);
    p.mood = U().clamp(p.mood + (d.mood || 0), 0, 100);
    p.energy = U().clamp(p.energy + (d.energy || 0), 0, 100);
    p.bond = U().clamp(p.bond + (d.bond || 0), 0, 100);
    p.lastVisit = U().nowMs();
    var next = store().savePet(p);
    _syncStage();
    try { B().emit("pet:stateChange", { state: next.state, mood: next.mood }); } catch (e) {}
    return next;
  }

  /** 按小时数衰减（饱食 -2/h、心情 -1/h、能量 -1.5/h），幂等 */
  function decay() {
    var p = get();
    var now = U().nowMs();
    var hrs = (now - (p.lastDecayAt || now)) / 3600000;
    if (hrs < 0.25) return p; // 15 分钟内不重复算
    hrs = Math.min(hrs, 72);
    p.food = U().clamp(p.food - 2 * hrs, 0, 100);
    p.mood = U().clamp(p.mood - 1 * hrs, 0, 100);
    p.energy = U().clamp(p.energy - 1.5 * hrs, 0, 100);
    p.lastDecayAt = now;
    p.lastVisit = now;
    var next = store().savePet(p);
    _syncStage();
    return next;
  }

  function stage() {
    var p = get();
    var days = Math.max(1, U().diffDays(U().dayKey(p.bornAt), U().dayKey()) + 1);
    var cur = PET_STAGES[0];
    for (var i = 0; i < PET_STAGES.length; i++) {
      if (days >= PET_STAGES[i].minDay) cur = PET_STAGES[i];
    }
    var idx = PET_STAGES.indexOf(cur);
    var nextIn = idx + 1 < PET_STAGES.length ? PET_STAGES[idx + 1].minDay - days : -1;
    return { key: cur.key, emoji: cur.emoji, label: cur.label, days: days, nextIn: nextIn };
  }

  function _syncStage() {
    var s = stage().key;
    if (s !== _lastStage) {
      var from = _lastStage;
      _lastStage = s;
      try { B().emit("pet:stageUp", { from: from, to: s }); } catch (e) {}
    }
  }

  function speak(ctx) {
    var p = get();
    var hour = new Date().getHours();
    var c = ctx || {};
    var bucket;
    if (p.state === "gone") bucket = LINES.gone;
    else if (p.state === "faded") bucket = LINES.faded;
    else if (p.state === "sleep") bucket = LINES.sleep;
    else if (p.state === "sick") bucket = LINES.sick;
    else if (hour < 6 || hour >= 22) bucket = LINES.night;
    else if (c.period === "sunrise" || hour < 10) bucket = LINES.morning;
    else if (p.food < 30) bucket = LINES.lowFood;
    else if (p.mood < 30) bucket = LINES.lowMood;
    else if (c.pending && c.pending > 0) bucket = LINES.pending;
    else if (c.streak && c.streak > 0 && c.streak % 7 === 0) bucket = LINES.milestone;
    else bucket = LINES.daily;
    var seed = U().dayKey() + "|" + hour + "|" + (c.streak || 0);
    return U().pickSeeded(bucket, seed) || LINES.daily[0];
  }

  function react(event) {
    return "is-" + (event || "cheer");
  }

  function render(el) {
    if (!el) return;
    var p = get();
    var s = stage();
    var emoji = STAGE_EMOJI[p.state === "gone" ? "egg" : p.stage] || "🥚";
    var stateCls = "g-pet__body--" + (p.state === "normal" ? s.key : p.state);
    var line = speak({ period: document.documentElement.getAttribute("data-period"), streak: store().streakInfo().current });
    el.innerHTML =
      '<div class="g-pet__body ' + stateCls + '" role="img" aria-label="' + U().esc(p.name) + '">' + emoji + "</div>" +
      '<div class="g-pet__bubble">' + U().esc(line) + "</div>";
    _syncStage();
  }

  function onCheckin(plan) {
    var d = { food: 15, mood: 10, energy: 5, bond: 2 };
    if (plan && plan.difficulty >= 4) { d.energy = 8; d.bond = 4; }
    applyDelta(d, "checkin");
    try { B().emit("pet:stageUp", { silent: true }); } catch (e) {}
  }

  function onMiss(days) {
    applyDelta({ mood: -12, food: -8 }, "miss");
    var cls = days >= 7 ? "gone" : days >= 5 ? "fade" : days >= 3 ? "sleep" : "sick";
    try { B().emit("pet:stateChange", { state: get().state }); } catch (e) {}
    return react(cls);
  }

  function revive(reason) {
    var p = get();
    var next = store().savePet({
      state: "normal",
      sleepingSince: null,
      stage: p.stage === "gone" ? "grow" : p.stage,
      mood: U().clamp(p.mood + 30, 0, 100),
      energy: U().clamp(p.energy + 20, 0, 100)
    });
    return next;
  }

  function farewellLetter() {
    var p = get();
    var days = stage().days;
    var lines = [
      "亲爱的，" + days + " 天里，你每次打卡我都记着。",
      "花园也许会荒，但你不曾真的离开。",
      "如果哪天又想吃顿好的，记得先领好野餐篮——",
      "那是我留给你的、放心放纵的许可。"
    ];
    return lines.join("\n");
  }

  /* 订阅 */
  try {
    B().on("checkin:done", function (p) { try { onCheckin(p && p.checkin ? findPlan(p.planId) : null); } catch (e) {} });
    B().on("day:missed", function (d) { try { onMiss((d && d.days) || 1); } catch (e) {} });
  } catch (e) {}

  function findPlan(id) {
    if (!id) return null;
    var plans = store().loadPlans();
    for (var i = 0; i < plans.length; i++) if (plans[i].id === id) return plans[i];
    return null;
  }

  RF.pet = {
    PET_STAGES: PET_STAGES,
    get: get, create: create, stats: stats, applyDelta: applyDelta, decay: decay,
    stage: stage, speak: speak, react: react, render: render,
    onCheckin: onCheckin, onMiss: onMiss, revive: revive, farewellLetter: farewellLetter
  };
})(window.RF = window.RF || {});
