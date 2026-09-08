/**
 * js/systems/punishment.js —— 断签惩罚阶梯 + 唤醒 + 告别信
 * 归属：C 组（T04）。纯函数 evaluate() 与 D 组 Python 工作流字段名一致（level / message）。
 * 写状态时 emit("garden:wither", {ratio}) 通知 B 组 scene；不 import 对方。
 */
(function (RF) {
  "use strict";

  var LEVELS = [
    { days: 0, pet: "sad", gardenRatio: 0.0, scene: "clear", msg: "今天还有任务没完成，小光有点失落……" },
    { days: 2, pet: "sick", gardenRatio: 0.3, scene: "cloudy", msg: "小光生病了，它说很想你……" },
    { days: 3, pet: "sleep", gardenRatio: 0.6, scene: "gray", msg: "小光沉睡了，花园快荒了……" },
    { days: 5, pet: "fade", gardenRatio: 0.9, scene: "fallen", msg: "小光快要消失了……" },
    { days: 7, pet: "gone", gardenRatio: 1.0, scene: "bw", msg: "小光走了。它留下了一封信。" }
  ];

  var STATE_MAP = { sad: "normal", sick: "sick", sleep: "sleep", fade: "faded", gone: "gone" };

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function store() { return RF.store; }

  function levelForBroke(broke) {
    if (broke >= 7) return 4;
    if (broke >= 5) return 3;
    if (broke >= 3) return 2;
    if (broke >= 2) return 1;
    return 0;
  }

  function witheredCount() {
    return store().loadGarden().flowers.filter(function (f) { return f.withered; }).length;
  }

  function evaluate() {
    var broke = store().streakInfo().brokeDays;
    var lvl = levelForBroke(broke);
    var L = LEVELS[lvl];
    var msg = String(L.msg).replace("{n}", String(witheredCount()));
    return {
      level: lvl, days: broke, petAction: L.pet,
      gardenRatio: L.gardenRatio, sceneClass: L.scene, message: msg
    };
  }

  function applyDaily() {
    var today = U().dayKey();
    var prof = store().loadProfile();
    var settled = (prof.granted && prof.granted._settled) || "";
    if (settled === today) return evaluate();
    // 标记今日已结算（幂等）
    var g = Object.assign({}, prof.granted || {}, { _settled: today });
    store().saveProfile({ granted: g });

    var broke = store().streakInfo().brokeDays;
    if (broke >= 1) {
      var lvl = levelForBroke(broke);
      var L = LEVELS[lvl];
      var newState = STATE_MAP[L.pet];
      var pet = store().loadPet();
      if (newState !== "normal") {
        store().savePet({
          state: newState,
          sleepingSince: newState === "sleep" ? (pet.sleepingSince || U().nowMs()) : null,
          mood: U().clamp(pet.mood - 10, 0, 100)
        });
      }
      store().saveGarden({ witherRatio: L.gardenRatio });
      try { if (RF.scene && RF.scene.setWeather) RF.scene.setWeather(L.scene); } catch (e) {}
      try { B().emit("garden:wither", { ratio: L.gardenRatio }); } catch (e) {}
      try { B().emit("day:missed", { dayKey: U().addDays(today, -1), pending: pendingOfYesterday() }); } catch (e) {}
    } else {
      // 已恢复：把花园枯 ratio 归零、精灵状态拉回 normal
      store().saveGarden({ witherRatio: 0 });
      var p2 = store().loadPet();
      if (p2.state !== "normal" && p2.state !== "gone") store().savePet({ state: "normal" });
    }
    return evaluate();
  }

  function pendingOfYesterday() {
    var y = U().addDays(U().dayKey(), -1);
    var core = store().loadPlans().filter(function (p) { return p.enabled && p.core && isOnDay(p, y); });
    var done = store().loadCheckins().filter(function (c) { return c.dayKey === y; }).map(function (c) { return c.planId; });
    return core.filter(function (p) { return done.indexOf(p.id) < 0; }).length;
  }
  function isOnDay(plan, dayKey) {
    var dt = new Date(U().startOfDayMs(dayKey));
    var dow = (dt.getDay() + 6) % 7, dom = dt.getDate();
    if (plan.freq === "daily") return true;
    if (plan.freq === "weekly") return plan.day === dow;
    if (plan.freq === "monthly") return plan.day > 0 && plan.day === dom;
    return false;
  }

  function canRevive() {
    var state = store().loadPet().state;
    var inv = store().loadProfile().inventory.props || {};
    var streak = store().streakInfo().current;
    if (state === "gone") {
      if (inv.memoryFlower > 0) return { can: true, method: "memory-flower", need: "用 1 朵回忆之花召回（亲密度保留）" };
      if (streak >= 30) return { can: true, method: "three-day", need: "连续 30 天全勤自动召回" };
      return { can: false, method: null, need: "需要回忆之花 ×1，或连续 30 天全勤" };
    }
    if (state === "faded") {
      if (inv.timeDew > 0) return { can: true, method: "time-dew", need: "用 1 份时光露水召回" };
      if (streak >= 14) return { can: true, method: "three-day", need: "连续 14 天全勤自动召回" };
      return { can: false, method: null, need: "需要时光露水 ×1，或连续 14 天全勤" };
    }
    if (state === "sleep" || state === "sick") {
      if (streak >= 3) return { can: true, method: "three-day", need: "连续 3 天全勤唤醒" };
      return { can: false, method: null, need: "连续 3 天全勤即可唤醒" };
    }
    return { can: true, method: "three-day", need: "小光还在等你，继续打卡就好" };
  }

  function revive(method) {
    var can = canRevive();
    if (!can.can && method !== "three-day") return false;
    var inv = store().loadProfile().inventory.props || {};
    if (method === "memory-flower" && inv.memoryFlower > 0) {
      inv.memoryFlower -= 1;
      store().saveProfile({ inventory: { props: inv } });
    } else if (method === "time-dew" && inv.timeDew > 0) {
      inv.timeDew -= 1;
      store().saveProfile({ inventory: { props: inv } });
    } else if (method === "three-day") {
      // 连续全勤路径：直接召回
    } else {
      return false;
    }
    store().saveGarden({ witherRatio: 0 });
    RF.pet.revive(method);
    try { if (RF.scene && RF.scene.setWeather) RF.scene.setWeather("clear"); } catch (e) {}
    return true;
  }

  function letter() {
    var days = RF.pet.stage().days;
    return [
      "亲爱的，这 " + days + " 天里你每一次打卡我都记着。",
      "花园也许会荒，但你不曾真的离开。",
      "想放纵的时候，记得先领好野餐篮——那是我留给你的放心许可。",
      "明天，我们重新一起开花吧。"
    ].join("\n");
  }

  RF.punishment = {
    LEVELS: LEVELS,
    evaluate: evaluate,
    applyDaily: applyDaily,
    canRevive: canRevive,
    revive: revive,
    letter: letter
  };
})(window.RF = window.RF || {});
