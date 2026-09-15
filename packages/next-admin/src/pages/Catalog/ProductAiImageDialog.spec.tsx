// @vitest-environment jsdom

import { MockedProvider } from '@apollo/client/testing/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import {
    CATALOG_IMAGE_GENERATION_JOBS,
    CATALOG_IMAGE_STUDIO_CONFIG,
} from '../../graphql/catalog-image-studio.graphql';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { DEFAULT_PRODUCT_IMAGE_DESCRIPTION, ProductAiImageDialog } from './ProductAiImageDialog';

describe('ProductAiImageDialog', () => {
    it('offers rear-camera capture with fixed product-image defaults and restores recent jobs', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        await act(async () => {
            root.render(
                <MockedProvider
                    mocks={[
                        {
                            request: { query: CATALOG_IMAGE_STUDIO_CONFIG },
                            result: {
                                data: {
                                    catalogImageStudioConfig: {
                                        enabled: true,
                                        unavailableReason: null,
                                        defaultModelCode: 'model',
                                        defaultModelName: '默认模型',
                                        termsVersion: 'v1',
                                        termsZh: '《AI 图片条款》',
                                        maxReferenceBytes: 10 * 1024 * 1024,
                                        acceptedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
                                        aspectRatio: '1:1',
                                        resolution: '1K',
                                        quantity: 1,
                                    },
                                },
                            },
                        },
                        {
                            request: {
                                query: CATALOG_IMAGE_GENERATION_JOBS,
                                variables: { skip: 0, take: 8 },
                            },
                            result: {
                                data: {
                                    catalogImageGenerationJobs: {
                                        totalItems: 1,
                                        items: [
                                            {
                                                id: 'job-1',
                                                createdAt: '2026-09-14T00:00:00Z',
                                                updatedAt: '2026-09-14T00:00:01Z',
                                                state: 'UNKNOWN',
                                                modelNameSnapshot: '默认模型',
                                                productName: '测试商品',
                                                description: DEFAULT_PRODUCT_IMAGE_DESCRIPTION,
                                                errorMessage: null,
                                                referenceAsset: null,
                                                outputs: [
                                                    {
                                                        id: 'output-1',
                                                        state: 'UNKNOWN',
                                                        errorMessage: null,
                                                        imageUrl: null,
                                                        catalogAssetId: null,
                                                        usedAt: null,
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ]}
                >
                    <AdminPermissionsContext.Provider
                        value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                    >
                        <FeatureHelpProvider>
                            <ProductAiImageDialog open productName="测试商品" onClose={vi.fn()} onUse={vi.fn()} />
                        </FeatureHelpProvider>
                    </AdminPermissionsContext.Provider>
                </MockedProvider>,
            );
        });
        await waitFor(() => container.querySelector('input[type="file"]'));
        const input = container.querySelector<HTMLInputElement>('input[type="file"]');
        expect(input?.getAttribute('capture')).toBe('environment');
        expect(input?.accept).toBe('image/jpeg,image/png,image/webp');
        expect(container.querySelector<HTMLTextAreaElement>('#catalog-image-description')?.value).toBe(
            DEFAULT_PRODUCT_IMAGE_DESCRIPTION,
        );
        await waitFor(() => (container.textContent?.includes('结果核对中') ? true : null));
        expect(container.textContent).toContain('结果核对中，请勿重复提交');
        expect(container.textContent).toContain('使用后还需保存商品');
        act(() => root.unmount());
        container.remove();
    });
});

async function waitFor<T>(read: () => T | null, timeoutMs = 2_000): Promise<T> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = read();
        if (value) return value;
        await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    }
    throw new Error('Timed out waiting for rendered content');
}
