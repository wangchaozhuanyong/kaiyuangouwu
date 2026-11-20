// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { MdacPage } from './mdac-page';
import {
    disableDraftSaving,
    draftSavingPreference,
    emptyDraft,
    PassportReadError,
    readDraft,
    STORAGE_KEY,
} from './model';
import { readPassport } from './ocr';

vi.mock('./ocr', () => ({ readPassport: vi.fn() }));
vi.mock('../../storefront-ui/page-shell', () => ({
    Subpage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SubpageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Sheet: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
});
function button(name: string) {
    const match = [...host.querySelectorAll('button')].find(item => item.textContent === name);
    assert.ok(match, 'Missing button: ' + name);
    return match;
}

function inputOfType(type: 'checkbox' | 'file') {
    const input = host.querySelector<HTMLInputElement>(`[type=${type}]`);
    assert.ok(input, 'Missing input: ' + type);
    return input;
}

const queryClient = new QueryClient();
const render = (language: 'zh' | 'en' = 'zh') =>
    act(() =>
        root.render(
            <QueryClientProvider client={queryClient}>
                <MdacPage language={language} onBack={() => undefined} />
            </QueryClientProvider>,
        ),
    );

it('saves on first edit, drops only the stored copy on opt-out, and remembers the choice after remount', () => {
    localStorage.setItem('other', 'retained');
    render();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => button('添加旅客').click());
    expect(readDraft()?.travelers).toHaveLength(2);
    act(() => button('草稿设置').click());
    expect(inputOfType('checkbox').checked).toBe(true);
    act(() => inputOfType('checkbox').click());
    expect(readDraft()).toBeNull();
    expect(host.querySelectorAll('.mdac-travelers option')).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    render();
    act(() => button('草稿设置').click());
    expect(inputOfType('checkbox').checked).toBe(false);
    expect(host.querySelectorAll('.mdac-travelers option')).toHaveLength(1);
    act(() => inputOfType('checkbox').click());
    expect(readDraft()?.travelers).toHaveLength(1);
    act(() => button('清除本机资料').click());
    expect(readDraft()).toBeNull();
    expect(draftSavingPreference()).toBe(false);
    expect(localStorage.getItem('other')).toBe('retained');
});

it('preserves edits but stops automatic writes after another tab changes the draft', () => {
    const draft = emptyDraft();
    draft.travelers[0].name = 'TEST NAME';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    render();
    act(() => {
        localStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    act(() => button('添加旅客').click());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(host.querySelector('select')?.textContent).toContain('TEST NAME');
});

it('cancels recognition on clear and does not restore a late result or store the image', async () => {
    let complete!: (value: Record<string, string>) => void;
    vi.mocked(readPassport).mockImplementation(
        () =>
            new Promise(resolve => {
                complete = resolve;
            }),
    );
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.dynamicImportSettled();
    });
    expect(button('识别中…').disabled).toBe(true);
    render('en');
    expect(button('Reading…').disabled).toBe(true);
    act(() => button('Draft settings').click());
    act(() => button('Clear local details').click());
    expect(vi.mocked(readPassport).mock.calls[0][1].aborted).toBe(true);
    await act(() => {
        complete({ name: 'LATE RESULT' });
        return Promise.resolve();
    });
    expect(host.textContent).not.toContain('LATE RESULT');
    expect(readDraft()).toBeNull();
});

it('fills verified fields without saving them and preserves them when a later scan fails', async () => {
    disableDraftSaving();
    vi.mocked(readPassport)
        .mockReset()
        .mockResolvedValueOnce({
            name: 'SYNTHETIC TRAVELER',
            passNo: 'E12345678',
            nationality: 'CHN',
            dob: '1990-01-01',
            sex: '1',
            passExpDte: '2030-01-01',
        })
        .mockRejectedValueOnce(new PassportReadError('recognition'));
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    const upload = () =>
        act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await vi.dynamicImportSettled();
        });
    await upload();
    const filled = () =>
        [
            ...host.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
                '.mdac-fields input, .mdac-fields select',
            ),
        ].map(field => field.value);
    const values = filled();
    expect(values.filter(Boolean)).toHaveLength(6);
    expect(values).toContain('SYNTHETIC TRAVELER');
    expect(host.querySelector('[role=status]')?.textContent).toContain('识别完成');
    expect(readDraft()).toBeNull();
    await upload();
    expect(filled()).toEqual(values);
    expect(host.querySelector('[role=status]')?.textContent).toContain('未能完整识别');
    expect(readDraft()).toBeNull();
});

it('selects the detected birth country while leaving guest data out of storage', async () => {
    disableDraftSaving();
    vi.mocked(readPassport).mockReset().mockResolvedValueOnce({
        name: 'SYNTHETIC TRAVELER',
        passNo: 'E12345678',
        nationality: 'CHN',
        dob: '1990-01-01',
        sex: '1',
        passExpDte: '2030-01-01',
        pob: 'USA',
    });
    render();
    const input = inputOfType('file');
    Object.defineProperty(input, 'files', {
        value: [new File(['synthetic'], 'test.png', { type: 'image/png' })],
    });
    await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await vi.dynamicImportSettled();
    });
    const selects = host.querySelectorAll<HTMLSelectElement>('.mdac-fields select');
    expect(selects[0].value).toBe('CHN');
    expect(selects[1].value).toBe('USA');
    expect(host.querySelector('[role=status]')?.textContent).toContain('已根据护照出生地点匹配');
    expect(readDraft()).toBeNull();
});
