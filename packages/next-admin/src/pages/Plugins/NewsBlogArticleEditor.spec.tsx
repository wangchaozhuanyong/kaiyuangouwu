// @vitest-environment jsdom
import { ApolloClient, ApolloLink, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSchema } from '../../../../news-blog-plugin/src/schema';
import { emptyBlogDraft } from '../../../../storefront-content-plugin/src/shared/news-blog';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { createAdminCache } from '../../runtime/admin-cache';
import type { BlogAdminArticle } from './news-blog-types';
import {
    NEWS_BLOG_ARTICLE,
    NEWS_BLOG_WORKSPACE,
    PUBLISH_NEWS_BLOG_ARTICLE,
    SAVE_NEWS_BLOG_ARTICLE,
} from './news-blog.graphql';
import { NewsBlogArticleEditor } from './NewsBlogArticleEditor';
const schema = buildASTSchema({
    kind: Kind.DOCUMENT,
    definitions: [
        ...parse(
            'scalar JSON scalar DateTime type Query { fixture:Boolean } type Mutation { fixture:Boolean }',
        ).definitions,
        ...adminSchema.definitions,
    ],
});
const button = (text: string) =>
    [...document.querySelectorAll('button')].find(x => x.textContent?.includes(text))!;
let root: ReturnType<typeof createRoot>, client: ApolloClient;
afterEach(async () => {
    await act(async () => root?.unmount());
    client?.stop();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});
async function fixture(withImages = false, withProfile = false) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let article = {
        id: '1',
        slug: 'local-qa',
        version: 1,
        state: 'DRAFT',
        draft: {
            ...emptyBlogDraft(),
            title: '原有待审标题',
            body: '## 原文\n本地合成正文。',
            sourceImages: withImages
                ? [
                      {
                          key: 'source',
                          sourceCode: 'openai',
                          sourcePageUrl: 'https://openai.com/news/',
                          url: 'https://images.openai.com/source.png',
                          alt: '原文截图',
                          caption: '来源说明',
                          credit: '发布者',
                          asset: {
                              assetId: 'source-1',
                              url: '/assets/source.webp',
                              alt: '原文截图',
                              generated: false,
                              kind: 'SOURCE' as const,
                              sourcePageUrl: 'https://openai.com/news/',
                              originalUrl: 'https://images.openai.com/source.png',
                              rightsConfirmed: false,
                          },
                      },
                  ]
                : [],
        },
        published: null as (BlogAdminArticle['draft'] & { version: number }) | null,
        issues: [],
    };
    if (withImages) article.draft.cover = article.draft.sourceImages[0]?.asset ?? null;
    if (withProfile) {
        article.draft.category = 'skills';
        article.draft.format = 'SKILL';
        article.draft.skill = {
            identity: 'synthetic-skill',
            name: 'document-helper',
            repository: 'owner/repo',
            repositoryId: '10',
            repositoryUrl: 'https://github.com/owner/repo',
            directoryUrl: 'https://github.com/owner/repo/tree/' + 'a'.repeat(40) + '/skills/document-helper',
            stars: 1500,
            trend: 'EVERGREEN',
            rankingUrl: 'https://www.skills.sh/',
            rankingLabel: 'All Time',
            rank: 1,
            observedAt: new Date().toISOString(),
            sourceCommit: 'a'.repeat(40),
        };
        article.draft.skillProfile = {
            domain: 'office',
            displayName: article.draft.title,
            purpose: '整理文档并保留来源',
            audience: '需要整理文档的用户',
            industries: [],
            capabilities: ['整理文档内容', '保留来源链接'],
            example: { input: '整理这些文档', output: '得到保留来源的整理结果' },
            prerequisites: ['提供原始文档'],
            limitations: ['仅依据原始文档'],
        };
    }
    const writes: string[] = [];
    const rootValue = {
        newsBlogArticle: () => article,
        newsBlogHistory: () => [],
        newsBlogSettings: () => ({}),
        newsBlogArticleList: () => ({
            totalItems: 1,
            items: [
                {
                    ...article,
                    draft: {
                        title: article.draft.title,
                        category: article.draft.category,
                        body: '',
                        sources: [],
                    },
                    published: article.published ? { version: article.published.version } : null,
                },
            ],
        }),
        saveNewsBlogArticle: ({ input }: any) => {
            writes.push('save');
            article = { ...article, ...input, version: article.version + 1 };
            return article;
        },
        publishNewsBlogArticle: () => {
            writes.push('publish');
            const version = article.version + 1;
            article = { ...article, version, state: 'PUBLISHED', published: { ...article.draft, version } };
            return article;
        },
    };
    client = new ApolloClient({
        cache: createAdminCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    void graphql({
                        schema,
                        source: print(operation.query),
                        variableValues: operation.variables,
                        rootValue,
                    }).then(result => {
                        observer.next(result as any);
                        observer.complete();
                    });
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <MemoryRouter>
                    <AdminPermissionsContext.Provider
                        value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                    >
                        <ConfirmDialogProvider>
                            <FeatureHelpProvider>
                                <NewsBlogArticleEditor
                                    id="1"
                                    execute={async action => {
                                        await action();
                                    }}
                                    onSaved={() => {}}
                                    onClose={() => {}}
                                />
                            </FeatureHelpProvider>
                        </ConfirmDialogProvider>
                    </AdminPermissionsContext.Provider>
                </MemoryRouter>
            </ApolloProvider>,
        ),
    );
    await act(async () => {
        await vi.waitFor(() =>
            expect(document.querySelector<HTMLInputElement>('input[value="原有待审标题"]')).toBeTruthy(),
        );
    });
    const title = () =>
        document.querySelector<HTMLInputElement>(
            'input[value="原有待审标题"],input[value="人工未保存标题"]',
        )!;
    const edit = async () =>
        act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                title(),
                '人工未保存标题',
            );
            title().dispatchEvent(new Event('input', { bubbles: true }));
        });
    return {
        writes,
        current: () => article,
        title,
        edit,
        updateServer: () => {
            article = { ...article, version: 2, draft: { ...article.draft, title: '后台更新标题' } };
        },
    };
}
describe('news blog review editor with actual Apollo and server schema', () => {
    it('keeps the full bilingual draft and published text after refreshing the article list', async () => {
        const f = await fixture();
        const { id, slug, version, draft } = f.current();
        const article = {
            ...draft,
            sources: [
                { label: 'OpenAI', url: 'https://openai.com/news/', accessedAt: '2026-11-03T00:00:00Z' },
            ],
            translations: {
                en: {
                    title: 'Sample update',
                    summary: 'A reviewed update.',
                    body: 'Full English article.',
                    seoDescription: 'Read the update.',
                    tags: [],
                },
            },
        };
        await act(async () => {
            await client.mutate({
                mutation: SAVE_NEWS_BLOG_ARTICLE,
                variables: { input: { id, slug, expectedVersion: version, draft: article } },
            });
            await client.query({ query: NEWS_BLOG_WORKSPACE, fetchPolicy: 'network-only' });
        });

        // Reopening the editor reads this same detail from the production cache first.
        const cached = () =>
            client.readQuery<{ newsBlogArticle: BlogAdminArticle }>({
                query: NEWS_BLOG_ARTICLE,
                variables: { id },
            })?.newsBlogArticle;
        expect(cached()).toMatchObject({ version: version + 1, draft: article });

        await act(async () => {
            await client.mutate({
                mutation: PUBLISH_NEWS_BLOG_ARTICLE,
                variables: { id, expectedVersion: version + 1, acceptIssues: true },
            });
            await client.query({ query: NEWS_BLOG_WORKSPACE, fetchPolicy: 'network-only' });
        });
        expect(cached()).toMatchObject({ version: version + 2, draft: article, published: article });
    });
    it('preserves dirty text when a newer server version arrives and blocks conflicting saves', async () => {
        const f = await fixture();
        await f.edit();
        f.updateServer();
        await act(async () => button('重新读取文章').click());
        await act(async () => {
            await vi.waitFor(() => expect((button('保存草稿') as HTMLButtonElement).disabled).toBe(true));
        });
        expect(f.title().value).toBe('人工未保存标题');
        expect((button('保存草稿') as HTMLButtonElement).disabled).toBe(true);
        expect(f.writes).toEqual([]);
    });
    it('preserves existing cover bindings and keeps body-image attribution and use confirmation', async () => {
        const f = await fixture(true);
        const label = [...document.querySelectorAll('label')].find(x =>
            x.textContent?.includes('已核对封面图片'),
        )!;
        await act(async () => (label.querySelector('input') as HTMLInputElement).click());
        await act(async () => button('加入正文配图').click());
        await act(async () => button('保存草稿').click());
        await act(async () => {
            await vi.waitFor(() => expect(f.writes).toEqual(['save']));
        });
        expect(f.current().draft.cover).toMatchObject({
            kind: 'SOURCE',
            sourcePageUrl: 'https://openai.com/news/',
            rightsConfirmed: true,
        });
        expect(f.current().draft.illustrations[0]).toMatchObject({
            assetId: 'source-1',
            caption: '来源说明',
        });
    });
    it('edits structured Skill fields through the existing protected draft and save operation', async () => {
        const f = await fixture(false, true);
        const select = document.querySelector('section[aria-label="Skill 用途资料"] select');
        if (!(select instanceof HTMLSelectElement)) throw new Error('Missing edition selector');
        await act(async () => {
            if (select instanceof HTMLSelectElement) {
                select.value = 'research';
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
        await act(async () => button('保存草稿').click());
        await vi.waitFor(() => expect(f.writes).toEqual(['save']));
        expect(f.current().draft.skillProfile?.domain).toBe('research');
        expect(f.current().draft.body).toContain('预期输出：得到保留来源的整理结果');
        expect(document.body.textContent).not.toContain('重做封面');
        expect(document.body.textContent).not.toContain('上传替换封面');
    });
    it('saves English edits without replacing the Chinese draft title', async () => {
        const f = await fixture();
        const byLabel = (label: string) =>
            [...document.querySelectorAll('label')].find(field => field.textContent?.startsWith(label));
        const select = byLabel('编辑与预览语言')?.querySelector('select');
        if (!(select instanceof HTMLSelectElement)) throw new Error('Missing edition selector');
        await act(async () => {
            select.value = 'en';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const title = byLabel('标题')?.querySelector('input');
        expect(title?.value).toBe('');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
                title,
                'GSA expands access',
            );
            title?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => button('保存草稿').click());
        await vi.waitFor(() => expect(f.writes).toEqual(['save']));
        expect(f.current().draft.title).toBe('原有待审标题');
        expect(f.current().draft.translations?.en.title).toBe('GSA expands access');
    });
    it('saves the draft without triggering publication', async () => {
        const f = await fixture();
        await f.edit();
        await act(async () => button('保存草稿').click());
        await act(async () => {
            await vi.waitFor(() => expect(f.writes).toEqual(['save']));
        });
        expect((button('审核并发布') as HTMLButtonElement).disabled).toBe(true);
    });
});
