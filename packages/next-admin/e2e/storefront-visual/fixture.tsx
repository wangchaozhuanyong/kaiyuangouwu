import { ApolloClient, ApolloLink, InMemoryCache, createHttpLink } from '@apollo/client';
import { ApolloProvider, useQuery } from '@apollo/client/react';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { STOREFRONT_CONTENT_QUERY, type StorefrontContentResult } from '../../src/graphql/storefront.graphql';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { BlockPreview } from '../../src/pages/Storefront/storefront-block-preview';
import { cloneContentBlock } from '../../src/pages/Storefront/storefront-content-utils';
import { StorefrontVisualPresetPanel } from '../../src/pages/Storefront/StorefrontVisualPresetPanel';

// Test-only local API and synthetic test-session credentials, never a production account.
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink((operation, forward) => {
        operation.setContext(({ headers = {} }) => ({
            headers: {
                authorization: `Bearer ${sessionStorage.getItem('local-test-admin-token') ?? ''}`,
                'vendure-token': localStorage.getItem('vendure-active-channel-token') ?? '',
                ...headers,
            },
        }));
        return forward(operation);
    }).concat(createHttpLink({ uri: 'http://127.0.0.1:5299/admin-api' })),
});
export function AuthPreviewFixture() {
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, { fetchPolicy: 'no-cache' });
    const block = query.data?.storefrontContentBlocks.find(value => value.type === 'AUTH_LOGIN');
    if (!block) return <p role="status">Loading auth preview</p>;
    const draft = cloneContentBlock(block);
    // The test asset middleware serves the persisted raw identifier on its loopback API.
    if (draft.imageAsset)
        draft.imageAsset.preview = `http://127.0.0.1:5299/assets/${draft.imageAsset.preview}`;
    return (
        <div style={{ maxWidth: 340 }}>
            <BlockPreview block={draft} language="zh_Hans" />
        </div>
    );
}
export function Fixture() {
    const stores = new URLSearchParams(location.search).get('stores')?.split(',') ?? [];
    const [channel, setChannel] = useState(localStorage.getItem('vendure-active-channel-token') ?? stores[0]);
    return (
        <ApolloProvider client={client}>
            <AdminPermissionsContext.Provider
                value={{
                    permissions: ['ReadStorefrontContent', 'UpdateStorefrontContent'],
                    hasAnyPermission: () => true,
                }}
            >
                <main style={{ maxWidth: 1100, margin: '24px auto', padding: 20 }}>
                    <label>
                        测试店铺
                        <select
                            aria-label="测试店铺"
                            value={channel}
                            onChange={event => {
                                setChannel(event.target.value);
                                localStorage.setItem('vendure-active-channel-token', event.target.value);
                                void client.resetStore();
                            }}
                        >
                            {stores.map(store => (
                                <option key={store}>{store}</option>
                            ))}
                        </select>
                    </label>
                    <FeatureHelpProvider>
                        {new URLSearchParams(location.search).has('preview') ? (
                            <AuthPreviewFixture />
                        ) : (
                            <StorefrontVisualPresetPanel />
                        )}
                    </FeatureHelpProvider>
                </main>
            </AdminPermissionsContext.Provider>
        </ApolloProvider>
    );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing local fixture root');
createRoot(root).render(React.createElement(Fixture));
