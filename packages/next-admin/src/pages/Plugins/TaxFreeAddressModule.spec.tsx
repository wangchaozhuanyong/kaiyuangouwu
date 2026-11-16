// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { buildSchema, graphql, print } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { adminSchema } from '../../../../store-management-plugin/src/tax-free-address/api-extensions';
import { FeatureHelpProvider } from '../../components/FeatureHelp';
import { resourceDomains } from '../../runtime/admin-resource-events';
import { canAccessAdminPath } from '../../utils/admin-permissions';
import {
    TAX_ADDRESS_CLEAR,
    TAX_ADDRESS_GENERATE,
    TAX_ADDRESS_TAKE,
    TaxFreeAddressModule,
} from './TaxFreeAddressModule';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const schema = buildSchema(
    'scalar DateTime\ntype Query { fixture: Boolean }\ntype Mutation { fixture: Boolean }\n' +
        print(adminSchema),
);
const date = '2026-11-16T00:00:00.000Z';
const row = (id: number) => ({
    id: String(id),
    country: 'United States',
    line1: 100 + id + ' Example St',
    city: 'Manchester',
    state: 'New Hampshire',
    postalCode: '03101',
    status: 'unused',
    createdAt: date,
    usedAt: null as string | null,
});
const mounts: Array<{ root: ReturnType<typeof createRoot>; client: ApolloClient; node: HTMLElement }> = [];
afterEach(async () => {
    for (const { root, client, node } of mounts.splice(0)) {
        await act(async () => root.unmount());
        client.stop();
        node.remove();
    }
    vi.restoreAllMocks();
});
const flush = async () => {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 25));
    });
};
async function fixture(usedRows = 0, initialPage = 2) {
    let rows: ReturnType<typeof row>[] = Array.from({ length: usedRows }, (_, index) => ({
        ...row(index + 1),
        status: 'used',
        usedAt: date,
    }));
    let revision = 0,
        generated = usedRows,
        failRead = false;
    const writes: Array<{ field: string; args: any }> = [];
    const rootValue = {
        taxFreeAddresses: ({ input }: any) => {
            if (failRead) throw new Error('fixture read failure');
            if (input.skip > 1000) throw new Error('TAX_ADDRESS_INVALID_QUERY');
            const matches = rows.filter(
                row => row.status === input.status && row.line1.includes(input.keyword),
            );
            return {
                items: matches.slice(input.skip, input.skip + input.take),
                totalItems: matches.length,
                unused: rows.filter(row => row.status === 'unused').length,
                used: rows.filter(row => row.status === 'used').length,
                retained: rows.length,
                generated,
                revision,
                capacity: 89000,
                limit: 1000,
            };
        },
        generateTaxFreeAddresses: (args: any) => {
            writes.push({ field: 'generate', args });
            revision++;
            for (let index = 0; index < args.count; index++) rows.push(row(++generated));
            return { count: args.count };
        },
        takeTaxFreeAddress: (args: any) => {
            writes.push({ field: 'take', args });
            revision++;
            const address = rows.find(row => row.id === args.id)!;
            address.status = 'used';
            address.usedAt = date;
            return { requestId: args.requestId, address, serverNow: date, nextAllowedAt: null };
        },
        clearUsedTaxFreeAddresses: (args: any) => {
            if (args.expectedRevision !== revision) throw new Error('TAX_ADDRESS_CONFLICT');
            writes.push({ field: 'clear', args });
            revision++;
            const count = rows.filter(row => row.status === 'used').length;
            rows = rows.filter(row => row.status !== 'used');
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
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    mounts.push({ root, node, client });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await act(async () =>
        root.render(
            <MemoryRouter
                initialEntries={[
                    usedRows
                        ? '/plugins/tax-free-address?status=used&page=' + initialPage + '&take=20'
                        : '/plugins/tax-free-address',
                ]}
            >
                <ApolloProvider client={client}>
                    <FeatureHelpProvider>
                        <TaxFreeAddressModule />
                    </FeatureHelpProvider>
                </ApolloProvider>
            </MemoryRouter>,
        ),
    );
    await flush();
    const button = (text: string) =>
        [...document.querySelectorAll('button')].filter(item => item.textContent?.trim() === text).at(-1)!;
    return {
        node,
        writes,
        button,
        failRead: () => {
            failRead = true;
        },
    };
}
it('uses actual Admin schema for generation, claim/copy, state filters, and versioned clearing', async () => {
    const f = await fixture();
    expect(f.node.textContent).toContain('暂无未使用地址');
    await act(async () => f.button('生成地址').click());
    const form = document.querySelector('[role=dialog] form')!;
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await flush();
    expect(f.writes).toEqual([{ field: 'generate', args: { count: 100 } }]);
    await act(async () => f.button('提取并复制').click());
    await flush();
    expect(f.writes.filter(write => write.field === 'take')).toHaveLength(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('邮编（英语）：03101'),
    );
    await act(async () => f.button('已使用 (1)').click());
    await flush();
    await act(async () => f.button('复制地址').click());
    expect(f.writes.filter(write => write.field === 'take')).toHaveLength(1);
    await act(async () => f.button('清理已使用').click());
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('1 条');
    await act(async () =>
        document
            .querySelector('[role=dialog] form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(f.writes.at(-1)).toEqual({ field: 'clear', args: { expectedRevision: 2 } });
    expect(f.node.textContent).toContain('暂无已使用地址');
});
it('does not replay generation when its readback fails', async () => {
    const f = await fixture();
    await act(async () => f.button('生成地址').click());
    f.failRead();
    await act(async () =>
        document
            .querySelector('[role=dialog] form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(f.writes).toHaveLength(1);
    expect(f.node.textContent).toContain('最新列表读取失败');
    await act(async () => f.button('刷新').click());
    await flush();
    expect(f.writes).toHaveLength(1);
});
it('returns to page one when clearing all used records from a later page', async () => {
    const f = await fixture(25);
    expect(f.node.textContent).toContain('第 2 页');
    await act(async () => f.button('清理已使用').click());
    await act(async () =>
        document
            .querySelector('[role=dialog] form')!
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    );
    await flush();
    expect(f.node.textContent).toContain('暂无已使用地址');
    expect(f.node.textContent).toContain('第 1 页');
    expect(f.writes).toEqual([{ field: 'clear', args: { expectedRevision: 0 } }]);
});
it('restricts the pool route to SuperAdmin and maps every write to plugin invalidation', () => {
    expect(canAccessAdminPath('/plugins/tax-free-address', ['SuperAdmin'])).toBe(true);
    expect(canAccessAdminPath('/plugins/tax-free-address', ['ReadCustomer'])).toBe(false);
    for (const operation of [TAX_ADDRESS_CLEAR, TAX_ADDRESS_GENERATE, TAX_ADDRESS_TAKE]) {
        expect(resourceDomains(operation)).toContain('plugins');
    }
});
it('normalizes an out-of-range bookmarked page without sending an invalid API offset', async () => {
    const f = await fixture(25, 100);
    await flush();
    expect(f.node.textContent).toContain('第 2 页');
    expect(f.node.textContent).toContain('125 Example St');
    expect(f.node.textContent).not.toContain('列表读取失败');
    expect(f.writes).toHaveLength(0);
});
