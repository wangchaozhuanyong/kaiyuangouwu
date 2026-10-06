// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { copyAdminText } from '../utils/admin-clipboard';
import { AdminOverlayHost } from './AdminOverlayHost';
import { FeatureHelpButton, FeatureHelpProvider } from './FeatureHelp';

vi.mock('../utils/admin-clipboard', () => ({ copyAdminText: vi.fn(async () => true) }));

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
        vi.clearAllMocks();
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

    it('keeps help in the trigger page host and closes it when that page hides or closes', () => {
        const render = (active: boolean, mounted = true) =>
            act(() =>
                root.render(
                    <FeatureHelpProvider>
                        {mounted && (
                            <PageRuntimeContext.Provider value={{ page: '/assets', active }}>
                                <AdminOverlayHost owner="/assets" active={active}>
                                    <FeatureHelpButton title="素材" />
                                </AdminOverlayHost>
                            </PageRuntimeContext.Provider>
                        )}
                    </FeatureHelpProvider>,
                ),
            );
        render(true);
        act(() => container.querySelector('button')!.click());
        const host = document.querySelector('[data-admin-overlay-owner="/assets"]')!;
        expect(host.querySelector('[data-feature-help-card]')).not.toBeNull();
        render(false);
        expect(document.querySelector('[data-feature-help-card]')).toBeNull();
        render(true);
        act(() => container.querySelector('button')!.click());
        render(true, false);
        expect(document.querySelector('[data-feature-help-card]')).toBeNull();
        expect(document.querySelector('[data-admin-overlay-owner="/assets"]')).toBeNull();
    });

    it('does not open a delayed hover card for an unmounted trigger', () => {
        const trigger = container.querySelector('button')!;
        act(() => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
        act(() =>
            root.render(
                <FeatureHelpProvider>
                    <p>different page</p>
                </FeatureHelpProvider>,
            ),
        );
        act(() => vi.advanceTimersByTime(200));
        expect(document.querySelector('[data-feature-help-card]')).toBeNull();
    });

    it('shows and copies each heading description without leaking it to another trigger', async () => {
        act(() => {
            root.render(
                <FeatureHelpProvider>
                    <FeatureHelpButton topic="sales.profit" title="利润统计" description="按下单日期核算" />
                    <FeatureHelpButton
                        topic="sales.profit"
                        title="订单明细"
                        description="缺费用时不显示净利润"
                    />
                    <FeatureHelpButton topic="sales.profit" title="普通说明" />
                </FeatureHelpProvider>,
            );
        });
        expect(container.textContent).not.toContain('按下单日期核算');
        const triggers = container.querySelectorAll<HTMLButtonElement>('button');
        act(() => triggers[0].click());
        expect(document.querySelector('[data-feature-help-card]')?.textContent).toContain('按下单日期核算');
        act(() => triggers[1].click());
        const card = document.querySelector<HTMLElement>('[data-feature-help-card]')!;
        expect(card.textContent).toContain('页面说明');
        expect(card.textContent).toContain('缺费用时不显示净利润');
        expect(card.textContent).not.toContain('按下单日期核算');
        await act(async () => {
            Array.from(card.querySelectorAll('button'))
                .find(button => button.textContent === '复制说明')!
                .click();
        });
        const copied = vi.mocked(copyAdminText).mock.calls[0][0];
        expect(copied).toContain('页面说明：缺费用时不显示净利润');
        expect(copied).toContain('这个功能做什么');
        expect(copied).not.toContain('按下单日期核算');
        act(() => triggers[2].click());
        expect(document.querySelector('[data-feature-help-card]')?.textContent).not.toContain('页面说明');
    });
});
