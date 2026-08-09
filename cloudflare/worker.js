/**
 * 星河契约 RUN-form · 无令牌同步代理（Cloudflare Worker）
 * ------------------------------------------------------------------
 * 作用：站点（手机端）不持有任何 GitHub PAT，只把同步数据 POST 给本 Worker；
 *      Worker 用藏在【密钥】里的 GH_PAT 转发 repository_dispatch 给 GitHub。
 *      这样 PAT 永不进入公开的前端代码、也永不出现在用户手机上。
 *
 * 密钥（用 `wrangler secret put` 设置，不要写进本文件 / 仓库）：
 *   GH_PAT      —— 用户的 GitHub Personal Access Token（repo 权限）
 *   APP_KEY     —— 与前端 SYNC_APP_KEY 一致的共享密钥，用于挡掉陌生人滥用
 *
 * 变量（可写在 wrangler.toml [vars]，非机密）：
 *   GH_OWNER / GH_REPO / ALLOWED_ORIGIN / ALLOWED_EVENTS
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-App-Key",
    };

    // 预检
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    // 共享密钥校验：挡掉随手乱调
    const appKey = request.headers.get("X-App-Key");
    if (!env.APP_KEY || appKey !== env.APP_KEY) {
      return new Response("Forbidden", { status: 403, headers: cors });
    }

    // 来源校验（浏览器端跨域调用会被 CORS 拦，这里再补一刀）
    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== env.ALLOWED_ORIGIN) {
        return new Response("Forbidden", { status: 403, headers: cors });
      }
    }

    // 解析请求体
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400, headers: cors });
    }
    const { event_type, client_payload } = body || {};
    if (!event_type || !client_payload || typeof client_payload !== "object") {
      return new Response("Missing event_type or client_payload", { status: 400, headers: cors });
    }
    if (env.ALLOWED_EVENTS) {
      const allowed = env.ALLOWED_EVENTS.split(",").map((s) => s.trim());
      if (!allowed.includes(event_type)) {
        return new Response("Event not allowed", { status: 403, headers: cors });
      }
    }

    // 转发给 GitHub repository_dispatch（带 GH_PAT）
    try {
      const gh = await fetch(
        `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GH_PAT}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            "User-Agent": "runform-proxy",
          },
          body: JSON.stringify({ event_type, client_payload }),
        }
      );
      if (!gh.ok) {
        const t = await gh.text();
        return new Response("GitHub error " + gh.status + ": " + t, {
          status: 502,
          headers: cors,
        });
      }
      return new Response(JSON.stringify({ ok: true, event_type }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response("Upstream error: " + e.message, {
        status: 502,
        headers: cors,
      });
    }
  },
};
