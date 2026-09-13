/**
 * Service Worker · 阳光花园 v2.0
 *
 * 相比 v1 的三处关键改动（否则老用户浏览器会继续跑 v1 缓存，看到的还是星河页面）：
 *   1. CACHE_VERSION 必须改 —— 版本号没变浏览器就不会重新安装，旧 index.html 一直生效。
 *   2. HTML 改 **network-first**（v1 是 cache-first）：上线当天立刻拿到新页面；离线再回落缓存。
 *   3. install 里 skipWaiting() + activate 里 clients.claim()，并**删除所有旧版本缓存**。
 *
 * 其余策略：
 *   · JS / CSS：stale-while-revalidate（先给缓存保证秒开，后台悄悄更新）。
 *   · data/*.json：network-first（永远要最新的仓库数据）。
 *   · 非 GET / 跨域：直接放行，不接管。
 *
 * ⚠️ PRECACHE_ASSETS 里**绝不能**出现任何 v1 孤儿文件名（app.js / app2.js / styles.css …），
 *    否则阶段二归档删除后预缓存会 404 并让 install 失败。
 */

const CACHE_VERSION = "v2.0-20260913";
const STATIC_CACHE = `runform-static-${CACHE_VERSION}`;
const DATA_CACHE = `runform-data-${CACHE_VERSION}`;

/** 必须离线可用的核心静态资源（全部是 v2 新路径，路径相对 /RUN-form/ 子路径仓库）。 */
const PRECACHE_ASSETS = [
  "/RUN-form/",
  "/RUN-form/index.html",
  "/RUN-form/manage.html",
  "/RUN-form/shop.html",
  "/RUN-form/stats.html",
  "/RUN-form/manifest.webmanifest",
  "/RUN-form/register-sw.js",

  // 样式：tokens / base 由地基提供，其余 5 个由 B、C 组实现
  "/RUN-form/styles/tokens.css",
  "/RUN-form/styles/base.css",
  "/RUN-form/styles/scene.css",
  "/RUN-form/styles/pet.css",
  "/RUN-form/styles/garden.css",
  "/RUN-form/styles/ui.css",
  "/RUN-form/styles/shop.css",

  // 核心层
  "/RUN-form/js/core/util.js",
  "/RUN-form/js/core/bus.js",
  "/RUN-form/js/core/storage.js",
  "/RUN-form/js/core/boot.js",
  "/RUN-form/js/core/content.js",

  // 数据层
  "/RUN-form/js/data/schema.js",
  "/RUN-form/js/data/store.js",

  // 玩法系统层
  "/RUN-form/js/systems/pet.js",
  "/RUN-form/js/systems/garden.js",
  "/RUN-form/js/systems/coupon.js",
  "/RUN-form/js/systems/punishment.js",
  "/RUN-form/js/systems/rpg.js",
  "/RUN-form/js/systems/countdown.js",
  "/RUN-form/js/systems/habits.js",

  // 表现层
  "/RUN-form/js/ui/scene.js",
  "/RUN-form/js/ui/fx.js",
  "/RUN-form/js/ui/components.js",

  // 页面层
  "/RUN-form/js/pages/home.js",
  "/RUN-form/js/pages/manage.js",
  "/RUN-form/js/pages/shop.js",
  "/RUN-form/js/pages/stats.js",

  // PWA 图标
  "/RUN-form/assets/icon-192.png",
  "/RUN-form/assets/icon-512.png",
  "/RUN-form/assets/icon-maskable-512.png",
  "/RUN-form/assets/apple-touch-icon.png",
  "/RUN-form/assets/favicon-32.png",
];

/** 是否是本站同源资源（本地 file:// / localhost 下不接管）。 */
function isSameOrigin(req) {
  try {
    const url = new URL(req.url);
    if (url.origin !== location.origin) return false;
    return url.pathname.startsWith("/RUN-form/");
  } catch (e) {
    return false;
  }
}

/** @return {boolean} 是否命中预缓存清单 */
function isPrecacheable(url) {
  return PRECACHE_ASSETS.some((p) => url.pathname === p || url.pathname === p + "/");
}

/** @return {boolean} */
function isHTML(url) {
  return url.pathname.endsWith(".html") || url.pathname.endsWith("/RUN-form/") || url.pathname === "/RUN-form";
}

/** @return {boolean} */
function isData(url) {
  return url.pathname.indexOf("/RUN-form/data/") === 0 && url.pathname.endsWith(".json");
}

/** 写入 DATA_CACHE（失败静默，缓存写不进不影响用户看到内容）。 */
function putDataCache(req, resp) {
  return caches.open(DATA_CACHE).then((cache) => cache.put(req, resp.clone())).catch(() => {});
}

/** 写入 STATIC_CACHE。 */
function putStaticCache(req, resp) {
  return caches.open(STATIC_CACHE).then((cache) => cache.put(req, resp.clone())).catch(() => {});
}

/** network-first：先网络，失败回落缓存。 */
async function networkFirst(req, cacheName) {
  try {
    const resp = await fetch(req);
    if (resp && resp.ok) {
      if (cacheName === DATA_CACHE) putDataCache(req, resp);
      else putStaticCache(req, resp);
      return resp;
    }
    if (resp) return resp;
    throw new Error("empty response");
  } catch (err) {
    const cached = await caches.match(req, { cacheName });
    if (cached) return cached;
    const anyCached = await caches.match(req);
    if (anyCached) return anyCached;
    throw err;
  }
}

/** stale-while-revalidate：先给缓存，后台更新。 */
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req, { cacheName: STATIC_CACHE });
  const network = fetch(req)
    .then((resp) => {
      if (resp && resp.ok) putStaticCache(req, resp);
      return resp;
    })
    .catch(() => null);
  if (cached) return cached;
  const resp = await network;
  if (resp) return resp;
  throw new Error("offline and no cache: " + req.url);
}

async function route(req) {
  const url = new URL(req.url);
  if (isData(url) || isHTML(url)) return networkFirst(req, isData(url) ? DATA_CACHE : STATIC_CACHE);
  if (isPrecacheable(url)) return staleWhileRevalidate(req);
  return networkFirst(req, STATIC_CACHE);
}

// ---- install：建新缓存并预缓存核心资源；skipWaiting 立刻接管 ----
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.error("[SW] precache 失败（不阻塞安装）：", err))
  );
});

// ---- activate：清掉**所有**旧版本缓存（runform-* 且不等于当前两个）----
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.indexOf("runform-") === 0 && k !== STATIC_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---- fetch：只接管同源 GET ----
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (!isSameOrigin(req)) return;
  event.respondWith(route(req));
});

// ---- 页面主动调用：跳过等待立即换新版（register-sw.js 的横幅按钮用）----
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
