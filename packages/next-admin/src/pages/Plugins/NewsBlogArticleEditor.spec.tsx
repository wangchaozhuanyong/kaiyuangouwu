// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminSchema } from '../../../../news-blog-plugin/src/schema';
import { emptyBlogDraft } from '../../../../storefront-content-plugin/src/shared/news-blog';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
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
async function fixture(withImages = false) {
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
        published: null,
        issues: [],
    };
    const writes: string[] = [];
    const rootValue = {
        newsBlogArticle: () => article,
        newsBlogHistory: () => [],
        saveNewsBlogArticle: ({ input }: any) => {
            writes.push('save');
            article = { ...article, ...input, version: article.version + 1 };
            return article;
        },
        publishNewsBlogArticle: () => {
            writes.push('publish');
            return article;
        },
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
                            <NewsBlogArticleEditor
                                id="1"
                                execute={async action => {
                                    await action();
                                }}
                                onSaved={() => {}}
                                onClose={() => {}}
                            />
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
    it('selects imported source images and keeps their attribution and use confirmation in the saved draft', async () => {
        const f = await fixture(true);
        await act(async () => button('选为封面').click());
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
