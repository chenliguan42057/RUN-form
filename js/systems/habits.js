/**
 * js/systems/habits.js —— 饮水 / 番茄钟 / 早起早睡（本地私有，不同步）
 * 归属：C 组（T04）。数据存 localStorage runform_habits（本地私有，见 §4.1）。
 */
(function (RF) {
  "use strict";

  function U() { return RF.util; }
  function store() { return RF.store; }
  function K() { return RF.storage.KEYS; }

  function load() {
    return RF.storage.getJSON(K().HABITS, { dayKey: "", water: 0, focusLog: [], sleep: {}, wake: { streak: 0, lastDay: "" } });
  }
  function save(h) { RF.storage.setJSON(K().HABITS, h); }

  /** 保证 habits 的 dayKey 是今天（跨天则重置饮水/专注日统计） */
  function ensureToday() {
    var h = load();
    var t = U().dayKey();
    if (h.dayKey !== t) { h.dayKey = t; h.water = 0; h.focusLog = []; }
    return h;
  }

  function waterAdd(ml) {
    var h = ensureToday();
    h.water = (h.water || 0) + (Number(ml) || 0);
    save(h);
    return waterToday();
  }
  function waterToday() {
    var h = ensureToday();
    var goal = (store().loadProfile().settings.waterGoalMl) || 2000;
    return { today: h.water || 0, goal: goal, cups: Math.floor((h.water || 0) / 250), done: (h.water || 0) >= goal };
  }

  var _focus = null;
  var _awayStart = 0;
  function focusStart(minutes) {
    var m = minutes || store().loadProfile().settings.focusMinutes || 25;
    _focus = { startAt: U().nowMs(), minutes: m, endAt: U().nowMs() + m * 60000, away: 0, lastVisible: U().nowMs() };
    document.addEventListener("visibilitychange", _onVis);
    return { ok: true, startAt: _focus.startAt, minutes: m, endAt: _focus.endAt };
  }
  function _onVis() {
    if (!_focus) return;
    if (document.hidden) _awayStart = U().nowMs();
    else if (_awayStart) { _focus.away += U().nowMs() - _awayStart; _awayStart = 0; }
  }
  function focusStop(completed) {
    if (!_focus) return { ok: false, minutes: 0, awaySec: 0, reward: 0 };
    if (document.hidden && _awayStart) _focus.away += U().nowMs() - _awayStart;
    document.removeEventListener("visibilitychange", _onVis);
    var awaySec = Math.round((_focus.away || 0) / 1000);
    var reward = 0;
    if (completed) {
      reward = Math.round(_focus.minutes * 2);
      try { store().addPoints(reward, "番茄钟"); if (RF.bus) RF.bus.emit("pet:applyDelta", { delta: { energy: 10 }, reason: "focus" }); } catch (e) {}
    }
    var h = ensureToday();
    h.focusLog = (h.focusLog || []).concat([{ startAt: _focus.startAt, minutes: _focus.minutes, completed: !!completed }]);
    save(h);
    var res = { ok: true, minutes: _focus.minutes, awaySec: awaySec, reward: reward };
    _focus = null;
    return res;
  }
  function focusLog() { return (ensureToday().focusLog || []).slice(-10); }

  function markSleep() {
    var h = ensureToday();
    h.sleep = { dayKey: U().dayKey(), at: U().nowMs() };
    save(h);
  }

  function markWake(shakeVerified) {
    var h = load();
    var target = store().loadProfile().settings.wakeTarget || "07:00";
    var now = new Date();
    var onTime = U().hhmmToMin(U().minToHHMM(now.getHours() * 60 + now.getMinutes())) <= U().hhmmToMin(target) + 30;
    var today = U().dayKey();
    var streak = h.wake.streak || 0;
    if (onTime && shakeVerified) {
      if (h.wake.lastDay === U().addDays(today, -1)) streak += 1;
      else if (h.wake.lastDay !== today) streak = 1;
    }
    h.wake = { streak: streak, lastDay: today };
    save(h);
    return { ok: true, target: target, onTime: onTime, streak: streak };
  }
  function wakeStreak() { return load().wake.streak || 0; }

  RF.habits = {
    waterAdd: waterAdd,
    waterToday: waterToday,
    focusStart: focusStart,
    focusStop: focusStop,
    focusLog: focusLog,
    markSleep: markSleep,
    markWake: markWake,
    wakeStreak: wakeStreak
  };
})(window.RF = window.RF || {});
