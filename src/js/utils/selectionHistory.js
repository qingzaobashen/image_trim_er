/**
 * 选区历史管理器模块
 * 管理选区的历史记录，支持撤销和重做
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
     * @param {Uint8ClampedArray} mask - 选区蒙版
     * @param {string} operationType - 操作类型 ('add', 'subtract', 'magicWand', 'brush')
     * @param {Object} metadata - 元数据（如点击坐标、容差等）
     */
    addSelection(mask, operationType, metadata = {}) {
        const selectionData = {
            mask: new Uint8ClampedArray(mask),
            operationType: operationType,
            metadata: metadata,
            timestamp: Date.now()
        };

        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }

        this.history.push(selectionData);

        if (this.history.length > this.maxHistory) {
            this.history.shift();
        } else {
            this.currentIndex++;
        }
    }

    /**
     * 获取当前选区
     * @returns {Uint8ClampedArray|null} 当前选区蒙版
     */
    getCurrentSelection() {
        if (this.currentIndex < 0 || this.currentIndex >= this.history.length) {
            return null;
        }
        return new Uint8ClampedArray(this.history[this.currentIndex].mask);
    }

    /**
     * 获取累积选区（合并所有历史选区）
     * @returns {Uint8ClampedArray} 累积选区蒙版
     */
    getAccumulatedSelection() {
        const length = this.history.length > 0 ? this.history[0].mask.length : 0;
        const accumulatedMask = new Uint8ClampedArray(length);

        for (let i = 0; i <= this.currentIndex; i++) {
            const selection = this.history[i];
            this.mergeMasks(accumulatedMask, selection.mask, selection.operationType);
        }

        return accumulatedMask;
    }

    /**
     * 合并两个蒙版
     * @param {Uint8ClampedArray} target - 目标蒙版
     * @param {Uint8ClampedArray} source - 源蒙版
     * @param {string} operationType - 操作类型
     */
    mergeMasks(target, source, operationType) {
        for (let i = 0; i < target.length; i++) {
            if (operationType === 'subtract') {
                if (source[i] > 0) {
                    target[i] = 0;
                }
            } else {
                if (source[i] > 0) {
                    target[i] = 255;
                }
            }
        }
    }

    /**
     * 撤销最后一次选择
     * @returns {Uint8ClampedArray|null} 撤销后的选区
     */
    undoLastSelection() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            return this.getAccumulatedSelection();
        } else if (this.currentIndex === 0) {
            this.currentIndex = -1;
            const length = this.history[0].mask.length;
            return new Uint8ClampedArray(length);
        }
        return null;
    }

    /**
     * 重做选择
     * @returns {Uint8ClampedArray|null} 重做后的选区
     */
    redoSelection() {
        if (this.currentIndex < this.history.length - 1) {
            this.currentIndex++;
            return this.getAccumulatedSelection();
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
