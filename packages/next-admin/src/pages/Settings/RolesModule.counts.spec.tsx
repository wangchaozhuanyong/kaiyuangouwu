// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { Kind } from 'graphql';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';

import { FeatureHelpProvider } from '../../components/FeatureHelp';

import { RolesModule } from './RolesModule';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => {
        cleanups.splice(0).forEach(cleanup => cleanup());
        await Promise.resolve();
    });
});

async function renderCounts({ count = 2, failure = false, pending = false } = {}) {
    const fields: string[][] = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const names = operation.query.definitions.flatMap(definition =>
                        definition.kind === Kind.OPERATION_DEFINITION
                            ? definition.selectionSet.selections.flatMap(selection =>
                                  selection.kind === Kind.FIELD ? [selection.name.value] : [],
                              )
                            : [],
                    );
                    fields.push(names);
                    if (pending) return;
                    if (failure) {
                        observer.error(new Error('Synthetic team read failure'));
                        return;
                    }
                    const role = {
                        id: 'role-1',
                        code: 'custom-role',
                        description: '测试角色',
                        createdAt: '2026-10-26',
                        updatedAt: '2026-10-26',
                        permissions: [],
                        channels: [],
                    };
                    const data = {
                        activeAdministrator: { id: 'actor' },
                        myAdministratorAccess: {
                            id: 'actor-access',
                            scope: 'STORE',
                            authority: 'ADMIN',
                            status: 'ACTIVE',
                            channel: null,
                        },
                        manageableRoles: [role],
                        manageableChannels: [],
                        permissionPolicyCatalog: { permissions: [], templates: [] },
                        manageableAdministrators: Array.from({ length: count }, (_, index) => ({
                            id: `access-${index}`,
                            scope: 'STORE',
                            authority: 'STAFF',
                            status: 'ACTIVE',
                            channel: null,
                            administrator: {
                                id: `member-${index}`,
                                createdAt: '2026-10-26',
                                updatedAt: '2026-10-26',
                                firstName: '测试',
                                lastName: `${index}`,
                                emailAddress: `member${index}@example.test`,
                                user: {
                                    id: `user-${index}`,
                                    identifier: `member-${index}`,
                                    lastLogin: null,
                                    roles: [{ id: role.id, code: role.code, description: role.description }],
                                },
                            },
                        })),
                    };
                    observer.next({
                        data: Object.fromEntries(names.map(name => [name, data[name as keyof typeof data]])),
                    });
                    observer.complete();
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
    await act(
        async () =>
            await Promise.resolve(
                root.render(
                    <ApolloProvider client={client}>
                        <MemoryRouter initialEntries={['/settings/team/roles']}>
                            <FeatureHelpProvider>
                                <RolesModule />
                            </FeatureHelpProvider>
                        </MemoryRouter>
                    </ApolloProvider>,
                ),
            ),
    );
    return { host, fields };
}

it.each([2, 0])(
    'reads manageable employees in the standalone role page and displays the actual count %s',
    async count => {
        const { host, fields } = await renderCounts({ count });
        const cell = host.querySelector('[data-label="关联员工"]');
        expect(cell?.textContent?.trim()).toBe(`${count} 人`);
        expect(fields[0]).toContain('manageableAdministrators');
        expect(fields[0]).not.toContain('administrators');
    },
);

it.each([{ pending: true }, { failure: true }])(
    'does not present an unread/failed count as zero: %j',
    async options => {
        const { host } = await renderCounts(options);
        expect(host.querySelector('[data-label="关联员工"]')?.textContent).not.toBe('0 人');
        expect(host.textContent).not.toContain('0 人');
        if (options.failure) expect(host.textContent).toContain('失败');
    },
);
