// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeatureHelpButton, FeatureHelpProvider } from './FeatureHelp';

describe('FeatureHelp interactions', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        act(() => {
            root.render(
                <FeatureHelpProvider>
                    <FeatureHelpButton topic="catalog.sku-custom-fields" title="SKU 动态扩展字段" />
                </FeatureHelpProvider>,
            );
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('keeps the card open while the pointer moves from the trigger into selectable content', () => {
        const trigger = container.querySelector('button')!;

        act(() => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        act(() => vi.advanceTimersByTime(140));

        const card = document.querySelector<HTMLElement>('[data-feature-help-card="true"]')!;
        expect(card).not.toBeNull();
        expect(card.className).toContain('select-text');
        expect(card.textContent).toContain('这个功能做什么');
        expect(card.textContent).toContain('使用要求');
        expect(card.textContent).toContain('举例');

        act(() => trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: card })));
        act(() => card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: trigger })));
        act(() => vi.advanceTimersByTime(500));
        expect(document.querySelector('[data-feature-help-card="true"]')).not.toBeNull();

        act(() => card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
        act(() => vi.advanceTimersByTime(360));
        expect(document.querySelector('[data-feature-help-card="true"]')).toBeNull();
    });

    it('pins on click and closes with Escape', () => {
        const trigger = container.querySelector<HTMLButtonElement>('button')!;
        act(() => trigger.click());

        expect(document.body.textContent).toContain('已固定');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(document.querySelector('[data-feature-help-card="true"]')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
});
