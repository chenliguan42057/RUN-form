/**
 * js/pages/manage.js —— 花园管理页（manage.html）
 * 归属：D 组（T05）。导出 RF.pages.manage.init()。
 *
 * 三个 Tab：任务表 / 设置 / 推送配置。所有用户数据进 innerHTML 前过 RF.util.esc()。
 * 红线（决策 10）：同步到仓库的数据是公开的，页面需提示别写隐私；提供「不同步 note」开关。
 */
(function (RF) {
  "use strict";

  function U() { return RF.util; }
  function S() { return RF.store; }
  function K() { return RF.storage.KEYS; }

  var currentIcon = "🌟";

  var TEMPLATES = {
    morning: { name: "晨间三件套：温水+拉伸", icon: "🌅", freq: "daily", time: "07:30", core: true, difficulty: 2, estMinutes: 10 },
    health: { name: "健康基础：运动", icon: "💪", freq: "daily", time: "08:00", core: true, difficulty: 4, estMinutes: 20 },
    study: { name: "学习专注：读书", icon: "📚", freq: "daily", time: "21:00", core: true, difficulty: 3, estMinutes: 15 }
  };

  function $(id) { return document.getElementById(id); }

  function init() {
    try { S().init(); } catch (e) {}
    try { if (RF.scene) RF.scene.init(); } catch (e) {}
    try {
      if (RF.scene && RF.scene.setReduceMotion) {
        var p = S().loadProfile();
        RF.scene.setReduceMotion(!!(p.settings && p.settings.reduceMotion));
      }
    } catch (e) {}

    markActiveNav();
    bindTabs();
    renderPlanList();
    bindPlanForm();
    bindTemplates();
    renderSettings();
    renderPush();
    bindSettings();
    bindPush();
    refreshLastSync();
  }

  function markActiveNav() {
    try {
      var here = location.pathname.split("/").pop() || "manage.html";
      var links = document.querySelectorAll(".g-nav__link");
      for (var i = 0; i < links.length; i++) {
        if ((links[i].getAttribute("href") || "").indexOf(here) >= 0) links[i].classList.add("g-nav__link--active");
      }
    } catch (e) {}
  }

  /* ---------------- Tab ---------------- */
  function bindTabs() {
    var bar = $("tab-bar");
    if (!bar) return;
    bar.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-tab]") : null;
      if (!t) return;
      var tab = t.getAttribute("data-tab");
      var tabs = bar.querySelectorAll("[data-tab]");
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("is-active");
      t.classList.add("is-active");
      var panels = document.querySelectorAll("[data-panel]");
      for (var j = 0; j < panels.length; j++) {
        panels[j].hidden = panels[j].getAttribute("data-panel") !== tab;
      }
    });
  }

  /* ---------------- 任务表 ---------------- */
  function renderPlanList() {
    var list = $("plan-list");
    var empty = $("plan-empty");
    if (!list) return;
    var plans = [];
    try { plans = S().loadPlans(); } catch (e) {}
    if (!plans.length) {
      if (empty) empty.hidden = false;
      list.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    var html = "";
    for (var i = 0; i < plans.length; i++) {
      var p = plans[i];
      var freqLabel = { daily: "每天", weekly: "每周", monthly: "每月" }[p.freq] || "每天";
      html += '<div class="g-plan' + (p.enabled ? "" : " is-off") + '" data-id="' + U().esc(p.id) + '">' +
        '<span class="g-plan__icon" aria-hidden="true">' + U().esc(p.icon || "🌟") + "</span>" +
        '<div class="g-plan__main">' +
          '<span class="g-plan__name">' + U().esc(p.name) + (p.core ? ' <span class="g-plan__core">核心</span>' : "") + "</span>" +
          '<span class="g-plan__meta">' + freqLabel + " · " + U().esc(p.time || "") + " · 难度 " + (p.difficulty || 3) + "</span>" +
        "</div>" +
        '<div class="g-plan__acts">' +
          '<button type="button" class="g-iconbtn" data-edit="' + U().esc(p.id) + '" aria-label="编辑">✏️</button>' +
          '<button type="button" class="g-iconbtn" data-toggle="' + U().esc(p.id) + '" aria-label="启用/停用">' + (p.enabled ? "⏸" : "▶️") + "</button>" +
          '<button type="button" class="g-iconbtn" data-del="' + U().esc(p.id) + '" aria-label="删除">🗑</button>' +
        "</div>" +
        "</div>";
    }
    list.innerHTML = html;
  }

  function bindPlanForm() {
    var form = $("plan-form");
    if (form) form.addEventListener("submit", function (ev) { ev.preventDefault(); savePlan(); });
    var save = $("plan-save");
    if (save) save.addEventListener("click", function (ev) { ev.preventDefault(); savePlan(); });
    var add = $("add-plan-btn");
    if (add) add.addEventListener("click", function () { resetForm(); showForm(); if ($("plan-name")) $("plan-name").focus(); });
    var cancel = $("plan-cancel");
    if (cancel) cancel.addEventListener("click", function (ev) { ev.preventDefault(); resetForm(); hideForm(); });

    // 列表内的编辑 / 删除 / 启用
    var list = $("plan-list");
    if (list) {
      list.addEventListener("click", function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest("[data-edit],[data-del],[data-toggle]") : null;
        if (!b) return;
        if (b.getAttribute("data-edit")) editPlan(b.getAttribute("data-edit"));
        else if (b.getAttribute("data-del")) delPlan(b.getAttribute("data-del"));
        else if (b.getAttribute("data-toggle")) togglePlan(b.getAttribute("data-toggle"));
      });
    }
  }

  function readForm() {
    function val(id) { var e = $(id); return e ? e.value : ""; }
    function chk(id) { var e = $(id); return e ? e.checked : false; }
    return {
      id: val("plan-id"),
      name: val("plan-name").trim(),
      icon: val("plan-icon-picker-value") || "🌟",
      freq: val("plan-freq") || "daily",
      time: val("plan-time") || "08:00",
      difficulty: parseInt(val("plan-difficulty"), 10) || 3,
      estMinutes: parseInt(val("plan-est"), 10) || 10,
      core: chk("plan-core"),
      enabled: $("plan-enabled") ? chk("plan-enabled") : true
    };
  }

  var _saving = false;
  function savePlan() {
    if (_saving) return;
    var f = readForm();
    if (!f.name) { if (RF.fx) RF.fx.toast("请先填任务名", "warning"); return; }
    _saving = true;
    try {
      if (f.id) {
        S().updatePlan(f.id, { name: f.name, icon: f.icon, freq: f.freq, time: f.time, difficulty: f.difficulty, estMinutes: f.estMinutes, core: f.core, enabled: f.enabled });
        if (RF.fx) RF.fx.toast("已更新任务", "success");
      } else {
        S().addPlan({ name: f.name, icon: f.icon, freq: f.freq, time: f.time, difficulty: f.difficulty, estMinutes: f.estMinutes, core: f.core, enabled: f.enabled });
        if (RF.fx) RF.fx.toast("已添加任务 🌱", "success");
      }
    } catch (e) { if (RF.fx) RF.fx.toast("保存失败", "error"); }
    resetForm();
    renderPlanList();
    _saving = false;
  }

  function editPlan(id) {
    var plans = [];
    try { plans = S().loadPlans(); } catch (e) {}
    var p = null;
    for (var i = 0; i < plans.length; i++) if (plans[i].id === id) { p = plans[i]; break; }
    if (!p) return;
    if ($("plan-id")) $("plan-id").value = p.id;
    if ($("plan-name")) $("plan-name").value = p.name;
    if ($("plan-freq")) $("plan-freq").value = p.freq;
    if ($("plan-time")) $("plan-time").value = p.time;
    if ($("plan-difficulty")) $("plan-difficulty").value = String(p.difficulty);
    if ($("plan-est")) $("plan-est").value = String(p.estMinutes);
    if ($("plan-core")) $("plan-core").checked = !!p.core;
    if ($("plan-enabled")) $("plan-enabled").checked = p.enabled !== false;
    setIconPicker(p.icon);
    if ($("plan-save")) $("plan-save").textContent = "保存修改";
    showForm();
    if ($("plan-name")) $("plan-name").focus();
  }

  function delPlan(id) {
    if (RF.ui && RF.ui.modal) {
      RF.ui.modal({
        title: "删除任务？",
        body: "<p>删除后它的花也会从花园移走（数据仍保留在仓库用于同步去重）。</p>",
        okText: "删除", cancelText: "取消",
        onOk: function () {
          try { S().deletePlan(id); renderPlanList(); if (RF.fx) RF.fx.toast("已删除", "info"); } catch (e) {}
        }
      });
    } else {
      try { S().deletePlan(id); renderPlanList(); } catch (e) {}
    }
  }

  function togglePlan(id) {
    try { S().togglePlan(id); renderPlanList(); } catch (e) {}
  }

  function resetForm() {
    if ($("plan-id")) $("plan-id").value = "";
    if ($("plan-name")) $("plan-name").value = "";
    if ($("plan-freq")) $("plan-freq").value = "daily";
    if ($("plan-time")) $("plan-time").value = "08:00";
    if ($("plan-difficulty")) $("plan-difficulty").value = "3";
    if ($("plan-est")) $("plan-est").value = "10";
    if ($("plan-core")) $("plan-core").checked = false;
    if ($("plan-enabled")) $("plan-enabled").checked = true;
    if ($("plan-save")) $("plan-save").textContent = "添加任务";
    setIconPicker("🌟");
  }

  function setIconPicker(emoji) {
    currentIcon = emoji || "🌟";
    var box = $("plan-icon-picker");
    if (box && RF.ui && RF.ui.iconPicker) {
      box.innerHTML = RF.ui.iconPicker({
        value: currentIcon,
        onChange: function (em) { currentIcon = em; }
      });
    }
  }

  function bindTemplates() {
    var box = $("plan-templates");
    if (!box) return;
    box.addEventListener("click", function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest("[data-tpl]") : null;
      if (!t) return;
      var tp = TEMPLATES[t.getAttribute("data-tpl")];
      if (!tp) return;
      showForm();
      if ($("plan-name")) $("plan-name").value = tp.name;
      if ($("plan-freq")) $("plan-freq").value = tp.freq;
      if ($("plan-time")) $("plan-time").value = tp.time;
      if ($("plan-difficulty")) $("plan-difficulty").value = String(tp.difficulty);
      if ($("plan-est")) $("plan-est").value = String(tp.estMinutes);
      if ($("plan-core")) $("plan-core").checked = tp.core;
      setIconPicker(tp.icon);
      if ($("plan-name")) $("plan-name").focus();
    });
  }

  function showForm() { var f = $("plan-form"); if (f) f.hidden = false; }
  function hideForm() { var f = $("plan-form"); if (f) f.hidden = true; }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    var prof = S().loadProfile();
    var pet = RF.pet.get();
    if ($("pet-name")) $("pet-name").value = pet.name || "小光";
    if ($("water-goal")) $("water-goal").value = (prof.settings && prof.settings.waterGoalMl) || 2000;
    if ($("focus-minutes")) $("focus-minutes").value = (prof.settings && prof.settings.focusMinutes) || 25;
    if ($("opt-sound")) $("opt-sound").checked = prof.settings && prof.settings.sound !== false;
    if ($("opt-reduce-motion")) $("opt-reduce-motion").checked = !!(prof.settings && prof.settings.reduceMotion);
    if ($("opt-no-note")) $("opt-no-note").checked = !!(prof.settings && prof.settings.noNote);
    if ($("proxy-url")) { try { $("proxy-url").value = RF.storage.getRaw(K().PROXY_URL, ""); } catch (e) {} }
  }

  function bindSettings() {
    function saveSetting(patch) {
      try { S().saveProfile({ settings: Object.assign({}, S().loadProfile().settings, patch) }); } catch (e) {}
    }
    if ($("pet-name")) $("pet-name").addEventListener("change", function () {
      try { S().savePet({ name: $("pet-name").value.trim() || "小光" }); if (RF.fx) RF.fx.toast("精灵改名啦", "success"); } catch (e) {}
    });
    if ($("water-goal")) $("water-goal").addEventListener("change", function () {
      saveSetting({ waterGoalMl: parseInt($("water-goal").value, 10) || 2000 });
    });
    if ($("focus-minutes")) $("focus-minutes").addEventListener("change", function () {
      saveSetting({ focusMinutes: parseInt($("focus-minutes").value, 10) || 25 });
    });
    if ($("opt-sound")) $("opt-sound").addEventListener("change", function () {
      saveSetting({ sound: $("opt-sound").checked });
    });
    if ($("opt-reduce-motion")) $("opt-reduce-motion").addEventListener("change", function () {
      saveSetting({ reduceMotion: $("opt-reduce-motion").checked });
      if (RF.scene && RF.scene.setReduceMotion) RF.scene.setReduceMotion($("opt-reduce-motion").checked);
    });
    if ($("opt-no-note")) $("opt-no-note").addEventListener("change", function () {
      saveSetting({ noNote: $("opt-no-note").checked });
    });
    if ($("proxy-url")) $("proxy-url").addEventListener("change", function () {
      try { RF.storage.setRaw(K().PROXY_URL, $("proxy-url").value.trim()); if (RF.fx) RF.fx.toast("同步代理已更新（仅本机）", "info"); } catch (e) {}
    });
    if ($("pat-input")) $("pat-input").addEventListener("change", function () {
      try { RF.storage.setRaw(K().PAT, $("pat-input").value.trim()); if (RF.fx) RF.fx.toast("PAT 仅存本机，不会上传", "info"); } catch (e) {}
    });
    if ($("sync-now-btn")) $("sync-now-btn").addEventListener("click", function () {
      try {
        if (RF.fx) RF.fx.toast("正在同步…", "info");
        S().syncToRepo().then(function () { refreshLastSync(); if (RF.fx) RF.fx.toast("同步完成 ✅", "success"); });
      } catch (e) { if (RF.fx) RF.fx.toast("同步失败", "error"); }
    });
    if ($("pull-now-btn")) $("pull-now-btn").addEventListener("click", function () {
      try {
        S().pullRepoState().then(function (st) {
          renderPushState(st);
          if (RF.fx) RF.fx.toast("已拉取仓库状态", "success");
        });
      } catch (e) { if (RF.fx) RF.fx.toast("拉取失败", "error"); }
    });
  }

  function refreshLastSync() {
    var el = $("last-sync");
    if (!el) return;
    var t = 0;
    try { t = S().loadLastSync(); } catch (e) {}
    el.textContent = t ? new Date(t).toLocaleString("zh-CN") : "尚未同步";
  }

  /* ---------------- 推送配置 ---------------- */
  function renderPush() {
    var prof = S().loadProfile();
    if ($("lead-minutes")) $("lead-minutes").value = (prof.push && prof.push.leadMinutes) || 30;
    renderSlots(prof);
  }

  function renderSlots(prof) {
    var box = $("slot-list");
    if (!box) return;
    var slots = (prof.push && prof.push.slots) || RF.schema.PUSH_SLOTS;
    var html = "";
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      html += '<div class="g-slot" data-key="' + U().esc(s.key) + '">' +
        '<label class="g-switch"><input type="checkbox" data-slot-toggle="' + U().esc(s.key) + '"' + (s.enabled ? " checked" : "") + "><span>" + U().esc(s.label || s.key) + "</span></label>" +
        '<input type="time" class="g-input" data-slot-time="' + U().esc(s.key) + '" value="' + U().esc(s.target || "08:00") + '">' +
        "</div>";
    }
    box.innerHTML = html;
  }

  function bindPush() {
    if ($("save-push-btn")) $("save-push-btn").addEventListener("click", function () {
      var lead = parseInt($("lead-minutes").value, 10) || 30;
      var slots = [];
      var rows = document.querySelectorAll("#slot-list .g-slot");
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i].getAttribute("data-key");
        var tog = rows[i].querySelector("[data-slot-toggle]");
        var tim = rows[i].querySelector("[data-slot-time]");
        slots.push({ key: key, enabled: !!(tog && tog.checked), target: tim ? tim.value : "08:00", dayOffset: 0 });
      }
      try {
        var prof = S().loadProfile();
        var push = { leadMinutes: lead, slots: slots, calibration: (prof.push && prof.push.calibration) || { avgLateMin: 0, suggestedLead: 30, updatedAt: 0 } };
        S().saveProfile({ push: push });
        if (RF.fx) RF.fx.toast("推送配置已保存并同步", "success");
      } catch (e) { if (RF.fx) RF.fx.toast("保存失败", "error"); }
    });
    if ($("apply-suggest-btn")) $("apply-suggest-btn").addEventListener("click", function () {
      var sug = $("suggested-lead").textContent.replace(/[^\d]/g, "");
      if (sug && $("lead-minutes")) { $("lead-minutes").value = sug; if (RF.fx) RF.fx.toast("已填入建议提前量", "info"); }
    });
    if ($("test-push-btn")) $("test-push-btn").addEventListener("click", function () {
      if (RF.fx) RF.fx.toast("已发送测试推送，请查看钉钉", "info");
      try { if (S().dispatchViaProxy) S().dispatchViaProxy("test-push", { msg: "阳光花园测试推送" }); } catch (e) {}
    });
  }

  function renderPushState(st) {
    if (!st) return;
    var ps = st.pushState;
    if (!ps || !ps.sent) { if ($("avg-late")) $("avg-late").textContent = "暂无数据"; if ($("suggested-lead")) $("suggested-lead").textContent = "—"; return; }
    var keys = Object.keys(ps.sent);
    var recent = keys.slice(-10);
    var sum = 0, n = 0;
    recent.forEach(function (k) { var v = ps.sent[k]; if (v && typeof v.lateSec === "number") { sum += v.lateSec; n++; } });
    var avgMin = n ? Math.round((sum / n) / 60) : 0;
    var lead = parseInt($("lead-minutes").value, 10) || 30;
    var suggested = lead + avgMin;
    if ($("avg-late")) $("avg-late").textContent = n ? "最近 " + n + " 条平均迟到 " + avgMin + " 分钟" : "暂无数据";
    if ($("suggested-lead")) $("suggested-lead").textContent = String(suggested);
  }

  RF.pages = RF.pages || {};
  RF.pages.manage = { init: init };
})(window.RF = window.RF || {});
