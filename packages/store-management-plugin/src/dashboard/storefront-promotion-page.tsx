import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
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
} from '@vendure/dashboard';
import {
    Code2,
    ExternalLink,
    LoaderCircle,
    Monitor,
    RefreshCw,
    Rocket,
    Save,
    Smartphone,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
    PreviewStorefrontPromotionPageResult,
    PromotionContentType,
    PublishStorefrontPromotionPageResult,
    ResetStorefrontPromotionPageResult,
    SaveStorefrontPromotionDraftResult,
    StorefrontPromotionPageResult,
    previewStorefrontPromotionPageMutation,
    publishStorefrontPromotionPageMutation,
    resetStorefrontPromotionPageMutation,
    saveStorefrontPromotionDraftMutation,
    storefrontPromotionPageQuery,
} from './storefront-promotion.graphql';

interface EditorDraft {
    contentType: PromotionContentType;
    source: string;
}

const snippets = [
    { label: '店铺名称', value: '{{store.name}}' },
    { label: '店铺简介', value: '{{store.description}}' },
    {
        label: 'Logo',
        value: '<img data-bind-src="store.logoUrl" data-hide-if-empty alt="{{store.name}}">',
    },
    {
        label: '主视觉图',
        value: '<img data-bind-src="store.heroImageUrl" data-hide-if-empty alt="{{store.name}}">',
    },
    {
        label: '背景图',
        value: '<div data-bind-background="store.heroImageUrl" data-hide-if-empty></div>',
    },
    {
        label: '进入按钮',
        value: '<form data-store-entry><button type="submit">进入主网站</button></form>',
    },
];

export const storefrontPromotionRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'storefront-promotion',
        url: '/storefront-promotion',
        title: '短视频推广页',
        icon: Rocket,
        order: 20,
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/storefront-promotion',
    loader: () => ({ breadcrumb: () => '短视频推广页' }),
    component: () => <StorefrontPromotionPage />,
};

function StorefrontPromotionPage() {
    const { activeChannel } = useChannel();
    const editorRef = useRef<HTMLTextAreaElement | null>(null);
    const [draft, setDraft] = useState<EditorDraft | null>(null);
    const [previewHtml, setPreviewHtml] = useState('');
    const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

    const pageQuery = useQuery({
        queryKey: ['storefront-promotion-page', activeChannel?.id],
        queryFn: () => api.query<StorefrontPromotionPageResult>(storefrontPromotionPageQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const page = pageQuery.data?.storefrontPromotionPage;

    useEffect(() => {
        if (page) {
            setDraft({ contentType: page.contentType, source: page.draftSource });
        }
    }, [page]);

    const previewMutation = useMutation({
        mutationFn: (input: EditorDraft) =>
            api.mutate(previewStorefrontPromotionPageMutation, {
                input,
            }) as Promise<PreviewStorefrontPromotionPageResult>,
        onSuccess: result => setPreviewHtml(result.previewStorefrontPromotionPage),
        onError: error => toast.error(errorMessage(error)),
    });
    const saveMutation = useMutation({
        mutationFn: (input: EditorDraft) =>
            api.mutate(saveStorefrontPromotionDraftMutation, {
                input,
            }) as Promise<SaveStorefrontPromotionDraftResult>,
        onSuccess: result => {
            const saved = result.saveStorefrontPromotionDraft;
            setDraft({ contentType: saved.contentType, source: saved.draftSource });
            void pageQuery.refetch();
            toast.success('草稿已保存');
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const publishMutation = useMutation({
        mutationFn: async () => {
            if (!draft) throw new Error('推广页尚未加载');
            await api.mutate(saveStorefrontPromotionDraftMutation, { input: draft });
            return api.mutate(
                publishStorefrontPromotionPageMutation,
                {},
            ) as Promise<PublishStorefrontPromotionPageResult>;
        },
        onSuccess: result => {
            void pageQuery.refetch();
            toast.success(`已发布第 ${result.publishStorefrontPromotionPage.publishedVersion} 版`);
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const resetMutation = useMutation({
        mutationFn: () =>
            api.mutate(
                resetStorefrontPromotionPageMutation,
                {},
            ) as Promise<ResetStorefrontPromotionPageResult>,
        onSuccess: result => {
            const reset = result.resetStorefrontPromotionPage;
            setDraft({ contentType: reset.contentType, source: reset.draftSource });
            setPreviewHtml('');
            void pageQuery.refetch();
            toast.success('已恢复并发布默认页面');
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const insertSnippet = (value: string) => {
        if (!draft) return;
        const editor = editorRef.current;
        const start = editor?.selectionStart ?? draft.source.length;
        const end = editor?.selectionEnd ?? start;
        const source = `${draft.source.slice(0, start)}${value}${draft.source.slice(end)}`;
        setDraft({ ...draft, source });
        requestAnimationFrame(() => {
            editor?.focus();
            editor?.setSelectionRange(start + value.length, start + value.length);
        });
    };

    const busy = saveMutation.isPending || publishMutation.isPending || resetMutation.isPending;
    const isDirty = Boolean(
        draft &&
        page &&
        JSON.stringify(draft) !== JSON.stringify({ contentType: page.contentType, source: page.draftSource }),
    );

    return (
        <Page pageId="storefront-promotion">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>短视频推广页</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    {page?.publicUrl && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => window.open(page.publicUrl ?? '', '_blank', 'noopener,noreferrer')}
                        >
                            <ExternalLink className="size-4" aria-hidden="true" />
                            打开推广页
                        </Button>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!draft || busy}
                        onClick={() => draft && saveMutation.mutate(draft)}
                    >
                        {saveMutation.isPending ? (
                            <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                            <Save className="size-4" />
                        )}
                        保存草稿
                    </Button>
                    <Button type="button" disabled={!draft || busy} onClick={() => publishMutation.mutate()}>
                        {publishMutation.isPending ? (
                            <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                            <Rocket className="size-4" />
                        )}
                        发布
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="storefront-promotion-editor"
                    title="页面源码"
                    description="直接粘贴 HTML/CSS 或 Markdown。店铺资料会通过变量自动同步，公开页面不使用 iframe。"
                >
                    {pageQuery.isPending ? (
                        <div className="space-y-3">
                            <Skeleton className="h-10 w-48" />
                            <Skeleton className="h-[520px] w-full" />
                        </div>
                    ) : pageQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>推广页加载失败</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void pageQuery.refetch()}
                                >
                                    <RefreshCw className="size-4" />
                                    重试
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : draft ? (
                        <div className="space-y-5">
                            <div className="flex flex-wrap items-end justify-between gap-3">
                                <div className="space-y-2">
                                    <Label>内容格式</Label>
                                    <div className="flex gap-2">
                                        {(['HTML', 'MARKDOWN'] as PromotionContentType[]).map(type => (
                                            <Button
                                                key={type}
                                                type="button"
                                                size="sm"
                                                variant={draft.contentType === type ? 'default' : 'outline'}
                                                onClick={() => setDraft({ ...draft, contentType: type })}
                                            >
                                                {type}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant={page?.isCustomized ? 'secondary' : 'outline'}>
                                        {page?.isCustomized ? '自定义草稿' : '默认模板'}
                                    </Badge>
                                    <span>{new Blob([draft.source]).size} / 60000 bytes</span>
                                </div>
                            </div>
                            {draft.contentType === 'HTML' && (
                                <div className="space-y-2">
                                    <Label>插入动态元素</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {snippets.map(snippet => (
                                            <Button
                                                key={snippet.label}
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() => insertSnippet(snippet.value)}
                                            >
                                                {snippet.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <Textarea
                                ref={editorRef}
                                aria-label="推广页源码"
                                className="min-h-[520px] resize-y font-mono text-xs leading-5"
                                spellCheck={false}
                                value={draft.source}
                                onChange={event => setDraft({ ...draft, source: event.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">
                                为安全起见，脚本、iframe、事件属性和任意表单会被自动移除。请用“进入按钮”元素进入主网站。
                            </p>
                        </div>
                    ) : null}
                </PageBlock>
                <PageBlock column="side" blockId="storefront-promotion-publish" title="发布状态">
                    <div className="space-y-4 text-sm">
                        <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">已发布版本</span>
                            <strong>{page?.publishedVersion ?? 0}</strong>
                        </div>
                        <div className="flex justify-between gap-4">
                            <span className="text-muted-foreground">最后发布</span>
                            <span className="text-right">{formatDate(page?.publishedAt)}</span>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            disabled={!draft || previewMutation.isPending}
                            onClick={() => draft && previewMutation.mutate(draft)}
                        >
                            {previewMutation.isPending ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Code2 className="size-4" />
                            )}
                            生成安全预览
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            className="w-full"
                            disabled={busy}
                            onClick={() =>
                                window.confirm('确定恢复默认推广页并立即发布吗？') && resetMutation.mutate()
                            }
                        >
                            <RefreshCw className="size-4" />
                            恢复默认页面
                        </Button>
                    </div>
                </PageBlock>
                {previewHtml && (
                    <PageBlock
                        column="main"
                        blockId="storefront-promotion-preview"
                        title="安全预览"
                        description="预览使用和公开页相同的服务器清理与动态数据绑定。"
                    >
                        <div className="mb-3 flex justify-end gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={previewMode === 'desktop' ? 'default' : 'outline'}
                                onClick={() => setPreviewMode('desktop')}
                            >
                                <Monitor className="size-4" />
                                桌面
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={previewMode === 'mobile' ? 'default' : 'outline'}
                                onClick={() => setPreviewMode('mobile')}
                            >
                                <Smartphone className="size-4" />
                                手机
                            </Button>
                        </div>
                        <div className="overflow-auto rounded-lg border bg-muted p-3">
                            <iframe
                                title="推广页安全预览"
                                sandbox=""
                                srcDoc={previewHtml}
                                className="mx-auto block h-[720px] bg-background transition-[width]"
                                style={{ width: previewMode === 'mobile' ? 390 : '100%' }}
                            />
                        </div>
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}

function formatDate(value: string | null | undefined): string {
    return value
        ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(value),
          )
        : '尚未发布';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
