import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Loader2, Pencil, Plus, RefreshCw, Truck } from 'lucide-react';
import { useState } from 'react';

import {
    CatalogSupplierRecord,
    CatalogSupplierVariantRecord,
    catalogSupplierVariantsQuery,
    catalogSuppliersQuery,
    createCatalogSupplierMutation,
    updateCatalogSupplierMutation,
} from './catalog-management.graphql';

interface SupplierDraft {
    id?: string;
    code: string;
    name: string;
    enabled: boolean;
    contactName: string;
    phone: string;
    email: string;
    address: string;
    notes: string;
}

const PAGE_SIZE = 50;

export const catalogSupplierRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'catalog-suppliers',
        url: '/catalog-suppliers',
        title: '供货商',
        icon: Truck,
        order: 90,
        requiresPermission: ['ReadCatalogSupplier'],
    },
    path: '/catalog-suppliers',
    loader: () => ({ breadcrumb: () => '供货商' }),
    component: () => <CatalogSupplierPage />,
};

function CatalogSupplierPage() {
    const { activeChannel } = useChannel();
    const [text, setText] = useState('');
    const [enabled, setEnabled] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
    const [skip, setSkip] = useState(0);
    const [draft, setDraft] = useState<SupplierDraft | null>(null);
    const query = useQuery({
        queryKey: ['catalog-suppliers', activeChannel?.id, text, enabled, skip],
        queryFn: () =>
            api.query<{ catalogSuppliers: { items: CatalogSupplierRecord[]; totalItems: number } }>(
                catalogSuppliersQuery,
                {
                    options: {
                        skip,
                        take: PAGE_SIZE,
                        text: text.trim() || null,
                        enabled: enabled === 'ALL' ? null : enabled === 'ENABLED',
                    },
                },
            ),
        enabled: Boolean(activeChannel?.id),
    });
    const result = query.data?.catalogSuppliers;
    const saveMutation = useMutation({
        mutationFn: (value: SupplierDraft) => {
            const input = {
                ...(value.id ? { id: value.id } : {}),
                ...(value.code.trim() ? { code: value.code.trim() } : {}),
                name: value.name.trim(),
                enabled: value.enabled,
                contactName: value.contactName,
                phone: value.phone,
                email: value.email,
                address: value.address,
                notes: value.notes,
            };
            return api.mutate(value.id ? updateCatalogSupplierMutation : createCatalogSupplierMutation, {
                input,
            });
        },
        onSuccess: async () => {
            toast.success(draft?.id ? '供货商已更新' : '供货商已创建');
            setDraft(null);
            await query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const openCreate = () =>
        setDraft({
            code: '',
            name: '',
            enabled: true,
            contactName: '',
            phone: '',
            email: '',
            address: '',
            notes: '',
        });
    const openEdit = (supplier: CatalogSupplierRecord) =>
        setDraft({
            id: supplier.id,
            code: supplier.code,
            name: supplier.name,
            enabled: supplier.enabled,
            contactName: supplier.contactName ?? '',
            phone: supplier.phone ?? '',
            email: supplier.email ?? '',
            address: supplier.address ?? '',
            notes: supplier.notes ?? '',
        });

    return (
        <Page pageId="catalog-suppliers">
            <PageTitle>供货商</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" size="icon" onClick={() => void query.refetch()}>
                        <RefreshCw className={`size-4 ${query.isFetching ? 'animate-spin' : ''}`} />
                        <span className="sr-only">刷新</span>
                    </Button>
                    <Button onClick={openCreate}>
                        <Plus className="mr-2 size-4" />
                        新增供货商
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="catalog-supplier-list"
                    title="供货商资料"
                    description="供货商按当前门店独立管理；停用后保留历史 SKU 关联和审计记录。"
                >
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row">
                        <Input
                            className="sm:max-w-sm"
                            placeholder="搜索名称、编码、联系人或电话"
                            value={text}
                            onChange={event => {
                                setText(event.target.value);
                                setSkip(0);
                            }}
                        />
                        <Select
                            value={enabled}
                            onValueChange={value => {
                                setEnabled(value as typeof enabled);
                                setSkip(0);
                            }}
                        >
                            <SelectTrigger className="sm:w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">全部状态</SelectItem>
                                <SelectItem value="ENABLED">启用</SelectItem>
                                <SelectItem value="DISABLED">停用</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {query.isPending ? (
                        <div className="space-y-3">
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                            <Skeleton className="h-12 w-full" />
                        </div>
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>供货商列表加载失败，请刷新后重试。</AlertDescription>
                        </Alert>
                    ) : !result?.items.length ? (
                        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                            当前筛选下没有供货商
                        </div>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>名称</TableHead>
                                        <TableHead>编码</TableHead>
                                        <TableHead>联系人</TableHead>
                                        <TableHead>电话</TableHead>
                                        <TableHead>关联 SKU</TableHead>
                                        <TableHead>状态</TableHead>
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {result.items.map(supplier => (
                                        <TableRow key={supplier.id}>
                                            <TableCell className="font-medium">{supplier.name}</TableCell>
                                            <TableCell>{supplier.code}</TableCell>
                                            <TableCell>{supplier.contactName || '—'}</TableCell>
                                            <TableCell>{supplier.phone || '—'}</TableCell>
                                            <TableCell>{supplier.linkedVariantCount}</TableCell>
                                            <TableCell>
                                                <Badge variant={supplier.enabled ? 'default' : 'secondary'}>
                                                    {supplier.enabled ? '启用' : '停用'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => openEdit(supplier)}
                                                >
                                                    <Pencil className="mr-2 size-3" />
                                                    编辑
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                    <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                        <span>共 {result?.totalItems ?? 0} 个供货商</span>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={skip === 0}
                                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                            >
                                上一页
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={skip + PAGE_SIZE >= (result?.totalItems ?? 0)}
                                onClick={() => setSkip(skip + PAGE_SIZE)}
                            >
                                下一页
                            </Button>
                        </div>
                    </div>
                </PageBlock>
            </PageLayout>
            <SupplierEditor
                draft={draft}
                pending={saveMutation.isPending}
                onChange={setDraft}
                onClose={() => setDraft(null)}
                onSave={() => draft && saveMutation.mutate(draft)}
            />
        </Page>
    );
}

function SupplierEditor({
    draft,
    pending,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: SupplierDraft | null;
    pending: boolean;
    onChange: (draft: SupplierDraft | null) => void;
    onClose: () => void;
    onSave: () => void;
}>) {
    const variantsQuery = useQuery({
        queryKey: ['catalog-supplier-variants', draft?.id],
        queryFn: () =>
            api.query<{
                catalogSupplierVariants: {
                    items: CatalogSupplierVariantRecord[];
                    totalItems: number;
                };
            }>(catalogSupplierVariantsQuery, { supplierId: draft?.id, skip: 0, take: 50 }),
        enabled: Boolean(draft?.id),
    });
    if (!draft) return null;
    const update = (values: Partial<SupplierDraft>) => onChange({ ...draft, ...values });
    const linked = variantsQuery.data?.catalogSupplierVariants;
    return (
        <Sheet open onOpenChange={open => !open && onClose()}>
            <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-2xl">
                <SheetHeader>
                    <SheetTitle>{draft.id ? '编辑供货商' : '新增供货商'}</SheetTitle>
                    <SheetDescription>
                        编码留空时由系统生成。停用不会删除历史关联，也不会影响已经绑定的 SKU。
                    </SheetDescription>
                </SheetHeader>
                <div className="grid flex-1 content-start gap-4 py-6 sm:grid-cols-2">
                    <Field label="供货商名称">
                        <Input value={draft.name} onChange={event => update({ name: event.target.value })} />
                    </Field>
                    <Field label="供货商编码">
                        <Input
                            value={draft.code}
                            placeholder="留空自动生成"
                            onChange={event => update({ code: event.target.value })}
                        />
                    </Field>
                    <Field label="联系人">
                        <Input
                            value={draft.contactName}
                            onChange={event => update({ contactName: event.target.value })}
                        />
                    </Field>
                    <Field label="电话">
                        <Input
                            type="tel"
                            value={draft.phone}
                            onChange={event => update({ phone: event.target.value })}
                        />
                    </Field>
                    <Field label="邮箱">
                        <Input
                            type="email"
                            value={draft.email}
                            onChange={event => update({ email: event.target.value })}
                        />
                    </Field>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                            <Label>启用</Label>
                            <p className="text-xs text-muted-foreground">停用后导入会显示人工确认警告</p>
                        </div>
                        <Switch
                            checked={draft.enabled}
                            onCheckedChange={value => update({ enabled: value })}
                        />
                    </div>
                    <Field label="地址" className="sm:col-span-2">
                        <Input
                            value={draft.address}
                            onChange={event => update({ address: event.target.value })}
                        />
                    </Field>
                    <Field label="内部备注" className="sm:col-span-2">
                        <Textarea
                            rows={4}
                            value={draft.notes}
                            onChange={event => update({ notes: event.target.value })}
                        />
                    </Field>
                    {draft.id && (
                        <div className="space-y-2 border-t pt-4 sm:col-span-2">
                            <div className="text-sm font-medium">已关联 SKU（{linked?.totalItems ?? 0}）</div>
                            {variantsQuery.isPending ? (
                                <Skeleton className="h-20 w-full" />
                            ) : !linked?.items.length ? (
                                <div className="text-sm text-muted-foreground">暂无关联 SKU</div>
                            ) : (
                                <div className="max-h-48 divide-y overflow-y-auto rounded-lg border px-3">
                                    {linked.items.map(variant => (
                                        <div
                                            key={variant.id}
                                            className="flex justify-between gap-3 py-2 text-sm"
                                        >
                                            <span className="min-w-0 truncate">
                                                {variant.productName} · {variant.name}
                                            </span>
                                            <span className="shrink-0 text-muted-foreground">
                                                {variant.sku}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <SheetFooter className="border-t pt-4">
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={pending || !draft.name.trim()} onClick={onSave}>
                        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}保存
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function Field({
    label,
    className,
    children,
}: Readonly<{ label: string; className?: string; children: React.ReactNode }>) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '保存供货商失败';
}
