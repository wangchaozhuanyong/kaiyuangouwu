// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { NewsBlogHistoryReplay } from './NewsBlogHistoryReplay';
let root: ReturnType<typeof createRoot>;
afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});
async function fixture(disabled = false) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const collect = vi.fn();
    await act(async () =>
        root.render(
            <FeatureHelpProvider>
                <NewsBlogHistoryReplay
                    window={{ start: '2026-10-03', end: '2026-11-02' }}
                    disabled={disabled}
                    collect={collect}
                />
            </FeatureHelpProvider>,
        ),
    );
    const form = host.querySelector('form');
    const start = host.querySelector<HTMLInputElement>('[name="historyStart"]');
    const end = host.querySelector<HTMLInputElement>('[name="historyEnd"]');
    if (!form || !start || !end) throw new Error('Missing accessible date form');
    return { host, form, start, end, collect };
}
it('submits the dates actually shown by native inputs, including browser autofill without React change events', async () => {
    const { form, start, end, collect } = await fixture();
    start.value = '2026-10-02';
    end.value = '2026-11-01';
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(collect).toHaveBeenCalledExactlyOnceWith({ historyStart: '2026-10-02', historyEnd: '2026-11-01' });
    expect(start.value).toBe('2026-10-02');
});
it('blocks repeated submissions while a request is pending and retains required native validation', async () => {
    const { form, start, end, collect, host } = await fixture(true);
    expect(start.required && end.required).toBe(true);
    expect(end.max).toBe('2026-11-02');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(collect).not.toHaveBeenCalled();
});
