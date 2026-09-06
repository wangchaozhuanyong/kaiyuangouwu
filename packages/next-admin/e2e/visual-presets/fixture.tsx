import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { StorefrontModule } from '../../src/pages/Storefront/StorefrontModule';

// Browser fixture: no connection to a real store or account.
const presets: Record<string, { channelId: string; presetId: string; revision: string }> = {
    a: { channelId: 'a', presetId: 'classic', revision: 'default' },
    b: { channelId: 'b', presetId: 'classic', revision: 'default' },
};
const readbackFault = { enabled: false, successfulWrites: 0 };

export function Fixture() {
    const [channelId, setChannelId] = useState('a');
    const [requests, setRequests] = useState(0);
    const [errorMode, setErrorMode] = useState(false);
    const [readbackFailure, setReadbackFailure] = React.useState(false);
    const client = useMemo(
        () =>
            new ApolloClient({
                cache: new InMemoryCache(),
                link: new ApolloLink(
                    operation =>
                        new Observable(observer => {
                            const channel = {
                                __typename: 'Channel',
                                id: channelId,
                                code: channelId === 'a' ? '测试店铺 A' : '测试店铺 B',
                                token: channelId,
                                defaultLanguageCode: 'zh_Hans',
                                availableLanguageCodes: ['zh_Hans', 'en'],
                            };
                            const theme = () => ({
                                __typename: 'StorefrontVisualPreset',
                                ...presets[channelId],
                            });
                            const handle = setTimeout(() => {
                                if (operation.operationName === 'NextAdminUpdateStorefrontVisualPreset') {
                                    setRequests(value => value + 1);
                                    const input = operation.variables.input;
                                    if (
                                        errorMode ||
                                        input.channelId !== channelId ||
                                        input.expectedRevision !== presets[channelId].revision
                                    ) {
                                        observer.next({
                                            errors: [{ message: '皮肤设置已被其他管理员更新，请刷新后重试' }],
                                        });
                                    } else {
                                        presets[channelId] = {
                                            channelId,
                                            presetId: input.presetId,
                                            revision: String(Date.now()),
                                        };
                                        readbackFault.successfulWrites++;
                                        observer.next({ data: { updateStorefrontVisualPreset: theme() } });
                                    }
                                } else if (operation.operationName === 'NextAdminStorefrontVisualPreset') {
                                    if (readbackFault.enabled && readbackFault.successfulWrites > 0) {
                                        observer.error(new Error('模拟保存后的回读失败'));
                                        return;
                                    }
                                    observer.next({
                                        data: { activeChannel: channel, storefrontVisualPreset: theme() },
                                    });
                                } else if (operation.operationName === 'NextAdminStorefrontContent') {
                                    observer.next({
                                        data: {
                                            activeChannel: channel,
                                            storefrontContentSettings: {
                                                __typename: 'StorefrontContentSettings',
                                                heroAutoplayIntervalSeconds: 5,
                                                configuredBlockTypes: [],
                                            },
                                            storefrontContentBlocks: [],
                                        },
                                    });
                                } else observer.next({ data: {} });
                                observer.complete();
                            }, 40);
                            return () => clearTimeout(handle);
                        }),
                ),
            }),
        [channelId, errorMode],
    );
    return (
        <>
            <div
                style={{
                    padding: 12,
                    background: '#172b40',
                    color: 'white',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                }}
            >
                <strong>本地皮肤功能验收 · 示例数据</strong>
                <label>
                    测试店铺{' '}
                    <select value={channelId} onChange={event => setChannelId(event.target.value)}>
                        <option value="a">测试店铺 A</option>
                        <option value="b">测试店铺 B</option>
                    </select>
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={errorMode}
                        onChange={event => setErrorMode(event.target.checked)}
                    />
                    模拟保存冲突
                </label>
                <output data-testid="save-count">{requests}</output>
                <label>
                    <input
                        type="checkbox"
                        checked={readbackFailure}
                        onChange={event => {
                            readbackFault.enabled = event.target.checked;
                            setReadbackFailure(event.target.checked);
                        }}
                    />
                    模拟回读失败
                </label>
                <output data-testid="persisted-preset">{presets[channelId].presetId}</output>
            </div>
            <div style={{ height: 'calc(100dvh - 52px)' }}>
                <ApolloProvider client={client}>
                    <AdminPermissionsContext.Provider
                        value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                    >
                        <FeatureHelpProvider>
                            <StorefrontModule key={`${channelId}:${errorMode}`} />
                        </FeatureHelpProvider>
                    </AdminPermissionsContext.Provider>
                </ApolloProvider>
            </div>
        </>
    );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
