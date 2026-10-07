import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { TranslationsModule } from '../../src/pages/Settings/TranslationsModule';
import { newContentBlock } from '../../src/pages/Storefront/storefront-content-utils';
import { StorefrontModule } from '../../src/pages/Storefront/StorefrontModule';

// Actual admin component and Apollo; all records and operations below are synthetic and in memory.
const stamp = '2026-10-07T00:00:00.000Z';
const makeState = (id: string, status: string, locked = false) => ({
    __typename: 'ContentTranslationStateRecord',
    id,
    channelId: 'fixture-channel',
    entityType: 'StorefrontContentBlock',
    entityId: id,
    fieldPath: 'title',
    sourceLanguageCode: 'zh_Hans',
    targetLanguageCode: 'en',
    status,
    origin: locked ? 'MANUAL' : 'AUTO',
    locked,
    error: null,
    updatedAt: stamp,
    attempts: 0,
    revision: 1,
    nextAttemptAt: null,
    lastErrorCode: null,
});
const fixture = {
    operations: [] as Array<{ name: string; variables: Record<string, any> }>,
    states: [makeState('1', 'STALE', true), makeState('2', 'PENDING'), makeState('3', 'FAILED')],
    conflict: false,
    failReadback: false,
    failAudit: false,
    delay: 80,
    stalled: false,
};
Object.assign(window, { translationFixture: fixture });
const link = new ApolloLink(
    operation =>
        new Observable(observer => {
            fixture.operations.push({ name: operation.operationName, variables: operation.variables });
            const timer = setTimeout(() => {
                const send = (data: Record<string, unknown>) => {
                    observer.next({ data });
                    observer.complete();
                };
                if (operation.operationName === 'NextAdminContentTranslationAudit') {
                    if (fixture.failAudit) {
                        observer.error(new Error('合成测试：列表读取失败'));
                        return;
                    }
                    const options = operation.variables.options ?? {};
                    const filtered = fixture.states.filter(
                        state => !options.status || state.status === options.status,
                    );
                    const counts = [...new Set(fixture.states.map(state => state.status))].map(status => ({
                        status,
                        count: fixture.states.filter(state => state.status === status).length,
                    }));
                    send({
                        activeChannel: {
                            __typename: 'Channel',
                            id: 'fixture-channel',
                            code: 'synthetic-store',
                            defaultLanguageCode: 'zh_Hans',
                            availableLanguageCodes: ['zh_Hans', 'en'],
                            customFields: { storefrontNameZh: '合成测试店', storefrontNameEn: 'Fixture' },
                        },
                        contentTranslationStaleCount: 999,
                        contentTranslationAudit: {
                            configured: true,
                            provider: 'synthetic-provider',
                            total: fixture.states.length,
                            filteredTotal: filtered.length,
                            counts,
                            states: filtered.slice(
                                options.skip ?? 0,
                                (options.skip ?? 0) + (options.take ?? 20),
                            ),
                        },
                    });
                } else if (operation.operationName === 'NextAdminContentTranslationReview') {
                    const state = fixture.states.find(state => state.id === operation.variables.id)!;
                    send({
                        contentTranslationReview: {
                            state,
                            sourceText: '当前中文内容',
                            targetText: 'Reviewed English',
                            sourceHash: 'source-v1',
                            translatedHash: 'target-v1',
                            format: 'TEXT',
                            canConfirm: state.status === 'STALE' && state.locked,
                            reason: null,
                            editPath: '/storefront/decoration?blockId=1&field=title&language=en',
                        },
                    });
                } else if (operation.operationName === 'NextAdminConfirmContentTranslationReview') {
                    if (fixture.conflict) {
                        observer.error(new Error('内容在复核期间已变化，请重新查看后确认'));
                        return;
                    }
                    const input = operation.variables.input;
                    const state = fixture.states.find(state => state.id === input.id)!;
                    if (state.revision !== input.revision) {
                        observer.error(new Error('复核版本已变化'));
                        return;
                    }
                    state.status = 'MANUAL_LOCKED';
                    state.revision++;
                    if (fixture.failReadback) fixture.failAudit = true;
                    send({ confirmCustomerContentTranslationReview: { ...state } });
                } else if (operation.operationName === 'NextAdminBackfillContentTranslations') {
                    const offset = operation.variables.offset;
                    send({
                        backfillCustomerContentTranslations: {
                            total: 2,
                            scanned: fixture.stalled ? 0 : 1,
                            processed: 0,
                            queued: fixture.stalled ? 0 : 1,
                            skipped: 0,
                            failed: 0,
                            nextOffset: fixture.stalled ? offset : offset + 1,
                            hasMore: fixture.stalled || offset === 0,
                            errors: [],
                            skippedRecords: [],
                        },
                    });
                } else if (operation.operationName === 'NextAdminStorefrontContent') {
                    const block = {
                        ...newContentBlock('CUSTOM', 0, '合成区块'),
                        __typename: 'StorefrontContentBlock',
                        id: '1',
                        updatedAt: stamp,
                        translations: [
                            {
                                languageCode: 'zh_Hans',
                                title: '当前中文内容',
                                subtitle: '',
                                body: '',
                                ctaLabel: '',
                            },
                            {
                                languageCode: 'en',
                                title: 'Reviewed English',
                                subtitle: '',
                                body: '',
                                ctaLabel: '',
                            },
                        ],
                        items: [],
                    };
                    send({
                        activeChannel: {
                            __typename: 'Channel',
                            id: 'fixture-channel',
                            code: 'synthetic-store',
                            token: 'synthetic-channel-token',
                            customFields: { storefrontNameZh: '合成测试店', storefrontNameEn: 'Fixture' },
                            defaultLanguageCode: 'zh_Hans',
                            availableLanguageCodes: ['zh_Hans', 'en'],
                        },
                        storefrontContentBlocks: [block],
                        storefrontContentSettings: {
                            heroAutoplayIntervalSeconds: 5,
                            configuredBlockTypes: ['CUSTOM'],
                            personalDataExportEnabled: false,
                            accountRecommendations: { enabled: false, titleZh: '', titleEn: '', limit: 4 },
                        },
                        storefrontAuthConfiguration: {
                            emailPasswordEnabled: false,
                            emailAutoRegistrationEnabled: false,
                            emailQuickRegistrationEnabled: false,
                            googleOverrideEnabled: false,
                            storeGoogleEnabled: false,
                            storeGoogleClientId: '',
                            platformGoogleEnabled: false,
                            platformGoogleClientId: '',
                            effectiveGoogleEnabled: false,
                            effectiveGoogleClientId: '',
                            googleConfigurationSource: 'NONE',
                        },
                    });
                } else if (operation.operationName === 'NextAdminStorefrontEditorOptions') {
                    send({ products: { totalItems: 0, items: [] } });
                } else if (operation.operationName === 'NextAdminStorefrontVisualPreset') {
                    send({
                        activeChannel: {
                            __typename: 'Channel',
                            id: 'fixture-channel',
                            code: 'synthetic-store',
                            token: 'synthetic-channel-token',
                            customFields: { storefrontNameZh: '合成测试店', storefrontNameEn: 'Fixture' },
                        },
                        storefrontVisualPreset: {
                            channelId: 'fixture-channel',
                            presetId: 'classic',
                            revision: 1,
                        },
                        storefrontPreviewBranding: {
                            channelId: 'fixture-channel',
                            name: '合成测试店',
                            backgroundColor: '#ffffff',
                            primaryColor: '#222222',
                            accentColor: '#555555',
                            highlightColor: '#888888',
                        },
                    });
                } else if (operation.operationName === 'NextAdminStorefrontPreviewUrl') {
                    send({
                        activeChannel: { __typename: 'Channel', id: 'fixture-channel' },
                        storeProfiles: [],
                    });
                } else if (operation.operationName === 'NextAdminStorefrontPreviewDomains') {
                    send({ storefrontDomains: [] });
                } else {
                    observer.error(new Error('Unexpected fixture operation: ' + operation.operationName));
                }
            }, fixture.delay);
            return () => clearTimeout(timer);
        }),
);
export function Fixture() {
    const location = useLocation();
    return location.pathname === '/storefront/decoration' ? <StorefrontModule /> : <TranslationsModule />;
}
const client = new ApolloClient({ cache: new InMemoryCache(), link });
createRoot(document.getElementById('root')!).render(
    React.createElement(
        React.Fragment,
        null,
        <ApolloProvider client={client}>
            <BrowserRouter>
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <FeatureHelpProvider>
                            <div className="h-dvh">
                                <Fixture />
                            </div>
                        </FeatureHelpProvider>
                    </ConfirmDialogContext.Provider>
                </AdminPermissionsContext.Provider>
            </BrowserRouter>
        </ApolloProvider>,
    ),
);
