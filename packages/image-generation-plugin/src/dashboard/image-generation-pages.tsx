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
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Image, KeyRound, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    ImageAdminConfigRecord,
    ImageAdminModelRecord,
    ImageAdminQueryResult,
    ImageProviderAdminConfigRecord,
    ImageProviderAdminQueryResult,
    activateImageSkillMutation,
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
    useEffect(() => setDraft(config ? structuredClone(config) : null), [config]);

    const saveConfig = useMutation({
        mutationFn: (value: ImageAdminConfigRecord) =>
            api.mutate(saveImageGenerationConfigMutation, {
                input: {
                    enabled: value.enabled,
                    promptOptimizationEnabled: value.promptOptimizationEnabled,
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
            toast.success('提示词 Skill 版本已启用');
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
                <PageBlock
                    column="full"
                    blockId="image-base"
                    title="基础设置"
                    description="客户从返利余额按实际选择的模型和原生清晰度付费，支持 1–4 张和一张参考图。"
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
                        <div className="space-y-1">
                            <Toggle
                                label="免费提示词优化"
                                checked={draft.promptOptimizationEnabled}
                                onChange={promptOptimizationEnabled =>
                                    setDraft({ ...draft, promptOptimizationEnabled })
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                “免费”仅指不向客户端用户扣费；每次优化仍会调用已配置的文本模型，消耗中转站
                                Token 或额度。
                            </p>
                        </div>
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
                                onChange={event => setDraft({ ...draft, termsVersion: event.target.value })}
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

                <PageBlock
                    column="full"
                    blockId="image-models"
                    title="模型与单张价格"
                    description="友好名称、用途说明和官方模型 ID 会展示给客户。只读测试不生图；真实生图测试可能产生上游费用。健康结果 24 小时后过期。"
                >
                    <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-4">
                        {draft.models.map(model => (
                            <div key={model.code} className="space-y-3 rounded-lg border p-4">
                                <div className="flex items-center justify-between">
                                    <strong>{model.displayNameZh}</strong>
                                    <Badge>{model.healthStatus}</Badge>
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
                                            updateModel(model.code, { providerModelId: event.target.value })
                                        }
                                    />
                                </Field>
                                <Field label="协议">
                                    <select
                                        className="h-9 w-full rounded-md border bg-background px-3"
                                        value={model.protocol}
                                        onChange={event =>
                                            updateModel(model.code, protocolChange(model, event.target.value))
                                        }
                                    >
                                        <option value="OPENAI_RESPONSES_IMAGE">
                                            OpenAI Responses Image（当前中转站推荐）
                                        </option>
                                        {/* i18n-audit-ignore -- Vendor-defined protocol name. */}
                                        <option value="OPENAI_IMAGES">OpenAI Images</option>
                                        {/* i18n-audit-ignore -- Vendor-defined protocol name. */}
                                        <option value="OPENAI_COMPATIBLE_CHAT">OpenAI Compatible Chat</option>
                                        <option value="GEMINI_INTERACTIONS">
                                            Gemini Interactions（推荐）
                                        </option>
                                        <option value="GEMINI_NATIVE">Gemini GenerateContent（兼容）</option>
                                        <option value="GEMINI_NATIVE_STREAM">
                                            Gemini StreamGenerateContent（当前中转站推荐）
                                        </option>
                                    </select>
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
                                    只有确认中转站对相同幂等键不会重复生图、不会重复计费时才能开启。开启后系统才可对结果未知任务使用原幂等键安全重试；若中转站不保证，重试可能产生重复图片和重复费用。
                                </p>
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

                <PageBlock
                    column="full"
                    blockId="image-skills"
                    title="提示词 Skill 版本"
                    description={`当前规则哈希：${draft.activeSkillHash}`}
                >
                    <div className="space-y-2">
                        {data.imagePromptSkillReleases.map(release => (
                            <div
                                key={release.id}
                                className="flex items-center justify-between rounded border p-3"
                            >
                                <div>
                                    {/* i18n-audit-ignore -- Technical bundle version prefix. */}
                                    <strong>Bundle v{release.bundleVersion}</strong>
                                    <div className="font-mono text-xs text-muted-foreground">
                                        {release.sourceHash}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge>{release.status}</Badge>
                                    {release.status !== 'ACTIVE' ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => activateSkill.mutate(release.id)}
                                        >
                                            <RotateCcw className="mr-2 h-4 w-4" />
                                            回滚/启用
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="image-jobs"
                    title={`最近任务（共 ${data.imageGenerationJobs.totalItems}）`}
                    description="UNKNOWN 不会自动重复生成；15 分钟后自动退回，或由管理员确认后使用同一幂等键重试。"
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left">
                                    <th className="p-2">时间</th>
                                    <th>模型</th>
                                    <th>状态</th>
                                    <th>扣费/退回</th>
                                    <th>每张结果</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.imageGenerationJobs.items.map(job => (
                                    <tr key={job.id} className="border-b align-top">
                                        <td className="p-2">{new Date(job.createdAt).toLocaleString()}</td>
                                        <td>
                                            {job.modelNameSnapshot}
                                            <div className="text-xs text-muted-foreground">
                                                {job.officialModelIdSnapshot} · {job.resolution}
                                            </div>
                                        </td>
                                        <td>
                                            <Badge>{job.state}</Badge>
                                        </td>
                                        <td>
                                            {minorToMajor(job.capturedAmount, job.currencyCode)} /{' '}
                                            {minorToMajor(job.releasedAmount, job.currencyCode)}{' '}
                                            {job.currencyCode}
                                        </td>
                                        <td className="space-y-1 py-2">
                                            {job.outputs.map(output => (
                                                <div key={output.id} className="flex items-center gap-2">
                                                    <span>
                                                        #{output.outputIndex + 1} {output.state}
                                                        {output.refundedAt ? ' · 已退款' : ''}
                                                    </span>
                                                    {output.state === 'UNKNOWN' ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => retryOutput.mutate(output.id)}
                                                        >
                                                            确认重试
                                                        </Button>
                                                    ) : null}
                                                    {output.state === 'SUCCEEDED' && !output.refundedAt ? (
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
                            </tbody>
                        </table>
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function ImageGenerationAccessPage() {
    const query = useQuery({
        queryKey: ['image-provider-admin'],
        queryFn: () => api.query<ImageProviderAdminQueryResult>(imageProviderAdminQuery),
    });
    const configs = query.data?.imageProviderAdminConfigs;
    if (query.isLoading) return <LoadingPage title="AI 服务接入" />;
    if (query.error)
        return <ErrorPage title="AI 服务接入" retry={() => void query.refetch()} error={query.error} />;
    if (!configs) return <LoadingPage title="AI 服务接入" />;
    return (
        <Page pageId="image-generation-access">
            <PageTitle>AI 服务接入</PageTitle>
            <PageLayout>
                {configs.map(config => (
                    <ProviderCredentialCard
                        key={config.scope}
                        config={config}
                        onChanged={() => void query.refetch()}
                    />
                ))}
            </PageLayout>
        </Page>
    );
}

function ProviderCredentialCard({
    config,
    onChanged,
}: Readonly<{ config: ImageProviderAdminConfigRecord; onChanged: () => void }>) {
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [textModelId, setTextModelId] = useState('');
    const [enabled, setEnabled] = useState(false);
    useEffect(() => {
        if (config) {
            setBaseUrl(config.baseUrl);
            setTextModelId(config.textModelId);
            setEnabled(config.credentialEnabled);
            setApiKey('');
        }
    }, [config]);
    const save = useMutation({
        mutationFn: () =>
            api.mutate(saveImageCredentialMutation, {
                input: { scope: config.scope, baseUrl, apiKey: apiKey || null, textModelId, enabled },
            }),
        onSuccess: () => {
            toast.success(`${providerName(config.scope)} 中转站接入已保存`);
            setApiKey('');
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const test = useMutation({
        mutationFn: () =>
            api.mutate<{ testImageProviderConnection: { ok: boolean; message: string } }>(
                testImageProviderMutation,
                { scope: config.scope },
            ),
        onSuccess: result => {
            (result.testImageProviderConnection.ok ? toast.success : toast.error)(
                result.testImageProviderConnection.message,
            );
            onChanged();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    return (
        <PageBlock
            column="full"
            blockId={`image-access-${config.scope.toLowerCase()}`}
            title={`${providerName(config.scope)} 中转站凭证`}
            description={
                config.scope === 'OPENAI'
                    ? '用于 OpenAI 生图模型及免费提示词优化。'
                    : '用于 Gemini 生图模型；与 OpenAI Key 独立保存。'
            }
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                    仅 SuperAdmin 可见。API Key 使用 AES-256-GCM 加密，永远不会发送到客户浏览器。
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={test.isPending || !config.credentialConfigured}
                        onClick={() => test.mutate()}
                    >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        测试连接
                    </Button>
                    <Button disabled={save.isPending} onClick={() => save.mutate()}>
                        <Save className="mr-2 h-4 w-4" />
                        保存接入
                    </Button>
                </div>
            </div>
            <Alert className="mt-4">
                <AlertDescription>
                    生产环境只允许 HTTPS，且拒绝 localhost、内网、云元数据地址和重定向。当前状态：
                    {config.providerHealthStatus}
                    {config.providerHealthMessage ? ` · ${config.providerHealthMessage}` : ''}
                </AlertDescription>
            </Alert>
            <div className="mt-5 grid max-w-3xl gap-5">
                <Toggle
                    label={`启用 ${providerName(config.scope)} 中转站`}
                    checked={enabled}
                    onChange={setEnabled}
                />
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
                        config.scope === 'OPENAI'
                            ? '提示词优化 / Responses 编排模型 ID'
                            : '连接测试文本模型 ID'
                    }
                >
                    <Input
                        placeholder={
                            config.scope === 'OPENAI' ? '例如 gpt-5.4-mini' : '例如 gemini-3.7-flash'
                        }
                        value={textModelId}
                        onChange={event => setTextModelId(event.target.value)}
                    />
                </Field>
            </div>
        </PageBlock>
    );
}

function providerName(scope: ImageProviderAdminConfigRecord['scope']): string {
    return scope === 'OPENAI' ? 'Codex / GPT' : 'Gemini';
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
