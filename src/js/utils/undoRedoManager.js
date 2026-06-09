/**
 * 统一撤销/重做管理器模块
 * 
 * 集中管理系统中所有撤销/重做操作，提供跨模块的状态同步能力。
 * 
 * 设计原则：
 * 1. 单一数据源：所有历史记录统一存储在一个管理器中
 * 2. 完整状态快照：每次保存时记录完整的应用状态，确保撤销/重做后状态一致
 * 3. 标准化接口：所有模块通过统一的 API 调用撤销/重做功能
 * 4. 作用域隔离：支持全局作用域和子作用域（如边缘画笔专属历史）
 * 
 * 快照格式：
 * {
 *     imageData: ImageData,           // 主画布图像数据
 *     mask: Uint8ClampedArray,        // 当前选区蒙版
 *     shadowMask: Uint8ClampedArray|null,  // 阴影蒙版
 *     edgeData: Uint8ClampedArray|null,    // 边缘检测数据
 *     selectionHistory: Object,        // 选区历史序列化状态
 *     timestamp: number               // 快照时间戳
 * }
 */

/**
 * 统一撤销/重做管理器类
 */
export class UndoRedoManager {
    /**
     * 构造函数
     * @param {number} maxHistory - 最大历史记录步数，默认50
     */
    constructor(maxHistory = 50) {
        /** @type {Array<Object>} 历史记录快照数组 */
        this.history = [];
        /** @type {number} 当前历史记录索引 */
        this.index = -1;
        /** @type {number} 最大历史记录步数 */
        this.maxHistory = maxHistory;
    }

    // ==================== 核心操作 ====================

    /**
     * 推送新状态快照到历史记录
     * 如果当前不在历史记录末尾，会清除当前位置之后的所有记录（新操作覆盖重做历史）
     * @param {Object} snapshot - 状态快照对象
     */
    push(snapshot) {
        // 清除当前位置之后的历史记录（新操作会覆盖重做历史）
        if (this.index < this.history.length - 1) {
            this.history = this.history.slice(0, this.index + 1);
        }

        // 添加时间戳
        snapshot.timestamp = Date.now();
        this.history.push(snapshot);

        // 限制历史记录数量，超出时移除最旧的记录
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.index++;
        }
    }

    /**
     * 撤销：回退到上一个状态
     * @returns {Object|null} 上一个状态快照，无法撤销时返回null
     */
    undo() {
        if (!this.canUndo()) return null;

        this.index--;
        return this.history[this.index];
    }

    /**
     * 重做：前进到下一个状态
     * @returns {Object|null} 下一个状态快照，无法重做时返回null
     */
    redo() {
        if (!this.canRedo()) return null;

        this.index++;
        return this.history[this.index];
    }

    /**
     * 获取当前状态快照
     * @returns {Object|null} 当前状态快照
     */
    getCurrent() {
        if (this.index < 0 || this.index >= this.history.length) {
            return null;
        }
        return this.history[this.index];
    }

    /**
     * 检查是否可以撤销
     * @returns {boolean}
     */
    canUndo() {
        return this.index > 0;
    }

    /**
     * 检查是否可以重做
     * @returns {boolean}
     */
    canRedo() {
        return this.index < this.history.length - 1;
    }

    /**
     * 根据图像数据大小动态调整最大历史步数
     * 大图占用内存多，应减少历史步数以防止内存溢出
     * @param {number} pixelCount - 图像像素总数（宽 × 高）
     * @param {number} channels - 每像素通道数，默认4（RGBA）
     */
    adjustMaxHistoryByImageSize(pixelCount, channels = 4) {
        // 估算单个快照内存占用（字节）
        const snapshotSize = pixelCount * channels;
        // 目标：历史记录总占用不超过 256MB
        const targetMemoryBytes = 256 * 1024 * 1024;
        const maxStepsByMemory = Math.floor(targetMemoryBytes / snapshotSize);

        // 限制在合理范围：最少3步，最多20步
        const newMax = Math.max(3, Math.min(20, maxStepsByMemory));

        if (newMax !== this.maxHistory) {
            console.log(`[UndoRedo] 根据图像尺寸动态调整历史步数: ${this.maxHistory} → ${newMax} (单快照 ${(snapshotSize / 1024 / 1024).toFixed(2)} MB)`);
            this.maxHistory = newMax;

            // 如果当前历史超出新限制，裁剪旧记录
            while (this.history.length > this.maxHistory) {
                this.history.shift();
                this.index--;
            }
            if (this.index < 0) this.index = Math.min(this.index, this.history.length - 1);
        }
    }

    /**
     * 清空所有历史记录
     */
    clear() {
        this.history = [];
        this.index = -1;
    }

    /**
     * 获取当前历史记录步数
     * @returns {number} 当前索引（0-based），-1表示无历史
     */
    getStepCount() {
        return this.index + 1;
    }

    /**
     * 获取历史记录总数
     * @returns {number}
     */
    getTotalCount() {
        return this.history.length;
    }

    /**
     * 重置到指定索引
     * @param {number} targetIndex - 目标索引
     * @returns {Object|null} 目标状态快照
     */
    goTo(targetIndex) {
        if (targetIndex < 0 || targetIndex >= this.history.length) return null;
        this.index = targetIndex;
        return this.history[this.index];
    }

    // ==================== 快照工厂方法 ====================

    /**
     * 创建完整的应用状态快照
     * 由 imageProcessor 调用，传入所有需要保存的状态
     * @param {Object} stateProviders - 状态提供者对象
     * @param {Function} stateProviders.getImageData - 获取主画布ImageData的函数
     * @param {Function} stateProviders.getMask - 获取当前选区蒙版的函数
     * @param {Function} stateProviders.getShadowMask - 获取阴影蒙版的函数
     * @param {Function} stateProviders.getEdgeData - 获取边缘数据的函数
     * @param {Function} stateProviders.getSelectionHistoryState - 获取选区历史序列化状态的函数
     * @returns {Object} 完整状态快照
     */
    static createSnapshot(stateProviders) {
        return {
            imageData: stateProviders.getImageData(),
            mask: stateProviders.getMask(),
            shadowMask: stateProviders.getShadowMask(),
            edgeData: stateProviders.getEdgeData(),
            selectionHistory: stateProviders.getSelectionHistoryState()
        };
    }

    /**
     * 从快照恢复完整的应用状态
     * @param {Object} snapshot - 状态快照
     * @param {Object} restorers - 状态恢复函数对象
     * @param {Function} restorers.restoreImageData - 恢复主画布ImageData的函数
     * @param {Function} restorers.restoreMask - 恢复当前选区蒙版的函数
     * @param {Function} restorers.restoreShadowMask - 恢复阴影蒙版的函数
     * @param {Function} restorers.restoreEdgeData - 恢复边缘数据的函数
     * @param {Function} restorers.restoreSelectionHistory - 恢复选区历史状态的函数
     * @param {Function} restorers.onRestoreComplete - 状态恢复完成后的回调（如重新渲染）
     */
    static restoreSnapshot(snapshot, restorers) {
        if (!snapshot) return;

        restorers.restoreImageData(snapshot.imageData);
        restorers.restoreMask(snapshot.mask);
        restorers.restoreShadowMask(snapshot.shadowMask);
        restorers.restoreEdgeData(snapshot.edgeData);
        restorers.restoreSelectionHistory(snapshot.selectionHistory);

        if (restorers.onRestoreComplete) {
            restorers.onRestoreComplete();
        }
    }
}