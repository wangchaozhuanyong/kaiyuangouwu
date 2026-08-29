import {
    Alert,
    AlertDescription,
    Button,
    Progress,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    api,
    toast,
    useChannel,
    useMutation,
} from '@vendure/dashboard';
import { Download, FileSpreadsheet, Loader2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { CatalogExportFormat, downloadCatalogBlob, exportCatalogRowsLocally } from './catalog-export-file';
import { CatalogExportRowRecord, catalogExportRowsQuery } from './catalog-management.graphql';

export function CatalogExportAction() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="outline" onClick={() => setOpen(true)}>
                <Download className="mr-2 size-4" />
                导出报表
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
            const output = await exportCatalogRowsLocally(rows, format);
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
                        <FileSpreadsheet className="size-5" /> 商品标准报表
                    </SheetTitle>
                    <SheetDescription>
                        服务器只返回结构化商品数据，XLSX 或 CSV 文件在当前浏览器中生成并直接下载。
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-5 py-6">
                    <Alert>
                        <ShieldCheck className="size-4" />
                        <AlertDescription>
                            XLSX 包含商品与SKU、库存策略、批次效期和字段说明四个工作表；CSV 只导出商品与SKU。
                        </AlertDescription>
                    </Alert>
                    <div className="rounded-lg border p-4 text-sm">
                        当前门店：<strong>{activeChannel?.code ?? '—'}</strong>
                    </div>
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
                        <Button disabled={mutation.isPending} onClick={() => mutation.mutate('xlsx')}>
                            {mutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                            导出标准 XLSX
                        </Button>
                        <Button
                            variant="outline"
                            disabled={mutation.isPending}
                            onClick={() => mutation.mutate('csv')}
                        >
                            导出商品 CSV
                        </Button>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
