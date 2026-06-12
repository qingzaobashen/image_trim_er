/**
 * 应用主 Service Worker
 *
 * 职责（合并自 coi-serviceworker v0.1.7 + 自研模型 CDN 兜底）：
 *  1. 为同源响应注入 COOP / COEP 头，启用 SharedArrayBuffer，
 *     满足 Transformers.js WASM 后端的跨源隔离要求。
 *  2. 对 .onnx / 配置文件 / ort-wasm-* 等模型资源做 CDN 兜底：
 *     优先同源（GitHub Pages），**边下载边测速**，速率持续低于 30 KB/s
 *     或硬超时 30s 即降级到 Supabase Storage，成功后写入 Cache API。
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

/** 模型资源缓存版本号，发布新模型时建议 +1 让旧缓存失效 */
const CACHE_NAME = 'models-cdn-fallback-v1';

/* ---------------------- 测速降级参数（可按需调整） ---------------------- */

/** 判定为"过慢"的速率阈值：30 KB/s。
 *  对 25MB 模型 ≈ 14min，远低于用户耐心阈值；正常网络（>500KB/s）不会误触发 */
const SLOW_THRESHOLD_BPS = 30 * 1024;

/** 启动后免测速的宽限期：2s。
 *  避免 TCP 慢启动/首字节延迟造成的误判 */
const WARMUP_MS = 2000;

/** 测速窗口：每 3s 评估一次平均速率。
 *  窗口越大越不容易被瞬时抖动误判 */
const SPEED_WINDOW_MS = 3000;

/** 同源下载硬性超时：30s。即便速率尚可也强制切到兜底 */
const HARD_TIMEOUT_MS = 30_000;

/** 跳过测速的文件大小阈值：< 100KB 的小文件直接放行 */
const SMALL_FILE_BYTES = 100 * 1024;

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

    // 2) 尝试同源：边下载边测速，速率持续过低立刻降级
    try {
        const r = await fetchWithSpeedMonitor(req, {
            label: 'GitHub',
            minSpeedBps: SLOW_THRESHOLD_BPS,
            warmupMs: WARMUP_MS,
            windowMs: SPEED_WINDOW_MS,
            hardTimeoutMs: HARD_TIMEOUT_MS,
        });
        if (r.ok) {
            cache.put(req, r.clone());
            return r;
        }
        console.warn(`[app-sw] 同源返回非 2xx (${r.status})，准备降级: ${req.url}`);
    } catch (e) {
        console.warn(`[app-sw] 同源降级到 Supabase: ${req.url} (${e.message})`);
    }

    // 3) 降级到 Supabase Storage
    if (!SUPABASE_BASE) {
        return errorResponse('兜底 CDN 未配置：请通过 ?base=<url> 注册 SW');
    }
    const fallbackUrl = SUPABASE_BASE.replace(/\/$/, '') + requestUrl.pathname;
    console.log(`[app-sw] 切换到兜底 CDN (Supabase): ${fallbackUrl}`);
    try {
        // 兜底不设速率阈值，但保留 60s 硬超时避免无响应卡死
        const r = await fetchWithSpeedMonitor(new Request(fallbackUrl, {
            method: req.method,
            headers: req.headers,
        }), {
            label: 'Supabase',
            minSpeedBps: 0, // 兜底不限速
            hardTimeoutMs: 60_000,
        });
        if (r.ok) {
            // 给跨源响应补 CORP 头，避免被 credentialless COEP 拦截
            const newHeaders = new Headers(r.headers);
            newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
            const wrapped = new Response(r.body, {
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
 * 带测速+超时的 fetch 工具
 *
 * 工作机制：
 *  1. 先建立连接并拿到响应头；
 *  2. 持续读取 body 字节流，每秒打印一次"已下载 X / 总 Y @ Z KB/s"；
 *  3. 启动后经过 WARMUP_MS 才开始测速，每 SPEED_WINDOW_MS 评估一次平均速率；
 *  4. 速率持续低于 minSpeedBps ⇒ 取消读取、抛出 SLOW_DOWNLOAD 错误（由调用方降级）；
 *  5. 总耗时超 hardTimeoutMs ⇒ 直接 abort（兜底防卡死）；
 *  6. 小于 SMALL_FILE_BYTES 的文件跳过测速，直接放行（避免对 config.json 误判）。
 *
 * @param {Request} req 请求对象
 * @param {Object} [options] 配置项
 * @param {string} [options.label='fetch'] 日志前缀，便于区分来源
 * @param {number} [options.minSpeedBps=30*1024] 低于此速率即判定为慢（设为 0 关闭测速）
 * @param {number} [options.warmupMs=2000] 启动后免测速的宽限期
 * @param {number} [options.windowMs=3000] 测速窗口长度
 * @param {number} [options.hardTimeoutMs=30000] 硬性超时上限
 * @returns {Promise<Response>} 完整响应
 */
async function fetchWithSpeedMonitor(req, options = {}) {
    const {
        label = 'fetch',
        minSpeedBps = SLOW_THRESHOLD_BPS,
        warmupMs = WARMUP_MS,
        windowMs = SPEED_WINDOW_MS,
        hardTimeoutMs = HARD_TIMEOUT_MS,
    } = options;

    const ctrl = new AbortController();
    const hardTimer = setTimeout(() => ctrl.abort('hard-timeout'), hardTimeoutMs);

    let res;
    try {
        res = await fetch(req, { signal: ctrl.signal });
    } catch (e) {
        clearTimeout(hardTimer);
        throw e;
    }

    if (!res.ok) {
        // 非 2xx：交给调用方判断是否降级
        clearTimeout(hardTimer);
        return res;
    }

    // 获取声明的文件大小
    const contentLength = Number(res.headers.get('content-length') || 0);

    // 小文件：跳过测速，直接透传原始响应（保留流式能力）
    if (contentLength > 0 && contentLength < SMALL_FILE_BYTES) {
        clearTimeout(hardTimer);
        return res;
    }

    // 大文件：流式读取 + 实时测速
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    const startTime = performance.now();
    let lastCheckTime = startTime;
    let lastCheckBytes = 0;
    let lastLogTime = startTime;

    const fmtSpeed = (bps) => (bps >= 1024 * 1024
        ? `${(bps / 1024 / 1024).toFixed(2)} MB/s`
        : `${(bps / 1024).toFixed(0)} KB/s`);

    try {
        // 通知客户端开始下载（如果监听 message 事件）
        notifyClients({
            type: 'model-download-start',
            label,
            url: req.url,
            totalBytes: contentLength,
        });

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.length;
            const now = performance.now();
            const elapsedMs = now - startTime;

            // 每 1s 打印一次进度（便于在 DevTools 实时观测速率）
            if (now - lastLogTime >= 1000) {
                const avgBps = (received / elapsedMs) * 1000;
                const percent = contentLength
                    ? Math.min(100, Math.round((received / contentLength) * 100))
                    : 0;
                const logLine = `[app-sw] ${label}: ${(received / 1024).toFixed(0)}KB `
                    + `(${percent}%) @ ${fmtSpeed(avgBps)}`;
                console.log(logLine);
                notifyClients({
                    type: 'model-download-progress',
                    label,
                    url: req.url,
                    receivedBytes: received,
                    totalBytes: contentLength,
                    speedBps: avgBps,
                });
                lastLogTime = now;
            }

            // 测速判断：宽限期过后，每 windowMs 评估一次
            if (elapsedMs > warmupMs) {
                const sinceCheck = now - lastCheckTime;
                if (sinceCheck >= windowMs) {
                    const speedBps = ((received - lastCheckBytes) / sinceCheck) * 1000;
                    if (minSpeedBps > 0 && speedBps < minSpeedBps) {
                        reader.cancel(); // 立即释放底层连接
                        throw new Error(
                            `SLOW_DOWNLOAD ${fmtSpeed(speedBps)} < ${fmtSpeed(minSpeedBps)}`
                        );
                    }
                    lastCheckTime = now;
                    lastCheckBytes = received;
                }
            }
        }
    } catch (e) {
        clearTimeout(hardTimer);
        throw e;
    }

    clearTimeout(hardTimer);
    const totalMs = performance.now() - startTime;
    console.log(
        `[app-sw] ${label}: 完成 ${(received / 1024).toFixed(0)}KB ` +
        `@ ${fmtSpeed((received / totalMs) * 1000)} 用时 ${(totalMs / 1000).toFixed(1)}s`
    );

    // 重组字节流为单一 Uint8Array（保持 headers / status 透传）
    const totalBytes = chunks.reduce((acc, c) => acc + c.length, 0);
    const body = new Uint8Array(totalBytes);
    let pos = 0;
    for (const c of chunks) {
        body.set(c, pos);
        pos += c.length;
    }
    return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
    });
}

/**
 * 向所有受控客户端广播消息（页面脚本可监听以显示实时速率）
 * @param {Object} payload 消息内容
 * @returns {void}
 */
function notifyClients(payload) {
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        for (const c of clients) c.postMessage(payload);
    }).catch(() => { /* 静默失败 */ });
}

/**
 * 后台静默刷新缓存（命中缓存后异步重新拉取最新版本）
 * 关闭测速判定，避免误中断；只保留硬性超时
 * @param {Request} req 原始请求
 * @param {Cache} cache Cache 实例
 * @returns {void}
 */
function refreshInBackground(req, cache) {
    fetchWithSpeedMonitor(req, {
        label: 'refresh',
        minSpeedBps: 0, // 关闭测速
        hardTimeoutMs: 60_000, // 后台刷新可宽限
    })
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
