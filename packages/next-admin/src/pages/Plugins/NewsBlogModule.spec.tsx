// organize-imports-ignore -- Preserve ESLint import groups.
// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

import { adminSchema } from '../../../../news-blog-plugin/src/schema';
import { emptyBlogDraft } from '../../../../storefront-content-plugin/src/shared/news-blog';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';

import { NewsBlogModule } from './NewsBlogModule';

let root: ReturnType<typeof createRoot>;
let client: ApolloClient;
afterEach(async () => {
    await act(() => Promise.resolve(root?.unmount()));
    client?.stop();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
});
it('shows retained source evidence and manual editing in zero-cost mode without scheduling generation or publication', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const schema = buildASTSchema({
        kind: Kind.DOCUMENT,
        definitions: [
            ...parse(
                'scalar JSON scalar DateTime type Query { fixture:Boolean } type Mutation { fixture:Boolean }',
            ).definitions,
            ...adminSchema.definitions,
        ],
    });
    const writes = vi.fn();
    const linkedArticle = {
        id: '91',
        slug: 'linked-source',
        version: 1,
        state: 'DRAFT',
        publishedAt: null,
        published: null,
        draft: {
            ...emptyBlogDraft(),
            sources: [
                {
                    label: '原始官方来源',
                    url: 'https://openai.com/news/fixture-0',
                    accessedAt: '2026-11-03',
                },
            ],
        },
        issues: [],
    };
    const openDraft = vi.fn((_input: { sourceId: string }) => linkedArticle);
    const rootValue = {
        newsBlogSettings: () => ({
            version: 1,
            enabled: true,
            freeMode: true,
            freeAutoPublish: false,
            skillEnabled: false,
        }),
        newsBlogArticleList: () => ({ items: [], totalItems: 0 }),
        newsBlogSources: () => [],
        openNewsBlogSourceDraft: openDraft,
        newsBlogArticle: () => linkedArticle,
        newsBlogHistory: () => [],
        newsBlogSourceItems: () =>
            ['PAGE_TEXT', 'OFFICIAL_RSS'].map((evidenceMode, index) => ({
                id: String(index + 1),
                sourceCode: 'openai',
                url: `https://openai.com/news/fixture-${index}`,
                title: `来源 ${index}`,
                body: `保留资料 ${index}`,
                category: 'CHATGPT',
                status: 'READY',
                evidenceMode,
                sourcePublishedAt: '2026-11-03T10:00:00Z',
                fetchedAt: '2026-11-03T10:10:00Z',
            })),
        requestNewsBlogTask: writes,
        publishNewsBlogArticle: writes,
        saveNewsBlogArticle: writes,
    };
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    void graphql({
                        schema,
                        source: print(operation.query),
                        variableValues: operation.variables,
                        rootValue,
                    }).then(result => {
                        observer.next(result);
                        observer.complete();
                    });
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(() =>
        Promise.resolve(
            root.render(
                <ApolloProvider client={client}>
                    <MemoryRouter initialEntries={['/?tab=sources']}>
                        <AdminPermissionsContext.Provider
                            value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                        >
                            <ConfirmDialogProvider>
                                <FeatureHelpProvider>
                                    <NewsBlogModule />
                                </FeatureHelpProvider>
                            </ConfirmDialogProvider>
                        </AdminPermissionsContext.Provider>
                    </MemoryRouter>
                </ApolloProvider>,
            ),
        ),
    );
    await act(async () => {
        await vi.waitFor(() => expect(host.textContent).toContain('官方订阅摘要（正文尚未获取）'));
    });
    expect(host.textContent).toContain('网页正文（自动提取）');
    expect(host.textContent).toContain('保留资料 0');
    expect(host.textContent).toContain('保留资料 1');
    expect(host.textContent).toContain('用此来源建稿');
    expect(host.textContent).not.toContain('生成待审图文');
    expect(openDraft).not.toHaveBeenCalled();
    const create = [...host.querySelectorAll('button')].find(x => x.textContent === '用此来源建稿');
    if (!create) throw new Error('Missing source draft action');
    await act(async () => create.click());
    await vi.waitFor(async () => {
        await act(() => Promise.resolve());
        expect(host.textContent).toContain('文章编辑与审核');
    });
    expect(openDraft).toHaveBeenCalledTimes(1);
    expect(openDraft.mock.calls[0]?.[0]).toMatchObject({ sourceId: '1' });
    expect(host.textContent).toContain('原始官方来源');
    expect(writes).not.toHaveBeenCalled();
});
