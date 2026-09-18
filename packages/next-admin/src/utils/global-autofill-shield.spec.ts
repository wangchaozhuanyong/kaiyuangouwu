// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    initGlobalAutofillShield,
    isSearchOrFilterInput,
    protectElement,
    protectSearchInput,
} from './global-autofill-shield';

describe('global-autofill-shield', () => {
    let container: HTMLDivElement;
    let cleanup: () => void;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        cleanup = initGlobalAutofillShield();
    });

    afterEach(() => {
        cleanup();
        container.remove();
    });

    it('identifies search and filter inputs by keyword or type', () => {
        const plainInput = document.createElement('input');
        expect(isSearchOrFilterInput(plainInput)).toBe(false);

        plainInput.placeholder = '搜索规格模板';
        expect(isSearchOrFilterInput(plainInput)).toBe(true);

        plainInput.placeholder = '按商品名称搜索';
        expect(isSearchOrFilterInput(plainInput)).toBe(true);

        plainInput.placeholder = '搜索姓名、手机号或邮箱';
        expect(isSearchOrFilterInput(plainInput)).toBe(true);

        const searchTypeInput = document.createElement('input');
        searchTypeInput.type = 'search';
        expect(isSearchOrFilterInput(searchTypeInput)).toBe(true);

        const ariaSearchInput = document.createElement('input');
        ariaSearchInput.setAttribute('aria-label', '搜索后台功能');
        expect(isSearchOrFilterInput(ariaSearchInput)).toBe(true);
    });

    it('protects search inputs with anti-autofill attributes', () => {
        const input = document.createElement('input');
        input.placeholder = '搜索模板名、编码或选项值';
        protectSearchInput(input);

        expect(input.type).toBe('search');
        expect(input.getAttribute('autocomplete')).toBe('off');
        expect(input.getAttribute('autocorrect')).toBe('off');
        expect(input.getAttribute('spellcheck')).toBe('false');
        expect(input.getAttribute('data-1p-ignore')).toBe('true');
        expect(input.getAttribute('data-lpignore')).toBe('true');
        expect(input.getAttribute('data-bwignore')).toBe('true');
        expect(input.getAttribute('data-form-type')).toBe('other');
    });

    it('injects hidden username trap before isolated password inputs to prevent external DOM search box hijacking', () => {
        const form = document.createElement('form');
        const searchInput = document.createElement('input');
        searchInput.placeholder = '搜索规格模板';

        const passwordWrapper = document.createElement('div');
        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';
        passwordWrapper.append(passwordInput);

        container.append(searchInput, form);
        form.append(passwordWrapper);

        protectElement(passwordInput);

        const trap = passwordWrapper.querySelector<HTMLInputElement>('input[data-autofill-trap="true"]');
        expect(trap).not.toBeNull();
        expect(trap?.autocomplete).toBe('username');
        expect(trap?.readOnly).toBe(true);
        expect(trap?.tabIndex).toBe(-1);
        expect(trap?.nextElementSibling).toBe(passwordInput);
    });

    it('does not inject duplicate username traps when login form already has username field', () => {
        const form = document.createElement('form');
        const usernameInput = document.createElement('input');
        usernameInput.type = 'text';
        usernameInput.name = 'username';
        usernameInput.autocomplete = 'username';

        const passwordInput = document.createElement('input');
        passwordInput.type = 'password';

        form.append(usernameInput, passwordInput);
        container.append(form);

        protectElement(passwordInput);

        const trap = form.querySelector('input[data-autofill-trap="true"]');
        expect(trap).toBeNull();
    });

    it('MutationObserver dynamically hardens newly mounted search inputs and password fields', async () => {
        const dynamicSearch = document.createElement('input');
        dynamicSearch.placeholder = '搜索商品、订单、售后、营销、插件与设置...';
        container.append(dynamicSearch);

        // Wait for MutationObserver callback microtask
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(dynamicSearch.type).toBe('search');
        expect(dynamicSearch.getAttribute('autocomplete')).toBe('off');
        expect(dynamicSearch.getAttribute('data-1p-ignore')).toBe('true');

        const modalDiv = document.createElement('div');
        const dynamicPassword = document.createElement('input');
        dynamicPassword.type = 'password';
        modalDiv.append(dynamicPassword);
        container.append(modalDiv);

        await new Promise(resolve => setTimeout(resolve, 10));

        const trap = modalDiv.querySelector('input[data-autofill-trap="true"]');
        expect(trap).not.toBeNull();
    });
});
