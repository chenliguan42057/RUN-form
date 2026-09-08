/**
 * js/systems/countdown.js —— 每日倒计时 + 里程碑倒计时
 * 归属：B 组（T03）。tick() 用 1s setInterval（非 rAF，符合 §8.6 单主循环精神）。
 */
(function (RF) {
  "use strict";

  var _timer = null;

  function U() { return RF.util; }
  function store() { return RF.store; }

  function toEndOfDay() {
    return U().startOfDayMs(U().addDays(U().dayKey(), 1)) - U().nowMs();
  }

  function toTarget(hhmm) {
    var m = U().hhmmToMin(hhmm);
    var now = new Date();
    var cur = now.getHours() * 60 + now.getMinutes();
    var diff = m - cur;
    if (diff < 0) diff += 1440; // 已过则算明天
    return diff * 60000 - now.getSeconds() * 1000 - now.getMilliseconds();
  }

  function toMilestone(days) {
    var cur = store().streakInfo().current;
    var left = Math.max(0, days - cur);
    return left * U().DAY_MS + toEndOfDay();
  }

  function tick(el) {
    if (!el) return;
    if (_timer) clearInterval(_timer);
    function paint() {
      if (!el) return;
      el.textContent = U().fmtDuration(Math.max(0, toEndOfDay()));
    }
    paint();
    _timer = setInterval(paint, 1000);
  }

  function format(ms) { return U().fmtDuration(ms); }

  RF.countdown = {
    toEndOfDay: toEndOfDay,
    toTarget: toTarget,
    toMilestone: toMilestone,
    tick: tick,
    format: format
  };
})(window.RF = window.RF || {});
