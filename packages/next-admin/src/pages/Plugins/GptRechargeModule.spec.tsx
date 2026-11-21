// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildASTSchema, graphql, Kind, parse, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { adminSchema } from '../../../../store-management-plugin/src/gpt-recharge/api-extensions';
import { clearAuthSession, setInitialActiveChannel } from '../../apollo';
import { ConfirmDialogProvider } from '../../components/ConfirmDialog';
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
    vi.restoreAllMocks();
    clearAuthSession();
    document.body.innerHTML = '';
});

async function mount(rootValue: Record<string, unknown>) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
    const rerender = () =>
        act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <FeatureHelpProvider>
                        <MemoryRouter>
                            <ConfirmDialogProvider>
                                <GptRechargeModule />
                            </ConfirmDialogProvider>
                        </MemoryRouter>
                    </FeatureHelpProvider>
                </ApolloProvider>,
            ),
        );
    await rerender();
    return rerender;
}

const input = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
const change = async (selector: string, value: string) => {
    await act(async () => {
        const input = document.querySelector<HTMLInputElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
};
const originalConfig = {
    enabled: false,
    upstreamOrigin: 'https://executor.example.test',
    credentialConfigured: true,
    partnerConfigured: false,
    legacyConfigured: true,
    revision: 0,
};

it('saves and clears credentials and protects every input against concurrent changes', async () => {
    let config = originalConfig;
    const writes: any[] = [];
    const rootValue = {
        gptRechargeAdminConfig: () => config,
        updateGptRechargeConfig: ({ input }: any) => {
            writes.push(input);
            config = {
                enabled: input.enabled,
                upstreamOrigin: input.upstreamOrigin,
                credentialConfigured: true,
                partnerConfigured: Boolean(input.partnerApiKey) || config.partnerConfigured,
                legacyConfigured: true,
                revision: config.revision + 1,
            };
            return config;
        },
    };
    await mount(rootValue);
    expect(document.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(config.upstreamOrigin);
    const secret = 'synthetic-service-key-for-admin-test-only';
    await change('input[type=password]', secret);
    await act(async () => button('保存当前店铺配置').click());
    expect(writes).toHaveLength(1);
    expect(writes[0].serviceKey).toBe(secret);
    expect(writes[0].expectedRevision).toBe(0);
    expect(document.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('');
    expect(JSON.stringify(client.cache.extract())).not.toContain(secret);
    const apiKey = 'rp_' + 'a'.repeat(24) + '.' + 'b'.repeat(43);
    await change('input[name="partnerApiKey"]', apiKey);
    await act(async () => button('保存当前店铺配置').click());
    expect(writes[1].partnerApiKey).toBe(apiKey);
    expect(writes[1].serviceKey).toBeUndefined();
    expect(JSON.stringify(client.cache.extract())).not.toContain(apiKey);

    // Editing only a password field still owns the server revision shown when it was entered.
    await change('input[name="partnerApiKey"]', apiKey);
    config = { ...config, revision: config.revision + 1 };
    await act(async () => button('重新读取').click());
    expect(document.querySelector<HTMLInputElement>('input[name="partnerApiKey"]')?.value).toBe(apiKey);
    expect(button('保存当前店铺配置').disabled).toBe(true);
    expect(document.body.textContent).toContain('当前未保存草稿已保留');
    await act(async () =>
        document
            .querySelector('form')
            ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    expect(writes).toHaveLength(2);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('放弃草稿并重新读取').click());
    expect(document.querySelector<HTMLInputElement>('input[name="partnerApiKey"]')?.value).toBe('');
    await change('input[type=password]', secret);
    await act(async () => button('保存当前店铺配置').click());
    expect(writes[2].expectedRevision).toBe(config.revision - 1);

    await change('input[type=url]', 'https://draft.example.test');
    config = { ...config, revision: config.revision + 1, upstreamOrigin: 'https://changed.example.test' };
    await act(async () => button('重新读取').click());
    expect(document.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(
        'https://draft.example.test',
    );
    expect(button('保存当前店铺配置').disabled).toBe(true);
    expect(document.body.textContent).toContain('当前未保存草稿已保留');
});

it('only releases the inspected revision after confirmation and makes uncertain results read-only again', async () => {
    const synthetic = 'KC-' + 'A'.repeat(15);
    const missing = 'KC-' + 'B'.repeat(15);
    let revision = 3;
    let pending = true;
    const read = vi.fn(({ code }: { code: string }) => ({
        pending: code === synthetic && pending,
        revision,
    }));
    const recover = vi.fn(({ code, expectedRevision }: { code: string; expectedRevision: number }) => {
        if (code !== synthetic || expectedRevision !== revision)
            throw new Error('Synthetic conflict ' + code);
        pending = false;
        return { pending, revision: ++revision };
    });
    const rerender = await mount({
        gptRechargeAdminConfig: () => originalConfig,
        gptRechargeSubmissionReview: read,
        recoverGptRechargeSubmission: recover,
    });
    const enterCode = (code: string) => change('input[name="rechargeSubmissionCode"]', code);
    const checkCode = () => act(async () => button('核对原兑换码').click());
    const confirmReview = () =>
        act(async () => {
            const confirm = [
                ...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
            ].find(node => node.textContent?.trim() === '核对并解除')!;
            confirm.click();
            confirm.click();
        });

    expect(read).not.toHaveBeenCalled();
    expect(button('核对并解除锁定')).toBeUndefined();
    await enterCode(missing);
    await checkCode();
    expect(document.body.textContent).toContain('当前没有可解除的待核对记录');
    expect(button('核对并解除锁定')).toBeUndefined();

    await enterCode(synthetic);
    await checkCode();
    expect(document.body.textContent).toContain('找到待核对的受理记录');
    await act(async () => button('核对并解除锁定').click());
    expect(recover).not.toHaveBeenCalled();
    revision++;
    await confirmReview();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover.mock.calls[0][0]).toEqual({ code: synthetic, expectedRevision: 3 });
    expect(button('核对并解除锁定')).toBeUndefined();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('记录可能已更新或上游尚未确认');
    expect(document.body.textContent).not.toContain(synthetic);

    await checkCode();
    await act(async () => button('核对并解除锁定').click());
    await confirmReview();
    expect(recover).toHaveBeenCalledTimes(2);
    expect(recover.mock.calls[1][0]).toEqual({ code: synthetic, expectedRevision: 4 });
    expect(document.body.textContent).toContain('已解除锁定');
    expect(input('rechargeSubmissionCode').value).toBe('');
    expect(JSON.stringify(client.cache.extract())).not.toContain(synthetic);

    await enterCode(synthetic);
    setInitialActiveChannel('synthetic-other-store');
    await rerender();
    expect(input('rechargeSubmissionCode').value).toBe('');
    expect(button('核对原兑换码').disabled).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
});
