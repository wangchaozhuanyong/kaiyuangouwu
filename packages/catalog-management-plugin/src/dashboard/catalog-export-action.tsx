import {
    Alert,
    AlertDescription,
    Button,
    Progress,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { CatalogExportFormat, downloadCatalogBlob, exportCatalogRowsLocally } from './catalog-export-file';
import {
    CatalogExportRowRecord,
    CatalogIntegritySummaryRecord,
    catalogExportRowsQuery,
    catalogIntegritySummaryQuery,
    stockLocationsQuery,
} from './catalog-management.graphql';

export function CatalogExportAction() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                <Download className="mr-2 size-4" />
                导出可回导商品表
            </Button>
            <CatalogExportSheet open={open} onOpenChange={setOpen} />
        </>
    );
}

function CatalogExportSheet({
    open,
    onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
    const { activeChannel } = useChannel();
    const [progress, setProgress] = useState(0);
    const [stockLocationId, setStockLocationId] = useState('');
    const locationsQuery = useQuery({
        queryKey: ['catalog-export-stock-locations', activeChannel?.id],
        queryFn: () =>
            api.query<{ stockLocations: { items: Array<{ id: string; name: string }> } }>(
                stockLocationsQuery,
            ),
        enabled: open,
    });
    const locations = locationsQuery.data?.stockLocations.items ?? [];
    useEffect(() => {
        if (!locations.some(location => location.id === stockLocationId)) {
            setStockLocationId(locations[0]?.id ?? '');
        }
    }, [locations, stockLocationId]);
    const integrityQuery = useQuery({
        queryKey: ['catalog-integrity-summary', activeChannel?.id],
        queryFn: () => api.query<CatalogIntegritySummaryRecord>(catalogIntegritySummaryQuery),
        enabled: open,
    });
    const integrity = integrityQuery.data?.catalogIntegritySummary;
    const hasIntegrityGaps = Boolean(
        integrity &&
        (integrity.productsWithoutVariants > 0 ||
            integrity.variantsWithoutCategory > 0 ||
            integrity.variantsWithoutCost > 0),
    );
    const mutation = useMutation({
        mutationFn: async (format: CatalogExportFormat) => {
            const rows: CatalogExportRowRecord[] = [];
            let totalItems = Number.POSITIVE_INFINITY;
            for (let skip = 0; skip < totalItems; skip += 500) {
                const page = await api.query<{
                    catalogExportRows: { items: CatalogExportRowRecord[]; totalItems: number };
                }>(catalogExportRowsQuery, { skip, take: 500 });
                totalItems = page.catalogExportRows.totalItems;
                rows.push(...page.catalogExportRows.items);
                setProgress(Math.round((rows.length / Math.max(totalItems, 1)) * 80));
                if (page.catalogExportRows.items.length === 0) break;
            }
            setProgress(90);
            if (!stockLocationId) throw new Error('请选择默认回导仓库');
            const output = await exportCatalogRowsLocally(rows, format, stockLocationId);
            setProgress(100);
            return { ...output, count: rows.length };
        },
        onSuccess: result => {
            const date = new Date().toISOString().slice(0, 10);
            const channel = activeChannel?.code.replace(/[^a-z0-9_-]/giu, '_') || 'channel';
            downloadCatalogBlob(result.blob, `商品资料-${channel}-${date}.${result.extension}`);
            toast.success(`已在浏览器本地生成 ${result.count} 个 SKU 的报表`);
        },
        onError: error => toast.error(error instanceof Error ? error.message : String(error)),
        onSettled: () => setProgress(0),
    });
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                className="w-full overflow-y-auto sm:max-w-[640px]"
                data-catalog-export="browser-local"
            >
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="size-5" /> 导出可回导商品表
                    </SheetTitle>
                    <SheetDescription>
                        服务器只返回结构化商品数据，XLSX 或 CSV 文件在当前浏览器中生成并直接下载。
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-5 py-6">
                    <Alert>
                        <ShieldCheck className="size-4" />
                        <AlertDescription>
                            XLSX 保留全部仓库库存明细；CSV 按所选仓库导出一行一个 SKU，两者都可再次导入。
                        </AlertDescription>
                    </Alert>
                    <div className="rounded-lg border p-4 text-sm">
                        当前门店：<strong>{activeChannel?.code ?? '—'}</strong>
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">默认回导仓库</label>
                        <Select
                            value={stockLocationId}
                            onValueChange={value => value && setStockLocationId(value)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="请选择仓库" />
                            </SelectTrigger>
                            <SelectContent>
                                {locations.map(location => (
                                    <SelectItem key={location.id} value={location.id}>
                                        {location.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            主表的库存量和上下限来自该仓库；库存是绝对值。
                        </p>
                    </div>
                    {integrityQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                            <Loader2 className="size-4 animate-spin" /> 正在检查报表完整性
                        </div>
                    )}
                    {integrityQuery.isError && (
                        <Alert variant="destructive">
                            <AlertTriangle className="size-4" />
                            <AlertDescription className="space-y-2">
                                <p>完整性检查失败，为避免生成遗漏数据的报表，当前已暂停导出。</p>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void integrityQuery.refetch()}
                                >
                                    重新检查
                                </Button>
                            </AlertDescription>
                        </Alert>
                    )}
                    {hasIntegrityGaps && integrity && (
                        <Alert>
                            <AlertTriangle className="size-4" />
                            <AlertDescription>
                                当前有 {integrity.productsWithoutVariants} 个商品尚无 SKU（不会进入报表）、
                                {integrity.variantsWithoutCategory} 个 SKU 缺少分类、
                                {integrity.variantsWithoutCost} 个 SKU 缺少成本。缺少分类或成本的现有 SKU
                                可重新导入且不会被写成 0；请在商品抽屉补齐后再作为完整标准报表使用。
                            </AlertDescription>
                        </Alert>
                    )}
                    {mutation.isPending && (
                        <div className="space-y-2" role="status">
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>正在读取结构化数据并生成文件</span>
                                <span>{progress}%</span>
                            </div>
                            <Progress value={progress} />
                        </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Button
                            disabled={
                                mutation.isPending ||
                                integrityQuery.isLoading ||
                                integrityQuery.isError ||
                                locationsQuery.isLoading ||
                                !stockLocationId
                            }
                            onClick={() => mutation.mutate('xlsx')}
                        >
                            {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                            导出可回导 XLSX
                        </Button>
                        <Button
                            variant="outline"
                            disabled={
                                mutation.isPending ||
                                integrityQuery.isLoading ||
                                integrityQuery.isError ||
                                locationsQuery.isLoading ||
                                !stockLocationId
                            }
                            onClick={() => mutation.mutate('csv')}
                        >
                            导出可回导 CSV
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
