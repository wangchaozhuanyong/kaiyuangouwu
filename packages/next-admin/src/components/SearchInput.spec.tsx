// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchInput } from './SearchInput';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function mount(value = '') {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onValueChange = vi.fn();
    const render = async (next: string) => {
        await act(async () => {
            root.render(<SearchInput aria-label="搜索" value={next} onValueChange={onValueChange} />);
        });
    };
    await render(value);
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    const input = container.querySelector('input')!;
    const compose = async (type: 'compositionstart' | 'compositionend', data = '') => {
        await act(async () => {
            input.dispatchEvent(new CompositionEvent(type, { bubbles: true, data }));
        });
    };
    const type = async (next: string, isComposing = false) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
            input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing }));
        });
    };
    return { input, render, compose, type, onValueChange };
}

describe('SearchInput', () => {
    it('keeps a synchronous draft while the URL update is pending', async () => {
        const field = await mount();
        await field.type('a');
        expect(field.input.value).toBe('a');
        await field.type('ab');
        expect(field.input.value).toBe('ab');
        expect(field.onValueChange.mock.calls).toEqual([['a'], ['ab']]);
        await field.render('ab');
        expect(field.input.value).toBe('ab');
    });

    it('commits Chinese text once after composition, without searching unfinished pinyin', async () => {
        const field = await mount();
        field.input.focus();
        await field.compose('compositionstart');
        for (const text of ['z', 'zh', 'zhong', '中华']) {
            await field.type(text, true);
            expect(field.input.value).toBe(text);
            expect(field.onValueChange).not.toHaveBeenCalled();
        }
        await field.compose('compositionend', '中华');
        await field.type('中华');
        expect(field.onValueChange.mock.calls).toEqual([['中华']]);
        expect(document.activeElement).toBe(field.input);
    });

    it('uses the composition session when an input event omits isComposing', async () => {
        const field = await mount();
        await field.compose('compositionstart');
        await field.type('zhong');
        expect(field.onValueChange).not.toHaveBeenCalled();
        await field.type('中');
        await field.compose('compositionend', '中');
        expect(field.onValueChange.mock.calls).toEqual([['中']]);
    });

    it('preserves an active composition if a previous navigation finishes', async () => {
        const field = await mount();
        await field.type('a');
        await field.compose('compositionstart');
        await field.type('azhong', true);
        await field.render('a');
        expect(field.input.value).toBe('azhong');
        await field.type('a中', true);
        await field.compose('compositionend', '中');
        expect(field.onValueChange.mock.calls).toEqual([['a'], ['a中']]);
    });

    it('cancels composition without changing the committed query', async () => {
        const field = await mount('茶');
        await field.compose('compositionstart');
        await field.type('茶zhong', true);
        await field.type('茶', true);
        await field.compose('compositionend');
        expect(field.input.value).toBe('茶');
        expect(field.onValueChange).not.toHaveBeenCalled();
    });

    it('accepts external history/filter changes, clearing, paste and deletion', async () => {
        const field = await mount('中华');
        await field.render('茶叶');
        expect(field.input.value).toBe('茶叶');
        await field.render('');
        expect(field.input.value).toBe('');
        await field.type('中文 ABC 123');
        await field.type('中文 ABC 12');
        await field.type('');
        expect(field.onValueChange.mock.calls).toEqual([['中文 ABC 123'], ['中文 ABC 12'], ['']]);
    });
});
