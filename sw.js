/**
 * Service Worker for RUN-form「星河契约」
 *
 * 策略：静态资源 precache + 数据/图片 network-first。
 * 原因：
 *   · HTML/JS/CSS 版本化强，适合预先缓存，离线直接打开
 *   · data/*.json 和背景图可能更新，network-first 保证最新；离线再读缓存
 *
 * 更新时机：文件内容变化 → sw.js 内容变化（本文件里的 CACHE_VERSION 常量）
 *          → 浏览器触发 install/activate 换缓存。
 */

const CACHE_VERSION = "v6.1-20260808";
const STATIC_CACHE = `runform-static-${CACHE_VERSION}`;
const DATA_CACHE = `runform-data-${CACHE_VERSION}`;

/**
 * 必须离线可用的核心静态资源。
 * 注意：所有路径都是相对于 /RUN-form/ 子路径仓库。
 */
const PRECACHE_ASSETS = [
  "/RUN-form/",
  "/RUN-form/index.html",
  "/RUN-form/manage.html",
  "/RUN-form/stats.html",
  "/RUN-form/styles.css",
  "/RUN-form/store.js",
  "/RUN-form/components.js",
  "/RUN-form/app.js",
  "/RUN-form/app2.js",
  "/RUN-form/app3.js",
  // v6 模块：漏一个就是离线白屏，加文件必须同步加这里
  "/RUN-form/sensory.js",
  "/RUN-form/theme.js",
  "/RUN-form/rank.js",
  "/RUN-form/mood.js",
  "/RUN-form/celebrate.js",
  "/RUN-form/focus.js",
  "/RUN-form/onboarding.js",
  "/RUN-form/poster.js",
  "/RUN-form/review.js",
  "/RUN-form/shortcuts.js",
  "/RUN-form/whitenoise.js",
  "/RUN-form/ambient.js",
  "/RUN-form/friendmap.js",
  "/RUN-form/screensaver.js",
  "/RUN-form/register-sw.js",
  "/RUN-form/manifest.webmanifest",
  "/RUN-form/assets/icon-192.png",
  "/RUN-form/assets/icon-512.png",
  "/RUN-form/assets/icon-maskable-512.png",
  "/RUN-form/assets/apple-touch-icon.png",
  "/RUN-form/assets/favicon-32.png",
];

/**
 * 检查某个 URL 是否属于我们托管在 GitHub Pages 上的资源。
 * 在本地 file:// 或 localhost 测试时，同源判定会不一样，这里尽量宽松。
 */
function isSameOrigin(req) {
  try {
    const url = new URL(req.url);
    if (url.origin !== location.origin) return false;
    return url.pathname.startsWith("/RUN-form/");
  } catch (e) {
    return false;
  }
}

/**
 * 优先命中 precache 清单里的资源。
 */
function isPrecacheable(url) {
  return PRECACHE_ASSETS.some((p) => url.pathname === p || url.pathname === p + "/");
}

// ---- install：开新缓存并把核心资源塞进去 ----
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.error("[SW] precache 失败：", err))
  );
});

// ---- activate：清掉旧版本缓存 ----
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("runform-") && k !== STATIC_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ---- fetch：静态 cache-first，数据 network-first ----
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 非 GET 或跨域请求不处理
  if (req.method !== "GET") return;
  if (!isSameOrigin(req)) return;

  event.respondWith(route(req));
});

async function route(req) {
  const url = new URL(req.url);

  // 1) 核心静态资源：优先读缓存，缓存没有再请求并写入
  if (isPrecacheable(url)) {
    const cached = await caches.match(req, { cacheName: STATIC_CACHE });
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, resp.clone());
      }
      return resp;
    } catch (err) {
      console.warn("[SW] 静态资源 fetch 失败且无缓存：", url.pathname, err);
      throw err;
    }
  }

  // 2) 数据文件 / 背景图：优先走网络，失败再读缓存
  try {
    const resp = await fetch(req);
    if (resp.ok) {
      const cache = await caches.open(DATA_CACHE);
      cache.put(req, resp.clone());
    }
    return resp;
  } catch (err) {
    const cached = await caches.match(req, { cacheName: DATA_CACHE });
    if (cached) {
      console.warn("[SW] 网络失败，使用缓存：", url.pathname);
      return cached;
    }
    throw err;
  }
}
