/**
 * 模型管理器模块
 * 基于 @huggingface/transformers (Transformers.js) 实现背景移除模型的加载与管理
 * 使用本地预下载的模型文件，避免网络下载问题
 * 支持模型：MODNet（人像优化，25MB）、RMBG-1.4（高质量通用，176MB/44MB量化版）
 */

import {
    env,
    AutoModel,
    AutoProcessor,
    RawImage,
} from '@huggingface/transformers';

/** 本地模型基础路径（Vite 会自动服务 public 目录下的文件） */
const LOCAL_MODEL_BASE_PATH = '/';

/** MODNet 模型 ID（人像优化，25MB，速度快） */
const MODNET_MODEL_ID = 'Xenova/modnet';

/** RMBG-1.4 模型 ID（高质量通用背景移除，默认使用量化版44MB） */
const RMBG_MODEL_ID = 'briaai/RMBG-1.4';

/**
 * 模型精度类型
 * - fp32: 全精度（默认，最大最准确）
 * - q8: 8位量化（体积小75%，速度快，精度略降）
 */
const DTYPE_OPTIONS = {
    fp32: { name: '高精度', sizeFactor: 1, description: '精度最高，体积最大' },
    q8: { name: '轻量', sizeFactor: 0.25, description: '体积小75%，速度快，精度略降' }
};

/**
 * 模型信息定义
 * 包含模型名称、描述、大小、支持的精度类型等元数据
 */
const MODEL_INFO = {
    [MODNET_MODEL_ID]: {
        name: 'MODNet',
        description_zh: '人像优化模型，适合人物照片抠图，速度快',
        description_en: 'Portrait-optimized model, suitable for person photos',
        baseSize: '~25MB',
        quality: 'high',
        speed: 'fast',
        recommended: false,  // 不推荐，仅适合人像
        supportedDtypes: ['q8'],  // MODNet 只有全精度版本
        defaultDtype: 'q8'
    },
    [RMBG_MODEL_ID]: {
        name: 'RMBG',
        description_zh: '通用背景移除模型，适合大多数场景（默认）',
        description_en: 'High-quality general background removal model, suitable for most scenarios (default)',
        baseSize: '~176MB',
        quality: 'highest',
        speed: 'medium',
        recommended: true,  // 推荐，通用性强
        supportedDtypes: ['fp32', 'q8'],  // 支持全精度和量化版
        defaultDtype: 'q8',  // 默认使用量化版（更小更快）
        quantizedSize: '~44MB'
    }
};

/** 默认模型 ID（RMBG-1.4，通用背景移除） */
const DEFAULT_MODEL = RMBG_MODEL_ID;

/** 高级模型列表（MODNet作为备选） */
const ADVANCED_MODELS = [MODNET_MODEL_ID];

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
     * 获取所有可用模型信息
     * @returns {Object} 模型信息映射
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
     * 获取默认模型 ID
     * @returns {string} 默认模型 ID
     */
    static getDefaultModel() {
        return DEFAULT_MODEL;
    }

    /**
     * 获取高级模型列表
     * @returns {string[]} 高级模型 ID 数组
     */
    static getAdvancedModels() {
        return ADVANCED_MODELS;
    }

    /**
     * 获取所有可用模型的详细信息列表（用于 UI 渲染）
     * 对于支持多种精度的模型，会返回多个选项（如 RMBG-1.4 会返回 fp32 和 q8 两个选项）
     * @returns {Array<Object>} 模型信息数组
     */
    static getAvailableModels() {
        const result = [];
        
        // 首先添加默认模型（使用默认精度）
        const defaultInfo = MODEL_INFO[DEFAULT_MODEL];
        if (defaultInfo) {
            result.push({
                name: `${defaultInfo.name} (${DTYPE_OPTIONS[defaultInfo.defaultDtype].name})`,
                id: DEFAULT_MODEL,
                dtype: defaultInfo.defaultDtype,
                description: defaultInfo.description_zh,
                size: defaultInfo.defaultDtype === 'q8' && defaultInfo.quantizedSize 
                    ? defaultInfo.quantizedSize 
                    : defaultInfo.baseSize,
                quality: defaultInfo.quality === 'standard' ? '标准' :
                         defaultInfo.quality === 'high' ? '高' :
                         defaultInfo.quality === 'highest' ? '极高' : '快速',
                speed: defaultInfo.speed,
                recommended: defaultInfo.recommended,
                dtypeName: DTYPE_OPTIONS[defaultInfo.defaultDtype]?.name || '全精度',
                supportedDtypes: defaultInfo.supportedDtypes
            });
            
            // 如果默认模型支持其他精度，也添加为备选
            defaultInfo.supportedDtypes.forEach(dtype => {
                if (dtype !== defaultInfo.defaultDtype) {
                    const dtypeInfo = DTYPE_OPTIONS[dtype];
                    const size = dtype === 'q8' && defaultInfo.quantizedSize 
                        ? defaultInfo.quantizedSize 
                        : defaultInfo.baseSize;
                    
                    result.push({
                        name: `${defaultInfo.name} (${dtypeInfo.name})`,
                        id: DEFAULT_MODEL,
                        dtype: dtype,
                        description: `${defaultInfo.description_zh}（${dtypeInfo.description}）`,
                        size: size,
                        quality: defaultInfo.quality === 'standard' ? '标准' :
                                 defaultInfo.quality === 'high' ? '高' :
                                 defaultInfo.quality === 'highest' ? '极高' : '快速',
                        speed: dtype === 'q8' ? 'fast' : defaultInfo.speed,
                        recommended: false,  // 非默认精度不标记为推荐
                        dtypeName: dtypeInfo.name,
                        supportedDtypes: defaultInfo.supportedDtypes
                    });
                }
            });
        }
        
        // 添加高级模型
        ADVANCED_MODELS.forEach(id => {
            const info = MODEL_INFO[id];
            if (!info) return;
            
            // 计算实际大小（考虑量化）
            const actualSize = info.defaultDtype === 'q8' && info.quantizedSize 
                ? info.quantizedSize 
                : info.baseSize;
            
            result.push({
                name: `${info.name} (${DTYPE_OPTIONS[info.defaultDtype].name})`,
                id: id,
                dtype: info.defaultDtype,
                description: info.description_zh,
                size: actualSize,
                quality: info.quality === 'standard' ? '标准' :
                         info.quality === 'high' ? '高' :
                         info.quality === 'highest' ? '极高' : '快速',
                speed: info.speed,
                recommended: info.recommended,
                dtypeName: DTYPE_OPTIONS[info.defaultDtype]?.name || '全精度',
                supportedDtypes: info.supportedDtypes
            });
        });
        
        return result;
    }

    /**
     * 获取指定模型的信息
     * @param {string} modelId - 模型 ID
     * @returns {Object|null} 模型信息对象
     */
    static getModelDetail(modelId) {
        return MODEL_INFO[modelId] || null;
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
     * @param {string} modelId - 模型 ID，默认为 MODNet
     * @param {string} dtype - 精度类型 ('fp32' 或 'q8')，默认使用模型推荐的精度
     * @returns {Promise<boolean>} 是否加载成功
     * @throws {Error} 模型加载失败时抛出错误
     */
    async loadModel(modelId = DEFAULT_MODEL, dtype = null) {
        // 获取模型信息
        const modelInfo = MODEL_INFO[modelId];
        if (!modelInfo) {
            throw new Error(`未知模型: ${modelId}`);
        }

        // 确定精度类型
        const targetDtype = dtype || modelInfo.defaultDtype;
        
        // 检查精度类型是否支持
        if (!modelInfo.supportedDtypes.includes(targetDtype)) {
            console.warn(`模型 ${modelId} 不支持 ${targetDtype} 精度，使用默认精度 ${modelInfo.defaultDtype}`);
            dtype = modelInfo.defaultDtype;
        }

        // 如果正在加载同一模型和精度，直接返回
        if (this.currentModelId === modelId && 
            this.currentDtype === targetDtype && 
            this.model && 
            this.processor && 
            !this.isLoading) {
            return true;
        }

        // 如果正在加载其他模型，先取消
        if (this.isLoading) {
            this.cancelLoading();
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isLoading = true;
        this._cancelFlag = false;
        this._loadStartTime = Date.now();
        this._emitStateChange('loading', modelId);

        try {
            // 计算实际大小用于显示
            const actualSize = targetDtype === 'q8' && modelInfo.quantizedSize 
                ? modelInfo.quantizedSize 
                : modelInfo.baseSize;
            
            const dtypeDisplayName = DTYPE_OPTIONS[targetDtype]?.name || targetDtype;

            this._emitProgress({
                step: 'loading',
                progress: 0,
                message: `正在加载 ${modelInfo.name} (${dtypeDisplayName}) 模型...`
            });

            // 配置 WASM 后端
            if (env.backends?.onnx?.wasm) {
                env.backends.onnx.wasm.proxy = true;
            }

            // 加载模型（从本地路径，指定精度类型）
            // Transformers.js 会根据 dtype 自动选择 model.onnx 或 model_quantized.onnx
            this.model = await AutoModel.from_pretrained(modelId, {
                dtype: targetDtype,  // 指定精度类型
                progress_callback: (progress) => {
                    if (this._cancelFlag) {
                        throw new Error('MODEL_LOADING_CANCELLED');
                    }
                    this._emitProgressFromTransformers(progress, modelId, dtypeDisplayName);
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
                message: `${modelInfo.name} (${dtypeDisplayName}) 模型加载完成 (${actualSize})`
            });
            this._emitStateChange('ready', modelId);
            
            console.log(`[ModelManager] 模型加载成功: ${modelId}, 精度: ${targetDtype}, 耗时: ${loadTime}ms`);
            return true;
        } catch (error) {
            this.isLoading = false;

            if (error.message === 'MODEL_LOADING_CANCELLED') {
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

            // 尝试回退策略
            // 1. 如果量化版失败，尝试全精度版
            if (targetDtype === 'q8' && modelInfo.supportedDtypes.includes('fp32')) {
                console.warn(`量化模型加载失败，尝试回退到全精度版本...`);
                try {
                    return await this.loadModel(modelId, 'fp32');
                } catch (fallbackError) {
                    throw new Error(`模型加载失败，量化版和全精度版都无法加载: ${fallbackError.message}`);
                }
            }

            // 2. 如果当前模型失败，尝试回退到默认模型
            if (modelId !== DEFAULT_MODEL) {
                console.warn(`尝试回退到默认模型 ${DEFAULT_MODEL}...`);
                try {
                    return await this.loadModel(DEFAULT_MODEL);
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
     * @param {string} modelId - 模型 ID
     * @param {string} dtypeDisplayName - 精度类型显示名称
     */
    _emitProgressFromTransformers(progress, modelId, dtypeDisplayName) {
        const modelDisplayName = MODEL_INFO[modelId]?.name || modelId;

        if (progress.status === 'progress') {
            const percent = progress.progress || 0;
            this._emitProgress({
                step: 'loading',
                progress: percent,
                message: `正在加载 ${modelDisplayName} (${dtypeDisplayName})... ${Math.round(percent)}%`
            });
        } else if (progress.status === 'done') {
            this._emitProgress({
                step: 'processing',
                progress: 90,
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
     * 切换到指定模型和精度
     * @param {string} modelId - 目标模型 ID
     * @param {string} dtype - 目标精度类型
     * @returns {Promise<boolean>} 是否切换成功
     */
    async switchModel(modelId, dtype = null) {
        if (this.currentModelId === modelId && 
            this.currentDtype === dtype && 
            this.model && 
            this.processor) {
            return true;
        }
        return await this.loadModel(modelId, dtype);
    }

    /**
     * 释放当前模型资源
     */
    async disposeCurrentModel() {
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