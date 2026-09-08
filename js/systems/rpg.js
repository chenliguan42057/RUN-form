/**
 * js/systems/rpg.js —— 段位 / 积分 / 成就 / 每日随机事件
 * 归属：C 组（T04）。订阅 bus "checkin:done" → addPoints + 成就检查。
 */
(function (RF) {
  "use strict";

  var RANKS = [
    { key: "novice", emoji: "🌱", name: "新手园丁", min: 0 },
    { key: "seedling", emoji: "🌿", name: "育苗学徒", min: 100 },
    { key: "sprout", emoji: "🍀", name: "抽芽园丁", min: 300 },
    { key: "bud", emoji: "🌸", name: "花苞守护", min: 700 },
    { key: "bloom", emoji: "🌺", name: "盛开花匠", min: 1500 },
    { key: "gardener", emoji: "🌻", name: "阳光园主", min: 3000 },
    { key: "keeper", emoji: "🌳", name: "森林看守", min: 6000 },
    { key: "legend", emoji: "🏵", name: "花海传说", min: 12000 }
  ];

  /** 9 个成就定义 */
  var ACHIEVEMENTS = [
    { id: "first-checkin", name: "破土", emoji: "🌱", test: function (c) { return c.checkins >= 1; } },
    { id: "first-flower", name: "第一朵花", emoji: "🌼", test: function (c) { return c.bloomed >= 1; } },
    { id: "streak7", name: "一周花开", emoji: "🔥", test: function (c) { return c.streak >= 7; } },
    { id: "streak14", name: "两周不辍", emoji: "⚡", test: function (c) { return c.streak >= 14; } },
    { id: "streak30", name: "月度园丁", emoji: "🌟", test: function (c) { return c.streak >= 30; } },
    { id: "points1k", name: "千分开外", emoji: "💎", test: function (c) { return c.total >= 1000; } },
    { id: "points5k", name: "积分富农", emoji: "👑", test: function (c) { return c.total >= 5000; } },
    { id: "perfect-week", name: "完美一周", emoji: "🏅", test: function (c) { return c.streak >= 7 && c.todayPerfect; } },
    { id: "all-bloom", name: "满园芬芳", emoji: "🌷", test: function (c) { return c.flowers > 0 && c.bloomed === c.flowers; } }
  ];

  var DAILY_EVENTS = [
    { id: "sunny", name: "阳光加成", desc: "今天打卡积分 ×1.5", multiplier: 1.5 },
    { id: "rain", name: "细雨滋润", desc: "小光心情 +15", delta: { mood: 15 } },
    { id: "wind", name: "清风助力", desc: "小光能量 +15", delta: { energy: 15 } }
  ];

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

  function rollDailyEvent() {
    var today = U().dayKey();
    var prof = store().loadProfile();
    if (prof.lastEventDay === today) return null; // 每天只 roll 一次
    store().saveProfile({ lastEventDay: today });
    if (Math.random() < 0.3) {
      var evt = U().pick(DAILY_EVENTS);
      return evt;
    }
    return null;
  }

  function applyEvent(evt) {
    if (!evt) return { ok: false, effect: "" };
    if (evt.delta) { try { if (RF.pet) RF.pet.applyDelta(evt.delta, "event"); } catch (e) {} }
    try { B().emit("event:rolled", evt); } catch (e) {}
    return { ok: true, effect: evt.desc || "" };
  }

  try {
    B().on("checkin:done", function (p) {
      try {
        var pts = (p && p.points) || 10;
        // 事件倍率
        var prof = store().loadProfile();
        if (prof.lastEventDay === U().dayKey()) {
          var ev = U().pick(DAILY_EVENTS);
          if (ev && ev.multiplier) pts = Math.round(pts * ev.multiplier);
        }
        addPoints(pts, "打卡");
      } catch (e) {}
    });
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
