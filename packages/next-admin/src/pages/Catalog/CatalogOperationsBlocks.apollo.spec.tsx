// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPageWorkspace } from '../../components/AdminPageWorkspace';
import { CustomFieldsContext } from '../../custom-fields/custom-fields-context';
import { defineNextAdminExtension, resetNextAdminExtensionsForTests } from '../../extensions/extension-api';
import { NextAdminPageBlocks } from '../../extensions/extension-hosts';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { getQueryRuntime } from '../../runtime/admin-query-runtime';
import { hasAnyAdminPermission } from '../../utils/admin-permissions';
import { ProductVariantCustomFieldsBlock } from './CatalogOperationsBlocks';

const mocks = vi.hoisted(() => ({ scope: 'synthetic-store-a:session-1' }));
vi.mock('../../apollo', () => ({ getAdminQueryScope: () => mocks.scope }));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

const page = '/catalog/products/11';
const permissions = ['SuperAdmin'];
const permissionContext = {
    permissions,
    hasAnyPermission: (required: readonly string[]) => hasAnyAdminPermission(permissions, required),
};
const capability = {
    channelId: 'synthetic-store-a',
    channelCode: 'synthetic-store-a',
    scope: 'STORE' as const,
    commerceMode: 'DIGITAL_ONLY' as const,
    capabilities: [
        {
            id: '/catalog/products',
            state: 'READY' as const,
            canRead: true,
            canWrite: true,
            canConfigure: true,
        },
    ],
};
const fields = {
    availableLanguages: ['zh_Hans'],
    entities: [
        {
            entityName: 'ProductVariant',
            customFields: [
                {
                    name: 'deliveryNote',
                    type: 'string',
                    list: false,
                    requiresPermission: ['ReadCatalog'],
                    label: [{ languageCode: 'zh_Hans', value: '交付说明' }],
                },
            ],
        },
    ],
};
let host: HTMLDivElement;
let root: Root;
let client: ApolloClient;
let reads: number;
let writes: number;
let serverValue: string;
let failNextRead: boolean;
let holdNextRead: boolean;
let releaseRead: (() => void) | undefined;
let holdNextWrite: boolean;
let releaseWrite: (() => void) | undefined;
let removeSelected: boolean;
let extraVariant: boolean;
let productId: string;
let errors: ReturnType<typeof vi.spyOn>;

function SiblingDraft() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(value => value + 1)}>相邻草稿 {count}</button>;
}
async function render() {
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <AdminPermissionsContext.Provider value={permissionContext}>
                    <AdminCapabilitiesContext.Provider value={capability}>
                        <CustomFieldsContext.Provider value={fields}>
                            <MemoryRouter initialEntries={[page]}>
                                <AdminPageWorkspace page={page} active>
                                    <NextAdminPageBlocks
                                        pageId="product-detail"
                                        entity={{
                                            id: productId,
                                            customFields: { fulfillmentType: 'digital' },
                                        }}
                                    />
                                </AdminPageWorkspace>
                            </MemoryRouter>
                        </CustomFieldsContext.Provider>
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>
            </ApolloProvider>,
        ),
    );
}
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    reads = 0;
    writes = 0;
    serverValue = '原交付资料';
    failNextRead = false;
    holdNextRead = false;
    releaseRead = undefined;
    releaseWrite = undefined;
    holdNextWrite = false;
    removeSelected = false;
    extraVariant = false;
    productId = '11';
    mocks.scope = 'synthetic-store-a:session-1';
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetNextAdminExtensionsForTests();
    defineNextAdminExtension({
        id: 'synthetic-fields',
        pageBlocks: [
            {
                id: 'custom-fields',
                pageId: 'product-detail',
                capabilityId: '/catalog/products',
                component: ProductVariantCustomFieldsBlock,
            },
            {
                id: 'sibling-draft',
                pageId: 'product-detail',
                capabilityId: '/catalog/products',
                component: SiblingDraft,
            },
        ],
    });
    // Real Apollo/runtime and dynamic document; transport is synthetic and performs no HTTP calls.
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    if (operation.operationName === 'NextAdminUpdateProductVariantCustomFields') {
                        writes++;
                        serverValue = operation.variables.input[0].customFields.deliveryNote;
                        const respond = () => {
                            observer.next({
                                data: {
                                    updateProductVariants: [{ __typename: 'ProductVariant', id: 'sku-1' }],
                                },
                            });
                            observer.complete();
                        };
                        if (holdNextWrite) {
                            holdNextWrite = false;
                            releaseWrite = respond;
                        } else respond();
                    } else if (operation.operationName === 'NextAdminProductVariantCustomFields') {
                        reads++;
                        const id = String(operation.variables.productId);
                        const respond = () => {
                            if (failNextRead) {
                                failNextRead = false;
                                observer.error(new Error('synthetic read unavailable'));
                            } else {
                                const primary = {
                                    __typename: 'ProductVariant',
                                    id: 'sku-1',
                                    sku: 'SKU-1',
                                    name: '默认规格',
                                    translations: [
                                        {
                                            __typename: 'ProductVariantTranslation',
                                            id: 'translation-1',
                                            languageCode: 'zh_Hans',
                                            name: '默认规格',
                                        },
                                    ],
                                    customFields: { deliveryNote: serverValue },
                                };
                                const secondary = {
                                    ...primary,
                                    id: 'sku-2',
                                    sku: 'SKU-2',
                                    name: '其他规格',
                                    translations: [
                                        { ...primary.translations[0], id: 'translation-2', name: '其他规格' },
                                    ],
                                    customFields: { deliveryNote: '其他规格资料' },
                                };
                                observer.next({
                                    data: {
                                        product: {
                                            __typename: 'Product',
                                            id,
                                            variants: [
                                                ...(removeSelected ? [] : [primary]),
                                                ...(extraVariant ? [secondary] : []),
                                            ],
                                        },
                                    },
                                });
                                observer.complete();
                            }
                        };
                        if (holdNextRead) {
                            holdNextRead = false;
                            releaseRead = respond;
                        } else respond();
                    } else observer.error(new Error('Unexpected operation: ' + operation.operationName));
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
    errors.mockRestore();
    resetNextAdminExtensionsForTests();
});
function button(text: string) {
    const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        node => node.textContent?.trim() === text,
    );
    if (!target) throw new Error('Missing button: ' + text);
    return target;
}
function input() {
    return host.querySelector<HTMLInputElement>('.admin-field input')!;
}
async function change(value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
        input().dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function refresh() {
    await act(async () => {
        await getQueryRuntime(client).refreshPage(page);
    });
}

it('finishes the actual dynamic Apollo SKU document without a render loop and preserves drafts on refresh', async () => {
    await render();
    expect(host.querySelector('[data-admin-extension-error]')).toBeNull();
    expect(input()?.value).toBe('原交付资料');
    expect(reads).toBe(1);
    await change('未保存的资料');
    await act(async () => button('相邻草稿 0').click());
    await refresh();
    expect(input().value).toBe('未保存的资料');
    expect(host.textContent).toContain('相邻草稿 1');
    expect(reads).toBe(2);
    expect(writes).toBe(0);
});

it('keeps confirmed save and sibling draft after failed read-back, then retries only the read', async () => {
    await render();
    await change('已保存资料');
    await act(async () => button('相邻草稿 0').click());
    failNextRead = true;
    await act(async () => button('保存字段').click());
    expect(writes).toBe(1);
    expect(host.textContent).toContain('扩展字段已保存');
    expect(host.textContent).toContain('相邻草稿 1');
    expect(input().value).toBe('已保存资料');
    expect(button('保存字段').disabled).toBe(true);
    await act(async () => button('重试读取').click());
    expect(writes).toBe(1);
    expect(input().value).toBe('已保存资料');
    expect(button('保存字段').disabled).toBe(false);
});

it('preserves new input entered while the save read-back is still pending', async () => {
    await render();
    await change('已提交资料');
    holdNextRead = true;
    await act(async () => button('保存字段').click());
    expect(writes).toBe(1);
    await change('等待读回时的新输入');
    await act(async () => releaseRead?.());
    expect(input().value).toBe('等待读回时的新输入');
    expect(writes).toBe(1);
});

it('keeps the loaded fields and unsaved input during a failed refresh, with a read-only retry', async () => {
    await render();
    await change('读取失败前的草稿');
    failNextRead = true;
    await refresh();
    expect(input().value).toBe('读取失败前的草稿');
    expect(host.querySelector('[data-admin-extension-error]')).toBeNull();
    await act(async () => button('重试读取').click());
    expect(input().value).toBe('读取失败前的草稿');
    expect(writes).toBe(0);
});

it('protects a dirty draft from a new server version until explicit discard', async () => {
    await render();
    await change('本地草稿');
    serverValue = '服务端的新值';
    await refresh();
    expect(input().value).toBe('本地草稿');
    expect(button('保存字段').disabled).toBe(true);
    await act(async () => button('放弃字段草稿并读取最新值').click());
    expect(input().value).toBe('服务端的新值');
    expect(button('保存字段').disabled).toBe(false);
    expect(writes).toBe(0);
});

it('never replaces an unavailable selected SKU with another SKU automatically', async () => {
    extraVariant = true;
    await render();
    await change('失效规格的未保存值');
    removeSelected = true;
    await refresh();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="选择补充资料规格"]')?.value).toBe('sku-1');
    expect(host.textContent).toContain('当前规格已不可用');
    expect(button('保存字段').disabled).toBe(true);
    expect(writes).toBe(0);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
        await act(async () => {
            const selector = host.querySelector<HTMLSelectElement>('[aria-label="选择补充资料规格"]')!;
            selector.value = 'sku-2';
            selector.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(confirm).toHaveBeenCalledOnce();
        expect(input().value).toBe('其他规格资料');
        expect(writes).toBe(0);
    } finally {
        confirm.mockRestore();
    }
});

it('ignores a late save receipt after changing product and does not start its stale read-back', async () => {
    await render();
    await change('旧商品写入');
    holdNextWrite = true;
    await act(async () => button('保存字段').click());
    expect(writes).toBe(1);
    productId = '12';
    await render();
    const count = reads;
    await act(async () => releaseWrite?.());
    expect(host.textContent).not.toContain('扩展字段已保存');
    expect(reads).toBe(count);
    expect(writes).toBe(1);
});
