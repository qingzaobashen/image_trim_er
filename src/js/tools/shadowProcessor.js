/**
 * 阴影处理工具模块
 * 提供白底图阴影识别与半透明过渡处理功能
 *
 * 核心流程：
 * 1. 边缘检测：使用Canny算法检测物体轮廓，连接离散边缘点形成连续曲线
 * 2. 阴影检测：在背景区域中，从前景边界向外生长，遇到边缘曲线停止，识别阴影区域
 * 3. 阴影画笔：手动调整阴影选区（涂抹新增/取消）
 * 4. 应用处理：紫色选区完全抠除，粉色阴影选区半透明抠除
 *
 * **Mask 逻辑说明**：
 * - mask[i] > 0 表示背景区域（要抠除的部分）
 * - mask[i] === 0 表示前景区域（要保留的部分）
 * - 这符合行业通用标准：mask 标记的是需要抠除的区域
 *
 * 选区颜色约定：
 * - 紫色(99,102,241)：背景抠除选区（完全抠除）
 * - 粉色(236,72,153)：阴影选区（半透明抠除）
 * - 细线(0,200,255)：边缘检测轮廓线
 */

import * as canvasUtils from '../utils/canvasUtils.js';

/** OpenCV.js 脚本路径 */
const OPENCV_JS_PATH = '/opencv.js';

/** OpenCV.js 全局加载状态 */
let _opencvLoadingPromise = null;

/**
 * 按需动态加载 OpenCV.js
 * 避免在页面启动时同步加载 7.7MB 的脚本
 * @returns {Promise<void>}
 */
function loadOpenCV() {
    // 已加载或加载中
    if (typeof cv !== 'undefined' && cv.Mat) {
        return Promise.resolve();
    }
    if (_opencvLoadingPromise) {
        return _opencvLoadingPromise;
    }

    _opencvLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = OPENCV_JS_PATH;
        script.type = 'text/javascript';
        script.async = true;

        script.onload = () => {
            // OpenCV.js 加载后需要等待 WASM 初始化完成
            const checkReady = () => {
                if (typeof cv !== 'undefined' && cv.Mat) {
                    resolve();
                } else if (typeof cv !== 'undefined' && cv['onRuntimeInitialized']) {
                    // 旧版本 OpenCV.js 使用 onRuntimeInitialized
                    cv['onRuntimeInitialized'] = () => resolve();
                } else {
                    setTimeout(checkReady, 50);
                }
            };
            checkReady();
        };

        script.onerror = () => {
            _opencvLoadingPromise = null;
            reject(new Error('OpenCV.js 加载失败'));
        };

        document.head.appendChild(script);
    });

    return _opencvLoadingPromise;
}

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
     * 
     * Canny边缘检测算法流程：
     * 1. 灰度转换：将彩色图像转为灰度图，简化计算
     * 2. 高斯模糊：去除噪声，避免噪声被误识别为边缘
     * 3. 梯度计算：计算每个像素的梯度幅值和方向
     * 4. 非极大值抑制：细化边缘，保留梯度方向上的局部最大值
     * 5. 双阈值检测：区分强边缘、弱边缘和非边缘
     * 6. 边缘连接：将弱边缘连接到强边缘，形成连续边缘
     * 
     * @param {ImageData} imageData - 图像数据
     * @returns {Uint8ClampedArray} 边缘图（255=边缘，0=非边缘）
     */
    detectEdges(imageData) {
        const width = imageData.width;
        const height = imageData.height;

        // ==================== 步骤1：灰度转换 ====================
        // 将RGB彩色图像转换为灰度图像
        // 使用加权平均法：Gray = 0.299*R + 0.587*G + 0.114*B
        // 权重基于人眼对不同颜色的敏感度（人眼对绿色最敏感）
        const gray = new Float32Array(width * height);
        for (let i = 0; i < width * height; i++) {
            const idx = i * 4; // RGBA四个通道，每个像素占4个字节
            gray[i] = imageData.data[idx] * 0.333 +      // R通道权重0.299
                      imageData.data[idx + 1] * 0.333 +  // G通道权重0.587
                      imageData.data[idx + 2] * 0.333;   // B通道权重0.114
        }

        // ==================== 步骤2：高斯模糊去噪 ====================
        // 使用高斯滤波器平滑图像，去除噪声点
        // 噪声点通常有很高的梯度值，会被误识别为边缘
        // sigma=1.4 控制模糊程度，值越大越模糊
        // const blurred = this.applyGaussianBlur(gray, width, height, 1.1);
        const blurred = gray;

        // ==================== 步骤3：计算梯度幅值和方向 ====================
        // 使用Sobel算子计算每个像素的梯度
        // 梯度 = 图像亮度变化率，边缘就是亮度变化剧烈的地方
        const gradient = new Float32Array(width * height);  // 梯度幅值
        const direction = new Float32Array(width * height); // 梯度方向（弧度）

        // 遍历图像每个像素（跳过边界像素，避免数组越界）
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                
                // 获取3x3邻域的9个像素值
                // tl=左上, tc=上, tr=右上
                // ml=左,   mr=右
                // bl=左下, bc=下, br=右下
                const tl = blurred[(y - 1) * width + (x - 1)];
                const tc = blurred[(y - 1) * width + x];
                const tr = blurred[(y - 1) * width + (x + 1)];
                const ml = blurred[y * width + (x - 1)];
                const mr = blurred[y * width + (x + 1)];
                const bl = blurred[(y + 1) * width + (x - 1)];
                const bc = blurred[(y + 1) * width + x];
                const br = blurred[(y + 1) * width + (x + 1)];

                // 计算水平梯度Gx（检测垂直边缘）
                // Sobel算子：[-1  0 +1]
                //            [-2  0 +2]
                //            [-1  0 +1]
                const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
                
                // 计算垂直梯度Gy（检测水平边缘）
                // Sobel算子：[-1 -2 -1]
                //            [ 0  0  0]
                //            [+1 +2 +1]
                const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;

                // 计算梯度幅值：|G| = sqrt(Gx² + Gy²)
                // 幅值越大，表示亮度变化越剧烈，越可能是边缘
                gradient[idx] = Math.sqrt(gx * gx + gy * gy);
                
                // 计算梯度方向：θ = atan2(Gy, Gx)
                // 方向表示亮度变化的方向（垂直于边缘方向）
                direction[idx] = Math.atan2(gy, gx);
            }
        }

        // ==================== 步骤4：非极大值抑制 ====================
        // 细化边缘，只保留梯度方向上的局部最大值
        // 目的：将边缘从"粗线"变成"细线"，精确定位边缘位置
        const suppressed = new Float32Array(width * height);
        
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;
                const angle = direction[idx]; // 当前像素的梯度方向
                const mag = gradient[idx];    // 当前像素的梯度幅值

                // 将角度归一化到[0, π)范围
                // 因为边缘方向是双向的（0°和180°是同一条边缘）
                const normAngle = ((angle % Math.PI) + Math.PI) % Math.PI;
                let neighbor1 = 0, neighbor2 = 0;

                // 根据梯度方向，确定需要比较的两个邻居像素
                // 梯度方向垂直于边缘方向，所以沿着梯度方向比较
                if ((normAngle >= 0 && normAngle < Math.PI / 8) ||
                    (normAngle >= 7 * Math.PI / 8 && normAngle < Math.PI)) {
                    // 方向接近水平（0°）：比较左右邻居
                    neighbor1 = gradient[idx - 1];
                    neighbor2 = gradient[idx + 1];
                } else if (normAngle >= Math.PI / 8 && normAngle < 3 * Math.PI / 8) {
                    // 方向接近45°：比较右上和左下邻居
                    neighbor1 = gradient[(y - 1) * width + (x + 1)];
                    neighbor2 = gradient[(y + 1) * width + (x - 1)];
                } else if (normAngle >= 3 * Math.PI / 8 && normAngle < 5 * Math.PI / 8) {
                    // 方向接近垂直（90°）：比较上下邻居
                    neighbor1 = gradient[(y - 1) * width + x];
                    neighbor2 = gradient[(y + 1) * width + x];
                } else {
                    // 方向接近135°：比较左上和右下邻居
                    neighbor1 = gradient[(y - 1) * width + (x - 1)];
                    neighbor2 = gradient[(y + 1) * width + (x + 1)];
                }

                // 如果当前像素的梯度幅值大于等于两个邻居，则保留
                // 否则抑制（设为0），这样边缘就变细了
                if (mag >= neighbor1 && mag >= neighbor2) {
                    suppressed[idx] = mag;
                }
            }
        }
        // return suppressed;

        // ==================== 步骤5：双阈值检测 ====================
        // 使用两个阈值将像素分为三类：强边缘、弱边缘、非边缘
        const edges = new Uint8ClampedArray(width * height);
        const highThreshold = 60; // 高阈值：确定是边缘
        const lowThreshold = 20;   // 低阈值：可能是边缘

        // 第一遍：标记所有强边缘（梯度幅值 >= 高阈值）// gz: 跳过suppressed，因为它会把一些弱边缘干掉
        for (let i = 0; i < gradient.length; i++) {
            if (gradient[i] >= highThreshold) {
                edges[i] = 255; // 标记为边缘
            }
        }
        // return edges;

        // ==================== 步骤6：边缘连接（滞后跟踪） ====================
        // 将弱边缘连接到强边缘
        // 如果弱边缘与强边缘相连，则认为是真实边缘的一部分
        let changed = true;
        while (changed) {
            changed = false;
            // 遍历所有像素
            for (let y = 1; y < height - 1; y++) {
                for (let x = 1; x < width - 1; x++) {
                    const idx = y * width + x;
                    // 如果当前像素已经是强边缘
                    if (edges[idx] === 255) {
                        // 检查8邻域
                        for (let dy = -2; dy <= 2; dy++) {
                            for (let dx = -2; dx <= 2; dx++) {
                                const nidx = (y + dy) * width + (x + dx);
                                // 如果邻居是弱边缘（低阈值 <= 梯度 < 高阈值）且尚未标记为边缘
                                if (gradient[nidx] >= lowThreshold && edges[nidx] === 0) {
                                    edges[nidx] = 255; // 将弱边缘提升为强边缘
                                    changed = true;    // 标记有变化，需要继续迭代
                                }
                            }
                        }
                    }
                }
            }
        }
        // 迭代直到没有新的弱边缘被连接为止
        // 最终结果：连续的边缘线条

        this.edgeData = edges;
        return edges;
    }

    /**
     * 使用OpenCV.js检测物体边缘轮廓（Canny边缘检测）
     * 基于OpenCV.js的WebAssembly实现，性能优于纯JS手写版本
     *
     * 使用前需确保OpenCV.js已加载，可通过以下方式引入：
     * 1. CDN方式：在HTML中添加 <script async src="https://docs.opencv.org/4.x/opencv.js" type="text/javascript"></script>
     * 2. NPM方式：npm install @techstark/opencv-js
     *
     * OpenCV Canny算法内部流程（由WASM原生执行，速度更快）：
     * 1. cvtColor：将RGBA转为灰度图
     * 2. GaussianBlur：5x5高斯核去噪，sigma=1.4
     * 3. Sobel：计算梯度幅值和方向（3x3算子）
     * 4. 非极大值抑制：细化边缘为单像素宽
     * 5. 双阈值检测 + 滞后跟踪：连接弱边缘到强边缘
     *
     * @param {ImageData} imageData - 图像数据
     * @param {Object} options - 可选参数
     * @param {number} options.lowThreshold - 低阈值，默认15（控制弱边缘灵敏度）
     * @param {number} options.highThreshold - 高阈值，默认40（控制强边缘判定）
     * @param {number} options.blurKernelSize - 高斯模糊核大小，默认5（必须为奇数）
     * @param {number} options.blurSigma - 高斯模糊标准差，默认0（由核大小自动计算）
     * @returns {Promise<Uint8ClampedArray|null>} 边缘图（255=边缘，0=非边缘），OpenCV加载失败时返回null
     */
    async detectEdgesWithOpenCV(imageData, options = {}) {
        // 按需加载 OpenCV.js，避免页面启动时同步加载 7.7MB 脚本
        try {
            await loadOpenCV();
        } catch (error) {
            console.warn('OpenCV.js 加载失败，回退到手写边缘检测:', error);
            return null;
        }

        const width = imageData.width;
        const height = imageData.height;

        // 解析可选参数，提供默认值
        const lowThreshold = options.lowThreshold ?? 15;   // 低阈值：弱边缘的下限
        const highThreshold = options.highThreshold ?? 40;  // 高阈值：强边缘的下限
        const blurKernelSize = options.blurKernelSize ?? 5; // 高斯模糊核大小（奇数）
        const blurSigma = options.blurSigma ?? 0;           // sigma=0时由核大小自动推算
        console.log('lowThreshold', lowThreshold);
        console.log('highThreshold', highThreshold);
        console.log('blurKernelSize', blurKernelSize);
        console.log('blurSigma', blurSigma);

        // ==================== 步骤1：将ImageData转为OpenCV Mat对象 ====================
        // ImageData.data是RGBA格式的Uint8ClampedArray
        // cv.Mat构造函数：new cv.Mat(rows, cols, type)
        // CV_8UC4 = 4通道8位无符号整数（对应RGBA）
        const src = new cv.Mat(height, width, cv.CV_8UC4);
        // 将ImageData的像素数据拷贝到Mat中
        src.data.set(imageData.data);

        // ==================== 步骤2：灰度转换 ====================
        // 将RGBA彩色图转为单通道灰度图
        // cvtColor是OpenCV的颜色空间转换函数
        // COLOR_RGBA2GRAY = 将RGBA转为灰度（内部使用加权平均：0.299R + 0.587G + 0.114B）
        //const gray = new cv.Mat();
        //cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);  // gz: 不用灰度图，针对白底的边缘检测会更好

        // ==================== 步骤3：高斯模糊去噪 ====================
        // 使用高斯滤波器平滑灰度图，消除噪声干扰
        // GaussianBlur参数：
        //   - gray：输入灰度图
        //   - blurred：输出模糊图
        //   - new cv.Size(ksize, ksize)：高斯核尺寸（必须为正奇数）
        //   - sigmaX：X方向标准差，0表示由核大小自动计算
        const blurred = new cv.Mat();
        cv.GaussianBlur(src, blurred, new cv.Size(blurKernelSize, blurKernelSize), blurSigma);

        // ==================== 步骤4：Canny边缘检测 ====================
        // OpenCV的Canny函数内部自动完成：
        //   a) Sobel算子计算梯度幅值和方向
        //   b) 非极大值抑制（细化边缘）
        //   c) 双阈值分类（强边缘 >= highThreshold，弱边缘 >= lowThreshold）
        //   d) 滞后跟踪（将连接到强边缘的弱边缘保留，其余丢弃）
        // Canny参数：
        //   - blurred：输入图像（必须是单通道灰度图）
        //   - edges：输出边缘图（二值图，边缘像素=255，非边缘=0）
        //   - threshold1：低阈值（弱边缘下限）
        //   - threshold2：高阈值（强边缘下限）
        const edges = new cv.Mat();
        cv.Canny(blurred, edges, lowThreshold, highThreshold);

        // ==================== 步骤5：将OpenCV Mat转为Uint8ClampedArray ====================
        // edges是CV_8UC1类型（单通道8位），每个像素值0或255
        // 直接拷贝Mat.data到新的Uint8ClampedArray
        const result = new Uint8ClampedArray(width * height);
        result.set(edges.data);

        // ==================== 步骤6：释放OpenCV Mat内存 ====================
        // OpenCV.js使用WebAssembly管理内存，Mat对象不会自动垃圾回收
        // 必须手动调用delete()释放，否则会导致内存泄漏
        src.delete();
        //gray.delete();
        blurred.delete();
        edges.delete();

        // 保存边缘数据到实例属性，供后续阴影检测使用
        this.edgeData = result;
        return result;
    }

    /**
     * 检查OpenCV.js是否已加载并可用
     * @returns {boolean} OpenCV.js是否可用
     */
    isOpenCVReady() {

        if (typeof cv !== 'undefined' && cv.Mat !== undefined) {
            return true;
        } else {
            console.warn('OpenCV.js未加载，无法使用detectEdgesWithOpenCV。请在HTML中引入opencv.js');
            return false;
        }
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
     * 连接离散边缘点形成连续边缘曲线
     * 通过形态学闭运算填补小间隙，再通过端点检测和Bresenham连线连接断裂边缘
     * @param {Uint8ClampedArray} edges - 原始边缘检测结果
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} connectRadius - 端点连接搜索半径
     * @returns {Uint8ClampedArray} 连接后的边缘曲线
     */
    connectEdgeCurves(edges, width, height, connectRadius = 8) {
        const connected = new Uint8ClampedArray(edges);

        this.morphClose(connected, width, height, 5);

        const endpoints = this.findEdgeEndpoints(connected, width, height);

        for (let i = 0; i < endpoints.length; i++) {
            for (let j = i + 1; j < endpoints.length; j++) {
                const p1 = endpoints[i];
                const p2 = endpoints[j];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 0 && dist <= connectRadius) {
                    this.drawLine(connected, width, height, p1.x, p1.y, p2.x, p2.y);
                }
            }
        }

        return connected;
    }

    /**
     * 形态学闭运算（先膨胀后腐蚀），填补边缘中的小间隙
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphClose(data, width, height, radius) {
        this.morphDilate(data, width, height, radius);
        this.morphErode(data, width, height, radius-2);  // 这里减2是因为腐蚀不能又腐蚀回原边界
    }

    /**
     * 形态学膨胀
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphDilate(data, width, height, radius) {
        const temp = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (temp[y * width + x] === 0) continue;
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            data[ny * width + nx] = 255;
                        }
                    }
                }
            }
        }
    }

    /**
     * 形态学腐蚀  TODO: 这个函数应该实现为用8个方向长条形的结构体进行腐蚀
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} radius - 结构元素半径
     */
    morphErode(data, width, height, radius) {
        const temp = new Uint8ClampedArray(data);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (temp[y * width + x] === 0) continue;
                let allPresent = true;
                for (let dy = -radius; dy <= radius && allPresent; dy++) {
                    for (let dx = -radius; dx <= radius && allPresent; dx++) {
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            if (temp[ny * width + nx] === 0) {
                                allPresent = false;
                            }
                        }
                    }
                }
                if (!allPresent) {
                    data[y * width + x] = 0;
                }
            }
        }
    }

    /**
     * 查找边缘端点（8邻域中仅有1个边缘邻居的像素）
     * @param {Uint8ClampedArray} edges - 边缘数据
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Array} 端点数组 [{x, y}, ...]
     */
    findEdgeEndpoints(edges, width, height) {
        const endpoints = [];
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                if (edges[y * width + x] === 0) continue;

                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        if (edges[(y + dy) * width + (x + dx)] > 0) neighbors++;
                    }
                }

                if (neighbors === 1) {
                    endpoints.push({ x, y });
                }
            }
        }
        return endpoints;
    }

    /**
     * 使用Bresenham算法在边缘图上画线，连接两个端点
     * @param {Uint8ClampedArray} data - 边缘数据（原地修改）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @param {number} x0 - 起点X
     * @param {number} y0 - 起点Y
     * @param {number} x1 - 终点X
     * @param {number} y1 - 终点Y
     */
    drawLine(data, width, height, x0, y0, x1, y1) {
        const dx = Math.abs(x1 - x0);
        const dy = Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1;
        const sy = y0 < y1 ? 1 : -1;
        let err = dx - dy;

        while (true) {
            if (x0 >= 0 && x0 < width && y0 >= 0 && y0 < height) {
                data[y0 * width + x0] = 255;
            }
            if (x0 === x1 && y0 === y1) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    /**
     * 构建张力闭合的边缘障碍图
     * 对边缘曲线进行膨胀操作以闭合微小空隙，防止洪水算法渗透穿过边界
     *
     * 张力机制原理：
     * 边缘检测算法（Canny）可能因图像噪声、光照变化等因素产生1~3像素的微小断裂
     * 这些断裂在洪水填充时会导致算法"渗透"到边界另一侧，产生错误的阴影区域
     * 张力机制通过对边缘进行小范围膨胀，让相邻边缘像素之间产生"张力连接"
     * 将微小空隙自动闭合，同时保留前景边界像素作为洪水填充的入口
     *
     * 膨胀策略：
     * - 使用圆形结构元素（欧氏距离），膨胀半径 = tensionRadius
     * - 膨胀后边缘变厚，间隙被填充，形成连续闭合的障碍墙
     * - 最后清除前景边界位置的障碍标记，确保种子点可以正常扩散
     *
     * @param {Uint8ClampedArray} edgeCurves - 原始边缘曲线（255=边缘，0=非边缘）
     * @param {Uint8ClampedArray} foregroundBoundary - 前景边界（255=边界像素）
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} tensionRadius - 张力半径（膨胀像素数），默认2
     * @returns {Uint8ClampedArray} 张力闭合后的边缘障碍图（255=障碍，0=可通过）
     */
    buildTensionBarrier(edgeCurves, foregroundBoundary, width, height, tensionRadius = 2) {
        // 拷贝原始边缘曲线，避免修改原数组
        const barrier = new Uint8ClampedArray(edgeCurves);

        // 对边缘进行膨胀操作，闭合微小空隙
        // 膨胀：将每个边缘像素的 tensionRadius 邻域内的像素也标记为边缘
        // 效果：1像素宽的边缘线 → (1 + 2*tensionRadius) 像素宽
        // 间隙小于 2*tensionRadius 像素的断裂会被自动闭合
        this.morphDilate(barrier, width, height, tensionRadius);

        // 清除前景边界像素上的障碍标记
        // 前景边界是洪水填充的种子点位置，必须保持可通行
        // 如果不清除，膨胀后的边缘会覆盖种子点，导致洪水无法开始扩散
        for (let i = 0; i < foregroundBoundary.length; i++) {
            if (foregroundBoundary[i] > 0) {
                barrier[i] = 0; // 将种子点位置重置为可通过
            }
        }

        return barrier;
    }

    /**
     * 计算边缘感知的距离图（洪水算法 + 张力机制）
     *
     * 算法流程：
     * Phase 1 — 提取前景边界：找到前景蒙版中与背景相邻的像素，作为洪水填充的种子点
     * Phase 2 — 构建张力障碍图：对边缘曲线进行膨胀闭合微小空隙，形成连续障碍墙
     * Phase 3 — 洪水填充（Flood Fill）：从种子点出发，使用队列驱动的BFS向背景区域扩散
     *           遇到张力障碍墙时停止，确保洪水不会渗透到边界另一侧
     *
     * 洪水算法（Flood Fill）原理：
     * - 类比：将水从种子点倒入，水会自动流向所有连通的低洼区域
     * - 实现：从种子点开始，逐层向外扩展，访问所有可达的背景像素
     * - 障碍：张力障碍墙像水坝一样阻挡洪水，确保水不会越过边界
     * - 距离：记录每个像素到最近种子点的最短路径长度
     *
     * 张力机制解决的问题：
     * 当边缘检测产生1~3像素的微小断裂时，普通洪水会从断裂处渗透到边界另一侧
     * 张力机制通过膨胀边缘闭合断裂，让洪水被阻挡在正确的区域内
     *
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景/选中，0=背景）
     * @param {Uint8ClampedArray} edgeCurves - 连接后的边缘曲线（255=边缘，0=非边缘）
     * @param {number} width - 图像宽度
     * @param {number} height - 图像高度
     * @param {number} maxDistance - 最大阴影距离（像素）
     * @param {number} [tensionRadius=2] - 张力半径，控制微小空隙闭合能力
     * @returns {Float32Array} 距离图（INF=不可达/被障碍阻断，数值=到最近种子点的距离）
     */
    computeEdgeAwareDistanceMap(mask, edgeCurves, width, height, maxDistance, tensionRadius = 2) {
        // ====================================================================
        // Phase 1: 提取前景边界作为洪水填充的种子点
        // ====================================================================
        // 前景边界 = 前景像素中至少有一个邻居是背景的像素
        // 这些边界像素是阴影检测的"起点"，阴影从这里向外生长
        // 例如：杯子轮廓边缘的外侧就是前景边界
        const foregroundBoundary = this.extractForegroundBoundary(mask, width, height);

        // ====================================================================
        // Phase 2: 构建张力闭合的障碍墙
        // ====================================================================
        // 对边缘曲线进行膨胀，闭合微小断裂，形成连续的障碍墙
        // 张力半径 tensionRadius 控制闭合能力：
        //   - tensionRadius=1: 闭合1~2像素的间隙
        //   - tensionRadius=2: 闭合3~4像素的间隙
        //   - tensionRadius=3: 闭合5~6像素的间隙
        const barrier = this.buildTensionBarrier(
            edgeCurves, foregroundBoundary, width, height, tensionRadius
        );

        // ====================================================================
        // Phase 3: 洪水填充 — 从种子点扩散，遇到障碍墙停止
        // ====================================================================

        // 定义"无穷大"距离值，表示像素不可达
        // 使用 width + height 作为 INF，保证大于任何可能的实际距离
        const INF = width + height;

        // 距离图：存储每个背景像素到最近种子点的最短距离
        // 初始化为 INF（不可达），后续通过洪水填充更新
        const distanceMap = new Float32Array(width * height);
        distanceMap.fill(INF);

        // 访问标记：记录像素是否已被洪水填充处理过
        // 0=未访问，1=已访问（已在队列中或已处理完毕）
        const visited = new Uint8ClampedArray(width * height);

        // ==================== 初始化种子点队列 ====================
        // 使用数组模拟队列，head指针标识队首，避免频繁shift操作
        const queue = [];

        // 遍历所有像素，将前景边界像素加入种子队列
        for (let i = 0; i < foregroundBoundary.length; i++) {
            if (foregroundBoundary[i] > 0) {
                // 种子点到自身的距离为0
                distanceMap[i] = 0;
                // 标记为已访问
                visited[i] = 1;
                // 种子点入队
                queue.push(i);
            }
        }

        // ==================== 定义8邻域方向和距离权重 ====================
        // 8邻域：上、下、左、右 + 4个对角线方向
        const dx8 = [-1, 1, 0, 0, -1, -1, 1, 1];  // X方向偏移
        const dy8 = [0, 0, -1, 1, -1, 1, -1, 1];  // Y方向偏移

        // 距离权重：水平/垂直步长为1，对角线步长为√2≈1.414
        const dist8 = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

        // ==================== 洪水填充主循环 ====================
        let head = 0; // 队首指针

        while (head < queue.length) {
            // 从队列取出一个像素（FIFO，保证按距离层序处理）
            const idx = queue[head++];

            // 将一维索引转换为二维坐标
            const x = idx % width;
            const y = Math.floor(idx / width);

            // 当前像素的距离值
            const currentDist = distanceMap[idx];

            // 距离剪枝：如果当前距离已达到最大阴影距离，不再向外扩散
            // 这是性能优化，避免计算超出用户关心范围的像素
            if (currentDist >= maxDistance) continue;

            // 遍历8个方向的邻居像素
            for (let d = 0; d < 8; d++) {
                const nx = x + dx8[d]; // 邻居X坐标
                const ny = y + dy8[d]; // 邻居Y坐标

                // 图像边界检查：确保邻居坐标在有效范围内
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

                // 计算邻居的一维索引
                const nidx = ny * width + nx;

                // 已访问检查：每个像素只处理一次
                if (visited[nidx]) continue;

                // 前景像素检查：阴影只在背景区域中生长
                // mask[nidx] > 0 表示该像素属于前景（已被用户选中），不进入
                if (mask[nidx] > 0) continue;

                // ============ 张力障碍墙检查（核心阻断逻辑） ============
                // 如果邻居像素在张力障碍墙中，洪水停止向该方向扩散
                // barrier[nidx] > 0 表示该像素已被膨胀后的边缘覆盖
                // 标记为已访问（防止重复检查），但不加入队列
                // 相当于在障碍墙处设置了一道不可逾越的"水坝"
                if (barrier[nidx] > 0) {
                    visited[nidx] = 1;
                    continue; // 不扩散，洪水在此停止
                }

                // ============ 计算新距离并更新距离图 ============
                // 新距离 = 当前距离 + 移动步长
                const newDist = currentDist + dist8[d];

                // 如果新距离更短（找到更优路径），则更新
                if (newDist < distanceMap[nidx]) {
                    // 更新邻居的距离值
                    distanceMap[nidx] = newDist;
                    // 标记为已访问
                    visited[nidx] = 1;
                    // 邻居入队，等待后续处理
                    queue.push(nidx);
                }
            }
        }

        // 洪水填充结束
        // - distanceMap[i] 为具体数值：该像素是可达的阴影候选区域
        // - distanceMap[i] 为 INF：该像素不可达（被障碍墙阻断或超出范围）
        return distanceMap;
    }

    /**
     * 提取前景蒙版的边界像素
     * 前景像素中至少有一个8邻域邻居为背景的像素
     * @param {Uint8ClampedArray} mask - 二值蒙版（255=前景，0=背景）
     * @param {number} width - 宽度
     * @param {number} height - 高度
     * @returns {Uint8ClampedArray} 边界图（255=边界像素）
     */
    extractForegroundBoundary(mask, width, height) {
        const boundary = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (mask[idx] === 0) continue;

                let isBoundary = false;
                for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
                    for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                            isBoundary = true;
                        } else if (mask[ny * width + nx] === 0) {
                            isBoundary = true;
                        }
                    }
                }

                if (isBoundary) {
                    boundary[idx] = 255;
                }
            }
        }

        return boundary;
    }

    /**
     * 检测阴影区域（在背景区域中，物体边缘以外）
     * 使用洪水算法 + 张力机制的距离变换，从前景边界向外生长，遇到边缘障碍墙则停止
     * @param {Uint8ClampedArray} mask - 当前前景蒙版（255=前景/选中，0=背景）
     * @param {Uint8ClampedArray} edges - 边缘检测结果（255=边缘，0=非边缘）
     * @param {Object} options - 处理参数
     * @param {number} options.maxDistance - 最大阴影距离（像素）
     * @param {number} options.shadowDiff - 阴影差异度 0-100
     * @param {number} [options.tensionRadius=2] - 张力半径，控制微小空隙闭合能力
     * @returns {Uint8ClampedArray} 阴影蒙版（255=阴影，0=非阴影）
     */
    detectShadows(mask, edges, options = {}) {
        const maxDistance = options.maxDistance ?? 60;
        const shadowDiff = options.shadowDiff ?? 50;
        const userShadowColors = options.shadowColors; // [{r,g,b}, ...] 用户手动指定/提取的阴影色集

        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        this.bgColor = this.detectBackgroundColor(imageData);
        const bgBrightness = (this.bgColor.r + this.bgColor.g + this.bgColor.b) / 3;

        // const edgeCurves = this.connectEdgeCurves(edges, width, height);
        const edgeCurves = edges;

        const distanceMap = this.computeEdgeAwareDistanceMap(
            mask, edgeCurves, width, height, maxDistance, options.tensionRadius ?? 2
        );

        const minColorDiff = 5 + (1 - shadowDiff / 100) * 20;
        const maxColorDiff = Math.min(120, shadowDiff);

        // 用户色模式：任一用户阴影色距离 < 阈值即视为候选阴影
        // 阈值与 shadowDiff 同源：shadowDiff 越大越宽松
        // 注意要 < 256 避免溢出
        const userColorThreshold = Math.max(15, Math.min(120, shadowDiff + 10));

        const shadowMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (mask[idx] > 0) continue;

                const distance = distanceMap[idx];
                const INF = width + height;
                if (distance <= 0 || distance >= INF || distance > maxDistance) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);

                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);

                const grayness = this.calculateGrayness(pixel);
                const pixelBrightness = (pixel.r + pixel.g + pixel.b) / 3;
                const isDarkerThanBg = pixelBrightness <= bgBrightness;

                // 路径 A：自动模式 —— 暗于背景 + 中性灰 + 与背景色差在 [min, maxColorDiff]
                const autoMatch = (
                    colorDiff > minColorDiff &&
                    colorDiff <= maxColorDiff &&
                    grayness >= 0.5 &&
                    isDarkerThanBg
                );

                // 路径 B：用户色模式 —— 像素与任一用户阴影色相似
                let userColorMatch = false;
                if (!autoMatch && userShadowColors && userShadowColors.length > 0) {
                    for (let i = 0; i < userShadowColors.length; i++) {
                        const d = canvasUtils.colorDistance(pixel, userShadowColors[i]);
                        if (d < userColorThreshold) {
                            userColorMatch = true;
                            break;
                        }
                    }
                }

                if (autoMatch || userColorMatch) {
                    shadowMask[idx] = 255;
                }
            }
        }

        this.filterIsolatedShadow(shadowMask, width, height, 3);

        return shadowMask;
    }

    /**
     * 从涂抹取样 mask 中提取主色（颜色直方图 top-K）
     * 输入是用户涂抹在画布上的区域 mask（255=取样像素），输出最频繁的 K 个代表色
     * @param {Uint8ClampedArray} sampleMask - 取样蒙版（255=用户涂抹的像素）
     * @param {number} k - 提取的主色数量
     * @returns {Array<{r:number,g:number,b:number}>} 主色数组
     */
    extractShadowColorsFromSamples(sampleMask, k = 3) {
        if (!sampleMask) return [];
        const width = this.mainCanvas.width;
        const height = this.mainCanvas.height;
        const imageData = canvasUtils.getImageData(this.mainCanvas);

        // 颜色直方图：把 RGB 各压缩到 4 bit (16^3 = 4096 bins)
        // 过滤掉几乎全白 (>= 250) 的取样 —— 用户涂抹到白墙上的反例
        const bins = new Map();
        for (let i = 0; i < sampleMask.length; i++) {
            if (sampleMask[i] !== 255) continue;
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            // 跳过近乎全白：阴影不会是纯白
            if (r >= 250 && g >= 250 && b >= 250) continue;
            const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            const bucket = bins.get(key);
            if (bucket) {
                bucket.rSum += r; bucket.gSum += g; bucket.bSum += b; bucket.count++;
            } else {
                bins.set(key, { rSum: r, gSum: g, bSum: b, count: 1 });
            }
        }

        if (bins.size === 0) return [];

        // 按出现频次降序取 top-K
        const sorted = Array.from(bins.values()).sort((a, b) => b.count - a.count);
        const top = sorted.slice(0, Math.min(k, sorted.length));

        return top.map(b => ({
            r: Math.round(b.rSum / b.count),
            g: Math.round(b.gSum / b.count),
            b: Math.round(b.bSum / b.count)
        }));
    }

    /**
     * 计算背景像素到最近前景边缘的距离图（无边缘约束的简单版本）
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

        // 阴影检测的本意是"暗于背景的投影"，真背景应当是画面中最亮色。
        // 不用 K-Means 选最大簇：① K-Means 在边框/装饰物包围的图
        // （相框、横幅、产品图）容易被边框颜色主导；
        // ② kMeansClustering 的 return 语句错误地返回了空 points 数组，
        // 导致"选最大簇"永远退化为取 clusters[0]（即采样点 0 的颜色）
        const brightness = c => (c.r + c.g + c.b) / 3;
        return colors.reduce((a, c) => brightness(c) > brightness(a) ? c : a);
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

        // 防御：bgColor 只在 detectShadows 内被赋值；如果用户跳过检测直接应用
        // （或 imageData 因抠图变化后 bgColor 已与当前画布脱钩），按当前画布重算一次
        if (!this.bgColor || typeof this.bgColor.r !== 'number') {
            this.bgColor = this.detectBackgroundColor(imageData);
        }

        const intensityFactor = intensity / 100;

        const distanceMap = this.computeBackgroundDistanceMap(mask, width, height);
        let maxDist = 1;
        for (let i = 0; i < distanceMap.length; i++) {
            if (distanceMap[i] > maxDist && distanceMap[i] < width + height) {
                maxDist = distanceMap[i];
            }
        }

        const alphaMask = new Uint8ClampedArray(width * height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;

                if (shadowMask[idx] === 0) continue;

                const pixel = canvasUtils.getPixelColor(imageData, x, y);
                const colorDiff = canvasUtils.colorDistance(pixel, this.bgColor);
                const distance = distanceMap[idx];

                const alphaBase = Math.min(1, colorDiff / 100);

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
                imageData.data[idx + 3] = shadowAlphaMask[i];
            }
        }

        canvasUtils.putImageData(this.mainCanvas, imageData);
    }
}
