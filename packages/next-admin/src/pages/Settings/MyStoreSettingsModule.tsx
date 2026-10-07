import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { selectQueryFields } from '../../utils/select-query-fields';
import { BusinessBasicsPanel } from './BusinessSettingsPanels';
import { CurrencyAndRatesPanel, StoreUsdtPanel } from './StoreFinancePanel';
import { CommerceModePanel } from './StorePanels';

import { Store } from 'lucide-react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { MY_STORE_SETTINGS_QUERY, type MyStoreSettingsResult } from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { MyStoreCommerceEditor } from './MyStoreCommerceEditor';
import { MyStorePaymentOptions, MyStorePayoutAccount, MyStoreUsdtWallet } from './MyStoreFinanceEditors';
import { MyStoreProfileEditor } from './MyStoreProfileEditor';
import { ErrorState, Message, SettingsContentSkeleton } from './settings-ui';
import { governanceStatusLabel } from './StoreGovernanceLabels';
import { DomainsPanel } from './StorePanels';
import { StoreShippingSettings } from './StoreShippingSettings';
export function MyStoreSettingsModule() {
    const standalonePage = useStandaloneAdminPage();
    if (standalonePage?.key === 'shipping') {
        return (
            <div className="flex h-full flex-col bg-slate-50">
                <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <Store className="h-5 w-5 text-blue-600" />
                        {standalonePage.title}
                        <FeatureHelpButton
                            topic="settings.payment-shipping"
                            title="本店配送设置"
                            description="管理当前店铺的配送方式，平台公共模板需明确采用后才应用于本店。"
                        />
                    </h1>
                </header>
                <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
                    <StoreShippingSettings />
                </main>
            </div>
        );
    }
    return <MyStoreSettingsContent />;
}

function MyStoreSettingsContent() {
    const standalonePage = useStandaloneAdminPage();
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<MyStoreSettingsResult>(
        standalonePage
            ? selectQueryFields(MY_STORE_SETTINGS_QUERY, [
                  'myStoreProfile',
                  ...(standalonePage.key === 'stores'
                      ? [
                            'myStoreGovernanceChanges',
                            'myStoreCommerceConfiguration',
                            'myStoreCurrencyConfiguration',
                        ]
                      : standalonePage.detail === 'payout' || standalonePage.key === 'sellers'
                        ? ['myStoreGovernanceChanges']
                        : standalonePage.key === 'payment'
                          ? ['myStorePaymentOptions']
                          : standalonePage.tabKey === 'usdt'
                            ? ['myStoreUsdtWallet']
                            : standalonePage.key === 'currency'
                              ? ['myStoreCurrencyConfiguration']
                              : ['business-taxes', 'business-regions'].includes(standalonePage.key)
                                ? ['myStoreCommerceConfiguration']
                                : []),
              ])
            : MY_STORE_SETTINGS_QUERY,
        {},
    );
    if (query.error && !query.data) {
        return (
            <ErrorState
                message={toUserFacingError(query.error, '我的店铺设置读取失败')}
                onRetry={() => void query.refetch()}
            />
        );
    }
    if (!query.data) return <SettingsContentSkeleton label="正在读取我的店铺设置" sections={3} />;
    const {
        myStoreProfile: profile,
        myStoreCommerceConfiguration: commerce,
        myStoreCurrencyConfiguration: currency,
    } = query.data;
    const legalRequest = query.data.myStoreGovernanceChanges?.find(
        item => item.requestType === 'LEGAL_IDENTITY',
    );
    const payoutRequest = query.data.myStoreGovernanceChanges?.find(
        item => item.requestType === 'PAYOUT_ACCOUNT',
    );
    const approvedPayout = query.data.myStoreGovernanceChanges?.find(
        item => item.requestType === 'PAYOUT_ACCOUNT' && item.status === 'APPROVED',
    );
    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        await query.refetch();
    };
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                    <Store className="h-5 w-5 text-blue-600" />
                    {standalonePage?.title ?? '我的店铺设置'}
                    <FeatureHelpButton
                        topic="settings.store-profile"
                        title="我的店铺设置"
                        description={'此页只操作当前店铺数据，不包含其他店铺、平台角色或原始支付密钥。'}
                    />
                </h1>
            </header>
            <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {(!standalonePage || standalonePage.key === 'stores') && (
                    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <StoreScopeCard
                            title="店铺资料"
                            rows={[
                                ['店铺', getChannelDisplayName(profile.channel)],
                                [
                                    '状态',
                                    profile.status === 'ACTIVE'
                                        ? '已上线'
                                        : profile.status === 'SUSPENDED'
                                          ? '已停用'
                                          : '草稿',
                                ],
                                ['主域名', profile.primaryDomain ?? '尚未验证'],
                                [
                                    '主体审核',
                                    legalRequest?.status === 'PENDING'
                                        ? '待平台审核'
                                        : legalRequest?.status === 'REJECTED'
                                          ? `已驳回：${legalRequest.reviewReason ?? '未填写原因'}`
                                          : legalRequest?.status === 'APPROVED'
                                            ? '已通过'
                                            : '无待审申请',
                                ],
                            ]}
                        />
                        <StoreScopeCard
                            title="经营配置"
                            rows={[
                                ['记账币种', commerce.currencyCode],
                                ['经营国家/地区', commerce.countryCode ?? '待配置'],
                                ['商品税率', `${commerce.taxRate}%`],
                                ['商品价格含税', commerce.pricesIncludeTax ? '是' : '否'],
                            ]}
                        />
                        <StoreScopeCard
                            title="支付与汇率"
                            rows={[
                                ['默认币种', currency.defaultCurrencyCode],
                                ['可用币种', currency.availableCurrencyCodes.join('、')],
                                ['USDT 展示', currency.usdtDisplayEnabled ? '已开启' : '已关闭'],
                                ['USDT 钱包审核', currency.usdtWalletReviewStatus],
                                ['收款账户审核', governanceStatusLabel(payoutRequest)],
                                [
                                    '已批准收款账号',
                                    String(approvedPayout?.maskedSummary.accountIdentifier ?? '尚未批准'),
                                ],
                            ]}
                        />
                    </section>
                )}
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-6 text-blue-900">
                    公开品牌资料、客服邮箱可由店铺管理；法定主体资料和收款账户需提交平台审核，审核前不影响已批准值。
                    支付方式由本店选择启用或关闭，USDT 收款钱包由平台统一维护。
                </div>
                {standalonePage?.key === 'sellers' && (
                    <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
                        <h2 className="font-bold text-slate-900">本店绑定的商家主体</h2>
                        <p className="mt-2">{profile.channel.seller?.name ?? '尚未绑定商家主体'}</p>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                            归属商家主体可能供多间店铺共用，由平台管理中心统一维护。当前页面仅提交本店法定主体资料的审核申请。
                        </p>
                    </section>
                )}
                {(!standalonePage || ['stores', 'sellers'].includes(standalonePage.key)) && (
                    <MyStoreProfileEditor
                        key={profile.channel.id}
                        profile={profile}
                        legalRequestStatus={legalRequest?.status ?? null}
                        onCompleted={completed}
                        onError={setActionError}
                    />
                )}
                {(!standalonePage || ['business-taxes', 'business-regions'].includes(standalonePage.key)) && (
                    <MyStoreCommerceEditor
                        key={profile.channel.id}
                        commerce={commerce}
                        onCompleted={completed}
                        onError={setActionError}
                    />
                )}
                {!standalonePage && <StoreShippingSettings />}
                {(!standalonePage || standalonePage.key === 'payment') && (
                    <MyStorePaymentOptions
                        options={query.data.myStorePaymentOptions}
                        onCompleted={completed}
                        onError={setActionError}
                    />
                )}
                {(!standalonePage || standalonePage.detail === 'payout') && (
                    <MyStorePayoutAccount
                        latestRequest={payoutRequest}
                        approvedRequest={approvedPayout}
                        onCompleted={completed}
                        onError={setActionError}
                    />
                )}
                {(!standalonePage || standalonePage.key === 'usdt') && (
                    <MyStoreUsdtWallet
                        wallet={query.data.myStoreUsdtWallet}
                        onCompleted={completed}
                        onError={setActionError}
                    />
                )}
                {(!standalonePage || standalonePage.key === 'domains') && (
                    <DomainsPanel
                        key={profile.channel.id}
                        profile={profile}
                        profiles={[profile]}
                        allowTransfer={false}
                        onChanged={completed}
                        onError={setActionError}
                    />
                )}
                {standalonePage?.key === 'currency' && <CurrencyAndRatesPanel />}
                {standalonePage?.tabKey === 'usdt' && standalonePage.detail && <StoreUsdtPanel />}
                {standalonePage?.key === 'commerce' && (
                    <CommerceModePanel onChanged={completed} onError={setActionError} />
                )}
                {standalonePage?.key === 'business-language' && (
                    <BusinessBasicsPanel storeScoped onChanged={completed} onError={setActionError} />
                )}
            </main>
        </div>
    );
}

function StoreScopeCard({ title, rows }: { title: string; rows: Array<[string, string]> }) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            <dl className="mt-3 space-y-2 text-xs">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex items-start justify-between gap-3">
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="text-right font-medium text-slate-800">{value || '—'}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
