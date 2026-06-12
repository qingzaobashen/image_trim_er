/**
 * 应用主 Service Worker
 *
 * 职责（合并自 coi-serviceworker v0.1.7 + 自研模型 CDN 主备调度）：
 *  1. 为同源响应注入 COOP / COEP 头，启用 SharedArrayBuffer，
 *     满足 Transformers.js WASM 后端的跨源隔离要求。
 *  2. 对 .onnx / 配置文件 / ort-wasm-* 等模型资源做 CDN 主备调度：
 *     优先 Supabase Storage（国内快，3s 紧超时），失败/超时再降级到
 *     GitHub Pages（同源，可达但慢，给 10s 宽松超时），成功后写入
 *     Cache API 供后续访问直接命中。
 *
 * 配置：在 index.html 通过 `?base=<url>` 查询参数传入 Supabase 桶地址，例如：
 *   /app-serviceworker.js?base=https%3A%2F%2Fxxx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmodels
 *
 * 对 modelManager.js 完全透明，无需改动应用代码。
 */

/* ----------------------------- CDN 主备配置 ----------------------------- */

/** 主 CDN 基础地址（从注册 URL 的 ?base= 解析得到，未配置则跳过主 CDN） */
const SUPABASE_BASE = new URLSearchParams(self.location.search).get('base') || '';

/**
 * 主 CDN（Supabase）超时时间（毫秒）
 * 紧超时：国内访问 Supabase Storage 通常 < 1s，超时意味着主源有问题
 */
const PRIMARY_TIMEOUT_MS = 3000;

/**
 * 备 CDN（GitHub Pages 同源）超时时间（毫秒）
 * 宽松超时：能联通但慢，给足时间让慢源有机会成功
 */
const FALLBACK_TIMEOUT_MS = 10000;

/** 模型资源缓存版本号，发布新模型时建议 +1 让旧缓存失效 */
const CACHE_NAME = 'models-cdn-fallback-v1';

/** 匹配模型相关路径前缀：Xenova/、briaai/、imgly/、U-2-Netp/、onnx/ */
const MODEL_PATH_RE = /^\/(Xenova|briaai|imgly|U-2-Netp|onnx)\//;

/** 匹配模型相关文件后缀 */
const MODEL_FILE_RE = /\.(onnx|json|wasm|mjs)(\?.*)?$/i;

/* -------------------------- COEP 状态（来自 coi） -------------------------- */

/** COEP 是否为 credentialless 模式（Vite dev/preview 配置） */
let coepCredentialless = false;

/* ----------------------------- 生命周期钩子 ----------------------------- */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

/** 处理页面脚本发来的控制消息（兼容 coi 协议） */
self.addEventListener('message', (ev) => {
    if (!ev.data) {
        return;
    } else if (ev.data.type === 'deregister') {
        self.registration
            .unregister()
            .then(() => self.clients.matchAll())
            .then((clients) => clients.forEach((c) => c.navigate(c.url)));
    } else if (ev.data.type === 'coepCredentialless') {
        coepCredentialless = ev.data.value;
    }
});

/* ----------------------------- fetch 拦截 ----------------------------- */

/**
 * 顶层 fetch 事件分发
 * @param {FetchEvent} event 浏览器派发的 fetch 事件
 */
self.addEventListener('fetch', (event) => {
    const r = event.request;

    // 仅处理 GET，避免对预检/POST 等副作用请求的干扰
    if (r.method !== 'GET') return;

    // only-if-cached 的跨源请求交给浏览器默认行为
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

    const requestUrl = new URL(r.url);

    // 跨域请求直接放行，避免影响 Google Fonts / Analytics 等第三方资源
    if (requestUrl.origin !== self.location.origin) return;

    // 模型文件走 CDN 主备调度流程
    if (MODEL_PATH_RE.test(requestUrl.pathname) && MODEL_FILE_RE.test(requestUrl.pathname)) {
        event.respondWith(handleModelRequest(r, requestUrl));
        return;
    }

    // 其他同源请求走 COEP 增强流程
    const request = coepCredentialless && r.mode === 'no-cors'
        ? new Request(r, { credentials: 'omit' })
        : r;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.status === 0) return response;
                const newHeaders = new Headers(response.headers);
                newHeaders.set(
                    'Cross-Origin-Embedder-Policy',
                    coepCredentialless ? 'credentialless' : 'require-corp'
                );
                newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            })
            .catch((e) => {
                console.error('[app-sw] 同源 fetch 失败:', e);
                return new Response(`[app-sw] fetch error: ${e.message}`, {
                    status: 502,
                    statusText: 'Bad Gateway',
                });
            })
    );
});

/* ----------------------------- 模型 CDN 主备核心 ----------------------------- */

/**
 * 构造主 CDN（Supabase）上的远端 URL
 * @param {URL} requestUrl 浏览器请求的同源 URL
 * @returns {string} 拼接后的远端 URL
 */
function buildPrimaryUrl(requestUrl) {
    return SUPABASE_BASE.replace(/\/$/, '') + requestUrl.pathname;
}

/**
 * 处理模型请求：缓存 → 主 CDN（Supabase，3s 紧超时）→ 备 CDN（GitHub，10s 宽松超时）
 * @param {Request} req 浏览器发起的原始请求（同源）
 * @param {URL} requestUrl 解析后的请求 URL（避免重复解析）
 * @returns {Promise<Response>} 响应对象
 */
async function handleModelRequest(req, requestUrl) {
    const cache = await caches.open(CACHE_NAME);

    // 1) 命中缓存：直接返回，并后台静默刷新（stale-while-revalidate 简化版）
    const cached = await cache.match(req);
    if (cached) {
        refreshInBackground(req, cache);
        return cached;
    }

    // 2) 主 CDN：Supabase（国内快，紧超时 3s）
    if (SUPABASE_BASE) {
        const primaryUrl = buildPrimaryUrl(requestUrl);
        try {
            const r = await fetchWithTimeout(primaryUrl, PRIMARY_TIMEOUT_MS);
            if (r.ok) {
                // 给跨源响应补 CORP 头，避免被 credentialless COEP 拦截
                const newHeaders = new Headers(r.headers);
                newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
                const wrapped = new Response(r.clone().body, {
                    status: r.status,
                    statusText: r.statusText,
                    headers: newHeaders,
                });
                cache.put(req, wrapped.clone());
                console.log(`[app-sw] 主 CDN 命中: ${primaryUrl}`);
                return wrapped;
            }
            console.warn(`[app-sw] 主 CDN 返回 ${r.status}，降级到 GitHub: ${primaryUrl}`);
        } catch (e) {
            console.warn(`[app-sw] 主 CDN 失败（${e.name}），降级到 GitHub: ${primaryUrl}`);
        }
    } else {
        console.warn('[app-sw] 未配置主 CDN（?base= 为空），直接走 GitHub 同源');
    }

    // 3) 备 CDN：GitHub Pages 同源（可达但慢，宽松超时 10s）
    try {
        const r = await fetchWithTimeout(req, FALLBACK_TIMEOUT_MS);
        if (r.ok) {
            cache.put(req, r.clone());
            console.log(`[app-sw] 备 CDN 命中: ${req.url}`);
            return r;
        }
        return errorResponse(`备 CDN 状态 ${r.status}: ${req.url}`);
    } catch (e) {
        return errorResponse(`备 CDN 请求失败: ${e.message}`);
    }
}

/**
 * 带超时的 fetch 工具
 * @param {Request} req 请求对象
 * @param {number} ms 超时毫秒数
 * @returns {Promise<Response>} fetch 响应
 */
function fetchWithTimeout(req, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(req, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

/**
 * 后台静默刷新缓存（命中缓存后异步从主 CDN 拉取最新版本）
 * 优先尝试主 CDN（Supabase），失败不重试（当前缓存版本仍可用）
 * @param {Request} req 原始请求（同源 URL）
 * @param {Cache} cache Cache 实例
 * @returns {void}
 */
function refreshInBackground(req, cache) {
    if (!SUPABASE_BASE) return;
    const primaryUrl = buildPrimaryUrl(new URL(req.url));
    fetchWithTimeout(primaryUrl, PRIMARY_TIMEOUT_MS)
        .then((r) => {
            if (r.ok) {
                const newHeaders = new Headers(r.headers);
                newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
                const wrapped = new Response(r.clone().body, {
                    status: r.status,
                    statusText: r.statusText,
                    headers: newHeaders,
                });
                cache.put(req, wrapped);
            }
        })
        .catch(() => {
            // 静默失败：当前缓存版本仍可用，下次再试
        });
}

/**
 * 构造统一的错误响应
 * @param {string} msg 错误描述
 * @returns {Response} 502 响应
 */
function errorResponse(msg) {
    return new Response(`[app-sw] ${msg}`, {
        status: 502,
        statusText: 'Bad Gateway',
    });
}

/* ----------------------------- 主线程自注册 ----------------------------- */

// 兼容 coi 的"脚本即注册"模式：放在主线程中执行时自动注册自身为 SW
if (typeof window !== 'undefined') {
    if ('serviceWorker' in navigator) {
        // 通过当前 <script> 的 src 注册自身，src 中的 ?base= 会带到 SW 作用域
        navigator.serviceWorker
            .register(window.document.currentScript.src)
            .then(() => {
                console.log('[app-sw] 已注册，主 CDN:', SUPABASE_BASE || '(未配置，将直接走 GitHub 同源)');
            })
            .catch((e) => console.warn('[app-sw] 注册失败:', e));
    }
}
