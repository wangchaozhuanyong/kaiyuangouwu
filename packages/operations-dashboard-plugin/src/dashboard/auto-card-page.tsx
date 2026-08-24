import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
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
import { AlertTriangle, Eye, KeyRound, Plus, RefreshCw, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    AutoCardConfigRecord,
    AutoCardDeliveryRecord,
    AutoCardFieldDefinition,
    AutoCardPoolItemRecord,
    AutoCardTodoSummaryRecord,
    AutoCardVariantRecord,
    AutoCardWorkspaceResult,
    autoCardTodoSummaryQuery,
    autoCardVariantsQuery,
    autoCardWorkspaceQuery,
    importAutoCardPoolItemsMutation,
    previewAutoCardPoolImportMutation,
    retryAutoCardDeliveryMutation,
    revealAutoCardPoolItemMutation,
    setAutoCardPoolItemEnabledMutation,
    updateAutoCardConfigMutation,
} from './auto-card.graphql';

const messages = {
    title: msg({ id: 'operations.autoCard.title', message: 'Automatic credential delivery' }),
    description: msg({
        id: 'operations.autoCard.description',
        message: 'Configure one-line credential formats, manage SKU pools and close delivery exceptions.',
    }),
    selectSku: msg({ id: 'operations.autoCard.selectSku', message: 'Select an SKU' }),
    searchSku: msg({ id: 'operations.autoCard.searchSku', message: 'Search product name or SKU' }),
    refresh: msg({ id: 'operations.autoCard.refresh', message: 'Refresh' }),
    noSku: msg({
        id: 'operations.autoCard.noSku',
        message: 'Select a digital SKU to configure automatic delivery.',
    }),
    settings: msg({ id: 'operations.autoCard.settings', message: 'Delivery format' }),
    settingsDescription: msg({
        id: 'operations.autoCard.settingsDescription',
        message:
            'Each pasted line is one sellable credential. Field order controls parsing and email display.',
    }),
    enabled: msg({ id: 'operations.autoCard.enabled', message: 'Enable automatic delivery' }),
    formatPreset: msg({ id: 'operations.autoCard.formatPreset', message: 'Format preset' }),
    formatName: msg({ id: 'operations.autoCard.formatName', message: 'Format name' }),
    delimiter: msg({ id: 'operations.autoCard.delimiter', message: 'Field separator' }),
    lowStock: msg({ id: 'operations.autoCard.lowStock', message: 'Low-stock warning' }),
    instructions: msg({ id: 'operations.autoCard.instructions', message: 'Product delivery instructions' }),
    instructionsHint: msg({
        id: 'operations.autoCard.instructionsHint',
        message: 'This text is appended to the delivery email for this SKU.',
    }),
    fields: msg({ id: 'operations.autoCard.fields', message: 'Fields in one line' }),
    fieldKey: msg({ id: 'operations.autoCard.fieldKey', message: 'Field key' }),
    fieldLabel: msg({ id: 'operations.autoCard.fieldLabel', message: 'Email label' }),
    secret: msg({ id: 'operations.autoCard.secret', message: 'Secret' }),
    addField: msg({ id: 'operations.autoCard.addField', message: 'Add field' }),
    save: msg({ id: 'operations.autoCard.save', message: 'Save delivery format' }),
    saved: msg({ id: 'operations.autoCard.saved', message: 'Automatic delivery settings saved' }),
    inventory: msg({ id: 'operations.autoCard.inventory', message: 'Credential inventory' }),
    available: msg({ id: 'operations.autoCard.available', message: 'Available' }),
    assigned: msg({ id: 'operations.autoCard.assigned', message: 'Assigned' }),
    disabled: msg({ id: 'operations.autoCard.disabled', message: 'Disabled' }),
    waiting: msg({ id: 'operations.autoCard.waiting', message: 'Waiting for stock' }),
    lowStockSkus: msg({ id: 'operations.autoCard.lowStockSkus', message: 'Low-stock SKUs' }),
    manualReview: msg({ id: 'operations.autoCard.manualReview', message: 'Manual review' }),
    importTitle: msg({ id: 'operations.autoCard.importTitle', message: 'Paste credentials' }),
    importDescription: msg({
        id: 'operations.autoCard.importDescription',
        message: 'Paste one credential per line. Preview must pass before the pool can be updated.',
    }),
    preview: msg({ id: 'operations.autoCard.preview', message: 'Preview parsing' }),
    import: msg({ id: 'operations.autoCard.import', message: 'Add to pool' }),
    validRows: msg({ id: 'operations.autoCard.validRows', message: 'Valid rows' }),
    invalidRows: msg({ id: 'operations.autoCard.invalidRows', message: 'Invalid rows' }),
    imported: msg({ id: 'operations.autoCard.imported', message: 'Credentials added to the pool' }),
    pool: msg({ id: 'operations.autoCard.pool', message: 'Pool records' }),
    sequence: msg({ id: 'operations.autoCard.sequence', message: 'Sequence' }),
    content: msg({ id: 'operations.autoCard.content', message: 'Masked content' }),
    status: msg({ id: 'operations.autoCard.status', message: 'Status' }),
    action: msg({ id: 'operations.autoCard.action', message: 'Actions' }),
    reveal: msg({ id: 'operations.autoCard.reveal', message: 'Reveal' }),
    stop: msg({ id: 'operations.autoCard.stop', message: 'Disable' }),
    restore: msg({ id: 'operations.autoCard.restore', message: 'Restore' }),
    noPool: msg({ id: 'operations.autoCard.noPool', message: 'No credentials have been added yet.' }),
    deliveries: msg({ id: 'operations.autoCard.deliveries', message: 'Delivery records' }),
    order: msg({ id: 'operations.autoCard.order', message: 'Order' }),
    recipient: msg({ id: 'operations.autoCard.recipient', message: 'Delivery email' }),
    attempts: msg({ id: 'operations.autoCard.attempts', message: 'Attempts' }),
    retry: msg({ id: 'operations.autoCard.retry', message: 'Resend same credentials' }),
    noDeliveries: msg({
        id: 'operations.autoCard.noDeliveries',
        message: 'No delivery records for this SKU.',
    }),
    loadError: msg({
        id: 'operations.autoCard.loadError',
        message: 'Could not load automatic delivery data',
    }),
    configFirst: msg({
        id: 'operations.autoCard.configFirst',
        message: 'Save the delivery format before importing credentials.',
    }),
    revealTitle: msg({ id: 'operations.autoCard.revealTitle', message: 'Credential details' }),
    revealWarning: msg({
        id: 'operations.autoCard.revealWarning',
        message: 'Sensitive content is shown only for this record. Do not copy it into chat or logs.',
    }),
};

const presets: Record<string, { formatName: string; delimiter: string; fields: AutoCardFieldDefinition[] }> =
    {
        accountPassword: {
            formatName: '账号密码',
            delimiter: '----',
            fields: [
                { key: 'account', label: '账号', secret: false },
                { key: 'password', label: '密码', secret: true },
            ],
        },
        emailPassword: {
            formatName: '邮箱账号',
            delimiter: '----',
            fields: [
                { key: 'email', label: '邮箱', secret: false },
                { key: 'emailPassword', label: '邮箱密码', secret: true },
            ],
        },
        accountPhone2fa: {
            formatName: '账号密码手机2FA',
            delimiter: '----',
            fields: [
                { key: 'account', label: '账号', secret: false },
                { key: 'password', label: '密码', secret: true },
                { key: 'phone', label: '手机', secret: false },
                { key: 'twoFactor', label: '2FA密钥', secret: true },
            ],
        },
    };

interface ConfigDraft {
    enabled: boolean;
    formatName: string;
    delimiter: string;
    fields: AutoCardFieldDefinition[];
    instructions: string;
    lowStockThreshold: number;
}

const defaultDraft: ConfigDraft = {
    enabled: true,
    ...presets.accountPassword,
    instructions: '',
    lowStockThreshold: 5,
};

export const autoCardRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'catalog',
        id: 'auto-card-delivery',
        url: '/auto-card',
        title: messages.title.id,
        icon: KeyRound,
        requiresPermission: ['UpdateCatalog'],
    },
    path: '/auto-card',
    loader: () => ({ breadcrumb: () => messages.title.id }),
    component: () => <AutoCardPage />,
};

function AutoCardPage() {
    const { t } = useLingui();
    const text = Object.fromEntries(
        Object.entries(messages).map(([key, value]) => [key, t(value)]),
    ) as Record<keyof typeof messages, string>;
    const { activeChannel } = useChannel();
    const [search, setSearch] = useState('');
    const [selectedVariantId, setSelectedVariantId] = useState(
        () => new URLSearchParams(window.location.search).get('variantId') ?? '',
    );
    const [draft, setDraft] = useState<ConfigDraft>(defaultDraft);
    const [importText, setImportText] = useState('');
    const [preview, setPreview] = useState<null | {
        validCount: number;
        invalidCount: number;
        rows: Array<{ lineNumber: number; fields: Array<AutoCardFieldDefinition & { value: string }> }>;
        errors: Array<{ lineNumber: number; message: string }>;
    }>(null);
    const [revealed, setRevealed] = useState<Array<AutoCardFieldDefinition & { value: string }> | null>(null);

    const variantsQuery = useQuery({
        queryKey: ['auto-card-variants', activeChannel?.id, search],
        queryFn: () =>
            api.query<{ productVariants: { items: AutoCardVariantRecord[]; totalItems: number } }>(
                autoCardVariantsQuery,
                {
                    options: {
                        take: 50,
                        filterOperator: 'OR',
                        ...(search.trim()
                            ? {
                                  filter: {
                                      name: { contains: search.trim() },
                                      sku: { contains: search.trim() },
                                  },
                              }
                            : {}),
                    },
                },
            ),
        enabled: Boolean(activeChannel?.id),
    });
    const variants = variantsQuery.data?.productVariants.items ?? [];
    const todoQuery = useQuery({
        queryKey: ['auto-card-todo-summary', activeChannel?.id],
        queryFn: () =>
            api.query<{ autoCardTodoSummary: AutoCardTodoSummaryRecord }>(autoCardTodoSummaryQuery),
        enabled: Boolean(activeChannel?.id),
        refetchInterval: 60_000,
    });

    const workspaceQuery = useQuery({
        queryKey: ['auto-card-workspace', activeChannel?.id, selectedVariantId],
        queryFn: () =>
            api.query<AutoCardWorkspaceResult>(autoCardWorkspaceQuery, {
                productVariantId: selectedVariantId,
                poolOptions: { take: 50 },
            }),
        enabled: Boolean(activeChannel?.id && selectedVariantId),
    });
    const config = workspaceQuery.data?.autoCardConfig ?? null;
    const poolItems = workspaceQuery.data?.autoCardPoolItems.items ?? [];
    const deliveries = workspaceQuery.data?.autoCardDeliveries.items ?? [];

    useEffect(() => {
        if (!selectedVariantId) return;
        const url = new URL(window.location.href);
        url.searchParams.set('variantId', selectedVariantId);
        window.history.replaceState({}, '', url);
    }, [selectedVariantId]);

    useEffect(() => {
        setDraft(config ? draftFromConfig(config) : defaultDraft);
        setPreview(null);
        setImportText('');
    }, [config, selectedVariantId]);

    const updateConfig = useMutation({
        mutationFn: () =>
            api.mutate(updateAutoCardConfigMutation, {
                input: { productVariantId: selectedVariantId, ...draft },
            }),
        onSuccess: async () => {
            toast.success(text.saved);
            await workspaceQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const previewImport = useMutation({
        mutationFn: () =>
            api.mutate<{ previewAutoCardPoolImport: NonNullable<typeof preview> }>(
                previewAutoCardPoolImportMutation,
                { input: { productVariantId: selectedVariantId, rawText: importText } },
            ),
        onSuccess: result => setPreview(result.previewAutoCardPoolImport),
        onError: error => toast.error(errorMessage(error)),
    });
    const importPool = useMutation({
        mutationFn: () =>
            api.mutate<{ importAutoCardPoolItems: { importedCount: number; duplicateCount: number } }>(
                importAutoCardPoolItemsMutation,
                { input: { productVariantId: selectedVariantId, rawText: importText } },
            ),
        onSuccess: async result => {
            toast.success(`${text.imported}: ${result.importAutoCardPoolItems.importedCount}`);
            setImportText('');
            setPreview(null);
            await workspaceQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const revealPoolItem = useMutation({
        mutationFn: (id: string) =>
            api.mutate<{ revealAutoCardPoolItem: Array<AutoCardFieldDefinition & { value: string }> }>(
                revealAutoCardPoolItemMutation,
                { id },
            ),
        onSuccess: result => setRevealed(result.revealAutoCardPoolItem),
        onError: error => toast.error(errorMessage(error)),
    });
    const togglePoolItem = useMutation({
        mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
            api.mutate(setAutoCardPoolItemEnabledMutation, { id, enabled, reason: '管理后台操作' }),
        onSuccess: async () => workspaceQuery.refetch(),
        onError: error => toast.error(errorMessage(error)),
    });
    const retryDelivery = useMutation({
        mutationFn: (id: string) => api.mutate(retryAutoCardDeliveryMutation, { id }),
        onSuccess: async () => workspaceQuery.refetch(),
        onError: error => toast.error(errorMessage(error)),
    });

    const stats = useMemo(
        () => [
            { label: text.available, value: config?.availableCount ?? 0, tone: 'success' },
            { label: text.assigned, value: config?.assignedCount ?? 0, tone: 'neutral' },
            { label: text.disabled, value: config?.disabledCount ?? 0, tone: 'neutral' },
            { label: text.waiting, value: config?.waitingDeliveryCount ?? 0, tone: 'warning' },
        ],
        [config, text],
    );

    return (
        <Page pageId="auto-card-delivery">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        variant="outline"
                        onClick={() => void workspaceQuery.refetch()}
                        disabled={!selectedVariantId}
                    >
                        <RefreshCw className="size-4" aria-hidden="true" />
                        {text.refresh}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="auto-card-sku-selector"
                    title={text.selectSku}
                    description={text.description}
                >
                    <div className="grid gap-3 md:grid-cols-[minmax(16rem,0.7fr)_minmax(20rem,1fr)]">
                        <Input
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder={text.searchSku}
                        />
                        <Select
                            value={selectedVariantId}
                            onValueChange={value => setSelectedVariantId(value ?? '')}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder={text.selectSku} />
                            </SelectTrigger>
                            <SelectContent>
                                {variants.map(variant => (
                                    <SelectItem key={variant.id} value={variant.id}>
                                        {variant.name} · {variant.sku}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </PageBlock>

                {!selectedVariantId ? (
                    <PageBlock column="full" blockId="auto-card-empty">
                        <div className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-3">
                            <AlertStat
                                label={text.lowStockSkus}
                                value={todoQuery.data?.autoCardTodoSummary.lowStockSkuCount ?? 0}
                            />
                            <AlertStat
                                label={text.waiting}
                                value={todoQuery.data?.autoCardTodoSummary.waitingStockDeliveryCount ?? 0}
                            />
                            <AlertStat
                                label={text.manualReview}
                                value={todoQuery.data?.autoCardTodoSummary.manualReviewCount ?? 0}
                            />
                        </div>
                        <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                            <KeyRound className="size-9" aria-hidden="true" />
                            <p>{text.noSku}</p>
                        </div>
                    </PageBlock>
                ) : workspaceQuery.isLoading ? (
                    <PageBlock column="full" blockId="auto-card-loading">
                        <div className="space-y-3">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-40 w-full" />
                        </div>
                    </PageBlock>
                ) : workspaceQuery.error ? (
                    <PageBlock column="full" blockId="auto-card-error">
                        <Alert variant="destructive">
                            <AlertDescription>
                                {text.loadError}: {errorMessage(workspaceQuery.error)}
                            </AlertDescription>
                        </Alert>
                    </PageBlock>
                ) : (
                    <>
                        <PageBlock
                            column="main"
                            blockId="auto-card-settings"
                            title={text.settings}
                            description={text.settingsDescription}
                        >
                            <ConfigEditor text={text} draft={draft} onChange={setDraft} />
                            <div className="mt-5 flex justify-end">
                                <Button
                                    onClick={() => updateConfig.mutate()}
                                    disabled={updateConfig.isPending || !selectedVariantId}
                                >
                                    <Save className="size-4" aria-hidden="true" />
                                    {text.save}
                                </Button>
                            </div>
                        </PageBlock>

                        <PageBlock column="side" blockId="auto-card-inventory" title={text.inventory}>
                            <div className="grid grid-cols-2 gap-3">
                                {stats.map(stat => {
                                    const warningTone =
                                        stat.tone === 'warning' && stat.value
                                            ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20'
                                            : 'bg-muted/30';
                                    return (
                                        <div
                                            key={stat.label}
                                            className={`rounded-lg border p-3 ${warningTone}`}
                                        >
                                            <div className="text-sm text-muted-foreground">{stat.label}</div>
                                            <div className="mt-1 text-2xl font-semibold tabular-nums">
                                                {stat.value}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {config && config.availableCount <= config.lowStockThreshold && (
                                <Alert className="mt-4">
                                    <AlertTriangle className="size-4" />
                                    <AlertDescription>
                                        {text.lowStock}: {config.lowStockThreshold}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </PageBlock>

                        <PageBlock
                            column="full"
                            blockId="auto-card-import"
                            title={text.importTitle}
                            description={text.importDescription}
                        >
                            {!config ? (
                                <Alert>
                                    <AlertDescription>{text.configFirst}</AlertDescription>
                                </Alert>
                            ) : (
                                <div className="space-y-4">
                                    <Textarea
                                        value={importText}
                                        onChange={event => {
                                            setImportText(event.target.value);
                                            setPreview(null);
                                        }}
                                        rows={8}
                                        className="font-mono text-sm"
                                        placeholder={exampleForDraft(draft)}
                                    />
                                    <div className="flex flex-wrap justify-end gap-2">
                                        <Button
                                            variant="outline"
                                            onClick={() => previewImport.mutate()}
                                            disabled={!importText.trim() || previewImport.isPending}
                                        >
                                            <Eye className="size-4" aria-hidden="true" />
                                            {text.preview}
                                        </Button>
                                        <Button
                                            onClick={() => importPool.mutate()}
                                            disabled={
                                                !preview?.validCount ||
                                                Boolean(preview.invalidCount) ||
                                                importPool.isPending
                                            }
                                        >
                                            <Upload className="size-4" aria-hidden="true" />
                                            {text.import}
                                        </Button>
                                    </div>
                                    {preview && <ImportPreview text={text} preview={preview} />}
                                </div>
                            )}
                        </PageBlock>

                        <PageBlock
                            column="full"
                            blockId="auto-card-pool"
                            title={`${text.pool} (${workspaceQuery.data?.autoCardPoolItems.totalItems ?? 0})`}
                        >
                            <PoolTable
                                text={text}
                                items={poolItems}
                                onReveal={id => revealPoolItem.mutate(id)}
                                onToggle={(id, enabled) => togglePoolItem.mutate({ id, enabled })}
                            />
                        </PageBlock>

                        <PageBlock
                            column="full"
                            blockId="auto-card-deliveries"
                            title={`${text.deliveries} (${workspaceQuery.data?.autoCardDeliveries.totalItems ?? 0})`}
                        >
                            <DeliveryTable
                                text={text}
                                deliveries={deliveries}
                                onRetry={id => retryDelivery.mutate(id)}
                            />
                        </PageBlock>
                    </>
                )}
            </PageLayout>

            <Dialog open={Boolean(revealed)} onOpenChange={open => !open && setRevealed(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{text.revealTitle}</DialogTitle>
                        <DialogDescription>{text.revealWarning}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        {revealed?.map(field => (
                            <div
                                key={field.key}
                                className="grid grid-cols-[8rem_1fr] gap-3 rounded-md border p-3"
                            >
                                <span className="text-sm text-muted-foreground">{field.label}</span>
                                <code className="break-all text-sm">{field.value}</code>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </Page>
    );
}

function ConfigEditor({
    text,
    draft,
    onChange,
}: {
    text: Record<keyof typeof messages, string>;
    draft: ConfigDraft;
    onChange: (value: ConfigDraft) => void;
}) {
    const applyPreset = (key: string | null) => {
        if (!key || key === 'custom') return;
        const preset = presets[key];
        if (preset) onChange({ ...draft, ...preset, fields: preset.fields.map(field => ({ ...field })) });
    };
    const updateField = (index: number, patch: Partial<AutoCardFieldDefinition>) => {
        const fields = draft.fields.map((field, fieldIndex) =>
            fieldIndex === index ? { ...field, ...patch } : field,
        );
        onChange({ ...draft, fields });
    };
    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/40 p-4">
                <div>
                    <div className="font-medium">{text.enabled}</div>
                    <div className="text-sm text-muted-foreground">
                        {draft.enabled ? '付款后自动按顺序发卡' : '暂停新订单发卡'}
                    </div>
                </div>
                <Switch
                    checked={draft.enabled}
                    onCheckedChange={enabled => onChange({ ...draft, enabled })}
                />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label>{text.formatPreset}</Label>
                    <Select defaultValue="custom" onValueChange={applyPreset}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="accountPassword">账号 + 密码</SelectItem>
                            <SelectItem value="emailPassword">邮箱 + 邮箱密码</SelectItem>
                            <SelectItem value="accountPhone2fa">账号 + 密码 + 手机 + 2FA</SelectItem>
                            <SelectItem value="custom">自定义</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>{text.formatName}</Label>
                    <Input
                        value={draft.formatName}
                        onChange={event => onChange({ ...draft, formatName: event.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>{text.delimiter}</Label>
                    <Input
                        value={draft.delimiter}
                        onChange={event => onChange({ ...draft, delimiter: event.target.value })}
                        placeholder="----"
                    />
                </div>
                <div className="space-y-2">
                    <Label>{text.lowStock}</Label>
                    <Input
                        type="number"
                        min={0}
                        value={draft.lowStockThreshold}
                        onChange={event =>
                            onChange({ ...draft, lowStockThreshold: Number(event.target.value) })
                        }
                    />
                </div>
            </div>
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <Label>{text.fields}</Label>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                            onChange({
                                ...draft,
                                fields: [
                                    ...draft.fields,
                                    {
                                        key: `field${draft.fields.length + 1}`,
                                        label: `字段${draft.fields.length + 1}`,
                                        secret: false,
                                    },
                                ],
                            })
                        }
                    >
                        <Plus className="size-4" />
                        {text.addField}
                    </Button>
                </div>
                {draft.fields.map((field, index) => (
                    <div
                        key={`${index}-${field.key}`}
                        className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
                    >
                        <div className="space-y-1">
                            <Label>{text.fieldKey}</Label>
                            <Input
                                value={field.key}
                                onChange={event => updateField(index, { key: event.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>{text.fieldLabel}</Label>
                            <Input
                                value={field.label}
                                onChange={event => updateField(index, { label: event.target.value })}
                            />
                        </div>
                        <div className="flex h-9 items-center gap-2">
                            <Switch
                                checked={field.secret}
                                onCheckedChange={secret => updateField(index, { secret })}
                            />
                            <span className="text-sm">{text.secret}</span>
                        </div>
                        <Button
                            size="icon"
                            variant="ghost"
                            disabled={draft.fields.length === 1}
                            onClick={() =>
                                onChange({
                                    ...draft,
                                    fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index),
                                })
                            }
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </div>
                ))}
            </div>
            <div className="space-y-2">
                <Label>{text.instructions}</Label>
                <Textarea
                    rows={5}
                    value={draft.instructions}
                    onChange={event => onChange({ ...draft, instructions: event.target.value })}
                />
                <p className="text-xs text-muted-foreground">{text.instructionsHint}</p>
            </div>
        </div>
    );
}

function ImportPreview({
    text,
    preview,
}: {
    text: Record<keyof typeof messages, string>;
    preview: {
        validCount: number;
        invalidCount: number;
        rows: Array<{ lineNumber: number; fields: Array<AutoCardFieldDefinition & { value: string }> }>;
        errors: Array<{ lineNumber: number; message: string }>;
    };
}) {
    return (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="flex gap-3">
                <Badge variant="secondary">
                    {text.validRows}: {preview.validCount}
                </Badge>
                <Badge variant={preview.invalidCount ? 'destructive' : 'secondary'}>
                    {text.invalidRows}: {preview.invalidCount}
                </Badge>
            </div>
            {preview.errors.length > 0 && (
                <Alert variant="destructive">
                    <AlertDescription>
                        {preview.errors
                            .map(error => `第 ${error.lineNumber} 行：${error.message}`)
                            .join('\n')}
                    </AlertDescription>
                </Alert>
            )}
            <div className="space-y-2">
                {preview.rows.slice(0, 5).map(row => (
                    <div key={row.lineNumber} className="flex flex-wrap gap-2 text-sm">
                        <span className="text-muted-foreground">#{row.lineNumber}</span>
                        {row.fields.map(field => (
                            <code key={field.key} className="rounded bg-background px-2 py-1">
                                {field.label}: {field.value}
                            </code>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function PoolTable({
    text,
    items,
    onReveal,
    onToggle,
}: {
    text: Record<keyof typeof messages, string>;
    items: AutoCardPoolItemRecord[];
    onReveal: (id: string) => void;
    onToggle: (id: string, enabled: boolean) => void;
}) {
    if (!items.length) return <p className="py-8 text-center text-sm text-muted-foreground">{text.noPool}</p>;
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{text.sequence}</TableHead>
                        <TableHead>{text.content}</TableHead>
                        <TableHead>{text.status}</TableHead>
                        <TableHead>{text.action}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {items.map(item => (
                        <TableRow key={item.id}>
                            <TableCell className="tabular-nums">#{item.sequence}</TableCell>
                            <TableCell>
                                <div className="flex flex-wrap gap-1">
                                    {item.maskedFields.map(field => (
                                        <code key={field.key} className="rounded bg-muted px-2 py-1 text-xs">
                                            {field.label}: {field.value}
                                        </code>
                                    ))}
                                </div>
                            </TableCell>
                            <TableCell>
                                <StatusBadge state={item.state} />
                            </TableCell>
                            <TableCell>
                                <div className="flex gap-1">
                                    <Button size="sm" variant="ghost" onClick={() => onReveal(item.id)}>
                                        <Eye className="size-4" />
                                        {text.reveal}
                                    </Button>
                                    {item.state !== 'ASSIGNED' && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => onToggle(item.id, item.state === 'DISABLED')}
                                        >
                                            {item.state === 'DISABLED' ? text.restore : text.stop}
                                        </Button>
                                    )}
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function DeliveryTable({
    text,
    deliveries,
    onRetry,
}: {
    text: Record<keyof typeof messages, string>;
    deliveries: AutoCardDeliveryRecord[];
    onRetry: (id: string) => void;
}) {
    if (!deliveries.length)
        return <p className="py-8 text-center text-sm text-muted-foreground">{text.noDeliveries}</p>;
    return (
        <div className="overflow-x-auto">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>{text.order}</TableHead>
                        <TableHead>{text.recipient}</TableHead>
                        <TableHead>{text.status}</TableHead>
                        <TableHead>{text.attempts}</TableHead>
                        <TableHead>{text.action}</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {deliveries.map(delivery => (
                        <TableRow key={delivery.id}>
                            <TableCell>
                                <a
                                    className="font-medium text-primary hover:underline"
                                    href={`/dashboard/orders/${delivery.order.id}`}
                                >
                                    #{delivery.order.code}
                                </a>
                                <div className="text-xs text-muted-foreground">
                                    {delivery.productName} × {delivery.quantity}
                                </div>
                            </TableCell>
                            <TableCell>{delivery.recipientEmail}</TableCell>
                            <TableCell>
                                <StatusBadge state={delivery.state} />
                                {delivery.lastError && (
                                    <div className="mt-1 max-w-64 text-xs text-destructive">
                                        {delivery.lastError}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="tabular-nums">{delivery.attemptCount}</TableCell>
                            <TableCell>
                                <Button size="sm" variant="outline" onClick={() => onRetry(delivery.id)}>
                                    <RotateCcw className="size-4" />
                                    {text.retry}
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

function StatusBadge({ state }: { state: string }) {
    const variant = ['WAITING_STOCK', 'MANUAL_REVIEW'].includes(state)
        ? 'destructive'
        : state === 'SENT' || state === 'AVAILABLE'
          ? 'secondary'
          : 'outline';
    return <Badge variant={variant}>{stateLabel(state)}</Badge>;
}

function AlertStat({ label, value }: { label: string; value: number }) {
    return (
        <div
            className={`rounded-lg border p-4 ${value ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20' : 'bg-muted/30'}`}
        >
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
        </div>
    );
}

function stateLabel(state: string): string {
    const labels: Record<string, string> = {
        AVAILABLE: '可用',
        ASSIGNED: '已分配',
        DISABLED: '已停用',
        WAITING_STOCK: '等待补货',
        ALLOCATED: '已取号',
        RETRYING: '发送重试中',
        SENT: '已发卡',
        MANUAL_REVIEW: '待人工处理',
    };
    return labels[state] ?? state;
}

function draftFromConfig(config: AutoCardConfigRecord): ConfigDraft {
    return {
        enabled: config.enabled,
        formatName: config.formatName,
        delimiter: config.delimiter === '\t' ? '\\t' : config.delimiter,
        fields: config.fields.map(field => ({ ...field })),
        instructions: config.instructions,
        lowStockThreshold: config.lowStockThreshold,
    };
}

function exampleForDraft(draft: ConfigDraft): string {
    const delimiter = draft.delimiter === '\\t' ? '\t' : draft.delimiter || '----';
    return draft.fields.map(field => `${field.label}1`).join(delimiter);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
