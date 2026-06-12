/**
 * 应用主 Service Worker
 *
 * 职责（合并自 coi-serviceworker v0.1.7 + 自研模型 CDN 兜底）：
 *  1. 为同源响应注入 COOP / COEP 头，启用 SharedArrayBuffer，
 *     满足 Transformers.js WASM 后端的跨源隔离要求。
 *  2. 对 .onnx / 配置文件 / ort-wasm-* 等模型资源做 CDN 兜底：
 *     优先同源（GitHub Pages），4 秒超时后降级到 Supabase Storage，
 *     成功后写入 Cache API 供后续访问直接命中。
 *
 * 配置：在 index.html 通过 `?base=<url>` 查询参数传入 Supabase 兜底地址，
 * 例如：
 *   /app-serviceworker.js?base=https%3A%2F%2Fxxx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fmodels
 *
 * 对 modelManager.js 完全透明，无需改动应用代码。
 */

/* ----------------------------- 兜底 CDN 配置 ----------------------------- */

/** 兜底 CDN 基础地址（从注册 URL 的 ?base= 解析得到） */
const SUPABASE_BASE = new URLSearchParams(self.location.search).get('base') || '';

/** 同源请求超时时间（毫秒），超时即降级到兜底 CDN */
const TIMEOUT_MS = 4000;

/** 模型资源缓存版本号，发布新模型时建议 +1 让旧缓存失效 */
const CACHE_NAME = 'models-cdn-fallback-v1';

/** 匹配模型相关路径前缀：Xenova/、briaai/、imgly/、onnx/ */
const MODEL_PATH_RE = /^\/(Xenova|briaai|imgly|onnx)\//;

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

    // 模型文件走 CDN 兜底流程
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

/* ----------------------------- 模型兜底核心 ----------------------------- */

/**
 * 处理模型请求：缓存 → 同源（带超时）→ Supabase 兜底
 * @param {Request} req 浏览器发起的原始请求
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

    // 2) 尝试同源，带 4s 超时
    try {
        const r = await fetchWithTimeout(req, TIMEOUT_MS);
        if (r.ok) {
            cache.put(req, r.clone());
            return r;
        }
        console.warn(`[app-sw] 同源返回非 2xx (${r.status})，准备降级: ${req.url}`);
    } catch (e) {
        console.warn(`[app-sw] 同源请求失败，降级到兜底 CDN: ${req.url} (${e.name})`);
    }

    // 3) 降级到 Supabase Storage
    if (!SUPABASE_BASE) {
        return errorResponse('兜底 CDN 未配置：请通过 ?base=<url> 注册 SW');
    }
    const fallbackUrl = SUPABASE_BASE.replace(/\/$/, '') + requestUrl.pathname;
    try {
        const r = await fetch(fallbackUrl);
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
            return wrapped;
        }
        return errorResponse(`兜底 CDN 状态 ${r.status}: ${fallbackUrl}`);
    } catch (e) {
        return errorResponse(`兜底 CDN 请求失败: ${e.message}`);
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
 * 后台静默刷新缓存（命中缓存后异步重新拉取最新版本）
 * @param {Request} req 原始请求
 * @param {Cache} cache Cache 实例
 * @returns {void}
 */
function refreshInBackground(req, cache) {
    fetchWithTimeout(req, TIMEOUT_MS)
        .then((r) => {
            if (r.ok) cache.put(req, r.clone());
        })
        .catch(() => {
            // 静默失败：当前缓存版本仍可用
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
                console.log('[app-sw] 已注册，兜底 CDN:', SUPABASE_BASE || '(未配置)');
            })
            .catch((e) => console.warn('[app-sw] 注册失败:', e));
    }
}
