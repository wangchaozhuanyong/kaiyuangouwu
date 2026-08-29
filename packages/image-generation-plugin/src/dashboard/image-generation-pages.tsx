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
    Skeleton,
    Switch,
    Tabs,
    TabsList,
    TabsTrigger,
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Archive, Image, KeyRound, Plus, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    ImageAdminConfigRecord,
    ImageAdminModelRecord,
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
    imageProviderAdminQuery,
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

function useImageAdminQuery() {
    return useQuery({
        queryKey: ['image-generation-admin'],
        queryFn: () => api.query<ImageAdminQueryResult>(imageGenerationAdminQuery),
    });
}

function ImageGenerationSettingsPage() {
    const query = useImageAdminQuery();
    const config = query.data?.imageGenerationAdminConfig;
    const [draft, setDraft] = useState<ImageAdminConfigRecord | null>(null);
    const [activeTab, setActiveTab] = useState('base');
    const [historyView, setHistoryView] = useState<'usage' | 'prompts' | 'generation'>('usage');
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
        queryFn: () =>
            api.query<ImageAiUsageRecordsQueryResult>(imageAiUsageRecordsQuery, {
                input: {
                    skip: usagePage * 50,
                    take: 50,
                    customer: usageSearch || null,
                    state: usageState || null,
                    billingMode: usageBilling || null,
                    from: usageFrom ? `${usageFrom}T00:00:00.000Z` : null,
                    to: usageTo ? `${usageTo}T23:59:59.999Z` : null,
                    modelCode: usageModel || null,
                    credentialCode: usageKey || null,
                    recordType: usageType || null,
                    failuresOnly: usageFailuresOnly,
                    missingCostOnly: usageMissingCostOnly,
                },
            }),
    });
    const usageDetailQuery = useQuery({
        queryKey: ['image-ai-usage-record', selectedUsage?.recordType, selectedUsage?.id],
        enabled: activeTab === 'jobs' && historyView === 'usage' && selectedUsage != null,
        queryFn: () =>
            api.query<ImageAiUsageRecordDetailQueryResult>(imageAiUsageRecordDetailQuery, {
                recordType: selectedUsage?.recordType,
                id: selectedUsage?.id,
            }),
    });
    useEffect(() => setDraft(config ? structuredClone(config) : null), [config]);

    const saveConfig = useMutation({
        mutationFn: (value: ImageAdminConfigRecord) =>
            api.mutate(saveImageGenerationConfigMutation, {
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
                },
            }),
        onSuccess: () => {
            toast.success('AI 生图配置已保存');
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const saveModel = useMutation({
        mutationFn: (model: ImageAdminModelRecord) =>
            api.mutate(saveImageModelMutation, { input: modelInput(model) }),
        onSuccess: () => {
            toast.success('模型设置已保存');
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const testModel = useMutation({
        mutationFn: async (model: ImageAdminModelRecord) => {
            await api.mutate(saveImageModelMutation, { input: modelInput(model) });
            return api.mutate<{ testImageModel: { ok: boolean; message: string } }>(testImageModelMutation, {
                code: model.code,
            });
        },
        onSuccess: result => {
            (result.testImageModel.ok ? toast.success : toast.error)(result.testImageModel.message);
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const smokeTestModel = useMutation({
        mutationFn: async (model: ImageAdminModelRecord) => {
            await api.mutate(saveImageModelMutation, { input: modelInput(model) });
            return api.mutate<{
                smokeTestImageModel: {
                    ok: boolean;
                    message: string;
                    actualCostMicrounits?: number | null;
                    costCurrency?: string | null;
                };
            }>(smokeTestImageModelMutation, { code: model.code });
        },
        onSuccess: result => {
            const test = result.smokeTestImageModel;
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
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const retryOutput = useMutation({
        mutationFn: (outputId: string) => api.mutate(retryImageOutputMutation, { outputId }),
        onSuccess: () => void query.refetch(),
        onError: error => toast.error(errorMessage(error)),
    });
    const refundOutput = useMutation({
        mutationFn: ({ outputId, reason }: { outputId: string; reason: string }) =>
            api.mutate(refundImageOutputMutation, { outputId, reason }),
        onSuccess: () => {
            toast.success('本张图片费用已退回返利余额');
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    if (query.isLoading) return <LoadingPage title="AI 生图服务" />;
    if (query.error)
        return <ErrorPage title="AI 生图服务" retry={() => void query.refetch()} error={query.error} />;
    if (!draft || !query.data) return <LoadingPage title="AI 生图服务" />;
    const data = query.data;
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
        const matchesFrom = !jobFrom || new Date(job.createdAt).getTime() >= new Date(jobFrom).getTime();
        return matchesSearch && matchesState && matchesBilling && matchesFrom;
    });

    const updateModel = (code: string, values: Partial<ImageAdminModelRecord>) => {
        setDraft({
            ...draft,
            models: draft.models.map(model => (model.code === code ? { ...model, ...values } : model)),
        });
    };
    return (
        <Page pageId="image-generation-settings">
            <PageTitle>AI 生图服务</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button disabled={saveConfig.isPending} onClick={() => saveConfig.mutate(draft)}>
                        <Save className="mr-2 h-4 w-4" />
                        保存基础配置
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
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
                        {!draft.credentialEnabled ? (
                            <Alert>
                                <AlertDescription>平台中转站尚未启用，客户端不会开放生图。</AlertDescription>
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
                                    onChange={event =>
                                        setDraft({ ...draft, defaultModelCode: event.target.value })
                                    }
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
                                    onChange={event => setDraft({ ...draft, termsZh: event.target.value })}
                                />
                            </Field>
                            <Field label="英文服务条款">
                                <Textarea
                                    rows={5}
                                    value={draft.termsEn}
                                    onChange={event => setDraft({ ...draft, termsEn: event.target.value })}
                                />
                            </Field>
                        </div>
                    </PageBlock>
                ) : null}

                {activeTab === 'models' ? (
                    <PageBlock
                        column="full"
                        blockId="image-models"
                        title="模型与单张价格"
                        description="友好名称、用途说明和官方模型 ID 会展示给客户。只读测试不生图；真实生图测试可能产生上游费用。健康状态会持续有效，直到修改连接配置或检测到真实故障。"
                    >
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
                                                updateModel(model.code, { displayNameZh: event.target.value })
                                            }
                                        />
                                    </Field>
                                    <Field label="英文名称">
                                        <Input
                                            value={model.displayNameEn}
                                            onChange={event =>
                                                updateModel(model.code, { displayNameEn: event.target.value })
                                            }
                                        />
                                    </Field>
                                    <Field label="中文用途说明">
                                        <Textarea
                                            rows={3}
                                            value={model.descriptionZh}
                                            onChange={event =>
                                                updateModel(model.code, { descriptionZh: event.target.value })
                                            }
                                        />
                                    </Field>
                                    <Field label="英文用途说明">
                                        <Textarea
                                            rows={3}
                                            value={model.descriptionEn}
                                            onChange={event =>
                                                updateModel(model.code, { descriptionEn: event.target.value })
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
                                        onChange={isDefault => updateModel(model.code, { isDefault })}
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
                                    复杂文字与版式优先 Codex 图片 2，精细编辑与抠图优先 1.5，日常商品图优先
                                    1，快速试稿和插画优先 Gemini。
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
                            <Field label={`付费优化单次价格（${draft.paidPromptOptimizationCurrencyCode}）`}>
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
                                                        release.status === 'ACTIVE' ? 'success' : 'secondary'
                                                    }
                                                >
                                                    {release.status === 'ACTIVE' ? '当前使用' : '历史备用'}
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
                                            <div className="text-xs text-muted-foreground">可推荐模型</div>
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
                            <PageBlock
                                column="full"
                                blockId="ai-usage-detail"
                                title="AI 使用记录详情"
                                description="完整提示词与计费时间线只对具备 AI 审计权限的管理员开放。"
                            >
                                {usageDetailQuery.isLoading ? <Skeleton className="h-48 w-full" /> : null}
                                {usageDetailQuery.error ? (
                                    <Alert>
                                        <AlertDescription>
                                            {errorMessage(usageDetailQuery.error)}
                                        </AlertDescription>
                                    </Alert>
                                ) : null}
                                {usageDetailQuery.data ? (
                                    <div className="space-y-5">
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="rounded border p-3">
                                                <strong>原始提示词</strong>
                                                <div className="mt-2 whitespace-pre-wrap break-words">
                                                    {usageDetailQuery.data.imageAiUsageRecord.inputPrompt}
                                                </div>
                                            </div>
                                            <div className="rounded border p-3">
                                                <strong>优化/最终提示词</strong>
                                                <div className="mt-2 whitespace-pre-wrap break-words">
                                                    {usageDetailQuery.data.imageAiUsageRecord.outputPrompt ||
                                                        '—'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-sm text-muted-foreground">
                                            Token：
                                            {usageDetailQuery.data.imageAiUsageRecord.totalTokens ?? '—'} ·
                                            上游请求 ID：
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
                                                                    {new Date(event.at).toLocaleString()}
                                                                </td>
                                                                <td>{event.stage}</td>
                                                                <td>{event.status}</td>
                                                                <td>
                                                                    {event.amount == null
                                                                        ? '—'
                                                                        : `${event.amount}${event.currencyCode ? ` ${event.currencyCode}` : ''}`}
                                                                    {event.costMicrounits == null ? null : (
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
                                        <Button variant="outline" onClick={() => setSelectedUsage(null)}>
                                            关闭详情
                                        </Button>
                                    </div>
                                ) : null}
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
    const [newKeys, setNewKeys] = useState<ImageProviderAdminConfigRecord[]>([]);
    const query = useQuery({
        queryKey: ['image-provider-admin'],
        queryFn: () => api.query<ImageProviderAdminQueryResult>(imageProviderAdminQuery),
    });
    const configs = query.data?.imageProviderAdminConfigs;
    if (query.isLoading) return <LoadingPage title="AI 服务接入" />;
    if (query.error)
        return <ErrorPage title="AI 服务接入" retry={() => void query.refetch()} error={query.error} />;
    if (!configs) return <LoadingPage title="AI 服务接入" />;
    const providerSummaries = (['OPENAI', 'GEMINI'] as const).map(scope => {
        const scoped = configs.filter(config => config.scope === scope);
        return {
            scope,
            configured: scoped.filter(config => config.credentialConfigured).length,
            enabled: scoped.filter(config => config.credentialEnabled).length,
            healthy: scoped.filter(
                config => config.credentialEnabled && config.providerHealthStatus === 'HEALTHY',
            ).length,
            prompt: scoped.filter(
                config =>
                    config.credentialEnabled &&
                    config.providerHealthStatus === 'HEALTHY' &&
                    ['PROMPT', 'BOTH'].includes(config.purpose),
            ).length,
            image: scoped.filter(
                config =>
                    config.credentialEnabled &&
                    config.providerHealthStatus === 'HEALTHY' &&
                    ['IMAGE', 'BOTH'].includes(config.purpose),
            ).length,
        };
    });
    return (
        <Page pageId="image-generation-access">
            <PageTitle>AI 服务接入</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        onClick={() =>
                            setNewKeys(items => [...items, emptyCredential(`new-key-${Date.now()}`)])
                        }
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        添加备用 Key
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
                    <div className="grid gap-4 md:grid-cols-2">
                        {providerSummaries.map(summary => (
                            <div key={summary.scope} className="rounded-lg border p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <strong>{providerName(summary.scope)}</strong>
                                    <Badge variant={summary.healthy ? 'success' : 'secondary'}>
                                        {summary.healthy ? '有可用 Key' : '暂无健康 Key'}
                                    </Badge>
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    已配置 {summary.configured} 个 · 已启用 {summary.enabled} 个 · 健康{' '}
                                    {summary.healthy} 个
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    提示词候选 {summary.prompt} 个 · 生图候选 {summary.image} 个
                                </p>
                            </div>
                        ))}
                    </div>
                </PageBlock>
                {!configs.length && !newKeys.length ? (
                    <PageBlock column="full" blockId="image-access-empty" title="尚未配置 AI Key">
                        <Alert>
                            <AlertDescription>
                                接口已正常返回，但当前 Key 池为空。请点击“添加备用
                                Key”完成首个接入；保存并测试正常后，模型才能对客户开放。
                            </AlertDescription>
                        </Alert>
                        <Button className="mt-4" variant="outline" onClick={() => void query.refetch()}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            重新加载
                        </Button>
                    </PageBlock>
                ) : null}
                {[...configs, ...newKeys].map(config => (
                    <ProviderCredentialCard
                        key={config.id || config.code}
                        column="full"
                        blockId={`image-access-${config.id || config.code}`}
                        config={config}
                        models={query.data?.imageGenerationAdminConfig.models ?? []}
                        onChanged={() => void query.refetch()}
                        onDiscard={() => setNewKeys(items => items.filter(item => item !== config))}
                    />
                ))}
            </PageLayout>
        </Page>
    );
}

function ProviderCredentialCard({
    column,
    blockId,
    config,
    models,
    onChanged,
    onDiscard,
}: Readonly<{
    column: 'full';
    blockId: string;
    config: ImageProviderAdminConfigRecord;
    models: Array<{ code: string; displayNameZh: string }>;
    onChanged: () => void;
    onDiscard: () => void;
}>) {
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [scope, setScope] = useState<ImageProviderAdminConfigRecord['scope']>('OPENAI');
    const [purpose, setPurpose] = useState<ImageProviderAdminConfigRecord['purpose']>('BOTH');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [textModelId, setTextModelId] = useState('');
    const [enabled, setEnabled] = useState(false);
    const [priority, setPriority] = useState(100);
    const [weight, setWeight] = useState(1);
    const [modelCodes, setModelCodes] = useState<string[]>([]);
    useEffect(() => {
        if (config) {
            setCode(config.code);
            setName(config.name);
            setScope(config.scope);
            setPurpose(config.purpose);
            setBaseUrl(config.baseUrl);
            setTextModelId(config.textModelId);
            setEnabled(config.credentialEnabled);
            setApiKey('');
            setPriority(config.priority);
            setWeight(config.weight);
            setModelCodes(config.modelCodes);
        }
    }, [config]);
    const save = useMutation({
        mutationFn: () =>
            api.mutate(saveImageCredentialMutation, {
                input: {
                    id: config.id || null,
                    scope,
                    code,
                    name,
                    purpose,
                    baseUrl,
                    apiKey: apiKey || null,
                    textModelId,
                    enabled,
                    priority,
                    weight,
                    modelCodes,
                },
            }),
        onSuccess: () => {
            toast.success(`${name || providerName(scope)} 已保存`);
            setApiKey('');
            if (!config.id) onDiscard();
            onChanged();
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
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    return (
        <PageBlock
            column={column}
            blockId={blockId}
            title={config.id ? `${config.name}（尾号 ${config.apiKeyLast4 || '未配置'}）` : '新增 Key'}
            description={
                scope === 'OPENAI'
                    ? '用于 OpenAI 生图和提示词智能优化；同优先级可按权重轮询。'
                    : '用于 Gemini 生图，也可在 GPT/OpenAI 提示词服务不可用时自动容灾。'
            }
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    仅 SuperAdmin 可见。API Key 使用 AES-256-GCM 加密，永远不会发送到客户浏览器。
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={test.isPending || !config.id || !config.credentialConfigured}
                        onClick={() => test.mutate()}
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        测试连接
                    </Button>
                    <Button disabled={save.isPending} onClick={() => save.mutate()}>
                        <Save className="mr-2 h-4 w-4" />
                        保存接入
                    </Button>
                    {config.id ? (
                        <Button
                            variant="outline"
                            disabled={archive.isPending}
                            onClick={() => archive.mutate()}
                        >
                            <Archive className="mr-2 h-4 w-4" />
                            归档
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={onDiscard}>
                            取消新增
                        </Button>
                    )}
                </div>
            </div>
            <Alert className="mt-4">
                <AlertDescription>
                    生产环境只允许 HTTPS，且拒绝 localhost、内网、云元数据地址和重定向。当前状态：
                    {statusZh(config.providerHealthStatus)}
                    {config.providerHealthMessage ? ` · ${config.providerHealthMessage}` : ''}
                    。健康状态不会按时间过期；修改 Key、基础地址或模型 ID 后需要重新测试。
                </AlertDescription>
            </Alert>
            <div className="mt-5 grid max-w-3xl gap-5">
                <Field label="Key 名称">
                    <Input value={name} onChange={event => setName(event.target.value)} />
                </Field>
                <Field label="稳定编码（保存后用于审计）">
                    <Input value={code} onChange={event => setCode(event.target.value)} />
                </Field>
                <Field label="供应商">
                    <select
                        className="h-9 w-full rounded-md border bg-background px-3"
                        value={scope}
                        onChange={event =>
                            setScope(event.target.value as ImageProviderAdminConfigRecord['scope'])
                        }
                    >
                        <option value="OPENAI">Codex / GPT</option>
                        <option value="GEMINI">Gemini</option>
                    </select>
                </Field>
                <Field label="用途">
                    <select
                        className="h-9 w-full rounded-md border bg-background px-3"
                        value={purpose}
                        onChange={event =>
                            setPurpose(event.target.value as ImageProviderAdminConfigRecord['purpose'])
                        }
                    >
                        <option value="BOTH">提示词优化和生图</option>
                        <option value="PROMPT">仅提示词优化</option>
                        <option value="IMAGE">仅生图</option>
                    </select>
                </Field>
                <Toggle label="启用此 Key" checked={enabled} onChange={setEnabled} />
                <Field label="API Base URL">
                    <Input
                        placeholder="https://relay.example.com/v1"
                        value={baseUrl}
                        onChange={event => setBaseUrl(event.target.value)}
                    />
                </Field>
                <Field label={`API Key${config.apiKeyLast4 ? `（当前末四位 ${config.apiKeyLast4}）` : ''}`}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder={config.credentialConfigured ? '留空表示不更换' : '首次配置必须填写'}
                        value={apiKey}
                        onChange={event => setApiKey(event.target.value)}
                    />
                </Field>
                <Field
                    label={
                        scope === 'OPENAI' ? '提示词优化 / Responses 编排模型 ID' : 'Gemini 提示词优化模型 ID'
                    }
                >
                    <Input
                        placeholder={
                            scope === 'OPENAI'
                                ? '例如中转站可用的 GPT 文本模型'
                                : '例如中转站可用的 Gemini 文本模型'
                        }
                        value={textModelId}
                        onChange={event => setTextModelId(event.target.value)}
                    />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="优先级（数字越小越优先）">
                        <Input
                            type="number"
                            min="0"
                            value={priority}
                            onChange={event => setPriority(Number(event.target.value) || 0)}
                        />
                    </Field>
                    <Field label="同级轮询权重">
                        <Input
                            type="number"
                            min="1"
                            value={weight}
                            onChange={event => setWeight(Number(event.target.value) || 1)}
                        />
                    </Field>
                </div>
                <Field label="明确绑定的生图模型">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {models.map(model => (
                            <label
                                key={model.code}
                                className="flex items-center gap-2 rounded border p-2 text-sm"
                            >
                                <input
                                    type="checkbox"
                                    checked={modelCodes.includes(model.code)}
                                    onChange={event =>
                                        setModelCodes(values =>
                                            event.target.checked
                                                ? [...values, model.code]
                                                : values.filter(value => value !== model.code),
                                        )
                                    }
                                />
                                {model.displayNameZh}（{model.code}）
                            </label>
                        ))}
                    </div>
                </Field>
            </div>
        </PageBlock>
    );
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

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            {children}
        </div>
    );
}
function Toggle({
    label,
    checked,
    onChange,
}: Readonly<{ label: string; checked: boolean; onChange(value: boolean): void }>) {
    return (
        <div className="flex items-center justify-between gap-4 rounded border p-3">
            <Label>{label}</Label>
            <Switch checked={checked} onCheckedChange={onChange} />
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
