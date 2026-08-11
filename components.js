/**
 * 星河自律 · RUN-form v3 —— 共享 UI 组件层（components.js）
 *
 * 加载顺序固定：store.js → components.js → appN.js
 *
 * 契约（不可违背）：
 * - 所有导出函数以 `ui` 前缀命名；
 * - 纯函数为主：入参 → 返回 HTML / SVG 字符串；少数以 `ui` 开头的挂载型函数直接操作 DOM；
 * - **不读 localStorage、不调用 store 的 load\* **，只消费调用方算好的数据；
 * - ⚠️ 本文件【禁止】声明 `const $`（页面脚本 app.js / app2.js / app3.js 已占用该名，
 *   重复声明会触发 "already declared" 直接白屏），一律用 document.querySelector；
 * - ⚠️ 所有 ui* 函数在【内部】完成 escapeHtml 转义，调用方传原始数据即可。
 */

/**
 * 系统级「减少动效」偏好。所有动画函数必须先查它。
 * @type {boolean}
 */
const PREFERS_REDUCED =
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 运行时判断动效是否应当关闭：系统偏好 或 用户在管理页手动关掉（<html class="no-motion">）。
 * @returns {boolean} true 表示应当关闭动效
 */
function uiMotionOff() {
  return (
    PREFERS_REDUCED || document.documentElement.classList.contains("no-motion")
  );
}

/**
 * 把数值钳制到 [min, max]。
 * @param {number} v 输入值
 * @param {number} min 下界
 * @param {number} max 上界
 * @returns {number}
 */
function uiClamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ============================ 导航与背景 ============================

/**
 * 生成三页顶部胶囊导航 HTML。
 * @param {'home'|'manage'|'stats'} active 当前页
 * @returns {string} HTML 字符串
 */
function uiNav(active) {
  const items = [
    { key: "home", href: "index.html", icon: "🔭", label: "天文台" },
    { key: "manage", href: "manage.html", icon: "✦", label: "星图" },
    { key: "stats", href: "stats.html", icon: "🌠", label: "星历" },
  ];
  const links = items
    .map((it) => {
      const cls = "nav-item" + (it.key === active ? " is-active" : "");
      return (
        `<a class="${cls}" href="${escapeHtml(it.href)}">` +
        `<span class="nav-icon" aria-hidden="true">${escapeHtml(it.icon)}</span>` +
        `<span class="nav-text">${escapeHtml(it.label)}</span></a>`
      );
    })
    .join("");
  return `<nav class="nav" aria-label="主导航">${links}</nav>`;
}

/**
 * 向容器注入 3 层星空（不同密度 / 速度做视差）。同一容器只注入一次。
 * 星点位置用固定种子伪随机生成，保证每次刷新星图一致，不会跳变。
 * @param {Element} container 容器节点（通常是 document.body）
 * @returns {void}
 */
function uiStarfield(container) {
  const host = container || document.body;
  if (!host || host.querySelector(".starfield")) return;

  /**
   * 固定种子的线性同余伪随机数发生器。
   * @param {number} seed 种子
   * @returns {function(): number} 返回 [0,1) 的随机数
   */
  const makeRandom = (seed) => {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  const layers = [
    { cls: "starfield-1", seed: 20260806, count: 90, size: 1.4, alpha: 0.9 },
    { cls: "starfield-2", seed: 19890729, count: 60, size: 2.0, alpha: 0.7 },
    { cls: "starfield-3", seed: 18531230, count: 34, size: 2.8, alpha: 0.55 },
  ];

  const frag = document.createDocumentFragment();
  layers.forEach((layer) => {
    const rand = makeRandom(layer.seed);
    const shadows = [];
    for (let i = 0; i < layer.count; i++) {
      const x = (rand() * 100).toFixed(3);
      const y = (rand() * 100).toFixed(3);
      // 用 background-image 多重 radial-gradient 铺点，避免创建上百个 DOM 节点
      shadows.push(
        `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,${layer.alpha}) 0, rgba(255,255,255,0) ${layer.size}px)`
      );
    }
    const el = document.createElement("div");
    el.className = `starfield ${layer.cls}`;
    el.setAttribute("aria-hidden", "true");
    el.style.backgroundImage = shadows.join(",");
    frag.appendChild(el);
  });

  host.insertBefore(frag, host.firstChild);
}

// ============================ 图形组件 ============================

/**
 * 生成进度环 SVG。
 * 动效开启时先渲染成「空环」并把终态写进 data-target，由 uiRevealOnLoad 触发填充；
 * 动效关闭时直接渲染终态。
 * @param {{percent:number, size?:number, stroke?:number, theme?:string,
 *          label?:string, sub?:string, id?:string}} opts 配置
 * @returns {string} SVG HTML 字符串
 */
function uiRing(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const percent = uiClamp(o.percent, 0, 1);
  const size = Number(o.size) > 0 ? Number(o.size) : 120;
  const stroke = Number(o.stroke) > 0 ? Number(o.stroke) : 10;
  const themeKey = typeof o.theme === "string" && o.theme ? o.theme : "gold";
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = c * (1 - percent);
  const initial = uiMotionOff() ? target : c;
  const gradId = `ring-grad-${themeKey}-${Math.round(size)}-${Math.round(percent * 1000)}`;

  const label = o.label === undefined || o.label === null ? "" : String(o.label);
  const sub = o.sub === undefined || o.sub === null ? "" : String(o.sub);

  const labelHtml = label
    ? `<div class="ring-label"><span class="ring-label-main">${escapeHtml(label)}</span>` +
      (sub ? `<span class="ring-label-sub">${escapeHtml(sub)}</span>` : "") +
      `</div>`
    : "";

  return (
    `<div class="ring theme-${escapeHtml(themeKey)}" style="width:${size}px;height:${size}px">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" ` +
    `aria-label="进度 ${Math.round(percent * 100)}%">` +
    `<defs><linearGradient id="${escapeHtml(gradId)}" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="var(--t-from)"/>` +
    `<stop offset="100%" stop-color="var(--t-to)"/>` +
    `</linearGradient></defs>` +
    `<circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" ` +
    `fill="none" stroke-width="${stroke}"/>` +
    `<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" ` +
    `stroke="url(#${escapeHtml(gradId)})" stroke-width="${stroke}" stroke-linecap="round" ` +
    `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${initial.toFixed(2)}" ` +
    `data-target="${target.toFixed(2)}" ` +
    `transform="rotate(-90 ${size / 2} ${size / 2})"/>` +
    `</svg>${labelHtml}</div>`
  );
}

/**
 * 由 buildHeatmap() 的结果生成 SVG 网格（GitHub 风格星图）。
 * 每个 rect 带 data-date / data-count / data-tip，供 uiTooltip 使用。
 * @param {Object} data buildHeatmap 的返回值
 * @param {{cell?:number, gap?:number, showMonths?:boolean, showLegend?:boolean}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiHeatmap(data, opts) {
  const d = data && typeof data === "object" ? data : null;
  if (!d || !Array.isArray(d.cells) || d.cells.length === 0) {
    return `<p class="empty-hint">暂无星图数据。</p>`;
  }
  const o = opts && typeof opts === "object" ? opts : {};
  const cell = Number(o.cell) > 0 ? Number(o.cell) : 13;
  const gap = Number(o.gap) >= 0 ? Number(o.gap) : 4;
  const showMonths = o.showMonths !== false;
  const showLegend = o.showLegend !== false;

  const step = cell + gap;
  const padLeft = 26; // 左侧星期标签留白
  const padTop = showMonths ? 18 : 2;
  const width = padLeft + d.weeks * step;
  const height = padTop + 7 * step;

  const rects = d.cells
    .map((c) => {
      if (c.future) return "";
      const x = padLeft + c.col * step;
      const y = padTop + c.row * step;
      const cls =
        `hm-cell hm-l${c.level}` + (c.manual > 0 ? " hm-cell--manual" : "");
      const tip =
        c.count > 0
          ? `${c.date} · ${c.count} 次触达` +
            (c.manual > 0 ? `（含 ${c.manual} 次手动确认）` : "")
          : `${c.date} · 无记录`;
      return (
        `<rect class="${cls}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" ` +
        `data-date="${escapeHtml(c.date)}" data-count="${c.count}" data-tip="${escapeHtml(tip)}"></rect>`
      );
    })
    .join("");

  const months = showMonths
    ? d.monthTicks
        .map(
          (t) =>
            `<text class="hm-axis" x="${padLeft + t.col * step}" y="11">${escapeHtml(t.label)}</text>`
        )
        .join("")
    : "";

  // 只标周一 / 周三 / 周五，避免文字挤在一起
  const dowLabels = [0, 2, 4]
    .map(
      (row) =>
        `<text class="hm-axis" x="0" y="${padTop + row * step + cell - 2}">${escapeHtml(
          WEEKDAY_LABELS[row].slice(1)
        )}</text>`
    )
    .join("");

  const legend = showLegend
    ? `<div class="hm-legend">` +
      `<span class="hm-legend-text">少</span>` +
      [0, 1, 2, 3, 4]
        .map((l) => `<span class="hm-swatch hm-l${l}"></span>`)
        .join("") +
      `<span class="hm-legend-text">多</span>` +
      `<span class="hm-legend-note">青 = 提醒送达 · 金 = 手动确认</span>` +
      `</div>`
    : "";

  return (
    `<div class="heatmap">` +
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" ` +
    `preserveAspectRatio="xMinYMin meet" role="img" aria-label="打卡热力图">` +
    `${months}${dowLabels}${rects}</svg>${legend}</div>`
  );
}

/**
 * 由 dailyTrend() 的结果生成折线 + 渐变填充区 SVG。
 * @param {Array<{date:string, count:number, label:string}>} points 数据点
 * @param {{width?:number, height?:number, theme?:string}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiSparkline(points, opts) {
  const list = Array.isArray(points) ? points : [];
  if (list.length < 2) {
    return `<p class="empty-hint">数据点不足，暂无法绘制趋势。</p>`;
  }
  const o = opts && typeof opts === "object" ? opts : {};
  const width = Number(o.width) > 0 ? Number(o.width) : 640;
  const height = Number(o.height) > 0 ? Number(o.height) : 140;
  const themeKey = typeof o.theme === "string" && o.theme ? o.theme : "teal";
  const padX = 8;
  const padY = 12;
  const max = Math.max(1, ...list.map((p) => Number(p.count) || 0));
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (list.length - 1);

  const coords = list.map((p, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH * (1 - (Number(p.count) || 0) / max);
    return { x, y, p };
  });

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const area =
    `${padX},${(padY + innerH).toFixed(1)} ` +
    line +
    ` ${(padX + innerW).toFixed(1)},${(padY + innerH).toFixed(1)}`;

  const dots = coords
    .map(
      (c) =>
        `<circle class="spark-dot" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.2" ` +
        `data-tip="${escapeHtml(`${c.p.date} · ${Number(c.p.count) || 0} 次`)}"></circle>`
    )
    .join("");

  const gradId = `spark-grad-${themeKey}`;

  return (
    `<div class="spark theme-${escapeHtml(themeKey)}">` +
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" ` +
    `preserveAspectRatio="none" role="img" aria-label="近期趋势折线图">` +
    `<defs><linearGradient id="${escapeHtml(gradId)}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="var(--t-from)" stop-opacity="0.42"/>` +
    `<stop offset="100%" stop-color="var(--t-from)" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<polygon class="spark-area" points="${area}" fill="url(#${escapeHtml(gradId)})"></polygon>` +
    `<polyline class="spark-line" points="${line}" fill="none" stroke="var(--t-from)" ` +
    `stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></polyline>` +
    `${dots}</svg>` +
    `<div class="spark-axis"><span>${escapeHtml(list[0].label)}</span>` +
    `<span>峰值 ${max}</span>` +
    `<span>${escapeHtml(list[list.length - 1].label)}</span></div>` +
    `</div>`
  );
}

// ============================ 选择器组件 ============================

/**
 * 32 格 emoji 图标选择器 + 自定义输入框（radio 语义）。
 * @param {string} selected 当前选中的 emoji
 * @returns {string} HTML 字符串
 */
function uiIconPicker(selected) {
  const cur = typeof selected === "string" && selected ? selected : "🌟";
  const isPreset = ICON_PRESETS.indexOf(cur) >= 0;
  const cells = ICON_PRESETS.map((icon) => {
    const cls = "icon-cell" + (icon === cur ? " is-active" : "");
    return (
      `<button type="button" class="${cls}" data-icon="${escapeHtml(icon)}" ` +
      `role="radio" aria-checked="${icon === cur ? "true" : "false"}" ` +
      `title="${escapeHtml(icon)}">${escapeHtml(icon)}</button>`
    );
  }).join("");

  return (
    `<div class="icon-picker" id="plan-icon-picker" role="radiogroup" aria-label="选择图标">` +
    `${cells}</div>` +
    `<div class="icon-custom">` +
    `<label class="field-label field-label-gap" for="plan-icon-custom">自定义图标（可直接粘贴任意 emoji）</label>` +
    `<input type="text" id="plan-icon-custom" class="input input-emoji" maxlength="4" ` +
    `value="${escapeHtml(isPreset ? "" : cur)}" placeholder="🌟" autocomplete="off" />` +
    `</div>`
  );
}

/**
 * 6 个渐变色块选择器（radio 语义）。
 * @param {string} selected 当前选中的主题 key
 * @returns {string} HTML 字符串
 */
function uiThemePicker(selected) {
  const cur = Object.prototype.hasOwnProperty.call(COLOR_THEMES, selected)
    ? selected
    : COLOR_KEYS[0];
  const swatches = COLOR_KEYS.map((key) => {
    const theme = COLOR_THEMES[key];
    const cls = "swatch theme-" + key + (key === cur ? " is-active" : "");
    return (
      `<button type="button" class="${cls}" data-theme="${escapeHtml(key)}" ` +
      `role="radio" aria-checked="${key === cur ? "true" : "false"}" ` +
      `title="${escapeHtml(theme.label)}">` +
      `<span class="swatch-dot" aria-hidden="true"></span>` +
      `<span class="swatch-name">${escapeHtml(theme.label)}</span></button>`
    );
  }).join("");
  return (
    `<div class="theme-picker" id="plan-theme-picker" role="radiogroup" aria-label="选择配色">` +
    `${swatches}</div>`
  );
}

// ============================ 业务卡片 ============================

/**
 * 管理页计划卡片。
 * @param {Object} planView 计划视图对象：plan 字段 + {theme, next, streak}
 * @returns {string} HTML 字符串
 */
function uiPlanCard(planView) {
  const v = planView && typeof planView === "object" ? planView : {};
  const theme = v.theme && v.theme.key ? v.theme : themeOf(v);
  const enabled = v.enabled !== false;
  const icon = v.icon || "🌟";
  const desc = (v.desc || "").trim();
  const nextText = enabled
    ? v.next && v.next.human
      ? v.next.human
      : "—"
    : "已停用";
  const streak = v.streak || null;
  const streakHtml =
    streak && streak.current > 0
      ? `<span class="streak-badge" data-tip="最佳 ${streak.best} ${escapeHtml(streak.unit)}">` +
        `🔥 连续 ${streak.current} ${escapeHtml(streak.unit)}</span>`
      : "";

  return (
    `<article class="plan-card theme-${escapeHtml(theme.key)}${enabled ? "" : " is-off"}" ` +
    `data-id="${escapeHtml(v.id || "")}">` +
    `<header class="plan-card-head">` +
    `<span class="plan-icon" aria-hidden="true">${escapeHtml(icon)}</span>` +
    `<span class="freq-badge">${escapeHtml(describePlan(v))}</span>` +
    `</header>` +
    `<div class="plan-card-body">` +
    `<h3 class="plan-card-title">${escapeHtml(v.name || "未命名")}</h3>` +
    (desc ? `<p class="plan-card-desc">${escapeHtml(desc)}</p>` : "") +
    (v.image ? `<img class="plan-card-img" src="${escapeHtml(v.image)}" alt="${escapeHtml(v.name || "配图")}" loading="lazy" />` : "") +
    `<p class="plan-meta">⏭️ 下次提醒　${escapeHtml(nextText)}</p>` +
    streakHtml +
    `</div>` +
    `<footer class="plan-actions">` +
    `<label class="checkbox-row checkbox-inline">` +
    `<input type="checkbox" data-act="toggle" ${enabled ? "checked" : ""} />` +
    `<span>启用</span></label>` +
    `<button type="button" class="mini-btn" data-act="edit">编辑</button>` +
    `<button type="button" class="delete-btn" data-act="delete">删除</button>` +
    `</footer></article>`
  );
}

/**
 * 仪表盘今日时间轴单项。
 * @param {Object} planView todayPlans() 的一项
 * @returns {string} HTML 字符串
 */
function uiTimelineItem(planView) {
  const v = planView && typeof planView === "object" ? planView : {};
  const theme = v.theme && v.theme.key ? v.theme : themeOf(v);
  const classes = ["tl-item", `theme-${theme.key}`];
  if (v.passed) classes.push("is-passed");
  if (v.done) classes.push("is-done");
  if (!v.passed && v.isNow) classes.push("is-now");

  let statusText = "待触发";
  if (v.doneManual) statusText = "已完成 ✓";
  else if (v.doneAuto) statusText = "已送达 ✓";
  else if (v.passed) statusText = "已过时间";
  else if (v.isNow) statusText = "即将触发";

  const desc = (v.desc || "").trim();

  return (
    `<li class="${classes.join(" ")}" data-id="${escapeHtml(v.id || "")}">` +
    `<span class="tl-time">${escapeHtml(v.dueTime || "--:--")}</span>` +
    `<span class="tl-dot" aria-hidden="true"></span>` +
    `<span class="tl-body">` +
    `<span class="tl-name"><span class="tl-icon" aria-hidden="true">${escapeHtml(v.icon || "🌟")}</span>` +
    `${escapeHtml(v.name || "未命名")}</span>` +
    (desc ? `<span class="tl-desc">${escapeHtml(desc)}</span>` : "") +
    `</span>` +
    `<span class="tl-status">${escapeHtml(statusText)}</span>` +
    `</li>`
  );
}

/**
 * 里程碑徽章网格。
 * @param {Array<Object>} list milestones() 的返回值
 * @returns {string} HTML 字符串
 */
function uiBadgeGrid(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return `<p class="empty-hint">暂无徽章数据。</p>`;
  return (
    `<div class="badge-grid">` +
    items
      .map((m) => {
        const cls = "badge" + (m.unlocked ? "" : " is-locked");
        const progress = `${Math.min(m.reached || 0, m.days)}/${m.days}`;
        return (
          `<div class="${cls}" data-tip="${escapeHtml(m.desc || "")}">` +
          `<span class="badge-icon" aria-hidden="true">${escapeHtml(m.icon || "⭐")}</span>` +
          `<span class="badge-name">${escapeHtml(m.name || "")}</span>` +
          `<span class="badge-progress">${escapeHtml(m.unlocked ? "已解锁" : progress)}</span>` +
          `</div>`
        );
      })
      .join("") +
    `</div>`
  );
}

/**
 * 统一的空状态提示块。
 * @param {string} text 提示文案
 * @param {string} [icon] 图标 emoji
 * @returns {string} HTML 字符串
 */
function uiEmpty(text, icon) {
  return (
    `<p class="empty-hint">` +
    `<span class="empty-icon" aria-hidden="true">${escapeHtml(icon || "🌙")}</span> ` +
    `${escapeHtml(text || "暂无数据")}</p>`
  );
}

// ============================ 挂载型工具 ============================

/**
 * 数字滚动动画。动效关闭时直接赋终值。
 * @param {Element} el 目标节点
 * @param {number} target 目标数值
 * @param {{duration?:number, decimals?:number, suffix?:string, prefix?:string}} [opts] 配置
 * @returns {void}
 */
function uiCountUp(el, target, opts) {
  if (!el) return;
  const o = opts && typeof opts === "object" ? opts : {};
  const decimals = Number.isFinite(Number(o.decimals)) ? Number(o.decimals) : 0;
  const suffix = typeof o.suffix === "string" ? o.suffix : "";
  const prefix = typeof o.prefix === "string" ? o.prefix : "";
  const to = Number(target) || 0;
  const duration = Number(o.duration) > 0 ? Number(o.duration) : 700;

  /**
   * 写入格式化后的文本。
   * @param {number} v 当前值
   */
  const paint = (v) => {
    el.textContent = `${prefix}${v.toFixed(decimals)}${suffix}`;
  };

  if (uiMotionOff() || typeof window.requestAnimationFrame !== "function") {
    paint(to);
    return;
  }

  const start = performance.now();
  /**
   * rAF 帧回调。
   * @param {number} now 当前时间戳
   */
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - t, 3);
    paint(to * eased);
    if (t < 1) window.requestAnimationFrame(tick);
    else paint(to);
  };
  paint(0);
  window.requestAnimationFrame(tick);
}

/**
 * 为 root 内所有 [data-tip] 元素挂载轻量 tooltip（单例浮层，无第三方依赖）。
 * 可重复调用，事件挂在 root 上做委托，不会重复绑定同一节点。
 * @param {Element} root 容器节点
 * @returns {void}
 */
function uiTooltip(root) {
  const host = root || document.body;
  if (!host || host.dataset.tipBound === "1") return;
  host.dataset.tipBound = "1";

  let layer = document.getElementById("ui-tip-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "ui-tip-layer";
    layer.className = "tip";
    layer.setAttribute("role", "tooltip");
    layer.hidden = true;
    document.body.appendChild(layer);
  }

  /**
   * 显示 tooltip。
   * @param {Element} target 触发元素
   */
  const show = (target) => {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    layer.textContent = text;
    layer.hidden = false;
    const rect = target.getBoundingClientRect();
    const lw = layer.offsetWidth;
    const lh = layer.offsetHeight;
    let left = rect.left + rect.width / 2 - lw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - lw - 8));
    let top = rect.top - lh - 10;
    if (top < 8) top = rect.bottom + 10;
    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
  };

  /** 隐藏 tooltip。 */
  const hide = () => {
    layer.hidden = true;
  };

  host.addEventListener(
    "mouseover",
    (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (t && host.contains(t)) show(t);
    },
    true
  );
  host.addEventListener(
    "mouseout",
    (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
      if (t) hide();
    },
    true
  );
  host.addEventListener("focusin", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("[data-tip]") : null;
    if (t) show(t);
  });
  host.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });
}

/**
 * 进场处理：
 * 1）给 root 的直接子元素按序加 .reveal 做 stagger 进场；
 * 2）激活 root 内所有带 data-target 的进度环（把 stroke-dashoffset 推到终态）。
 * 动效关闭时两者都直接落终态，不做过渡。
 * @param {Element} root 容器节点
 * @returns {void}
 */
function uiRevealOnLoad(root) {
  const host = root || document.body;
  if (!host) return;
  const off = uiMotionOff();

  Array.prototype.forEach.call(host.children, (child, i) => {
    if (off) {
      child.classList.add("reveal", "is-shown");
      return;
    }
    child.classList.add("reveal");
    child.style.animationDelay = `${Math.min(i, 10) * 60}ms`;
    child.classList.add("is-shown");
  });

  /** 把所有进度环推到终态。 */
  const fillRings = () => {
    const rings = host.querySelectorAll(".ring-fill[data-target]");
    Array.prototype.forEach.call(rings, (ring) => {
      ring.style.strokeDashoffset = ring.getAttribute("data-target");
    });
  };

  if (off || typeof window.requestAnimationFrame !== "function") {
    fillRings();
  } else {
    // 双 rAF：确保初始 dashoffset 已经上屏，transition 才会真的跑起来
    window.requestAnimationFrame(() => window.requestAnimationFrame(fillRings));
  }
}

/* =====================================================================
   v4「星河契约」组件层
   ---------------------------------------------------------------------
   本节【只新增】，不改动上面任何 v3 组件的签名与行为。
   仍然遵守全部既有契约：
     · 纯函数：入参 → 返回 HTML / SVG 字符串；
     · 内部完成 escapeHtml，调用方传原始数据即可；
     · 不读 localStorage、不调 store 的 load*；
     · 动效一律交给 CSS（@media prefers-reduced-motion + html.no-motion），
       组件本身不写死 animation，保证「减少动效」开关一处生效。
   ===================================================================== */

// ============================ v4 常量与小工具 ============================

/** 亮度等级 → 中文名。索引即 planBrightness().level */
const UI_STAR_LEVELS = ["熄灭", "微光", "常明", "明亮", "恒星"];

/** 月相名称分档（按亮度百分比由低到高匹配） */
const UI_MOON_NAMES = [
  { max: 0.02, name: "新月" },
  { max: 0.24, name: "娥眉月" },
  { max: 0.51, name: "上弦月" },
  { max: 0.76, name: "盈凸月" },
  { max: 0.99, name: "近满月" },
  { max: 1.01, name: "满月" },
];

/** 四角星芒的 path，多处复用，保证视觉语言统一 */
const UI_SPARK_PATH = "M12 1.2 L14.3 9.7 L22.8 12 L14.3 14.3 L12 22.8 L9.7 14.3 L1.2 12 L9.7 9.7 Z";

/** 自增序号，供 uiUid() 生成页面内唯一的 SVG id */
let uiSeq = 0;

/**
 * 生成页面内唯一 id（SVG defs 的 gradient / clipPath 需要）。
 * 只含字母数字与短横线，可安全用于 url(#id)。
 * @param {string} [prefix] 前缀
 * @returns {string} 唯一 id
 */
function uiUid(prefix) {
  uiSeq += 1;
  const safe = String(prefix || "ui").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${safe || "ui"}-${uiSeq}`;
}

/**
 * 亮度等级 → 中文名。
 * @param {number} level 0~4
 * @returns {string} 等级名
 */
function uiStarLevelName(level) {
  const i = Math.round(Number(level));
  if (!Number.isFinite(i) || i < 0) return UI_STAR_LEVELS[0];
  return UI_STAR_LEVELS[Math.min(i, UI_STAR_LEVELS.length - 1)];
}

/**
 * 亮度百分比 → 月相名。
 * @param {number} p 0~1
 * @returns {string} 月相名
 */
function uiMoonName(p) {
  const v = uiClamp(p, 0, 1);
  for (const item of UI_MOON_NAMES) {
    if (v <= item.max) return item.name;
  }
  return "满月";
}

// ============================ 星图（管理页主视图） ============================

/**
 * 星空空状态：一句诗，外加一个「缔结第一颗星」的引导。
 * @param {string} [text] 主文案，缺省用 EMPTY_SKY_LINE
 * @param {string} [cta] 行动按钮文案；为空则不渲染按钮
 * @returns {string} HTML 字符串
 */
function uiSkyEmpty(text, cta) {
  const line = text || EMPTY_SKY_LINE;
  const btn = cta
    ? `<button type="button" class="sky-empty-cta" data-act="new-star">${escapeHtml(cta)}</button>`
    : "";
  return (
    `<div class="sky-empty">` +
    `<span class="sky-empty-mark" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24"><path d="${UI_SPARK_PATH}"/></svg></span>` +
    `<p class="sky-empty-line">${escapeHtml(line)}</p>` +
    btn +
    `</div>`
  );
}

/**
 * 星图主视图：星座连线 + 星点。
 *
 * 坐标全部来自 buildStarMap()（百分比，同一计划永远落在同一处）。
 * 连线层用 viewBox="0 0 100 100" + preserveAspectRatio="none"，
 * 这样百分比坐标可以直接当作 SVG 坐标用；线宽靠 vector-effect
 * 保持不被拉伸变形。
 *
 * @param {Object} map buildStarMap() 的返回值
 * @param {{links?:boolean, emptyText?:string, emptyCta?:string}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiStarMap(map, opts) {
  const m = map && typeof map === "object" ? map : null;
  const o = opts && typeof opts === "object" ? opts : {};

  if (!m || !Array.isArray(m.stars) || m.stars.length === 0) {
    return uiSkyEmpty(o.emptyText || EMPTY_SKY_LINE, o.emptyCta || "＋ 缔结新星");
  }

  const showLinks = o.links !== false;
  const lines =
    showLinks && Array.isArray(m.links)
      ? m.links
          .map((l) => {
            const cls = "sky-link" + (l.bright ? " is-bright" : "");
            return (
              `<line class="${cls}" ` +
              `x1="${Number(l.x1).toFixed(3)}" y1="${Number(l.y1).toFixed(3)}" ` +
              `x2="${Number(l.x2).toFixed(3)}" y2="${Number(l.y2).toFixed(3)}" ` +
              `vector-effect="non-scaling-stroke"></line>`
            );
          })
          .join("")
      : "";

  const stars = m.stars.map((s) => uiStar(s)).join("");

  return (
    `<div class="sky-map" role="group" aria-label="我的星图">` +
    `<svg class="sky-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">` +
    `${lines}</svg>` +
    `<div class="sky-stars">${stars}</div>` +
    `</div>`
  );
}

/**
 * 单颗星（星图内的可点击按钮）。
 * 结构：光环 + 星芒 + 星芯 + 名牌，全部靠 CSS 变量控制尺寸与闪烁相位。
 * @param {Object} star buildStarMap().stars 的一项
 * @returns {string} HTML 字符串
 */
function uiStar(star) {
  const s = star && typeof star === "object" ? star : {};
  const theme = s.theme && s.theme.key ? s.theme : themeOf(s);
  const level = Number.isFinite(Number(s.level)) ? Number(s.level) : 1;
  const enabled = s.enabled !== false;

  const classes = ["sky-star", `lvl-${level}`, `theme-${theme.key}`];
  if (!enabled) classes.push("is-off");

  const size = Number(s.size) > 0 ? Number(s.size) : 14;
  const halo = Number(s.halo) > 0 ? Number(s.halo) : size * 2.6;
  const style =
    `left:${Number(s.x).toFixed(3)}%;` +
    `top:${Number(s.y).toFixed(3)}%;` +
    `--star-size:${size.toFixed(1)}px;` +
    `--star-halo:${halo.toFixed(1)}px;` +
    `--tw-delay:${Math.round(Number(s.delay) || 0)}ms;` +
    `--tw-period:${Math.round(Number(s.period) || 3600)}ms`;

  const aria = `${s.name || "未命名"}，${uiStarLevelName(level)}，${s.label || ""}`;

  return (
    `<button type="button" class="${classes.join(" ")}" style="${style}" ` +
    `data-id="${escapeHtml(s.id || "")}" data-act="star" ` +
    `data-tip="${escapeHtml(s.tip || "")}" aria-label="${escapeHtml(aria)}">` +
    `<span class="star-halo" aria-hidden="true"></span>` +
    `<span class="star-beam" aria-hidden="true"></span>` +
    `<span class="star-core" aria-hidden="true"></span>` +
    `<span class="star-tag">` +
    `<span class="star-tag-icon" aria-hidden="true">${escapeHtml(s.icon || "🌟")}</span>` +
    `<span class="star-tag-name">${escapeHtml(s.name || "未命名")}</span>` +
    `</span>` +
    `</button>`
  );
}

/**
 * 星图上方的一行统计（共几颗 / 亮着几颗 / 熄灭几颗）。
 * @param {Object} map buildStarMap() 的返回值
 * @returns {string} HTML 字符串
 */
function uiSkyMeta(map) {
  const m = map && typeof map === "object" ? map : { total: 0, lit: 0, dim: 0 };
  const cells = [
    { label: "已缔结", value: Number(m.total) || 0, cls: "is-total" },
    { label: "亮着", value: Number(m.lit) || 0, cls: "is-lit" },
    { label: "熄灭", value: Number(m.dim) || 0, cls: "is-dim" },
  ];
  return (
    `<div class="sky-meta">` +
    cells
      .map(
        (c) =>
          `<span class="sky-meta-item ${c.cls}">` +
          `<b class="sky-meta-num">${escapeHtml(String(c.value))}</b>` +
          `<span class="sky-meta-label">${escapeHtml(c.label)}</span></span>`
      )
      .join("") +
    `</div>`
  );
}

/**
 * 编辑舱顶部的星体简报：等级、连续、完成率、下次提醒。
 * @param {Object} star buildStarMap().stars 的一项；传 null 表示「缔结新星」
 * @returns {string} HTML 字符串
 */
function uiStarBrief(star) {
  const s = star && typeof star === "object" ? star : null;
  if (!s) {
    return (
      `<div class="star-brief is-new">` +
      `<span class="star-brief-icon" aria-hidden="true">✦</span>` +
      `<div class="star-brief-text">` +
      `<h3 class="star-brief-title">缔结新星</h3>` +
      `<p class="star-brief-sub">取个名字，定下时刻，它就会出现在你的夜空里。</p>` +
      `</div></div>`
    );
  }

  const theme = s.theme && s.theme.key ? s.theme : themeOf(s);
  const level = Number.isFinite(Number(s.level)) ? Number(s.level) : 1;
  const streak = s.streak || { current: 0, best: 0, unit: "天" };
  const rate = s.rate || { rate: 0, expected: 0 };

  const chips = [
    `<span class="star-chip">${escapeHtml(uiStarLevelName(level))}</span>`,
    streak.current > 0
      ? `<span class="star-chip">连续 ${escapeHtml(String(streak.current))} ${escapeHtml(streak.unit || "天")}</span>`
      : `<span class="star-chip is-muted">尚未起势</span>`,
    rate.expected > 0
      ? `<span class="star-chip">30 天 ${escapeHtml(String(Math.round(Number(rate.rate) * 100)))}%</span>`
      : "",
    s.enabled === false
      ? `<span class="star-chip is-off">已熄灭</span>`
      : s.next && s.next.human
      ? `<span class="star-chip">下次 ${escapeHtml(s.next.human)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const imgHtml = s.image
    ? `<img class="star-brief-img" src="${escapeHtml(s.image)}" alt="${escapeHtml(s.name || "配图")}" loading="lazy" />`
    : "";

  return (
    `<div class="star-brief theme-${escapeHtml(theme.key)} lvl-${level}">` +
    `<span class="star-brief-icon" aria-hidden="true">${escapeHtml(s.icon || "🌟")}</span>` +
    `<div class="star-brief-text">` +
    `<h3 class="star-brief-title">${escapeHtml(s.name || "未命名")}</h3>` +
    `<p class="star-brief-sub">${escapeHtml(s.label || "")}</p>` +
    `<div class="star-chips">${chips}</div>` +
    `</div>${imgHtml}</div>`
  );
}

// ============================ 天文台（仪表盘） ============================

/**
 * 月相 SVG：用月亮的盈亏表达完成率。
 * 0% = 新月（全暗），50% = 上弦月，100% = 满月。
 *
 * 亮面路径 = 右半圆弧 + 一段「终止线」椭圆弧：
 *   椭圆弧的横半径 k = r·|1-2p|，扫掠方向随 p 是否过半切换，
 *   于是 p=0 时两段弧重合（零面积 → 新月），p=1 时补成整圆（满月）。
 *
 * @param {number} percent 0~1 的完成率
 * @param {{size?:number, label?:string, sub?:string}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiMoonPhase(percent, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const p = uiClamp(percent, 0, 1);
  const size = Number(o.size) > 0 ? Number(o.size) : 88;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 3;
  const k = r * Math.abs(1 - 2 * p);
  const sweep = p >= 0.5 ? 1 : 0;

  const top = (cy - r).toFixed(3);
  const bottom = (cy + r).toFixed(3);
  const litPath =
    `M ${cx} ${top} ` +
    `A ${r.toFixed(3)} ${r.toFixed(3)} 0 0 1 ${cx} ${bottom} ` +
    `A ${k.toFixed(3)} ${r.toFixed(3)} 0 0 ${sweep} ${cx} ${top} Z`;

  const clipId = uiUid("moonclip");
  const gradId = uiUid("moongrad");
  const name = uiMoonName(p);
  const pct = Math.round(p * 100);

  // 环形斑（月海）只在亮面内可见，靠 clipPath 裁掉暗面部分
  const craters =
    `<g clip-path="url(#${clipId})" class="moon-craters">` +
    `<circle cx="${(cx + r * 0.26).toFixed(2)}" cy="${(cy - r * 0.3).toFixed(2)}" r="${(r * 0.17).toFixed(2)}"/>` +
    `<circle cx="${(cx + r * 0.45).toFixed(2)}" cy="${(cy + r * 0.24).toFixed(2)}" r="${(r * 0.12).toFixed(2)}"/>` +
    `<circle cx="${(cx - r * 0.05).toFixed(2)}" cy="${(cy + r * 0.48).toFixed(2)}" r="${(r * 0.09).toFixed(2)}"/>` +
    `</g>`;

  const label = o.label === undefined || o.label === null ? `${pct}%` : String(o.label);
  const sub = o.sub === undefined || o.sub === null ? name : String(o.sub);

  return (
    `<div class="moon" style="width:${size}px;height:${size}px" ` +
    `data-tip="${escapeHtml(`${name} · 本月完成率 ${pct}%`)}">` +
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" ` +
    `aria-label="${escapeHtml(`月相 ${name}，完成率 ${pct}%`)}">` +
    `<defs>` +
    `<radialGradient id="${gradId}" cx="35%" cy="30%" r="80%">` +
    `<stop offset="0%" stop-color="#fffdf2"/>` +
    `<stop offset="60%" stop-color="#f6e7b8"/>` +
    `<stop offset="100%" stop-color="#d9c187"/>` +
    `</radialGradient>` +
    `<clipPath id="${clipId}"><path d="${litPath}"/></clipPath>` +
    `</defs>` +
    `<circle class="moon-dark" cx="${cx}" cy="${cy}" r="${r.toFixed(3)}"/>` +
    `<path class="moon-lit" d="${litPath}" fill="url(#${gradId})"/>` +
    craters +
    `<circle class="moon-rim" cx="${cx}" cy="${cy}" r="${r.toFixed(3)}" fill="none"/>` +
    `</svg>` +
    `<div class="moon-label">` +
    `<span class="moon-label-main">${escapeHtml(label)}</span>` +
    `<span class="moon-label-sub">${escapeHtml(sub)}</span>` +
    `</div></div>`
  );
}

/**
 * 彗星 SVG：尾巴长度随连续天数增长（21 天封顶）。
 * 连续为 0 时只留一个暗淡的核，表示「还没启程」。
 * @param {number} streak 连续天数
 * @param {{width?:number, height?:number}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiComet(streak, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const n = Math.max(0, Math.floor(Number(streak) || 0));
  const w = Number(o.width) > 0 ? Number(o.width) : 128;
  const h = Number(o.height) > 0 ? Number(o.height) : 40;
  const ratio = uiClamp(n / 21, 0, 1);

  const midY = h / 2;
  const headX = w - 12;
  const headR = 4.2 + ratio * 2.2;
  const tailLen = 14 + ratio * (w - 42);
  const tailX = headX - tailLen;
  const spread = 3 + ratio * 4.5;

  const gradId = uiUid("cometgrad");
  const cls = "comet" + (n > 0 ? "" : " is-idle");

  // 尾巴：从头部两侧收束到尾端一点，形成锥形拖尾
  const tail =
    `M ${headX.toFixed(2)} ${(midY - spread).toFixed(2)} ` +
    `Q ${(headX - tailLen * 0.45).toFixed(2)} ${(midY - spread * 0.55).toFixed(2)} ` +
    `${tailX.toFixed(2)} ${midY.toFixed(2)} ` +
    `Q ${(headX - tailLen * 0.45).toFixed(2)} ${(midY + spread * 0.55).toFixed(2)} ` +
    `${headX.toFixed(2)} ${(midY + spread).toFixed(2)} Z`;

  // 尾迹里的碎星，位置固定，避免每次渲染跳动
  const sparks = [0.28, 0.52, 0.74]
    .map((f, i) => {
      const x = headX - tailLen * f;
      const y = midY + (i % 2 === 0 ? -1 : 1) * (2.2 + i * 1.1);
      return `<circle class="comet-spark" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(1.5 - i * 0.28).toFixed(2)}"/>`;
    })
    .join("");

  return (
    `<div class="${cls}" data-tip="${escapeHtml(`当前连续 ${n} 天`)}">` +
    `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="xMidYMid meet" ` +
    `role="img" aria-label="${escapeHtml(`连续 ${n} 天的彗尾`)}">` +
    `<defs><linearGradient id="${gradId}" x1="${tailX.toFixed(2)}" y1="0" x2="${headX.toFixed(2)}" y2="0" ` +
    `gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="var(--t-from)" stop-opacity="0"/>` +
    `<stop offset="55%" stop-color="var(--t-from)" stop-opacity="0.45"/>` +
    `<stop offset="100%" stop-color="var(--t-to)" stop-opacity="0.95"/>` +
    `</linearGradient></defs>` +
    `<path class="comet-tail" d="${tail}" fill="url(#${gradId})"/>` +
    sparks +
    `<circle class="comet-head" cx="${headX.toFixed(2)}" cy="${midY.toFixed(2)}" r="${headR.toFixed(2)}"/>` +
    `</svg></div>`
  );
}

/**
 * 今晚星轨的单项（仪表盘时间轴 v4）。
 * 到点未完成的会带 is-due，由 CSS 做脉冲；已完成的星芒常亮。
 * @param {Object} planView todayPlans() 的一项（可带 isNow）
 * @returns {string} HTML 字符串
 */
function uiTimelineStar(planView) {
  const v = planView && typeof planView === "object" ? planView : {};
  const theme = v.theme && v.theme.key ? v.theme : themeOf(v);
  const classes = ["rail-item", `theme-${theme.key}`];
  if (v.passed) classes.push("is-passed");
  if (v.done) classes.push("is-done");
  if (v.isNow) classes.push("is-now");
  if (v.passed && !v.done) classes.push("is-due");

  let statusText = "待点亮";
  if (v.doneManual) statusText = "已点亮 ✓";
  else if (v.doneAuto) statusText = "已送达 ✓";
  else if (v.passed) statusText = "已过时辰";
  else if (v.isNow) statusText = "即将亮起";

  const desc = (v.desc || "").trim();

  return (
    `<li class="${classes.join(" ")}" data-id="${escapeHtml(v.id || "")}">` +
    `<span class="rail-time">${escapeHtml(v.dueTime || "--:--")}</span>` +
    `<span class="rail-star" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24"><path d="${UI_SPARK_PATH}"/></svg></span>` +
    `<span class="rail-body">` +
    `<span class="rail-name">` +
    `<span class="rail-icon" aria-hidden="true">${escapeHtml(v.icon || "🌟")}</span>` +
    `${escapeHtml(v.name || "未命名")}</span>` +
    (desc ? `<span class="rail-desc">${escapeHtml(desc)}</span>` : "") +
    `</span>` +
    `<span class="rail-status">${escapeHtml(statusText)}</span>` +
    `</li>`
  );
}

/**
 * 星点热力图：与 uiHeatmap 同源数据，但把方块换成会发光的星点。
 * 用在仪表盘（迷你）与统计页（全年）。
 * @param {Object} data buildHeatmap() 的返回值
 * @param {{cell?:number, gap?:number, showMonths?:boolean, showLegend?:boolean}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiStarHeatmap(data, opts) {
  const d = data && typeof data === "object" ? data : null;
  if (!d || !Array.isArray(d.cells) || d.cells.length === 0) {
    return uiEmpty("这片天区还没有记录。", "🌑");
  }
  const o = opts && typeof opts === "object" ? opts : {};
  const cell = Number(o.cell) > 0 ? Number(o.cell) : 13;
  const gap = Number(o.gap) >= 0 ? Number(o.gap) : 4;
  const showMonths = o.showMonths !== false;
  const showLegend = o.showLegend !== false;

  const step = cell + gap;
  const padLeft = 26;
  const padTop = showMonths ? 18 : 2;
  const width = padLeft + d.weeks * step;
  const height = padTop + 7 * step;
  const rMax = cell / 2;

  const dots = d.cells
    .map((c) => {
      if (c.future) return "";
      const cx = padLeft + c.col * step + rMax;
      const cy = padTop + c.row * step + rMax;
      const cls = `sh-dot sh-l${c.level}` + (c.manual > 0 ? " sh-dot--manual" : "");
      const tip =
        c.count > 0
          ? `${c.date} · ${c.count} 次触达` +
            (c.manual > 0 ? `（含 ${c.manual} 次手动点亮）` : "")
          : `${c.date} · 暗着`;
      // 半径随等级增长：0 级只留一颗极小的暗尘
      const r = c.level === 0 ? 1.4 : 2.1 + c.level * (rMax - 2.1) / 4;
      return (
        `<circle class="${cls}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(2)}" ` +
        `data-date="${escapeHtml(c.date)}" data-count="${c.count}" ` +
        `data-tip="${escapeHtml(tip)}"></circle>`
      );
    })
    .join("");

  const months = showMonths
    ? d.monthTicks
        .map(
          (t) =>
            `<text class="hm-axis" x="${padLeft + t.col * step}" y="11">${escapeHtml(t.label)}</text>`
        )
        .join("")
    : "";

  const dowLabels = [0, 2, 4]
    .map(
      (row) =>
        `<text class="hm-axis" x="0" y="${padTop + row * step + cell - 3}">${escapeHtml(
          WEEKDAY_LABELS[row].slice(1)
        )}</text>`
    )
    .join("");

  const legend = showLegend
    ? `<div class="hm-legend">` +
      `<span class="hm-legend-text">暗</span>` +
      [0, 1, 2, 3, 4]
        .map(
          (l) =>
            `<span class="sh-swatch sh-l${l}"><svg viewBox="0 0 24 24" aria-hidden="true">` +
            `<circle cx="12" cy="12" r="${l === 0 ? 3 : 4 + l * 2}"/></svg></span>`
        )
        .join("") +
      `<span class="hm-legend-text">亮</span>` +
      `<span class="hm-legend-note">青 = 提醒送达 · 金 = 手动点亮</span>` +
      `</div>`
    : "";

  return (
    `<div class="starheat">` +
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" ` +
    `preserveAspectRatio="xMinYMin meet" role="img" aria-label="打卡星点图">` +
    `${months}${dowLabels}${dots}</svg>${legend}</div>`
  );
}

// ============================ 星历（统计页） ============================

/**
 * 月度星历：有活动的日子画成小星星，亮度随当天记录数增长。
 * @param {Object} grid buildMonthGrid() 的返回值
 * @param {{title?:string}} [opts] 配置
 * @returns {string} HTML 字符串
 */
function uiMonthGrid(grid, opts) {
  const g = grid && typeof grid === "object" ? grid : null;
  if (!g || !Array.isArray(g.cells) || g.cells.length === 0) {
    return uiEmpty("这个月还没有星光。", "🌑");
  }
  const o = opts && typeof opts === "object" ? opts : {};

  const head = WEEKDAY_LABELS.map(
    (w) => `<span class="mg-dow">${escapeHtml(w.slice(1))}</span>`
  ).join("");

  const cells = g.cells
    .map((c) => {
      const classes = ["mg-cell", `lv-${c.level}`];
      if (!c.inMonth) classes.push("is-out");
      if (c.isToday) classes.push("is-today");
      if (c.future) classes.push("is-future");
      if (c.count > 0) classes.push("is-lit");

      const tip =
        c.count > 0
          ? `${c.date} · ${c.count} 次触达` +
            (c.manual > 0 ? `（含 ${c.manual} 次手动点亮）` : "")
          : `${c.date} · 暗着`;

      const spark =
        c.count > 0
          ? `<span class="mg-spark" aria-hidden="true">` +
            `<svg viewBox="0 0 24 24"><path d="${UI_SPARK_PATH}"/></svg></span>`
          : "";

      return (
        `<span class="${classes.join(" ")}" data-date="${escapeHtml(c.date)}" ` +
        `data-tip="${escapeHtml(tip)}">` +
        spark +
        `<span class="mg-day">${escapeHtml(String(c.day))}</span>` +
        `</span>`
      );
    })
    .join("");

  const title = o.title === undefined || o.title === null ? g.label : String(o.title);

  return (
    `<div class="monthgrid">` +
    `<div class="mg-head">` +
    `<span class="mg-title">${escapeHtml(title)}</span>` +
    `<span class="mg-sum">${escapeHtml(`${g.activeDays} 天亮着 · 共 ${g.total} 次`)}</span>` +
    `</div>` +
    `<div class="mg-dows">${head}</div>` +
    `<div class="mg-body">${cells}</div>` +
    `</div>`
  );
}

/**
 * 竖向星轨：每个计划一条轨道，星星升到与连续记录成正比的高度。
 * @param {Array<Object>} list 每项 = {id, name, icon, theme, current, best, unit}
 * @param {{cap?:number}} [opts] cap 表示「升到顶」所需的连续数，缺省 21
 * @returns {string} HTML 字符串
 */
function uiStarTrack(list, opts) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return uiEmpty("还没有可以攀升的星轨。", "🌠");

  const o = opts && typeof opts === "object" ? opts : {};
  const capRaw = Number(o.cap);
  const bestOf = items.reduce((mx, it) => Math.max(mx, Number(it.current) || 0), 0);
  const cap = capRaw > 0 ? capRaw : Math.max(21, bestOf);

  const cols = items
    .map((it) => {
      const theme = it.theme && it.theme.key ? it.theme : themeOf(it);
      const cur = Math.max(0, Number(it.current) || 0);
      const unit = it.unit || "天";
      // 留 6% 底座，避免 0 时星星被压在轴线上看不见
      const pct = 6 + uiClamp(cur / cap, 0, 1) * 88;
      const tip = `${it.name || "未命名"} · 当前连续 ${cur} ${unit} · 最佳 ${Math.max(
        Number(it.best) || 0,
        cur
      )} ${unit}`;

      return (
        `<div class="track theme-${escapeHtml(theme.key)}${cur > 0 ? " is-active" : ""}" ` +
        `data-tip="${escapeHtml(tip)}">` +
        `<div class="track-rail">` +
        `<span class="track-trail" style="height:${pct.toFixed(2)}%"></span>` +
        `<span class="track-star" style="bottom:${pct.toFixed(2)}%">` +
        `<span class="track-star-glow" aria-hidden="true"></span>` +
        `<span class="track-star-icon" aria-hidden="true">${escapeHtml(it.icon || "🌟")}</span>` +
        `</span>` +
        `</div>` +
        `<span class="track-num">${escapeHtml(String(cur))}</span>` +
        `<span class="track-name">${escapeHtml(it.name || "未命名")}</span>` +
        `</div>`
      );
    })
    .join("");

  return (
    `<div class="startrack">${cols}</div>` +
    `<p class="startrack-axis">轨道高度 = 当前连续记录（满格 ${escapeHtml(String(cap))}）</p>`
  );
}

/**
 * 星座亮度条：一行一个计划，条越亮越长代表完成率越高。
 * @param {Array<Object>} list 每项 = {id, name, icon, theme, rate, done, expected, unit}
 * @returns {string} HTML 字符串
 */
function uiBrightBars(list) {
  const items = Array.isArray(list) ? list : [];
  if (items.length === 0) return uiEmpty("还没有可比较的星座亮度。", "✧");

  const rows = items
    .map((it) => {
      const theme = it.theme && it.theme.key ? it.theme : themeOf(it);
      const rate = uiClamp(it.rate, 0, 1);
      const pct = Math.round(rate * 100);
      const done = Number(it.done) || 0;
      const expected = Number(it.expected) || 0;
      // 亮度分档与星图口径一致，便于两页互相印证
      const lvl = rate >= 0.85 ? 4 : rate >= 0.6 ? 3 : rate >= 0.35 ? 2 : rate > 0 ? 1 : 0;
      const tip = expected > 0 ? `${done} / ${expected} 次应触发` : "窗口内暂无应触发日";

      return (
        `<div class="bright-row theme-${escapeHtml(theme.key)} lvl-${lvl}" ` +
        `data-tip="${escapeHtml(tip)}">` +
        `<span class="bright-icon" aria-hidden="true">${escapeHtml(it.icon || "🌟")}</span>` +
        `<span class="bright-name">${escapeHtml(it.name || "未命名")}</span>` +
        `<span class="bright-bar">` +
        `<span class="bright-fill" style="width:${pct}%"></span>` +
        `<span class="bright-tip-star" style="left:${pct}%" aria-hidden="true">` +
        `<svg viewBox="0 0 24 24"><path d="${UI_SPARK_PATH}"/></svg></span>` +
        `</span>` +
        `<span class="bright-pct">${escapeHtml(String(pct))}%</span>` +
        `</div>`
      );
    })
    .join("");

  return `<div class="brightbars">${rows}</div>`;
}

/**
 * 里程碑祝贺横幅。
 * @param {Object} cheer milestoneCheer() 的返回值
 * @returns {string} HTML 字符串
 */
function uiCheer(cheer) {
  const c = cheer && typeof cheer === "object" ? cheer : { unlocked: false, text: "" };
  if (!c.text) return "";
  const m = c.milestone || {};
  const cls = "cheer" + (c.unlocked ? " is-unlocked" : " is-pending");
  return (
    `<div class="${cls}" role="status">` +
    `<span class="cheer-icon" aria-hidden="true">${escapeHtml(m.icon || (c.unlocked ? "🏅" : "✧"))}</span>` +
    `<p class="cheer-text">${escapeHtml(c.text)}</p>` +
    `</div>`
  );
}

/**
 * 「星语」：把语录放大居中、带辉光地展示。
 * @param {string} quote 语录文本
 * @param {{from?:string}} [opts] from = 署名
 * @returns {string} HTML 字符串
 */
function uiSkyQuote(quote, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const text = String(quote || "").trim();
  if (!text) return "";
  const from = o.from === undefined || o.from === null ? "梵高" : String(o.from);
  return (
    `<figure class="skyquote">` +
    `<span class="skyquote-mark" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24"><path d="${UI_SPARK_PATH}"/></svg></span>` +
    `<blockquote class="skyquote-text">${escapeHtml(text)}</blockquote>` +
    (from ? `<figcaption class="skyquote-from">— ${escapeHtml(from)}</figcaption>` : "") +
    `</figure>`
  );
}

/* =====================================================================
   v6 · 星河契约组件
   仍遵守本文件契约：纯函数、内部转义、不读 localStorage、不声明 const $
   ===================================================================== */

/**
 * B2 誓约引导的单页。
 * @param {{icon?:string,title?:string,body?:string,index?:number,total?:number,
 *          signed?:boolean,askSilent?:boolean,nextText?:string}} step
 * @returns {string} HTML 字符串
 */
function uiOathStep(step) {
  const s = step && typeof step === "object" ? step : {};
  const total = uiClamp(Number(s.total) || 1, 1, 9);
  const idx = uiClamp(Number(s.index) || 0, 0, total - 1);

  let dots = "";
  for (let i = 0; i < total; i++) {
    dots += `<span class="oath-dot${i === idx ? " is-on" : ""}"></span>`;
  }

  const silent = s.askSilent
    ? `<label class="oath-silent">` +
      `<input type="checkbox" id="oath-silent" />` +
      `静默模式：不出声、不震动，只留画面` +
      `</label>`
    : "";

  const acts = s.signed
    ? ""
    : idx >= total - 1
    ? `<div class="oath-acts">` +
      `<button type="button" class="btn btn-ghost btn-sm" data-oath="skip">以后再说</button>` +
      `<button type="button" class="btn btn-primary btn-sm" data-oath="sign">签下契约</button>` +
      `</div>`
    : `<div class="oath-acts">` +
      `<button type="button" class="btn btn-ghost btn-sm" data-oath="skip">跳过</button>` +
      `<button type="button" class="btn btn-primary btn-sm" data-oath="next">` +
      `${escapeHtml(s.nextText || "继续")}</button>` +
      `</div>`;

  return (
    `<span class="oath-icon" aria-hidden="true">${escapeHtml(s.icon || "✦")}</span>` +
    `<h2 class="oath-title">${escapeHtml(s.title || "")}</h2>` +
    `<p class="oath-body">${escapeHtml(s.body || "")}</p>` +
    `<div class="oath-dots" aria-hidden="true">${dots}</div>` +
    silent +
    acts
  );
}

/**
 * C1 段位徽章（页头小胶囊）。
 * @param {{name?:string,icon?:string,score?:number,hidden?:boolean}} rank
 * @returns {string} HTML 字符串；rank 为空时返回空串（页头就当没这块）
 */
function uiRankBadge(rank) {
  if (!rank || typeof rank !== "object") return "";
  const name = String(rank.name || "").trim();
  if (!name) return "";
  const cls = rank.hidden ? " is-hidden-tier" : "";
  const score = Number(rank.score) || 0;
  return (
    `<button type="button" class="rank-badge${cls}" data-act="rank-detail" ` +
    `title="契约值 ${score}" aria-label="当前段位 ${escapeHtml(name)}，契约值 ${score}">` +
    `<span class="rank-badge-icon" aria-hidden="true">${escapeHtml(rank.icon || "✦")}</span>` +
    `<span class="rank-badge-name">${escapeHtml(name)}</span>` +
    `<span class="rank-badge-score">${score}</span>` +
    `</button>`
  );
}

/**
 * C1 段位卡（星历页整块）。
 * @param {Object} prog Rank.rankProgress() 的返回
 * @param {Array} table Rank.visibleTable() 的返回
 * @returns {string} HTML 字符串
 */
function uiRankCard(prog, table) {
  const p = prog && typeof prog === "object" ? prog : {};
  const cur = p.current || { name: "初见微光", icon: "✦", score: 0 };
  const pct = uiClamp(Number(p.percent) || 0, 0, 100);

  let next = "";
  if (p.next) {
    next =
      `<p class="rank-next">距 <b>${escapeHtml(p.next.name)}</b> 还差 ` +
      `${Number(p.remain) || 0} 点契约值` +
      (p.blockedBy ? `（${escapeHtml(p.blockedBy)}）` : "") +
      `</p>`;
  } else {
    next = `<p class="rank-next">已至顶端。剩下的事，只是继续亮着。</p>`;
  }

  let rows = "";
  const list = Array.isArray(table) ? table : [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const isCur = t.key === cur.key;
    const locked = !isCur && Number(t.min) > (Number(cur.score) || 0);
    rows +=
      `<div class="rank-row${isCur ? " is-current" : ""}${locked ? " is-locked" : ""}">` +
      `<span aria-hidden="true">${escapeHtml(t.icon || "✦")}</span>` +
      `<span>${escapeHtml(t.name || "")}</span>` +
      `<span class="rank-row-min">${Number(t.min) || 0}</span>` +
      `</div>`;
  }

  return (
    `<div class="rank-card-head">` +
    `<span class="rank-card-icon" aria-hidden="true">${escapeHtml(cur.icon || "✦")}</span>` +
    `<div>` +
    `<h3 class="rank-card-name">${escapeHtml(cur.name || "")}</h3>` +
    `<p class="rank-card-tag">${escapeHtml(cur.tagline || "")} · 契约值 ${Number(cur.score) || 0}</p>` +
    `</div></div>` +
    `<div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div>` +
    next +
    `<div class="rank-list">${rows}</div>`
  );
}

/**
 * B3 专注表盘。
 * @param {{minutes?:number,left?:number,percent?:number,phase?:string,
 *          planName?:string,options?:number[]}} st
 * @returns {string} HTML 字符串
 */
function uiFocusDial(st) {
  const s = st && typeof st === "object" ? st : {};
  const R = 82;
  const C = 2 * Math.PI * R;
  const pct = uiClamp(Number(s.percent) || 0, 0, 100);
  const offset = C * (1 - pct / 100);

  const left = Math.max(0, Math.floor(Number(s.left) || 0));
  const mm = Math.floor(left / 60);
  const ss = left % 60;
  const clock = (mm < 10 ? "0" : "") + mm + ":" + (ss < 10 ? "0" : "") + ss;

  const phase = String(s.phase || "idle");
  const phaseText =
    phase === "running"
      ? "专注中"
      : phase === "paused"
      ? "已暂停"
      : phase === "done"
      ? "这一程走完了"
      : "还没开始";

  const opts = Array.isArray(s.options) && s.options.length ? s.options : [15, 25, 45, 60];
  let mins = "";
  if (phase === "idle" || phase === "done") {
    for (let i = 0; i < opts.length; i++) {
      const v = Number(opts[i]) || 25;
      mins +=
        `<button type="button" class="focus-min-btn${v === Number(s.minutes) ? " is-on" : ""}" ` +
        `data-focus-min="${v}">${v} 分</button>`;
    }
    mins = `<div class="focus-mins">${mins}</div>`;
  }

  let acts = "";
  if (phase === "running") {
    acts =
      `<button type="button" class="btn btn-ghost btn-sm" data-focus="pause">暂停</button>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-focus="abort">放弃</button>`;
  } else if (phase === "paused") {
    acts =
      `<button type="button" class="btn btn-primary btn-sm" data-focus="resume">继续</button>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-focus="abort">放弃</button>`;
  } else if (phase === "done") {
    acts =
      `<button type="button" class="btn btn-primary btn-sm" data-focus="convert">点亮这颗星</button>` +
      `<button type="button" class="btn btn-ghost btn-sm" data-focus="reset">再来一程</button>`;
  } else {
    acts = `<button type="button" class="btn btn-primary btn-sm" data-focus="start">开始专注</button>`;
  }

  const plan = s.planName
    ? `<p class="focus-plan">为「${escapeHtml(s.planName)}」而坐</p>`
    : `<p class="focus-plan">不为哪颗星，只为坐得住</p>`;

  return (
    `<div class="focus-dial">` +
    `<div class="focus-ring">` +
    `<svg viewBox="0 0 190 190" aria-hidden="true">` +
    `<circle class="focus-ring-bg" cx="95" cy="95" r="${R}"></circle>` +
    `<circle class="focus-ring-fg" cx="95" cy="95" r="${R}" ` +
    `stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>` +
    `</svg>` +
    `<div class="focus-center">` +
    `<span class="focus-time">${clock}</span>` +
    `<span class="focus-state">${escapeHtml(phaseText)}</span>` +
    `</div></div>` +
    plan +
    mins +
    `<div class="focus-acts">${acts}</div>` +
    `</div>`
  );
}

/**
 * B4 海报预览块。
 * @param {{url?:string,building?:boolean,hideDate?:boolean}} opts
 * @returns {string} HTML 字符串
 */
function uiPosterPreview(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const img = o.url
    ? `<img class="poster-thumb" src="${o.url}" alt="星河契约海报预览" />`
    : `<div class="poster-thumb"></div>`;
  const tip = o.building
    ? "正在描星……"
    : o.url
    ? "长按图片可直接保存；点「下载」拿 2400×3600 原图。"
    : "点一下「生成海报」，把这段日子铺成一张图。";

  return (
    `<div class="poster-prev">` +
    img +
    `<div class="poster-acts">` +
    `<button type="button" class="btn btn-primary btn-sm" data-poster="build">生成海报</button>` +
    (o.url
      ? `<button type="button" class="btn btn-ghost btn-sm" data-poster="save">下载原图</button>`
      : "") +
    `</div>` +
    `<label class="oath-silent"><input type="checkbox" id="poster-hide-date"${
      o.hideDate ? " checked" : ""
    } />海报里不显示日期</label>` +
    `<p class="poster-tip">${escapeHtml(tip)}</p>` +
    `</div>`
  );
}

/**
 * C2 四季主题切换。
 * @param {{mode?:string,value?:string,resolved?:string,list?:Array}} opts
 * @returns {string} HTML 字符串
 */
function uiThemeSwitch(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const list = Array.isArray(o.list) ? o.list : [];
  const mode = o.mode === "manual" ? "manual" : "auto";
  const cur = String(o.value || o.resolved || "origin");

  let chips =
    `<button type="button" class="theme-chip${mode === "auto" ? " is-on" : ""}" ` +
    `data-theme-mode="auto">🕰 跟随时辰</button>`;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const on = mode === "manual" && t.key === cur;
    chips +=
      `<button type="button" class="theme-chip${on ? " is-on" : ""}" data-theme-set="${escapeHtml(
        t.key
      )}">` +
      `<span class="theme-dot" style="background:${escapeHtml(t.dot || "#f2c14e")}"></span>` +
      `${escapeHtml(t.name || t.key)}</button>`;
  }

  const note =
    mode === "auto"
      ? `现在是「${escapeHtml(o.resolvedName || o.resolved || "原初")}」。深夜、清晨、白日、黄昏各有各的天色。`
      : `锁定在「${escapeHtml(o.resolvedName || cur)}」，不再随时间变。`;

  return (
    `<div class="theme-switch">` +
    `<div class="theme-row">${chips}</div>` +
    `<p class="theme-note">${note}</p>` +
    `</div>`
  );
}

/**
 * C3 情绪选择器。
 * @param {{moods?:Array,selected?:string,note?:string,max?:number}} opts
 * @returns {string} HTML 字符串
 */
function uiMoodPicker(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const list = Array.isArray(o.moods) ? o.moods : [];
  const sel = String(o.selected || "");
  const max = Number(o.max) || 60;
  const note = String(o.note || "");

  let chips = "";
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const on = m.key === sel;
    const col = `hsl(${Number(m.hue) || 45} 80% 68%)`;
    chips +=
      `<button type="button" class="mood-chip${on ? " is-on" : ""}" ` +
      `data-mood="${escapeHtml(m.key)}" style="color:${on ? col : ""}">` +
      `<span aria-hidden="true">${escapeHtml(m.icon || "•")}</span>` +
      `${escapeHtml(m.name || m.key)}</button>`;
  }

  return (
    `<div class="mood-picker">` +
    `<div class="mood-row">${chips}</div>` +
    `<textarea class="mood-note" id="mood-note" rows="2" maxlength="${max}" ` +
    `placeholder="想说一句就说一句，不说也行">${escapeHtml(note)}</textarea>` +
    `<div class="mood-count"><span id="mood-count">${note.length}</span>/${max}</div>` +
    `</div>`
  );
}

/**
 * C3 情绪光谱条。
 * @param {{items?:Array,total?:number}} spec MoodStore.spectrum() 的返回
 * @returns {string} HTML 字符串
 */
function uiSpectrum(spec) {
  const s = spec && typeof spec === "object" ? spec : {};
  const items = Array.isArray(s.items) ? s.items : [];
  const total = Number(s.total) || 0;
  if (!total) {
    return `<p class="review-empty">还没有记过心情。点亮的时候顺手选一个就好。</p>`;
  }

  let segs = "";
  let keys = "";
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const n = Number(it.count) || 0;
    if (n <= 0) continue;
    const col = `hsl(${Number(it.hue) || 45} 78% 62%)`;
    segs += `<span class="spectrum-seg" style="flex:${n};background:${col}"></span>`;
    keys +=
      `<span class="spectrum-key">` +
      `<i class="spectrum-swatch" style="background:${col}"></i>` +
      `${escapeHtml(it.name || it.key)} ${n}</span>`;
  }

  return `<div class="spectrum-bar">${segs}</div><div class="spectrum-legend">${keys}</div>`;
}

/**
 * C5 阶段回望块。
 * @param {Object} data Review.renderReview() 的返回
 * @param {string} scope 当前 tab
 * @returns {string} HTML 字符串
 */
function uiReviewBlock(data, scope) {
  const d = data && typeof data === "object" ? data : {};
  const cur = String(scope || d.scope || "week");
  const tabs = [
    { key: "week", name: "这一周" },
    { key: "month", name: "这一月" },
    { key: "year", name: "这一年" }
  ];

  let tabHtml = "";
  for (let i = 0; i < tabs.length; i++) {
    tabHtml +=
      `<button type="button" class="review-tab${tabs[i].key === cur ? " is-on" : ""}" ` +
      `data-review="${tabs[i].key}">${tabs[i].name}</button>`;
  }

  const head =
    `<div class="review-head">` +
    `<div><h3 class="review-title">${escapeHtml(d.title || "回望")}</h3>` +
    `<p class="review-sub">${escapeHtml(d.subtitle || "")}</p></div>` +
    `<div class="review-tabs">${tabHtml}</div>` +
    `</div>`;

  if (d.empty) {
    return (
      head +
      `<p class="review-empty">这一段还是空的。空着也没关系，明天再来填。</p>`
    );
  }

  let secs = "";
  const list = Array.isArray(d.sections) ? d.sections : [];
  for (let i = 0; i < list.length; i++) {
    const sec = list[i];
    if (!sec || !sec.body) continue;
    secs +=
      `<div class="review-sec">` +
      `<span class="review-sec-title">${escapeHtml(sec.title || "")}</span>` +
      `<p class="review-sec-body">${escapeHtml(sec.body)}</p>` +
      `</div>`;
  }

  const poem = d.poem ? `<p class="review-poem">${escapeHtml(d.poem)}</p>` : "";
  return head + secs + poem;
}

/**
 * D2 白噪音三选一。
 * @param {{scenes?:Array,current?:string,volume?:number}} opts
 * @returns {string} HTML 字符串
 */
function uiWhiteNoise(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const list = Array.isArray(o.scenes) ? o.scenes : [];
  const cur = String(o.current || "");
  const vol = uiClamp(Number(o.volume) * 100 || 70, 0, 100);

  let cards = "";
  let desc = "";
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const on = s.key === cur;
    if (on) desc = s.desc || "";
    cards +=
      `<button type="button" class="wn-card${on ? " is-on" : ""}" data-wn="${escapeHtml(s.key)}">` +
      `<span class="wn-icon" aria-hidden="true">${escapeHtml(s.icon || "♪")}</span>` +
      `<span>${escapeHtml(s.name || s.key)}</span>` +
      `</button>`;
  }

  return (
    `<div class="wn-grid">${cards}</div>` +
    `<p class="wn-desc">${escapeHtml(desc || "选一个，让房间里有点别的声音。再点一次就关。")}</p>` +
    `<input class="wn-vol" type="range" id="wn-vol" min="0" max="100" value="${vol}" ` +
    `aria-label="白噪音音量" />`
  );
}

/**
 * D3 星图互鉴。
 * @param {{code?:string,result?:Object,error?:string}} opts
 * @returns {string} HTML 字符串
 */
function uiFriendCompare(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const mine =
    `<code class="fm-code" id="fm-my-code">${escapeHtml(o.code || "————")}</code>` +
    `<div class="poster-acts" style="margin-top:10px">` +
    `<button type="button" class="btn btn-ghost btn-sm" data-fm="copy">复制我的短码</button>` +
    `</div>` +
    `<p class="poster-tip">短码里只有几个数字，没有你的计划名，也没有任何日期明细。</p>`;

  const input =
    `<input class="fm-input" id="fm-input" placeholder="粘贴朋友的短码" ` +
    `autocomplete="off" spellcheck="false" />` +
    `<div class="poster-acts" style="margin-top:10px">` +
    `<button type="button" class="btn btn-primary btn-sm" data-fm="read">对照看看</button>` +
    `</div>`;

  let body = "";
  if (o.error) {
    body = `<p class="review-empty">${escapeHtml(o.error)}</p>`;
  } else if (o.result && o.result.ok) {
    const r = o.result;
    let rows = "";
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i];
      rows +=
        `<div class="fm-row">` +
        `<div class="fm-row-head"><span>${escapeHtml(row.label)}</span>` +
        `<span>我 ${row.mine}${escapeHtml(row.unit)} · 他 ${row.his}${escapeHtml(row.unit)}</span></div>` +
        `<div class="fm-bars">` +
        `<div class="fm-bar mine"><i style="width:${row.minePct}%"></i></div>` +
        `<div class="fm-bar his"><i style="width:${row.hisPct}%"></i></div>` +
        `</div></div>`;
    }
    body =
      `<div class="fm-rows">${rows}</div>` +
      `<p class="fm-word">对方段位：${escapeHtml(r.his.rankName || "未知")}。${escapeHtml(
        r.word || ""
      )}</p>`;
  }

  return mine + `<div style="margin-top:16px">${input}${body}</div>`;
}
