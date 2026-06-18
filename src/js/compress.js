/**
 * @file 图片压缩页面主逻辑
 * @description
 *  - 客户端 Canvas 压缩（不依赖第三方库）
 *  - 单图 / 批量模式（最多 20 张）
 *  - 质量 30-100%，输出 JPEG / PNG / WebP
 *  - 等比缩放至最大宽度
 *  - 压缩前后大小对比、实时进度、单张 / 全部下载
 *  - "替换原图" 通过 sessionStorage 传递给首页
 */

import i18n from './i18n/i18n.js';
import { initLangSwitcher } from './i18n/langSwitcher.js';

/* ==================== 常量配置 ==================== */

/** 批量压缩最大图片数 */
const MAX_BATCH_SIZE = 20;
/** 质量最小值 */
const MIN_QUALITY = 30;
/** 质量最大值 */
const MAX_QUALITY = 100;
/** 目标压缩率（百分比，最终大小占原始大小的比例），用于自适应降质 */
const TARGET_RATIO = 30;
/** 通过 sessionStorage 还原图片的最大体积（base64 编码后 ~2.67MB） */
const MAX_RESTORE_BYTES = 2 * 1024 * 1024;
/** 还原键名 */
const RESTORE_STORAGE_KEY = 'compress-restore-blob';

/**
 * 将 PNG 质量（30-100）映射到调色板大小（64-256）
 * 这是 pngquant 风格：质量越高颜色越多，文件越大
 * 30% → 64色（最强压缩，渐变图可能出现轻微色带）
 * 100% → 256色（PNG-8 标准上限）
 */
function pngQualityToColors(q) {
    const minC = 64, maxC = 256;
    const ratio = (q - MIN_QUALITY) / (MAX_QUALITY - MIN_QUALITY);
    return Math.max(minC, Math.min(maxC, Math.round(minC + ratio * (maxC - minC))));
}
/** 支持的输入 MIME 列表 */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/* ==================== 状态 ==================== */

/** @type {'batch'|'single'} 当前模式 */
let mode = 'batch';
/** @type {string} 输出 MIME */
let outputFormat = 'image/jpeg';
/** @type {number} 质量 30-100 */
let quality = 75;
/** @type {number} 最大宽度，0 表示不缩放 */
let maxWidth = 0;
/** @type {Array<CompressItem>} 任务列表 */
let items = [];
/** @type {number} 自增 id */
let nextId = 1;

/**
 * @typedef {Object} CompressItem
 * @property {number} id
 * @property {File} file
 * @property {string} name
 * @property {string} originalUrl - 原始图预览 URL
 * @property {number} originalSize
 * @property {Blob|null} compressedBlob
 * @property {string|null} compressedUrl
 * @property {number|null} compressedSize
 * @property {'pending'|'processing'|'done'|'error'} status
 * @property {string|null} error
 * @property {number} progress 0-100
 * @property {number} finalQuality 实际生效质量
 * @property {boolean} notReduced 压缩后体积未减小（用于给出提示）
 * @property {boolean} hasAlpha 原图含透明通道（仅 PNG 输出时有意义）
 * @property {boolean} isPngFallback PNG 输出反而更大时回退到原图（说明浏览器重编码已达极限）
 */

/* ==================== DOM 引用 ==================== */

const dom = {
    modeTabs: null,
    modeHint: null,
    qualitySlider: null,
    qualityValue: null,
    formatTabs: null,
    maxWidthInput: null,
    maxWidthValue: null,
    upload: null,
    fileInput: null,
    selectFilesBtn: null,
    clearAllBtn: null,
    list: null,
    summary: null,
    totalOriginal: null,
    totalCompressed: null,
    totalSaved: null,
    summaryProgressFill: null,
    summaryProgressText: null,
    downloadAllBtn: null,
    uploadDesc: null
};

/* ==================== 入口 ==================== */

/** 页面初始化 */
async function init() {
    cacheDom();
    bindEvents();
    await i18n.init();
    initLangSwitcher();
    i18n.updateUI();
    refreshUploadHint();
    updateQualityHint();
}

/** 缓存所有 DOM 引用 */
function cacheDom() {
    dom.modeTabs = document.querySelectorAll('.mode-tab');
    dom.modeHint = document.getElementById('modeHint');
    dom.qualitySlider = document.getElementById('qualitySlider');
    dom.qualityValue = document.getElementById('qualityValue');
    dom.formatTabs = document.querySelectorAll('.format-tab');
    dom.maxWidthInput = document.getElementById('maxWidthInput');
    dom.maxWidthValue = document.getElementById('maxWidthValue');
    dom.upload = document.getElementById('compressUpload');
    dom.fileInput = document.getElementById('compressFileInput');
    dom.selectFilesBtn = document.getElementById('selectFilesBtn');
    dom.clearAllBtn = document.getElementById('clearAllBtn');
    dom.list = document.getElementById('compressList');
    dom.summary = document.getElementById('compressSummary');
    dom.totalOriginal = document.getElementById('totalOriginal');
    dom.totalCompressed = document.getElementById('totalCompressed');
    dom.totalSaved = document.getElementById('totalSaved');
    dom.summaryProgressFill = document.getElementById('summaryProgressFill');
    dom.summaryProgressText = document.getElementById('summaryProgressText');
    dom.downloadAllBtn = document.getElementById('downloadAllBtn');
    dom.uploadDesc = document.getElementById('uploadDesc');
}

/** 绑定所有事件 */
function bindEvents() {
    // 模式切换
    dom.modeTabs.forEach(tab => {
        tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // 质量
    dom.qualitySlider.addEventListener('input', (e) => {
        quality = Number(e.target.value);
        dom.qualityValue.textContent = `${quality}%`;
    });

    // 最大宽度
    dom.maxWidthInput.addEventListener('input', (e) => {
        maxWidth = Number(e.target.value);
        dom.maxWidthValue.textContent = maxWidth === 0 ? i18n.t('compressPage.maxWidthOriginal') : `${maxWidth}px`;
    });

    // 格式
    dom.formatTabs.forEach(tab => {
        tab.addEventListener('click', () => switchFormat(tab.dataset.format));
    });

    // 上传相关
    dom.selectFilesBtn.addEventListener('click', () => dom.fileInput.click());
    dom.upload.addEventListener('click', (e) => {
        // 点击上传区空白处时也触发选择（按钮自身点击不重复触发）
        if (e.target.closest('button')) return;
        dom.fileInput.click();
    });
    dom.fileInput.addEventListener('change', (e) => {
        handleFiles(Array.from(e.target.files || []));
        e.target.value = ''; // 重置以允许重复选择相同文件
    });
    dom.clearAllBtn.addEventListener('click', clearAll);

    // 拖拽
    ['dragenter', 'dragover'].forEach(evt => {
        dom.upload.addEventListener(evt, (e) => {
            e.preventDefault();
            dom.upload.classList.add('dragging');
        });
    });
    ['dragleave', 'drop'].forEach(evt => {
        dom.upload.addEventListener(evt, (e) => {
            e.preventDefault();
            dom.upload.classList.remove('dragging');
        });
    });
    dom.upload.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        handleFiles(files);
    });

    // 全部下载
    dom.downloadAllBtn.addEventListener('click', downloadAll);
}

/* ==================== 模式 / 格式切换 ==================== */

/**
 * 切换压缩模式
 * @param {'batch'|'single'} newMode
 */
function switchMode(newMode) {
    if (mode === newMode) return;
    mode = newMode;

    dom.modeTabs.forEach(tab => {
        const isActive = tab.dataset.mode === newMode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // 单图模式只允许选择 1 张
    dom.fileInput.multiple = (newMode === 'batch');
    refreshUploadHint();
    updateClearBtnState();
}

/**
 * 切换输出格式
 * @param {string} mime
 */
function switchFormat(mime) {
    if (outputFormat === mime) return;
    outputFormat = mime;
    dom.formatTabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.format === mime);
    });
    // 质量滑块对所有格式都有效：
    //   JPEG / WebP → 调画质
    //   PNG → 调调色板大小（30%→64色，100%→256色，pngquant 风格）
    // 因此不再 disabled；只更新提示文案
    dom.qualitySlider.disabled = false;
    dom.qualityValue.style.opacity = '1';
    updateQualityHint();
}

/**
 * 根据当前输出格式更新质量滑块旁的提示文案
 * 抽出为独立函数便于 i18n 切换语言时复用
 */
function updateQualityHint() {
    const key = outputFormat === 'image/png' ? 'compressPage.qualityHintPng' : 'compressPage.qualityHintLossy';
    const el = document.querySelector('[data-role="qualityHint"]');
    if (el && i18n && typeof i18n.t === 'function') {
        el.textContent = i18n.t(key);
    }
}

/** 根据当前模式刷新上传区提示文案 */
function refreshUploadHint() {
    const key = mode === 'batch' ? 'compressPage.uploadBatchDesc' : 'compressPage.uploadSingleDesc';
    dom.uploadDesc.textContent = i18n.t(key);
    dom.modeHint.textContent = i18n.t(mode === 'batch' ? 'compressPage.batchHint' : 'compressPage.singleHint');
}

/* ==================== 文件选择 / 校验 ==================== */

/**
 * 校验并加入待处理文件
 * @param {File[]} files
 */
function handleFiles(files) {
    const valid = files.filter(f => ACCEPTED_TYPES.includes(f.type));
    if (valid.length === 0) {
        alert(i18n.t('compressPage.invalidType'));
        return;
    }

    const limit = mode === 'batch' ? MAX_BATCH_SIZE : 1;
    const existing = items.length;
    const slots = Math.max(0, limit - existing);
    const accepted = valid.slice(0, slots);

    if (valid.length > slots) {
        const msg = i18n.t('compressPage.exceedLimit', { max: limit });
        alert(msg);
    }

    accepted.forEach(file => {
        const item = createItem(file);
        items.push(item);
        renderItem(item);
        processItem(item); // 异步执行
    });

    updateClearBtnState();
    updateSummary();
}

/** 清空所有任务 */
function clearAll() {
    items.forEach(revokeItem);
    items = [];
    dom.list.innerHTML = '';
    updateClearBtnState();
    updateSummary();
    dom.downloadAllBtn.disabled = true;
}

/** 更新清空按钮启用状态 */
function updateClearBtnState() {
    dom.clearAllBtn.disabled = items.length === 0;
}

/* ==================== 任务对象 ==================== */

/**
 * 创建任务对象
 * @param {File} file
 * @returns {CompressItem}
 */
function createItem(file) {
    return {
        id: nextId++,
        file,
        name: file.name,
        originalUrl: URL.createObjectURL(file),
        originalSize: file.size,
        compressedBlob: null,
        compressedUrl: null,
        compressedSize: null,
        status: 'pending',
        error: null,
        progress: 0,
        finalQuality: quality,
        notReduced: false,
        hasAlpha: false,
        isPngFallback: false
    };
}

/** 释放任务关联的 ObjectURL */
function revokeItem(item) {
    if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
    if (item.compressedUrl) URL.revokeObjectURL(item.compressedUrl);
}

/* ==================== 压缩核心 ==================== */

/**
 * 处理单个任务
 * @param {CompressItem} item
 */
async function processItem(item) {
    item.status = 'processing';
    updateItemStatus(item);

    try {
        const result = await compressImage(item.file, {
            format: outputFormat,
            quality: quality,
            maxWidth: maxWidth,
            onProgress: (p) => {
                item.progress = p;
                updateItemProgress(item);
            }
        });
        item.compressedBlob = result.blob;
        item.compressedSize = result.blob.size;
        item.compressedUrl = URL.createObjectURL(result.blob);
        item.finalQuality = result.usedQuality;
        item.notReduced = result.notReduced;
        item.hasAlpha = result.hasAlpha;
        item.isPngFallback = result.isPngFallback;
        item.status = 'done';
        item.progress = 100;
        updateItemResult(item);
    } catch (err) {
        console.error('[Compress] 失败:', err);
        item.status = 'error';
        item.error = err.message || String(err);
        updateItemError(item);
    }

    updateSummary();
}

/**
 * 核心压缩：使用 Canvas 重绘并通过 toBlob 输出
 * 若输出大于原始且未达到目标压缩率，自动逐步降质重试
 * PNG 输出时：
 *  - 检测原图是否含透明像素，无 alpha 时绘制填白底以提升 DEFLATE 压缩率
 *  - 压缩后若反而 > 原图，标记 notReduced，让 UI 给出"无明显效果"提示
 * @param {File} file
 * @param {{format:string, quality:number, maxWidth:number, onProgress:(p:number)=>void}} opts
 * @returns {Promise<{blob:Blob, usedQuality:number, notReduced:boolean, hasAlpha:boolean}>}
 */
async function compressImage(file, opts) {
    const { format, quality: initialQ, maxWidth, onProgress } = opts;
    const isLossless = (format === 'image/png');
    const isUnsupportedQ = isLossless;

    onProgress(10);

    // 1) 解码图片
    const img = await loadImage(file);
    onProgress(35);

    // 2) 计算目标尺寸
    const { width: srcW, height: srcH } = img;
    let targetW = srcW, targetH = srcH;
    if (maxWidth > 0 && srcW > maxWidth) {
        targetW = maxWidth;
        targetH = Math.round((srcH * maxWidth) / srcW);
    }

    // 3) 离屏 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 上下文不可用');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 4) 透明度处理：仅对 PNG 通道做检测；无 alpha 时绘制填白底提升 DEFLATE 效率
    const hasAlpha = isLossless ? detectAlpha(img, ctx) : false;
    if (isLossless && !hasAlpha) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(img, 0, 0, targetW, targetH);
    onProgress(60);

    // 4.5) PNG 色彩量化：把 RGBA 颜色减少到 numColors，让浏览器输出的 PNG 显著缩小
    //      这是 pngquant 的核心思路——量化为 PNG-8 等价（颜色减少后 DEFLATE 压缩率大幅提升）
    //      quality 滑块映射到调色板大小：100%→256色，30%→64色
    if (isLossless) {
        const numColors = pngQualityToColors(initialQ);
        try {
            const imageData = ctx.getImageData(0, 0, targetW, targetH);
            const palette = medianCutQuantize(imageData.data, targetW * targetH, numColors, hasAlpha);
            applyPalette(imageData, palette);
            ctx.putImageData(imageData, 0, 0);
        } catch (err) {
            // 跨域图像无法 getImageData 时静默回退
            console.warn('[Compress] PNG 色彩量化失败，使用原始像素:', err);
        }
    }

    // 5) 输出 Blob（PNG 不支持 quality 参数，色彩已在上一步量化）
    let usedQuality = initialQ;
    let blob = await canvasToBlob(canvas, format, isUnsupportedQ ? undefined : initialQ);
    onProgress(80);

    // 6) 自适应降质：对有损格式，若结果 > 目标比例，循环降质
    if (!isUnsupportedQ) {
        const targetBytes = file.size * (TARGET_RATIO / 100);
        let q = initialQ;
        const minQ = MIN_QUALITY;
        let attempt = 0;
        // 最多尝试 4 次
        while (blob.size > targetBytes && q > minQ && attempt < 4) {
            const step = Math.max(5, Math.round((q - minQ) / 3));
            q = Math.max(minQ, q - step);
            blob = await canvasToBlob(canvas, format, q);
            usedQuality = q;
            attempt++;
            onProgress(80 + Math.min(15, attempt * 4));
        }
    }

    // 7) PNG 兜底：浏览器 canvas 编码 PNG 不如 pngcrush/oxipng 等专业工具高效，
    //    对已优化的 PNG 重新编码常常反而更大。
    //    若输出 PNG 且 >= 原图，且原图本身已是 PNG，则直接回退使用原文件，
    //    保证用户拿到的不会比原图大（仅原图为 PNG 时回退，跨格式仍以用户选择为准）。
    const isPngFallback = (isLossless && blob.size >= file.size && file.type === 'image/png');
    if (isPngFallback) {
        blob = file;
    }
    const notReduced = !isPngFallback && blob.size >= file.size;

    onProgress(100);
    return { blob, usedQuality, notReduced, hasAlpha, isPngFallback };
}

/**
 * 检测图片是否含透明像素（alpha < 255）
 * 仅在 PNG 输出路径调用，避免对 JPEG 浪费一次全像素扫描
 * @param {HTMLImageElement} img
 * @param {CanvasRenderingContext2D} ctx
 * @returns {boolean}
 */
function detectAlpha(img, ctx) {
    // 透明度检测不需要全分辨率，缩放到 1x1 等价会丢失 alpha；
    // 这里采样原图尺寸，但只取一次 getImageData，开销可控
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w === 0 || h === 0) return false;
    const probe = document.createElement('canvas');
    probe.width = w;
    probe.height = h;
    const pctx = probe.getContext('2d');
    if (!pctx) return false;
    pctx.drawImage(img, 0, 0);
    let data;
    try {
        data = pctx.getImageData(0, 0, w, h).data;
    } catch (err) {
        // 跨域图像读取像素会抛错，按"无透明"处理
        return false;
    }
    // 步进采样：每隔 64 个像素检查一次，最多 4096 次检测
    const step = Math.max(4, Math.floor((w * h) / 4096) * 4);
    for (let i = 3; i < data.length; i += step) {
        if (data[i] < 255) return true;
    }
    return false;
}

/**
 * 中位切分色彩量化（Median Cut）
 * 把图像的颜色从 PNG-24（1600 万色）减少到指定调色板大小（如 256 色）
 * 这是 pngquant 的核心算法，可让 PNG 体积显著缩小
 *
 * 实现要点：
 * 1) 对大图采样（如最多 10 万像素）以加速
 * 2) 反复按"色彩范围最大的通道"中位数切分桶
 * 3) 直到桶数 = numColors
 * 4) 每个桶的平均色作为调色板项
 *
 * @param {Uint8ClampedArray} pixels - RGBA 像素数组
 * @param {number} pixelCount
 * @param {number} numColors - 调色板大小（建议 32-256）
 * @param {boolean} preserveAlpha - 是否保留 alpha 通道
 * @returns {Array<[number,number,number,number]>} 调色板 RGBA 数组
 */
function medianCutQuantize(pixels, pixelCount, numColors, preserveAlpha) {
    if (pixelCount === 0 || numColors <= 0) return [];

    // 1) 采样像素以加速
    const maxSamples = 100000;
    const step = Math.max(1, Math.floor(pixelCount / maxSamples));
    const samples = [];
    for (let i = 0; i < pixelCount; i += step) {
        const off = i * 4;
        // 跳过完全透明的像素（无视觉贡献）
        if (!preserveAlpha && pixels[off + 3] === 0) continue;
        samples.push([pixels[off], pixels[off + 1], pixels[off + 2], preserveAlpha ? pixels[off + 3] : 255]);
    }
    if (samples.length === 0) return [[0, 0, 0, 255]];

    // 2) 初始桶 = 全部样本
    let buckets = [samples];

    // 3) 迭代切分直到达到目标桶数
    while (buckets.length < numColors) {
        // 找"色彩范围最大"的桶
        let bestIdx = -1;
        let bestRange = 0;
        for (let i = 0; i < buckets.length; i++) {
            const b = buckets[i];
            if (b.length < 2) continue;
            const r = bucketRange(b);
            if (r > bestRange) {
                bestRange = r;
                bestIdx = i;
            }
        }
        if (bestIdx < 0) break; // 没有可切分的桶

        const bucket = buckets[bestIdx];
        // 找色彩范围最大的通道
        const ch = dominantChannel(bucket);
        // 按该通道排序
        bucket.sort((a, b) => a[ch] - b[ch]);
        const mid = bucket.length >> 1;
        const left = bucket.slice(0, mid);
        const right = bucket.slice(mid);

        buckets.splice(bestIdx, 1, left, right);
    }

    // 4) 每个桶的平均色作为调色板
    return buckets.map(bucketAverage);
}

/** 计算一个桶的色彩范围（RGB 三通道最大值 - 最小值之和） */
function bucketRange(bucket) {
    let rMin = 256, rMax = -1;
    let gMin = 256, gMax = -1;
    let bMin = 256, bMax = -1;
    for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        if (p[0] < rMin) rMin = p[0];
        if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1];
        if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2];
        if (p[2] > bMax) bMax = p[2];
    }
    return (rMax - rMin) + (gMax - gMin) + (bMax - bMin);
}

/** 找色彩范围最大的通道 0=R / 1=G / 2=B */
function dominantChannel(bucket) {
    let rMin = 256, rMax = -1;
    let gMin = 256, gMax = -1;
    let bMin = 256, bMax = -1;
    for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        if (p[0] < rMin) rMin = p[0];
        if (p[0] > rMax) rMax = p[0];
        if (p[1] < gMin) gMin = p[1];
        if (p[1] > gMax) gMax = p[1];
        if (p[2] < bMin) bMin = p[2];
        if (p[2] > bMax) bMax = p[2];
    }
    const rR = rMax - rMin, gR = gMax - gMin, bR = bMax - bMin;
    if (rR >= gR && rR >= bR) return 0;
    if (gR >= bR) return 1;
    return 2;
}

/** 计算一个桶的 RGBA 平均颜色 */
function bucketAverage(bucket) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < bucket.length; i++) {
        r += bucket[i][0];
        g += bucket[i][1];
        b += bucket[i][2];
        a += bucket[i][3];
    }
    const n = bucket.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)];
}

/**
 * 在 ImageData 上应用调色板：每个像素替换为调色板中最近的颜色
 * 使用 RGB 立方距离，alpha 不参与距离计算（保留 alpha 通道）
 *
 * @param {ImageData} imageData
 * @param {Array<[number,number,number,number]>} palette
 */
function applyPalette(imageData, palette) {
    if (!palette || palette.length === 0) return;
    const data = imageData.data;
    const palLen = palette.length;
    // 把调色板展开成 Int32Array 以加速
    const pR = new Int32Array(palLen);
    const pG = new Int32Array(palLen);
    const pB = new Int32Array(palLen);
    const pA = new Uint8ClampedArray(palLen);
    for (let i = 0; i < palLen; i++) {
        pR[i] = palette[i][0];
        pG[i] = palette[i][1];
        pB[i] = palette[i][2];
        pA[i] = palette[i][3];
    }

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        // 找最近调色板颜色（按 RGB 欧氏距离平方）
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let p = 0; p < palLen; p++) {
            const dr = pR[p] - r;
            const dg = pG[p] - g;
            const db = pB[p] - b;
            const d = dr * dr + dg * dg + db * db;
            if (d < bestDist) {
                bestDist = d;
                bestIdx = p;
                if (d === 0) break; // 完全匹配，提前退出
            }
        }
        data[i] = pR[bestIdx];
        data[i + 1] = pG[bestIdx];
        data[i + 2] = pB[bestIdx];
        // 保留原 alpha（调色板的 alpha 仅供参考）
        data[i + 3] = a;
    }
}

/**
 * 将 canvas 转为 Blob（Promise 包装）
 * @param {HTMLCanvasElement} canvas
 * @param {string} mime
 * @param {number} [q]
 * @returns {Promise<Blob>}
 */
function canvasToBlob(canvas, mime, q) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('canvas.toBlob 返回 null'));
            },
            mime,
            q
        );
    });
}

/**
 * 加载图片为 Image 对象
 * @param {File|Blob} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(i18n.t('compressPage.decodeFailed')));
        };
        img.src = url;
    });
}

/* ==================== 渲染 ==================== */

/** 渲染整张任务卡片 */
function renderItem(item) {
    const card = document.createElement('div');
    card.className = 'compress-item';
    card.dataset.id = item.id;
    card.innerHTML = `
        <div class="ci-preview">
            <img src="${item.originalUrl}" alt="${escapeHtml(item.name)}">
        </div>
        <div class="ci-body">
            <div class="ci-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
            <div class="ci-sizes">
                <span class="ci-original">${i18n.t('compressPage.originalSize')}: <b>${formatSize(item.originalSize)}</b></span>
                <span class="ci-arrow" aria-hidden="true">→</span>
                <span class="ci-compressed" data-role="compressed">—</span>
            </div>
            <div class="ci-progress">
                <div class="ci-progress-fill" data-role="progress" style="width:0%"></div>
                <span class="ci-progress-text" data-role="progressText">${i18n.t('compressPage.queued')}</span>
            </div>
            <div class="ci-actions" data-role="actions"></div>
        </div>
    `;
    dom.list.appendChild(card);
}

/** 更新任务状态为处理中 */
function updateItemStatus(item) {
    const card = dom.list.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    card.classList.add('processing');
    const txt = card.querySelector('[data-role="progressText"]');
    if (txt) txt.textContent = i18n.t('compressPage.processing');
}

/** 更新任务进度 */
function updateItemProgress(item) {
    const card = dom.list.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    const fill = card.querySelector('[data-role="progress"]');
    if (fill) fill.style.width = `${item.progress}%`;
}

/** 更新任务为完成态，显示压缩后大小与操作按钮 */
function updateItemResult(item) {
    const card = dom.list.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    card.classList.remove('processing');
    card.classList.add('done');

    const ratio = item.compressedSize / item.originalSize;
    const saved = Math.max(0, Math.round((1 - ratio) * 100));
    const ratioClass = saved > 0 ? 'ci-saved' : 'ci-warn';

    const comp = card.querySelector('[data-role="compressed"]');
    // 提示优先级：PNG 回退（已保留原图）> 通用"无明显效果" > PNG 含 alpha 提示
    let note = '';
    if (item.isPngFallback) {
        note = `<div class="ci-note">${i18n.t('compressPage.pngFallbackNote')}</div>`;
    } else if (item.notReduced) {
        note = `<div class="ci-note ci-note-warn">${i18n.t('compressPage.notReducedNote')}</div>`;
    } else if (item.hasAlpha && outputFormat === 'image/png') {
        note = `<div class="ci-note">${i18n.t('compressPage.pngAlphaNote')}</div>`;
    }
    comp.innerHTML = `
        <b>${formatSize(item.compressedSize)}</b>
        <span class="ci-badge ${ratioClass}">${saved > 0 ? '-' : ''}${Math.abs(saved)}%</span>
        ${note}
    `;

    const progTxt = card.querySelector('[data-role="progressText"]');
    progTxt.textContent = i18n.t('compressPage.done');

    const actions = card.querySelector('[data-role="actions"]');
    actions.innerHTML = `
        <button class="btn btn-sm btn-primary" data-act="download">${i18n.t('compressPage.download')}</button>
        <button class="btn btn-sm btn-secondary" data-act="replace">${i18n.t('compressPage.replaceOriginal')}</button>
        <button class="btn btn-sm btn-ghost" data-act="remove">${i18n.t('compressPage.remove')}</button>
    `;
    actions.querySelector('[data-act="download"]').addEventListener('click', () => downloadItem(item));
    actions.querySelector('[data-act="replace"]').addEventListener('click', () => replaceOriginal(item));
    actions.querySelector('[data-act="remove"]').addEventListener('click', () => removeItem(item));
}

/** 更新任务为错误态 */
function updateItemError(item) {
    const card = dom.list.querySelector(`[data-id="${item.id}"]`);
    if (!card) return;
    card.classList.remove('processing');
    card.classList.add('error');
    const txt = card.querySelector('[data-role="progressText"]');
    if (txt) {
        txt.textContent = i18n.t('compressPage.errorWith', { msg: item.error || '' });
    }
    const actions = card.querySelector('[data-role="actions"]');
    if (actions) {
        actions.innerHTML = `<button class="btn btn-sm btn-ghost" data-act="remove">${i18n.t('compressPage.remove')}</button>`;
        actions.querySelector('[data-act="remove"]').addEventListener('click', () => removeItem(item));
    }
}

/** 移除单个任务 */
function removeItem(item) {
    const card = dom.list.querySelector(`[data-id="${item.id}"]`);
    if (card) card.remove();
    revokeItem(item);
    items = items.filter(it => it.id !== item.id);
    updateClearBtnState();
    updateSummary();
}

/** 更新汇总统计 */
function updateSummary() {
    if (items.length === 0) {
        dom.summary.hidden = true;
        return;
    }
    dom.summary.hidden = false;

    const totalOrig = items.reduce((s, it) => s + it.originalSize, 0);
    const totalComp = items.reduce((s, it) => s + (it.compressedSize || 0), 0);
    const doneCount = items.filter(it => it.status === 'done').length;
    const errorCount = items.filter(it => it.status === 'error').length;
    const processingCount = items.filter(it => it.status === 'processing' || it.status === 'pending').length;

    dom.totalOriginal.textContent = formatSize(totalOrig);
    dom.totalCompressed.textContent = doneCount === items.length ? formatSize(totalComp) : `${formatSize(totalComp)} (${doneCount}/${items.length})`;
    const ratio = totalOrig > 0 ? Math.round((1 - totalComp / totalOrig) * 100) : 0;
    dom.totalSaved.textContent = (doneCount === items.length && ratio > 0) ? `-${ratio}%` : '—';

    const overall = ((doneCount + errorCount) / items.length) * 100;
    dom.summaryProgressFill.style.width = `${overall}%`;
    if (processingCount > 0) {
        dom.summaryProgressText.textContent = i18n.t('compressPage.summaryProgress', { done: doneCount, total: items.length });
    } else if (errorCount > 0) {
        dom.summaryProgressText.textContent = i18n.t('compressPage.summaryDoneWithError', { error: errorCount });
    } else {
        dom.summaryProgressText.textContent = i18n.t('compressPage.summaryDone');
    }

    // 全部完成后启用"下载全部"
    dom.downloadAllBtn.disabled = doneCount === 0;
}

/* ==================== 下载 / 替换 ==================== */

/**
 * 下载单个文件
 * @param {CompressItem} item
 */
function downloadItem(item) {
    if (!item.compressedBlob) return;
    const ext = mimeToExt(outputFormat);
    const newName = renameWithExt(item.name, ext);
    triggerDownload(item.compressedBlob, newName);
}

/** 顺序触发所有已完成项的下载 */
function downloadAll() {
    const doneItems = items.filter(it => it.status === 'done' && it.compressedBlob);
    if (doneItems.length === 0) return;
    // 浏览器通常会拦截连续下载，逐个触发并附带小延时
    doneItems.forEach((item, idx) => {
        setTimeout(() => {
            const ext = mimeToExt(outputFormat);
            triggerDownload(item.compressedBlob, renameWithExt(item.name, ext));
        }, idx * 150);
    });
}

/**
 * 通过 sessionStorage 传递压缩结果到主页面
 * 大小超过限制时退化为"下载 + 提示"
 * @param {CompressItem} item
 */
async function replaceOriginal(item) {
    if (!item.compressedBlob) return;

    if (item.compressedSize > MAX_RESTORE_BYTES) {
        // 文件太大无法跨页传递，先下载并提示
        downloadItem(item);
        alert(i18n.t('compressPage.restoreTooLarge'));
        return;
    }

    try {
        const dataUrl = await blobToDataURL(item.compressedBlob);
        const payload = {
            dataUrl,
            name: renameWithExt(item.name, mimeToExt(outputFormat)),
            type: item.compressedBlob.type
        };
        sessionStorage.setItem(RESTORE_STORAGE_KEY, JSON.stringify(payload));
        // 在新标签页打开主页面并附加还原标记
        window.open('../index.html?restore=1', '_blank');
    } catch (err) {
        console.error('[Compress] 还原失败:', err);
        downloadItem(item);
        alert(i18n.t('compressPage.restoreFailed'));
    }
}

/* ==================== 工具函数 ==================== */

/** 触发浏览器下载 */
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 格式化字节数
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 将 MIME 映射为扩展名
 * @param {string} mime
 */
function mimeToExt(mime) {
    switch (mime) {
        case 'image/jpeg': return 'jpg';
        case 'image/png': return 'png';
        case 'image/webp': return 'webp';
        default: return 'bin';
    }
}

/**
 * 替换文件后缀名为目标格式
 * @param {string} filename
 * @param {string} ext
 */
function renameWithExt(filename, ext) {
    const dot = filename.lastIndexOf('.');
    const base = dot > 0 ? filename.slice(0, dot) : filename;
    return `${base}.${ext}`;
}

/** Blob → base64 dataURL */
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(blob);
    });
}

/** 简单 HTML 转义 */
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

/* ==================== 启动 ==================== */

init();
