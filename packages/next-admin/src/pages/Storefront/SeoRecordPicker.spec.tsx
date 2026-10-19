// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultStorefrontSeoDocument } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import type { StorefrontSeoRecord } from '../../graphql/storefront-seo.graphql';
import { SeoRecordPicker } from './SeoRecordPicker';

let container: HTMLDivElement, root: Root;
const select = vi.fn();
const identity = { targetType: 'PRODUCT' as const, targetId: '5909', languageCode: 'zh_Hans' as const };
const records: StorefrontSeoRecord[] = Array.from({ length: 616 }, (_, index) => ({
    ...identity,
    targetId: String(5909 + index),
    id: `record-${index}`,
    channelId: 'a',
    draft: { ...defaultStorefrontSeoDocument('PRODUCT'), title: index === 615 ? '最后商品 中文标题' : '' },
    published: null,
    version: 1,
    publishedVersion: 0,
    publishedAt: null,
    updatedAt: null,
    canWrite: true,
}));
beforeEach(() => {
    select.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
    container.remove();
});
const render = (items = records) =>
    act(() => root.render(<SeoRecordPicker records={items} identity={identity} onSelect={select} />));
const rows = () => container.querySelectorAll('[aria-label="已配置记录列表"] button');
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
function search(value: string) {
    const input = container.querySelector('input')!;
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
}
describe('SEO record selector', () => {
    it('bounds a large workspace to 20 records, marks selection, and keeps the editor space available', () => {
        render();
        expect(container.querySelector('details')?.open).toBe(false);
        expect(rows()).toHaveLength(20);
        expect(container.textContent).toContain('共 616 条 · 1 / 31 页');
        expect(rows()[0].getAttribute('aria-pressed')).toBe('true');
        act(() => button('下一页').click());
        expect(rows()).toHaveLength(20);
        expect(rows()[0].textContent).toContain('5929');
        expect(rows()[0].getAttribute('aria-pressed')).toBe('false');
    });
    it('searches IDs and Chinese titles across all pages and selects the original record', () => {
        render();
        act(() => button('下一页').click());
        search('最后商品');
        expect(rows()).toHaveLength(1);
        expect(container.textContent).toContain('共 1 条 · 1 / 1 页');
        act(() => (rows()[0] as HTMLButtonElement).click());
        expect(select).toHaveBeenCalledWith(records[615]);
        search('5910');
        expect(rows()).toHaveLength(1);
        expect(rows()[0].textContent).toContain('5910');
    });
    it('excludes other target types and languages even when their IDs match', () => {
        render([
            records[0],
            { ...records[0], targetType: 'ARTICLE' },
            { ...records[0], targetType: 'COLLECTION' },
            { ...records[0], languageCode: 'en' },
        ]);
        expect(rows()).toHaveLength(1);
        expect(container.textContent).toContain('共 1 条');
    });
    it('clamps a stale page when a background refresh reduces the record count', () => {
        render();
        act(() => button('下一页').click());
        render(records.slice(0, 2));
        expect(rows()).toHaveLength(2);
        expect(button('上一页').disabled).toBe(true);
        expect(button('下一页').disabled).toBe(true);
    });
    it('resets pagination for page size changes and keeps a bounded last page', () => {
        render();
        const sizes = container.querySelector('select')!;
        act(() => {
            sizes.value = '100';
            sizes.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(rows()).toHaveLength(100);
        for (let index = 0; index < 6; index++) act(() => button('下一页').click());
        expect(rows()).toHaveLength(16);
        expect(button('下一页').disabled).toBe(true);
    });
    it('distinguishes an unconfigured scope from a search with no matches', () => {
        render([]);
        expect(container.querySelector('[role=status]')?.textContent).toContain('暂无已配置记录');
        render();
        search('no-such-record');
        expect(rows()).toHaveLength(0);
        expect(container.querySelector('[role=status]')?.textContent).toContain('没有匹配的记录');
        search('');
        expect(rows()).toHaveLength(20);
    });
});
