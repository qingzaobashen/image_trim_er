/**
 * 模型管理器模块
 * 管理 @bunnio/rembg-web 库的模型加载、缓存、切换和内存回收
 */

import {
    newSession,
    getAvailableModels,
    clearSessionCache,
    disposeAllSessions,
    clearModelCache,
    clearModelCacheForModel,
    getCacheStats,
    configureCache,
    rembgConfig
} from '@bunnio/rembg-web';

/**
 * 模型信息定义
 * 包含模型名称、描述、大小等元数据
 */
const MODEL_INFO = {
    'u2netp': {
        name: 'U2NetP',
        description_zh: '轻量级模型，速度快，适合快速预览',
        description_en: 'Lightweight model, fast speed, suitable for quick preview',
        size: '~4MB',
        quality: 'standard',
        speed: 'fast',
        recommended: true
    },
    'u2net': {
        name: 'U2Net',
        description_zh: '标准模型，平衡速度与质量，适合大多数场景',
        description_en: 'Standard model, balanced speed and quality, suitable for most scenarios',
        size: '~176MB',
        quality: 'high',
        speed: 'medium',
        recommended: false
    },
    'isnet-general-use': {
        name: 'ISNet General',
        description_zh: '高精度通用模型，质量最佳但体积较大',
        description_en: 'High-precision general model, best quality but larger size',
        size: '~176MB',
        quality: 'highest',
        speed: 'slow',
        recommended: false
    },
    'isnet-anime': {
        name: 'ISNet Anime',
        description_zh: '动漫图像专用模型，针对二次元图像优化',
        description_en: 'Anime-specific model, optimized for anime-style images',
        size: '~176MB',
        quality: 'high',
        speed: 'slow',
        recommended: false
    },
    'silueta': {
        name: 'Silueta',
        description_zh: '轻量人像分割模型，适合人像抠图',
        description_en: 'Lightweight portrait segmentation model, suitable for portrait cutout',
        size: '~176MB',
        quality: 'high',
        speed: 'medium',
        recommended: false
    },
    'u2net_human_seg': {
        name: 'U2Net Human Seg',
        description_zh: '人体分割专用模型，精确识别人体轮廓',
        description_en: 'Human segmentation model, precise body outline detection',
        size: '~176MB',
        quality: 'high',
        speed: 'medium',
        recommended: false
    },
    'u2net_cloth_seg': {
        name: 'U2Net Cloth Seg',
        description_zh: '服装分割专用模型，适用于电商场景',
        description_en: 'Cloth segmentation model, suitable for e-commerce scenarios',
        size: '~176MB',
        quality: 'high',
        speed: 'medium',
        recommended: false
    }
};

/** 默认模型名称 */
const DEFAULT_MODEL = 'u2netp';

/** 高级模型列表（排除默认模型） */
const ADVANCED_MODELS = ['u2net', 'isnet-general-use', 'isnet-anime', 'silueta', 'u2net_human_seg', 'u2net_cloth_seg'];

/**
 * 模型管理器类
 * 负责模型的加载、缓存、切换和内存管理
 */
export class ModelManager {
    /**
     * 构造函数
     */
    constructor() {
        /** 当前活跃的会话实例 */
        this.currentSession = null;
        /** 当前模型名称 */
        this.currentModelName = null;
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

        // 配置缓存：最多缓存3个模型会话
        configureCache({ maxSessions: 3 });

        // 配置模型下载路径为 HuggingFace CDN（避免本地 /models 路径不可用的问题）
        rembgConfig.setBaseUrl('https://huggingface.co/bunnio/dis_anime/resolve/main');
    }

    /**
     * 获取所有可用模型信息
     * @returns {Object} 模型信息映射
     */
    static getModelInfo() {
        return MODEL_INFO;
    }

    /**
     * 获取默认模型名称
     * @returns {string} 默认模型名称
     */
    static getDefaultModel() {
        return DEFAULT_MODEL;
    }

    /**
     * 获取高级模型列表
     * @returns {string[]} 高级模型名称数组
     */
    static getAdvancedModels() {
        return ADVANCED_MODELS;
    }

    /**
     * 获取所有可用模型的详细信息列表（用于 UI 渲染）
     * @returns {Array<Object>} 模型信息数组
     */
    static getAvailableModels() {
        const allModels = [DEFAULT_MODEL, ...ADVANCED_MODELS];
        return allModels.map(name => {
            const info = MODEL_INFO[name];
            if (!info) return null;
            return {
                name: info.name,
                id: name,
                description: info.description_zh,
                size: info.size,
                quality: info.quality === 'standard' ? '标准' :
                         info.quality === 'high' ? '高' :
                         info.quality === 'highest' ? '极高' : '快速',
                speed: info.speed,
                recommended: info.recommended
            };
        }).filter(Boolean);
    }

    /**
     * 获取指定模型的信息
     * @param {string} modelName - 模型名称
     * @returns {Object|null} 模型信息对象
     */
    static getModelDetail(modelName) {
        return MODEL_INFO[modelName] || null;
    }

    /**
     * 检查模型是否已加载
     * @returns {boolean} 是否已加载
     */
    isModelLoaded() {
        return this.currentSession !== null && !this.isLoading;
    }

    /**
     * 获取当前模型名称
     * @returns {string|null} 当前模型名称
     */
    getCurrentModelName() {
        return this.currentModelName;
    }

    /**
     * 获取当前会话实例
     * @returns {BaseSession|null} 当前会话
     */
    getCurrentSession() {
        return this.currentSession;
    }

    /**
     * 加载指定模型
     * @param {string} modelName - 模型名称，默认为 'u2netp'
     * @returns {Promise<BaseSession>} 加载完成的会话实例
     * @throws {Error} 模型加载失败时抛出错误
     */
    async loadModel(modelName = DEFAULT_MODEL) {
        // 如果正在加载同一模型，直接返回
        if (this.currentModelName === modelName && this.currentSession && !this.isLoading) {
            return this.currentSession;
        }

        // 如果正在加载其他模型，先取消
        if (this.isLoading) {
            this.cancelLoading();
            // 等待一小段时间确保取消完成
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isLoading = true;
        this._cancelFlag = false;
        this._loadStartTime = Date.now();
        this._emitStateChange('loading', modelName);

        try {
            this._emitProgress({
                step: 'downloading',
                progress: 0,
                message: `正在加载 ${MODEL_INFO[modelName]?.name || modelName} 模型...`
            });

            const session = await newSession(modelName, undefined, {
                onProgress: (info) => {
                    // 检查取消标志
                    if (this._cancelFlag) {
                        throw new Error('MODEL_LOADING_CANCELLED');
                    }

                    // 计算预估剩余时间
                    const elapsed = Date.now() - this._loadStartTime;
                    const estimatedTotal = info.progress > 0 ? (elapsed / info.progress) * 100 : 0;
                    const estimatedRemaining = Math.max(0, estimatedTotal - elapsed);

                    this._emitProgress({
                        step: info.step,
                        progress: info.progress,
                        message: this._formatProgressMessage(info, modelName, estimatedRemaining),
                        estimatedRemaining
                    });
                }
            });

            // 再次检查取消标志
            if (this._cancelFlag) {
                throw new Error('MODEL_LOADING_CANCELLED');
            }

            // 如果之前有不同模型的会话，释放旧会话
            if (this.currentSession && this.currentModelName !== modelName) {
                try {
                    await this.currentSession.dispose();
                } catch (e) {
                    console.warn('释放旧模型会话失败:', e);
                }
            }

            this.currentSession = session;
            this.currentModelName = modelName;
            this.isLoading = false;

            this._emitProgress({
                step: 'complete',
                progress: 100,
                message: `${MODEL_INFO[modelName]?.name || modelName} 模型加载完成`
            });
            this._emitStateChange('ready', modelName);

            return session;
        } catch (error) {
            this.isLoading = false;

            if (error.message === 'MODEL_LOADING_CANCELLED') {
                this._emitStateChange('cancelled', modelName);
                this._emitProgress({
                    step: 'complete',
                    progress: 0,
                    message: '模型加载已取消'
                });
                throw new Error('模型加载已取消');
            }

            console.error('模型加载失败:', error);
            this._emitStateChange('error', modelName);

            // 尝试回退到默认模型
            if (modelName !== DEFAULT_MODEL) {
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
     * 取消当前模型加载
     */
    cancelLoading() {
        if (this.isLoading) {
            this._cancelFlag = true;
        }
    }

    /**
     * 切换到指定模型
     * @param {string} modelName - 目标模型名称
     * @returns {Promise<BaseSession>} 新的会话实例
     */
    async switchModel(modelName) {
        if (this.currentModelName === modelName && this.currentSession) {
            return this.currentSession;
        }
        return await this.loadModel(modelName);
    }

    /**
     * 释放当前模型资源
     */
    async disposeCurrentModel() {
        if (this.currentSession) {
            try {
                await this.currentSession.dispose();
            } catch (e) {
                console.warn('释放模型资源失败:', e);
            }
            this.currentSession = null;
            this.currentModelName = null;
            this._emitStateChange('disposed', null);
        }
    }

    /**
     * 释放所有模型缓存和资源
     */
    async disposeAll() {
        await this.disposeCurrentModel();
        try {
            await disposeAllSessions();
            clearSessionCache();
        } catch (e) {
            console.warn('释放所有模型缓存失败:', e);
        }
        this._emitStateChange('disposed', null);
    }

    /**
     * 清除指定模型的IndexedDB缓存
     * @param {string} modelName - 模型名称
     */
    async clearModelCacheForModel(modelName) {
        try {
            await clearModelCacheForModel(modelName);
        } catch (e) {
            console.warn(`清除模型 ${modelName} 缓存失败:`, e);
        }
    }

    /**
     * 清除所有模型的IndexedDB缓存
     */
    async clearAllModelCache() {
        try {
            await clearModelCache();
        } catch (e) {
            console.warn('清除所有模型缓存失败:', e);
        }
    }

    /**
     * 获取缓存统计信息
     * @returns {Object} 缓存统计
     */
    getCacheStats() {
        return getCacheStats();
    }

    /**
     * 检查WebGPU是否可用
     * @returns {Promise<boolean>} 是否可用
     */
    async isWebGPUAvailable() {
        try {
            const { isWebGPUAvailable } = await import('@bunnio/rembg-web');
            return isWebGPUAvailable();
        } catch {
            return false;
        }
    }

    /**
     * 格式化进度消息
     * @param {Object} info - 进度信息
     * @param {string} modelName - 模型名称
     * @param {number} estimatedRemaining - 预估剩余时间（毫秒）
     * @returns {string} 格式化后的消息
     */
    _formatProgressMessage(info, modelName, estimatedRemaining) {
        const modelDisplayName = MODEL_INFO[modelName]?.name || modelName;
        const stepMessages = {
            'downloading': '正在下载',
            'processing': '正在处理',
            'postprocessing': '正在后处理',
            'complete': '完成'
        };
        const stepText = stepMessages[info.step] || info.step;
        const remainingText = estimatedRemaining > 0
            ? ` (预计剩余 ${this._formatTime(estimatedRemaining)})`
            : '';
        return `${stepText} ${modelDisplayName} 模型... ${Math.round(info.progress)}%${remainingText}`;
    }

    /**
     * 格式化时间
     * @param {number} ms - 毫秒数
     * @returns {string} 格式化后的时间字符串
     */
    _formatTime(ms) {
        const seconds = Math.ceil(ms / 1000);
        if (seconds < 60) return `${seconds}秒`;
        const minutes = Math.floor(seconds / 60);
        const remainSeconds = seconds % 60;
        return `${minutes}分${remainSeconds}秒`;
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
     * @param {string|null} modelName - 相关模型名称
     */
    _emitStateChange(state, modelName) {
        if (typeof this.onStateChange === 'function') {
            this.onStateChange(state, modelName);
        }
    }
}
