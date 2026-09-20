// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogExportAction } from './CatalogExportAction';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    exportCatalogRowsLocally: vi.fn(),
    downloadCatalogBlob: vi.fn(),
}));

vi.mock('@vendure/catalog-management-plugin/browser', () => ({
    exportCatalogRowsLocally: mocks.exportCatalogRowsLocally,
    downloadCatalogBlob: mocks.downloadCatalogBlob,
}));

vi.mock('@apollo/client/react', () => ({
    useApolloClient: () => ({
        query: mocks.query,
    }),
}));

vi.mock('../../components/FeatureHelp', () => ({
    FeatureHelpButton: () => null,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('CatalogExportAction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads warehouses and enables export buttons while integrity check is still pending', async () => {
        mocks.query.mockImplementation(({ query }: { query: any }) => {
            const queryString = query?.loc?.source?.body ?? '';
            if (queryString.includes('NextAdminCatalogIntegritySummary')) {
                return new Promise(() => undefined);
            }
            if (queryString.includes('NextAdminCatalogExportContext')) {
                return Promise.resolve({
                    data: {
                        stockLocations: {
                            items: [
                                { id: 'loc-1', name: '主仓库' },
                                { id: 'loc-2', name: '备用仓' },
                            ],
                        },
                    },
                });
            }
            return Promise.resolve({ data: {} });
        });

        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(<CatalogExportAction />);
            });

            const openButton = host.querySelector('button')!;
            expect(openButton.textContent).toContain('导出可回导商品表');

            await act(async () => {
                openButton.click();
            });

            // Dialog should be open
            expect(host.textContent).toContain('导出可回导商品表');
            expect(host.textContent).toContain('默认回导仓库');
            expect(host.textContent).toContain('正在检查商品完整性');

            // Select should contain the loaded warehouses and default to first warehouse
            const select = host.querySelector('select') as HTMLSelectElement;
            expect(select).not.toBeNull();
            expect(select.options.length).toBe(3); // "请选择仓库", "主仓库", "备用仓"
            expect(select.value).toBe('loc-1');

            // Export buttons should be enabled since a warehouse is selected
            const exportXlsxBtn = [...host.querySelectorAll('button')].find(btn =>
                btn.textContent?.includes('导出可回导 XLSX'),
            );
            const exportCsvBtn = [...host.querySelectorAll('button')].find(btn =>
                btn.textContent?.includes('导出可回导 CSV'),
            );

            expect(exportXlsxBtn).toBeDefined();
            expect(exportCsvBtn).toBeDefined();
            expect((exportXlsxBtn as HTMLButtonElement).disabled).toBe(false);
            expect((exportCsvBtn as HTMLButtonElement).disabled).toBe(false);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('reports an integrity failure without disabling export', async () => {
        mocks.query.mockImplementation(({ query }: { query: any }) => {
            const queryString = query?.loc?.source?.body ?? '';
            if (queryString.includes('NextAdminCatalogIntegritySummary')) {
                return Promise.reject(new Error('GraphQL error: 内部服务异常'));
            }
            if (queryString.includes('NextAdminCatalogExportContext')) {
                return Promise.resolve({
                    data: { stockLocations: { items: [{ id: 'loc-1', name: '主仓库' }] } },
                });
            }
            return Promise.resolve({ data: {} });
        });
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => root.render(<CatalogExportAction />));
            await act(async () => {
                host.querySelector('button')?.click();
                await Promise.resolve();
            });

            expect(host.textContent).toContain('完整性检查暂不可用，但不影响导出');
            const exportXlsxBtn = [...host.querySelectorAll('button')].find(btn =>
                btn.textContent?.includes('导出可回导 XLSX'),
            );
            expect((exportXlsxBtn as HTMLButtonElement).disabled).toBe(false);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('displays warning when no warehouses are configured in the system', async () => {
        mocks.query.mockImplementation(({ query }: { query: any }) => {
            const queryString = query?.loc?.source?.body ?? '';
            if (queryString.includes('NextAdminCatalogIntegritySummary')) {
                return Promise.resolve({
                    data: {
                        catalogIntegritySummary: {
                            totalProducts: 5,
                            totalVariants: 8,
                            productsWithoutVariants: 0,
                            variantsWithoutCategory: 0,
                            variantsWithoutCost: 0,
                        },
                    },
                });
            }
            if (queryString.includes('NextAdminCatalogExportContext')) {
                return Promise.resolve({
                    data: { stockLocations: { items: [] } },
                });
            }
            if (queryString.includes('NextAdminCatalogCreationContext')) {
                return Promise.resolve({
                    data: { catalogProductCreationContext: { stockLocations: [] } },
                });
            }
            return Promise.resolve({ data: {} });
        });

        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => {
                root.render(<CatalogExportAction />);
            });

            const openButton = host.querySelector('button')!;
            await act(async () => {
                openButton.click();
            });

            expect(host.textContent).toContain('未检测到可用仓库');

            const exportXlsxBtn = [...host.querySelectorAll('button')].find(btn =>
                btn.textContent?.includes('导出可回导 XLSX'),
            );
            expect((exportXlsxBtn as HTMLButtonElement).disabled).toBe(true);
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });

    it('advances by the server scanned count so capped pages export every SKU', async () => {
        const requestedSkips: number[] = [];
        mocks.exportCatalogRowsLocally.mockResolvedValue({
            blob: new Blob(['catalog']),
            extension: 'xlsx',
        });
        mocks.query.mockImplementation(
            ({ query, variables }: { query: any; variables?: { skip?: number } }) => {
                const queryString = query?.loc?.source?.body ?? '';
                if (queryString.includes('NextAdminCatalogIntegritySummary')) {
                    return Promise.resolve({
                        data: {
                            catalogIntegritySummary: {
                                totalProducts: 100,
                                totalVariants: 120,
                                productsWithoutVariants: 0,
                                variantsWithoutCategory: 0,
                                variantsWithoutCost: 0,
                            },
                        },
                    });
                }
                if (queryString.includes('NextAdminCatalogExportContext')) {
                    return Promise.resolve({
                        data: { stockLocations: { items: [{ id: 'loc-1', name: '主仓库' }] } },
                    });
                }
                if (queryString.includes('NextAdminCatalogExportRows')) {
                    const skip = variables?.skip ?? 0;
                    requestedSkips.push(skip);
                    const scannedItems = Math.min(50, 120 - skip);
                    return Promise.resolve({
                        data: {
                            catalogExportRows: {
                                totalItems: 120,
                                scannedItems,
                                items: Array.from({ length: scannedItems }, (_, index) => ({
                                    variantId: `variant-${skip + index}`,
                                })),
                            },
                        },
                    });
                }
                return Promise.resolve({ data: {} });
            },
        );

        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        try {
            await act(async () => root.render(<CatalogExportAction />));
            await act(async () => {
                host.querySelector('button')?.click();
                await Promise.resolve();
            });
            const exportButton = [...host.querySelectorAll('button')].find(button =>
                button.textContent?.includes('导出可回导 XLSX'),
            );
            await act(async () => {
                exportButton?.click();
                await Promise.resolve();
            });

            expect(requestedSkips).toEqual([0, 50, 100]);
            expect(mocks.exportCatalogRowsLocally).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ variantId: 'variant-0' }),
                    expect.objectContaining({ variantId: 'variant-119' }),
                ]),
                'xlsx',
                'loc-1',
            );
            expect(mocks.exportCatalogRowsLocally.mock.calls[0][0]).toHaveLength(120);
            expect(mocks.downloadCatalogBlob).toHaveBeenCalledOnce();
        } finally {
            await act(async () => root.unmount());
            host.remove();
        }
    });
});
