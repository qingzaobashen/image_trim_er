/**
 * 选区历史管理器模块
 * 管理选区的历史记录，支持撤销和重做
 *
 * 设计说明：
 * 本管理器保存每一步操作后的完整选区蒙版快照（而非增量），
 * 这样无论操作类型如何（替换、添加、减去等），撤销时都能直接
 * 恢复到上一步的完整状态，避免增量合并逻辑带来的复杂性和不一致。
 */

/**
 * 选区历史管理器类
 */
export class SelectionHistory {
    /**
     * 构造函数
     */
    constructor() {
        this.history = [];
        this.currentIndex = -1;
        this.maxHistory = 50;
    }

    /**
     * 添加选区到历史记录
     * 保存的是操作完成后的完整选区蒙版快照
     * @param {Uint8ClampedArray} mask - 选区蒙版（完整状态）
     * @param {string} operationType - 操作类型 ('add', 'subtract', 'magicWand', 'brush', 'replace', 'invert', 'denoise', 'delete', 'clear')
     * @param {Object} metadata - 元数据（如点击坐标、容差等）
     */
    addSelection(mask, operationType, metadata = {}) {
        const selectionData = {
            mask: new Uint8ClampedArray(mask),
            operationType: operationType,
            metadata: metadata,
            timestamp: Date.now()
        };

        // 如果当前不在历史末尾，截断当前位置之后的历史（新操作覆盖重做历史）
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        this.history.push(selectionData);

        // 限制历史记录数量，超出时移除最旧的记录
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
    }

    /**
     * 获取当前选区（当前索引指向的完整快照）
     * @returns {Uint8ClampedArray|null} 当前选区蒙版
     */
    getCurrentSelection() {
        if (this.currentIndex < 0 || this.currentIndex >= this.history.length) {
            return null;
        }
        return new Uint8ClampedArray(this.history[this.currentIndex].mask);
    }

    /**
     * 撤销最后一次选择
     * 直接返回到上一步保存的完整选区快照
     * @returns {Uint8ClampedArray|null} 撤销后的选区，无法撤销时返回 null
     */
    undoLastSelection() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return new Uint8ClampedArray(this.history[this.currentIndex].mask);
        }
        // 只剩一条记录时，撤销后恢复到无选区状态
        if (this.currentIndex === 0) {
            this.currentIndex = -1;
            const length = this.history[0].mask.length;
            return new Uint8ClampedArray(length);
        }
        return null;
    }

    /**
     * 重做选择
     * 直接恢复到下一步保存的完整选区快照
     * @returns {Uint8ClampedArray|null} 重做后的选区
     */
    redoSelection() {
        if (this.currentIndex < this.history.length - 1) {
            this.currentIndex++;
            return new Uint8ClampedArray(this.history[this.currentIndex].mask);
        }
        return null;
    }

    /**
     * 清除所有历史记录
     */
    clear() {
        this.history = [];
        this.currentIndex = -1;
    }

    /**
     * 获取历史记录数量
     * @returns {number} 历史记录数量
     */
    getHistoryCount() {
        return this.history.length;
    }

    /**
     * 获取当前位置
     * @returns {number} 当前位置
     */
    getCurrentIndex() {
        return this.currentIndex;
    }

    /**
     * 是否可以撤销
     * @returns {boolean} 是否可以撤销
     */
    canUndo() {
        return this.currentIndex >= 0;
    }

    /**
     * 是否可以重做
     * @returns {boolean} 是否可以重做
     */
    canRedo() {
        return this.currentIndex < this.history.length - 1;
    }

    /**
     * 获取最后一次操作
     * @returns {Object|null} 最后一次操作
     */
    getLastOperation() {
        if (this.currentIndex >= 0 && this.currentIndex < this.history.length) {
            return this.history[this.currentIndex];
        }
        return null;
    }

    /**
     * 获取所有操作的摘要
     * @returns {Array} 操作摘要列表
     */
    getOperationSummary() {
        return this.history.map((item, index) => ({
            index: index,
            type: item.operationType,
            metadata: item.metadata,
            timestamp: item.timestamp
        }));
    }

    /**
     * 序列化当前状态（用于统一撤销/重做管理器的快照存储）
     * @returns {Object} 序列化状态对象
     */
    serialize() {
        return {
            history: this.history.map(item => ({
                mask: Array.from(item.mask),
                operationType: item.operationType,
                metadata: item.metadata,
                timestamp: item.timestamp
            })),
            currentIndex: this.currentIndex,
            maxHistory: this.maxHistory
        };
    }

    /**
     * 从序列化状态恢复（用于统一撤销/重做管理器的状态恢复）
     * @param {Object} state - 序列化状态对象
     */
    deserialize(state) {
        if (!state || !state.history) {
            this.clear();
            return;
        }

        this.history = state.history.map(item => ({
            mask: new Uint8ClampedArray(item.mask),
            operationType: item.operationType,
            metadata: item.metadata || {},
            timestamp: item.timestamp || 0
        }));
        this.currentIndex = state.currentIndex;
        this.maxHistory = state.maxHistory || 50;
    }
}
