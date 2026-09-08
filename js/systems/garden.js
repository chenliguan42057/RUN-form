/**
 * js/systems/garden.js —— 花朵成长 / 枯萎 / 装饰 / 庆典
 * 归属：B 组（T03）。订阅 bus "checkin:done" → water(planId)。
 */
(function (RF) {
  "use strict";

  var FLOWER_STAGES = RF.content.get("garden.flowerStages", ["🌱 种子", "🌿 发芽", "🌸 花苞", "🌺 初开", "🌻 盛开"]);
  var VARIETY_EMOJI = RF.content.get("garden.varieties", { daisy: "🌼", tulip: "🌷", rose: "🌹", sunflower: "🌻", lily: "🌸", lavender: "💜" });

  function U() { return RF.util; }
  function B() { return RF.bus; }
  function store() { return RF.store; }

  function get() { return store().loadGarden(); }

  /** 每个任务对应一朵花；任务删除则花移除 */
  function syncFlowers(plans) {
    var list = plans || store().loadPlans();
    var g = get();
    var byId = {};
    g.flowers.forEach(function (f) { byId[f.planId] = f; });
    var next = [];
    list.forEach(function (p) {
      if (byId[p.id]) { byId[p.id].planId = p.id; next.push(byId[p.id]); }
      else next.push(RF.schema.defFlower(p.id, { variety: varietyFor(p) }));
    });
    store().saveGarden({ flowers: next });
    return next;
  }

  function varietyFor(plan) {
    var dv = RF.content.get("garden.difficultyVariety", ["daisy", "daisy", "lily", "tulip", "sunflower", "rose"]);
    var d = plan ? plan.difficulty : 3;
    return dv[d] || "daisy";
  }

  function flowerState(planId) {
    var g = get();
    for (var i = 0; i < g.flowers.length; i++) if (g.flowers[i].planId === planId) return g.flowers[i];
    return RF.schema.defFlower(planId);
  }

  function water(planId) {
    var g = get();
    var f = null;
    for (var i = 0; i < g.flowers.length; i++) if (g.flowers[i].planId === planId) { f = g.flowers[i]; break; }
    if (!f) { f = RF.schema.defFlower(planId); g.flowers.push(f); }
    var before = f.stage;
    f.stage = Math.min(4, f.stage + 1);
    f.withered = false;
    f.wateredDay = U().dayKey();
    store().saveGarden({ flowers: g.flowers });
    var bloomed = f.stage >= 4 && before < 4;
    try { B().emit("garden:bloom", { planId: planId, stage: f.stage, bloomed: bloomed }); } catch (e) {}
    return { stage: f.stage, bloomed: bloomed, variety: f.variety };
  }

  function wither(planId) {
    var g = get();
    for (var i = 0; i < g.flowers.length; i++) if (g.flowers[i].planId === planId) g.flowers[i].withered = true;
    store().saveGarden({ flowers: g.flowers });
  }

  function setWitherRatio(ratio) {
    store().saveGarden({ witherRatio: U().clamp(ratio, 0, 1) });
  }
  function witherRatio() { return get().witherRatio; }

  function bloomToday() {
    var t = U().dayKey();
    return get().flowers.some(function (f) { return f.wateredDay === t && !f.withered; });
  }

  function unlocks(streak) {
    var t = RF.content.get("garden.unlockThresholds", { tulip: 7, lily: 14, sunflower: 30, rose: 30, lamp: 7, fence: 14, fountain: 30 });
    var varieties = ["daisy"];
    if (streak >= (t.tulip || 7)) varieties.push("tulip");
    if (streak >= (t.lily || 14)) varieties.push("lily");
    if (streak >= (t.sunflower || 30)) varieties.push("sunflower", "rose");
    var decor = [];
    if (streak >= (t.lamp || 7)) decor.push("lamp");
    if (streak >= (t.fence || 14)) decor.push("fence");
    if (streak >= (t.fountain || 30)) decor.push("fountain");
    var season = RF.content.get("garden.season", "summer");
    var ultimate = streak >= (t.fountain || 30);
    return { varieties: varieties, decor: decor, season: season, ultimate: ultimate };
  }

  function render(container) {
    if (!container) return;
    var g = get();
    if (!g.flowers.length) {
      container.innerHTML = '<p class="u-hint">去「管理」种下第一颗种子，花园就热闹啦。</p>';
      return;
    }
    var html = "";
    g.flowers.forEach(function (f) {
      var plan = findPlan(f.planId);
      var name = plan ? plan.name : "任务";
      var emoji = f.withered ? "🥀" : (VARIETY_EMOJI[f.variety] || "🌼");
      var stageCls = "g-flower--s" + f.stage + (f.withered ? " is-withered" : "");
      html += '<div class="g-flower ' + stageCls + '" title="' + U().esc(name) + '">' +
        '<span class="g-flower__bloom">' + emoji + "</span>" +
        '<span class="g-flower__label">' + U().esc(name) + "</span>" +
        "</div>";
    });
    container.innerHTML = html;
  }

  function celebrate() {
    try { if (RF.fx && RF.fx.petalRain) RF.fx.petalRain(2600); } catch (e) {}
  }

  function findPlan(id) {
    if (!id) return null;
    var plans = store().loadPlans();
    for (var i = 0; i < plans.length; i++) if (plans[i].id === id) return plans[i];
    return null;
  }

  try {
    B().on("checkin:done", function (p) {
      try { if (p && p.planId) { water(p.planId); if (bloomToday() && RF.fx && RF.fx.petalRain) RF.fx.petalRain(1800); } } catch (e) {}
    });
  } catch (e) {}

  RF.garden = {
    FLOWER_STAGES: FLOWER_STAGES,
    get: get, syncFlowers: syncFlowers, flowerState: flowerState, water: water,
    wither: wither, setWitherRatio: setWitherRatio, witherRatio: witherRatio,
    bloomToday: bloomToday, unlocks: unlocks, render: render, celebrate: celebrate
  };
})(window.RF = window.RF || {});
