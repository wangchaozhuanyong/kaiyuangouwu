/**
 * Global Autofill Shield
 * 彻底全局防御浏览器密码管理器及自动填充机制错误注入页面搜索框与非登录输入框。
 *
 * 核心机制：
 * 1. 全局搜索/筛选框识别与硬化（Search & Filter Hardening）：
 *    自动检测 DOM 中所有搜索框（通过 placeholder、aria-label、name、type 等），
 *    统一设置 type="search", autocomplete="off", autocorrect="off", spellcheck="false"，
 *    并注入 1Password (data-1p-ignore)、Bitwarden (data-bwignore)、LastPass (data-lpignore)、Dashlane (data-form-type="other") 的官方忽略属性。
 *    浏览器内核（如 Chromium、WebKit）在底层算法中对 type="search" 会天然剥夺其作为 username 候选字段的资格。
 *
 * 2. 全局密码输入框作用域隔离（Password Trap Isolation）：
 *    自动检测 DOM 中出现的所有 type="password" 字段（如各类操作二次确认弹窗、敏感操作等）。
 *    若该密码字段前没有 username/email 账号字段，则在密码框前立即注入不可见的账号陷阱字段（autoComplete="username"）。
 *    密码管理器在扫描凭据时，会将账号注入该陷阱字段，绝不会向上回溯到页面上的搜索框或业务表单。
 */

const SEARCH_KEYWORDS = ['搜索', 'search', 'query', 'filter', '过滤', '筛选'];

export function isSearchOrFilterInput(input: HTMLInputElement): boolean {
    if (input.type === 'search' || input.getAttribute('role') === 'searchbox') {
        return true;
    }
    const placeholder = (input.placeholder || input.getAttribute('placeholder') || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const name = (input.name || input.getAttribute('name') || '').toLowerCase();

    return SEARCH_KEYWORDS.some(
        kw => placeholder.includes(kw) || ariaLabel.includes(kw) || name.includes(kw),
    );
}

export function protectSearchInput(input: HTMLInputElement): void {
    if (input.type !== 'search') {
        try {
            input.type = 'search';
        } catch {
            // ignore if read-only in some environments
        }
    }
    if (input.getAttribute('autocomplete') !== 'off') {
        input.setAttribute('autocomplete', 'off');
    }
    if (!input.hasAttribute('autocorrect')) {
        input.setAttribute('autocorrect', 'off');
    }
    if (input.getAttribute('spellcheck') !== 'false') {
        input.setAttribute('spellcheck', 'false');
    }
    if (!input.hasAttribute('data-1p-ignore')) {
        input.setAttribute('data-1p-ignore', 'true');
    }
    if (!input.hasAttribute('data-lpignore')) {
        input.setAttribute('data-lpignore', 'true');
    }
    if (!input.hasAttribute('data-bwignore')) {
        input.setAttribute('data-bwignore', 'true');
    }
    if (!input.hasAttribute('data-form-type')) {
        input.setAttribute('data-form-type', 'other');
    }
}

export function protectPasswordInput(input: HTMLInputElement): void {
    if (input.dataset.autofillShielded === 'true') return;
    input.dataset.autofillShielded = 'true';

    const formOrParent = input.form || input.parentElement;
    if (!formOrParent) return;

    const existingUsername = formOrParent.querySelector(
        'input[autocomplete="username"], input[name="username"]',
    );
    if (!existingUsername) {
        const dummy = document.createElement('input');
        dummy.type = 'text';
        dummy.name = 'username';
        dummy.autocomplete = 'username';
        dummy.tabIndex = -1;
        dummy.setAttribute('aria-hidden', 'true');
        dummy.readOnly = true;
        dummy.className = 'sr-only pointer-events-none absolute h-0 w-0 opacity-0 -z-50';
        dummy.style.cssText =
            'position:absolute;opacity:0;pointer-events:none;width:0;height:0;z-index:-9999;';
        dummy.setAttribute('data-autofill-trap', 'true');
        input.parentElement?.insertBefore(dummy, input);
    }
}

export function protectElement(el: Element): void {
    if (el instanceof HTMLInputElement) {
        if (el.getAttribute('data-autofill-trap') === 'true') return;

        if (el.type === 'password') {
            protectPasswordInput(el);
        } else if (isSearchOrFilterInput(el)) {
            protectSearchInput(el);
        }
    }
}

export function initGlobalAutofillShield(): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || !window.MutationObserver) {
        return () => {};
    }

    const scanAll = (root: Element | Document = document) => {
        root.querySelectorAll('input').forEach(protectElement);
    };

    scanAll();

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node instanceof HTMLElement) {
                    if (node instanceof HTMLInputElement) {
                        protectElement(node);
                    }
                    node.querySelectorAll?.('input').forEach(protectElement);
                }
            }
            if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement) {
                protectElement(mutation.target);
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'name', 'type'],
    });

    return () => observer.disconnect();
}
