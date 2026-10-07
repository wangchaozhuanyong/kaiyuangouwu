// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

vi.mock('./brand-loading-content', () => {
    throw new Error('Simulated offline visual chunk');
});

import { PageSkeleton } from './route-loading';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps an accessible pending state when the optional brand visual chunk cannot load', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    try {
        await act(async () => {
            root.render(<PageSkeleton language="zh" root />);
            await vi.dynamicImportSettled();
        });
        expect(host.querySelector('main[role="status"]')?.getAttribute('aria-label')).toBe('正在加载页面');
        expect(host.querySelector('[data-page-pending="data"]')).not.toBeNull();
        expect(host.querySelector('.brand-loading-dots')).not.toBeNull();
        expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally {
        act(() => root.unmount());
    }
});
