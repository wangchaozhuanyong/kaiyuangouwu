import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    ChannelCodeLabel,
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
    Textarea,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { RefreshCw, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    BUSINESS_SERVICES_COPY_VERSION,
    CLIENT_PLUGIN_BLOCK_CODE,
    ClientPluginLanguageCode,
    clientPluginBlockInput,
    clientPluginPageCopyIsValid,
    clientPluginPageCopyTranslation,
    createClientPluginDraft,
} from './storefront-client-plugin-config';
import {
    ContentBlock,
    ContentBlockTranslation,
    StorefrontContentBlocksResult,
    createStorefrontContentBlockMutation,
    storefrontContentBlocksQuery,
    updateStorefrontContentBlockMutation,
    versionedContentBlockUpdate,
} from './storefront-content.graphql';

export const businessServicesCopyRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'business-services-copy',
        url: '/business-services-copy',
        title: '商业服务页文案',
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/business-services-copy',
    loader: () => ({ breadcrumb: () => '商业服务页文案' }),
    component: () => <BusinessServicesCopyPage />,
};

function BusinessServicesCopyPage() {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [draft, setDraft] = useState<ContentBlock | null>(null);
    const [previewLanguage, setPreviewLanguage] = useState<ClientPluginLanguageCode>('zh_Hans');
    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const pluginBlock = useMemo(
        () =>
            contentQuery.data?.storefrontContentBlocks.find(
                block => block.type === 'CLIENT_PLUGINS' && block.code === CLIENT_PLUGIN_BLOCK_CODE,
            ),
        [contentQuery.data?.storefrontContentBlocks],
    );

    useEffect(() => {
        if (!activeChannel?.id || contentQuery.isError) {
            setDraft(null);
            return;
        }
        if (contentQuery.isPending) return;
        setDraft(createClientPluginDraft(pluginBlock));
    }, [activeChannel?.id, contentQuery.isError, contentQuery.isPending, pluginBlock]);

    const saveMutation = useMutation({
        mutationFn: async (block: ContentBlock) => {
            const input = clientPluginBlockInput(block);
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, {
                      input: versionedContentBlockUpdate(block, input),
                  })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async () => {
            toast.success('商业服务页文案已保存并发布');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : String(error)),
    });

    const configReady = Boolean(draft && !contentQuery.isPending && !contentQuery.isError);
    const valid = Boolean(draft && clientPluginPageCopyIsValid(draft));
    const isDirty = Boolean(
        configReady && JSON.stringify(draft) !== JSON.stringify(createClientPluginDraft(pluginBlock)),
    );

    const updateTranslation = (
        languageCode: ClientPluginLanguageCode,
        patch: Pick<Partial<ContentBlockTranslation>, 'title' | 'body'>,
    ) =>
        setDraft(current =>
            current
                ? {
                      ...current,
                      settings: {
                          ...(current.settings ?? {}),
                          businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
                      },
                      translations: current.translations.map(translation =>
                          translation.languageCode === languageCode
                              ? { ...translation, ...patch }
                              : translation,
                      ),
                  }
                : current,
        );

    const resetCopy = () => {
        const defaults = createClientPluginDraft();
        setDraft(current =>
            current
                ? {
                      ...current,
                      settings: {
                          ...(current.settings ?? {}),
                          businessServicesCopyVersion: BUSINESS_SERVICES_COPY_VERSION,
                      },
                      translations: defaults.translations,
                  }
                : current,
        );
    };

    const preview = draft ? clientPluginPageCopyTranslation(draft, previewLanguage) : null;
    const errorMessage = contentQuery.isError
        ? contentQuery.error instanceof Error
            ? contentQuery.error.message
            : String(contentQuery.error)
        : null;

    return (
        <Page pageId="business-services-copy">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>商业服务页文案</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        disabled={!configReady || !valid || saveMutation.isPending}
                        onClick={() => draft && saveMutation.mutate(draft)}
                    >
                        <Save className="size-4" aria-hidden="true" />
                        {saveMutation.isPending ? '正在保存' : '保存并发布'}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="business-services-copy-editor"
                    title="页面顶部文案"
                    description="修改商业服务页顶部卡片中的标题和说明，保存后对当前店铺生效。"
                >
                    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>当前店铺</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
                        <Badge variant="secondary">支持中英文</Badge>
                    </div>

                    {contentQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                <span className="min-w-0">
                                    <strong className="block">页面文案加载失败</strong>
                                    <span className="mt-1 block break-words text-xs">
                                        {errorMessage || '请确认管理接口可用后重试。'}
                                    </span>
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={contentQuery.isFetching}
                                    onClick={() => void contentQuery.refetch()}
                                >
                                    <RefreshCw
                                        className={`size-4 ${contentQuery.isFetching ? 'animate-spin' : ''}`}
                                        aria-hidden="true"
                                    />
                                    {contentQuery.isFetching ? '重试中' : '重试'}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : contentQuery.isPending || !draft ? (
                        <div className="grid gap-5 xl:grid-cols-2" aria-busy="true">
                            <Skeleton className="h-72 w-full" />
                            <Skeleton className="h-72 w-full" />
                        </div>
                    ) : (
                        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
                            <div className="space-y-5">
                                {(['zh_Hans', 'en'] as const).map(languageCode => {
                                    const translation = clientPluginPageCopyTranslation(draft, languageCode);
                                    const isZh = languageCode === 'zh_Hans';
                                    return (
                                        <section
                                            key={languageCode}
                                            className="space-y-4 rounded-lg border p-4"
                                        >
                                            <div>
                                                <h3 className="font-medium">{isZh ? '中文' : 'English'}</h3>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {isZh
                                                        ? '客户端切换为中文时显示。'
                                                        : '客户端切换为英文时显示。'}
                                                </p>
                                            </div>
                                            <CopyField
                                                label="标题"
                                                value={translation.title}
                                                maxLength={isZh ? 40 : 80}
                                                onChange={title => updateTranslation(languageCode, { title })}
                                            />
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <Label htmlFor={`business-services-body-${languageCode}`}>
                                                        说明
                                                    </Label>
                                                    <span className="text-xs text-muted-foreground">
                                                        {translation.body.length}/{isZh ? 100 : 180}
                                                    </span>
                                                </div>
                                                <Textarea
                                                    id={`business-services-body-${languageCode}`}
                                                    value={translation.body}
                                                    rows={4}
                                                    maxLength={isZh ? 100 : 180}
                                                    onChange={event =>
                                                        updateTranslation(languageCode, {
                                                            body: event.target.value,
                                                        })
                                                    }
                                                />
                                            </div>
                                        </section>
                                    );
                                })}

                                {!valid ? (
                                    <Alert variant="destructive">
                                        <AlertDescription>
                                            请填写完整的中文和英文标题与说明。
                                        </AlertDescription>
                                    </Alert>
                                ) : null}

                                <div className="flex justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={saveMutation.isPending}
                                        onClick={resetCopy}
                                    >
                                        <RotateCcw className="size-4" aria-hidden="true" />
                                        恢复默认文案
                                    </Button>
                                </div>
                            </div>

                            <aside className="xl:sticky xl:top-6 xl:self-start">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <Label>实时预览</Label>
                                    <div className="flex rounded-md border bg-background p-1">
                                        {(['zh_Hans', 'en'] as const).map(languageCode => (
                                            <Button
                                                key={languageCode}
                                                type="button"
                                                size="sm"
                                                variant={
                                                    previewLanguage === languageCode ? 'secondary' : 'ghost'
                                                }
                                                aria-pressed={previewLanguage === languageCode}
                                                onClick={() => setPreviewLanguage(languageCode)}
                                            >
                                                {languageCode === 'zh_Hans' ? '中文' : 'English'}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                                <div className="rounded-[20px] border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 p-5 shadow-sm">
                                    <div className="flex items-start gap-4">
                                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm">
                                            <Sparkles className="size-5" aria-hidden="true" />
                                        </span>
                                        <div className="min-w-0 pt-0.5">
                                            <h3 className="text-base font-bold text-slate-900">
                                                {preview?.title || '—'}
                                            </h3>
                                            <p className="mt-1.5 text-sm leading-6 text-slate-500">
                                                {preview?.body || '—'}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <p className="mt-3 text-xs text-muted-foreground">
                                    预览用于确认文案层级；客户端的实际宽度和换行会根据设备自适应。
                                </p>
                            </aside>
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function CopyField({
    label,
    value,
    maxLength,
    onChange,
}: Readonly<{ label: string; value: string; maxLength: number; onChange: (value: string) => void }>) {
    const id = `business-services-title-${maxLength}`;
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <Label htmlFor={id}>{label}</Label>
                <span className="text-xs text-muted-foreground">
                    {value.length}/{maxLength}
                </span>
            </div>
            <Input
                id={id}
                value={value}
                maxLength={maxLength}
                onChange={event => onChange(event.target.value)}
            />
        </div>
    );
}
