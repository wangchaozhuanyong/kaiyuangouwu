import { ApolloProvider } from '@apollo/client/react';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { StoreAllocationMatrixModule } from '../../src/pages/Catalog/StoreAllocationMatrixModule';
import { createCatalogSyncFixture } from './model';

const parameters = new URLSearchParams(location.search);
const fixture = createCatalogSyncFixture({
    takeover: parameters.get('case') === 'takeover',
    failReadback: parameters.get('case') === 'readback-error',
});
createRoot(document.getElementById('root')!).render(
    // This fixture is outside src/tsconfig; keep it independent of JSX runtime defaults.
    React.createElement(
        React.Fragment,
        null,
        <ApolloProvider client={fixture.client}>
            <FeatureHelpProvider>
                <main className="min-h-screen bg-slate-50 p-3">
                    <p role="status" className="p-3 text-sm">
                        本地合成数据验收 · 不连接生产环境、不创建真实订单。
                    </p>
                    <StoreAllocationMatrixModule />
                </main>
            </FeatureHelpProvider>
        </ApolloProvider>,
    ),
);
