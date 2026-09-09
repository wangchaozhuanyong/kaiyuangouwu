// @vitest-environment jsdom

import { act, cloneElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { SystemOpsModule } from './SystemOpsModule';
import { TranslationsModule } from './TranslationsModule';

const query = vi.hoisted(() => ({
    data: {} as Record<string, unknown> | undefined,
    previousData: undefined as Record<string, unknown> | undefined,
    loading: false,
    refetch: vi.fn(),
    requests: [] as Array<Record<string, any>>,
}));
vi.mock('@apollo/client/react', () => ({
    useQuery: (_document: unknown, options: { variables?: { options?: Record<string, any> } }) => {
        query.requests.push(options.variables ?? {});
        const audit = query.data?.contentTranslationAudit as
            { states: Array<Record<string, any>> } | undefined;
        if (!audit) return query;
        const paging = options.variables?.options ?? {};
        const filtered = audit.states.filter(
            item =>
                (!paging.status || item.status === paging.status) &&
                (!paging.entityType || item.entityType === paging.entityType) &&
                (!paging.search || `${item.entityId} ${item.error ?? ''}`.includes(paging.search)),
        );
        return {
            ...query,
            data: {
                ...query.data,
                contentTranslationAudit: {
                    ...audit,
                    filteredTotal: filtered.length,
                    states: filtered.slice(paging.skip ?? 0, (paging.skip ?? 0) + (paging.take ?? 20)),
                },
            },
        };
    },
    useMutation: () => [vi.fn(), { loading: false }],
}));
const cleanups: Array<() => void> = [];
const now = '2026-09-09T10:00:00Z';
const translationStates = Array.from({ length: 101 }, (_, i) => ({
    id: `translation-${i + 1}`,
    entityId: `item-${i + 1}`,
    entityType: 'Product',
    fieldPath: 'name',
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    status: i % 2 ? 'COMPLETED' : 'FAILED',
    origin: 'AUTO',
    locked: false,
    error: null,
    updatedAt: now,
    attempts: 1,
}));

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    query.requests = [];
    query.loading = false;
    query.previousData = undefined;
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});

async function render(element: ReactElement) {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const update = async () => {
        await act(async () =>
            root.render(
                <MemoryRouter initialEntries={['/?tab=jobs']}>
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <FeatureHelpProvider>{cloneElement(element)}</FeatureHelpProvider>
                    </ConfirmDialogContext.Provider>
                </MemoryRouter>,
            ),
        );
    };
    await update();
    cleanups.push(() => {
        root.unmount();
        container.remove();
    });
    return { container, update };
}
async function click(container: HTMLElement, label: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    await act(async () => button.click());
}
async function select(container: HTMLElement, label: string, value: string) {
    const input = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => {
        input.value = value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}
function auditData(states = translationStates) {
    return {
        activeChannel: { code: '测试店铺', availableLanguageCodes: ['zh_Hans', 'en'] },
        contentTranslationStaleCount: 51,
        contentTranslationAudit: {
            configured: true,
            provider: 'GEMINI',
            total: 2096,
            states,
            counts: [
                { status: 'COMPLETED', count: 50 },
                { status: 'FAILED', count: 51 },
            ],
        },
    };
}

describe('admin record pagination', () => {
    it('keeps filter focus and the requested page while an uncached page is loading', async () => {
        query.data = auditData();
        const { container, update } = await render(<TranslationsModule />);
        await click(container, '下一页');
        const input = container.querySelector<HTMLInputElement>('input[aria-label="搜索翻译审计记录"]')!;
        input.focus();
        query.previousData = {
            ...auditData(),
            contentTranslationAudit: { ...auditData().contentTranslationAudit, filteredTotal: 101 },
        };
        query.data = undefined;
        query.loading = true;
        await update();
        expect(document.activeElement).toBe(input);
        expect(container.textContent).toContain('正在读取翻译记录');
        expect(query.requests.at(-1)?.options.skip).toBe(20);
        expect(container.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')?.disabled).toBe(
            true,
        );
        query.loading = false;
        query.data = auditData();
        await update();
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-21');
        expect(document.activeElement).toBe(input);
    });

    it('requests paginated translations, resets page size and filters, and reports matching totals', async () => {
        query.data = auditData();
        const { container } = await render(<TranslationsModule />);
        expect(container.querySelectorAll('tbody tr')).toHaveLength(20);
        expect(container.textContent).toContain('筛选匹配 101 条');
        expect(query.requests.at(-1)?.options).toMatchObject({ skip: 0, take: 20 });
        await click(container, '下一页');
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-21');
        const region = container.querySelector<HTMLElement>('[aria-label="翻译审计记录"]')!;
        region.scrollTop = 300;
        await select(container, '每页显示条数', '50');
        expect(container.querySelectorAll('tbody tr')).toHaveLength(50);
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-1');
        expect(region.scrollTop).toBe(0);
        await click(container, '下一页');
        await select(container, '筛选翻译状态', 'FAILED');
        expect(container.textContent).toContain('51 条 · 1 / 2 页');
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-1');
    });

    it('requests records after the first 1000 instead of slicing a capped local dataset', async () => {
        query.data = auditData(
            Array.from({ length: 1101 }, (_, i) => ({
                ...translationStates[0],
                id: `translation-${i + 1}`,
                entityId: `item-${i + 1}`,
            })),
        );
        const { container } = await render(<TranslationsModule />);
        await select(container, '每页显示条数', '100');
        for (let i = 0; i < 10; i++) await click(container, '下一页');
        expect(query.requests.at(-1)?.options).toMatchObject({ skip: 1000, take: 100 });
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-1001');
        expect(container.textContent).toContain('1101 条 · 11 / 12 页');
    });

    it('clamps the page after a shorter refresh and recovers from an empty result', async () => {
        query.data = auditData();
        const { container, update } = await render(<TranslationsModule />);
        await click(container, '下一页');
        await click(container, '下一页');
        query.data = auditData(translationStates.slice(0, 21));
        await update();
        expect(container.textContent).toContain('21 条 · 2 / 2 页');
        expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
        query.data = auditData([]);
        await update();
        expect(container.textContent).toContain('0 条 · 1 / 1 页');
        query.data = auditData();
        await update();
        expect(container.querySelector('tbody tr')?.textContent).toContain('item-1');
    });

    it('keeps a jobs page during refresh and resets when the queue filter changes', async () => {
        const jobs = Array.from({ length: 100 }, (_, i) => ({
            id: `job-${i + 1}`,
            queueName: i % 2 ? 'queue-a' : 'queue-b',
            state: 'COMPLETED',
            isSettled: true,
            createdAt: now,
            startedAt: now,
            settledAt: now,
            duration: 200,
            error: null,
            progress: 100,
            attempts: 1,
            retries: 0,
        }));
        query.data = {
            jobs: { items: jobs, totalItems: 1000 },
            jobQueues: [
                { name: 'queue-a', running: true },
                { name: 'queue-b', running: true },
            ],
            scheduledTasks: [],
            apiKeys: { items: [], totalItems: 0 },
            settingsStoreFieldDefinitions: [],
            activeAdministrator: null,
        };
        const { container, update } = await render(<SystemOpsModule />);
        await click(container, '下一页');
        query.data = { ...query.data, jobs: { items: [...jobs], totalItems: 1000 } };
        await update();
        expect(container.querySelector('tbody tr')?.textContent).toContain('job-21');
        expect(container.textContent).toContain('100 条 · 2 / 5 页');
        await select(container, '筛选任务队列', 'queue-a');
        expect(container.querySelector('tbody tr')?.textContent).toContain('job-2');
        expect(container.textContent).toContain('50 条 · 1 / 3 页');
    });
});
