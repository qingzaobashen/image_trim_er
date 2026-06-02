/**
 * 阴影处理工具模块
 * 提供白底图阴影识别与半透明过渡处理功能
 * 
 * 核心流程：
 * 1. 边缘检测：使用Canny算法检测物体轮廓，用于区分物体和阴影
 * 2. 阴影检测：在背景区域（物体边缘以外）识别阴影像素
 * 3. 阴影画笔：手动调整阴影选区（涂抹新增/取消）
 * 4. 应用处理：紫色选区完全抠除，粉色阴影选区半透明抠除
 * 
 * 选区颜色约定：
 * - 紫色(99,102,241)：前景抠除选区（完全抠除）
 * - 粉色(236,72,153)：阴影选区（半透明抠除）
 * - 细线(0,200,255)：边缘检测轮廓线
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/**
 * 阴影处理器类
 * 用于识别物体边缘外的阴影区域并计算半透明alpha值
 */
export class ShadowProcessor {
    /**
     * 构造函数
     * @param {HTMLCanvasElement} mainCanvas - 主Canvas
     */
    constructor(mainCanvas) {
        this.mainCanvas = mainCanvas;
        this.bgColor = null;
        this.edgeData = null;
    }

    /**
     * 检测物体边缘轮廓（Canny边缘检测）
     * 检测图片中物体的连续轮廓，特别关注物体与背景的边界
     * @param {ImageData} imageData - 图像数据
     * @returns {Uint8ClampedArray} 边缘图（255=边缘，0=非边缘）
     */
    detectEdges(imageData) {
        const width = imageData.width;
        const height = imageData.height;

        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4;
            gray[i] = imageData.data[idx] * 0.299 +
                      imageData.data[idx + 1] * 0.587 +
                      imageData.data[idx + 2] * 0.114;
        }

        const blurred = this.applyGaussianBlur(gray, width, height, 1.4);

        const gradient = new Float32Array(width * height);
        const direction = new Float32Array(width * height);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const tl = blurred[(y - 1) * width + (x - 1)];
                const tc = blurred[(y - 1) * width + x];
                const tr = blurred[(y - 1) * width + (x + 1)];
                const ml = blurred[y * width + (x - 1)];
                const mr = blurred[y * width + (x + 1)];
                const bl = blurred[(y + 1) * width + (x - 1)];
                const bc = blurred[(y + 1) * width + x];
                const br = blurred[(y + 1) * width + (x + 1)];

                const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
                const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

                gradient[idx] = Math.sqrt(gx * gx + gy * gy);
                direction[idx] = Math.atan2(gy, gx);
            }
        }

        const suppressed = new Float32Array(width * height);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const angle = direction[idx];
                const mag = gradient[idx];

                const normAngle = ((angle % Math.PI) + Math.PI) % Math.PI;
                let neighbor1 = 0, neighbor2 = 0;

                if ((normAngle >= 0 && normAngle < Math.PI / 8) ||
                    (normAngle >= 7 * Math.PI / 8 && normAngle < Math.PI)) {
                    neighbor1 = gradient[idx - 1];
                    neighbor2 = gradient[idx + 1];
                } else if (normAngle >= Math.PI / 8 && normAngle < 3 * Math.PI / 8) {
                    neighbor1 = gradient[(y - 1) * width + (x + 1)];
                    neighbor2 = gradient[(y + 1) * width + (x - 1)];
                } else if (normAngle >= 3 * Math.PI / 8 && normAngle < 5 * Math.PI / 8) {
                    neighbor1 = gradient[(y - 1) * width + x];
                    neighbor2 = gradient[(y + 1) * width + x];
                } else {
                    neighbor1 = gradient[(y - 1) * width + (x - 1)];
                    neighbor2 = gradient[(y + 1) * width + (x + 1)];
                }

                if (mag >= neighbor1 && mag >= neighbor2) {
                    suppressed[idx] = mag;
                }
            }
        }

        const edges = new Uint8ClampedArray(width * height);
        const highThreshold = 40;
        const lowThreshold = 15;

        for (let i = 0; i < suppressed.length; i++) {
            if (suppressed[i] >= highThreshold) {
                edges[i] = 255;
            }
        }

        let changed = true;
        while (changed) {
            changed = false;
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    if (edges[idx] === 255) {
                        for (let dy = -1; dy <= 1; dy++) {
                            for (let dx = -1; dx <= 1; dx++) {
                                const nidx = (y + dy) * width + (x + dx);
                                if (suppressed[nidx] >= lowThreshold && edges[nidx] === 0) {
                                    edges[nidx] = 255;
                                    changed = true;
                                }
                            }
                        }
                    }
                }
            }
        }

        this.edgeData = edges;
        return edges;
    }

    /**
     * 应用高斯模糊
     * @param {Float32Array} gray - 灰度数组
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} sigma - 标准差
     * @returns {Float32Array} 模糊后的数组
     */
    applyGaussianBlur(gray, width, height, sigma) {
        const kernelSize = Math.ceil(sigma * 6) | 1;
        const halfSize = Math.floor(kernelSize / 2);
        const kernel = new Float32Array(kernelSize);

        let sum = 0;
        for (let i = 0; i < kernelSize; i++) {
            const x = i - halfSize;
            kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
            sum += kernel[i];
        }
        for (let i = 0; i < kernelSize; i++) {
            kernel[i] /= sum;
        }

        const temp = new Float32Array(width * height);
        const result = new Float32Array(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let i = 0; i < kernelSize; i++) {
                    const nx = x + i - halfSize;
                    if (nx >= 0 && nx < width) {
                        val += gray[y * width + nx] * kernel[i];
                    }
                }
                temp[y * width + x] = val;
            }
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let val = 0;
                for (let i = 0; i < kernelSize; i++) {
                    const ny = y + i - halfSize;
                    if (ny >= 0 && ny < height) {
                        val += temp[ny * width + x] * kernel[i];
                    }
                }
                result[y * width + x] = val;
            }
        }

        return result;
    }

    /**
     * 检测阴影区域（在背景区域中，物体边缘以外）
     * 根据边缘检测结果和背景蒙版，识别物体边缘外侧的阴影像素
     * @param {Uint8ClampedArray} mask - 当前背景蒙版（255=背景/已选中，0=前景）
     * @param {Uint8ClampedArray} edges - 边缘检测结果（255=边缘，0=非边缘）
     * @param {Object} options - 处理参数
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.shadowDiff - 阴影差异度 0-100
     * @returns {Uint8ClampedArray} 阴影蒙版（255=阴影，0=非阴影）
     */
    detectShadows(mask, edges, options = {}) {
        const maxDistance = options.maxDistance ?? 60;
        const shadowDiff = options.shadowDiff; //(options.shadowDiff ?? 50) / 100;

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        this.bgColor = this.detectBackgroundColor(imageData);
        const bgBrightness = (this.bgColor.r + this.bgColor.g + this.bgColor.b) / 3;

        const distanceMap = this.computeBackgroundDistanceMap(mask, width, height);

        const minColorDiff = 5 + (1 - shadowDiff) * 20;
        const maxColorDiff = Math.min(120, shadowDiff); //Math.min(120, bgBrightness * 0.45);

        const shadowMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                //跳过已有的背景区域
                if (mask[idx] > 0) continue;

                const distance = distanceMap[idx];

                if (distance <= 0 || distance > maxDistance) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);

                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);

                //if (colorDiff < minColorDiff) continue; // 必须注释这里，因为和背景相近才说明是阴影

                if (colorDiff > maxColorDiff) continue;

                const grayness = this.calculateGrayness(pixel);
                if (grayness < 0.5) continue;

                const pixelBrightness = (pixel.r + pixel.g + pixel.b) / 3;
                if (pixelBrightness > bgBrightness) continue;

                shadowMask[idx] = 255;
            }
        }

        this.filterIsolatedShadow(shadowMask, width, height, 3);

        return shadowMask;
    }

    /**
     * 计算背景像素到最近前景边缘的距离图
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景，0=背景）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Float32Array} 距离图
     */
    computeBackgroundDistanceMap(mask, width, height) {
        const distanceMap = new Float32Array(width * height);
        const INF = width + height;

        for (let i = 0; i < mask.length; i++) {
            distanceMap[i] = mask[i] > 0 ? 0 : INF;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] > 0) continue;

                let minDist = distanceMap[idx];
                if (x > 0) minDist = Math.min(minDist, distanceMap[idx - 1] + 1);
                if (y > 0) minDist = Math.min(minDist, distanceMap[idx - width] + 1);
                if (x > 0 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width - 1] + Math.SQRT2);
                if (x < width - 1 && y > 0) minDist = Math.min(minDist, distanceMap[idx - width + 1] + Math.SQRT2);
                distanceMap[idx] = minDist;
            }
        }

        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const idx = y * width + x;
                if (mask[idx] > 0) continue;

                let minDist = distanceMap[idx];
                if (x < width - 1) minDist = Math.min(minDist, distanceMap[idx + 1] + 1);
                if (y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width] + 1);
                if (x > 0 && y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width - 1] + Math.SQRT2);
                if (x < width - 1 && y < height - 1) minDist = Math.min(minDist, distanceMap[idx + width + 1] + Math.SQRT2);
                distanceMap[idx] = minDist;
            }
        }

        return distanceMap;
    }

    /**
     * 过滤孤立的阴影像素（连通性过滤）
     * @param {Uint8ClampedArray} shadowMask - 阴影蒙版
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} minNeighbors - 最小邻居数
     */
    filterIsolatedShadow(shadowMask, width, height, minNeighbors) {
        const temp = new Uint8ClampedArray(shadowMask);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                if (temp[idx] === 0) continue;

                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nidx = (y + dy) * width + (x + dx);
                        if (temp[nidx] > 0) neighbors++;
                    }
                }

                if (neighbors < minNeighbors) {
                    shadowMask[idx] = 0;
                }
            }
        }
    }

    /**
     * 检测背景色（从图像边缘采样 + K-Means聚类）
     * @param {ImageData} imageData - 图像数据
     * @returns {Object} 背景颜色 {r, g, b}
     */
    detectBackgroundColor(imageData) {
        const width = imageData.width;
        const height = imageData.height;
        const colors = [];

        const sampleSize = Math.min(80, Math.floor(width / 6), Math.floor(height / 6));

        for (let i = 0; i < sampleSize; i++) {
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), 2));
            colors.push(canvasUtils.getPixelColor(imageData, Math.floor(i * width / sampleSize), height - 3));
            colors.push(canvasUtils.getPixelColor(imageData, 2, Math.floor(i * height / sampleSize)));
            colors.push(canvasUtils.getPixelColor(imageData, width - 3, Math.floor(i * height / sampleSize)));
        }

        const clusters = this.kMeansClustering(colors, 3, 10);

        let maxCluster = clusters[0];
        for (const cluster of clusters) {
            if (cluster.points.length > maxCluster.points.length) {
                maxCluster = cluster;
            }
        }

        return maxCluster.center;
    }

    /**
     * K-Means聚类
     * @param {Array} points - 颜色点数组
     * @param {number} k - 聚类数
     * @param {number} maxIterations - 最大迭代次数
     * @returns {Array} 聚类结果
     */
    kMeansClustering(points, k, maxIterations = 10) {
        const centers = [];
        for (let i = 0; i < k; i++) {
            centers.push({
                r: points[Math.floor(i * points.length / k)].r,
                g: points[Math.floor(i * points.length / k)].g,
                b: points[Math.floor(i * points.length / k)].b
            });
        }

        for (let iter = 0; iter < maxIterations; iter++) {
            const clusters = centers.map(c => ({ center: c, points: [] }));

            for (const point of points) {
                let minDist = Infinity;
                let minIdx = 0;

                for (let i = 0; i < k; i++) {
                    const dist = canvasUtils.colorDistance(point, centers[i]);
                    if (dist < minDist) {
                        minDist = dist;
                        minIdx = i;
                    }
                }

                clusters[minIdx].points.push(point);
            }

            let changed = false;
            for (let i = 0; i < k; i++) {
                if (clusters[i].points.length === 0) continue;

                const newCenter = { r: 0, g: 0, b: 0 };
                for (const point of clusters[i].points) {
                    newCenter.r += point.r;
                    newCenter.g += point.g;
                    newCenter.b += point.b;
                }

                newCenter.r = Math.round(newCenter.r / clusters[i].points.length);
                newCenter.g = Math.round(newCenter.g / clusters[i].points.length);
                newCenter.b = Math.round(newCenter.b / clusters[i].points.length);

                if (canvasUtils.colorDistance(newCenter, centers[i]) > 1) {
                    changed = true;
                }

                centers[i] = newCenter;
            }

            if (!changed) break;
        }

        return centers.map((c, i) => ({ center: c, points: [] }));
    }

    /**
     * 计算像素的中性灰程度
     * @param {Object} pixel - 像素颜色 {r, g, b}
     * @returns {number} 灰度值 0-1（1=完全中性灰）
     */
    calculateGrayness(pixel) {
        const avg = (pixel.r + pixel.g + pixel.b) / 3;
        const maxDiff = Math.max(
            Math.abs(pixel.r - avg),
            Math.abs(pixel.g - avg),
            Math.abs(pixel.b - avg)
        );
        return Math.max(0, 1 - maxDiff / 60);
    }

    /**
     * 计算阴影区域的alpha值
     * 根据颜色差异和距离衰减计算每个阴影像素的半透明度
     * @param {Uint8ClampedArray} shadowMask - 阴影蒙版
     * @param {Uint8ClampedArray} mask - 前景蒙版（255=前景，0=背景）
     * @param {number} intensity - 阴影透明度 0-100
     * @returns {Uint8ClampedArray} alpha蒙版（每个阴影像素的alpha值 0-255）
     */
    calculateShadowAlpha(shadowMask, mask, intensity) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);
        const intensityFactor = intensity / 100;

        const distanceMap = this.computeBackgroundDistanceMap(mask, width, height);
        let maxDist = 1;
        for (let i = 0; i < distanceMap.length; i++) {
            if (distanceMap[i] > maxDist) maxDist = distanceMap[i];
        }

        const alphaMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (shadowMask[idx] === 0) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);
                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);
                const distance = distanceMap[idx];

                const alphaBase = Math.min(1, colorDiff / 80);

                const edgeFade = Math.max(0, 1 - distance / maxDist);
                const smoothFade = edgeFade * edgeFade * (3 - 2 * edgeFade);

                const alpha = alphaBase * smoothFade * intensityFactor;
                alphaMask[idx] = Math.round(alpha * 255);
            }
        }

        return alphaMask;
    }

    /**
     * 应用阴影处理到画布
     * 紫色选区（foregroundMask>0）完全抠除，粉色选区（shadowAlphaMask>0）半透明抠除，其余保持原样
     * @param {Uint8ClampedArray} foregroundMask - 前景蒙版（紫色选区，255=待完全抠除的区域）
     * @param {Uint8ClampedArray} shadowAlphaMask - 阴影alpha蒙版（粉色选区，0-255灰度值表示抠除程度）
     */
    applyToCanvas(foregroundMask, shadowAlphaMask) {
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        for (let i = 0; i < foregroundMask.length; i++) {
            const idx = i * 4;

            if (foregroundMask[i] > 0) {
                imageData.data[idx + 3] = 0;
            } else if (shadowAlphaMask[i] > 0) {
                imageData.data[idx + 3] = 255 - shadowAlphaMask[i];
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
    }
}
