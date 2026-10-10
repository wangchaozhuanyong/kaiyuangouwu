// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act, StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPageWorkspace } from '../../components/AdminPageWorkspace';
import { DIGITAL_PRODUCT_WORKSPACE } from '../../graphql/product-domains.graphql';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { getQueryRuntime } from '../../runtime/admin-query-runtime';
import {
    createResourceInvalidationLink,
    invalidateAdminResources,
} from '../../runtime/admin-resource-events';
import { DigitalProductWorkspace } from './DigitalProductWorkspace';

const mocks = vi.hoisted(() => ({
    scope: 'fixture-store-a:zh',
    productId: '6',
    variantId: '12',
    migrated: false,
    refetch: vi.fn(),
}));
vi.mock('../../apollo', () => ({
    getAdminQueryScope: () => mocks.scope,
    uploadAdminFile: vi.fn(),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./ProductAutoCardSetupPanel', () => ({ ProductAutoCardSetupPanel: () => null }));
vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => ({
        productId: mocks.productId,
        variants: [
            {
                id: mocks.variantId,
                sku: 'fixture-sku',
                name: '默认规格',
                digitalDeliveryMode: 'manual_service',
                digitalMigrationRequired: !mocks.migrated,
            },
        ],
        setVariants: vi.fn(),
        handleVariantFieldChange: vi.fn(),
        formErrors: {},
        saving: false,
        isDirty: false,
        refetchWorkspace: mocks.refetch,
        handleSave: vi.fn(),
        refetchProduct: vi.fn(),
    }),
}));

const page = '/catalog/products/fixture';
const row = { id: 'legacy-23', stockLocationId: 'legacy-location', stockOnHand: 100, stockAllocated: 0 };
const reason = '经营者确认精确旧记录属于当前店铺';
interface Request {
    operationName: string;
    variables: Record<string, unknown>;
    scope: string;
    cancelled: boolean;
    respond: () => void;
}
let host: HTMLDivElement;
let root: Root;
let client: ApolloClient;
let requests: Request[];
let holdNextPreview: boolean;
let failNextPreview: boolean;

function WorkspaceProbe() {
    const result = useAdminQuery(DIGITAL_PRODUCT_WORKSPACE, {
        variables: { productId: mocks.productId },
        fetchPolicy: 'network-only',
    });
    useLayoutEffect(() => {
        mocks.refetch.mockImplementation(() => result.refetch());
    }, [result]);
    return <span data-workspace-probe>{result.data ? 'workspace loaded' : 'workspace pending'}</span>;
}
async function render(strict = false) {
    const children: ReactNode = (
        <ApolloProvider client={client}>
            <AdminPageWorkspace page={page} active>
                <WorkspaceProbe />
                <DigitalProductWorkspace />
            </AdminPageWorkspace>
        </ApolloProvider>
    );
    await act(async () => root.render(strict ? <StrictMode>{children}</StrictMode> : children));
}
beforeEach(async () => {
    vi.clearAllMocks();
    mocks.scope = 'fixture-store-a:zh';
    mocks.productId = '6';
    mocks.variantId = '12';
    mocks.migrated = false;
    requests = [];
    holdNextPreview = false;
    failNextPreview = false;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    // Synthetic in-memory transport only: no HTTP link and no production API.
    const transport = new ApolloLink(
        operation =>
            new Observable(observer => {
                const variables = structuredClone(operation.variables) as Record<string, unknown>;
                const name = operation.operationName ?? '';
                const request: Request = {
                    operationName: name,
                    variables,
                    scope: mocks.scope,
                    cancelled: false,
                    respond: () => {
                        if (name === 'DigitalInventoryMigrationPreview') {
                            const confirmed = Boolean(variables.ownershipConfirmation);
                            if (mocks.migrated && confirmed) {
                                observer.error(new Error('旧确认在已迁移状态无效'));
                                return;
                            }
                            observer.next({
                                data: {
                                    digitalInventoryMigrationPreview: {
                                        __typename: 'DigitalInventoryMigrationPreview',
                                        productVariantId: String(variables.productVariantId),
                                        availableQuantity: confirmed ? 200 : 100,
                                        reservedQuantity: 0,
                                        conflicts: confirmed ? [] : ['旧库存缺少店铺归属，请先核对'],
                                        alreadyMigrated: mocks.migrated,
                                        confirmableStockLevels: mocks.migrated
                                            ? []
                                            : [
                                                  {
                                                      __typename: 'DigitalInventoryLegacyStockLevel',
                                                      ...row,
                                                  },
                                              ],
                                    },
                                },
                            });
                        } else if (name === 'MigrateDigitalInventory') {
                            mocks.migrated = true;
                            observer.next({
                                data: {
                                    migrateDigitalInventory: {
                                        __typename: 'DigitalVariantConfig',
                                        id: 'synthetic-config',
                                        availableQuantity: 200,
                                    },
                                },
                            });
                        } else if (name === 'DigitalProductWorkspace') {
                            observer.next({
                                data: {
                                    digitalProductWorkspace: {
                                        __typename: 'DigitalProductWorkspace',
                                        productId: String(variables.productId),
                                        variants: [
                                            {
                                                __typename: 'DigitalProductVariant',
                                                id: mocks.variantId,
                                                sku: 'fixture-sku',
                                                deliveryMode: 'manual_service',
                                                stockPolicy: 'limited',
                                                availableQuantity: mocks.migrated ? 200 : null,
                                                migrationRequired: !mocks.migrated,
                                                purchaseCostMicrounits: null,
                                                supplier: null,
                                                fileVersion: null,
                                            },
                                        ],
                                    },
                                },
                            });
                        } else {
                            observer.error(new Error('Unexpected synthetic operation: ' + name));
                            return;
                        }
                        observer.complete();
                    },
                };
                requests.push(request);
                if (name === 'DigitalInventoryMigrationPreview' && failNextPreview) {
                    failNextPreview = false;
                    observer.error(new Error('synthetic preview read failed'));
                } else if (name === 'DigitalInventoryMigrationPreview' && holdNextPreview) {
                    holdNextPreview = false;
                } else {
                    request.respond();
                }
                return () => {
                    request.cancelled = true;
                };
            }),
    );
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: ApolloLink.from([createResourceInvalidationLink(() => mocks.scope), transport]),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.stop();
    host.remove();
});
function button(name: string) {
    const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        node => node.textContent?.trim() === name,
    );
    if (!found) throw new Error('Missing button: ' + name);
    return found;
}
async function click(name: string) {
    await act(async () => button(name).click());
}
async function setReason() {
    const input = host.querySelector<HTMLInputElement>('[aria-label="归属核对依据"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, reason);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
const previews = () =>
    requests.filter(request => request.operationName === 'DigitalInventoryMigrationPreview');
const writes = () => requests.filter(request => request.operationName === 'MigrateDigitalInventory');
async function ownershipCheck() {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await setReason();
    await click('核验归属与库存');
}
async function confirmedPreview() {
    await click('核对旧库存');
    await ownershipCheck();
}
async function refreshCatalog() {
    await act(async () => {
        const runtime = getQueryRuntime(client);
        runtime.invalidate(key => key.includes('digital') || key.includes('Digital'));
        await runtime.refreshPage(page, 'write');
    });
}
async function waitForWriteRefresh() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 180));
    });
}

it('retires confirmed preview before the native write event and catalog refresh without page failures', async () => {
    await render();
    await confirmedPreview();
    expect(button('确认核对并切换').disabled).toBe(false);
    expect(previews().at(-1)?.variables.ownershipConfirmation).toEqual({ stockLevels: [row], reason });
    const previewCount = previews().length;
    expect(getQueryRuntime(client).state(page).resources).toBe(1);
    await click('确认核对并切换');
    await waitForWriteRefresh();
    await refreshCatalog();
    expect(writes()).toHaveLength(1);
    expect(previews()).toHaveLength(previewCount);
    expect(
        requests.filter(request => request.operationName === 'DigitalProductWorkspace').length,
    ).toBeGreaterThan(1);
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    expect(host.querySelector('[data-failed]')).toBeNull();
    expect(host.textContent).toContain('迁移成功');
});

it('cancels a completed review without leaving a registered preview and can start a fresh review', async () => {
    await render();
    await confirmedPreview();
    const count = previews().length;
    await click('取消');
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).toBeNull();
    await refreshCatalog();
    expect(previews()).toHaveLength(count);
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    await click('核对旧库存');
    expect(previews().length).toBeGreaterThan(count);
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).not.toBeNull();
    expect(button('确认核对并切换').disabled).toBe(true);
    expect(writes()).toHaveLength(0);
});

it('finishes the first real Apollo preview under StrictMode without any write', async () => {
    await render(true);
    await click('核对旧库存');
    expect(previews().length).toBeGreaterThanOrEqual(1);
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).not.toBeNull();
    expect(host.textContent).not.toContain('库存核对已结束');
    expect(button('核对旧库存').disabled).toBe(false);
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    expect(writes()).toHaveLength(0);
});

it('ignores a late confirmed response after store and product scope change and permits a new review', async () => {
    await render();
    await click('核对旧库存');
    holdNextPreview = true;
    await ownershipCheck();
    const late = previews().at(-1)!;
    expect(late.variables.ownershipConfirmation).toEqual({ stockLevels: [row], reason });
    mocks.scope = 'fixture-store-b:zh';
    mocks.productId = '9';
    mocks.variantId = '10';
    await render();
    await act(async () => late.respond());
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).toBeNull();
    expect(host.textContent).not.toContain('库存核对已结束');
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    expect(writes()).toHaveLength(0);
    await click('核对旧库存');
    expect(previews().at(-1)?.scope).toBe('fixture-store-b:zh');
    expect(previews().at(-1)?.variables.productVariantId).toBe('10');
    expect(previews().at(-1)?.variables.ownershipConfirmation).toBeUndefined();
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).not.toBeNull();
    expect(button('确认核对并切换').disabled).toBe(true);
});

it('retires a failed reader from page status and retries only a fresh explicit read', async () => {
    await render();
    failNextPreview = true;
    await click('核对旧库存');
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    const count = previews().length;
    await refreshCatalog();
    expect(previews()).toHaveLength(count);
    await click('核对旧库存');
    expect(previews().length).toBeGreaterThan(count);
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).not.toBeNull();
    expect(writes()).toHaveLength(0);
});

it('keeps retired previews out of later catalog invalidation events', async () => {
    await render();
    await confirmedPreview();
    await click('取消');
    const count = previews().length;
    await act(async () => invalidateAdminResources(['catalog'], 'event'));
    await waitForWriteRefresh();
    expect(previews()).toHaveLength(count);
    expect(getQueryRuntime(client).state(page).failed).toBe(0);
    expect(writes()).toHaveLength(0);
});
