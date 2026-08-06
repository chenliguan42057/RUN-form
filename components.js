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
    { key: "home", href: "index.html", icon: "🌌", label: "仪表盘" },
    { key: "manage", href: "manage.html", icon: "🛠", label: "管理" },
    { key: "stats", href: "stats.html", icon: "📊", label: "统计" },
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
