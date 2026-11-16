// organize-imports-ignore -- The e2e entry is outside tsconfig.app.json's automatic JSX scope.
import React from 'react';
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildSchema, graphql, print } from 'graphql';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { adminSchema } from '../../../store-management-plugin/src/tax-free-address/api-extensions';
import { AdminPageWorkspace } from '../../src/components/AdminPageWorkspace';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { TaxFreeAddressModule } from '../../src/pages/Plugins/TaxFreeAddressModule';

const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const schema = buildSchema(
    'scalar DateTime\ntype Query { fixture: Boolean }\ntype Mutation { fixture: Boolean }\n' +
        print(adminSchema),
);
let generated = 24,
    revision = 0;
let rows = Array.from({ length: generated }, (_, index) => ({
    id: String(index + 1),
    country: 'United States',
    line1: 100 + index + ' Example Street',
    city: index % 2 ? 'Manchester' : 'Portland',
    state: index % 2 ? 'New Hampshire' : 'Oregon',
    postalCode: index % 2 ? '03101' : '97201',
    status: 'unused',
    createdAt: '2026-11-16T00:00:00.000Z',
    usedAt: null as string | null,
}));
const fixture = { writes: 0 };
(window as any).__taxFixture = fixture;
const rootValue = {
    taxFreeAddresses: ({ input }: any) => {
        const filtered = rows.filter(
            row =>
                row.status === input.status && row.line1.toLowerCase().includes(input.keyword.toLowerCase()),
        );
        return {
            items: filtered.slice(input.skip, input.skip + input.take),
            totalItems: filtered.length,
            unused: rows.filter(row => row.status === 'unused').length,
            used: rows.filter(row => row.status === 'used').length,
            retained: rows.length,
            generated,
            revision,
            capacity: 89000,
            limit: 1000,
        };
    },
    generateTaxFreeAddresses: ({ count }: any) => {
        fixture.writes++;
        revision++;
        for (let index = 0; index < count; index++)
            rows.push({
                ...rows[0],
                id: String(++generated),
                line1: 100 + generated + ' Example Street',
                status: 'unused',
                usedAt: null,
            });
        return { count };
    },
    takeTaxFreeAddress: ({ id, requestId }: any) => {
        const address = rows.find(row => row.id === id)!;
        fixture.writes++;
        revision++;
        address.status = 'used';
        address.usedAt = new Date().toISOString();
        return { requestId, address, serverNow: new Date().toISOString(), nextAllowedAt: null };
    },
    clearUsedTaxFreeAddresses: ({ expectedRevision }: any) => {
        if (expectedRevision !== revision) throw new Error('TAX_ADDRESS_CONFLICT');
        fixture.writes++;
        revision++;
        const count = rows.filter(row => row.status === 'used').length;
        rows = rows.filter(row => row.status === 'unused');
        return { count };
    },
};
const client = new ApolloClient({
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
const root = createRoot(document.getElementById('root')!);
root.render(
    <MemoryRouter initialEntries={['/plugins/tax-free-address']}>
        <ApolloProvider client={client}>
            <FeatureHelpProvider>
                <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
                    <p className="mb-4 text-sm text-slate-500">本地合成数据验收 · 不连接业务服务</p>
                    <AdminPageWorkspace page="tax-free-address" active>
                        <TaxFreeAddressModule />
                    </AdminPageWorkspace>
                </div>
            </FeatureHelpProvider>
        </ApolloProvider>
    </MemoryRouter>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
