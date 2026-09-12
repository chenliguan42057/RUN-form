/**
 * js/systems/rpg.js —— 段位 / 积分 / 成就 / 每日随机事件
 * 归属：C 组（T04）。订阅 bus "checkin:done" → addPoints + 成就检查。
 */
(function (RF) {
  "use strict";

  /** 段位表（可经 data/content.json 的 rpg.ranks 覆盖） */
  var RANKS = RF.content.get("rpg.ranks", [
    { key: "novice", emoji: "🌱", name: "新手园丁", min: 0 },
    { key: "seedling", emoji: "🌿", name: "育苗学徒", min: 100 },
    { key: "sprout", emoji: "🍀", name: "抽芽园丁", min: 300 },
    { key: "bud", emoji: "🌸", name: "花苞守护", min: 700 },
    { key: "bloom", emoji: "🌺", name: "盛开花匠", min: 1500 },
    { key: "gardener", emoji: "🌻", name: "阳光园主", min: 3000 },
    { key: "keeper", emoji: "🌳", name: "森林看守", min: 6000 },
    { key: "legend", emoji: "🏵", name: "花海传说", min: 12000 }
  ]);

  /**
   * 成就解锁逻辑（代码侧，按 id 映射）。内容文案（名称/emoji）走 data/content.json，
   * 二者按 id 合并——主理人改文案不动逻辑、改逻辑不动文案。
   */
  var TESTS = {
    "first-checkin": function (c) { return c.checkins >= 1; },
    "first-flower": function (c) { return c.bloomed >= 1; },
    "streak7": function (c) { return c.streak >= 7; },
    "streak14": function (c) { return c.streak >= 14; },
    "streak30": function (c) { return c.streak >= 30; },
    "points1k": function (c) { return c.total >= 1000; },
    "points5k": function (c) { return c.total >= 5000; },
    "perfect-week": function (c) { return c.streak >= 7 && c.todayPerfect; },
    "all-bloom": function (c) { return c.flowers > 0 && c.bloomed === c.flowers; }
  };

  /** 成就定义（合并 content 文案 + 代码 test） */
  var ACHIEVEMENTS = (RF.content.get("rpg.achievements", [
    { id: "first-checkin", name: "破土", emoji: "🌱" },
    { id: "first-flower", name: "第一朵花", emoji: "🌼" },
    { id: "streak7", name: "一周花开", emoji: "🔥" },
    { id: "streak14", name: "两周不辍", emoji: "⚡" },
    { id: "streak30", name: "月度园丁", emoji: "🌟" },
    { id: "points1k", name: "千分开外", emoji: "💎" },
    { id: "points5k", name: "积分富农", emoji: "👑" },
    { id: "perfect-week", name: "完美一周", emoji: "🏅" },
    { id: "all-bloom", name: "满园芬芳", emoji: "🌷" }
  ])).map(function (a) {
    return { id: a.id, name: a.name, emoji: a.emoji, test: TESTS[a.id] || function () { return false; } };
  });

  var DAILY_EVENTS = RF.content.get("rpg.dailyEvents", [
    { id: "sunny", name: "阳光加成", desc: "今天打卡积分 ×1.5", multiplier: 1.5 },
    { id: "rain", name: "细雨滋润", desc: "小光心情 +15", delta: { mood: 15 } },
    { id: "wind", name: "清风助力", desc: "小光能量 +15", delta: { energy: 15 } }
  ]);

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function store() { return RF.store; }

  function rank(totalPoints) {
    var tp = totalPoints || 0;
    var cur = RANKS[0], idx = 0;
    for (var i = 0; i < RANKS.length; i++) { if (tp >= RANKS[i].min) { cur = RANKS[i]; idx = i; } }
    var next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;
    var progress = next ? U().clamp((tp - cur.min) / (next.min - cur.min), 0, 1) : 1;
    return { key: cur.key, emoji: cur.emoji, name: cur.name, min: cur.min, next: next, progress: progress };
  }

  function addPoints(n, reason) {
    var before = rank(store().loadProfile().totalPoints).key;
    store().addPoints(n, reason);
    var after = rank(store().loadProfile().totalPoints).key;
    var rankUp = before !== after ? rank(store().loadProfile().totalPoints) : null;
    if (rankUp) { try { B().emit("rank:up", { rank: rankUp }); } catch (e) {} }
    var fresh = checkAchievements();
    return { points: store().loadProfile().points, totalPoints: store().loadProfile().totalPoints, rankUp: rankUp, achievements: fresh };
  }

  function context() {
    var checks = store().loadCheckins();
    var g = store().loadGarden();
    var bloomed = g.flowers.filter(function (f) { return f.stage >= 4 && !f.withered; }).length;
    return {
      checkins: checks.length,
      bloomed: bloomed,
      flowers: g.flowers.length,
      streak: store().streakInfo().current,
      total: store().loadProfile().totalPoints,
      todayPerfect: store().dayStatus() === "perfect"
    };
  }

  function checkAchievements() {
    var prof = store().loadProfile();
    var have = {};
    (prof.achievements || []).forEach(function (a) { have[a.id] = true; });
    var ctx = context();
    var fresh = [];
    ACHIEVEMENTS.forEach(function (a) {
      if (!have[a.id] && a.test(ctx)) {
        have[a.id] = true;
        var rec = { id: a.id, name: a.name, emoji: a.emoji, unlockedAt: U().nowMs() };
        prof.achievements = (prof.achievements || []).concat([rec]);
        fresh.push(rec);
        try { B().emit("achievement:unlocked", { achievement: rec }); } catch (e) {}
      }
    });
    if (fresh.length) store().saveProfile({ achievements: prof.achievements });
    return fresh;
  }

  /**
   * 每日随机事件：每天最多 roll 一次（幂等）。命中则把事件 id 持久化并立即生效
   * （pet 增减走 pet:applyDelta；UI 通过 event:rolled 展示）。由 day:reset 触发。
   */
  function rollDailyEvent() {
    var today = U().dayKey();
    var prof = store().loadProfile();
    if (prof.lastEventDay === today) return null; // 每天只 roll 一次
    var evt = Math.random() < 0.3 ? U().pick(DAILY_EVENTS) : null;
    store().saveProfile({ lastEventDay: today, dailyEventId: evt ? evt.id : null });
    if (evt) applyEvent(evt);
    return evt;
  }

  function applyEvent(evt) {
    if (!evt) return { ok: false, effect: "" };
    if (evt.delta) { try { RF.bus.emit("pet:applyDelta", { delta: evt.delta, reason: "event" }); } catch (e) {} }
    try { B().emit("event:rolled", evt); } catch (e) {}
    return { ok: true, effect: evt.desc || "" };
  }

  try {
    B().on("checkin:done", function (p) {
      try {
        var pts = (p && p.points) || 10;
        // 今日若 roll 到倍率事件，按「已 roll 的那个事件」加成（不得再随机重抽）
        var prof = store().loadProfile();
        if (prof.dailyEventId) {
          var ev = null;
          for (var i = 0; i < DAILY_EVENTS.length; i++) {
            if (DAILY_EVENTS[i].id === prof.dailyEventId) { ev = DAILY_EVENTS[i]; break; }
          }
          if (ev && ev.multiplier) pts = Math.round(pts * ev.multiplier);
        }
        addPoints(pts, "打卡");
      } catch (e) {}
    });
  } catch (e) {}

  // 每日结算（store.init 发出 day:reset）→ roll 当日随机事件；rollDailyEvent 自带「每天一次」幂等守卫
  try {
    B().on("day:reset", function () { try { rollDailyEvent(); } catch (e) {} });
  } catch (e) {}

  RF.rpg = {
    RANKS: RANKS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    rank: rank,
    addPoints: addPoints,
    checkAchievements: checkAchievements,
    rollDailyEvent: rollDailyEvent,
    applyEvent: applyEvent
  };
})(window.RF = window.RF || {});
