/**
 * @file 语言切换器初始化模块
 * @description 为子页面和文章页提供统一的语言切换器交互逻辑，
 *              包括下拉菜单开关、语言选项切换和 UI 状态同步
 */

import i18n from './i18n.js';

/**
 * 初始化语言切换器
 * 绑定按钮点击事件、下拉菜单交互和语言切换逻辑，
 * 并根据当前语言设置更新 UI 显示状态
 */
export function initLangSwitcher() {
    const langSwitcherBtn = document.getElementById('langSwitcherBtn');
    const langDropdown = document.getElementById('langDropdown');
    const currentLangLabel = document.getElementById('currentLangLabel');
    const langOptions = document.querySelectorAll('.lang-option');

    if (!langSwitcherBtn || !langDropdown) return;

    /** 语言切换按钮点击 - 切换下拉菜单显示状态 */
    langSwitcherBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        langDropdown.classList.toggle('show');
    });

    /** 点击页面其他区域关闭下拉菜单 */
    document.addEventListener('click', () => {
        langDropdown.classList.remove('show');
    });

    /** 阻止下拉菜单内部点击冒泡关闭 */
    langDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    /** 语言选项点击 - 切换语言并更新 UI */
    langOptions.forEach(option => {
        option.addEventListener('click', () => {
            const locale = option.dataset.locale;
            if (i18n.setLocale(locale)) {
                updateLangSwitcherUI(locale, currentLangLabel, langOptions);
            }
            langDropdown.classList.remove('show');
        });
    });

    /** 初始化语言切换器显示状态 */
    updateLangSwitcherUI(i18n.getLocale(), currentLangLabel, langOptions);
}

/**
 * 更新语言切换器 UI 状态
 * @param {string} locale - 当前语言代码
 * @param {HTMLElement} currentLangLabel - 当前语言标签元素
 * @param {NodeList} langOptions - 语言选项按钮列表
 */
function updateLangSwitcherUI(locale, currentLangLabel, langOptions) {
    if (currentLangLabel) {
        currentLangLabel.textContent = i18n.getLocaleDisplayName(locale);
    }
    langOptions.forEach(option => {
        option.classList.toggle('active', option.dataset.locale === locale);
    });
}
