// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getActiveChannelToken, setInitialActiveChannel } from '../../apollo';
import type { SystemAnnouncementChannel, SystemAnnouncementRecord } from '../../graphql/storefront.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { hasAnyAdminPermission } from '../../utils/admin-permissions';
import { StorefrontContentModule } from './StorefrontContentModule';

vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const stores = [
    {
        id: 'a',
        code: 'store-a',
        token: 'store-a',
        defaultLanguageCode: 'zh_Hans',
        availableLanguageCodes: ['zh_Hans', 'en'],
        customFields: { storefrontNameZh: '店铺 A', storefrontNameEn: 'Store A' },
    },
    {
        id: 'b',
        code: 'store-b',
        token: 'store-b',
        defaultLanguageCode: 'zh_Hans',
        availableLanguageCodes: ['zh_Hans', 'en'],
        customFields: { storefrontNameZh: '店铺 B', storefrontNameEn: 'Store B' },
    },
];
const platform = {
    id: 'platform',
    code: '__default_channel__',
    token: 'platform',
    defaultLanguageCode: 'zh_Hans',
    availableLanguageCodes: ['zh_Hans', 'en'],
    customFields: { storefrontNameZh: '平台', storefrontNameEn: 'Platform' },
};
let host: HTMLDivElement, root: Root, client: ApolloClient;
let rows: SystemAnnouncementRecord[], failReadback: boolean;
let operations: Array<{ name: string; token?: string; input: Record<string, unknown>; fields: string[] }>;

function record(id: string, channel: SystemAnnouncementChannel = stores[0]): SystemAnnouncementRecord {
    return {
        id,
        ownerChannelId: channel.id,
        createdAt: '2026-10-07T00:00:00Z',
        updatedAt: '2026-10-07T00:00:00Z',
        enabled: true,
        priority: 0,
        titleZh: `公告 ${id}`,
        titleEn: '',
        titleEnLocked: false,
        contentEnLocked: false,
        contentZh: '本店服务时间',
        contentEn: '',
        linkUrl: null,
        startsAt: null,
        endsAt: null,
        targetMode: 'SINGLE',
        channels: [channel],
    };
}
beforeEach(() => {
    sessionStorage.clear();
    setInitialActiveChannel(stores[0].token);
    operations = [];
    rows = [record('a'), record('b', stores[1])];
    failReadback = false;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const name = operation.operationName ?? '';
                    const token =
                        operation.getContext().headers?.['vendure-token'] ?? getActiveChannelToken();
                    const input = operation.variables.input ?? {};
                    const fields = operation.query.definitions.flatMap(definition =>
                        definition.kind === 'OperationDefinition'
                            ? definition.selectionSet.selections.flatMap(field =>
                                  field.kind === 'Field' ? [field.name.value] : [],
                              )
                            : [],
                    );
                    operations.push({ name, token, input, fields });
                    const channel = [...stores, platform].find(store => store.token === token)!;
                    const timer = setTimeout(() => {
                        if (name === 'NextAdminSystemAnnouncements' && failReadback) {
                            observer.error(new Error('模拟公告读取失败'));
                            return;
                        }
                        let data: Record<string, unknown>;
                        if (name === 'NextAdminStorefrontContent') data = { activeChannel: channel };
                        else if (name === 'NextAdminSystemAnnouncementChannels')
                            data = { channels: { items: stores } };
                        else if (name === 'NextAdminSystemAnnouncements')
                            data = {
                                systemAnnouncements:
                                    token === platform.token
                                        ? rows
                                        : rows.filter(row => row.channels[0].id === channel.id),
                            };
                        else if (name === 'NextAdminCreateSystemAnnouncement') {
                            const next = {
                                ...record('created', channel),
                                ...input,
                                channels: stores.filter(store => input.channelIds?.includes(store.id)),
                            } as SystemAnnouncementRecord;
                            rows.push(next);
                            data = { createSystemAnnouncement: { id: next.id, updatedAt: next.updatedAt } };
                        } else if (name === 'NextAdminUpdateSystemAnnouncement') {
                            const next = {
                                ...rows.find(row => row.id === input.id),
                                ...input,
                            } as SystemAnnouncementRecord;
                            rows = rows.map(row => (row.id === input.id ? next : row));
                            data = {
                                updateSystemAnnouncement: {
                                    id: next.id,
                                    enabled: next.enabled,
                                    updatedAt: next.updatedAt,
                                },
                            };
                        } else if (name === 'NextAdminDeleteSystemAnnouncement') {
                            rows = rows.filter(row => row.id !== operation.variables.id);
                            data = { deleteSystemAnnouncement: { result: 'DELETED', message: null } };
                        } else throw new Error(`Unexpected operation ${name}`);
                        observer.next({ data });
                        observer.complete();
                    }, 0);
                    return () => clearTimeout(timer);
                }),
        ),
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.stop();
    host.remove();
});
const editorPermissions = [
    'ReadStorefrontContent',
    'CreateStorefrontContent',
    'UpdateStorefrontContent',
    'DeleteStorefrontContent',
];
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 35));
    });
}
async function render(permissions = editorPermissions) {
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <AdminPermissionsContext
                    value={{
                        permissions,
                        hasAnyPermission: required => hasAnyAdminPermission(permissions, required),
                    }}
                >
                    <MemoryRouter initialEntries={['/storefront/content/announcements']}>
                        <StorefrontContentModule key={getActiveChannelToken()} />
                    </MemoryRouter>
                </AdminPermissionsContext>
            </ApolloProvider>,
        ),
    );
    await settle();
    await settle();
}
function button(text: string, within: ParentNode = host) {
    const result = Array.from(within.querySelectorAll<HTMLButtonElement>('button')).find(
        node => node.textContent?.trim() === text,
    );
    if (!result) throw new Error(`Missing button ${text}: ${host.textContent}`);
    return result;
}
async function click(text: string, within: ParentNode = host) {
    await act(async () => button(text, within).click());
    await settle();
}
function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const prototype =
        field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function openNew() {
    await click('新建公告');
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => {
        fill(dialog.querySelector<HTMLInputElement>('input:not([type])')!, '本店营业公告');
        fill(dialog.querySelector<HTMLTextAreaElement>('textarea')!, '本店明日正常营业');
    });
    return dialog;
}

it('loads a merchant announcement page without platform-only content and hides global scope controls', async () => {
    await render();
    expect(host.textContent).toContain('公告 a');
    expect(host.textContent).not.toContain('公告 b');
    expect(operations.find(operation => operation.name === 'NextAdminStorefrontContent')?.fields).toEqual([
        'activeChannel',
    ]);
    const dialog = await openNew();
    expect(dialog.textContent).toContain('仅本店：店铺 A');
    expect(dialog.textContent).not.toContain('全部店铺');
    expect(operations.some(operation => operation.name === 'NextAdminSystemAnnouncementChannels')).toBe(
        false,
    );
    await click('创建公告', dialog);
    const creation = operations.find(operation => operation.name === 'NextAdminCreateSystemAnnouncement')!;
    expect(creation).toMatchObject({ token: 'store-a', input: { targetMode: 'SINGLE', channelIds: ['a'] } });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain('中文公告已保存并重新读取核对');
});

it('separates read permission from create, update and delete permission', async () => {
    await render(['ReadStorefrontContent']);
    expect(host.textContent).toContain('公告 a');
    expect(button('新建公告').disabled).toBe(true);
    expect([...host.querySelectorAll('button')].some(node => node.textContent?.trim() === '编辑')).toBe(
        false,
    );
    expect(host.querySelector('[aria-label="删除公告"]')).toBeNull();
});

it('keeps a platform announcement targeted to this store read-only even for SuperAdmin', async () => {
    rows = [{ ...record('platform-notice'), ownerChannelId: null }];
    await render(['SuperAdmin']);
    expect(host.textContent).toContain('公告 platform-notice');
    expect(host.textContent).toContain('平台发布');
    expect([...host.querySelectorAll('button')].some(node => node.textContent?.trim() === '编辑')).toBe(
        false,
    );
    expect(host.querySelector('[aria-label="删除公告"]')).toBeNull();
    expect(button('新建公告').disabled).toBe(false);
});

it('preserves the platform choice of all or specific operating shops', async () => {
    setInitialActiveChannel(platform.token);
    await render(['SuperAdmin']);
    const dialog = await openNew();
    expect(dialog.textContent).toContain('全部店铺');
    expect(dialog.textContent).toContain('店铺 B');
    const radio = dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1];
    await act(async () => radio.click());
    await click('创建公告', dialog);
    expect(
        operations.find(operation => operation.name === 'NextAdminCreateSystemAnnouncement'),
    ).toMatchObject({
        token: 'platform',
        input: { targetMode: 'ALL', channelIds: [] },
    });
});

it('retries only the read after a successful save followed by failed readback', async () => {
    await render();
    const dialog = await openNew();
    failReadback = true;
    await click('创建公告', dialog);
    expect(host.textContent).toContain('公告已保存');
    failReadback = false;
    await click('重新读取公告', dialog);
    expect(
        operations.filter(operation => operation.name === 'NextAdminCreateSystemAnnouncement'),
    ).toHaveLength(1);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
});

it('drops the previous shop list and draft when the validated channel scope changes', async () => {
    await render();
    await openNew();
    await act(async () => root.render(null));
    setInitialActiveChannel(stores[1].token);
    await client.clearStore();
    await render();
    expect(host.textContent).toContain('公告 b');
    expect(host.textContent).not.toContain('公告 a');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(
        operations
            .filter(operation => operation.name === 'NextAdminSystemAnnouncements')
            .map(operation => operation.token),
    ).toEqual(['store-a', 'store-b']);
});
