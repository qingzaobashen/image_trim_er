/**
 * 上传本地 public/ 下的模型文件到 Supabase Storage 公共桶
 *
 * 用途：作为 Service Worker 兜底 CDN 的源站。
 * 目录结构保持与 public/ 一致：
 *   Xenova/modnet/onnx/model.onnx
 *   briaai/RMBG-1.4/onnx/model.onnx
 *   imgly/isnet/onnx/model_fp16.onnx
 *   ...
 *
 * 实现：直接调用 Supabase Storage REST API，零依赖（Node 20+ 自带 fetch）。
 *
 * 用法（PowerShell）：
 *   $env:SUPABASE_URL="https://xxx.supabase.co"
 *   $env:SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *   $env:SUPABASE_BUCKET="models"     # 可选，默认 models
 *   node scripts/upload-models-to-supabase.mjs
 *
 * 密钥位置：Supabase Dashboard → Settings → API
 *   - Project URL  → SUPABASE_URL
 *   - service_role key（注意不是 anon key）→ SUPABASE_SERVICE_ROLE_KEY
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const PUBLIC_DIR = join(PROJECT_ROOT, 'public');

/** 需要上传的模型目录（与 app-serviceworker.js 中的 MODEL_PATH_RE 保持一致） */
const MODEL_DIRS = ['Xenova', 'briaai', 'imgly', 'U-2-Netp'];

/** 文件后缀 → Content-Type 映射 */
const EXT_TO_MIME = {
    '.onnx': 'application/octet-stream',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
    '.mjs': 'application/javascript',
};

/* ----------------------------- 环境变量读取 ----------------------------- */

/** 读取必需的环境变量，缺失则给出明确报错并退出
 * @param {string} key 环境变量名
 * @returns {string} 变量值
 */
function requireEnv(key) {
    const v = process.env[key];
    if (!v) {
        console.error(`[upload] 缺少环境变量 ${key}`);
        console.error('  请先在 PowerShell 中执行：');
        console.error(`    $env:${key}="<value>"`);
        process.exit(1);
    }
    return v;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'models';

/** 通用请求头 */
const BASE_HEADERS = {
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
};

/* ----------------------------- 工具函数 ----------------------------- */

/**
 * 递归收集指定根目录下所有文件路径
 * @param {string} dir 起始目录
 * @returns {Promise<string[]>} 相对 PUBLIC_DIR 的文件路径列表
 */
async function walkFiles(dir) {
    const out = [];
    async function dfs(cur) {
        const entries = await readdir(cur, { withFileTypes: true });
        for (const ent of entries) {
            const full = join(cur, ent.name);
            if (ent.isDirectory()) {
                await dfs(full);
            } else if (ent.isFile()) {
                out.push(relative(PUBLIC_DIR, full));
            }
        }
    }
    await dfs(dir);
    return out;
}

/**
 * 推断文件的 Content-Type
 * @param {string} filename 文件名
 * @returns {string} MIME 类型
 */
function guessContentType(filename) {
    const lower = filename.toLowerCase();
    for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
        if (lower.endsWith(ext)) return mime;
    }
    return 'application/octet-stream';
}

/**
 * 人类可读的文件大小
 * @param {number} bytes 字节数
 * @returns {string} 格式化后的大小
 */
function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 格式化打印耗时
 * @param {number} ms 毫秒
 * @returns {string} 格式化耗时
 */
function humanMs(ms) {
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
}

/* ----------------------------- Supabase API ----------------------------- */

/**
 * 列出所有存储桶
 * @returns {Promise<Array<{name: string, public: boolean}>>} 桶列表
 */
async function listBuckets() {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'GET',
        headers: BASE_HEADERS,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`listBuckets ${res.status}: ${text}`);
    }
    return res.json();
}

/**
 * 创建公共存储桶（已存在则忽略）
 * @param {string} bucketName 桶名
 * @returns {Promise<void>}
 */
async function ensureBucket(bucketName) {
    const buckets = await listBuckets();
    if (buckets.some((b) => b.name === bucketName)) {
        console.log(`[upload] 桶已存在：${bucketName}`);
        return;
    }
    console.log(`[upload] 桶不存在，正在创建：${bucketName}（public）`);
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: 'POST',
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: bucketName,
            public: true,
            file_size_limit: null, // ONNX 模型较大，不设上限
            allowed_mime_types: null,
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        // 重复创建时 supabase 会返回 409，按已存在处理
        if (res.status === 409) {
            console.log(`[upload] 桶已存在（409）：${bucketName}`);
            return;
        }
        throw new Error(`createBucket ${res.status}: ${text}`);
    }
    console.log(`[upload] 桶创建成功：${bucketName}`);
}

/**
 * 上传单个文件到指定存储桶（upsert 模式）
 * @param {string} bucketName 桶名
 * @param {string} remotePath 远端相对路径，如 "Xenova/modnet/onnx/model.onnx"
 * @param {Buffer} buf 文件二进制内容
 * @param {string} contentType MIME 类型
 * @returns {Promise<void>}
 */
async function uploadFile(bucketName, remotePath, buf, contentType) {
    const url = `${SUPABASE_URL}/storage/v1/object/${bucketName}/${remotePath}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            ...BASE_HEADERS,
            'Content-Type': contentType,
            'Content-Length': String(buf.length),
            'x-upsert': 'true',
            'cache-control': 'public, max-age=31536000, immutable',
        },
        body: buf,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`upload ${res.status}: ${text}`);
    }
}

/* ----------------------------- 主流程 ----------------------------- */

/**
 * 入口：遍历模型目录、确保桶存在、批量上传
 * @returns {Promise<void>}
 */
async function main() {
    console.log(`[upload] 目标：${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/`);
    console.log(`[upload] 源目录：${PUBLIC_DIR}`);

    // 1) 收集待上传文件
    const allFiles = [];
    for (const sub of MODEL_DIRS) {
        const dir = join(PUBLIC_DIR, sub);
        try {
            await stat(dir);
        } catch {
            console.warn(`[upload] 跳过不存在的目录：${sub}/`);
            continue;
        }
        const files = await walkFiles(dir);
        allFiles.push(...files);
    }

    if (allFiles.length === 0) {
        console.warn('[upload] 没有找到任何模型文件，退出。');
        return;
    }
    console.log(`[upload] 待上传 ${allFiles.length} 个文件\n`);

    // 2) 确保桶存在
    await ensureBucket(SUPABASE_BUCKET);

    // 3) 逐个上传（upsert 模式，已存在则覆盖）
    let okCount = 0;
    let failCount = 0;
    let totalBytes = 0;
    const startAll = Date.now();

    for (const relPath of allFiles) {
        const localPath = join(PUBLIC_DIR, relPath);
        // 统一使用正斜杠作为存储路径分隔符
        const remotePath = relPath.split(sep).join('/');
        const t0 = Date.now();

        try {
            const buf = await readFile(localPath);
            const contentType = guessContentType(relPath);
            await uploadFile(SUPABASE_BUCKET, remotePath, buf, contentType);

            okCount++;
            totalBytes += buf.length;
            const dt = Date.now() - t0;
            console.log(`  ✓ ${remotePath.padEnd(50)} ${humanSize(buf.length).padStart(10)}  ${humanMs(dt)}`);
        } catch (e) {
            failCount++;
            console.error(`  ✗ ${remotePath}  ${e.message}`);
        }
    }

    const totalDt = Date.now() - startAll;
    console.log(`\n[upload] 完成：成功 ${okCount}，失败 ${failCount}，总计 ${humanSize(totalBytes)}，耗时 ${humanMs(totalDt)}`);

    if (okCount > 0) {
        const sampleUrl = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/Xenova/modnet/onnx/model.onnx`;
        console.log(`\n[upload] 验证：访问 ${sampleUrl}`);
        console.log('[upload] 接下来把 ?base= 指向：');
        console.log(`  ${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}`);
    }

    if (failCount > 0) process.exit(1);
}

main().catch((e) => {
    console.error('[upload] 未捕获异常：', e);
    process.exit(1);
});
