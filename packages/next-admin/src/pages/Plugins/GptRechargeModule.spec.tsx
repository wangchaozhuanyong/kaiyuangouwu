// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { adminSchema } from '../../../../store-management-plugin/src/gpt-recharge/api-extensions';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { GptRechargeModule } from './GptRechargeModule';
const schema = buildASTSchema({
    kind: Kind.DOCUMENT,
    definitions: [
        ...parse('type Query { fixture: Boolean } type Mutation { fixture: Boolean }').definitions,
        ...adminSchema.definitions,
    ],
});
const button = (text: string) =>
    [...document.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;
let root: ReturnType<typeof createRoot>;
let client: ApolloClient;
afterEach(async () => {
    await act(async () => root?.unmount());
    client?.stop();
    document.body.innerHTML = '';
});
it('loads the actual admin schema, saves a secret once, clears it, and preserves a dirty draft on refresh', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let config = {
        enabled: false,
        upstreamOrigin: 'https://executor.example.test',
        credentialConfigured: true,
        revision: 0,
    };
    const writes: any[] = [];
    const rootValue = {
        gptRechargeAdminConfig: () => config,
        updateGptRechargeConfig: ({ input }: any) => {
            writes.push(input);
            config = {
                enabled: input.enabled,
                upstreamOrigin: input.upstreamOrigin,
                credentialConfigured: true,
                revision: config.revision + 1,
            };
            return config;
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
    const node = document.createElement('div');
    document.body.append(node);
    root = createRoot(node);
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <FeatureHelpProvider>
                    <GptRechargeModule />
                </FeatureHelpProvider>
            </ApolloProvider>,
        ),
    );
    const change = async (selector: string, value: string) => {
        await act(async () => {
            const input = document.querySelector<HTMLInputElement>(selector)!;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    expect(document.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(config.upstreamOrigin);
    const secret = 'synthetic-service-key-for-admin-test-only';
    await change('input[type=password]', secret);
    await act(async () => button('保存当前店铺配置').click());
    expect(writes).toHaveLength(1);
    expect(writes[0].serviceKey).toBe(secret);
    expect(writes[0].expectedRevision).toBe(0);
    expect(document.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('');
    expect(JSON.stringify(client.cache.extract())).not.toContain(secret);
    await change('input[type=url]', 'https://draft.example.test');
    config = { ...config, revision: config.revision + 1, upstreamOrigin: 'https://changed.example.test' };
    await act(async () => button('重新读取').click());
    expect(document.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(
        'https://draft.example.test',
    );
    expect(button('保存当前店铺配置').disabled).toBe(true);
    expect(document.body.textContent).toContain('当前未保存草稿已保留');
});
