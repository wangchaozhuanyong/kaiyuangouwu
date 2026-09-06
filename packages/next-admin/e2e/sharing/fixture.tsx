import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
    referralPosterCopy,
    referralPosterPresets,
} from '../../../store-management-plugin/src/referral/referral-poster-presets';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import { AdminPermissionsContext } from '../../src/hooks/use-admin-permissions';
import '../../src/index.css';
import { ReferralsModule } from '../../src/pages/Marketing/ReferralsModule';
import { SharingModule } from '../../src/pages/Marketing/SharingModule';

// Isolated fixture with an in-memory API; no account or production requests.
const params = new URLSearchParams(location.search);
const operations: Array<{ name: string; variables: unknown }> = [];
const faults = { read: params.has('read-error'), write: false };
const stamp = () => new Date(Date.UTC(2026, 8, 6, 0, 0, ++revision)).toISOString();
let revision = 0;
let channelId = 'fixture-a';
const systems = referralPosterPresets.map((preset, index) => ({
    ...referralPosterCopy,
    ...preset,
    __typename: 'ReferralSystemPosterTemplate',
    name: preset.nameZh,
    createdAt: stamp(),
    updatedAt: stamp(),
    enabled: true,
    position: index,
    layoutVariant: 'STANDARD_CENTER',
    posterBackgroundAsset: null,
    shareBackgroundAsset: null,
    overlayOpacity: 0,
}));
const custom = {
    ...systems[0],
    __typename: 'ReferralPosterTemplate',
    id: 'custom-1',
    name: '本店分享模板',
    enabled: true,
};
const makeProgram = (id: string) => ({
    __typename: 'ReferralProgram',
    channelId: id,
    updatedAt: stamp(),
    enabled: true,
    rewardRate: 7,
    releaseDelayDays: 8,
    minimumOrderAmount: 500,
    maxRewardPerOrder: 12000,
    allowBalanceSpend: false,
    attributionWindowDays: 45,
    defaultPosterTemplate: systems[0].id as string,
    posterTemplates: systems.map(t => t.id) as string[],
    systemPosterTemplateConfigs: systems,
    posterTemplateConfigs: params.has('empty') ? [] : [{ ...custom }],
});
const programs = { 'fixture-a': makeProgram('fixture-a'), 'fixture-b': makeProgram('fixture-b') };
const asset = {
    __typename: 'Asset',
    id: 'asset-1',
    name: '本地海报背景',
    type: 'IMAGE',
    width: 1080,
    height: 1920,
    preview: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#eef4fe"/></svg>')}`,
    source: '',
};
asset.source = asset.preview;
Object.assign(window, {
    sharingFixture: {
        operations,
        faults,
        state: () => programs[channelId as keyof typeof programs],
        switchChannel: () => {
            channelId = channelId === 'fixture-a' ? 'fixture-b' : 'fixture-a';
            void client.refetchQueries({ include: ['AdminSharingSettings'] });
        },
    },
});
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const timer = setTimeout(() => {
                    try {
                        const name = operation.operationName;
                        const { input, id, enabled, expectedUpdatedAt } = operation.variables;
                        operations.push({ name, variables: structuredClone(operation.variables) });
                        const program = programs[channelId as keyof typeof programs];
                        if (/Update|Create|Enabled|Delete/.test(name) && faults.write)
                            throw new Error('模拟分享保存失败');
                        let data: Record<string, unknown>;
                        if (name === 'AdminSharingSettings') {
                            if (faults.read) throw new Error('模拟分享读取失败');
                            data = {
                                activeChannel: {
                                    __typename: 'Channel',
                                    id: channelId,
                                    code: channelId === 'fixture-a' ? '分享测试店 A' : '分享测试店 B',
                                    defaultCurrencyCode: 'MYR',
                                },
                                referralProgram: program,
                            };
                        } else if (name === 'AdminUpdateReferralProgram') {
                            if (input.expectedUpdatedAt !== program.updatedAt)
                                throw new Error('配置版本已更新');
                            const { expectedUpdatedAt: _expected, ...fields } = input;
                            Object.assign(program, fields, { updatedAt: stamp() });
                            data = { updateReferralProgram: program };
                        } else if (name === 'SetReferralPosterEnabled') {
                            const template = program.posterTemplateConfigs.find(t => t.id === id)!;
                            if (expectedUpdatedAt !== program.updatedAt) throw new Error('模板版本已更新');
                            Object.assign(template, { enabled, updatedAt: stamp() });
                            program.updatedAt = stamp();
                            data = { setReferralPosterTemplateEnabled: program };
                        } else if (name === 'GetAssets') data = { assets: { items: [asset], totalItems: 1 } };
                        else if (
                            name === 'AdminCreateReferralPoster' ||
                            name === 'AdminUpdateReferralPoster'
                        ) {
                            const next = {
                                ...custom,
                                ...input,
                                id: input.id || `custom-${++revision}`,
                                updatedAt: stamp(),
                                posterBackgroundAsset: input.posterBackgroundAssetId ? asset : null,
                                shareBackgroundAsset: input.shareBackgroundAssetId ? asset : null,
                            };
                            program.posterTemplateConfigs = input.id
                                ? program.posterTemplateConfigs.map(t => (t.id === input.id ? next : t))
                                : [...program.posterTemplateConfigs, next];
                            data = {
                                [input.id ? 'updateReferralPosterTemplate' : 'createReferralPosterTemplate']:
                                    next,
                            };
                        } else throw new Error(`Unexpected fixture operation: ${name}`);
                        observer.next({ data: structuredClone(data) });
                        observer.complete();
                    } catch (error) {
                        observer.error(error);
                    }
                }, 100);
                return () => clearTimeout(timer);
            }),
    ),
});
export function FixtureRoute() {
    const route = useLocation();
    return (
        <>
            <div className="bg-slate-900 px-4 py-2 text-xs text-white">
                本地分享设置验收 · 示例数据 <span data-testid="route">{route.pathname}</span>
            </div>
            <div style={{ height: 'calc(100dvh - 32px)' }}>
                <Routes>
                    <Route path="/marketing/sharing" element={<SharingModule />} />
                    <Route path="/marketing/referrals" element={<ReferralsModule />} />
                </Routes>
            </div>
        </>
    );
}
createRoot(document.getElementById('root')!).render(
    <React.Fragment>
        <FeatureHelpProvider>
            <ApolloProvider client={client}>
                <AdminPermissionsContext.Provider
                    value={{
                        permissions: params.has('readonly') ? ['ReadReferral'] : ['SuperAdmin'],
                        hasAnyPermission: required =>
                            !params.has('readonly') || required.every(p => p === 'ReadReferral'),
                    }}
                >
                    <MemoryRouter
                        initialEntries={[
                            params.has('legacy') ? '/marketing/referrals?tab=posters' : '/marketing/sharing',
                        ]}
                    >
                        <FixtureRoute />
                    </MemoryRouter>
                </AdminPermissionsContext.Provider>
            </ApolloProvider>
        </FeatureHelpProvider>
    </React.Fragment>,
);
