/**
 * 统一撤销/重做管理器模块
 * 
 * 集中管理系统中所有撤销/重做操作，提供跨模块的状态同步能力。
 * 
 * 设计原则：
 * 1. 单一数据源：所有历史记录统一存储在一个管理器中
 * 2. 增量快照：imageData 仅在图像像素变更时存储，mask-only 操作置 null
 * 3. 锚点保护：始终保留第一个包含 imageData 的快照（锚点），确保可恢复到原始图片
 * 4. 标准化接口：所有模块通过统一的 API 调用撤销/重做功能
 * 
 * 快照格式：
 * {
 *     imageData: ImageData|null,      // 主画布图像数据（仅图像像素变更时存储，否则为null）
 *     mask: Uint8ClampedArray,        // 当前选区蒙版
 *     shadowMask: Uint8ClampedArray|null,  // 阴影蒙版
 *     edgeData: Uint8ClampedArray|null,    // 边缘检测数据
 *     operationType: string|null,     // 操作类型标识（"delete"|"denoise"|"shadow"等）
 *     operationMetadata: Object|null, // 操作元数据
 *     timestamp: number               // 快照时间戳
 * }
 * 
 * 内存优化说明：
 * - imageData 仅在图像像素实际变更时存储（delete/denoise/shadow），其余操作置null
 * - 4096×4096 图片单次快照减少 64MB，mask-only 操作 5 步快照节省约 320MB
 * - 锚点快照始终保留，确保 undo 回溯时能找到原始图片数据
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
        // 锚点保护：如果第一个快照包含 imageData（锚点），不能被移除
        // 否则 undo 回溯时找不到原始图片数据
        if (this.history.length > this.maxHistory) {
            const firstSnapshot = this.history[0];
            if (firstSnapshot && firstSnapshot.imageData) {
                // 锚点存在：保留锚点，移除第二个（锚点之后最旧的）
                if (this.history.length > 2) {
                    this.history.splice(1, 1);
                }
                // 如果只有锚点+1个快照，不移除
            } else {
                // 没有锚点，正常移除最旧的
                this.history.shift();
            }
        }

        // push 后 index 始终指向最新添加的快照（即历史记录末尾）
        this.index = this.history.length - 1;
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
        // 增量快照模式下，估算平均快照内存占用
        // - imageChanged 快照：pixelCount * channels（完整 ImageData）
        // - mask-only 快照：pixelCount * 1（仅 mask）+ pixelCount * 1（shadowMask 均值）
        // 实际混合比例约 1:3（每4步操作约1步改变像素），平均约 pixelCount * 2
        const avgSnapshotSize = pixelCount * 2;
        // 目标：历史记录总占用不超过 256MB
        const targetMemoryBytes = 256 * 1024 * 1024;
        const maxStepsByMemory = Math.floor(targetMemoryBytes / avgSnapshotSize);

        // 限制在合理范围：最少5步，最多30步（增量模式下步数可以更多）
        const newMax = Math.max(5, Math.min(30, maxStepsByMemory));

        if (newMax !== this.maxHistory) {
            console.log(`[UndoRedo] 根据图像尺寸动态调整历史步数: ${this.maxHistory} → ${newMax} (平均单快照 ${(avgSnapshotSize / 1024 / 1024).toFixed(2)} MB)`);
            this.maxHistory = newMax;

            // 如果当前历史超出新限制，裁剪旧记录（保护锚点）
            while (this.history.length > this.maxHistory) {
                const firstSnapshot = this.history[0];
                if (firstSnapshot && firstSnapshot.imageData && this.history.length > 2) {
                    // 锚点保护：移除第二个而不是第一个
                    this.history.splice(1, 1);
                } else {
                    this.history.shift();
                }
            }
            // 裁剪后确保 index 在有效范围内
            this.index = Math.max(0, Math.min(this.index, this.history.length - 1));
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
     * 从历史记录中向前回溯查找最近的包含 imageData 的快照
     * 用于增量快照模式下，undo/redo 到 mask-only 快照时恢复图像像素
     * @param {number} [fromIndex] - 起始索引，默认为当前 index
     * @returns {ImageData|null} 最近的 imageData，找不到返回 null
     */
    findNearestImageData(fromIndex) {
        const startIdx = fromIndex !== undefined ? fromIndex : this.index;
        for (let i = startIdx; i >= 0; i--) {
            if (this.history[i] && this.history[i].imageData) {
                return this.history[i].imageData;
            }
        }
        return null;
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
     * @param {boolean} [stateProviders.imageChanged=false] - 图像像素是否发生变化（仅delete/denoise/shadow等操作时为true）
     * @param {string} [stateProviders.operationType=null] - 操作类型标识
     * @param {Object} [stateProviders.operationMetadata=null] - 操作元数据
     * @returns {Object} 完整状态快照
     */
    static createSnapshot(stateProviders) {
        const snapshot = {
            imageData: stateProviders.imageChanged ? stateProviders.getImageData() : null,
            mask: stateProviders.getMask(),
            shadowMask: stateProviders.getShadowMask(),
            edgeData: stateProviders.getEdgeData(),
            operationType: stateProviders.operationType || null,
            operationMetadata: stateProviders.operationMetadata || null
        };
        return snapshot;
    }

    /**
     * 从快照恢复完整的应用状态
     * @param {Object} snapshot - 状态快照
     * @param {Object} restorers - 状态恢复函数对象
     * @param {Function} restorers.restoreImageData - 恢复主画布ImageData的函数（仅imageData非null时调用）
     * @param {Function} restorers.restoreMask - 恢复当前选区蒙版的函数
     * @param {Function} restorers.restoreShadowMask - 恢复阴影蒙版的函数
     * @param {Function} restorers.restoreEdgeData - 恢复边缘数据的函数
     * @param {Function} restorers.onRestoreComplete - 状态恢复完成后的回调（如重新渲染）
     */
    static restoreSnapshot(snapshot, restorers) {
        if (!snapshot) return;

        // 仅当图像像素实际变更时才恢复ImageData（mask-only操作不存储imageData）
        if (snapshot.imageData) {
            restorers.restoreImageData(snapshot.imageData);
        }
        restorers.restoreMask(snapshot.mask);
        restorers.restoreShadowMask(snapshot.shadowMask);
        restorers.restoreEdgeData(snapshot.edgeData);

        if (restorers.onRestoreComplete) {
            restorers.onRestoreComplete();
        }
    }
}