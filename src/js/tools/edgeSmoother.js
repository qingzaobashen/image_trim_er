/**
 * 边缘光滑处理模块
 *
 * 针对"抠图后带 Alpha 通道"的图像做边缘优化：
 *   1. 检测 Alpha 通道过渡带（真正产生锯齿的位置）；
 *   2. 计算边缘的粗糙度（平滑程度评分），据此自适应决定羽化强度；
 *   3. 仅对边界带做 Alpha 羽化（消除锯齿），保持主体内部清晰；
 *   4. 对半透明像素做背景色去污（decontamination），消除白边/暗边。
 *
 * 当图像不含 Alpha 过渡带（如整张不透明照片）时，回退到基于颜色梯度的
 * 传统边缘平滑，保证对普通图片依然可用。
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 边缘光滑处理类
 */
export class EdgeSmoother {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} canvas - 主Canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        // 最近一次评估得到的边缘粗糙度（0-1），供外部读取/调试
        this.lastRoughness = 0;
    }

    /**
     * 执行边缘光滑处理
     * @param {number} strength - 光滑强度 (1-10)
     * @returns {boolean} 是否成功
     */
    smooth(strength = 3) {
        const width = this.canvas.width;
        const height = this.canvas.height;

        if (width === 0 || height === 0) return false;

        const imageData = canvasUtils.getImageData(this.canvas);
        const data = imageData.data;

        // 分离出 Alpha 通道用于分析
        const total = width * height;
        const alpha = new Float32Array(total);
        let hasTransparent = false;
        let hasOpaque = false;
        for (let i = 0; i < total; i++) {
            const a = data[i * 4 + 3];
            alpha[i] = a;
            if (a < 16) hasTransparent = true;
            else if (a > 240) hasOpaque = true;
        }

        // 判定是否为"抠图后"图像：同时存在透明与不透明区域
        const isCutout = hasTransparent && hasOpaque;

        if (isCutout) {
            return this.smoothCutoutEdges(data, alpha, width, height, strength, imageData);
        }

        // 回退：无 Alpha 过渡带，走传统颜色边缘平滑
        return this.smoothColorEdges(data, width, height, strength, imageData);
    }

    /* ==================== 抠图边缘优化（主路径） ==================== */

    /**
     * 针对抠图图像的 Alpha 边缘优化
     * @param {Uint8ClampedArray} data - 图像数据（会被就地修改）
     * @param {Float32Array} alpha - Alpha 通道副本
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} strength - 光滑强度 (1-10)
     * @param {ImageData} imageData - 用于写回的 ImageData
     * @returns {boolean} 是否成功
     */
    smoothCutoutEdges(data, alpha, width, height, strength, imageData) {
        // 1. 检测 Alpha 边界带
        const band = this.detectAlphaEdgeBand(alpha, width, height);
        if (!band.count) return false;

        // 2. 计算边缘粗糙度（平滑程度评分，0-1；越大越锯齿）
        const roughness = this.measureEdgeRoughness(alpha, width, height, band.mask);
        this.lastRoughness = roughness;

        // 3. 自适应羽化半径：用户强度为基准，边缘越粗糙额外加权
        const baseRadius = strength * 0.6;
        const radius = Math.max(1, Math.min(12, Math.round(baseRadius * (0.6 + roughness))));

        // 4. 先做 RGB 去色边（使用原始 Alpha 判断污染像素）
        this.decontaminateColors(data, alpha, width, height, band, radius);

        // 5. 对边界带做 Alpha 羽化（消除锯齿）
        const smoothedAlpha = this.blurAlphaInBox(alpha, width, height, band.box, radius);

        // 6. 仅在边界带内写回羽化后的 Alpha
        const mask = band.mask;
        for (let i = 0; i < mask.length; i++) {
            if (mask[i]) {
                data[i * 4 + 3] = Math.round(smoothedAlpha[i]);
            }
        }

        canvasUtils.putImageData(this.canvas, imageData);
        return true;
    }

    /**
     * 检测 Alpha 通道的边界过渡带
     *
     * 先标记 Alpha 梯度较大的像素（硬边界），再膨胀若干像素形成一条包含
     * 边界两侧的过渡带，羽化和去污都仅在此带内进行。
     *
     * @param {Float32Array} alpha - Alpha 通道
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @returns {{mask: Uint8Array, count: number, box: {x0:number,y0:number,x1:number,y1:number}}}
     */
    detectAlphaEdgeBand(alpha, width, height) {
        const edge = new Uint8Array(width * height);
        const gradThreshold = 24;

        // 标记 Alpha 梯度较大的像素
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const a = alpha[idx];
                const g = Math.max(
                    Math.abs(a - alpha[idx - 1]),
                    Math.abs(a - alpha[idx + 1]),
                    Math.abs(a - alpha[idx - width]),
                    Math.abs(a - alpha[idx + width])
                );
                // 半透明像素本身也纳入（0<a<255）
                if (g > gradThreshold || (a > 8 && a < 248)) {
                    edge[idx] = 1;
                }
            }
        }

        // 膨胀成过渡带，并统计包围盒
        const bandRadius = 2;
        const mask = new Uint8Array(width * height);
        let count = 0;
        let x0 = width, y0 = height, x1 = 0, y1 = 0;

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (!edge[y * width + x]) continue;
                const yMin = Math.max(0, y - bandRadius);
                const yMax = Math.min(height - 1, y + bandRadius);
                const xMin = Math.max(0, x - bandRadius);
                const xMax = Math.min(width - 1, x + bandRadius);
                for (let ny = yMin; ny <= yMax; ny++) {
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const nIdx = ny * width + nx;
                        if (!mask[nIdx]) {
                            mask[nIdx] = 1;
                            count++;
                            if (nx < x0) x0 = nx;
                            if (nx > x1) x1 = nx;
                            if (ny < y0) y0 = ny;
                            if (ny > y1) y1 = ny;
                        }
                    }
                }
            }
        }

        if (count === 0) {
            return { mask, count, box: { x0: 0, y0: 0, x1: 0, y1: 0 } };
        }

        return { mask, count, box: { x0, y0, x1, y1 } };
    }

    /**
     * 计算边缘粗糙度（平滑程度评分）
     *
     * 沿边界带统计 Alpha 的拉普拉斯响应（二阶差分）。锯齿越明显，局部
     * Alpha 起伏越剧烈，响应越大。返回归一化到 0-1 的平均值。
     *
     * @param {Float32Array} alpha - Alpha 通道
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {Uint8Array} mask - 边界带蒙版
     * @returns {number} 粗糙度 0-1
     */
    measureEdgeRoughness(alpha, width, height, mask) {
        let sum = 0;
        let n = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (!mask[idx]) continue;
                const lap = Math.abs(
                    4 * alpha[idx]
                    - alpha[idx - 1]
                    - alpha[idx + 1]
                    - alpha[idx - width]
                    - alpha[idx + width]
                );
                sum += lap;
                n++;
            }
        }
        if (n === 0) return 0;
        // 拉普拉斯理论最大约 4*255，经验上除以较小基准更敏感
        const avg = sum / n;
        return Math.max(0, Math.min(1, avg / 255));
    }

    /**
     * 在包围盒范围内对 Alpha 通道做分离式高斯模糊（羽化）
     * @param {Float32Array} alpha - Alpha 通道
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {{x0:number,y0:number,x1:number,y1:number}} box - 处理包围盒
     * @param {number} radius - 模糊半径
     * @returns {Float32Array} 羽化后的 Alpha 通道
     */
    blurAlphaInBox(alpha, width, height, box, radius) {
        const kernel = this.createGaussianKernel(radius);
        const half = Math.floor(kernel.length / 2);
        const out = new Float32Array(alpha);
        const temp = new Float32Array(alpha);

        const { x0, y0, x1, y1 } = box;

        // 水平方向
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let acc = 0;
                let wsum = 0;
                for (let k = 0; k < kernel.length; k++) {
                    const nx = x + k - half;
                    if (nx >= 0 && nx < width) {
                        const w = kernel[k];
                        acc += alpha[y * width + nx] * w;
                        wsum += w;
                    }
                }
                temp[y * width + x] = acc / wsum;
            }
        }

        // 垂直方向
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                let acc = 0;
                let wsum = 0;
                for (let k = 0; k < kernel.length; k++) {
                    const ny = y + k - half;
                    if (ny >= 0 && ny < height) {
                        const w = kernel[k];
                        acc += temp[ny * width + x] * w;
                        wsum += w;
                    }
                }
                out[y * width + x] = acc / wsum;
            }
        }

        return out;
    }

    /**
     * 半透明像素背景色去污
     *
     * 抠图后半透明边缘像素的 RGB 常混有被抠掉的背景色（白边/暗边）。
     * 对这些像素，在邻域内寻找 Alpha 最高的不透明像素，用其颜色替换，
     * 从而让边缘颜色向主体过渡，消除杂色。
     *
     * @param {Uint8ClampedArray} data - 图像数据（会被就地修改）
     * @param {Float32Array} alpha - 原始 Alpha 通道
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {{mask: Uint8Array}} band - 边界带信息
     * @param {number} radius - 搜索半径
     */
    decontaminateColors(data, alpha, width, height, band, radius) {
        const mask = band.mask;
        const searchR = Math.max(1, Math.min(4, Math.round(radius / 2)));
        const opaqueThreshold = 200; // 认定为"干净主体色"的 Alpha 下限
        const semiThreshold = 220;   // 需要去污的半透明像素 Alpha 上限

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (!mask[idx]) continue;

                const a = alpha[idx];
                // 仅处理半透明像素（有污染风险），完全不透明像素保持原色
                if (a < 8 || a >= semiThreshold) continue;

                let bestAlpha = -1;
                let bestR = 0, bestG = 0, bestB = 0;
                const yMin = Math.max(0, y - searchR);
                const yMax = Math.min(height - 1, y + searchR);
                const xMin = Math.max(0, x - searchR);
                const xMax = Math.min(width - 1, x + searchR);

                for (let ny = yMin; ny <= yMax; ny++) {
                    for (let nx = xMin; nx <= xMax; nx++) {
                        const nIdx = ny * width + nx;
                        const na = alpha[nIdx];
                        if (na >= opaqueThreshold && na > bestAlpha) {
                            bestAlpha = na;
                            const p = nIdx * 4;
                            bestR = data[p];
                            bestG = data[p + 1];
                            bestB = data[p + 2];
                        }
                    }
                }

                if (bestAlpha >= 0) {
                    // 按透明度加权混合：越透明越靠近主体色
                    const t = 1 - a / semiThreshold; // 0(接近不透明)~1(接近透明)
                    const p = idx * 4;
                    data[p] = Math.round(data[p] * (1 - t) + bestR * t);
                    data[p + 1] = Math.round(data[p + 1] * (1 - t) + bestG * t);
                    data[p + 2] = Math.round(data[p + 2] * (1 - t) + bestB * t);
                }
            }
        }
    }

    /* ==================== 颜色边缘平滑（回退路径） ==================== */

    /**
     * 传统基于颜色梯度的边缘平滑（用于不含 Alpha 过渡带的图像）
     * @param {Uint8ClampedArray} data - 图像数据（会被就地修改）
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} strength - 光滑强度 (1-10)
     * @param {ImageData} imageData - 用于写回的 ImageData
     * @returns {boolean} 是否成功
     */
    smoothColorEdges(data, width, height, strength, imageData) {
        const edgeMask = this.detectColorEdges(data, width, height);
        const blurRadius = Math.max(1, Math.floor(strength * 0.8));
        const blurredData = this.applyGaussianBlur(data, width, height, blurRadius);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const edgeFactor = edgeMask[y * width + x];
                if (edgeFactor > 0) {
                    const blendFactor = edgeFactor * (strength / 10);
                    data[idx] = Math.round(data[idx] * (1 - blendFactor) + blurredData[idx] * blendFactor);
                    data[idx + 1] = Math.round(data[idx + 1] * (1 - blendFactor) + blurredData[idx + 1] * blendFactor);
                    data[idx + 2] = Math.round(data[idx + 2] * (1 - blendFactor) + blurredData[idx + 2] * blendFactor);
                }
            }
        }

        canvasUtils.putImageData(this.canvas, imageData);
        return true;
    }

    /**
     * 基于颜色梯度检测边缘
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @returns {Float32Array} 边缘蒙版 (0-1)
     */
    detectColorEdges(data, width, height) {
        const edgeMask = new Float32Array(width * height);
        const threshold = 30;

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const pixelIdx = idx * 4;

                const r = data[pixelIdx];
                const g = data[pixelIdx + 1];
                const b = data[pixelIdx + 2];

                const lIdx = (y * width + (x - 1)) * 4;
                const rIdx = (y * width + (x + 1)) * 4;
                const tIdx = ((y - 1) * width + x) * 4;
                const bIdx = ((y + 1) * width + x) * 4;

                const colorGradient = Math.max(
                    Math.abs(r - data[lIdx]), Math.abs(g - data[lIdx + 1]), Math.abs(b - data[lIdx + 2]),
                    Math.abs(r - data[rIdx]), Math.abs(g - data[rIdx + 1]), Math.abs(b - data[rIdx + 2]),
                    Math.abs(r - data[tIdx]), Math.abs(g - data[tIdx + 1]), Math.abs(b - data[tIdx + 2]),
                    Math.abs(r - data[bIdx]), Math.abs(g - data[bIdx + 1]), Math.abs(b - data[bIdx + 2])
                );

                if (colorGradient > threshold) {
                    edgeMask[idx] = Math.min(1, colorGradient / 255);
                }
            }
        }

        return edgeMask;
    }

    /**
     * 应用分离式高斯模糊（RGBA）
     * @param {Uint8ClampedArray} data - 图像数据
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} radius - 模糊半径
     * @returns {Uint8ClampedArray} 模糊后的数据
     */
    applyGaussianBlur(data, width, height, radius) {
        const result = new Uint8ClampedArray(data.length);
        const kernel = this.createGaussianKernel(radius);
        const kernelSize = kernel.length;
        const halfKernel = Math.floor(kernelSize / 2);

        const tempData = new Uint8ClampedArray(data.length);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0, weight = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const nx = x + k - halfKernel;
                    if (nx >= 0 && nx < width) {
                        const idx = (y * width + nx) * 4;
                        const w = kernel[k];
                        r += data[idx] * w;
                        g += data[idx + 1] * w;
                        b += data[idx + 2] * w;
                        a += data[idx + 3] * w;
                        weight += w;
                    }
                }
                const idx = (y * width + x) * 4;
                tempData[idx] = Math.round(r / weight);
                tempData[idx + 1] = Math.round(g / weight);
                tempData[idx + 2] = Math.round(b / weight);
                tempData[idx + 3] = Math.round(a / weight);
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let r = 0, g = 0, b = 0, a = 0, weight = 0;
                for (let k = 0; k < kernelSize; k++) {
                    const ny = y + k - halfKernel;
                    if (ny >= 0 && ny < height) {
                        const idx = (ny * width + x) * 4;
                        const w = kernel[k];
                        r += tempData[idx] * w;
                        g += tempData[idx + 1] * w;
                        b += tempData[idx + 2] * w;
                        a += tempData[idx + 3] * w;
                        weight += w;
                    }
                }
                const idx = (y * width + x) * 4;
                result[idx] = Math.round(r / weight);
                result[idx + 1] = Math.round(g / weight);
                result[idx + 2] = Math.round(b / weight);
                result[idx + 3] = Math.round(a / weight);
            }
        }

        return result;
    }

    /**
     * 创建一维高斯核
     * @param {number} radius - 半径
     * @returns {number[]} 归一化高斯核
     */
    createGaussianKernel(radius) {
        const size = radius * 2 + 1;
        const kernel = new Array(size);
        const sigma = radius / 3 || 1;
        const twoSigmaSquare = 2 * sigma * sigma;

        let sum = 0;
        for (let i = 0; i < size; i++) {
            const x = i - radius;
            kernel[i] = Math.exp(-(x * x) / twoSigmaSquare);
            sum += kernel[i];
        }

        for (let i = 0; i < size; i++) {
            kernel[i] /= sum;
        }

        return kernel;
    }
}
