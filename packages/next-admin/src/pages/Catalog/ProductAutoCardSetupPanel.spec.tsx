// @vitest-environment jsdom

import { MockedProvider } from '@apollo/client/testing/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';

import {
    IMPORT_AUTO_CARD_ITEMS_MUTATION,
    PREVIEW_AUTO_CARD_IMPORT_MUTATION,
    PRODUCT_AUTO_CARD_DELIVERIES_QUERY,
    PRODUCT_AUTO_CARD_SETUP_QUERY,
    UPDATE_AUTO_CARD_CONFIG_MUTATION,
    type AutoCardConfigRecord,
} from '../../graphql/fulfillment.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { ProductAutoCardSetupPanel } from './ProductAutoCardSetupPanel';
import { autoCardReadiness, inferAutoCardFormatPreset } from './auto-card-setup';

const config = (patch: Partial<AutoCardConfigRecord> = {}): AutoCardConfigRecord => ({
    id: 'config-1',
    updatedAt: '2026-09-04T00:00:00.000Z',
    enabled: true,
    formatName: '账号与密码',
    delimiter: '----',
    fields: [
        { key: 'account', label: '账号', labelEn: 'Account', secret: false },
        { key: 'password', label: '密码', labelEn: 'Password', secret: true },
    ],
    instructions: '',
    instructionsZh: '',
    instructionsEn: '',
    lowStockThreshold: 10,
    availableCount: 20,
    assignedCount: 0,
    disabledCount: 0,
    waitingDeliveryCount: 0,
    ...patch,
});

describe('ProductAutoCardSetupPanel', () => {
    it('recognizes common formats and leaves custom fields editable', () => {
        expect(inferAutoCardFormatPreset([{ key: 'account' }, { key: 'password' }])).toBe('account_password');
        expect(inferAutoCardFormatPreset([{ key: 'code' }])).toBe('single_code');
        expect(inferAutoCardFormatPreset([{ key: 'email' }, { key: 'pin' }])).toBe('custom');
    });

    it("reports the setup state that needs the merchant's attention", () => {
        expect(autoCardReadiness(null).label).toBe('待配置');
        expect(autoCardReadiness(config({ availableCount: 0 })).label).toBe('缺少库存');
        expect(autoCardReadiness(config({ waitingDeliveryCount: 2 })).label).toBe('需要处理');
        expect(autoCardReadiness(config()).label).toBe('可以销售');
    });

    it('keeps a new auto-card SKU on one page until the product is saved', () => {
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <ProductAutoCardSetupPanel
                    variants={[
                        {
                            sku: 'gift-card-10',
                            name: '10 美元',
                            price: '10',
                            stockOnHand: 0,
                            stockAllocated: 0,
                            enabled: true,
                            digitalDeliveryMode: 'auto_card',
                            digitalStockPolicy: 'pool_derived',
                            optionIds: [],
                            isNew: true,
                        },
                    ]}
                    productIsDirty
                    productSaving={false}
                    onSaveProduct={async () => undefined}
                    onRefreshProduct={async () => undefined}
                />
            </FeatureHelpProvider>,
        );

        expect(html).toContain('一站式设置');
        expect(html).toContain('保存商品并继续设置');
        expect(html).toContain('保存完成就能继续导入卡密');
    });

    it('saves, previews, and imports card stock without leaving the product page', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const variables = { productVariantId: 'variant-1' };
        const deliveryVariables = {
            options: { productVariantId: 'variant-1', skip: 0, take: 5 },
        };
        const savedInput = {
            productVariantId: 'variant-1',
            enabled: true,
            formatName: '单卡密',
            delimiter: '----',
            fields: [{ key: 'code', label: '卡密', labelEn: 'Code', secret: true }],
            instructionsZh: '请妥善保管卡密，并按商品说明完成兑换。',
            instructionsEn: 'Keep your credentials safe and follow the product instructions.',
            lowStockThreshold: 10,
        };
        const updateMock = {
            request: { query: UPDATE_AUTO_CARD_CONFIG_MUTATION, variables: { input: savedInput } },
            result: {
                data: {
                    updateAutoCardConfig: {
                        id: 'config-1',
                        enabled: true,
                        formatName: '单卡密',
                        delimiter: '----',
                        fields: savedInput.fields,
                        instructionsZh: savedInput.instructionsZh,
                        instructionsEn: savedInput.instructionsEn,
                        lowStockThreshold: 10,
                    },
                },
            },
        };
        const deliveryMock = {
            request: { query: PRODUCT_AUTO_CARD_DELIVERIES_QUERY, variables: deliveryVariables },
            result: { data: { autoCardDeliveries: { totalItems: 0, items: [] } } },
        };
        const onRefreshProduct = vi.fn(async () => undefined);

        await act(async () => {
            root.render(
                <MockedProvider
                    mocks={[
                        {
                            request: { query: PRODUCT_AUTO_CARD_SETUP_QUERY, variables },
                            result: { data: { autoCardConfig: null } },
                        },
                        deliveryMock,
                        updateMock,
                        {
                            request: {
                                query: PREVIEW_AUTO_CARD_IMPORT_MUTATION,
                                variables: {
                                    input: { productVariantId: 'variant-1', rawText: 'CARD-001' },
                                },
                            },
                            result: {
                                data: {
                                    previewAutoCardPoolImport: {
                                        validCount: 1,
                                        invalidCount: 0,
                                        rows: [
                                            {
                                                lineNumber: 1,
                                                fields: [
                                                    {
                                                        key: 'code',
                                                        label: '卡密',
                                                        labelEn: 'Code',
                                                        value: 'CAR•••001',
                                                        secret: true,
                                                    },
                                                ],
                                            },
                                        ],
                                        errors: [],
                                    },
                                },
                            },
                        },
                        updateMock,
                        {
                            request: {
                                query: IMPORT_AUTO_CARD_ITEMS_MUTATION,
                                variables: {
                                    input: { productVariantId: 'variant-1', rawText: 'CARD-001' },
                                },
                            },
                            result: {
                                data: {
                                    importAutoCardPoolItems: {
                                        importedCount: 1,
                                        duplicateCount: 0,
                                        availableCount: 1,
                                    },
                                },
                            },
                        },
                        {
                            request: { query: PRODUCT_AUTO_CARD_SETUP_QUERY, variables },
                            result: { data: { autoCardConfig: config({ availableCount: 1 }) } },
                        },
                        deliveryMock,
                    ]}
                >
                    <AdminPermissionsContext.Provider
                        value={{ permissions: [], hasAnyPermission: () => true }}
                    >
                        <MemoryRouter>
                            <FeatureHelpProvider>
                                <ProductAutoCardSetupPanel
                                    variants={[
                                        {
                                            id: 'variant-1',
                                            sku: 'gift-card-10',
                                            name: '10 美元',
                                            price: '10',
                                            stockOnHand: 0,
                                            stockAllocated: 0,
                                            enabled: true,
                                            digitalDeliveryMode: 'auto_card',
                                            digitalStockPolicy: 'pool_derived',
                                            optionIds: [],
                                        },
                                    ]}
                                    productIsDirty={false}
                                    productSaving={false}
                                    onSaveProduct={async () => undefined}
                                    onRefreshProduct={onRefreshProduct}
                                />
                            </FeatureHelpProvider>
                        </MemoryRouter>
                    </AdminPermissionsContext.Provider>
                </MockedProvider>,
            );
        });
        await waitForText(container, '1. 选择卡密格式');

        const format = container.querySelector<HTMLSelectElement>('select[aria-label="卡密格式"]');
        const textarea = container.querySelector<HTMLTextAreaElement>('textarea[placeholder]');
        expect(format).not.toBeNull();
        expect(textarea).not.toBeNull();
        act(() => {
            setInputValue(format!, 'single_code');
            setInputValue(textarea!, 'CARD-001');
        });

        const previewButton = buttonWithText(container, '保存设置并检查卡密');
        act(() => previewButton.click());
        await waitForText(container, '确认导入 1 条');

        act(() => buttonWithText(container, '确认导入 1 条').click());
        await waitForText(container, '自动发卡已就绪：新增 1 条');
        await waitForText(container, '当前 1 条可用，库存偏低');

        expect(container.textContent).toContain('当前 1 条可用，库存偏低');
        expect(onRefreshProduct).toHaveBeenCalledOnce();
        act(() => root.unmount());
        container.remove();
    });
});

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const prototype =
        element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
}

function buttonWithText(container: HTMLElement, text: string) {
    const button = Array.from(container.querySelectorAll('button')).find(item =>
        item.textContent?.includes(text),
    );
    if (!button) throw new Error(`Button not found: ${text}`);
    return button;
}

async function waitForText(container: HTMLElement, text: string) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (container.textContent?.includes(text)) return;
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
        });
    }
    throw new Error(`Text not found: ${text}\n${container.textContent}`);
}
