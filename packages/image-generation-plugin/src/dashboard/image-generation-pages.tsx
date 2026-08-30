import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
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
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Switch,
    Tabs,
    TabsList,
    TabsTrigger,
    Textarea,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
} from '@vendure/dashboard';
import {
    Archive,
    Image,
    KeyRound,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    Save,
    Search,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    ImageAdminConfigRecord,
    ImageAdminModelRecord,
    ImageAdminOperationsQueryResult,
    ImageAdminQueryResult,
    ImageAiUsageRecordDetailQueryResult,
    ImageAiUsageRecordsQueryResult,
    ImageProviderAdminConfigRecord,
    ImageProviderAdminQueryResult,
    activateImageSkillMutation,
    archiveImageProviderMutation,
    imageAiUsageRecordDetailQuery,
    imageAiUsageRecordsQuery,
    imageGenerationAdminQuery,
    imageGenerationOperationsQuery,
    imageProviderAdminQuery,
    reconcileStaleImageOutputsMutation,
    refundImageOutputMutation,
    retryImageOutputMutation,
    saveImageCredentialMutation,
    saveImageGenerationConfigMutation,
    saveImageModelMutation,
    smokeTestImageModelMutation,
    testImageModelMutation,
    testImageProviderMutation,
} from './image-generation.graphql';
import { imageProtocolOption, imageProtocolOptionsForModel } from './image-protocol-options';

export const imageGenerationSettingsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'settings',
        id: 'image-generation-settings',
        url: '/image-generation-settings',
        title: 'AI 生图服务',
        icon: Image,
        order: 42,
        requiresPermission: ['ReadImageGeneration'],
    },
    path: '/image-generation-settings',
    loader: () => ({ breadcrumb: () => 'AI 生图服务' }),
    component: () => <ImageGenerationSettingsPage />,
};

export const imageGenerationAccessRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'image-generation-access',
        url: '/image-generation-access',
        title: 'AI 服务接入',
        icon: KeyRound,
        order: 42,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/image-generation-access',
    loader: () => ({ breadcrumb: () => 'AI 服务接入' }),
    component: () => <ImageGenerationAccessPage />,
};

function useImageAdminQuery(channelId?: string, autoRefresh = false) {
    return useQuery({
        queryKey: ['image-generation-admin', channelId],
        queryFn: () => api.query<ImageAdminQueryResult>(imageGenerationAdminQuery),
        enabled: Boolean(channelId),
        refetchInterval: autoRefresh ? 5_000 : false,
    });
}

function ImageGenerationSettingsPage() {
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const canUpdate = hasPermissions(['UpdateImageGeneration']);
    const [activeTab, setActiveTab] = useState('base');
    const [historyView, setHistoryView] = useState<'usage' | 'prompts' | 'generation'>('usage');
    const query = useImageAdminQuery(activeChannel?.id, activeTab === 'jobs' && historyView === 'generation');
    const config = query.data?.imageGenerationAdminConfig;
    const [draft, setDraft] = useState<ImageAdminConfigRecord | null>(null);
    const draftRef = useRef<ImageAdminConfigRecord | null>(null);
    const baselineRef = useRef<ImageAdminConfigRecord | null>(null);
    const draftChannelRef = useRef<string | undefined>(undefined);
    const [usageSearch, setUsageSearch] = useState('');
    const [usageState, setUsageState] = useState('');
    const [usageBilling, setUsageBilling] = useState('');
    const [usageFrom, setUsageFrom] = useState('');
    const [usageTo, setUsageTo] = useState('');
    const [usageModel, setUsageModel] = useState('');
    const [usageKey, setUsageKey] = useState('');
    const [usageType, setUsageType] = useState('');
    const [usageFailuresOnly, setUsageFailuresOnly] = useState(false);
    const [usageMissingCostOnly, setUsageMissingCostOnly] = useState(false);
    const [jobSearch, setJobSearch] = useState('');
    const [jobState, setJobState] = useState('');
    const [jobBilling, setJobBilling] = useState('');
    const [jobFrom, setJobFrom] = useState('');
    const [usagePage, setUsagePage] = useState(0);
    const [selectedUsage, setSelectedUsage] = useState<{ recordType: string; id: string } | null>(null);
    const operationsQuery = useQuery({
        queryKey: ['image-generation-operations', activeChannel?.id, activeTab, historyView],
        enabled:
            Boolean(activeChannel?.id) &&
            (activeTab === 'prompts' || activeTab === 'jobs' || activeTab === 'costs'),
        queryFn: () =>
            api.query<ImageAdminOperationsQueryResult>(imageGenerationOperationsQuery, {
                includeJobs: activeTab === 'jobs' && historyView === 'generation',
                includeCosts: activeTab === 'costs',
                includeSkills: activeTab === 'prompts',
                includePromptAudit: activeTab === 'jobs' && historyView === 'prompts',
            }),
    });
    useEffect(() => {
        setUsagePage(0);
    }, [
        usageSearch,
        usageState,
        usageBilling,
        usageFrom,
        usageTo,
        usageModel,
        usageKey,
        usageType,
        usageFailuresOnly,
        usageMissingCostOnly,
    ]);
    const usageQuery = useQuery({
        queryKey: [
            'image-ai-usage-records',
            activeChannel?.id,
            usageSearch,
            usageState,
            usageBilling,
            usageFrom,
            usageTo,
            usageModel,
            usageKey,
            usageType,
            usageFailuresOnly,
            usageMissingCostOnly,
            usagePage,
        ],
        enabled: activeTab === 'jobs' && historyView === 'usage',
        refetchInterval: 5_000,
        queryFn: () =>
            api.query<ImageAiUsageRecordsQueryResult>(imageAiUsageRecordsQuery, {
                input: {
                    skip: usagePage * 50,
                    take: 50,
                    customer: usageSearch || null,
                    state: usageState || null,
                    billingMode: usageBilling || null,
                    from: toLocalDayBoundary(usageFrom, false),
                    to: toLocalDayBoundary(usageTo, true),
                    modelCode: usageModel || null,
                    credentialCode: usageKey || null,
                    recordType: usageType || null,
                    failuresOnly: usageFailuresOnly,
                    missingCostOnly: usageMissingCostOnly,
                },
            }),
    });
    const usageDetailQuery = useQuery({
        queryKey: ['image-ai-usage-record', activeChannel?.id, selectedUsage?.recordType, selectedUsage?.id],
        enabled: activeTab === 'jobs' && historyView === 'usage' && selectedUsage != null,
        refetchInterval: 5_000,
        queryFn: () =>
            api.query<ImageAiUsageRecordDetailQueryResult>(imageAiUsageRecordDetailQuery, {
                recordType: selectedUsage?.recordType,
                id: selectedUsage?.id,
            }),
    });
    useEffect(() => {
        if (!config) return;
        const incoming = structuredClone(config);
        const channelChanged = draftChannelRef.current !== activeChannel?.id;
        const next = channelChanged
            ? incoming
            : reconcileImageAdminConfig(draftRef.current, baselineRef.current, incoming);
        baselineRef.current = incoming;
        draftRef.current = next;
        draftChannelRef.current = activeChannel?.id;
        setDraft(next);
    }, [activeChannel?.id, config]);
    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    const applySavedModel = (savedModel: ImageAdminModelRecord) => {
        if (baselineRef.current) {
            baselineRef.current = replaceAdminModel(baselineRef.current, savedModel);
        }
        setDraft(current => {
            const next = current ? replaceAdminModel(current, savedModel) : current;
            draftRef.current = next;
            return next;
        });
    };
    const commitConfig = (savedConfig: ImageAdminConfigRecord) => {
        const next = structuredClone(savedConfig);
        baselineRef.current = next;
        draftRef.current = next;
        setDraft(next);
    };

    const saveConfig = useMutation({
        mutationFn: (value: ImageAdminConfigRecord) =>
            api.mutate<{ saveImageGenerationConfig: ImageAdminConfigRecord }>(
                saveImageGenerationConfigMutation,
                {
                    input: {
                        enabled: value.enabled,
                        promptOptimizationEnabled: value.promptOptimizationEnabled,
                        promptRateLimitPerMinute: value.promptRateLimitPerMinute,
                        promptDailyFreeLimit: value.promptDailyFreeLimit,
                        promptDailyFreeUnlimited: value.promptDailyFreeUnlimited,
                        paidPromptOptimizationEnabled: value.paidPromptOptimizationEnabled,
                        paidPromptOptimizationPrice: value.paidPromptOptimizationPrice,
                        paidPromptOptimizationCurrencyCode: value.paidPromptOptimizationCurrencyCode,
                        defaultModelCode: value.defaultModelCode,
                        termsVersion: value.termsVersion,
                        termsZh: value.termsZh,
                        termsEn: value.termsEn,
                        models: value.models.map(modelInput),
                    },
                },
            ),
        onSuccess: result => {
            commitConfig(result.saveImageGenerationConfig);
            toast.success('AI 生图配置已保存');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const saveModel = useMutation({
        mutationFn: (model: ImageAdminModelRecord) =>
            api.mutate<{ saveImageModel: ImageAdminModelRecord }>(saveImageModelMutation, {
                input: modelInput(model),
            }),
        onSuccess: result => {
            applySavedModel(result.saveImageModel);
            toast.success('模型设置已保存');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const testModel = useMutation({
        mutationFn: async (model: ImageAdminModelRecord) => {
            const saved = await api.mutate<{ saveImageModel: ImageAdminModelRecord }>(
                saveImageModelMutation,
                { input: modelInput(model) },
            );
            const tested = await api.mutate<{ testImageModel: { ok: boolean; message: string } }>(
                testImageModelMutation,
                { code: model.code },
            );
            return { savedModel: saved.saveImageModel, test: tested.testImageModel };
        },
        onSuccess: result => {
            applySavedModel(result.savedModel);
            (result.test.ok ? toast.success : toast.error)(result.test.message);
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const smokeTestModel = useMutation({
        mutationFn: async (model: ImageAdminModelRecord) => {
            const saved = await api.mutate<{ saveImageModel: ImageAdminModelRecord }>(
                saveImageModelMutation,
                { input: modelInput(model) },
            );
            const tested = await api.mutate<{
                smokeTestImageModel: {
                    ok: boolean;
                    message: string;
                    actualCostMicrounits?: number | null;
                    costCurrency?: string | null;
                };
            }>(smokeTestImageModelMutation, { code: model.code });
            return { savedModel: saved.saveImageModel, test: tested.smokeTestImageModel };
        },
        onSuccess: result => {
            applySavedModel(result.savedModel);
            const test = result.test;
            const cost =
                test.actualCostMicrounits == null
                    ? ''
                    : ` · 上游返回成本 ${(test.actualCostMicrounits / 1_000_000).toFixed(6)} ${test.costCurrency ?? ''}`;
            (test.ok ? toast.success : toast.error)(`${test.message}${cost}`);
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const activateSkill = useMutation({
        mutationFn: (id: string) => api.mutate(activateImageSkillMutation, { id }),
        onSuccess: () => {
            toast.success('已设为当前提示词规则版本');
            void query.refetch();
            void operationsQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const retryOutput = useMutation({
        mutationFn: (outputId: string) => api.mutate(retryImageOutputMutation, { outputId }),
        onSuccess: () => {
            void operationsQuery.refetch();
            void usageQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const reconcileStaleOutputs = useMutation({
        mutationFn: () =>
            api.mutate<{ reconcileStaleImageGenerationOutputs: number }>(
                reconcileStaleImageOutputsMutation,
                {},
            ),
        onSuccess: result => {
            const count = result.reconcileStaleImageGenerationOutputs;
            if (count > 0) toast.success(`已处理 ${count} 个超时结果，并释放对应费用`);
            else toast.success('核对完成，当前没有超过 15 分钟的待确认任务');
            void query.refetch();
            void usageQuery.refetch();
            if (selectedUsage) void usageDetailQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const refundOutput = useMutation({
        mutationFn: ({ outputId, reason }: { outputId: string; reason: string }) =>
            api.mutate(refundImageOutputMutation, { outputId, reason }),
        onSuccess: () => {
            toast.success('本张图片费用已退回返利余额');
            void operationsQuery.refetch();
            void usageQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    if (query.isLoading) return <LoadingPage title="AI 生图服务" />;
    if (query.error)
        return <ErrorPage title="AI 生图服务" retry={() => void query.refetch()} error={query.error} />;
    if (!draft || !query.data) return <LoadingPage title="AI 生图服务" />;
    if (operationsQuery.isLoading) return <LoadingPage title="AI 生图服务" />;
    if (operationsQuery.error)
        return (
            <ErrorPage
                title="AI 生图服务"
                retry={() => void operationsQuery.refetch()}
                error={operationsQuery.error}
            />
        );
    const data = {
        ...query.data,
        imageGenerationJobs: operationsQuery.data?.imageGenerationJobs ?? { items: [], totalItems: 0 },
        imageGenerationCostSummary: operationsQuery.data?.imageGenerationCostSummary ?? {
            from: '',
            to: '',
            truncated: false,
            items: [],
        },
        imagePromptSkillReleases: operationsQuery.data?.imagePromptSkillReleases ?? [],
        imagePromptOptimizationAudit: operationsQuery.data?.imagePromptOptimizationAudit ?? {
            items: [],
            totalItems: 0,
        },
    };
    const isDirty = !sameAdminConfig(draft, baselineRef.current);
    const activeSkillRelease = data.imagePromptSkillReleases.find(release => release.status === 'ACTIVE');
    const filteredJobs = data.imageGenerationJobs.items.filter(job => {
        const search = jobSearch.trim().toLowerCase();
        const matchesSearch =
            !search ||
            [
                job.customer.firstName,
                job.customer.lastName,
                job.customer.emailAddress,
                job.customer.id,
                job.modelNameSnapshot,
                job.providerCredentialNameSnapshot,
                job.providerCredentialCodeSnapshot,
            ].some(value => String(value).toLowerCase().includes(search));
        const matchesState = !jobState || job.state === jobState;
        const matchesBilling =
            !jobBilling ||
            (jobBilling === 'FREE' ? job.freeQuantityCaptured > 0 : job.paidQuantityReserved > 0);
        const jobFromBoundary = toLocalDayBoundary(jobFrom, false);
        const matchesFrom =
            !jobFromBoundary || new Date(job.createdAt).getTime() >= new Date(jobFromBoundary).getTime();
        return matchesSearch && matchesState && matchesBilling && matchesFrom;
    });

    const updateModel = (code: string, values: Partial<ImageAdminModelRecord>) => {
        setDraft({
            ...draft,
            models: draft.models.map(model => (model.code === code ? { ...model, ...values } : model)),
        });
    };
    const setDefaultModel = (code: string) => {
        setDraft({
            ...draft,
            defaultModelCode: code,
            models: draft.models.map(model => ({ ...model, isDefault: model.code === code })),
        });
    };
    return (
        <Page pageId="image-generation-settings">
            <PageTitle>AI 生图服务</PageTitle>
            <UnsavedChangesConfirmation when={isDirty} />
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        disabled={!canUpdate || !isDirty || saveConfig.isPending}
                        onClick={() => saveConfig.mutate(draft)}
                    >
                        <Save className="mr-2 h-4 w-4" />
                        保存全部设置
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            {!canUpdate ? (
                <Alert className="mb-4">
                    <AlertDescription>
                        当前账号只有查看权限。修改配置、模型测试、任务重试和退款需要“更新 AI 生图”权限。
                    </AlertDescription>
                </Alert>
            ) : null}
            <PageLayout>
                <PageBlock column="full" blockId="image-navigation">
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 md:grid-cols-5">
                            <TabsTrigger value="base">基础设置</TabsTrigger>
                            <TabsTrigger value="models">模型与价格</TabsTrigger>
                            <TabsTrigger value="prompts">提示词规则</TabsTrigger>
                            <TabsTrigger value="jobs">任务记录</TabsTrigger>
                            <TabsTrigger value="costs">成本与用量</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </PageBlock>
                {activeTab === 'base' ? (
                    <PageBlock
                        column="full"
                        blockId="image-base"
                        title="基础设置"
                        description="客户从返利余额按成功生成的图片数量和原生清晰度付费，支持 1–4 张和一张参考图。"
                    >
                        <fieldset disabled={!canUpdate} className="contents">
                            {!draft.credentialEnabled ? (
                                <Alert>
                                    <AlertDescription>
                                        平台中转站尚未启用，客户端不会开放生图。
                                    </AlertDescription>
                                </Alert>
                            ) : null}
                            <div className="grid gap-5 md:grid-cols-2">
                                <Toggle
                                    label="启用 AI 图片工坊"
                                    checked={draft.enabled}
                                    onChange={enabled => setDraft({ ...draft, enabled })}
                                />
                                <Toggle
                                    label="启用提示词优化"
                                    checked={draft.promptOptimizationEnabled}
                                    onChange={promptOptimizationEnabled =>
                                        setDraft({ ...draft, promptOptimizationEnabled })
                                    }
                                />
                                <Field label="默认模型">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={draft.defaultModelCode}
                                        onChange={event => setDefaultModel(event.target.value)}
                                    >
                                        {draft.models.map(model => (
                                            <option key={model.code} value={model.code}>
                                                {model.displayNameZh} · {model.officialModelId}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="条款版本">
                                    <Input
                                        value={draft.termsVersion}
                                        onChange={event =>
                                            setDraft({ ...draft, termsVersion: event.target.value })
                                        }
                                    />
                                </Field>
                                <Field label="中文服务条款">
                                    <Textarea
                                        rows={5}
                                        value={draft.termsZh}
                                        onChange={event =>
                                            setDraft({ ...draft, termsZh: event.target.value })
                                        }
                                    />
                                </Field>
                                <Field label="英文服务条款">
                                    <Textarea
                                        rows={5}
                                        value={draft.termsEn}
                                        onChange={event =>
                                            setDraft({ ...draft, termsEn: event.target.value })
                                        }
                                    />
                                </Field>
                            </div>
                        </fieldset>
                    </PageBlock>
                ) : null}

                {activeTab === 'models' ? (
                    <PageBlock
                        column="full"
                        blockId="image-models"
                        title="模型与单张价格"
                        description="友好名称、用途说明和官方模型 ID 会展示给客户。只读测试不生图；真实生图测试可能产生上游费用。健康状态会持续有效，直到修改连接配置或检测到真实故障。"
                    >
                        <fieldset disabled={!canUpdate} className="contents">
                            <Alert className="mb-4">
                                <AlertDescription>
                                    你当前使用订阅号中转：Codex 图片选“Codex 订阅号中转”，Gemini 图片选“Gemini
                                    订阅号中转”。带“高级”的选项只在中转站文档明确要求时使用。
                                </AlertDescription>
                            </Alert>
                            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
                                {draft.models.map(model => (
                                    <div key={model.code} className="space-y-3 rounded-lg border p-4">
                                        <div className="flex items-center justify-between">
                                            <strong>{model.displayNameZh}</strong>
                                            <Badge>{statusZh(model.healthStatus)}</Badge>
                                        </div>
                                        <div className="text-xs text-muted-foreground">
                                            官方 ID：{model.officialModelId}
                                        </div>
                                        {model.healthMessage ? (
                                            <div className="text-xs text-muted-foreground">
                                                {model.healthMessage}
                                                {model.lastTestedAt
                                                    ? ` · ${new Date(model.lastTestedAt).toLocaleString()}`
                                                    : ''}
                                            </div>
                                        ) : null}
                                        <Toggle
                                            label="启用模型"
                                            checked={model.enabled}
                                            onChange={enabled => updateModel(model.code, { enabled })}
                                        />
                                        <Field label="中文名称">
                                            <Input
                                                value={model.displayNameZh}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        displayNameZh: event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="英文名称">
                                            <Input
                                                value={model.displayNameEn}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        displayNameEn: event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="中文用途说明">
                                            <Textarea
                                                rows={3}
                                                value={model.descriptionZh}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        descriptionZh: event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="英文用途说明">
                                            <Textarea
                                                rows={3}
                                                value={model.descriptionEn}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        descriptionEn: event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="中转站模型 ID">
                                            <Input
                                                value={model.providerModelId}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        providerModelId: event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="中转站调用方式">
                                            <select
                                                className="h-9 w-full rounded-md border bg-background px-3"
                                                value={model.protocol}
                                                onChange={event =>
                                                    updateModel(
                                                        model.code,
                                                        protocolChange(model, event.target.value),
                                                    )
                                                }
                                            >
                                                <optgroup label="推荐方式">
                                                    {imageProtocolOptionsForModel(model)
                                                        .filter(option => option.recommended)
                                                        .map(option => (
                                                            <option key={option.value} value={option.value}>
                                                                {option.label}
                                                            </option>
                                                        ))}
                                                </optgroup>
                                                <optgroup label="高级兼容方式（仅按中转站说明选择）">
                                                    {imageProtocolOptionsForModel(model)
                                                        .filter(option => !option.recommended)
                                                        .map(option => (
                                                            <option key={option.value} value={option.value}>
                                                                {option.label}
                                                            </option>
                                                        ))}
                                                </optgroup>
                                            </select>
                                            <p className="text-xs leading-5 text-muted-foreground">
                                                当前模型：{model.providerModelId || model.officialModelId}
                                            </p>
                                            <p className="text-xs leading-5 text-muted-foreground">
                                                {imageProtocolOption(model.protocol).description}
                                            </p>
                                        </Field>
                                        <div className="grid gap-3 sm:grid-cols-3">
                                            {(
                                                [
                                                    ['1K', 'unitPrice'],
                                                    ['2K', 'unitPrice2K'],
                                                    ['4K', 'unitPrice4K'],
                                                ] as const
                                            ).map(([resolution, priceField]) => {
                                                const supported = modelSupportsResolution(model, resolution);
                                                return (
                                                    <Field
                                                        key={resolution}
                                                        label={`${resolution} 单张价格（${model.currencyCode}）`}
                                                    >
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            disabled={!supported}
                                                            value={minorToMajor(
                                                                model[priceField],
                                                                model.currencyCode,
                                                            )}
                                                            onChange={event =>
                                                                updateModel(model.code, {
                                                                    [priceField]: majorToMinor(
                                                                        event.target.value,
                                                                        model.currencyCode,
                                                                    ),
                                                                })
                                                            }
                                                        />
                                                        {!supported ? (
                                                            <span className="text-xs text-muted-foreground">
                                                                当前模型/协议不支持原生 {resolution}
                                                            </span>
                                                        ) : resolution !== '1K' ? (
                                                            <span className="text-xs text-muted-foreground">
                                                                价格设为 0 时客户端不开放该档
                                                            </span>
                                                        ) : null}
                                                    </Field>
                                                );
                                            })}
                                        </div>
                                        <Toggle
                                            label="设为默认"
                                            checked={model.isDefault}
                                            onChange={isDefault => {
                                                if (isDefault) setDefaultModel(model.code);
                                                else if (draft.defaultModelCode !== model.code)
                                                    updateModel(model.code, { isDefault: false });
                                            }}
                                        />
                                        <Toggle
                                            label="中转站保证幂等"
                                            checked={model.supportsIdempotency}
                                            onChange={supportsIdempotency =>
                                                updateModel(model.code, { supportsIdempotency })
                                            }
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            仅在中转站明确保证同一幂等键不会重复生图时开启。
                                        </p>
                                        <Toggle
                                            label="启用每日免费生图"
                                            checked={model.freeImageEnabled}
                                            onChange={freeImageEnabled =>
                                                updateModel(model.code, { freeImageEnabled })
                                            }
                                        />
                                        <Field label="每位客户每天免费张数">
                                            <Input
                                                type="number"
                                                min="0"
                                                value={model.dailyFreeImageLimit}
                                                disabled={model.dailyFreeImageUnlimited}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        dailyFreeImageLimit: Number(event.target.value) || 0,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Toggle
                                            label="免费生图不限次数"
                                            checked={model.dailyFreeImageUnlimited}
                                            onChange={dailyFreeImageUnlimited =>
                                                updateModel(model.code, {
                                                    dailyFreeImageUnlimited,
                                                    dailyFreeImageLimit: dailyFreeImageUnlimited
                                                        ? 0
                                                        : model.dailyFreeImageLimit,
                                                })
                                            }
                                        />
                                        <Toggle
                                            label="免费用完后允许付费"
                                            checked={model.paidAfterFreeEnabled}
                                            onChange={paidAfterFreeEnabled =>
                                                updateModel(model.code, { paidAfterFreeEnabled })
                                            }
                                        />
                                        <Field label="每位客户每日生图安全上限">
                                            <Input
                                                type="number"
                                                min="1"
                                                value={model.dailyGenerationSafetyLimit}
                                                onChange={event =>
                                                    updateModel(model.code, {
                                                        dailyGenerationSafetyLimit:
                                                            Number(event.target.value) || 1,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            <Button
                                                variant="outline"
                                                disabled={
                                                    saveModel.isPending ||
                                                    testModel.isPending ||
                                                    smokeTestModel.isPending
                                                }
                                                onClick={() => saveModel.mutate(model)}
                                            >
                                                保存模型
                                            </Button>
                                            <Button
                                                variant="outline"
                                                disabled={
                                                    saveModel.isPending ||
                                                    testModel.isPending ||
                                                    smokeTestModel.isPending
                                                }
                                                onClick={() => testModel.mutate(model)}
                                            >
                                                <RefreshCw className="mr-2 h-4 w-4" />
                                                只读测试
                                            </Button>
                                            <Button
                                                variant="outline"
                                                disabled={
                                                    saveModel.isPending ||
                                                    testModel.isPending ||
                                                    smokeTestModel.isPending
                                                }
                                                onClick={() => {
                                                    if (
                                                        window.confirm(
                                                            '将真实生成 1 张简单测试图，中转站可能收费。是否继续？',
                                                        )
                                                    )
                                                        smokeTestModel.mutate(model);
                                                }}
                                            >
                                                付费生图测试
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </fieldset>
                    </PageBlock>
                ) : null}

                {activeTab === 'costs' ? (
                    <PageBlock
                        column="full"
                        blockId="image-cost-audit"
                        title="近 30 天成本对账"
                        description="销售额是成功图的原始售价合计（未减人工退款）；上游成本仅在中转站返回费用字段时可对账，不同币种不自动换算。"
                    >
                        {data.imageGenerationCostSummary.truncated ? (
                            <Alert className="mb-3">
                                <AlertDescription>记录超过 20,000 条，当前仅展示截断统计。</AlertDescription>
                            </Alert>
                        ) : null}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left">
                                        <th className="p-2">模型</th>
                                        <th>请求/成功</th>
                                        <th>重试/未知/失败</th>
                                        <th>原始销售额</th>
                                        <th>上游成本</th>
                                        <th>缺失成本</th>
                                        <th>平均耗时</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.imageGenerationCostSummary.items.map(item => (
                                        <tr
                                            key={`${item.modelCode}:${item.saleCurrencyCode}:${item.costCurrency}`}
                                            className="border-b"
                                        >
                                            <td className="p-2">
                                                {item.modelCode}
                                                <div className="text-xs text-muted-foreground">
                                                    {item.providerScope}
                                                </div>
                                            </td>
                                            <td>
                                                {item.attempts} / {item.successes}
                                            </td>
                                            <td>
                                                {item.retries} / {item.unknowns} / {item.failures}
                                            </td>
                                            <td>
                                                {minorToMajor(item.grossRevenue, item.saleCurrencyCode)}{' '}
                                                {item.saleCurrencyCode}
                                            </td>
                                            <td>
                                                {item.actualCost.toFixed(6)} {item.costCurrency}
                                            </td>
                                            <td>{item.missingCostCount}</td>
                                            {/* i18n-audit-ignore -- Fixed latency unit. */}
                                            <td>{item.averageLatencyMs}ms</td>
                                        </tr>
                                    ))}
                                    {!data.imageGenerationCostSummary.items.length ? (
                                        <tr>
                                            <td className="p-4 text-muted-foreground" colSpan={7}>
                                                暂无真实生图成本记录。
                                            </td>
                                        </tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </div>
                    </PageBlock>
                ) : null}

                {activeTab === 'prompts' ? (
                    <PageBlock
                        column="full"
                        blockId="image-skills"
                        title="提示词规划 Skill"
                        description="把客户的简短想法整理成可执行的生图方案，并自动推荐更合适的模型。"
                    >
                        <fieldset disabled={!canUpdate} className="contents">
                            <Alert className="mb-4">
                                <AlertDescription>
                                    当前运行的是本站维护的 <strong>image-prompt-pro</strong>
                                    ，不会在线下载或直接执行某个 GitHub
                                    Skill；公开项目只作为设计与许可来源参考，实际版本以本地发布哈希为准，GitHub
                                    Star 数不参与自动选用或升级。
                                    <strong>全站同时只能启用 1 个规则包。</strong>
                                    当前版本会自动用于后续的“智能优化”和模型推荐；切换历史版本时，系统会自动停用旧版本。已经完成或正在执行的任务仍保留原规则哈希，不会被改写。
                                    当前升级方式：
                                    <strong>
                                        {draft.skillAutoActivateEnabled
                                            ? '新规则包随代码部署后自动启用'
                                            : '新规则包登记后由管理员手动启用'}
                                    </strong>
                                    。
                                </AlertDescription>
                            </Alert>
                            <div className="mb-6 grid gap-4 lg:grid-cols-3">
                                <div className="rounded-lg border p-4">
                                    <strong>结构化提示词规划</strong>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        自动补齐主体、场景、构图、光线、风格、颜色、材质、精确文字、保留项和避免项，客户仍可在生成前继续修改。
                                    </p>
                                </div>
                                <div className="rounded-lg border p-4">
                                    <strong>按任务自动选模型</strong>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        复杂文字与版式优先 Codex 图片 2，精细编辑与抠图优先
                                        1.5，日常商品图优先 1，快速试稿和插画优先 Gemini。
                                    </p>
                                </div>
                                <div className="rounded-lg border p-4">
                                    <strong>忠实与安全约束</strong>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                        保留客户指定的文字、人物、商品和参考图要求；不凭空编造品牌、价格、促销、认证、Logo、功效或商品声明。
                                    </p>
                                </div>
                            </div>
                            {activeSkillRelease ? (
                                <div className="mb-6 rounded-lg border bg-muted/30 p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <strong>当前发布：{skillReleaseName(activeSkillRelease)}</strong>
                                        <Badge variant="success">全站唯一启用</Badge>
                                        <Badge variant="secondary">
                                            规则格式 v{activeSkillRelease.bundleVersion}
                                        </Badge>
                                        <Badge variant="outline">
                                            {routingStrategyZh(activeSkillRelease.routingStrategy)}路由
                                        </Badge>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {activeSkillRelease.supportedUseCases.map(useCase => (
                                            <Badge key={useCase} variant="secondary">
                                                {skillUseCaseZh(useCase)}
                                            </Badge>
                                        ))}
                                    </div>
                                    <p className="mt-3 text-xs text-muted-foreground">
                                        当前规则哈希：
                                        <span className="font-mono">{draft.activeSkillHash}</span>
                                    </p>
                                </div>
                            ) : null}
                            <div className="mb-3">
                                <strong>调用额度与收费</strong>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    这些设置控制客户每天可以使用多少次提示词优化，不影响生图次数和模型单价。
                                </p>
                            </div>
                            <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <Field label="每分钟最多优化次数">
                                    <Input
                                        type="number"
                                        min="1"
                                        value={draft.promptRateLimitPerMinute}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                promptRateLimitPerMinute: Number(event.target.value) || 1,
                                            })
                                        }
                                    />
                                </Field>
                                <Field label="每天免费优化次数">
                                    <Input
                                        type="number"
                                        min="0"
                                        disabled={draft.promptDailyFreeUnlimited}
                                        value={draft.promptDailyFreeLimit}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                promptDailyFreeLimit: Number(event.target.value) || 0,
                                            })
                                        }
                                    />
                                </Field>
                                <Toggle
                                    label="免费优化不限次数"
                                    checked={draft.promptDailyFreeUnlimited}
                                    onChange={promptDailyFreeUnlimited =>
                                        setDraft({
                                            ...draft,
                                            promptDailyFreeUnlimited,
                                            promptDailyFreeLimit: promptDailyFreeUnlimited
                                                ? 0
                                                : draft.promptDailyFreeLimit,
                                        })
                                    }
                                />
                                <Toggle
                                    label="免费用完后允许付费优化"
                                    checked={draft.paidPromptOptimizationEnabled}
                                    onChange={paidPromptOptimizationEnabled =>
                                        setDraft({ ...draft, paidPromptOptimizationEnabled })
                                    }
                                />
                                <Field
                                    label={`付费优化单次价格（${draft.paidPromptOptimizationCurrencyCode}）`}
                                >
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={minorToMajor(
                                            draft.paidPromptOptimizationPrice,
                                            draft.paidPromptOptimizationCurrencyCode,
                                        )}
                                        onChange={event =>
                                            setDraft({
                                                ...draft,
                                                paidPromptOptimizationPrice: majorToMinor(
                                                    event.target.value,
                                                    draft.paidPromptOptimizationCurrencyCode,
                                                ),
                                            })
                                        }
                                    />
                                </Field>
                            </div>
                            <div className="mb-3">
                                <strong>规则包历史</strong>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    新任务只使用标记为“当前使用”的版本。历史备用版本不会参与运行，除非手动切换。
                                </p>
                            </div>
                            <div className="space-y-3">
                                {data.imagePromptSkillReleases.map(release => (
                                    <div key={release.id} className="rounded-lg border p-4">
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <strong>{skillReleaseName(release)}</strong>
                                                    <Badge
                                                        variant={
                                                            release.status === 'ACTIVE'
                                                                ? 'success'
                                                                : 'secondary'
                                                        }
                                                    >
                                                        {release.status === 'ACTIVE'
                                                            ? '当前使用'
                                                            : '历史备用'}
                                                    </Badge>
                                                    <Badge variant="outline">
                                                        规则格式 v{release.bundleVersion}
                                                    </Badge>
                                                </div>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    创建于 {new Date(release.createdAt).toLocaleString()}
                                                    {release.activatedAt
                                                        ? ` · 最近启用于 ${new Date(release.activatedAt).toLocaleString()}`
                                                        : ''}
                                                </p>
                                            </div>
                                            {release.status !== 'ACTIVE' ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={activateSkill.isPending}
                                                    onClick={() => activateSkill.mutate(release.id)}
                                                >
                                                    设为当前版本
                                                </Button>
                                            ) : null}
                                        </div>
                                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                                            <div>
                                                <div className="text-xs text-muted-foreground">支持场景</div>
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {release.supportedUseCases.map(useCase => (
                                                        <Badge key={useCase} variant="outline">
                                                            {skillUseCaseZh(useCase)}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground">
                                                    可推荐模型
                                                </div>
                                                <p className="mt-2 text-sm">
                                                    {release.supportedModels.join('、') || '未记录'}
                                                </p>
                                            </div>
                                            <div>
                                                <div className="text-xs text-muted-foreground">路由策略</div>
                                                <p className="mt-2 text-sm">
                                                    {routingStrategyZh(release.routingStrategy)}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="mt-4 break-all font-mono text-xs text-muted-foreground">
                                            SHA-256：{release.sourceHash}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </fieldset>
                    </PageBlock>
                ) : null}

                {activeTab === 'jobs' ? (
                    <>
                        <PageBlock
                            column="full"
                            blockId="history-navigation"
                            title="记录分类"
                            description="按记录用途分开查看，每次只展示一张数据表。"
                        >
                            <Tabs
                                value={historyView}
                                onValueChange={value => {
                                    setHistoryView(value as typeof historyView);
                                    setSelectedUsage(null);
                                }}
                            >
                                <TabsList
                                    className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3"
                                    aria-label="任务记录类型"
                                >
                                    <TabsTrigger value="usage">AI 使用总览</TabsTrigger>
                                    <TabsTrigger value="prompts">提示词优化</TabsTrigger>
                                    <TabsTrigger value="generation">图片生成任务</TabsTrigger>
                                </TabsList>
                            </Tabs>
                        </PageBlock>
                        <PageBlock
                            column="full"
                            blockId="unified-ai-usage"
                            className={historyView === 'usage' ? undefined : 'hidden'}
                            title={`AI 使用记录（共 ${usageQuery.data?.imageAiUsageRecords.totalItems ?? 0}）`}
                            description="统一记录提示词优化和图片生成；筛选在服务端执行，不受当前页面已加载数量影响。"
                        >
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                                <p className="text-sm text-muted-foreground">
                                    状态每 5 秒自动刷新；结果待确认超过 15 分钟后会自动失败并释放本张费用。
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={query.isFetching || usageQuery.isFetching}
                                        onClick={() => {
                                            void query.refetch();
                                            void usageQuery.refetch();
                                            if (selectedUsage) void usageDetailQuery.refetch();
                                        }}
                                    >
                                        <RefreshCw
                                            className={`mr-2 h-4 w-4 ${query.isFetching || usageQuery.isFetching ? 'animate-spin' : ''}`}
                                        />
                                        刷新状态
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={reconcileStaleOutputs.isPending}
                                        onClick={() => reconcileStaleOutputs.mutate()}
                                    >
                                        {reconcileStaleOutputs.isPending ? (
                                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                        )}
                                        核对超时任务
                                    </Button>
                                </div>
                            </div>
                            <div className="mb-5 grid gap-3 rounded-lg bg-muted/30 p-4 md:grid-cols-2 xl:grid-cols-4">
                                <Field label="客户">
                                    <Input
                                        placeholder="姓名、邮箱或客户 ID"
                                        value={usageSearch}
                                        onChange={event => setUsageSearch(event.target.value)}
                                    />
                                </Field>
                                <Field label="记录类型">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={usageType}
                                        onChange={event => setUsageType(event.target.value)}
                                    >
                                        <option value="">提示词和生图</option>
                                        <option value="PROMPT_OPTIMIZATION">提示词优化</option>
                                        <option value="IMAGE_GENERATION">图片生成</option>
                                    </select>
                                </Field>
                                <Field label="模型编码">
                                    <Input
                                        placeholder="精确模型编码"
                                        value={usageModel}
                                        onChange={event => setUsageModel(event.target.value)}
                                    />
                                </Field>
                                <Field label="Key 编码">
                                    <Input
                                        placeholder="稳定 Key 编码"
                                        value={usageKey}
                                        onChange={event => setUsageKey(event.target.value)}
                                    />
                                </Field>
                                <Field label="状态">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={usageState}
                                        onChange={event => setUsageState(event.target.value)}
                                    >
                                        <option value="">全部状态</option>
                                        {[
                                            'PENDING',
                                            'QUEUED',
                                            'RUNNING',
                                            'PARTIAL_SUCCESS',
                                            'SUCCEEDED',
                                            'FAILED',
                                            'UNKNOWN',
                                            'CANCELLED',
                                        ].map(value => (
                                            <option key={value} value={value}>
                                                {statusZh(value)}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="计费类型">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={usageBilling}
                                        onChange={event => setUsageBilling(event.target.value)}
                                    >
                                        <option value="">全部计费</option>
                                        <option value="FREE">免费</option>
                                        <option value="PAID">付费</option>
                                        <option value="MIXED">免费+付费</option>
                                        <option value="REFUNDED">已退款</option>
                                    </select>
                                </Field>
                                <Field label="开始日期">
                                    <Input
                                        type="date"
                                        value={usageFrom}
                                        onChange={event => setUsageFrom(event.target.value)}
                                    />
                                </Field>
                                <Field label="结束日期">
                                    <Input
                                        type="date"
                                        value={usageTo}
                                        onChange={event => setUsageTo(event.target.value)}
                                    />
                                </Field>
                                <Toggle
                                    label="仅失败/待确认记录"
                                    checked={usageFailuresOnly}
                                    onChange={setUsageFailuresOnly}
                                />
                                <Toggle
                                    label="仅上游成本缺失"
                                    checked={usageMissingCostOnly}
                                    onChange={setUsageMissingCostOnly}
                                />
                            </div>
                            {usageQuery.isLoading ? <Skeleton className="h-40 w-full" /> : null}
                            {usageQuery.error ? (
                                <Alert>
                                    <AlertDescription>{errorMessage(usageQuery.error)}</AlertDescription>
                                </Alert>
                            ) : null}
                            {usageQuery.data ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[72rem] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-3">
                                        <thead>
                                            <tr className="border-b text-left">
                                                <th className="p-2">时间/类型</th>
                                                <th>客户/Channel</th>
                                                <th>模型/Key</th>
                                                <th>状态</th>
                                                <th>免费/付费</th>
                                                <th>客户收入/退回</th>
                                                <th>上游成本</th>
                                                <th>操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {usageQuery.data.imageAiUsageRecords.items.map(item => (
                                                <tr
                                                    key={`${item.recordType}:${item.id}`}
                                                    className="border-b align-top"
                                                >
                                                    <td className="p-2">
                                                        {new Date(item.createdAt).toLocaleString()}
                                                        <div className="text-xs text-muted-foreground">
                                                            {item.recordType === 'PROMPT_OPTIMIZATION'
                                                                ? '提示词优化'
                                                                : '图片生成'}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {item.customer.firstName} {item.customer.lastName}
                                                        <div className="text-xs text-muted-foreground">
                                                            {item.customer.emailAddress}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            ID {item.customer.id} · Channel {item.channelId}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {item.modelCode}
                                                        <div className="text-xs text-muted-foreground">
                                                            {item.credentialName || '无上游 Key'}
                                                            {item.credentialLast4
                                                                ? ` · 尾号 ${item.credentialLast4}`
                                                                : ''}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <Badge>{statusZh(item.state)}</Badge>
                                                        {item.errorMessage ? (
                                                            <div className="max-w-48 text-xs text-destructive">
                                                                {item.errorMessage}
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                    <td>
                                                        {billingModeZh(item.billingMode)}
                                                        <div className="text-xs text-muted-foreground">
                                                            免费 {item.freeQuantity} · 付费{' '}
                                                            {item.paidQuantity}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        {minorToMajor(item.chargedAmount, item.currencyCode)}{' '}
                                                        /{' '}
                                                        {minorToMajor(item.refundedAmount, item.currencyCode)}{' '}
                                                        {item.currencyCode}
                                                    </td>
                                                    <td>
                                                        {item.actualCostMicrounits == null
                                                            ? '缺失'
                                                            : `${(item.actualCostMicrounits / 1_000_000).toFixed(6)} ${item.costCurrency ?? ''}`}
                                                        {item.missingCost ? (
                                                            <div className="text-xs text-destructive">
                                                                存在缺失成本
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                    <td>
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() =>
                                                                setSelectedUsage({
                                                                    recordType: item.recordType,
                                                                    id: item.id,
                                                                })
                                                            }
                                                        >
                                                            查看详情
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {!usageQuery.data.imageAiUsageRecords.items.length ? (
                                                <tr>
                                                    <td className="p-4 text-muted-foreground" colSpan={8}>
                                                        没有符合筛选条件的 AI 使用记录。
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </tbody>
                                    </table>
                                </div>
                            ) : null}
                            {usageQuery.data && usageQuery.data.imageAiUsageRecords.totalItems > 50 ? (
                                <div className="mt-4 flex items-center justify-between gap-3">
                                    <Button
                                        variant="outline"
                                        disabled={usagePage === 0}
                                        onClick={() => setUsagePage(page => Math.max(0, page - 1))}
                                    >
                                        上一页
                                    </Button>
                                    <span className="text-sm text-muted-foreground">
                                        第 {usagePage + 1} /{' '}
                                        {Math.ceil(usageQuery.data.imageAiUsageRecords.totalItems / 50)} 页
                                    </span>
                                    <Button
                                        variant="outline"
                                        disabled={
                                            (usagePage + 1) * 50 >=
                                            usageQuery.data.imageAiUsageRecords.totalItems
                                        }
                                        onClick={() => setUsagePage(page => page + 1)}
                                    >
                                        下一页
                                    </Button>
                                </div>
                            ) : null}
                        </PageBlock>
                        {historyView === 'usage' && selectedUsage ? (
                            <PageBlock column="full" blockId="ai-usage-detail-sheet" className="hidden">
                                <Sheet open onOpenChange={open => !open && setSelectedUsage(null)}>
                                    <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[880px] sm:max-w-[880px]">
                                        <SheetHeader className="border-b px-6 py-5 text-left">
                                            <SheetTitle>AI 使用记录详情</SheetTitle>
                                            <SheetDescription>
                                                查看完整提示词、上游请求信息和计费状态时间线。
                                            </SheetDescription>
                                        </SheetHeader>
                                        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                                            {usageDetailQuery.isLoading ? (
                                                <Skeleton className="h-48 w-full" />
                                            ) : null}
                                            {usageDetailQuery.error ? (
                                                <Alert>
                                                    <AlertDescription>
                                                        {errorMessage(usageDetailQuery.error)}
                                                    </AlertDescription>
                                                </Alert>
                                            ) : null}
                                            {usageDetailQuery.data ? (
                                                <div className="space-y-5">
                                                    <div className="flex flex-wrap items-center gap-2 rounded border p-3 text-sm">
                                                        <Badge>
                                                            {statusZh(
                                                                usageDetailQuery.data.imageAiUsageRecord
                                                                    .record.state,
                                                            )}
                                                        </Badge>
                                                        <span>
                                                            {
                                                                usageDetailQuery.data.imageAiUsageRecord
                                                                    .record.modelCode
                                                            }
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                            {new Date(
                                                                usageDetailQuery.data.imageAiUsageRecord
                                                                    .record.createdAt,
                                                            ).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <div className="rounded border p-3">
                                                            <strong>原始提示词</strong>
                                                            <div className="mt-2 whitespace-pre-wrap break-words">
                                                                {
                                                                    usageDetailQuery.data.imageAiUsageRecord
                                                                        .inputPrompt
                                                                }
                                                            </div>
                                                        </div>
                                                        <div className="rounded border p-3">
                                                            <strong>优化/最终提示词</strong>
                                                            <div className="mt-2 whitespace-pre-wrap break-words">
                                                                {usageDetailQuery.data.imageAiUsageRecord
                                                                    .outputPrompt || '—'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-sm text-muted-foreground">
                                                        Token：
                                                        {usageDetailQuery.data.imageAiUsageRecord
                                                            .totalTokens ?? '—'}{' '}
                                                        · 上游请求 ID：
                                                        {usageDetailQuery.data.imageAiUsageRecord.providerRequestIds.join(
                                                            '、',
                                                        ) || '—'}
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="border-b text-left">
                                                                    <th className="p-2">时间</th>
                                                                    <th>阶段</th>
                                                                    <th>状态</th>
                                                                    <th>额度/金额</th>
                                                                    <th>Key</th>
                                                                    <th>说明</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {usageDetailQuery.data.imageAiUsageRecord.timeline.map(
                                                                    (event, index) => (
                                                                        <tr
                                                                            key={`${event.at}:${event.stage}:${index}`}
                                                                            className="border-b align-top"
                                                                        >
                                                                            <td className="p-2">
                                                                                {new Date(
                                                                                    event.at,
                                                                                ).toLocaleString()}
                                                                            </td>
                                                                            <td>{event.stage}</td>
                                                                            <td>{event.status}</td>
                                                                            <td>
                                                                                {event.amount == null
                                                                                    ? '—'
                                                                                    : `${event.amount}${event.currencyCode ? ` ${event.currencyCode}` : ''}`}
                                                                                {event.costMicrounits ==
                                                                                null ? null : (
                                                                                    <div className="text-xs text-muted-foreground">
                                                                                        上游成本{' '}
                                                                                        {(
                                                                                            event.costMicrounits /
                                                                                            1_000_000
                                                                                        ).toFixed(6)}
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            <td>
                                                                                {event.keyName || '—'}
                                                                                {event.keyLast4
                                                                                    ? ` · 尾号 ${event.keyLast4}`
                                                                                    : ''}
                                                                            </td>
                                                                            <td className="max-w-md break-words">
                                                                                {event.message}
                                                                            </td>
                                                                        </tr>
                                                                    ),
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                        <SheetFooter className="border-t px-6 py-4">
                                            <Button variant="outline" onClick={() => setSelectedUsage(null)}>
                                                关闭
                                            </Button>
                                        </SheetFooter>
                                    </SheetContent>
                                </Sheet>
                            </PageBlock>
                        ) : null}
                        <PageBlock
                            column="full"
                            blockId="prompt-audit"
                            className={historyView === 'prompts' ? undefined : 'hidden'}
                            title={`提示词优化记录（共 ${data.imagePromptOptimizationAudit.totalItems}）`}
                            description="完整提示词仅具备 AI 审计权限的管理员可见；客户前台删除任务不会删除该审计记录。"
                        >
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[60rem] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-3">
                                    <thead>
                                        <tr className="border-b text-left">
                                            <th className="p-2">时间/客户</th>
                                            <th>输入与结果</th>
                                            <th>模型/Key</th>
                                            <th>免费/付费</th>
                                            <th>Token/成本</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.imagePromptOptimizationAudit.items.map(item => (
                                            <tr key={item.id} className="border-b align-top">
                                                <td className="p-2">
                                                    {new Date(item.createdAt).toLocaleString()}
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.customer.firstName} {item.customer.lastName} ·{' '}
                                                        {item.customer.emailAddress}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        客户 ID {item.customer.id} · Channel {item.channelId}
                                                    </div>
                                                </td>
                                                <td className="max-w-md p-2">
                                                    <details>
                                                        <summary className="cursor-pointer">
                                                            查看完整提示词
                                                        </summary>
                                                        <div className="mt-2 whitespace-pre-wrap break-words">
                                                            <strong>原文：</strong>
                                                            {item.inputPrompt}
                                                            <br />
                                                            <strong>优化：</strong>
                                                            {item.optimizedPrompt}
                                                        </div>
                                                    </details>
                                                </td>
                                                <td>
                                                    {item.optimizerModelId || '本地规则'}
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.credentialNameSnapshot || '无上游 Key'}
                                                        {item.credentialLast4Snapshot
                                                            ? ` · 尾号 ${item.credentialLast4Snapshot}`
                                                            : ''}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        调用 {item.upstreamCallCount} 次 · {item.latencyMs}ms
                                                    </div>
                                                    {item.errorMessage ? (
                                                        <div className="text-xs text-destructive">
                                                            {item.errorMessage}
                                                        </div>
                                                    ) : null}
                                                </td>
                                                <td>
                                                    {billingModeZh(item.billingMode)}
                                                    <div className="text-xs text-muted-foreground">
                                                        {minorToMajor(item.chargedAmount, item.currencyCode)}{' '}
                                                        {item.currencyCode}
                                                    </div>
                                                </td>
                                                <td>
                                                    {item.inputTokens ?? '—'} / {item.outputTokens ?? '—'} /{' '}
                                                    {item.totalTokens ?? '—'}
                                                    <div className="text-xs text-muted-foreground">
                                                        {item.actualCostMicrounits == null
                                                            ? '上游成本缺失'
                                                            : `${(item.actualCostMicrounits / 1_000_000).toFixed(6)} ${item.costCurrency ?? ''}`}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {!data.imagePromptOptimizationAudit.items.length ? (
                                            <tr>
                                                <td className="p-4 text-muted-foreground" colSpan={5}>
                                                    暂无提示词优化记录。
                                                </td>
                                            </tr>
                                        ) : null}
                                    </tbody>
                                </table>
                            </div>
                        </PageBlock>
                        <PageBlock
                            column="full"
                            blockId="image-jobs"
                            className={historyView === 'generation' ? undefined : 'hidden'}
                            title={`任务记录（共 ${data.imageGenerationJobs.totalItems}）`}
                            description="UNKNOWN 不会自动重复生成；15 分钟后自动退回，或由管理员确认后使用同一幂等键重试。"
                        >
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                                <p className="text-sm text-muted-foreground">
                                    任务状态每 5 秒自动刷新；超时待确认任务会在 15 分钟后安全释放费用。
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={query.isFetching}
                                        onClick={() => void query.refetch()}
                                    >
                                        <RefreshCw
                                            className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`}
                                        />
                                        刷新状态
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={reconcileStaleOutputs.isPending}
                                        onClick={() => reconcileStaleOutputs.mutate()}
                                    >
                                        {reconcileStaleOutputs.isPending ? (
                                            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                        )}
                                        核对超时任务
                                    </Button>
                                </div>
                            </div>
                            <div className="mb-5 grid gap-3 rounded-lg bg-muted/30 p-4 md:grid-cols-2 xl:grid-cols-4">
                                <Field label="客户/模型/Key">
                                    <Input
                                        placeholder="姓名、邮箱、ID、模型或 Key"
                                        value={jobSearch}
                                        onChange={event => setJobSearch(event.target.value)}
                                    />
                                </Field>
                                <Field label="任务状态">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={jobState}
                                        onChange={event => setJobState(event.target.value)}
                                    >
                                        <option value="">全部状态</option>
                                        {[
                                            'QUEUED',
                                            'RUNNING',
                                            'PARTIAL_SUCCESS',
                                            'SUCCEEDED',
                                            'FAILED',
                                            'UNKNOWN',
                                            'CANCELLED',
                                        ].map(value => (
                                            <option key={value} value={value}>
                                                {statusZh(value)}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="计费类型">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={jobBilling}
                                        onChange={event => setJobBilling(event.target.value)}
                                    >
                                        <option value="">免费与付费</option>
                                        <option value="FREE">含免费额度</option>
                                        <option value="PAID">含付费结算</option>
                                    </select>
                                </Field>
                                <Field label="开始日期">
                                    <Input
                                        type="date"
                                        value={jobFrom}
                                        onChange={event => setJobFrom(event.target.value)}
                                    />
                                </Field>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[72rem] text-sm [&_td]:px-3 [&_td]:py-3 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-3">
                                    <thead>
                                        <tr className="border-b text-left">
                                            <th className="p-2">时间</th>
                                            <th>客户</th>
                                            <th>模型</th>
                                            <th>Key</th>
                                            <th>状态</th>
                                            <th>免费/付费</th>
                                            <th>扣费/退回</th>
                                            <th>每张结果</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredJobs.map(job => (
                                            <tr key={job.id} className="border-b align-top">
                                                <td className="p-2">
                                                    {new Date(job.createdAt).toLocaleString()}
                                                </td>
                                                <td>
                                                    {job.customer.firstName} {job.customer.lastName}
                                                    <div className="text-xs text-muted-foreground">
                                                        {job.customer.emailAddress} · ID {job.customer.id}
                                                    </div>
                                                </td>
                                                <td>
                                                    {job.modelNameSnapshot}
                                                    <div className="text-xs text-muted-foreground">
                                                        {job.officialModelIdSnapshot}
                                                    </div>
                                                </td>
                                                <td>
                                                    {job.providerCredentialNameSnapshot || '历史主 Key'}
                                                    <div className="text-xs text-muted-foreground">
                                                        {job.providerCredentialCodeSnapshot ||
                                                            job.providerScopeSnapshot}
                                                        {job.providerCredentialLast4Snapshot
                                                            ? ` · 尾号 ${job.providerCredentialLast4Snapshot}`
                                                            : ''}
                                                    </div>
                                                </td>
                                                <td>
                                                    <Badge>{statusZh(job.state)}</Badge>
                                                </td>
                                                <td>
                                                    免费 {job.freeQuantityCaptured}/{job.freeQuantityReserved}{' '}
                                                    张
                                                    <div className="text-xs text-muted-foreground">
                                                        付费预留 {job.paidQuantityReserved} 张
                                                    </div>
                                                </td>
                                                <td>
                                                    {minorToMajor(job.capturedAmount, job.currencyCode)} /{' '}
                                                    {minorToMajor(job.releasedAmount, job.currencyCode)}{' '}
                                                    {job.currencyCode}
                                                </td>
                                                <td className="space-y-1 py-2">
                                                    {job.outputs.map(output => (
                                                        <div
                                                            key={output.id}
                                                            className="flex items-center gap-2"
                                                        >
                                                            <span>
                                                                #{output.outputIndex + 1}{' '}
                                                                {statusZh(output.state)} ·{' '}
                                                                {billingModeZh(output.billingMode)}
                                                                {output.refundedAt ? ' · 已退款' : ''}
                                                            </span>
                                                            {output.state === 'UNKNOWN' ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    disabled={
                                                                        !canUpdate || retryOutput.isPending
                                                                    }
                                                                    onClick={() =>
                                                                        retryOutput.mutate(output.id)
                                                                    }
                                                                >
                                                                    确认重试
                                                                </Button>
                                                            ) : null}
                                                            {output.state === 'SUCCEEDED' &&
                                                            !output.refundedAt ? (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    disabled={
                                                                        !canUpdate || refundOutput.isPending
                                                                    }
                                                                    onClick={() => {
                                                                        const reason =
                                                                            window.prompt('请输入退款原因');
                                                                        if (reason?.trim())
                                                                            refundOutput.mutate({
                                                                                outputId: output.id,
                                                                                reason,
                                                                            });
                                                                    }}
                                                                >
                                                                    退款
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    ))}
                                                </td>
                                            </tr>
                                        ))}
                                        {!filteredJobs.length ? (
                                            <tr>
                                                <td className="p-4 text-muted-foreground" colSpan={8}>
                                                    没有符合筛选条件的任务。
                                                </td>
                                            </tr>
                                        ) : null}
                                    </tbody>
                                </table>
                            </div>
                        </PageBlock>
                    </>
                ) : null}
            </PageLayout>
        </Page>
    );
}

export function ImageGenerationAccessPage() {
    const [selectedCredential, setSelectedCredential] = useState<ImageProviderAdminConfigRecord | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [scopeFilter, setScopeFilter] = useState<'ALL' | ImageProviderAdminConfigRecord['scope']>('ALL');
    const [healthFilter, setHealthFilter] = useState('ALL');
    const [purposeFilter, setPurposeFilter] = useState<'ALL' | ImageProviderAdminConfigRecord['purpose']>(
        'ALL',
    );
    const query = useQuery({
        queryKey: ['image-provider-admin'],
        queryFn: () => api.query<ImageProviderAdminQueryResult>(imageProviderAdminQuery),
    });
    const configs = query.data?.imageProviderAdminConfigs ?? [];
    const models = query.data?.imageGenerationAdminConfig.models ?? [];
    const filteredConfigs = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        return configs
            .filter(config => {
                const matchesSearch =
                    !normalizedSearch ||
                    [config.name, config.code, config.apiKeyLast4, config.baseUrl, config.textModelId]
                        .join(' ')
                        .toLowerCase()
                        .includes(normalizedSearch);
                return (
                    matchesSearch &&
                    (scopeFilter === 'ALL' || config.scope === scopeFilter) &&
                    (healthFilter === 'ALL' || credentialDisplayStatus(config) === healthFilter) &&
                    (purposeFilter === 'ALL' || config.purpose === purposeFilter)
                );
            })
            .sort(
                (left, right) =>
                    Number(right.credentialEnabled) - Number(left.credentialEnabled) ||
                    left.priority - right.priority ||
                    left.name.localeCompare(right.name, 'zh-CN'),
            );
    }, [configs, healthFilter, purposeFilter, scopeFilter, searchTerm]);
    if (query.isLoading) return <LoadingPage title="AI 服务接入" />;
    if (query.error)
        return <ErrorPage title="AI 服务接入" retry={() => void query.refetch()} error={query.error} />;
    if (!query.data) return <LoadingPage title="AI 服务接入" />;
    const providerSummaries = (['OPENAI', 'GEMINI'] as const).map(scope => {
        const scoped = configs.filter(config => config.scope === scope);
        return {
            scope,
            configured: scoped.filter(config => config.credentialConfigured).length,
            enabled: scoped.filter(config => config.credentialEnabled).length,
            healthy: scoped.filter(
                config => config.credentialEnabled && credentialDisplayStatus(config) === 'HEALTHY',
            ).length,
            prompt: scoped.filter(
                config =>
                    config.credentialEnabled &&
                    credentialDisplayStatus(config) === 'HEALTHY' &&
                    ['PROMPT', 'BOTH'].includes(config.purpose),
            ).length,
            image: scoped.filter(
                config =>
                    config.credentialEnabled &&
                    credentialDisplayStatus(config) === 'HEALTHY' &&
                    ['IMAGE', 'BOTH'].includes(config.purpose),
            ).length,
        };
    });
    const hasFilters = Boolean(
        searchTerm || scopeFilter !== 'ALL' || healthFilter !== 'ALL' || purposeFilter !== 'ALL',
    );
    const resetFilters = () => {
        setSearchTerm('');
        setScopeFilter('ALL');
        setHealthFilter('ALL');
        setPurposeFilter('ALL');
    };
    return (
        <Page pageId="image-generation-access">
            <PageTitle>AI 服务接入</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button onClick={() => setSelectedCredential(emptyCredential(`new-key-${Date.now()}`))}>
                        <Plus className="mr-2 h-4 w-4" />
                        添加 Key
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="image-access-summary"
                    title="GPT / Gemini Key 池状态"
                    description="系统不内置或硬编码默认 Key；只使用下方由 SuperAdmin 配置、加密保存且健康检查通过的 Key。"
                >
                    <div className="grid gap-3 md:grid-cols-2">
                        {providerSummaries.map(summary => (
                            <div key={summary.scope} className="rounded-lg border bg-muted/20 px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium">{providerName(summary.scope)}</span>
                                        <span className="text-xs tabular-nums text-muted-foreground">
                                            {summary.configured} 个 Key
                                        </span>
                                    </div>
                                    <Badge variant={summary.healthy ? 'success' : 'secondary'}>
                                        {summary.healthy ? '有可用 Key' : '暂无健康 Key'}
                                    </Badge>
                                </div>
                                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                                    {[
                                        ['启用', summary.enabled],
                                        ['健康', summary.healthy],
                                        ['提示词', summary.prompt],
                                        ['生图', summary.image],
                                    ].map(([label, value]) => (
                                        <div key={label} className="rounded-md bg-background px-2 py-1.5">
                                            <div className="text-sm font-medium tabular-nums">{value}</div>
                                            <div className="text-[11px] text-muted-foreground">{label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </PageBlock>
                <PageBlock
                    column="full"
                    blockId="image-access-credentials"
                    title={`Key 管理（${filteredConfigs.length}/${configs.length}）`}
                    description="API Key 始终只显示末四位。可按名称、稳定编码、域名或末四位搜索。"
                >
                    <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_10rem_10rem_11rem_auto]">
                        <div className="relative">
                            <Search
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <Input
                                aria-label="搜索 Key"
                                className="pl-9"
                                placeholder="搜索名称、编码、域名或末四位"
                                value={searchTerm}
                                onChange={event => setSearchTerm(event.target.value)}
                            />
                        </div>
                        <select
                            aria-label="按供应商筛选"
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                            value={scopeFilter}
                            onChange={event =>
                                setScopeFilter(
                                    event.target.value as 'ALL' | ImageProviderAdminConfigRecord['scope'],
                                )
                            }
                        >
                            <option value="ALL">全部供应商</option>
                            <option value="OPENAI">Codex / GPT</option>
                            <option value="GEMINI">Gemini</option>
                        </select>
                        <select
                            aria-label="按健康状态筛选"
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                            value={healthFilter}
                            onChange={event => setHealthFilter(event.target.value)}
                        >
                            <option value="ALL">全部状态</option>
                            <option value="HEALTHY">正常</option>
                            <option value="UNHEALTHY">异常</option>
                            <option value="UNTESTED">未测试</option>
                            <option value="UNCONFIGURED">未配置</option>
                            <option value="COOLDOWN">冷却中</option>
                        </select>
                        <select
                            aria-label="按用途筛选"
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                            value={purposeFilter}
                            onChange={event =>
                                setPurposeFilter(
                                    event.target.value as 'ALL' | ImageProviderAdminConfigRecord['purpose'],
                                )
                            }
                        >
                            <option value="ALL">全部用途</option>
                            <option value="BOTH">提示词和生图</option>
                            <option value="PROMPT">仅提示词</option>
                            <option value="IMAGE">仅生图</option>
                        </select>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="清除筛选"
                            title="清除筛选"
                            disabled={!hasFilters}
                            onClick={resetFilters}
                        >
                            <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    </div>
                    <ProviderCredentialList
                        configs={filteredConfigs}
                        totalConfigs={configs.length}
                        hasFilters={hasFilters}
                        models={models}
                        onEdit={setSelectedCredential}
                        onChanged={() => void query.refetch()}
                        onAdd={() => setSelectedCredential(emptyCredential(`new-key-${Date.now()}`))}
                    />
                </PageBlock>
            </PageLayout>
            {selectedCredential ? (
                <ProviderCredentialEditorSheet
                    key={selectedCredential.id || selectedCredential.code}
                    config={selectedCredential}
                    models={models}
                    onChanged={() => void query.refetch()}
                    onClose={() => setSelectedCredential(null)}
                />
            ) : null}
        </Page>
    );
}

function ProviderCredentialList({
    configs,
    totalConfigs,
    hasFilters,
    models,
    onEdit,
    onChanged,
    onAdd,
}: Readonly<{
    configs: ImageProviderAdminConfigRecord[];
    totalConfigs: number;
    hasFilters: boolean;
    models: Array<{ code: string; displayNameZh: string }>;
    onEdit(config: ImageProviderAdminConfigRecord): void;
    onChanged: () => void;
    onAdd: () => void;
}>) {
    const test = useMutation({
        mutationFn: (id: string) =>
            api.mutate<{ testImageProviderCredential: { ok: boolean; message: string } }>(
                testImageProviderMutation,
                { id },
            ),
        onSuccess: result => {
            (result.testImageProviderCredential.ok ? toast.success : toast.error)(
                result.testImageProviderCredential.message,
            );
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const toggleEnabled = useMutation({
        mutationFn: ({ config, enabled }: { config: ImageProviderAdminConfigRecord; enabled: boolean }) =>
            api.mutate(saveImageCredentialMutation, {
                input: credentialInput(config, enabled),
            }),
        onSuccess: () => {
            toast.success('Key 启用状态已更新');
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const changeEnabled = (config: ImageProviderAdminConfigRecord, enabled: boolean) => {
        if (enabled && credentialDisplayStatus(config) !== 'HEALTHY') {
            toast.error('请先测试连接，确认 Key 健康后再启用');
            onEdit(config);
            return;
        }
        toggleEnabled.mutate({ config, enabled });
    };

    if (!totalConfigs) {
        return (
            <div className="rounded-lg border border-dashed px-6 py-12 text-center">
                <KeyRound className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-medium">尚未配置 AI Key</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                    新建首个 Key 后保存并测试连接，健康的 Key 才会进入模型路由。
                </p>
                <Button className="mt-4" type="button" variant="outline" onClick={onAdd}>
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    添加第一个 Key
                </Button>
            </div>
        );
    }

    if (!configs.length && hasFilters) {
        return (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
                没有符合当前搜索或筛选条件的 Key。
            </div>
        );
    }

    return (
        <>
            <div className="hidden overflow-hidden rounded-lg border md:block">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[72rem] text-sm">
                        <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                            <tr>
                                <th className="px-4 py-3 font-medium">Key</th>
                                <th className="px-3 py-3 font-medium">供应商 / 用途</th>
                                <th className="px-3 py-3 font-medium">健康状态</th>
                                <th className="px-3 py-3 font-medium">路由</th>
                                <th className="px-3 py-3 font-medium">绑定模型</th>
                                <th className="px-3 py-3 font-medium">最近使用</th>
                                <th className="px-3 py-3 text-center font-medium">启用</th>
                                <th className="px-4 py-3 text-right font-medium">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {configs.map(config => {
                                const isTesting = test.isPending && test.variables === config.id;
                                const isToggling =
                                    toggleEnabled.isPending &&
                                    toggleEnabled.variables?.config.id === config.id;
                                return (
                                    <tr
                                        key={config.id}
                                        className="align-middle transition-colors hover:bg-muted/20"
                                    >
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                className={
                                                    'max-w-64 text-left focus-visible:outline-none ' +
                                                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                                                }
                                                onClick={() => onEdit(config)}
                                            >
                                                <span className="block truncate font-medium">
                                                    {config.name}
                                                </span>
                                                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                                    {config.code} · ••••{config.apiKeyLast4 || '未配置'}
                                                </span>
                                                <span className="mt-0.5 block max-w-64 truncate text-xs text-muted-foreground">
                                                    {providerHost(config.baseUrl)}
                                                </span>
                                            </button>
                                        </td>
                                        <td className="px-3 py-3">
                                            <Badge variant="outline">{providerName(config.scope)}</Badge>
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {providerPurposeZh(config.purpose)}
                                            </div>
                                        </td>
                                        <td className="max-w-60 px-3 py-3">
                                            <ProviderHealthBadge config={config} />
                                            <div
                                                className="mt-1 truncate text-xs text-muted-foreground"
                                                title={config.providerHealthMessage ?? undefined}
                                            >
                                                {providerHealthSummary(config)}
                                            </div>
                                        </td>
                                        <td className="px-3 py-3 tabular-nums">
                                            P{config.priority} · W{config.weight}
                                        </td>
                                        <td className="max-w-64 px-3 py-3">
                                            <ProviderModelBadges config={config} models={models} />
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">
                                            {formatProviderDate(config.lastUsedAt)}
                                        </td>
                                        <td className="px-3 py-3 text-center">
                                            <Switch
                                                aria-label={`${config.name}启用状态`}
                                                checked={config.credentialEnabled}
                                                disabled={isToggling}
                                                onCheckedChange={enabled => changeEnabled(config, enabled)}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={isTesting || !config.credentialConfigured}
                                                    onClick={() => test.mutate(config.id)}
                                                >
                                                    {isTesting ? (
                                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <RefreshCw className="h-4 w-4" />
                                                    )}
                                                    测试
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => onEdit(config)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                    编辑
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="grid gap-3 md:hidden">
                {configs.map(config => {
                    const isTesting = test.isPending && test.variables === config.id;
                    const isToggling =
                        toggleEnabled.isPending && toggleEnabled.variables?.config.id === config.id;
                    return (
                        <article key={config.id} className="rounded-lg border bg-background p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="truncate font-medium">{config.name}</h3>
                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                        {config.code} · ••••{config.apiKeyLast4 || '未配置'}
                                    </p>
                                </div>
                                <ProviderHealthBadge config={config} />
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{providerName(config.scope)}</Badge>
                                <Badge variant="secondary">{providerPurposeZh(config.purpose)}</Badge>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                    P{config.priority} · W{config.weight}
                                </span>
                            </div>
                            <div className="mt-3">
                                <ProviderModelBadges config={config} models={models} />
                            </div>
                            <div className="mt-4 flex items-center justify-between border-t pt-3">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        aria-label={`${config.name}启用状态`}
                                        checked={config.credentialEnabled}
                                        disabled={isToggling}
                                        onCheckedChange={enabled => changeEnabled(config, enabled)}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        {config.credentialEnabled ? '已启用' : '已停用'}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={isTesting || !config.credentialConfigured}
                                        onClick={() => test.mutate(config.id)}
                                    >
                                        {isTesting ? (
                                            <LoaderCircle className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4" />
                                        )}
                                        测试
                                    </Button>
                                    <Button type="button" size="sm" onClick={() => onEdit(config)}>
                                        <Pencil className="h-4 w-4" />
                                        编辑
                                    </Button>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </>
    );
}

export function ProviderCredentialEditorSheet({
    config,
    models,
    onChanged,
    onClose,
}: Readonly<{
    config: ImageProviderAdminConfigRecord;
    models: Array<{ code: string; displayNameZh: string }>;
    onChanged: () => void;
    onClose: () => void;
}>) {
    const initialDraft = useMemo(() => credentialDraft(config), [config]);
    const [draft, setDraft] = useState(initialDraft);
    const [testFeedback, setTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);
    const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);
    const isDirty = JSON.stringify(draft) !== JSON.stringify(initialDraft);
    const update = <K extends keyof ProviderCredentialDraft>(key: K, value: ProviderCredentialDraft[K]) =>
        setDraft(current => ({ ...current, [key]: value }));
    const requestClose = () => {
        if (isDirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
        onClose();
    };
    const save = useMutation({
        mutationFn: async (testAfterSave: boolean) => {
            const savedResult = await api.mutate<{
                saveImageProviderCredential: ImageProviderAdminConfigRecord;
            }>(saveImageCredentialMutation, {
                input: {
                    id: config.id || null,
                    scope: draft.scope,
                    code: draft.code,
                    name: draft.name,
                    purpose: draft.purpose,
                    baseUrl: draft.baseUrl,
                    apiKey: draft.apiKey || null,
                    textModelId: draft.textModelId,
                    enabled: draft.enabled,
                    priority: draft.priority,
                    weight: draft.weight,
                    modelCodes: draft.modelCodes,
                },
            });
            const savedCredential = savedResult.saveImageProviderCredential;
            if (!testAfterSave) {
                return { testResult: null, savedEnabled: savedCredential.credentialEnabled };
            }
            const testResult = await api.mutate<{
                testImageProviderCredential: { ok: boolean; message: string };
            }>(testImageProviderMutation, { id: savedResult.saveImageProviderCredential.id });
            return {
                testResult: testResult.testImageProviderCredential,
                savedEnabled: savedCredential.credentialEnabled,
            };
        },
        onSuccess: result => {
            if (result.testResult) {
                (result.testResult.ok ? toast.success : toast.error)(result.testResult.message);
            } else {
                if (draft.enabled && !result.savedEnabled) {
                    toast.success(`${draft.name || providerName(draft.scope)} 已保存，请测试通过后再启用`);
                } else {
                    toast.success(`${draft.name || providerName(draft.scope)} 已保存`);
                }
            }
            onChanged();
            onClose();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const test = useMutation({
        mutationFn: () =>
            api.mutate<{ testImageProviderCredential: { ok: boolean; message: string } }>(
                testImageProviderMutation,
                { id: config.id },
            ),
        onSuccess: result => {
            setTestFeedback(result.testImageProviderCredential);
            (result.testImageProviderCredential.ok ? toast.success : toast.error)(
                result.testImageProviderCredential.message,
            );
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const archive = useMutation({
        mutationFn: () => api.mutate(archiveImageProviderMutation, { id: config.id }),
        onSuccess: () => {
            toast.success('Key 已归档，历史任务仍保留快照');
            setArchiveConfirmationOpen(false);
            onChanged();
            onClose();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const submit = (testAfterSave: boolean) => {
        const validationError = providerCredentialDraftError(draft, Boolean(config.id));
        if (validationError) {
            toast.error(validationError);
            return;
        }
        save.mutate(testAfterSave);
    };
    const pending = save.isPending || archive.isPending;
    const healthStatus = testFeedback
        ? testFeedback.ok
            ? 'HEALTHY'
            : 'UNHEALTHY'
        : credentialDisplayStatus(config);
    const healthMessage = testFeedback?.message ?? config.providerHealthMessage;

    return (
        <>
            <UnsavedChangesConfirmation when={isDirty} />
            <Sheet open onOpenChange={open => !open && requestClose()}>
                <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[720px] sm:max-w-[720px]">
                    <SheetHeader className="shrink-0 border-b px-6 py-5 pr-14 text-left">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <SheetTitle>{config.id ? `编辑 ${config.name}` : '添加 AI Key'}</SheetTitle>
                                <SheetDescription className="mt-1">
                                    {config.id
                                        ? `尾号 ${config.apiKeyLast4 || '未配置'} · 修改连接信息后需要重新测试`
                                        : '配置连接、路由与模型绑定，保存后才会进入 Key 池。'}
                                </SheetDescription>
                            </div>
                            {config.id ? <ProviderHealthBadge config={config} status={healthStatus} /> : null}
                        </div>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        {config.id ? (
                            <section className="mb-6 rounded-lg border bg-muted/20 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-medium">连接状态</h3>
                                        <p className="mt-1 break-words text-xs text-muted-foreground">
                                            {healthMessage || '暂无健康检查详情。'}
                                        </p>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={test.isPending || !config.credentialConfigured || isDirty}
                                        title={isDirty ? '请先保存修改后再测试' : undefined}
                                        onClick={() => test.mutate()}
                                    >
                                        {test.isPending ? (
                                            <LoaderCircle className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4" />
                                        )}
                                        测试连接
                                    </Button>
                                </div>
                            </section>
                        ) : null}

                        <div className="space-y-7">
                            <section className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-medium">基础信息</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        名称用于管理识别，稳定编码会写入调用审计记录。
                                    </p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field label="Key 名称" htmlFor="provider-key-name">
                                        <Input
                                            id="provider-key-name"
                                            maxLength={120}
                                            value={draft.name}
                                            onChange={event => update('name', event.target.value)}
                                        />
                                    </Field>
                                    <Field label="稳定编码" htmlFor="provider-key-code">
                                        <Input
                                            id="provider-key-code"
                                            maxLength={64}
                                            disabled={Boolean(config.id)}
                                            value={draft.code}
                                            onChange={event =>
                                                update('code', event.target.value.toLowerCase())
                                            }
                                        />
                                        {config.id ? (
                                            <p className="text-xs text-muted-foreground">
                                                稳定编码已写入任务与审计快照，创建后不可修改。
                                            </p>
                                        ) : null}
                                    </Field>
                                    <Field label="供应商" htmlFor="provider-key-scope">
                                        <select
                                            id="provider-key-scope"
                                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                            value={draft.scope}
                                            onChange={event =>
                                                update(
                                                    'scope',
                                                    event.target
                                                        .value as ImageProviderAdminConfigRecord['scope'],
                                                )
                                            }
                                        >
                                            <option value="OPENAI">Codex / GPT</option>
                                            <option value="GEMINI">Gemini</option>
                                        </select>
                                    </Field>
                                    <Field label="用途" htmlFor="provider-key-purpose">
                                        <select
                                            id="provider-key-purpose"
                                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                            value={draft.purpose}
                                            onChange={event =>
                                                update(
                                                    'purpose',
                                                    event.target
                                                        .value as ImageProviderAdminConfigRecord['purpose'],
                                                )
                                            }
                                        >
                                            <option value="BOTH">提示词优化和生图</option>
                                            <option value="PROMPT">仅提示词优化</option>
                                            <option value="IMAGE">仅生图</option>
                                        </select>
                                    </Field>
                                </div>
                                <Toggle
                                    id="provider-key-enabled"
                                    label="启用此 Key"
                                    checked={draft.enabled}
                                    onChange={enabled => update('enabled', enabled)}
                                />
                            </section>

                            <section className="space-y-4 border-t pt-6">
                                <div>
                                    <h3 className="text-sm font-medium">接入配置</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        仅 SuperAdmin 可见。API Key 使用 AES-256-GCM
                                        加密，客户浏览器不会收到完整 Key。
                                    </p>
                                </div>
                                <Field label="API Base URL" htmlFor="provider-key-base-url">
                                    <Input
                                        id="provider-key-base-url"
                                        placeholder="https://relay.example.com/v1"
                                        value={draft.baseUrl}
                                        onChange={event => update('baseUrl', event.target.value)}
                                    />
                                </Field>
                                <Field
                                    label={`API Key${config.apiKeyLast4 ? `（当前末四位 ${config.apiKeyLast4}）` : ''}`}
                                    htmlFor="provider-key-secret"
                                >
                                    <Input
                                        id="provider-key-secret"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder={
                                            config.credentialConfigured
                                                ? '留空表示不更换'
                                                : '首次配置必须填写'
                                        }
                                        value={draft.apiKey}
                                        onChange={event => update('apiKey', event.target.value)}
                                    />
                                </Field>
                                <Field
                                    label={
                                        draft.scope === 'OPENAI'
                                            ? '提示词优化 / Responses 编排模型 ID'
                                            : 'Gemini 提示词优化模型 ID'
                                    }
                                    htmlFor="provider-key-text-model"
                                >
                                    <Input
                                        id="provider-key-text-model"
                                        maxLength={160}
                                        placeholder={
                                            draft.scope === 'OPENAI'
                                                ? '例如中转站可用的 GPT 文本模型'
                                                : '例如中转站可用的 Gemini 文本模型'
                                        }
                                        value={draft.textModelId}
                                        onChange={event => update('textModelId', event.target.value)}
                                    />
                                </Field>
                                <p className="text-xs text-muted-foreground">
                                    生产环境只允许 HTTPS，并拒绝 localhost、内网、云元数据地址和重定向。
                                </p>
                            </section>

                            <section className="space-y-4 border-t pt-6">
                                <div>
                                    <h3 className="text-sm font-medium">路由配置</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        优先级数字越小越优先；同优先级的 Key 按权重轮询。
                                    </p>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field label="优先级" htmlFor="provider-key-priority">
                                        <Input
                                            id="provider-key-priority"
                                            type="number"
                                            min="0"
                                            max="10000"
                                            value={draft.priority}
                                            onChange={event => update('priority', Number(event.target.value))}
                                        />
                                    </Field>
                                    <Field label="同级轮询权重" htmlFor="provider-key-weight">
                                        <Input
                                            id="provider-key-weight"
                                            type="number"
                                            min="1"
                                            max="1000"
                                            value={draft.weight}
                                            onChange={event => update('weight', Number(event.target.value))}
                                        />
                                    </Field>
                                </div>
                            </section>

                            <section className="space-y-4 border-t pt-6">
                                <div>
                                    <h3 className="text-sm font-medium">明确绑定的生图模型</h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        留空表示按供应商和用途自动路由。
                                    </p>
                                </div>
                                <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border bg-muted/10 p-3 sm:grid-cols-2">
                                    {models.map(model => {
                                        const id = `provider-model-${model.code}`;
                                        return (
                                            <label
                                                key={model.code}
                                                htmlFor={id}
                                                className={
                                                    'flex cursor-pointer items-start gap-2 rounded-md border ' +
                                                    'bg-background p-3 text-sm transition-colors hover:bg-muted/30'
                                                }
                                            >
                                                <input
                                                    id={id}
                                                    type="checkbox"
                                                    className="mt-0.5"
                                                    checked={draft.modelCodes.includes(model.code)}
                                                    onChange={event =>
                                                        update(
                                                            'modelCodes',
                                                            event.target.checked
                                                                ? [...draft.modelCodes, model.code]
                                                                : draft.modelCodes.filter(
                                                                      value => value !== model.code,
                                                                  ),
                                                        )
                                                    }
                                                />
                                                <span className="min-w-0">
                                                    <span className="block font-medium">
                                                        {model.displayNameZh}
                                                    </span>
                                                    <span className="block truncate text-xs text-muted-foreground">
                                                        {model.code}
                                                    </span>
                                                </span>
                                            </label>
                                        );
                                    })}
                                    {!models.length ? (
                                        <p className="text-sm text-muted-foreground">暂无可绑定模型。</p>
                                    ) : null}
                                </div>
                            </section>
                        </div>
                    </div>
                    <SheetFooter className="shrink-0 border-t px-6 py-4">
                        <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                {config.id ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="text-destructive hover:text-destructive"
                                        disabled={pending}
                                        onClick={() => setArchiveConfirmationOpen(true)}
                                    >
                                        <Archive className="h-4 w-4" />
                                        归档 Key
                                    </Button>
                                ) : null}
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={pending}
                                    onClick={requestClose}
                                >
                                    取消
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={pending}
                                    onClick={() => submit(false)}
                                >
                                    {save.isPending && save.variables === false ? (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Save className="h-4 w-4" />
                                    )}
                                    保存
                                </Button>
                                <Button type="button" disabled={pending} onClick={() => submit(true)}>
                                    {save.isPending && save.variables === true ? (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <RefreshCw className="h-4 w-4" />
                                    )}
                                    保存并测试
                                </Button>
                            </div>
                        </div>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
            <Dialog open={archiveConfirmationOpen} onOpenChange={setArchiveConfirmationOpen}>
                <DialogContent className="sm:max-w-[440px]">
                    <DialogHeader>
                        <DialogTitle>归档 {config.name}？</DialogTitle>
                        <DialogDescription>
                            归档后该 Key 会立即停用并从 Key 池移除，历史任务与审计快照仍会保留。
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={archive.isPending}
                            onClick={() => setArchiveConfirmationOpen(false)}
                        >
                            取消
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            disabled={archive.isPending}
                            onClick={() => archive.mutate()}
                        >
                            {archive.isPending ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                                <Archive className="h-4 w-4" />
                            )}
                            确认归档
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function ProviderHealthBadge({
    config,
    status = credentialDisplayStatus(config),
}: Readonly<{ config: ImageProviderAdminConfigRecord; status?: string }>) {
    if (status === 'HEALTHY') return <Badge variant="success">{statusZh(status)}</Badge>;
    if (status === 'UNHEALTHY') return <Badge variant="destructive">{statusZh(status)}</Badge>;
    if (status === 'COOLDOWN') return <Badge variant="warning">{statusZh(status)}</Badge>;
    return <Badge variant="secondary">{statusZh(status)}</Badge>;
}

function ProviderModelBadges({
    config,
    models,
}: Readonly<{
    config: ImageProviderAdminConfigRecord;
    models: Array<{ code: string; displayNameZh: string }>;
}>) {
    if (!config.modelCodes.length) {
        return <span className="text-xs text-muted-foreground">按供应商自动路由</span>;
    }
    const modelNames = new Map(models.map(model => [model.code, model.displayNameZh]));
    const visible = config.modelCodes.slice(0, 2);
    return (
        <div className="flex flex-wrap gap-1">
            {visible.map(code => (
                <Badge key={code} variant="outline" className="max-w-36 truncate font-normal">
                    {modelNames.get(code) ?? code}
                </Badge>
            ))}
            {config.modelCodes.length > visible.length ? (
                <Badge variant="secondary">+{config.modelCodes.length - visible.length}</Badge>
            ) : null}
        </div>
    );
}

interface ProviderCredentialDraft {
    code: string;
    name: string;
    scope: ImageProviderAdminConfigRecord['scope'];
    purpose: ImageProviderAdminConfigRecord['purpose'];
    baseUrl: string;
    apiKey: string;
    textModelId: string;
    enabled: boolean;
    priority: number;
    weight: number;
    modelCodes: string[];
}

function credentialDraft(config: ImageProviderAdminConfigRecord): ProviderCredentialDraft {
    return {
        code: config.code,
        name: config.name,
        scope: config.scope,
        purpose: config.purpose,
        baseUrl: config.baseUrl,
        apiKey: '',
        textModelId: config.textModelId,
        enabled: config.credentialEnabled,
        priority: config.priority,
        weight: config.weight,
        modelCodes: [...config.modelCodes],
    };
}

function providerCredentialDraftError(draft: ProviderCredentialDraft, existing: boolean): string | null {
    if (!draft.name.trim() || draft.name.trim().length > 120) return 'Key 名称为必填项，最多 120 个字符';
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/u.test(draft.code.trim()))
        return 'Key 稳定编码只能包含小写字母、数字、下划线和连字符，长度 3 到 64 位';
    if (!draft.baseUrl.trim()) return 'API Base URL 不能为空';
    if (!existing && !draft.apiKey.trim()) return '首次配置必须填写 API Key';
    if (!draft.textModelId.trim() || draft.textModelId.trim().length > 160)
        return '提示词优化模型 ID 为必填项，最多 160 个字符';
    if (!Number.isSafeInteger(draft.priority) || draft.priority < 0 || draft.priority > 10_000)
        return 'Key 优先级必须是 0 到 10000 的整数';
    if (!Number.isSafeInteger(draft.weight) || draft.weight < 1 || draft.weight > 1_000)
        return 'Key 轮询权重必须是 1 到 1000 的整数';
    return null;
}

function credentialInput(config: ImageProviderAdminConfigRecord, enabled: boolean) {
    return {
        id: config.id,
        scope: config.scope,
        code: config.code,
        name: config.name,
        purpose: config.purpose,
        baseUrl: config.baseUrl,
        apiKey: null,
        textModelId: config.textModelId,
        enabled,
        priority: config.priority,
        weight: config.weight,
        modelCodes: config.modelCodes,
    };
}

function credentialDisplayStatus(config: ImageProviderAdminConfigRecord): string {
    if (config.cooldownUntil && new Date(config.cooldownUntil).getTime() > Date.now()) return 'COOLDOWN';
    return config.providerHealthStatus;
}

function providerHealthSummary(config: ImageProviderAdminConfigRecord): string {
    if (credentialDisplayStatus(config) === 'COOLDOWN') {
        return `冷却至 ${formatProviderDate(config.cooldownUntil)}`;
    }
    return config.providerHealthMessage || '暂无详情';
}

function providerHost(value: string): string {
    try {
        return new URL(value).host;
    } catch {
        return value || '未配置 Base URL';
    }
}

function formatProviderDate(value?: string | null): string {
    if (!value) return '尚未使用';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString();
}

function providerPurposeZh(purpose: ImageProviderAdminConfigRecord['purpose']): string {
    return (
        {
            BOTH: '提示词和生图',
            PROMPT: '仅提示词',
            IMAGE: '仅生图',
        } as const
    )[purpose];
}

function providerName(scope: ImageProviderAdminConfigRecord['scope']): string {
    return scope === 'OPENAI' ? 'Codex / GPT' : 'Gemini';
}

function emptyCredential(code: string): ImageProviderAdminConfigRecord {
    return {
        id: '',
        code,
        name: '备用 Key',
        purpose: 'BOTH',
        scope: 'OPENAI',
        credentialConfigured: false,
        credentialEnabled: false,
        baseUrl: '',
        apiKeyLast4: '',
        textModelId: '',
        providerHealthStatus: 'UNCONFIGURED',
        providerHealthMessage: null,
        priority: 100,
        weight: 1,
        cooldownUntil: null,
        lastUsedAt: null,
        modelCodes: [],
    };
}

function skillUseCaseZh(useCase: string): string {
    return (
        (
            {
                'product-photo': '商品摄影',
                'ecommerce-poster': '电商海报',
                portrait: '成人商业人像',
                'interior-design': '室内设计',
                illustration: '插画',
                'reference-edit': '参考图编辑',
            } as Record<string, string>
        )[useCase] ?? useCase
    );
}

function routingStrategyZh(strategy: string): string {
    return (
        (
            {
                BALANCED: '质量、速度与成本均衡',
                QUALITY: '质量优先',
                SPEED: '速度优先',
                COST: '成本优先',
                UNKNOWN: '未记录',
            } as Record<string, string>
        )[strategy] ?? strategy
    );
}

function skillReleaseName(release: { createdAt: string; sourceHash: string }): string {
    const date = release.createdAt.slice(0, 10) || '日期未知';
    return `${date} · ${release.sourceHash.slice(0, 8)}`;
}

function statusZh(status: string): string {
    return (
        (
            {
                HEALTHY: '正常',
                UNHEALTHY: '异常',
                UNTESTED: '未测试',
                UNCONFIGURED: '未配置',
                COOLDOWN: '冷却中',
                ACTIVE: '当前使用',
                INACTIVE: '未启用',
                PENDING: '待处理',
                UNKNOWN: '结果待确认',
                QUEUED: '排队中',
                RUNNING: '生成中',
                PARTIAL_SUCCESS: '部分成功',
                SUCCEEDED: '成功',
                FAILED: '失败',
                CANCELLED: '已取消',
            } as Record<string, string>
        )[status] ?? status
    );
}

function billingModeZh(mode: string): string {
    return (
        (
            {
                FREE: '免费',
                PAID: '付费',
                MIXED: '免费+付费',
                PENDING: '待结算',
                RELEASED: '已释放',
                REFUNDED: '已退款',
            } as Record<string, string>
        )[mode] ?? mode
    );
}

function Field({
    label,
    htmlFor,
    className,
    children,
}: Readonly<{ label: string; htmlFor?: string; className?: string; children: React.ReactNode }>) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
        </div>
    );
}
function Toggle({
    id,
    label,
    checked,
    onChange,
}: Readonly<{ id?: string; label: string; checked: boolean; onChange(value: boolean): void }>) {
    return (
        <div className="flex items-center justify-between gap-4 rounded border p-3">
            <Label htmlFor={id}>{label}</Label>
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
        </div>
    );
}
function LoadingPage({ title }: Readonly<{ title: string }>) {
    return (
        <Page pageId="image-loading">
            <PageTitle>{title}</PageTitle>
            <PageLayout>
                <PageBlock column="full" blockId="loading">
                    <Skeleton className="h-72 w-full" />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
function ErrorPage({ title, retry, error }: Readonly<{ title: string; retry(): void; error: unknown }>) {
    return (
        <Page pageId="image-error">
            <PageTitle>{title}</PageTitle>
            <PageLayout>
                <PageBlock column="full" blockId="error">
                    <Alert>
                        <AlertDescription>{errorMessage(error)}</AlertDescription>
                    </Alert>
                    <Button className="mt-4" onClick={retry}>
                        重试
                    </Button>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
export function toLocalDayBoundary(value: string, endOfDay: boolean): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const boundary = new Date(
        year,
        month - 1,
        day,
        endOfDay ? 23 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 59 : 0,
        endOfDay ? 999 : 0,
    );
    if (boundary.getFullYear() !== year || boundary.getMonth() !== month - 1 || boundary.getDate() !== day) {
        return null;
    }
    return boundary.toISOString();
}

export function reconcileImageAdminConfig(
    current: ImageAdminConfigRecord | null,
    baseline: ImageAdminConfigRecord | null,
    incoming: ImageAdminConfigRecord,
): ImageAdminConfigRecord {
    if (!current || !baseline) return structuredClone(incoming);
    const next = reconcileRecord(current, baseline, incoming);
    const currentModels = new Map(current.models.map(model => [model.code, model]));
    const baselineModels = new Map(baseline.models.map(model => [model.code, model]));
    next.models = incoming.models.map(model => {
        const currentModel = currentModels.get(model.code);
        const baselineModel = baselineModels.get(model.code);
        return currentModel && baselineModel
            ? reconcileRecord(currentModel, baselineModel, model)
            : structuredClone(model);
    });
    return next;
}

function reconcileRecord<T extends object>(current: T, baseline: T, incoming: T): T {
    const result = structuredClone(incoming) as Record<string, unknown>;
    for (const key of Object.keys(incoming)) {
        if (key === 'models') continue;
        const currentValue = (current as Record<string, unknown>)[key];
        const baselineValue = (baseline as Record<string, unknown>)[key];
        if (!sameValue(currentValue, baselineValue)) result[key] = structuredClone(currentValue);
    }
    return result as T;
}

function replaceAdminModel(
    config: ImageAdminConfigRecord,
    savedModel: ImageAdminModelRecord,
): ImageAdminConfigRecord {
    return {
        ...config,
        models: config.models.map(model =>
            model.code === savedModel.code ? structuredClone(savedModel) : model,
        ),
    };
}

function sameAdminConfig(left: ImageAdminConfigRecord | null, right: ImageAdminConfigRecord | null): boolean {
    return sameValue(left, right);
}

function sameValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
function modelInput(model: ImageAdminModelRecord) {
    const {
        id: _id,
        officialModelId: _official,
        healthStatus: _health,
        healthMessage: _healthMessage,
        lastTestedAt: _lastTestedAt,
        resolutionOptions: _resolutionOptions,
        ...input
    } = model;
    return input;
}
function protocolChange(model: ImageAdminModelRecord, value: string): Partial<ImageAdminModelRecord> {
    const protocol = value as ImageAdminModelRecord['protocol'];
    const changed = { ...model, protocol };
    return {
        protocol,
        unitPrice2K: modelSupportsResolution(changed, '2K') ? model.unitPrice2K : 0,
        unitPrice4K: modelSupportsResolution(changed, '4K') ? model.unitPrice4K : 0,
    };
}
function modelSupportsResolution(
    model: Pick<ImageAdminModelRecord, 'officialModelId' | 'providerModelId' | 'protocol'>,
    resolution: '1K' | '2K' | '4K',
) {
    if (resolution === '1K') return true;
    const official = model.officialModelId.replace(/^models\//iu, '').toLowerCase();
    const provider = model.providerModelId.replace(/^models\//iu, '').toLowerCase();
    const geminiNative = ['GEMINI_INTERACTIONS', 'GEMINI_NATIVE', 'GEMINI_NATIVE_STREAM'].includes(
        model.protocol,
    );
    if (geminiNative && /^(?:gemini-3(?:\.\d+)?-(?:pro|flash)-image)(?:-|$)/u.test(official)) {
        return true;
    }
    return (
        ['OPENAI_IMAGES', 'OPENAI_RESPONSES_IMAGE'].includes(model.protocol) &&
        (official === 'gpt-image-2' || provider === 'gpt-image-2')
    );
}
function currencyFactor(currency: string) {
    return ['JPY', 'KRW', 'VND'].includes(currency) ? 1 : 100;
}
function minorToMajor(value: number, currency: string) {
    return String(value / currencyFactor(currency));
}
function majorToMinor(value: string, currency: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * currencyFactor(currency)) : 0;
}
function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}
