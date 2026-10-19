import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { getOperationAST } from 'graphql';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
    ADMIN_CAPABILITY_DEFINITIONS,
    adminCapabilityScopeAllows,
} from '../../../common/src/admin-capabilities';
import {
    defaultStorefrontSeoDocument,
    defaultStorefrontSeoSettings,
    type StorefrontSeoPayload,
} from '../../../store-management-plugin/src/seo/storefront-seo.contract';
import { setInitialActiveChannel } from '../../src/apollo';
import { AdminPageWorkspace } from '../../src/components/AdminPageWorkspace';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import type { StorefrontSeoRecord } from '../../src/graphql/storefront-seo.graphql';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { AppShell } from '../../src/layouts/AppShell';
import { StorefrontSeoEntityModule } from '../../src/pages/Storefront/StorefrontSeoEntityModule';
import { StorefrontSeoModule } from '../../src/pages/Storefront/StorefrontSeoModule';
import { ThemeProvider } from '../../src/theme/ThemeProvider';

// Actual component, Apollo cache, managed query runtime and page refresh. No real accounts or data.
const records = new Map<string, StorefrontSeoRecord>();
const params = new URLSearchParams(location.search);
const shell = params.has('shell');
const large = params.has('large');
const fixture = { channelId: 'synthetic-a', failReads: false, operations: [] as string[], writes: 0 };
Object.assign(window, { seoFixture: fixture });
const key = (input: { targetType: string; targetId: string; languageCode: string }) =>
    `${fixture.channelId}:${input.targetType}:${input.targetId}:${input.languageCode}`;
const record = (input: {
    targetType: StorefrontSeoRecord['targetType'];
    targetId: string;
    languageCode: string;
}) => {
    const identity = key(input);
    if (!records.has(identity))
        records.set(identity, {
            ...input,
            id: null,
            channelId: fixture.channelId,
            draft:
                input.targetType === 'SETTINGS'
                    ? defaultStorefrontSeoSettings()
                    : defaultStorefrontSeoDocument(input.targetType),
            published: null,
            version: 0,
            publishedVersion: 0,
            publishedAt: null,
            updatedAt: null,
            canWrite: true,
        });
    return records.get(identity)!;
};
const withType = (value: StorefrontSeoRecord) => ({
    ...structuredClone(value),
    __typename: 'StorefrontSeoRecord',
});
const settingsIdentity = { targetType: 'SETTINGS' as const, targetId: 'store', languageCode: 'und' };
const permissions = [
    'ReadStorefrontContent',
    'UpdateStorefrontContent',
    'ReadProduct',
    'UpdateProduct',
    'ReadCollection',
    'UpdateCollection',
    'ReadStoreDomain',
];
const channel = () => ({
    __typename: 'Channel',
    id: fixture.channelId,
    code: fixture.channelId,
    token: `token-${fixture.channelId}`,
    defaultCurrencyCode: 'MYR',
    defaultLanguageCode: 'zh_Hans',
    customFields: { storefrontNameZh: '本地验收店铺', storefrontNameEn: 'Local test store' },
});
if (large) {
    const settings = defaultStorefrontSeoSettings();
    settings.redirects = Array.from({ length: 30 }, (_, index) => ({
        from: `/local-old-${index}`,
        to: `/local-new-${index}`,
        status: 301,
    }));
    record(settingsIdentity).draft = settings;
    for (const [targetType, count] of [
        ['PRODUCT', 616],
        ['COLLECTION', 80],
        ['ARTICLE', 80],
    ] as const)
        for (let index = 0; index < count; index++) {
            const value = record({
                targetType,
                targetId: targetType === 'ARTICLE' ? `local-guide-${index}` : String(5909 + index),
                languageCode: 'zh_Hans',
            });
            value.draft = { ...defaultStorefrontSeoDocument(targetType), title: `本地测试 ${index + 1}` };
        }
    record({ targetType: 'PRODUCT', targetId: '5909', languageCode: 'en' });
}
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                fixture.operations.push(operation.operationName);
                const timer = setTimeout(() => {
                    const send = (data: Record<string, unknown>) => {
                        observer.next({ data });
                        observer.complete();
                    };
                    if (
                        fixture.failReads &&
                        !operation.operationName.includes('Save') &&
                        !operation.operationName.includes('Publish') &&
                        !operation.operationName.includes('Restore') &&
                        !operation.operationName.includes('Unpublish')
                    ) {
                        observer.error(new Error('合成场景：读取暂时失败'));
                        return;
                    }
                    if (operation.operationName === 'NextAdminAppShellBootstrap')
                        send({
                            activeChannel: channel(),
                            manageableChannels: [channel()],
                            me: {
                                id: 'synthetic-admin',
                                identifier: 'local@example.invalid',
                                channels: [{ ...channel(), permissions }],
                            },
                            activeAdministrator: {
                                id: 'synthetic-admin',
                                firstName: '本地',
                                lastName: '验收',
                                emailAddress: 'local@example.invalid',
                                createdAt: '2026-10-19T00:00:00Z',
                                updatedAt: '2026-10-19T00:00:00Z',
                                user: {
                                    id: 'synthetic-user',
                                    identifier: 'local@example.invalid',
                                    verified: true,
                                    lastLogin: null,
                                    authenticationMethods: [],
                                    roles: [],
                                },
                            },
                            currentAdminCapabilities: {
                                channelId: fixture.channelId,
                                channelCode: fixture.channelId,
                                scope: 'STORE',
                                commerceMode: 'HYBRID',
                                capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(definition => {
                                    const supported = adminCapabilityScopeAllows(
                                        definition,
                                        'STORE',
                                        'HYBRID',
                                    );
                                    const canRead =
                                        supported &&
                                        (!definition.readPermissions.length ||
                                            definition.readPermissions.some(p => permissions.includes(p))) &&
                                        (definition.readAllPermissions ?? []).every(p =>
                                            permissions.includes(p),
                                        );
                                    return {
                                        id: definition.id,
                                        state: !supported ? 'UNSUPPORTED' : canRead ? 'READY' : 'FORBIDDEN',
                                        canRead,
                                        canWrite:
                                            canRead &&
                                            definition.writePermissions.some(p => permissions.includes(p)),
                                        canConfigure: false,
                                    };
                                }),
                            },
                        });
                    else if (operation.operationName === 'NextAdminCustomFieldServerConfig')
                        send({
                            globalSettings: {
                                availableLanguages: ['zh_Hans', 'en'],
                                serverConfig: { entityCustomFields: [] },
                            },
                        });
                    else if (operation.operationName === 'NextAdminStorefrontSeoWorkspace')
                        send({
                            activeChannel: {
                                __typename: 'Channel',
                                id: fixture.channelId,
                                code: fixture.channelId,
                                token: `token-${fixture.channelId}`,
                            },
                            storefrontSeoWorkspace: {
                                __typename: 'StorefrontSeoWorkspace',
                                channelId: fixture.channelId,
                                accessMode: 'LIVE',
                                settings: withType(record(settingsIdentity)),
                                documents: [...records.values()]
                                    .filter(
                                        item =>
                                            item.channelId === fixture.channelId &&
                                            item.targetType !== 'SETTINGS',
                                    )
                                    .map(withType),
                                diagnostics: large
                                    ? Array.from({ length: 40 }, (_, index) => ({
                                          code: `LOCAL_${index}`,
                                          severity: 'WARNING',
                                          message: `本地测试诊断 ${index + 1}`,
                                          targetType: 'PRODUCT',
                                          targetId: String(5909 + index),
                                          languageCode: 'zh_Hans',
                                      }))
                                    : [],
                            },
                        });
                    else if (operation.operationName === 'NextAdminStorefrontSeoEntityRecord')
                        send({
                            activeChannel: {
                                __typename: 'Channel',
                                id: fixture.channelId,
                                code: fixture.channelId,
                                token: `token-${fixture.channelId}`,
                            },
                            storefrontSeoRecord: withType(record(operation.variables.input)),
                        });
                    else if (operation.operationName === 'NextAdminStorefrontSeoRecord')
                        send({ storefrontSeoRecord: withType(record(operation.variables.input)) });
                    else if (operation.operationName === 'NextAdminStorefrontSeoHistory')
                        send({ storefrontSeoHistory: [] });
                    else if (operation.operationName === 'NextAdminStorefrontPreviewDomains')
                        send({ storeDomains: [] });
                    else {
                        if (
                            getOperationAST(operation.query)?.operation !== 'mutation' ||
                            !/NextAdmin(?:SaveStorefrontSeoDraft|PublishStorefrontSeoRecord|UnpublishStorefrontSeoRecord|RestoreStorefrontSeoRevision)$/u.test(
                                operation.operationName,
                            )
                        ) {
                            observer.error(new Error(`Unmocked local operation: ${operation.operationName}`));
                            return;
                        }
                        const input = operation.variables.input;
                        const previous = record(input);
                        if (input.expectedVersion !== previous.version) {
                            observer.error(new Error('合成场景：草稿版本冲突'));
                            return;
                        }
                        fixture.writes++;
                        const next = {
                            ...previous,
                            id: key(input),
                            version: previous.version + 1,
                            updatedAt: new Date().toISOString(),
                        };
                        const field = operation.operationName.includes('Unpublish')
                            ? 'unpublishStorefrontSeoRecord'
                            : operation.operationName.includes('Publish')
                              ? 'publishStorefrontSeoRecord'
                              : 'saveStorefrontSeoDraft';
                        if (field === 'saveStorefrontSeoDraft')
                            next.draft = structuredClone(input.draft) as StorefrontSeoPayload;
                        else {
                            next.published =
                                field === 'publishStorefrontSeoRecord'
                                    ? structuredClone(previous.draft)
                                    : null;
                            next.publishedAt = new Date().toISOString();
                            next.publishedVersion++;
                        }
                        records.set(key(input), next);
                        send({ [field]: withType(next) });
                    }
                }, 40);
                return () => clearTimeout(timer);
            }),
    ),
});
setInitialActiveChannel(`token-${fixture.channelId}`);

export function Workspace() {
    const location = useLocation();
    const [scope, setScope] = useState(0);
    const nativeOnly = location.pathname.startsWith('/catalog/');
    const permissions = nativeOnly
        ? ['ReadProduct', 'UpdateProduct']
        : [
              'ReadStorefrontContent',
              'UpdateStorefrontContent',
              'ReadProduct',
              'UpdateProduct',
              'ReadCollection',
              'UpdateCollection',
              'ReadStoreDomain',
          ];
    return (
        <div className="flex h-screen flex-col overflow-hidden">
            <nav className="flex shrink-0 flex-wrap gap-3 p-4 bg-slate-100" aria-label="合成验收导航">
                {[
                    ['overview', '收录设置'],
                    ['pages', '页面 SEO'],
                    ['geo', 'GEO 内容'],
                    ['redirects', '重定向'],
                    ['diagnostics', '诊断'],
                    ['platforms', '平台证据'],
                ].map(([path, label]) => (
                    <Link key={path} to={`/storefront/seo/${path}`}>
                        {label}
                    </Link>
                ))}
                <Link to="/catalog/products/42/seo">仅商品权限 SEO</Link>
                <button
                    onClick={() => {
                        fixture.channelId =
                            fixture.channelId === 'synthetic-a' ? 'synthetic-b' : 'synthetic-a';
                        setInitialActiveChannel(`token-${fixture.channelId}`);
                        void client.clearStore();
                        setScope(value => value + 1);
                    }}
                >
                    切换合成店铺
                </button>
                <button
                    onClick={() => {
                        fixture.failReads = !fixture.failReads;
                    }}
                >
                    切换合成读取失败
                </button>
            </nav>
            <div className="min-h-0 flex-1">
                <AdminPermissionsContext.Provider
                    value={{
                        permissions,
                        hasAnyPermission: required =>
                            required.some(permission => permissions.includes(permission)),
                    }}
                >
                    <AdminPageWorkspace key={scope} page={location.pathname} active>
                        {nativeOnly ? (
                            <Routes>
                                <Route
                                    path="/catalog/products/:id/seo"
                                    element={<StorefrontSeoEntityModule />}
                                />
                            </Routes>
                        ) : (
                            <StorefrontSeoModule />
                        )}
                    </AdminPageWorkspace>
                </AdminPermissionsContext.Provider>
            </div>
        </div>
    );
}
function ShellRoutes() {
    const navigate = useNavigate();
    useEffect(() => {
        Object.assign(fixture, { navigate });
    }, [navigate]);
    return (
        <Routes>
            <Route element={<AppShell />}>
                <Route path="/storefront/seo/:section" element={<StorefrontSeoModule />} />
                <Route path="/catalog/products/:id/seo" element={<StorefrontSeoEntityModule />} />
                <Route path="/catalog/collections/:id/seo" element={<StorefrontSeoEntityModule />} />
            </Route>
        </Routes>
    );
}
createRoot(document.getElementById('root')!).render(
    React.createElement(
        ApolloProvider,
        { client },
        <ThemeProvider>
            <FeatureHelpProvider>
                <MemoryRouter initialEntries={[params.get('path') ?? '/storefront/seo/overview']}>
                    {shell ? <ShellRoutes /> : <Workspace />}
                </MemoryRouter>
            </FeatureHelpProvider>
        </ThemeProvider>,
    ),
);
