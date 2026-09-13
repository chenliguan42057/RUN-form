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
 * ⚠️ 自动重载去重策略（防「反复自我刷新」）：
 *   仅用模块级 `reloading` 挡不住 —— reload 后脚本重新求值，标记就被重置为 false，
 *   于是「reload → controllerchange → reload → …」可能无限循环。
 *   这里追加 sessionStorage 层：sessionStorage 在同一标签页跨 reload 存活，
 *   因此 reload 前落盘一个**版本标识**，新页面加载后读到同一标识即不再自动 reload。
 *
 *   去重粒度是「按版本」，不是「按会话」：
 *     · 同一版本重复接管  → 标识命中      → 不再 reload（杜绝死循环）
 *     · 新版本首次接管    → 标识不命中    → 自动 reload 恰好一次（保留无感升级）
 *
 *   存储不可用（隐私模式 / 站点数据被封锁）时：读写都会抛错，此时**保守放弃自动重载**，
 *   退回到「只依赖用户点横幅」，绝不能因为「读不到标记」就每次加载都刷。
 */
(function () {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (!window.isSecureContext && !/^localhost$/i.test(location.hostname)) return;

  /** sessionStorage key：上次自动 reload 时所依据的 SW 版本标识。 */
  var RELOAD_FLAG = "rf-sw-reloaded-ver";

  /**
   * 取当前 SW 的版本标识（用作去重粒度）。
   *
   * 优先取 controller 的 scriptURL：`controllerchange` fire 时 controller 已经指向
   * **新** worker，因此写入侧与「新页面加载后」的读取侧取到的是同一个 URL，两端口径一致。
   * 若非安全上下文等原因取不到 controller，再退到 registration 上的 active/waiting/installing。
   * 全失败则返回 "unknown"（仍是一个稳定值，不会退化成每次都刷）。
   *
   * @param {ServiceWorkerRegistration|null} reg
   * @return {string}
   */
  function getSwVersion(reg) {
    try {
      var ctrl = navigator.serviceWorker.controller;
      if (ctrl && ctrl.scriptURL) return ctrl.scriptURL;
    } catch (e) {
      /* 忽略，继续尝试 registration */
    }
    try {
      var w = reg && (reg.active || reg.waiting || reg.installing);
      if (w && w.scriptURL) return w.scriptURL;
    } catch (e) {
      /* 忽略 */
    }
    return "unknown";
  }

  /**
   * 判断「本页面这次加载之前，是否已经为本版本自动 reload 过」。
   *
   * 存储不可用时会抛错 —— 此时**保守返回 true**（当作「已重载过」），宁可少刷一次，
   * 也绝不允许因为读不到标记而每次加载都 reload，形成无限自我刷新。
   *
   * @param {ServiceWorkerRegistration|null} reg
   * @return {boolean}
   */
  function hasReloadedThisVersion(reg) {
    var ver = getSwVersion(reg);
    try {
      return window.sessionStorage.getItem(RELOAD_FLAG) === ver;
    } catch (e) {
      return true; // 无法读取存储 → 保守放弃自动重载
    }
  }

  /**
   * 记录「已为本版本自动 reload 过」。写入失败静默（不影响注册流程）。
   * @param {ServiceWorkerRegistration|null} reg
   * @return {void}
   */
  function markReloadedThisVersion(reg) {
    var ver = getSwVersion(reg);
    try {
      window.sessionStorage.setItem(RELOAD_FLAG, ver);
    } catch (e) {
      /* 隐私模式 / 存储被禁用：无法持久标记，退化为仅模块级 reloading 保护 */
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
      // 点横幅前先过同一套去重判定：本版本已自动刷过一次就不再刷第二次。
      if (hasReloadedThisVersion(reg)) {
        bar.textContent = "正在刷新…";
        return;
      }
      // 先落标记再触发接管，为随后的 controllerchange 自动路径留下标记，
      // 避免「点击路径」与「controllerchange 路径」各刷一次造成双跳。
      reloadOnce(reg, function () {
        bar.textContent = "正在刷新…";
        var w = reg.waiting || reg.installing;
        if (w) w.postMessage({ type: "SKIP_WAITING" });
        window.setTimeout(function () {
          window.location.reload();
        }, 300);
      });
    });

    document.body.appendChild(bar);
  }

  // 模块级去重锁：同一页面生命周期内只放行一次 reload（跨 reload 靠 sessionStorage）。
  var reloading = false;

  /**
   * 去重后执行一次 reload 动作。两条路径（横幅点击 / controllerchange）共用，
   * 任一条先跑都会为另一条留下「已刷过」标记。
   *
   * @param {ServiceWorkerRegistration|null} reg
   * @param {function(): void} action 真正触发刷新的副作用
   * @return {boolean} 是否真正放行
   */
  function reloadOnce(reg, action) {
    if (reloading) return false; // ① 同一页面生命周期内只放行一次
    if (hasReloadedThisVersion(reg)) {
      if (window.console && console.log) console.log("[SW] 本版本已完成接管重载，跳过重复刷新");
      return false; // ② 跨 reload 锁：本版本已刷过一次
    }
    reloading = true;
    markReloadedThisVersion(reg); // 必须在 reload 之前落盘，否则新页面读不到
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
        reloadOnce(reg, function () {
          window.location.reload();
        });
      });
    })
    .catch(function (err) {
      if (window.console && console.warn) console.warn("[SW] 注册失败：", err);
    });
})();
