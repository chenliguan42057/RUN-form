/**
 * PWA Service Worker 注册 · 阳光花园 v2
 *
 * 设计得很克制：
 *   · 只在安全上下文（HTTPS / localhost）尝试注册，file:// 直接跳过
 *   · 注册失败只在控制台打印，不弹窗打扰
 *   · 检测到新版本（updatefound + installed）→ 顶部横幅提示「有新版本，刷新看看」
 *   · controllerchange（新 SW 接管）→ 自动 reload **一次**，且跨 reload 去重
 *
 * 归属：地基（T01）。v1 只打 console.log，v2 补上用户可见的刷新横幅（§6.3 第 3 条）。
 *
 * ⚠️ 自动重载去重策略（防「反复自我刷新」）—— 两层锁：
 *   第一层 · 时间窗：仅用模块级 `reloading` 挡不住 —— reload 后脚本重新求值，标记就被重置，
 *     于是「reload → controllerchange → reload → …」可能无限循环。因此追加 sessionStorage
 *     时间戳，sessionStorage 在同一标签页跨 reload 存活，新页面加载后若仍在窗口内即不再自动
 *     reload。要区分的不是「版本号」，而是「这是不是**同一次接管事件**」：同一次接管引发的
 *     重复 controllerchange 必然在毫秒～秒级内爆发（窗口内→拦下），真正的新版本接管必然隔
 *     很久（用户下次访问，窗口外→放行）。不依赖任何版本号。
 *   第二层 · 同会话硬上限（MAX_AUTO_RELOAD）：即便时间窗被绕过（例如反复快速换版本），
 *     一个标签页会话内的自动 reload 次数也绝不超过上限，计数只增不减、不衰减。
 *
 *   横幅点击为**手动路径**，不受上述两层锁限制 —— 用户随时点都能刷新。
 *
 *   存储不可用（隐私模式 / 站点数据被封锁）时：读写都会抛错，此时**保守放弃自动重载**，
 *   退回到「只依赖用户点横幅」，绝不能因为「读不到标记」就每次加载都刷。
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && !/^localhost$/i.test(location.hostname)) return;

  /** sessionStorage key：上次自动 reload 的时间戳（毫秒）。 */
  var RELOAD_AT_KEY = "rf-sw-reload-at";
  /** 去重时间窗：同一次接管事件必然在此窗口内重复 fire，超出即视为新版本接管。 */
  var WINDOW_MS = 5000;
  /** sessionStorage key：本标签页会话内已自动 reload 的次数。 */
  var RELOAD_COUNT_KEY = "rf-sw-reload-count";
  /** 同会话自动 reload 硬上限（防止时间窗被绕过时无限刷）。 */
  var MAX_AUTO_RELOAD = 2;

  /**
   * 判断「刚刚（时间窗内）是否已经自动 reload 过」。
   *
   * 取值分三种：
   *   ① 无记录（首次访问，从未刷过）→ 返回 false（允许本次自动刷一次）。
   *   ② 有记录且时间差 < 窗口 → 返回 true（同一次接管的重入 → 拦下）。
   *   ③ 有记录但时间差 >= 窗口 → 返回 false（新版本接管 → 放行自动刷一次）。
   *
   * 取舍：仅当**确实存在一条记录**但解析失败、或**存储不可用抛错**时，才**保守返回 true**
   *   （当作「已刷过」）。因为这两种情况都无法安全区分「刚刷过」与「没刷过」，
   *   此时宁可**少刷一次**（用户还有横幅可手动刷新兜底），也绝不允许误判为「没刷过」
   *   从而每次加载都 reload、形成无限自我刷新。
   *   注意：**「无记录」不等于「存储损坏」**——无记录是首次访问的正常状态，必须放行，
   *   否则首次接管永远不会自动刷。
   *
   * @return {boolean}
   */
  function hasReloadedRecently() {
    var raw;
    try {
      raw = window.sessionStorage.getItem(RELOAD_AT_KEY);
    } catch (e) {
      return true; // 存储不可用 → 保守视为已刷过，绝不每次刷
    }
    if (raw === null || raw === undefined || raw === "") return false; // ① 无记录 → 放行
    var last = Number(raw);
    if (!isFinite(last)) return true; // 有记录但解析失败 → 保守视为已刷过
    return Date.now() - last < WINDOW_MS; // ② 窗口内 → true；③ 窗口外 → false
  }

  /** 记录「刚刚自动 reload 过」。写入失败静默（不影响注册流程）。 */
  function markReloadedNow() {
    try {
      window.sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
    } catch (e) {
      /* 隐私模式 / 存储被禁用：无法持久标记，退化为仅模块级 reloading 保护 */
    }
  }

  /**
   * 读取「本会话已自动 reload 的次数」。
   *
   * 返回值刻意区分两种情况：
   *   · 无记录（首次访问，从未自动刷过）→ 返回 **0**（合法初始值）。
   *   · 存储不可用 / 读到的值非法 → 返回 **null**，调用方据此**保守放弃自动刷**。
   * 用 null 而非 0 表示「读不到」，避免把「存储坏了」误当成「还没刷过」而无限刷。
   *
   * @return {number|null}
   */
  function readAutoReloadCount() {
    var raw;
    try {
      raw = window.sessionStorage.getItem(RELOAD_COUNT_KEY);
    } catch (e) {
      return null; // 存储不可用 → 无法保证安全，交给调用方保守放弃
    }
    if (raw === null || raw === undefined || raw === "") return 0; // 无记录 → 0
    var n = Number(raw);
    if (!isFinite(n) || n < 0) return null; // 有记录但非法 → 读不到
    return n;
  }

  /** 自动 reload 计数 +1（只增不减）。写入失败静默（不影响注册流程）。 */
  function bumpAutoReloadCount() {
    var n = readAutoReloadCount();
    if (n === null) return; // 读不到就不写，避免把坏值覆盖成看似正常的数
    try {
      window.sessionStorage.setItem(RELOAD_COUNT_KEY, String(n + 1));
    } catch (e) {
      /* 隐私模式 / 存储被禁用：无法持久计数，退化为仅模块级 reloading 保护 */
    }
  }

  /**
   * 插入「有新版本」横幅。
   * @param {ServiceWorkerRegistration} reg
   * @return {void}
   */
  function showUpdateBanner(reg) {
    if (document.getElementById("sw-update-banner")) return;
    var bar = document.createElement("div");
    bar.id = "sw-update-banner";
    bar.setAttribute("role", "status");
    bar.textContent = "花园长出新芽啦，刷新看看 ✨";
    bar.style.cssText =
      "position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:120;" +
      "padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.92);" +
      "color:#3a3a4a;font-size:13px;font-weight:600;cursor:pointer;" +
      "box-shadow:0 8px 24px rgba(58,58,74,.16);border:1px solid rgba(255,255,255,.9);";

    bar.addEventListener("click", function () {
      // 手动路径：用户随时点都必须能刷新，因此**不做**时间窗 / 计数判定，
      // 只保留 reloadOnce 内的同页面锁（防同一页面双跳）。
      reloadOnce(
        function () {
          bar.textContent = "正在刷新…";
          var w = reg.waiting || reg.installing;
          if (w) w.postMessage({ type: "SKIP_WAITING" });
          window.setTimeout(function () {
            window.location.reload();
          }, 300);
        },
        { manual: true }
      );
    });

    document.body.appendChild(bar);
  }

  // 模块级去重锁：同一页面生命周期内只放行一次 reload（跨 reload 靠 sessionStorage 时间窗）。
  var reloading = false;

  /**
   * 去重后执行一次 reload 动作。两条路径共用：
   *   · 自动路径（controllerchange，不传 opts）→ 走完整两层锁：时间窗 + 同会话硬上限。
   *   · 手动路径（横幅点击，opts.manual === true）→ 只保留同页面锁，随时可刷。
   * 无论哪条路径放行，都会写时间戳与计数，为另一条路径留下痕迹。
   *
   * @param {function(): void} action 真正触发刷新的副作用
   * @param {{manual?: boolean}=} opts 手动路径标记
   * @return {boolean} 是否真正放行
   */
  function reloadOnce(action, opts) {
    var manual = !!(opts && opts.manual);
    if (reloading) return false; // ① 同一页面生命周期内只放行一次（两条路径都受此锁）

    if (!manual) {
      // ② 跨 reload 时间窗锁：同一次接管不再刷第二次
      if (hasReloadedRecently()) {
        if (window.console && console.log) console.log("[SW] 刚完成接管重载，跳过重复刷新");
        return false;
      }
      // ③ 同会话硬上限：本会话自动刷已封顶，交由用户手动
      var n = readAutoReloadCount();
      if (n === null) return false; // 存储不可用 → 保守放弃自动刷
      if (n >= MAX_AUTO_RELOAD) {
        if (window.console && console.log) console.log("[SW] 本会话自动刷新已达上限，请点横幅手动刷新");
        return false;
      }
      bumpAutoReloadCount(); // 先落盘再 reload
    }

    reloading = true;
    markReloadedNow(); // 必须在 reload 之前落盘，否则新页面读不到
    action();
    return true;
  }

  navigator.serviceWorker
    .register("sw.js", { scope: "/RUN-form/" })
    .then(function (reg) {
      if (window.console && console.log) console.log("[SW] 已注册，scope:", reg.scope);

      // 已有新版本在等待 → 立刻提示
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);

      reg.addEventListener("updatefound", function () {
        var worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", function () {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            if (window.console && console.log) console.log("[SW] 新版已就绪");
            showUpdateBanner(reg);
          }
        });
      });

      // 新 SW 接管后自动重载一次，避免用户看到「半新半旧」的混合状态。
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        reloadOnce(function () {
          window.location.reload();
        });
      });
    })
    .catch(function (err) {
      if (window.console && console.warn) console.warn("[SW] 注册失败：", err);
    });
})();
