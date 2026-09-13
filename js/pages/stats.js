/**
 * js/pages/stats.js —— 花园档案（stats.html）
 * 归属：C 组（T04）。导出 RF.pages.stats.init()。
 *
 * 内容：今日完成度环形 + 12 周热力图 + 连续/最佳 + 段位 + 成就墙 + 周报海报（纯前端 canvas）。
 * 所有用户数据进 innerHTML 前过 RF.util.esc()。canvas 周报不引入任何第三方库。
 */
(function (RF) {
  "use strict";

  function U() { return RF.util; }
  function S() { return RF.store; }

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
    renderRing();
    renderHeatmap();
    renderNumbers();
    renderRank();
    renderAchievements();
    bindPoster();
  }

  function markActiveNav() { if (RF.ui && RF.ui.markActiveNav) RF.ui.markActiveNav(); }

  function renderRing() {
    var slot = $("ring-slot");
    if (!slot) return;
    var plans = [], done = 0;
    try { plans = S().todayPlans(); } catch (e) {}
    for (var i = 0; i < plans.length; i++) { try { if (S().doneToday(plans[i].id)) done++; } catch (e) {} }
    var total = plans.length;
    var ratio = total ? done / total : 0;
    var r = 52, circ = 2 * Math.PI * r;
    var off = circ * (1 - ratio);
    slot.innerHTML =
      '<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="今日完成度">' +
        '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--g-mint-soft)" stroke-width="12"/>' +
        '<circle cx="60" cy="60" r="' + r + '" fill="none" stroke="var(--g-mint-deep)" stroke-width="12" ' +
          'stroke-linecap="round" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" ' +
          'transform="rotate(-90 60 60)"/>' +
        '<text x="60" y="58" text-anchor="middle" class="g-ring__num">' + Math.round(ratio * 100) + '%</text>' +
        '<text x="60" y="76" text-anchor="middle" class="g-ring__sub">' + done + "/" + total + "</text>" +
      "</svg>";
    var note = $("ring-note");
    if (note) note.textContent = total === 0 ? RF.content.get("ui.stats.ring.empty", "今天没有任务，去管理页加几个吧") :
      (done === total ? RF.content.get("ui.stats.ring.perfect", "今日全勤，花园盛开 🌷") : RF.content.get("ui.stats.ring.pending", "还差 {n} 项就全勤").replace("{n}", String(total - done)));
  }

  function renderHeatmap() {
    var slot = $("heatmap-slot");
    if (!slot) return;
    var checks = [];
    try { checks = S().loadCheckins(); } catch (e) {}
    var byDay = {};
    for (var i = 0; i < checks.length; i++) {
      var dk = checks[i].dayKey;
      byDay[dk] = (byDay[dk] || 0) + 1;
    }
    // 最近 12 周（84 天），从今天往前
    var today = U().dayKey();
    var html = '<div class="g-heat">';
    for (var w = 0; w < 12; w++) {
      html += '<div class="g-heat__week">';
      for (var dd = 6; dd >= 0; dd--) {
        var day = U().addDays(today, -((w * 7) + dd));
        var n = byDay[day] || 0;
        var lvl = n === 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 6 ? 3 : 4;
        html += '<span class="g-heat__cell g-heat__cell--l' + lvl + '" title="' + day + "：" + n + ' 次打卡"></span>';
      }
      html += "</div>";
    }
    html += "</div>";
    slot.innerHTML = html;
  }

  function renderNumbers() {
    var s = { current: 0, best: 0 };
    try { s = S().streakInfo(); } catch (e) {}
    var checks = 0, pts = 0, tpts = 0;
    try { checks = S().loadCheckins().length; var pr = S().loadProfile(); pts = pr.points || 0; tpts = pr.totalPoints || 0; } catch (e) {}
    setText("streak-current", String(s.current));
    setText("streak-best", String(s.best));
    setText("total-checkins", String(checks));
    setText("total-points", String(tpts));
    try {
      var pet = RF.pet.get();
      setText("pet-name-label", pet.name || "小光");
      setText("days-together", String(RF.pet.stage().days));
    } catch (e) {}
  }

  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }

  function renderRank() {
    var slot = $("rank-slot");
    if (!slot) return;
    var prof = S().loadProfile();
    var rk = RF.rpg.rank(prof.totalPoints || 0);
    var nextLabel = rk.next ? RF.content.get("ui.stats.rankNext.progress", "距「{name}」还差 {n} 分").replace("{name}", rk.next.name).replace("{n}", String(rk.next.min - (prof.totalPoints || 0))) : RF.content.get("ui.stats.rankNext.maxed", "已是最高段位 🏵");
    slot.innerHTML =
      '<div class="g-rank">' +
        '<div class="g-rank__emoji" aria-hidden="true">' + rk.emoji + "</div>" +
        '<div class="g-rank__main">' +
          '<div class="g-rank__name">' + U().esc(rk.name) + "</div>" +
          RF.ui.progressBar({ value: rk.progress * 100, max: 100, color: "var(--g-lavender-deep)", emoji: "", showNum: false }) +
          '<div class="g-rank__next">' + U().esc(nextLabel) + "</div>" +
        "</div>" +
      "</div>";
  }

  function renderAchievements() {
    var wall = $("achievement-wall");
    if (!wall) return;
    var prof = S().loadProfile();
    var have = {};
    (prof.achievements || []).forEach(function (a) { have[a.id] = true; });
    var html = "";
    for (var i = 0; i < RF.rpg.ACHIEVEMENTS.length; i++) {
      var a = RF.rpg.ACHIEVEMENTS[i];
      var got = !!have[a.id];
      html += '<div class="g-ach' + (got ? " is-got" : "") + '" title="' + U().esc(a.name) + '">' +
        '<span class="g-ach__emoji" aria-hidden="true">' + (got ? a.emoji : "🔒") + "</span>" +
        '<span class="g-ach__name">' + U().esc(a.name) + "</span>" +
        "</div>";
    }
    wall.innerHTML = html;
  }

  function bindPoster() {
    var btn = $("poster-btn");
    var canvas = $("weekly-canvas");
    if (!btn || !canvas) return;
    btn.addEventListener("click", function () {
      try { drawPoster(canvas); } catch (e) { if (RF.fx) RF.fx.toastKey("posterFail", null, "error"); }
    });
  }

  function drawPoster(canvas) {
    var ctx = canvas.getContext("2d");
    var W = canvas.width, H = canvas.height;
    // 背景渐变（天空色）
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#BFEFFF");
    g.addColorStop(1, "#98FB98");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var prof = S().loadProfile();
    var pet = RF.pet.get();
    var s = S().streakInfo();
    var rk = RF.rpg.rank(prof.totalPoints || 0);
    var checks = S().loadCheckins().length;

    ctx.textAlign = "center";
    ctx.fillStyle = "#3a3a4a";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText(RF.content.get("ui.stats.poster.title", "星夜花园 · 周报"), W / 2, 50);

    ctx.font = "64px system-ui, sans-serif";
    ctx.fillText(rk.emoji, W / 2, 130);

    ctx.fillStyle = "#3a3a4a";
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillText(U().esc(pet.name || "小光") + " · " + rk.name, W / 2, 172);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#6b6b80";
    var lines = [
      "连续打卡 " + s.current + " 天 · 最佳 " + s.best + " 天",
      "累计打卡 " + checks + " 次 · 总积分 " + (prof.totalPoints || 0),
      new Date().toLocaleDateString("zh-CN")
    ];
    for (var i = 0; i < lines.length; i++) ctx.fillText(lines[i], W / 2, 210 + i * 28);

    if (RF.fx) RF.fx.toast(RF.content.get("ui.stats.poster.hint", "长按图片可保存周报 📸"), "success");

    // 触发下载
    try {
      var url = canvas.toDataURL("image/png");
      var a = document.createElement("a");
      a.href = url;
      a.download = "星夜花园周报.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) { /* 部分环境禁下载，忽略 */ }
  }

  RF.pages = RF.pages || {};
  RF.pages.stats = { init: init };
})(window.RF = window.RF || {});
