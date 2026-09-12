/**
 * js/pages/home.js —— 花园主页装配与交互（index.html）
 * 归属：D 组（T05）。导出 RF.pages.home.init()。
 *
 * 打卡反馈红线（§8.6 第 4 条）：点击打卡后 0.5 秒内必须出视听反馈 ——
 *   RF.fx.sound("ding") 与 RF.fx.particles(btn) 同步触发，不等网络同步。
 */
(function (RF) {
  "use strict";

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function S() { return RF.store; }

  var els = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    try { S().init(); } catch (e) { /* 首屏不能白屏 */ }
    try { if (RF.scene) RF.scene.init(); } catch (e) {}
    try {
      if (RF.scene && RF.scene.setReduceMotion) {
        var p = S().loadProfile();
        RF.scene.setReduceMotion(!!(p.settings && p.settings.reduceMotion));
      }
      if (RF.pet && RF.pet.decay) RF.pet.decay();
    } catch (e) {}

    markActiveNav();

    els.greeting = $("greeting");
    els.date = $("today-date");
    els.period = $("period-note");
    els.petSlot = $("pet-slot");
    els.petStats = $("pet-stats");
    els.countdown = $("countdown-slot");
    els.milestone = $("countdown-milestone");
    els.tasks = $("task-list");
    els.taskEmpty = $("task-empty");
    els.garden = $("garden-slot");
    els.bloom = $("bloom-badge");
    els.sc = $("streak-current");
    els.sb = $("streak-best");
    els.couponHint = $("coupon-hint");

    renderHeader();
    renderPet();
    renderCountdown();
    renderTasks();
    renderGarden();
    renderStreak();
    renderCouponHint();

    bindTasks();
    subscribe();
  }

  function markActiveNav() { if (RF.ui && RF.ui.markActiveNav) RF.ui.markActiveNav(); }

  function renderHeader() {
    try {
      var hour = new Date().getHours();
      var bucket = hour < 6 ? "lateNight" : hour < 11 ? "morning" : hour < 14 ? "noon" : hour < 18 ? "afternoon" : hour < 22 ? "evening" : "night";
      var greet = RF.content.get("ui.home.greetings." + bucket, hour < 6 ? "夜深了" : hour < 11 ? "早安" : hour < 14 ? "午安" : hour < 18 ? "下午好" : hour < 22 ? "晚上好" : "夜安");
      var pet = RF.pet.get();
      if (els.greeting) els.greeting.textContent = greet + "，" + U().esc(pet.name || "小光") + " 在等你～";
      if (els.date) els.date.textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      if (els.period && RF.scene) {
        var per = RF.scene.currentPeriod();
        els.period.textContent = per && per.note ? per.note : "";
      }
    } catch (e) {}
  }

  function renderPet() {
    if (els.petSlot) { try { RF.pet.render(els.petSlot); } catch (e) {} }
    if (!els.petStats) return;
    try {
      var st = RF.pet.stats();
      var rows = [
        { v: st.food, c: "var(--g-stat-food)", e: "🍞", t: "饱食" },
        { v: st.mood, c: "var(--g-stat-mood)", e: "💗", t: "心情" },
        { v: st.energy, c: "var(--g-stat-energy)", e: "⚡", t: "精力" },
        { v: st.bond, c: "var(--g-stat-bond)", e: "🤝", t: "亲密度" }
      ];
      var html = "";
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        html += '<div class="g-stat">' +
          '<span class="g-stat__label">' + r.e + " " + r.t + "</span>" +
          RF.ui.progressBar({ value: r.v, max: 100, color: r.c, emoji: "", showNum: true }) +
          "</div>";
      }
      els.petStats.innerHTML = html;
    } catch (e) {}
  }

  function renderCountdown() {
    if (els.countdown) {
      els.countdown.innerHTML = '<span class="g-count__time u-num" id="cd-tick">--:--:--</span>';
      try { RF.countdown.tick($("cd-tick")); } catch (e) {}
    }
    if (els.milestone) {
      try {
        var cur = S().streakInfo().current;
        var MS = (RF.content.get("coupon.milestones", []) || []).map(function (m) { return m.days; });
        var targets = MS.filter(function (d) { return d > cur; });
        if (targets.length) {
          var left = RF.countdown.toMilestone(targets[0]);
          els.milestone.textContent = RF.content.get("ui.home.milestone.prefix", "距 ") + targets[0] + RF.content.get("ui.home.milestone.suffix", " 天里程碑还有 ") + RF.countdown.format(left);
        } else {
          els.milestone.textContent = RF.content.get("ui.home.milestone.maxed", "已是 30 天大佬，继续闪耀 ✨");
        }
      } catch (e) {}
    }
  }

  function renderTasks() {
    if (!els.tasks) return;
    var plans = [];
    try { plans = S().todayPlans(); } catch (e) {}
    if (!plans.length) {
      if (els.taskEmpty) els.taskEmpty.hidden = false;
      els.tasks.innerHTML = "";
      return;
    }
    if (els.taskEmpty) els.taskEmpty.hidden = true;
    var html = "";
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      var done = false;
      try { done = S().doneToday(p.id); } catch (e) {}
      var meta = U().esc(p.time || "") + " · 难度 " + (p.difficulty || 3) + (p.core ? " · 核心" : "");
      html += '<div class="g-task' + (done ? " is-done" : "") + '" data-plan="' + U().esc(p.id) + '">' +
        '<button type="button" class="g-task__check" data-plan="' + U().esc(p.id) + '" aria-label="' + (done ? "已完成" : "完成打卡") + '">' +
          (done ? "✅" : U().esc(p.icon || "🌟")) + "</button>" +
        '<div class="g-task__main">' +
          '<span class="g-task__name">' + U().esc(p.name) + "</span>" +
          '<span class="g-task__meta">' + meta + "</span>" +
        "</div>" +
        (p.core ? '<span class="g-task__tag">核心</span>' : "") +
        "</div>";
    }
    els.tasks.innerHTML = html;
  }

  function bindTasks() {
    if (!els.tasks) return;
    els.tasks.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-plan]") : null;
      if (!btn) return;
      onCheckin(btn.getAttribute("data-plan"), btn);
    });
  }

  function onCheckin(planId, btn) {
    var already = false;
    try { already = S().doneToday(planId); } catch (e) {}
    if (already) {
      if (RF.fx) RF.fx.toastKey("alreadyDone", null, "info");
      return;
    }
    // 0.5 秒内的视听反馈：同步、不等网络
    if (RF.fx) { RF.fx.sound("ding"); RF.fx.particles(btn, { count: 14 }); }
    try {
      var c = S().addCheckin(planId, {});
      if (c && RF.fx) RF.fx.toastKey("checkinDone", { n: (c.points || 0) }, "success");
    } catch (e) {
      if (RF.fx) RF.fx.toastKey("checkinFail", null, "error");
      return;
    }
    refresh();
  }

  function renderGarden() {
    if (!els.garden) return;
    try {
      RF.garden.syncFlowers(S().todayPlans());
      RF.garden.render(els.garden);
      var g = RF.garden.get();
      var total = g.flowers.length;
      var bloomed = g.flowers.filter(function (f) { return f.stage >= 4 && !f.withered; }).length;
      if (els.bloom) {
        els.bloom.hidden = false;
        els.bloom.textContent = "🌷 " + bloomed + " / " + total;
      }
    } catch (e) {}
  }

  function renderStreak() {
    try {
      var s = S().streakInfo();
      if (els.sc) els.sc.textContent = String(s.current);
      if (els.sb) els.sb.textContent = String(s.best);
    } catch (e) {}
  }

  function renderCouponHint() {
    if (!els.couponHint) return;
    try {
      var bal = RF.coupon.balance();
      els.couponHint.innerHTML = RF.content.get("ui.home.couponHint.balance", "当前野餐券余额") + ' <b class="u-num">¥' + bal + "</b> · " +
        '<a href="shop.html">' + RF.content.get("ui.home.couponHint.cta", "去市集放纵一下 →") + "</a>";
    } catch (e) {}
  }

  function refresh() {
    renderHeader();
    renderPet();
    renderStreak();
    renderTasks();
    renderGarden();
    renderCouponHint();
  }

  function subscribe() {
    if (!B()) return;
    var E = B().EVENTS;
    var re = function () { try { refresh(); } catch (e) {} };
    [E.checkin_done, E.day_perfect, E.pet_stageUp, E.garden_bloom, E.rank_up, E.achievement_unlocked,
     E.coupon_granted, E.coupon_used, E.coupon_theft, E.pet_stateChange].forEach(function (ev) {
      if (ev) B().on(ev, re);
    });
  }

  RF.pages = RF.pages || {};
  RF.pages.home = { init: init };
})(window.RF = window.RF || {});
