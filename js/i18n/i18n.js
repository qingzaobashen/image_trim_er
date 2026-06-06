/**
 * 国际化核心引擎
 * 提供语言检测、切换、翻译文本获取和界面实时更新功能
 */

/** 支持的语言列表 */
const SUPPORTED_LOCALES = ['zh-CN', 'en-US'];

/** 默认语言 */
const DEFAULT_LOCALE = 'zh-CN';

/** 本地存储中语言偏好键名 */
const STORAGE_KEY = 'app-locale';

/**
 * 国际化管理器类
 * 负责语言的检测、切换、翻译和界面更新
 */
class I18n {
    /**
     * 构造函数
     */
    constructor() {
        /** @type {string} 当前语言 */
        this.currentLocale = DEFAULT_LOCALE;

        /** @type {Object<string, Object>} 已加载的翻译字典，键为语言代码 */
        this.translations = {};

        /** @type {Function[]} 语言变更监听器列表 */
        this.listeners = [];

        /** @type {boolean} 是否已初始化 */
        this.initialized = false;
    }

    /**
     * 初始化国际化系统
     * 检测浏览器语言，加载对应翻译，更新界面
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return;

        // 加载所有支持的语言包
        await this._loadAllLocales();

        // 检测并设置语言
        const locale = this._detectLocale();
        this.currentLocale = locale;

        // 设置 HTML lang 属性
        document.documentElement.lang = locale;

        this.initialized = true;
    }

    /**
     * 加载所有支持的语言包
     * @private
     * @returns {Promise<void>}
     */
    async _loadAllLocales() {
        const loadPromises = SUPPORTED_LOCALES.map(async (locale) => {
            try {
                const module = await import(`./locales/${locale}.js`);
                this.translations[locale] = module.default || module;
            } catch (error) {
                console.warn(`[I18n] 加载语言包失败: ${locale}`, error);
            }
        });
        await Promise.all(loadPromises);
    }

    /**
     * 检测用户应使用的语言
     * 优先级：本地存储 > 浏览器语言 > 默认语言
     * @private
     * @returns {string} 检测到的语言代码
     */
    _detectLocale() {
        // 1. 检查本地存储
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && SUPPORTED_LOCALES.includes(stored)) {
            return stored;
        }

        // 2. 检查浏览器语言
        const browserLangs = navigator.languages || [navigator.language || navigator.userLanguage];
        for (const lang of browserLangs) {
            // 精确匹配
            if (SUPPORTED_LOCALES.includes(lang)) {
                return lang;
            }
            // 前缀匹配（如 zh 匹配 zh-CN）
            const prefix = lang.split('-')[0];
            const matched = SUPPORTED_LOCALES.find(l => l.startsWith(prefix));
            if (matched) {
                return matched;
            }
        }

        // 3. 使用默认语言
        return DEFAULT_LOCALE;
    }

    /**
     * 切换当前语言
     * @param {string} locale - 目标语言代码
     * @returns {boolean} 是否切换成功
     */
    setLocale(locale) {
        if (!SUPPORTED_LOCALES.includes(locale)) {
            console.warn(`[I18n] 不支持的语言: ${locale}`);
            return false;
        }

        if (this.currentLocale === locale) return false;

        this.currentLocale = locale;

        // 持久化存储
        localStorage.setItem(STORAGE_KEY, locale);

        // 更新 HTML lang 属性
        document.documentElement.lang = locale;

        // 更新界面文本
        this.updateUI();

        // 通知监听器
        this.listeners.forEach(fn => fn(locale));

        return true;
    }

    /**
     * 获取翻译文本
     * 支持点号分隔的嵌套键路径，如 "header.undo"
     * @param {string} key - 翻译键
     * @param {Object} [params] - 插值参数，如 { count: 5 }
     * @returns {string} 翻译后的文本，找不到时返回键名
     */
    t(key, params) {
        const dict = this.translations[this.currentLocale] || {};

        // 沿点号路径查找嵌套值
        let value = key.split('.').reduce((obj, k) => obj && obj[k], dict);

        // 回退到默认语言
        if (value === undefined && this.currentLocale !== DEFAULT_LOCALE) {
            const defaultDict = this.translations[DEFAULT_LOCALE] || {};
            value = key.split('.').reduce((obj, k) => obj && obj[k], defaultDict);
        }

        // 仍未找到则返回键名
        if (value === undefined || value === null) {
            return key;
        }

        // 参数插值：替换 {name} 形式的占位符
        if (params && typeof value === 'string') {
            return value.replace(/\{(\w+)\}/g, (_, name) =>
                params[name] !== undefined ? params[name] : `{${name}}`
            );
        }

        return value;
    }

    /**
     * 更新界面中所有带 data-i18n 属性的元素
     * 支持以下属性：
     *   data-i18n="key"          - 设置文本内容
     *   data-i18n-title="key"    - 设置 title 属性
     *   data-i18n-placeholder="key" - 设置 placeholder 属性
     *   data-i18n-label="key"    - 设置 label 内文本
     */
    updateUI() {
        // 更新文本内容
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const text = this.t(key);
            if (text !== key) {
                el.textContent = text;
            }
        });

        // 更新 title 属性
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const text = this.t(key);
            if (text !== key) {
                el.title = text;
            }
        });

        // 更新 placeholder 属性
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const text = this.t(key);
            if (text !== key) {
                el.placeholder = text;
            }
        });

        // 更新页面标题
        const pageTitle = document.querySelector('[data-i18n-page-title]');
        if (pageTitle) {
            document.title = this.t(pageTitle.getAttribute('data-i18n-page-title'));
        }
    }

    /**
     * 注册语言变更监听器
     * @param {Function} callback - 回调函数，接收新语言代码作为参数
     * @returns {Function} 取消监听的函数
     */
    onChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(fn => fn !== callback);
        };
    }

    /**
     * 获取当前语言代码
     * @returns {string}
     */
    getLocale() {
        return this.currentLocale;
    }

    /**
     * 获取支持的语言列表
     * @returns {string[]}
     */
    getSupportedLocales() {
        return [...SUPPORTED_LOCALES];
    }

    /**
     * 获取语言的显示名称
     * @param {string} locale - 语言代码
     * @returns {string} 该语言在本语言下的显示名
     */
    getLocaleDisplayName(locale) {
        const names = {
            'zh-CN': '中文',
            'en-US': 'English'
        };
        return names[locale] || locale;
    }
}

/** 导出单例实例 */
const i18n = new I18n();

export default i18n;
export { SUPPORTED_LOCALES, DEFAULT_LOCALE };
