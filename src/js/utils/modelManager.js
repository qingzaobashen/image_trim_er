/**
 * 模型管理器模块
 * 基于 @huggingface/transformers (Transformers.js) 实现背景移除模型的加载与管理
 * 使用本地预下载的模型文件，避免网络下载问题
 * 支持模型：MODNet（人像优化）、RMBG-1.4（通用）、ISNet（高质量通用）
 */

import {
    env,
    AutoModel,
    AutoProcessor,
    RawImage,
} from '@huggingface/transformers';

import i18n from '../i18n/i18n.js';

/** 本地模型基础路径（Vite 会自动服务 public 目录下的文件） */
const LOCAL_MODEL_BASE_PATH = '/';

/** MODNet 模型 ID（人像优化，速度快） */
const MODNET_MODEL_ID = 'Xenova/modnet';

/** RMBG-1.4 模型 ID（通用背景移除） */
const RMBG_MODEL_ID = 'briaai/RMBG-1.4';

/** ISNet 模型 ID（高质量通用背景移除） */
const ISNET_MODEL_ID = 'imgly/isnet';

/**
 * 模型精度类型说明
 * - fp32: 全精度（最大最准确）
 * - fp16: 半精度（体积减半，精度略降）
 * - q8: 8位量化（体积小75%，速度快，精度略降）
 */
const DTYPE_OPTIONS = {
    fp32: { name: '高精度', description: '精度最高，体积最大' },
    fp16: { name: '半精度', description: '体积减半，精度略降，推荐WebGPU' },
    q8: { name: '轻量', description: '体积小75%，速度快，精度略降' }
};

/**
 * 模型信息定义（扁平化结构）
 * 每个条目代表一个独立的模型+精度组合，使用 "模型ID:精度" 作为唯一键
 * 便于独立管理和维护，避免混合在一起难以区分
 */
const MODEL_INFO = {
    /** MODNet 全精度版 — 人像优化，体积最小 */
    [`${MODNET_MODEL_ID}:fp32`]: {
        modelId: MODNET_MODEL_ID,
        dtype: 'fp32',
        name: 'MODNet',
        displayNameKey: 'toolbar.models.modnet.fp32.name',
        descriptionKey: 'toolbar.models.modnet.fp32.desc',
        // 英文回退文案（i18n 缺失时使用）
        displayName: 'Portrait Model (High Precision)',
        description_zh: '人像优化模型，适合人物照片抠图，速度快',
        description_en: 'Portrait-optimized model, ideal for person photos, fast speed',
        size: '~25MB',
        quality: 'high',
        speed: 'fast',
        recommended: false,  // 不推荐，仅适合人像
    },

    /** RMBG-1.4 量化版 — 通用默认，体积与效果均衡 */
    [`${RMBG_MODEL_ID}:q8`]: {
        modelId: RMBG_MODEL_ID,
        dtype: 'q8',
        name: 'RMBG',
        displayNameKey: 'toolbar.models.rmbg.q8.name',
        descriptionKey: 'toolbar.models.rmbg.q8.desc',
        displayName: 'General Model (Lightweight)',
        description_zh: '通用背景移除模型，适合大多数场景（默认）',
        description_en: 'General background removal model, suitable for most scenarios (default)',
        size: '~44MB',
        quality: 'highest',
        speed: 'fast',
        recommended: true,  // 推荐，通用性强且体积适中
    },

    /** RMBG-1.4 全精度版 — 最高精度，体积较大，先不用 */
    // [`${RMBG_MODEL_ID}:fp32`]: {
    //     modelId: RMBG_MODEL_ID,
    //     dtype: 'fp32',
    //     name: 'RMBG',
    //     displayName: '通用模型（高精度）',
    //     description_zh: '通用背景移除模型，精度最高，体积较大',
    //     description_en: 'General background removal model, highest precision, larger size',
    //     size: '~176MB',
    //     quality: 'highest',
    //     speed: 'medium',
    //     recommended: false,
    // },

    /** ISNet 半精度版 — 高质量通用，边缘质量优秀 */
    [`${ISNET_MODEL_ID}:fp16`]: {
        modelId: ISNET_MODEL_ID,
        dtype: 'fp16',
        name: 'ISNet',
        displayNameKey: 'toolbar.models.isnet.fp16.name',
        descriptionKey: 'toolbar.models.isnet.fp16.desc',
        displayName: 'Edge Detection Model (Half Precision)',
        description_zh: '边缘识别背景移除模型，边缘分割优秀，适合精细抠图',
        description_en: 'Edge-aware background removal with excellent edge segmentation for fine cutout',
        size: '~84MB',
        quality: 'highest',
        speed: 'medium',
        recommended: false,
    },
};

/** 默认模型键（RMBG-1.4 量化版，通用背景移除） */
const DEFAULT_MODEL_KEY = `${RMBG_MODEL_ID}:q8`;

/**
 * 模型管理器类
 * 负责基于 Transformers.js 的本地模型加载、缓存、切换和内存管理
 * 支持量化模型加载，优化浏览器端性能
 */
export class ModelManager {
    /**
     * 构造函数
     */
    constructor() {
        /** 当前加载的模型实例 */
        this.model = null;
        /** 当前加载的处理器实例 */
        this.processor = null;
        /** 当前模型 ID */
        this.currentModelId = null;
        /** 当前模型精度类型 */
        this.currentDtype = null;
        /** 模型加载状态 */
        this.isLoading = false;
        /** 加载取消标志 */
        this._cancelFlag = false;
        /** 进度回调函数 */
        this.onProgress = null;
        /** 状态变更回调函数 */
        this.onStateChange = null;
        /** 加载开始时间戳 */
        this._loadStartTime = 0;
        /** 错误回调函数 */
        this.onError = null;
        /** 是否为 iOS 设备 */
        this.isIOS = this._detectIOS();

        // 配置 Transformers.js 使用本地模型
        this._configureLocalModels();
    }

    /**
     * 配置 Transformers.js 使用本地模型
     * 模型文件位于 public/ 目录下
     */
    _configureLocalModels() {
        // 启用本地模型支持
        env.allowLocalModels = true;

        // 设置本地模型路径（public 目录下的文件会被 Vite 自动服务）
        env.localModelPath = LOCAL_MODEL_BASE_PATH;

        // 禁用远程模型下载
        env.allowRemoteModels = false;

        // 设置 ONNX Runtime WASM 文件路径指向本地
        // Transformers.js 默认从 jsDelivr CDN 加载 WASM，但 allowRemoteModels=false 会阻止
        // 需要显式指向 public/onnx/ 下的本地 WASM 文件
        if (env.backends?.onnx?.wasm) {
            const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
            const wasmBasePath = '/onnx/';
            env.backends.onnx.wasm.wasmPaths = isSafari
                ? {
                      mjs: `${wasmBasePath}ort-wasm-simd-threaded.mjs`,
                      wasm: `${wasmBasePath}ort-wasm-simd-threaded.wasm`,
                  }
                : {
                      mjs: `${wasmBasePath}ort-wasm-simd-threaded.asyncify.mjs`,
                      wasm: `${wasmBasePath}ort-wasm-simd-threaded.asyncify.wasm`,
                  };
        }

        console.log(`[ModelManager] 使用本地模型，路径: ${LOCAL_MODEL_BASE_PATH}`);
    }

    /**
     * 检测是否为 iOS 设备
     * iOS 设备不支持 WebGPU，需要使用 WASM 回退方案
     * @returns {boolean} 是否为 iOS
     */
    _detectIOS() {
        return [
            'iPad Simulator',
            'iPhone Simulator',
            'iPod Simulator',
            'iPad',
            'iPhone',
            'iPod'
        ].includes(navigator.platform)
        || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
    }

    /**
     * 获取所有可用模型信息（扁平化结构）
     * @returns {Object} 模型信息映射，键为 "模型ID:精度"
     */
    static getModelInfo() {
        return MODEL_INFO;
    }

    /**
     * 获取精度类型信息
     * @returns {Object} 精度类型映射
     */
    static getDtypeOptions() {
        return DTYPE_OPTIONS;
    }

    /**
     * 获取默认模型键（RMBG-1.4 量化版）
     * @returns {string} 默认模型键，格式为 "模型ID:精度"
     */
    static getDefaultModel() {
        return DEFAULT_MODEL_KEY;
    }

    /**
     * 根据 modelId 和 dtype 构建模型键
     * @param {string} modelId - 模型 ID
     * @param {string} dtype - 精度类型
     * @returns {string} 模型键，格式为 "模型ID:精度"
     */
    static buildModelKey(modelId, dtype) {
        return `${modelId}:${dtype}`;
    }

    /**
     * 解析 i18n 键对应的文本，缺失时回退到 fallback
     * @param {string|undefined} key - i18n 键
     * @param {string} fallback - 缺失时使用的回退文本
     * @returns {string} 解析后的文本
     */
    static _resolveI18n(key, fallback) {
        if (!key) return fallback;
        const translated = i18n.t(key);
        // i18n 缺失时 t() 会返回键名本身，需要识别这种回退
        return (translated && translated !== key) ? translated : fallback;
    }

    /**
     * 获取所有可用模型的详细信息列表（用于 UI 渲染）
     * 扁平化结构下，每个条目本身就是独立的模型+精度组合，直接遍历即可
     * 显示名称与描述优先使用 i18n 翻译结果，缺失时回退到 MODEL_INFO 中的英文/默认字段
     * @returns {Array<Object>} 模型信息数组
     */
    static getAvailableModels() {
        const result = [];

        Object.entries(MODEL_INFO).forEach(([key, info]) => {
            // 解析 i18n 显示名称：先查翻译键，缺失时回退到 displayName（英文）
            const resolvedDisplayName = ModelManager._resolveI18n(info.displayNameKey, info.displayName);
            // 解析 i18n 描述：先查翻译键，缺失时回退到 description_en / description_zh
            const resolvedDescription = ModelManager._resolveI18n(
                info.descriptionKey,
                info.description_en || info.description_zh
            );

            result.push({
                key: key,                                  // 唯一键 "模型ID:精度"
                name: info.name,                           // 模型名称（如 RMBG）
                displayName: resolvedDisplayName,          // 本地化后的显示名称
                id: info.modelId,                          // 模型 ID（如 briaai/RMBG-1.4）
                dtype: info.dtype,                         // 精度类型（如 q8）
                description: resolvedDescription,          // 本地化后的描述
                size: info.size,                           // 模型体积
                quality: info.quality,                     // 原始 quality 值（UI 层自行翻译）
                speed: info.speed,
                recommended: info.recommended,
                dtypeName: DTYPE_OPTIONS[info.dtype]?.name || info.dtype,
            });
        });

        return result;
    }

    /**
     * 获取指定模型键的信息
     * @param {string} modelKey - 模型键，格式为 "模型ID:精度"
     * @returns {Object|null} 模型信息对象
     */
    static getModelDetail(modelKey) {
        return MODEL_INFO[modelKey] || null;
    }

    /**
     * 检查模型是否已加载
     * @returns {boolean} 是否已加载
     */
    isModelLoaded() {
        return this.model !== null && this.processor !== null && !this.isLoading;
    }

    /**
     * 获取当前模型 ID
     * @returns {string|null} 当前模型 ID
     */
    getCurrentModelName() {
        return this.currentModelId;
    }

    /**
     * 获取当前模型键（模型ID:精度）
     * @returns {string|null} 当前模型键
     */
    getCurrentModelKey() {
        if (!this.currentModelId || !this.currentDtype) return null;
        return `${this.currentModelId}:${this.currentDtype}`;
    }

    /**
     * 获取当前模型精度类型
     * @returns {string|null} 当前精度类型
     */
    getCurrentDtype() {
        return this.currentDtype;
    }

    /**
     * 获取当前模型和处理器
     * @returns {{ model: Object, processor: Object }|null} 模型实例
     */
    getModelAndProcessor() {
        if (!this.model || !this.processor) return null;
        return { model: this.model, processor: this.processor };
    }

    /**
     * 加载指定模型
     * @param {string} modelKey - 模型键，格式为 "模型ID:精度"，默认为 DEFAULT_MODEL_KEY
     * @returns {Promise<boolean>} 是否加载成功
     * @throws {Error} 模型加载失败时抛出错误
     */
    async loadModel(modelKey = DEFAULT_MODEL_KEY) {
        // 获取模型信息
        const modelInfo = MODEL_INFO[modelKey];
        if (!modelInfo) {
            throw new Error(`未知模型: ${modelKey}`);
        }

        const { modelId, dtype: targetDtype } = modelInfo;

        // 如果正在加载同一模型和精度，直接返回
        if (this.currentModelId === modelId && 
            this.currentDtype === targetDtype && 
            this.model && 
            this.processor && 
            !this.isLoading) {
            return true;
        }

        // 如果正在加载其他模型，先取消并等待
        if (this.isLoading) {
            this.cancelLoading();
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 保存旧模型引用，用于加载失败时回退
        const oldModel = this.model;
        const oldProcessor = this.processor;
        const oldModelId = this.currentModelId;
        const oldDtype = this.currentDtype;
        const oldModelKey = oldModelId && oldDtype ? `${oldModelId}:${oldDtype}` : null;

        // 先清空引用（但不 dispose），避免新模型加载过程中旧模型干扰
        this.model = null;
        this.processor = null;
        this.currentModelId = null;
        this.currentDtype = null;

        this.isLoading = true;
        this._cancelFlag = false;
        this._loadStartTime = Date.now();
        this._emitStateChange('loading', modelId);

        try {
            const dtypeDisplayName = DTYPE_OPTIONS[targetDtype]?.name || targetDtype;

            this._emitProgress({
                step: 'loading',
                progress: 0,
                message: `正在加载 ${modelInfo.name} (${dtypeDisplayName}) 模型...`
            });

            // 配置 WASM 后端
            // 注意：proxy=true 会将 WASM 运行在 Web Worker 中，可避免 UI 卡顿，
            // 但 Worker 初始化依赖 CDN 路径解析，与本地路径配置冲突。
            // 此处关闭代理以确保本地 WASM 文件正确加载。
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.proxy = false;
            }

            // 加载模型（从本地路径，指定精度类型）
            // Transformers.js 会根据 dtype 自动选择 model.onnx 或 model_quantized.onnx
            this.model = await AutoModel.from_pretrained(modelId, {
                dtype: targetDtype,  // 指定精度类型
                progress_callback: (progress) => {
                    if (this._cancelFlag) {
                        throw new Error('MODEL_LOADING_CANCELLED');
                    }
                    this._emitProgressFromTransformers(progress, modelKey);
                }
            });

            // 加载处理器
            this.processor = await AutoProcessor.from_pretrained(modelId);

            if (!this.model || !this.processor) {
                throw new Error('模型或处理器初始化失败');
            }

            this.currentModelId = modelId;
            this.currentDtype = targetDtype;
            this.isLoading = false;

            const loadTime = Date.now() - this._loadStartTime;
            this._emitProgress({
                step: 'complete',
                progress: 100,
                message: `${modelInfo.name} (${dtypeDisplayName}) 模型加载完成 (${modelInfo.size})`
            });
            this._emitStateChange('ready', modelId);
            
            console.log(`[ModelManager] 模型加载成功: ${modelKey}, 耗时: ${loadTime}ms`);

            // 新模型加载成功，释放旧模型资源
            if (oldModel && typeof oldModel.dispose === 'function') {
                try { await oldModel.dispose(); } catch (e) {
                    console.warn('[ModelManager] 旧模型 dispose 失败:', e);
                }
            }

            return true;
        } catch (error) {
            this.isLoading = false;

            if (error.message === 'MODEL_LOADING_CANCELLED') {
                // 取消时恢复旧模型
                this.model = oldModel;
                this.processor = oldProcessor;
                this.currentModelId = oldModelId;
                this.currentDtype = oldDtype;
                this._emitStateChange('cancelled', modelId);
                this._emitProgress({
                    step: 'complete',
                    progress: 0,
                    message: '模型加载已取消'
                });
                throw new Error('模型加载已取消');
            }

            console.error('模型加载失败:', error);
            this._emitStateChange('error', modelId);

            // 清理可能已部分加载的新模型资源
            if (this.model && typeof this.model.dispose === 'function') {
                try { await this.model.dispose(); } catch (e) { /* ignore */ }
            }
            this.model = null;
            this.processor = null;

            // 恢复旧模型引用，确保用户仍可使用
            if (oldModel && oldProcessor) {
                this.model = oldModel;
                this.processor = oldProcessor;
                this.currentModelId = oldModelId;
                this.currentDtype = oldDtype;
                console.log(`[ModelManager] 已恢复旧模型: ${oldModelKey}`);
                this._emitStateChange('ready', oldModelId);
                this._emitProgress({
                    step: 'complete',
                    progress: 100,
                    message: `模型切换失败，已恢复 ${MODEL_INFO[oldModelKey]?.name || oldModelId}`
                });
                // 返回 false 表示切换未成功，但旧模型仍可用
                return false;
            }

            // 没有旧模型可恢复，尝试回退到默认模型
            if (modelKey !== DEFAULT_MODEL_KEY) {
                console.warn(`尝试回退到默认模型 ${DEFAULT_MODEL_KEY}...`);
                try {
                    return await this.loadModel(DEFAULT_MODEL_KEY);
                } catch (fallbackError) {
                    throw new Error(`模型加载失败，回退到默认模型也失败: ${fallbackError.message}`);
                }
            }

            throw new Error(`模型加载失败: ${error.message}`);
        }
    }

    /**
     * 将 Transformers.js 的进度回调转换为统一格式
     * @param {Object} progress - Transformers.js 进度对象
     * @param {string} modelKey - 模型键，格式为 "模型ID:精度"
     */
    _emitProgressFromTransformers(progress, modelKey) {
        const modelInfo = MODEL_INFO[modelKey];
        // 优先使用 i18n 翻译后的显示名称，缺失时回退到 displayName（英文）
        const modelDisplayName = ModelManager._resolveI18n(
            modelInfo?.displayNameKey,
            modelInfo?.displayName || modelKey
        );
        const dtypeDisplayName = modelInfo ? (DTYPE_OPTIONS[modelInfo.dtype]?.name || modelInfo.dtype) : '';

        if (progress.status === 'progress' && progress.file?.includes('onnx')) {
            const percent = progress.progress || 0;
            this._emitProgress({
                step: 'loading',
                progress: percent,
                message: `正在加载 ${modelDisplayName} (${dtypeDisplayName})... ${Math.round(percent)}%`
            });
        } else if (progress.status === 'done' && progress.file?.includes('onnx')) {
            this._emitProgress({
                step: 'processing',
                progress: 100,
                message: `正在初始化 ${modelDisplayName} (${dtypeDisplayName}) 模型...`
            });
        }
    }

    /**
     * 取消当前模型加载
     */
    cancelLoading() {
        if (this.isLoading) {
            this._cancelFlag = true;
        }
    }

    /**
     * 切换到指定模型
     * @param {string} modelKey - 目标模型键，格式为 "模型ID:精度"
     * @returns {Promise<boolean>} 是否切换成功
     */
    async switchModel(modelKey) {
        const modelInfo = MODEL_INFO[modelKey];
        if (!modelInfo) {
            throw new Error(`未知模型: ${modelKey}`);
        }

        // 检查是否已经是同一模型和精度
        if (this.currentModelId === modelInfo.modelId && 
            this.currentDtype === modelInfo.dtype && 
            this.model && 
            this.processor) {
            return true;
        }
        return await this.loadModel(modelKey);
    }

    /**
     * 释放当前模型资源
     * 显式调用模型 dispose() 释放 WebGL 纹理与 WASM 内存，避免内存泄漏
     */
    async disposeCurrentModel() {
        if (this.model && typeof this.model.dispose === 'function') {
            try {
                await this.model.dispose();
            } catch (e) {
                console.warn('[ModelManager] 模型 dispose 失败:', e);
            }
        }
        this.model = null;
        this.processor = null;
        this.currentModelId = null;
        this.currentDtype = null;
        this._emitStateChange('disposed', null);
    }

    /**
     * 释放所有资源
     */
    async disposeAll() {
        await this.disposeCurrentModel();
    }

    /**
     * 获取当前模型信息
     * @returns {Object} 模型信息
     */
    getModelInfo() {
        return {
            currentModelId: this.currentModelId,
            currentDtype: this.currentDtype,
            isIOS: this.isIOS
        };
    }

    /**
     * 触发进度回调
     * @param {Object} progressInfo - 进度信息
     */
    _emitProgress(progressInfo) {
        if (typeof this.onProgress === 'function') {
            this.onProgress(progressInfo);
        }
    }

    /**
     * 触发状态变更回调
     * @param {string} state - 新状态
     * @param {string|null} modelId - 相关模型 ID
     */
    _emitStateChange(state, modelId) {
        if (typeof this.onStateChange === 'function') {
            this.onStateChange(state, modelId);
        }
    }
}