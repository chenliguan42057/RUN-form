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
 * ⚠️ 自动重载去重策略（防「反复自我刷新」）—— 按**时间窗**去重：
 *   仅用模块级 `reloading` 挡不住 —— reload 后脚本重新求值，标记就被重置为 false，
 *   于是「reload → controllerchange → reload → …」可能无限循环。
 *   这里追加 sessionStorage 层：sessionStorage 在同一标签页跨 reload 存活，
 *   因此 reload 前落盘一个**时间戳**，新页面加载后若仍在时间窗内即不再自动 reload。
 *
 *   为什么用时间窗而不是「版本标识」：
 *     reload 后新页面会在极短时间（毫秒级～秒级）内因同一次接管而**再次 fire**
 *     controllerchange，而真正的新版本接管必然隔很久（用户下次访问）。
 *     因此要区分的不是「版本号」，而是「这是不是**同一次接管事件**」——
 *     时间窗正好刻画这一点：同一次接管落在窗口内 → 拦下（杜绝死循环）；
 *     新版本接管（下次访问）落在窗口外 → 放行自动刷一次（保留无感升级）。不依赖任何版本号。
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
      // 点横幅前先过同一套去重判定：刚刚已自动刷过一次就不再刷第二次。
      if (hasReloadedRecently()) {
        bar.textContent = "正在刷新…";
        return;
      }
      // 先落标记再触发接管，为随后的 controllerchange 自动路径留下标记，
      // 避免「点击路径」与「controllerchange 路径」各刷一次造成双跳。
      reloadOnce(function () {
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

  // 模块级去重锁：同一页面生命周期内只放行一次 reload（跨 reload 靠 sessionStorage 时间窗）。
  var reloading = false;

  /**
   * 去重后执行一次 reload 动作。两条路径（横幅点击 / controllerchange）共用，
   * 任一条先跑都会为另一条留下「刚刚刷过」的时间戳。
   *
   * @param {function(): void} action 真正触发刷新的副作用
   * @return {boolean} 是否真正放行
   */
  function reloadOnce(action) {
    if (reloading) return false; // ① 同一页面生命周期内只放行一次
    if (hasReloadedRecently()) {
      if (window.console && console.log) console.log("[SW] 刚完成接管重载，跳过重复刷新");
      return false; // ② 跨 reload 时间窗锁：同一次接管不再刷第二次
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
