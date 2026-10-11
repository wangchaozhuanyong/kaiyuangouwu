// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminFeedbackCenter } from '../../components/AdminFeedbackCenter';
import { AdminPageWorkspace } from '../../components/AdminPageWorkspace';
import type { GenericPromotionListRecord } from '../../graphql/generic-promotions.graphql';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { getQueryRuntime } from '../../runtime/admin-query-runtime';
import { GenericPromotionsPanel } from './GenericPromotionsPanel';

const scope = vi.hoisted(() => ({ value: 'synthetic-platform:zh_Hans' }));
vi.mock('../../apollo', () => ({
    getAdminQueryScope: () => scope.value,
    getAdminDisplayLanguage: () => 'zh_Hans',
    sensitiveActionContext: vi.fn(),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../components/SensitiveActionDialog', () => ({
    SensitiveActionDialog: ({
        open,
        error,
        onConfirm,
    }: {
        open: boolean;
        error: string;
        onConfirm: (password: string) => Promise<void>;
    }) =>
        open ? (
            <div data-synthetic-delete-dialog>
                <button onClick={() => void onConfirm('synthetic-only')}>合成确认删除</button>
                <p>{error}</p>
            </div>
        ) : null,
}));

const page = '/marketing/promotions';
const stores = [
    { id: 'synthetic-a', code: 'synthetic-a', nameZh: '合成甲店', nameEn: 'Synthetic store A' },
    { id: 'synthetic-b', code: 'synthetic-b', nameZh: '合成乙店', nameEn: 'Synthetic store B' },
];
type Store = (typeof stores)[number];
interface ManagementItem {
    promotion: GenericPromotionListRecord;
    stores: Store[];
    shared: boolean;
    ownershipKnown: boolean;
    archivedAt: string | null;
    claimStartsAt: string | null;
    claimEndsAt: string | null;
}
interface ListData {
    activeChannel: { id: string; code: string; defaultLanguageCode: string };
    adminPromotionManagement: { items: ManagementItem[]; totalItems: number; stores: Store[] };
    promotionConditions: [];
    promotionActions: [];
}
interface ReadRequest {
    variables: {
        options: { skip: number; take: number; sort: { createdAt: string; id: string } };
        storeChannelId: string | null;
    };
    scope: string;
    respond: (data: ListData) => void;
    fail: () => void;
}
let host: HTMLDivElement;
let root: Root;
let client: ApolloClient;
let requests: ReadRequest[];
let deletions: { id: string; respond: (result: string) => void }[];

function item(name: string, overrides: Partial<ManagementItem> = {}): ManagementItem {
    return {
        promotion: {
            id: `synthetic-${name}`,
            name,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
            description: '合成促销数据，仅用于本地回归',
            enabled: true,
            couponCode: null,
            startsAt: null,
            endsAt: null,
            usageLimit: null,
            perCustomerUsageLimit: null,
        },
        stores: [stores[0]],
        shared: false,
        ownershipKnown: true,
        archivedAt: null,
        claimStartsAt: null,
        claimEndsAt: null,
        ...overrides,
    };
}
function data(items: ManagementItem[], totalItems = items.length, channelId = 'platform'): ListData {
    return {
        activeChannel: {
            id: channelId,
            code: channelId === 'platform' ? '__default_channel__' : channelId,
            defaultLanguageCode: 'zh_Hans',
        },
        adminPromotionManagement: {
            items,
            totalItems,
            stores: channelId === 'platform' ? stores : stores.filter(store => store.id === channelId),
        },
        promotionConditions: [],
        promotionActions: [],
    };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
async function render(channelId = 'platform') {
    await act(async () => {
        root.render(
            <ApolloProvider client={client}>
                <AdminFeedbackCenter />
                <AdminCapabilitiesContext.Provider
                    value={{
                        channelId,
                        channelCode: channelId === 'platform' ? '__default_channel__' : channelId,
                        scope: channelId === 'platform' ? 'PLATFORM' : 'STORE',
                        commerceMode: null,
                        capabilities: [],
                    }}
                >
                    <AdminPageWorkspace key={scope.value} page={page} active>
                        <GenericPromotionsPanel />
                    </AdminPageWorkspace>
                </AdminCapabilitiesContext.Provider>
            </ApolloProvider>,
        );
        await settle();
    });
}
async function respond(request: ReadRequest, result: ListData) {
    await act(async () => {
        request.respond(result);
        await settle();
    });
}
function button(label: string) {
    const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label,
    );
    if (!result) throw new Error('Missing user action: ' + label);
    return result;
}
async function click(label: string) {
    await act(async () => {
        button(label).click();
        await settle();
    });
}
async function selectStore(id: string) {
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="按店铺筛选"]');
    if (!select) throw new Error('Missing store filter');
    await act(async () => {
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await settle();
    });
}
function row(name: string) {
    const result = [...host.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(node =>
        node.querySelector('[data-label="名称"]')?.textContent?.includes(name),
    );
    if (!result) throw new Error('Missing promotion row: ' + name);
    return result;
}

beforeEach(() => {
    scope.value = 'synthetic-platform:zh_Hans';
    requests = [];
    deletions = [];
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    // Real Apollo/cache/runtime with a synthetic in-memory transport; no HTTP or business writes.
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'NextAdminDeleteGenericPromotion') {
                        deletions.push({
                            id: operation.variables.id as string,
                            respond: result => {
                                observer.next({ data: { deletePromotion: { result, message: null } } });
                                observer.complete();
                            },
                        });
                        return;
                    }
                    if (operation.operationName !== 'NextAdminGenericPromotions') {
                        observer.error(
                            new Error('Unexpected synthetic operation: ' + operation.operationName),
                        );
                        return;
                    }
                    requests.push({
                        variables: structuredClone(operation.variables) as ReadRequest['variables'],
                        scope: scope.value,
                        respond: result => {
                            observer.next({ data: result });
                            observer.complete();
                        },
                        fail: () => observer.error(new Error('合成促销读取失败')),
                    });
                }),
        ),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.stop();
    host.remove();
    vi.restoreAllMocks();
});

describe('real Apollo generic promotion management', () => {
    it('preserves accepted deletion feedback when readback fails and retries only the read', async () => {
        await render();
        const promotion = item('合成待删除活动');
        await respond(requests[0], data([promotion]));
        await click('删除');
        await click('合成确认删除');
        expect(deletions).toHaveLength(1);
        expect(deletions[0].id).toBe(promotion.promotion.id);
        await act(async () => {
            deletions[0].respond('DELETED');
            await settle();
        });
        expect(host.textContent).toContain('通用促销「合成待删除活动」已删除');
        expect(requests).toHaveLength(2);
        await act(async () => {
            requests[1].fail();
            await settle();
        });
        expect(host.textContent).toContain('操作已完成，但最新数据读取失败。请刷新页面，勿重复提交。');
        expect(host.querySelector('[data-admin-feedback-kind="info"]')).not.toBeNull();
        expect(host.textContent).not.toContain('合成促销读取失败');
        expect(host.querySelector('[data-synthetic-delete-dialog]')).toBeNull();
        expect(getQueryRuntime(client).state(page).failed).toBe(1);
        await click('重试本页');
        expect(requests).toHaveLength(3);
        await respond(requests[2], data([]));
        expect(deletions).toHaveLength(1);
        expect(host.querySelector('tbody tr')).toBeNull();
        expect(host.querySelector('[data-failed]')).toBeNull();
    });

    it('keeps a rejected deletion in the dialog without claiming success or refreshing', async () => {
        await render();
        await respond(requests[0], data([item('合成禁止删除活动')]));
        await click('删除');
        await click('合成确认删除');
        await act(async () => {
            deletions[0].respond('NOT_DELETED');
            await settle();
        });
        expect(host.querySelector('[data-synthetic-delete-dialog]')).not.toBeNull();
        expect(host.textContent).not.toContain('已删除');
        expect(host.textContent).not.toContain('操作已完成');
        expect(requests).toHaveLength(1);
        expect(deletions).toHaveLength(1);
    });

    it('loads page two and resets pagination on a server-side store filter without showing old rows', async () => {
        await render();
        expect(requests[0].variables).toEqual({
            options: { skip: 0, take: 20, sort: { createdAt: 'DESC', id: 'DESC' } },
            storeChannelId: null,
        });
        await respond(requests[0], data([item('合成第一页活动')], 41));
        await click('下一页');
        expect(requests.at(-1)?.variables).toMatchObject({ options: { skip: 20, take: 20 } });
        expect(host.textContent).not.toContain('合成第一页活动');
        await respond(requests.at(-1)!, data([item('合成第二页活动')], 41));
        expect(host.textContent).toContain('合成第二页活动');

        await selectStore(stores[0].id);
        expect(requests.at(-1)?.variables).toEqual({
            options: { skip: 0, take: 20, sort: { createdAt: 'DESC', id: 'DESC' } },
            storeChannelId: stores[0].id,
        });
        expect(host.textContent).not.toContain('合成第二页活动');
        await respond(requests.at(-1)!, data([item('合成甲店活动')], 1));
        expect(row('合成甲店活动').textContent).toContain('合成甲店');

        await selectStore(stores[1].id);
        expect(requests.at(-1)?.variables.storeChannelId).toBe(stores[1].id);
        expect(host.textContent).not.toContain('合成甲店活动');
        await respond(requests.at(-1)!, data([item('合成乙店活动', { stores: [stores[1]] })], 1));
        expect(row('合成乙店活动').textContent).toContain('合成乙店');
    });

    it('keeps the same-filter rows through a failed page refresh and retries only its active read', async () => {
        await render();
        await respond(requests[0], data([item('合成可用活动')]));
        await click('刷新');
        expect(requests).toHaveLength(2);
        expect(host.textContent).toContain('合成可用活动');
        expect(host.textContent).not.toContain('正在读取 Vendure 通用促销');
        const refreshReceipt = getQueryRuntime(client).refreshPage(page);
        await act(async () => {
            requests[1].fail();
            await refreshReceipt;
        });
        expect(host.textContent).toContain('合成可用活动');
        expect(getQueryRuntime(client).state(page).failed).toBe(1);
        expect(host.querySelector('[data-failed]')?.textContent).toContain('更新失败');
        await click('重试本页');
        expect(requests).toHaveLength(3);
        expect(requests[2].variables).toEqual(requests[0].variables);
        await respond(requests[2], data([item('合成更新后活动')]));
        expect(host.textContent).toContain('合成更新后活动');
        expect(host.textContent).not.toContain('合成可用活动');
        expect(host.querySelector('[data-failed]')).toBeNull();
    });

    it('does not reuse the platform response after the real cache-clear and scope-remount boundary', async () => {
        await render();
        await respond(requests[0], data([item('合成平台私有结果')]));
        await act(async () => client.clearStore());
        scope.value = 'synthetic-a:zh_Hans';
        await render(stores[0].id);
        expect(host.textContent).not.toContain('合成平台私有结果');
        expect(requests.at(-1)?.scope).toBe(scope.value);
        expect(requests.at(-1)?.variables.storeChannelId).toBeNull();
        await respond(requests.at(-1)!, data([item('合成商户活动')], 1, stores[0].id));
        expect(host.textContent).toContain('合成商户活动');
        expect(host.textContent).not.toContain('合成平台私有结果');
    });

    it('shows actual lifecycle priority, separate claim closure, and multi-store or unknown ownership', async () => {
        const now = Date.parse('2026-10-11T12:00:00.000Z');
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const past = new Date(now - 60_000).toISOString();
        const future = new Date(now + 60_000).toISOString();
        const archived = item('合成归档活动');
        archived.archivedAt = past;
        archived.promotion.enabled = false;
        archived.promotion.endsAt = past;
        const disabled = item('合成停用活动');
        disabled.promotion.enabled = false;
        disabled.promotion.endsAt = past;
        const ended = item('合成结束活动', { claimEndsAt: past });
        ended.promotion.endsAt = past;
        const claimClosed = item('合成停止发放活动', { claimEndsAt: past });
        claimClosed.promotion.endsAt = future;
        const futureClaim = item('合成待发放活动', { claimStartsAt: future });
        futureClaim.promotion.startsAt = past;
        const futurePromotion = item('合成待开始活动');
        futurePromotion.promotion.startsAt = future;
        const shared = item('合成跨店活动', { stores, shared: true });
        const unknown = item('合成待核对活动', { stores: [], ownershipKnown: false });
        await render();
        await respond(
            requests[0],
            data([archived, disabled, ended, claimClosed, futureClaim, futurePromotion, shared, unknown]),
        );
        for (const [name, status] of [
            ['合成归档活动', '已归档'],
            ['合成停用活动', '已停用'],
            ['合成结束活动', '已结束'],
            ['合成停止发放活动', '已停止发放'],
            ['合成待发放活动', '待开始'],
            ['合成待开始活动', '待开始'],
            ['合成跨店活动', '进行中'],
        ]) {
            expect(row(name).querySelector('[data-label="状态"]')?.textContent).toBe(status);
        }
        const sharedOwnership = row('合成跨店活动').querySelector('[data-label="关联店铺"]')?.textContent;
        expect(sharedOwnership).toContain('合成甲店');
        expect(sharedOwnership).toContain('合成乙店');
        expect(sharedOwnership).toContain('多店关联');
        expect(row('合成待核对活动').querySelector('[data-label="关联店铺"]')?.textContent).toContain(
            '归属待核对',
        );
    });
});
