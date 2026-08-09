/**
 * qa-runtime-tests.js —— v4「星河契约」运行时断言集（QA / Edward 自建）
 *
 * ⚠️ 这是测试脚本，不是站点源文件。发布前可直接删除。
 * ⚠️ 本文件【不能单独 node 执行】：它由 qa-runtime.js 与 store.js / components.js
 *    拼成同一份脚本后在 vm 中运行，因此可以直接引用两者的顶层 const 与 function。
 *
 * 可用桥接：__assert(id, ok, desc, evidence) / __setSection(name) / __reset()
 */

(function runV4Tests() {
  "use strict";

  const A = __assert;
  const S = __setSection;
  const reset = __reset;
  const DAY = 86400000;

  /** 直接写 localStorage 造计划，绕开 addPlan 的随机 id */
  function seedPlans(list) {
    localStorage.setItem(PLAN_KEY, JSON.stringify(list));
  }
  function seedCheckins(list) {
    localStorage.setItem(CHECKIN_KEY, JSON.stringify(list));
  }
  /** 造一个标准计划 */
  function mkPlan(over) {
    return Object.assign(
      {
        id: "p-1",
        name: "跑步",
        freq: "daily",
        time: "08:00",
        day: 0,
        enabled: true,
        icon: "\u2b50",
        color: "gold",
        desc: "",
        createdAt: 1700000000000,
      },
      over || {}
    );
  }
  /** 生成最近 n 天、每天一条的打卡记录 */
  function dailyCheckins(planId, planName, n, source) {
    const out = [];
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      out.push({
        id: "c-" + planId + "-" + i,
        planId: planId,
        planName: planName,
        planIcon: "\u2b50",
        ts: base.getTime() - i * DAY,
        source: source || "manual",
      });
    }
    return out;
  }
  /** 安全执行，返回 {ok, value, err} */
  function tryRun(fn) {
    try {
      return { ok: true, value: fn() };
    } catch (e) {
      return { ok: false, err: e && e.message ? e.message : String(e) };
    }
  }

  // =====================================================================
  S("R1 · 星位确定性（幂等）");
  // =====================================================================
  reset();

  const p1 = planStarPosition("plan-alpha");
  const p1b = planStarPosition("plan-alpha");
  const p2 = planStarPosition("plan-beta");

  A(
    "R1.1",
    Math.abs(p1.x - p1b.x) < 1e-9 && Math.abs(p1.y - p1b.y) < 1e-9,
    "planStarPosition 幂等：同一 id 两次调用结果一致（差 < 1e-9）",
    "x diff=" + Math.abs(p1.x - p1b.x) + " · y diff=" + Math.abs(p1.y - p1b.y) +
      " · pos=(" + p1.x.toFixed(4) + "," + p1.y.toFixed(4) + ")"
  );

  A(
    "R1.2",
    !(Math.abs(p1.x - p2.x) < 1e-9 && Math.abs(p1.y - p2.y) < 1e-9),
    "不同 id 派生出不同星位（不会全叠在一起）",
    "alpha=(" + p1.x.toFixed(2) + "," + p1.y.toFixed(2) + ") beta=(" + p2.x.toFixed(2) + "," + p2.y.toFixed(2) + ")"
  );

  let outOfBounds = 0;
  const spread = new Set();
  for (let i = 0; i < 200; i++) {
    const pos = planStarPosition("probe-" + i);
    if (pos.x < STAR_MARGIN_X || pos.x > 100 - STAR_MARGIN_X) outOfBounds++;
    if (pos.y < STAR_MARGIN_Y || pos.y > 100 - STAR_MARGIN_Y) outOfBounds++;
    spread.add(pos.x.toFixed(3) + "," + pos.y.toFixed(3));
  }
  A(
    "R1.3",
    outOfBounds === 0,
    "200 个 id 的星位全部落在安全边距内（不会贴边被裁）",
    "越界 " + outOfBounds + " 次 · 安全区 x∈[" + STAR_MARGIN_X + "," + (100 - STAR_MARGIN_X) +
      "] y∈[" + STAR_MARGIN_Y + "," + (100 - STAR_MARGIN_Y) + "]"
  );

  A(
    "R1.4",
    spread.size >= 190,
    "200 个 id 的星位散布充分（去重后 ≥ 190 个不同坐标，哈希无明显聚簇）",
    "不同坐标 " + spread.size + "/200"
  );

  const edge = tryRun(() => [planStarPosition(""), planStarPosition(null), planStarPosition(undefined)]);
  A(
    "R1.5",
    edge.ok && edge.value.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)),
    "planStarPosition 对 '' / null / undefined 不崩且返回有限数",
    edge.ok ? JSON.stringify(edge.value[1]) : "抛错：" + edge.err
  );

  // =====================================================================
  S("R2 · 亮度分级");
  // =====================================================================
  reset();

  const offPlan = mkPlan({ id: "off-1", name: "停用星", enabled: false });
  const bOff = planBrightness(offPlan);
  A(
    "R2.1",
    bOff.level === 0 && bOff.score === 0,
    "停用计划亮度 level = 0（熄灭）且 score = 0",
    "level=" + bOff.level + " · score=" + bOff.score
  );

  reset();
  const freshPlan = mkPlan({ id: "fresh-1", name: "新星" });
  seedPlans([freshPlan]);
  const bFresh = planBrightness(freshPlan);
  A(
    "R2.2",
    bFresh.level === 1,
    "启用但无记录的计划保留 level 1 微光（不至于完全看不见）",
    "level=" + bFresh.level + " · score=" + bFresh.score.toFixed(4)
  );

  const levels = [];
  const scores = [];
  const streakDays = [0, 3, 7, 14, 21, 30];
  for (const n of streakDays) {
    reset();
    seedPlans([freshPlan]);
    seedCheckins(dailyCheckins("fresh-1", "新星", n));
    const b = planBrightness(freshPlan);
    levels.push(b.level);
    scores.push(Number(b.score.toFixed(4)));
  }
  A(
    "R2.3",
    levels.every((v, i) => i === 0 || v >= levels[i - 1]),
    "连续天数 0→30 递增时，亮度等级单调不降",
    "streak" + JSON.stringify(streakDays) + " → level " + JSON.stringify(levels) + " · score " + JSON.stringify(scores)
  );

  A(
    "R2.4",
    levels[levels.length - 1] >= 3,
    "连续 30 天可达到高亮档（level ≥ 3）",
    "30 天 → level=" + levels[levels.length - 1] + " · score=" + scores[scores.length - 1]
  );

  A(
    "R2.5",
    levels.every((v) => Number.isInteger(v) && v >= 0 && v <= 4),
    "亮度等级恒为 0~4 的整数",
    "levels=" + JSON.stringify(levels)
  );

  A(
    "R2.6",
    scores.every((s) => s >= 0 && s <= 1.0001),
    "score 恒在 0~1 区间（0.65 连续贡献 + 0.35 完成率贡献）",
    "min=" + Math.min.apply(null, scores) + " max=" + Math.max.apply(null, scores)
  );

  const bEdge = tryRun(() => [planBrightness(null), planBrightness(undefined), planBrightness({})]);
  A(
    "R2.7",
    bEdge.ok && bEdge.value.every((b) => Number.isFinite(b.score) && b.level >= 0 && b.level <= 4),
    "planBrightness 对 null / undefined / {} 不崩且返回合法等级",
    bEdge.ok ? "levels=" + JSON.stringify(bEdge.value.map((b) => b.level)) : "抛错：" + bEdge.err
  );

  // 分档阈值边界：score 恰好等于阈值时应落进上一档
  A(
    "R2.8",
    STAR_LEVEL_STEPS.length === 4 && STAR_LEVEL_STEPS.every((v, i) => i === 0 || v < STAR_LEVEL_STEPS[i - 1]),
    "亮度阈值 STAR_LEVEL_STEPS 严格递减（分档不会互相遮蔽）",
    "STAR_LEVEL_STEPS=" + JSON.stringify(STAR_LEVEL_STEPS)
  );

  // =====================================================================
  S("R3 · 星图构建");
  // =====================================================================
  reset();

  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push(mkPlan({ id: "star-" + i, name: "计划" + i, enabled: i % 5 !== 0, createdAt: 1700000000000 + i * 1000 }));
  }
  seedPlans(many);

  const map1 = buildStarMap();
  const map2 = buildStarMap();

  A("R3.1", map1.stars.length === 12 && map1.total === 12,
    "buildStarMap 为 12 个计划各生成一颗星",
    "stars=" + map1.stars.length + " · total=" + map1.total);

  const sameCoords = map1.stars.every(
    (s, i) => Math.abs(s.x - map2.stars[i].x) < 1e-9 && Math.abs(s.y - map2.stars[i].y) < 1e-9
  );
  A("R3.2", sameCoords,
    "两次 buildStarMap 星位完全一致（含 30 轮松弛迭代，刷新不跳动）",
    sameCoords ? "12 颗星坐标逐一相等（差 < 1e-9）" : "存在坐标漂移");

  const expectLit = many.filter((p) => p.enabled).length;
  A("R3.3", map1.lit === expectLit && map1.dim === 12 - expectLit,
    "lit / dim 统计与 enabled 状态一致",
    "lit=" + map1.lit + "（期望 " + expectLit + "）· dim=" + map1.dim);

  A("R3.4", map1.links.length === 11,
    "星座连线数 = 星数 - 1（按 createdAt 相邻相连）",
    "links=" + map1.links.length);

  const inBounds = map1.stars.every(
    (s) =>
      s.x >= STAR_MARGIN_X - 1e-6 && s.x <= 100 - STAR_MARGIN_X + 1e-6 &&
      s.y >= STAR_MARGIN_Y - 1e-6 && s.y <= 100 - STAR_MARGIN_Y + 1e-6
  );
  A("R3.5", inBounds, "松弛推挤后所有星仍被夹在安全区内", inBounds ? "12 颗星均在安全区" : "有星被推出画布");

  const offStars = map1.stars.filter((s) => !s.enabled);
  A("R3.6", offStars.length > 0 && offStars.every((s) => s.level === 0),
    "停用的星在星图中 level = 0（熄灭但不消失，仍在 stars 里）",
    "停用 " + offStars.length + " 颗 · level=" + JSON.stringify(offStars.map((s) => s.level)));

  // 连线端点必须与星点坐标一致（松弛后没有用旧坐标）
  const byId = new Map(map1.stars.map((s) => [s.id, s]));
  const linkOk = map1.links.every((l) => {
    const a = byId.get(l.from), b = byId.get(l.to);
    return a && b && Math.abs(a.x - l.x1) < 1e-9 && Math.abs(a.y - l.y1) < 1e-9 &&
           Math.abs(b.x - l.x2) < 1e-9 && Math.abs(b.y - l.y2) < 1e-9;
  });
  A("R3.7", linkOk,
    "连线端点坐标与松弛后的星点坐标一致（连线不会飘在星外）",
    linkOk ? "11 条连线端点全部对齐" : "存在连线端点与星点不一致");

  reset();
  const emptyMap = buildStarMap();
  A("R3.8", emptyMap.total === 0 && emptyMap.stars.length === 0 && emptyMap.links.length === 0,
    "无计划时 buildStarMap 返回空星图而非报错",
    JSON.stringify({ total: emptyMap.total, stars: emptyMap.stars.length, links: emptyMap.links.length }));

  // 极端：5 个 id 完全相同的计划，除零保护必须生效
  reset();
  const dupes = [];
  for (let i = 0; i < 5; i++) dupes.push(mkPlan({ id: "dup", name: "重复", createdAt: 1700000000000 }));
  seedPlans(dupes);
  const dupMap = buildStarMap();
  let overlapping = 0;
  for (let i = 0; i < dupMap.stars.length; i++) {
    for (let j = i + 1; j < dupMap.stars.length; j++) {
      const a = dupMap.stars[i], b = dupMap.stars[j];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) overlapping++;
    }
  }
  A("R3.9", overlapping === 0 && dupMap.stars.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)),
    "5 个 id 完全相同的计划经松弛后不再完全重合，且坐标无 NaN（除零保护生效）",
    "完全重合对数=" + overlapping + " · 坐标=" + JSON.stringify(dupMap.stars.map((s) => s.x.toFixed(1) + "," + s.y.toFixed(1))));

  // 传入自定义 planList 时不读 localStorage
  reset();
  const injected = buildStarMap([mkPlan({ id: "inj-1", name: "注入" })]);
  A("R3.10", injected.total === 1 && injected.stars[0].name === "注入",
    "buildStarMap(planList) 支持外部传参（不依赖 localStorage）",
    "total=" + injected.total + " · name=" + injected.stars[0].name);

  // =====================================================================
  S("R4 · XSS 转义（v4 渲染器内部转义契约）");
  // =====================================================================
  reset();

  const XSS = '<img src=x onerror=alert(1)>';
  const XSS2 = '"><' + 'script>alert(2)</' + 'script>';
  seedPlans([mkPlan({ id: "xss-1", name: XSS, icon: XSS2, desc: XSS2 })]);
  const xssMap = buildStarMap();
  const xssHtml = uiStarMap(xssMap, { links: true });

  A("R4.1", xssHtml.indexOf("<img") === -1 && xssHtml.indexOf("<script") === -1,
    "uiStarMap 渲染恶意计划名 / 图标 / 描述时不产生可执行标签",
    "含<img=" + (xssHtml.indexOf("<img") !== -1) + " · 含<script=" + (xssHtml.indexOf("<script") !== -1));

  A("R4.2", xssHtml.indexOf("&lt;img") !== -1,
    "恶意内容被 escapeHtml 转义为 HTML 实体（&lt;img）",
    xssHtml.indexOf("&lt;img") !== -1 ? "已转义为实体" : "未见转义实体");

  const tipMatch = /data-tip="([^"]*)"/.exec(xssHtml);
  A("R4.3", tipMatch !== null && tipMatch[1].indexOf('"') === -1,
    "data-tip 属性值内无裸双引号（不会截断属性造成注入）",
    tipMatch ? tipMatch[1].slice(0, 70) : "未匹配到 data-tip");

  const briefHtml = uiStarBrief(xssMap.stars[0]);
  A("R4.4", briefHtml.indexOf("<img") === -1 && briefHtml.indexOf("<script") === -1,
    "uiStarBrief 同样完成内部转义",
    "含<img=" + (briefHtml.indexOf("<img") !== -1) + " · 含<script=" + (briefHtml.indexOf("<script") !== -1));

  const metaHtml = uiSkyMeta(xssMap);
  A("R4.5", metaHtml.indexOf("<script") === -1 && /sky-meta/.test(metaHtml),
    "uiSkyMeta 输出结构正常且无注入",
    metaHtml.slice(0, 80));

  // aria-label 同样不能被截断
  const ariaMatch = /aria-label="([^"]*)"/.exec(xssHtml);
  A("R4.6", ariaMatch !== null && ariaMatch[1].indexOf('"') === -1,
    "aria-label 属性值内无裸双引号",
    ariaMatch ? ariaMatch[1].slice(0, 70) : "未匹配到 aria-label");

  // =====================================================================
  S("R5 · v4 渲染器健壮性");
  // =====================================================================
  reset();

  const badOutputs = [];
  function checkHtml(name, produce) {
    const r = tryRun(produce);
    if (!r.ok) { badOutputs.push(name + " 抛错:" + r.err); return; }
    const html = r.value;
    if (typeof html !== "string" || html.length === 0) { badOutputs.push(name + ":空输出"); return; }
    if (/undefined|NaN/.test(html)) badOutputs.push(name + ":含 undefined/NaN");
  }

  checkHtml("uiMoonPhase(0)", () => uiMoonPhase(0));
  checkHtml("uiMoonPhase(0.5)", () => uiMoonPhase(0.5));
  checkHtml("uiMoonPhase(1)", () => uiMoonPhase(1));
  checkHtml("uiMoonPhase(null)", () => uiMoonPhase(null));
  checkHtml("uiMoonPhase(-5)", () => uiMoonPhase(-5));
  checkHtml("uiMoonPhase(99)", () => uiMoonPhase(99));
  checkHtml("uiComet(0)", () => uiComet(0));
  checkHtml("uiComet(7)", () => uiComet(7));
  checkHtml("uiComet(99)", () => uiComet(99));
  checkHtml("uiComet(null)", () => uiComet(null));
  checkHtml("uiSkyMeta(null)", () => uiSkyMeta(null));
  checkHtml("uiStarMap(null)", () => uiStarMap(null));
  checkHtml("uiStarMap({stars:[]})", () => uiStarMap({ stars: [] }));
  checkHtml("uiStarBrief(null)", () => uiStarBrief(null));
  checkHtml("uiStarTrack([])", () => uiStarTrack([]));
  checkHtml("uiBrightBars([])", () => uiBrightBars([]));
  checkHtml("uiCheer(milestoneCheer())", () => uiCheer(milestoneCheer()));
  checkHtml("uiMonthGrid(2026-08)", () => uiMonthGrid(buildMonthGrid(2026, 7)));
  checkHtml("uiStarHeatmap(84d)", () => uiStarHeatmap(buildHeatmap(84)));
  checkHtml("uiSkyQuote(quote)", () => uiSkyQuote(randomQuote(1)));
  checkHtml("uiSkyEmpty()", () => uiSkyEmpty());

  A("R5.1", badOutputs.length === 0,
    "21 组 v4 渲染器调用（含 null / 越界 / 空数组入参）输出非空且不含 undefined / NaN",
    badOutputs.length ? badOutputs.join(" ;; ") : "全部正常");

  const moonHtml = uiMoonPhase(0.37);
  A("R5.2", /d="M [\d.]+ [\d.-]+ A [\d.]+ [\d.]+ 0 0 [01] [\d.]+ [\d.-]+ A/.test(moonHtml) && moonHtml.indexOf("NaN") === -1,
    "月相亮面 path 的 d 属性为合法 SVG 弧线指令（无 NaN）",
    ((/<path class="moon-lit" d="([^"]{0,80})/.exec(moonHtml) || [])[1] || "未匹配") + "…");

  const newMoon = uiMoonPhase(0);
  const fullMoon = uiMoonPhase(1);
  const halfMoon = uiMoonPhase(0.5);
  A("R5.3", /新月/.test(newMoon) && /满月/.test(fullMoon) && /上弦月/.test(halfMoon),
    "月相命名分档正确：0% = 新月，50% = 上弦月，100% = 满月",
    "0%→" + ((/moon-label-sub">([^<]*)/.exec(newMoon) || [])[1]) +
      " · 50%→" + ((/moon-label-sub">([^<]*)/.exec(halfMoon) || [])[1]) +
      " · 100%→" + ((/moon-label-sub">([^<]*)/.exec(fullMoon) || [])[1]));

  const m1 = uiMoonPhase(0.3), m2 = uiMoonPhase(0.6);
  const gid1 = (/id="(moongrad-\d+)"/.exec(m1) || [])[1];
  const gid2 = (/id="(moongrad-\d+)"/.exec(m2) || [])[1];
  A("R5.4", gid1 && gid2 && gid1 !== gid2,
    "同页多次调用 uiMoonPhase，SVG 渐变 id 互不冲突（uiUid 自增）",
    gid1 + " vs " + gid2);

  // 彗尾长度随连续天数增长
  const c0 = uiComet(0), c21 = uiComet(21);
  A("R5.5", /is-idle/.test(c0) && !/is-idle/.test(c21),
    "彗星 0 天为 is-idle（还没启程），21 天为活跃彗尾",
    "streak0 含 is-idle=" + /is-idle/.test(c0) + " · streak21 含 is-idle=" + /is-idle/.test(c21));

  // 星图空态带 CTA
  const emptyHtml = uiStarMap({ stars: [] });
  A("R5.6", /data-act="new-star"/.test(emptyHtml) && /sky-empty/.test(emptyHtml),
    "空星图渲染出「缔结第一颗星」引导按钮（data-act=new-star）",
    emptyHtml.slice(0, 100));

  // =====================================================================
  S("R6 · 月历星图（星历）");
  // =====================================================================
  reset();

  const grid = buildMonthGrid(2026, 7); // 2026 年 8 月
  A("R6.1", grid.cells.length % 7 === 0 && grid.cells.length >= 28,
    "buildMonthGrid 返回整周对齐的格子数（能被 7 整除）",
    "cells=" + grid.cells.length + " · label=" + grid.label);

  const firstDate = new Date(grid.cells[0].date + "T00:00:00");
  A("R6.2", firstDate.getDay() === 1,
    "月历第一列是周一（与 Python 口径 pyWeekday 一致，和提醒脚本同源）",
    "首格 " + grid.cells[0].date + " 的 getDay()=" + firstDate.getDay() + "（1=周一）");

  A("R6.3", grid.days === 31 && grid.label === "2026 年 8 月",
    "2026 年 8 月天数 = 31，标签正确",
    "days=" + grid.days + " · label=" + grid.label);

  A("R6.4", grid.cells.filter((c) => c.inMonth).length === 31,
    "inMonth 标记的格子数 = 当月天数",
    "inMonth=" + grid.cells.filter((c) => c.inMonth).length);

  A("R6.5", grid.cells.every((c) => c.level >= 0 && c.level <= HEATMAP_LEVELS.length - 1),
    "所有格子 level 都在热力图分档范围内（与 uiHeatmap 口径统一）",
    "HEATMAP_LEVELS=" + JSON.stringify(HEATMAP_LEVELS));

  const dec = buildMonthGrid(2026, 11);
  const jan = buildMonthGrid(2027, 0);
  A("R6.6", dec.days === 31 && jan.days === 31 && jan.label === "2027 年 1 月",
    "跨年月份（2026-12 / 2027-01）计算正确",
    dec.label + " / " + jan.label);

  A("R6.7", buildMonthGrid(2028, 1).days === 29 && buildMonthGrid(2027, 1).days === 28,
    "闰年判断正确：2028-02 = 29 天，2027-02 = 28 天",
    "2028=" + buildMonthGrid(2028, 1).days + " · 2027=" + buildMonthGrid(2027, 1).days);

  const gridDefault = buildMonthGrid(undefined, undefined);
  A("R6.8", gridDefault && gridDefault.cells.length % 7 === 0,
    "buildMonthGrid 无参调用回落到当月且结构正常",
    "label=" + gridDefault.label);

  // =====================================================================
  S("R7 · v3 契约回归");
  // =====================================================================
  reset();

  A("R7.1",
    PLAN_KEY === "runform_plans" && CHECKIN_KEY === "runform_checkins" &&
    TOKEN_KEY === "runform_pat" && PREFS_KEY === "runform_prefs",
    "localStorage 键名与 v3 完全一致（老用户数据不丢）",
    [PLAN_KEY, CHECKIN_KEY, TOKEN_KEY, PREFS_KEY].join(" / "));

  // Plan 模型字段（运行时以 Object.keys 为准）
  reset();
  const created = addPlan({ name: "跑步", freq: "weekly", time: "07:30", day: 2, icon: "\ud83c\udfc3", desc: "五公里" });
  const planKeys = Object.keys(created).sort();
  const wantPlanKeys = ["color", "createdAt", "day", "desc", "enabled", "freq", "icon", "id", "name", "time"];
  A("R7.2", JSON.stringify(planKeys) === JSON.stringify(wantPlanKeys),
    "addPlan 产出的 Plan 模型字段与 v3 一致（10 字段，无增删）",
    "实际=" + JSON.stringify(planKeys));

  A("R7.3", created.freq === "weekly" && created.day === 2 && created.time === "07:30",
    "Plan 的 freq / day / time 透传正确（day=2 即周三，Python 口径）",
    JSON.stringify({ freq: created.freq, day: created.day, time: created.time }));

  // Checkin 模型
  const ck = addCheckin(created.id, created.name);
  const ckKeys = Object.keys(ck).sort();
  A("R7.4", ckKeys.indexOf("id") >= 0 && ckKeys.indexOf("planId") >= 0 &&
            ckKeys.indexOf("planName") >= 0 && ckKeys.indexOf("ts") >= 0 && ckKeys.indexOf("source") >= 0,
    "addCheckin 产出的 Checkin 模型含 id/planId/planName/ts/source",
    "实际=" + JSON.stringify(ckKeys));

  // v3 计算函数仍可调用且返回合理
  const v3Calls = [
    ["computeStreak", () => computeStreak(created.id)],
    ["buildHeatmap", () => buildHeatmap(84)],
    ["nextReminder", () => nextReminder(created, Date.now())],
    ["overviewStats", () => overviewStats()],
    ["globalStreak", () => globalStreak()],
    ["completionRate", () => completionRate(created.id, 30)],
    ["dailyTrend", () => dailyTrend(30)],
    ["milestones", () => milestones()],
    ["todayPlans", () => todayPlans()],
    ["describePlan", () => describePlan(created)],
    ["reminderStatus", () => reminderStatus()],
    ["buildActivityMap", () => buildActivityMap({})],
    ["exportData", () => exportData()],
  ];
  const v3Fail = [];
  for (const [name, fn] of v3Calls) {
    const r = tryRun(fn);
    if (!r.ok) v3Fail.push(name + " 抛错:" + r.err);
    else if (r.value === undefined || r.value === null) v3Fail.push(name + " 返回 null/undefined");
  }
  A("R7.5", v3Fail.length === 0,
    "13 个 v3 计算函数全部可调用且返回非空（v4 未破坏 v3 计算层）",
    v3Fail.length ? v3Fail.join(" ;; ") : "13/13 正常");

  // ⚠️ QA 修正记录（Edward）：初版误断言 randomQuote 返回 object。
  //    实际契约是返回【字符串】（store.js JSDoc @returns {string}，
  //    且 app.js:97 用法为 uiSkyQuote(randomQuote(dateKey(now)))）。属测试代码 Bug，已改正。
  A("R7.6",
    Array.isArray(VAN_GOGH_QUOTES) && VAN_GOGH_QUOTES.length > 0 &&
      typeof randomQuote("seed") === "string" && randomQuote("seed").length > 0 &&
      randomQuote("seed") === randomQuote("seed"),
    "VAN_GOGH_QUOTES 保留，randomQuote(seed) 返回字符串且同 seed 恒定",
    "quotes=" + VAN_GOGH_QUOTES.length + " 条 · typeof=" + typeof randomQuote("seed") +
      " · 同 seed 一致=" + (randomQuote("seed") === randomQuote("seed")));

  // nextReminder 的 Python 星期口径：day=2 应落在周三
  const nr = nextReminder(mkPlan({ id: "w-1", freq: "weekly", day: 2, time: "07:30" }), Date.now());
  const nrDate = nr && nr.ts ? new Date(nr.ts) : null;
  A("R7.7", nrDate !== null && nrDate.getDay() === 3,
    "nextReminder 星期口径未变：day=2（Python 周三）→ JS getDay()=3",
    nrDate ? nrDate.toString().slice(0, 24) + " · getDay=" + nrDate.getDay() : "无返回");

  // computeStreak 真实连续天数
  reset();
  const sp = mkPlan({ id: "streak-1", name: "连续测试" });
  seedPlans([sp]);
  seedCheckins(dailyCheckins("streak-1", "连续测试", 5));
  const st = computeStreak("streak-1");
  A("R7.8", st.current === 5,
    "computeStreak 对连续 5 天记录返回 current = 5（v3 算法未被改坏）",
    JSON.stringify({ current: st.current, best: st.best, unit: st.unit }));

  // 导出 / 导入往返
  reset();
  const rp = addPlan({ name: "往返测试", freq: "daily", time: "09:00", icon: "\ud83c\udf1f", desc: "roundtrip" });
  addCheckin(rp.id, rp.name);
  const dump = exportData();
  reset();
  const imported = tryRun(() => importData(dump, { merge: false }));
  A("R7.9", imported.ok && loadPlans().length === 1 && loadPlans()[0].name === "往返测试" && loadCheckins().length === 1,
    "exportData → importData 往返后计划与台账完整还原",
    imported.ok ? "plans=" + loadPlans().length + " checkins=" + loadCheckins().length +
      " name=" + loadPlans()[0].name : "抛错：" + imported.err);

  // 导出内容不得含 Token
  reset();
  safeSetItem(TOKEN_KEY, "ghp_SHOULD_NOT_LEAK_1234567890");
  addPlan({ name: "带 token 测试" });
  const dump2 = exportData();
  A("R7.10", dump2.indexOf("ghp_SHOULD_NOT_LEAK") === -1 && dump2.indexOf("runform_pat") === -1,
    "exportData 不含 Personal Access Token（安全契约）",
    "备份体积 " + dump2.length + " 字节 · 含 token=" + (dump2.indexOf("ghp_SHOULD_NOT_LEAK") !== -1));

  // 读时迁移：v2 老数据（缺 icon/color/desc/createdAt）应被补全
  reset();
  seedPlans([{ id: "legacy-1", name: "老计划", freq: "daily", time: "08:00", day: 0, enabled: true }]);
  const migrated = loadPlans()[0];
  A("R7.11",
    migrated.icon === "\ud83c\udf1f" && typeof migrated.color === "string" && migrated.color.length > 0 &&
    migrated.desc === "" && Number.isFinite(migrated.createdAt) && migrated.createdAt > 0,
    "v2 老数据读时迁移：icon / color / desc / createdAt 自动补全（老用户不白屏）",
    JSON.stringify({ icon: migrated.icon, color: migrated.color, desc: migrated.desc, createdAt: migrated.createdAt > 0 }));

  // 迁移后颜色稳定（同 id 两次 loadPlans 颜色一致）
  const c1 = loadPlans()[0].color;
  const c2 = loadPlans()[0].color;
  A("R7.12", c1 === c2,
    "老计划自动分配的配色由 id 哈希派生，多次读取保持稳定",
    "两次读取 color=" + c1 + " / " + c2);

  // =====================================================================
  S("R8 · 时段旁白与里程碑");
  // =====================================================================
  reset();

  const poemMiss = [];
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 7, 6, h, 0, 0);
    const t = skyPoem(d);
    if (typeof t !== "string" || t.length === 0) poemMiss.push(h);
  }
  A("R8.1", poemMiss.length === 0,
    "skyPoem 覆盖 0~23 全部整点（含跨零点区间 22~4），无空文案",
    poemMiss.length ? "缺失小时：" + poemMiss.join(",") : "24/24 均有旁白 · 例：" + skyPoem(new Date(2026, 7, 6, 23)));

  A("R8.2", typeof skyPoem() === "string" && skyPoem().length > 0,
    "skyPoem 无参调用回落到当前时间且返回非空",
    skyPoem());

  reset();
  const cheer0 = milestoneCheer();
  A("R8.3", cheer0 && cheer0.unlocked === false && /再坚持/.test(cheer0.text),
    "无记录时 milestoneCheer 返回「还差多少天」的鼓励文案",
    JSON.stringify(cheer0.text));

  reset();
  const mp = mkPlan({ id: "ms-1", name: "里程碑" });
  seedPlans([mp]);
  seedCheckins(dailyCheckins("ms-1", "里程碑", 10));
  const cheer1 = milestoneCheer();
  A("R8.4", cheer1 && cheer1.unlocked === true && typeof cheer1.text === "string" && cheer1.text.length > 0,
    "连续 10 天后 milestoneCheer 解锁并返回祝贺语",
    JSON.stringify(cheer1.text));

  A("R8.5", typeof EMPTY_SKY_LINE === "string" && EMPTY_SKY_LINE.length > 0 &&
            Array.isArray(SKY_POEMS) && SKY_POEMS.length === 6,
    "v4 文案常量 EMPTY_SKY_LINE / SKY_POEMS 就位",
    "SKY_POEMS=" + SKY_POEMS.length + " 条 · 空态：" + EMPTY_SKY_LINE);

  // =====================================================================
  S("R9 · 减弱动效运行时契约");
  // =====================================================================
  reset();

  A("R9.1", typeof PREFERS_REDUCED === "boolean" && typeof uiMotionOff === "function",
    "PREFERS_REDUCED 与 uiMotionOff() 存在（动效统一开关入口）",
    "PREFERS_REDUCED=" + PREFERS_REDUCED);

  document.documentElement.classList.remove("no-motion");
  const offBefore = uiMotionOff();
  document.documentElement.classList.add("no-motion");
  const offAfter = uiMotionOff();
  document.documentElement.classList.remove("no-motion");
  A("R9.2", offBefore === false && offAfter === true,
    "uiMotionOff() 正确响应 <html class=\"no-motion\"> 手动开关",
    "无 no-motion→" + offBefore + " · 加 no-motion→" + offAfter);

  // 渲染器不得内联写 animation（动效必须由 CSS 统一控制）
  const renderedSamples = [
    uiStarMap(buildStarMap([mkPlan({ id: "m-1" })])),
    uiMoonPhase(0.5),
    uiComet(7),
    uiStarBrief(null),
  ].join("");
  A("R9.3", !/style="[^"]*animation/i.test(renderedSamples),
    "v4 渲染器输出的 style 内联样式不含 animation（降级开关一处生效）",
    /style="[^"]*animation/i.test(renderedSamples) ? "检出内联 animation" : "无内联 animation");

  // 闪烁相位以 CSS 变量下发，而非内联 animation
  const starHtml = uiStarMap(buildStarMap([mkPlan({ id: "m-2" })]));
  A("R9.4", /--tw-delay:\d+ms/.test(starHtml) && /--tw-period:\d+ms/.test(starHtml),
    "星点闪烁相位通过 CSS 变量 --tw-delay / --tw-period 下发（可被 no-motion 统一关掉）",
    (/--tw-delay:\d+ms;--tw-period:\d+ms/.exec(starHtml) || ["未匹配"])[0]);

  // =====================================================================
  S("R10 · 偏好与跨页一致性");
  // =====================================================================
  reset();

  const defPrefs = loadPrefs();
  A("R10.1", defPrefs && typeof defPrefs.showManualCheckin === "boolean" &&
             typeof defPrefs.heatmapSource === "string" && typeof defPrefs.reduceMotion === "boolean",
    "loadPrefs 返回完整默认偏好（showManualCheckin / heatmapSource / reduceMotion）",
    JSON.stringify(defPrefs));

  const saved = savePrefs({ reduceMotion: true });
  A("R10.2", saved.reduceMotion === true && loadPrefs().reduceMotion === true,
    "savePrefs 写入的 reduceMotion 可被 loadPrefs 读回（跨页生效）",
    JSON.stringify(loadPrefs()));

  // ⚠️ QA 修正记录（Edward）：初版断言「savePrefs 写入时校验」，但那并非既定契约。
  //    v3 的真实设计是【读时净化】—— loadPrefs() 用白名单过滤 heatmapSource，
  //    非法值即便被写进 localStorage，也永远不会流到下游统计口径。
  //    这属于测试代码 Bug（凭空发明需求），已改为断言真实契约。
  savePrefs({ heatmapSource: "not-a-valid-source" });
  const sanitized = loadPrefs().heatmapSource;
  A("R10.3", ["all", "auto", "manual"].indexOf(sanitized) >= 0 && sanitized === "all",
    "非法 heatmapSource 被 loadPrefs 读时净化为默认 all（下游统计口径不被污染）",
    "写入 not-a-valid-source → loadPrefs 读回 " + sanitized);

  // 手工篡改 localStorage 也不能污染口径
  localStorage.setItem(PREFS_KEY, '{"heatmapSource":"../../etc/passwd","showManualCheckin":"yes"}');
  const tampered = loadPrefs();
  A("R10.6",
    tampered.heatmapSource === "all" && typeof tampered.showManualCheckin === "boolean",
    "直接篡改 localStorage 的偏好也会被 loadPrefs 净化（类型与白名单双重兜底）",
    JSON.stringify(tampered));

  localStorage.setItem(PREFS_KEY, "{ 这不是合法 JSON");
  const broken = tryRun(() => loadPrefs());
  A("R10.7",
    broken.ok && broken.value.heatmapSource === "all",
    "偏好 JSON 损坏时 loadPrefs 回退默认值而非抛错（页面不白屏）",
    broken.ok ? JSON.stringify(broken.value) : "抛错：" + broken.err);

  // themeOf 对星对象与计划对象都稳定
  reset();
  const themePlan = mkPlan({ id: "t-1", color: "" });
  const t1 = themeOf(themePlan);
  const t2 = themeOf(themePlan);
  A("R10.4", t1 && t1.key && t1.key === t2.key,
    "themeOf 对未指定配色的计划按 id 哈希稳定派生（不跳色）",
    "key=" + t1.key);

  const t3 = themeOf(mkPlan({ id: "t-2", color: "teal" }));
  A("R10.5", t3.key === "teal",
    "themeOf 尊重用户显式选择的配色",
    "指定 teal → " + t3.key);
})();
