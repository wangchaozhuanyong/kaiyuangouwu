// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    ContentTranslationAuditResult,
    ContentTranslationReviewRecord,
} from '../../graphql/plugins.graphql';
import { TranslationsModule } from './TranslationsModule';

// Business callbacks use synthetic records. Actual Apollo identity/cache behavior
// remains covered by use-admin-query.spec.tsx; no translation provider is invoked.
const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    confirm: vi.fn(),
    backfill: vi.fn(),
    test: vi.fn(),
    retry: vi.fn(),
    refetch: vi.fn(),
    scope: 'test-store-a',
    active: true,
}));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminQuery: mocks.query }));
vi.mock('../../hooks/use-page-activity', () => ({ usePageActivity: () => mocks.active }));
vi.mock('../../apollo', () => ({ getAdminQueryScope: () => mocks.scope }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('@apollo/client/react', () => ({
    useMutation: (document: any) => {
        const name = document.definitions.find((item: any) => item.kind === 'OperationDefinition')?.name
            .value;
        return [
            name === 'NextAdminConfirmContentTranslationReview'
                ? mocks.confirm
                : name === 'NextAdminBackfillContentTranslations'
                  ? mocks.backfill
                  : name === 'NextAdminTestContentTranslation'
                    ? mocks.test
                    : mocks.retry,
            { loading: false },
        ];
    },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const record = {
    id: 'state-87',
    channelId: 'store-a',
    entityType: 'StorefrontContentBlock',
    entityId: '87',
    fieldPath: 'title',
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    status: 'STALE',
    origin: 'MANUAL',
    locked: true,
    error: null,
    attempts: 0,
    revision: 3,
    nextAttemptAt: null,
    lastErrorCode: null,
    updatedAt: '2026-10-07T00:00:00.000Z',
};
const audit: ContentTranslationAuditResult = {
    activeChannel: {
        id: 'store-a',
        code: 'store-a',
        defaultLanguageCode: 'zh_Hans',
        availableLanguageCodes: ['zh_Hans', 'en'],
    },
    contentTranslationStaleCount: 999,
    contentTranslationAudit: {
        configured: true,
        provider: 'synthetic-provider',
        total: 20,
        filteredTotal: 20,
        counts: [
            { status: 'STALE', count: 7 },
            { status: 'PENDING', count: 4 },
            { status: 'TRANSLATING', count: 2 },
            { status: 'NOTIFY_PENDING', count: 1 },
            { status: 'FAILED', count: 6 },
        ],
        states: [record],
    },
};
const review: ContentTranslationReviewRecord = {
    state: record,
    sourceText: '<b>最新中文</b>',
    targetText: '<b>Current English</b>',
    sourceHash: 'source-v3',
    translatedHash: 'english-v2',
    format: 'HTML',
    canConfirm: true,
    editPath: '/storefront/decoration?blockId=87&field=title&language=en',
    reason: null,
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    mocks.scope = 'test-store-a';
    mocks.active = true;
    for (const fn of [mocks.query, mocks.confirm, mocks.backfill, mocks.test, mocks.retry, mocks.refetch])
        fn.mockReset();
    mocks.refetch.mockResolvedValue({ data: audit });
    mocks.query.mockImplementation((document: any) => ({
        data:
            document.definitions[0].name.value === 'NextAdminContentTranslationReview'
                ? { contentTranslationReview: review }
                : audit,
        loading: false,
        refetch: mocks.refetch,
    }));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function render() {
    await act(async () =>
        root.render(
            <MemoryRouter>
                <TranslationsModule />
            </MemoryRouter>,
        ),
    );
}
function button(label: string, within: ParentNode = document.body) {
    const found = [...within.querySelectorAll<HTMLButtonElement>('button')].find(
        item => item.textContent?.trim() === label,
    );
    expect(found, label).toBeDefined();
    return found!;
}
function dialog() {
    return document.body.querySelector<HTMLElement>('[role="dialog"]')!;
}
function batch(scanned: number, queued: number, nextOffset: number, hasMore: boolean) {
    return {
        data: {
            backfillCustomerContentTranslations: {
                total: 120,
                scanned,
                queued,
                processed: 0,
                skipped: 0,
                failed: 0,
                nextOffset,
                hasMore,
                errors: [],
                skippedRecords: [],
            },
        },
    };
}

describe('translation audit repair', () => {
    it('counts manual review separately and uses clickable exact status filters', async () => {
        await render();
        const filter = host.querySelector<HTMLButtonElement>('[aria-label="筛选待人工复核"]')!;
        expect(filter.textContent).toContain('7 项');
        expect(filter.textContent).not.toContain('999');
        expect(host.textContent).toContain('配置存在不代表连接已验证');
        await act(async () => filter.click());
        expect(mocks.query.mock.lastCall?.[1].variables.options.status).toBe('STALE');
        await act(async () => button('翻译中 2 项').click());
        expect(mocks.query.mock.lastCall?.[1].variables.options.status).toBe('TRANSLATING');
    });

    it('retains current rows during same-condition refresh but never falls back to previous filters', async () => {
        mocks.query.mockReturnValue({ data: audit, loading: true, refetch: mocks.refetch });
        await render();
        expect(host.textContent).toContain('查看／复核');
        const search = host.querySelector('[aria-label="搜索翻译审计记录"]');
        mocks.query.mockReturnValue({
            data: undefined,
            previousData: audit,
            loading: true,
            refetch: mocks.refetch,
        });
        await render();
        expect(host.textContent).not.toContain('查看／复核');
        expect(host.textContent).toContain('正在读取真实翻译审计数据');
        expect(host.querySelector('[aria-label="搜索翻译审计记录"]')).toBe(search);
    });

    it('confirms unchanged English with exact version hashes and separates accepted write from failed refresh', async () => {
        mocks.confirm.mockResolvedValue({
            data: {
                confirmCustomerContentTranslationReview: {
                    ...record,
                    status: 'MANUAL_LOCKED',
                    locked: true,
                    revision: 4,
                },
            },
        });
        mocks.refetch.mockRejectedValue(new Error('模拟读取失败'));
        await render();
        await act(async () => button('查看／复核').click());
        expect(dialog().querySelectorAll('textarea')[0].value).toBe('<b>最新中文</b>');
        expect(dialog().querySelector('b')).toBeNull();
        expect(dialog().querySelector('a')?.getAttribute('href')).toBe(review.editPath);
        await act(async () => button('确认已复核，保留锁定').click());
        expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
            variables: {
                input: { id: 'state-87', revision: 3, sourceHash: 'source-v3', translatedHash: 'english-v2' },
            },
        });
        expect(document.body.textContent).toContain('复核已确认，人工锁定已保留');
        expect(host.textContent).toContain('操作已完成，但最新记录读取失败');
        expect(dialog().textContent).not.toContain('确认已复核，保留锁定');
        await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="刷新"]')!.click());
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
    });

    it('does not update or refresh a new scope from a late confirmation and merges double clicks', async () => {
        let finish!: (value: unknown) => void;
        mocks.confirm.mockImplementation(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        await render();
        await act(async () => button('查看／复核').click());
        await act(async () => {
            const confirm = button('确认已复核，保留锁定');
            confirm.click();
            confirm.click();
        });
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        mocks.scope = 'test-store-b';
        await act(async () =>
            finish({
                data: {
                    confirmCustomerContentTranslationReview: {
                        ...record,
                        status: 'MANUAL_LOCKED',
                        locked: true,
                    },
                },
            }),
        );
        expect(mocks.refetch).not.toHaveBeenCalled();
        expect(host.textContent).not.toContain('已确认英文复核');
    });

    it('shows cumulative batches and keeps completion after failed readback without repeating the write', async () => {
        mocks.backfill
            .mockResolvedValueOnce(batch(100, 90, 100, true))
            .mockResolvedValueOnce(batch(20, 15, 120, false));
        mocks.refetch.mockRejectedValue(new Error('模拟读取失败'));
        await render();
        await act(async () => button('补齐历史翻译').click());
        await act(async () => button('开始第一批').click());
        await act(async () => button('继续下一批').click());
        expect(dialog().textContent).toContain('累计扫描 120 项');
        expect(dialog().textContent).toContain('排队 105 项');
        expect(dialog().textContent).toContain('后台翻译可能仍在进行');
        expect(host.textContent).toContain('最新记录读取失败');
        expect(mocks.backfill).toHaveBeenCalledTimes(2);
        expect(
            [...dialog().querySelectorAll('button')].some(item => item.textContent?.includes('继续下一批')),
        ).toBe(false);
    });

    it('does not perform manual readback after the page becomes hidden during confirmation', async () => {
        let finish!: (value: unknown) => void;
        mocks.confirm.mockImplementation(
            () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
        );
        await render();
        await act(async () => button('查看／复核').click());
        await act(async () => button('确认已复核，保留锁定').click());
        mocks.active = false;
        await render();
        await act(async () =>
            finish({
                data: {
                    confirmCustomerContentTranslationReview: {
                        ...record,
                        status: 'MANUAL_LOCKED',
                        locked: true,
                    },
                },
            }),
        );
        expect(mocks.refetch).not.toHaveBeenCalled();
        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(dialog().textContent).toContain('复核已确认，人工锁定已保留');
    });

    it('shows an ineligible review reason instead of allowing confirmation', async () => {
        mocks.query.mockImplementation((document: any) => ({
            data:
                document.definitions[0].name.value === 'NextAdminContentTranslationReview'
                    ? {
                          contentTranslationReview: {
                              ...review,
                              canConfirm: false,
                              reason: '源内容已更新，请重新读取后核对',
                          },
                      }
                    : audit,
            loading: false,
            refetch: mocks.refetch,
        }));
        await render();
        await act(async () => button('查看／复核').click());
        expect(dialog().textContent).toContain('源内容已更新');
        expect(
            [...dialog().querySelectorAll('button')].some(
                item => item.textContent === '确认已复核，保留锁定',
            ),
        ).toBe(false);
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(dialog().querySelector('a')).not.toBeNull();
    });

    it('stops a no-progress response and does not misreport scan completion', async () => {
        mocks.backfill.mockResolvedValue(batch(0, 0, 0, true));
        await render();
        await act(async () => button('补齐历史翻译').click());
        await act(async () => button('开始第一批').click());
        expect(dialog().textContent).toContain('扫描未取得进展');
        expect(button('开始第一批').disabled).toBe(true);
        expect(mocks.refetch).not.toHaveBeenCalled();
    });

    it('registers batches even when provider is not configured, without invoking the provider test', async () => {
        mocks.query.mockReturnValue({
            data: {
                ...audit,
                contentTranslationAudit: { ...audit.contentTranslationAudit, configured: false },
            },
            loading: false,
            refetch: mocks.refetch,
        });
        mocks.backfill.mockResolvedValue(batch(1, 1, 1, false));
        await render();
        expect(button('补齐历史翻译').disabled).toBe(false);
        await act(async () => button('补齐历史翻译').click());
        expect(button('开始第一批').disabled).toBe(false);
        await act(async () => button('开始第一批').click());
        expect(mocks.backfill).toHaveBeenCalledTimes(1);
        expect(mocks.test).not.toHaveBeenCalled();
    });
});
