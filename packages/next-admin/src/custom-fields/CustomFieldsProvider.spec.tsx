// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { GraphQLError } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CustomFieldsPageBoundary, CustomFieldsProvider } from './CustomFieldsProvider';
import { useCustomFieldLanguages } from './custom-fields-context';

const cleanups: Array<() => void> = [];
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(fn => fn()));
});
const denied = {
    data: null,
    errors: [
        new GraphQLError('你当前无权执行此操作', {
            path: ['globalSettings'],
            extensions: { code: 'FORBIDDEN' },
        }),
    ],
};
const ready = {
    data: {
        globalSettings: {
            __typename: 'GlobalSettings',
            availableLanguages: ['zh_Hans'],
            serverConfig: { __typename: 'ServerConfig', entityCustomFields: [] },
        },
    },
};
function Content() {
    return <main>账号安全与恢复码 / 商品表单 / {useCustomFieldLanguages().join(',')}</main>;
}
async function render(page: string, respond: (attempt: number) => Record<string, unknown> | undefined) {
    let attempts = 0;
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            () =>
                new Observable(observer => {
                    const result = respond(++attempts);
                    if (result) {
                        observer.next(result);
                        observer.complete();
                    }
                }),
        ),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
        root.unmount();
        client.stop();
        host.remove();
    });
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <CustomFieldsProvider>
                    <CustomFieldsPageBoundary page={page}>
                        <Content />
                    </CustomFieldsPageBoundary>
                </CustomFieldsProvider>
            </ApolloProvider>,
        ),
    );
    return { host, attempts: () => attempts };
}
it('keeps account security available when unrelated custom field configuration is denied', async () => {
    const { host } = await render('/profile', () => denied);
    expect(host.textContent).toContain('账号安全与恢复码');
    expect(host.textContent).not.toContain('后台字段配置读取失败');
});
it('does not postpone account security while custom fields are pending', async () => {
    const { host } = await render('/profile', () => undefined);
    expect(host.textContent).toContain('账号安全与恢复码');
    expect(host.textContent).not.toContain('正在读取后台字段配置');
});
it('does not mount dependent business forms before their configuration is available', async () => {
    const { host } = await render('/catalog/list', () => undefined);
    expect(host.textContent).toContain('正在读取后台字段配置');
    expect(host.querySelector('main')).toBeNull();
});
it('keeps dependent pages failed closed and retries only the configuration read', async () => {
    const { host, attempts } = await render('/catalog/list', attempt => (attempt === 1 ? denied : ready));
    expect(host.textContent).toContain('后台字段配置读取失败');
    expect(host.querySelector('main')).toBeNull();
    await act(async () => host.querySelector('button')?.click());
    expect(attempts()).toBe(2);
    expect(host.textContent).toContain('商品表单 / zh_Hans');
    expect(host.textContent).not.toContain('后台字段配置读取失败');
});
