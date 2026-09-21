import { useQuery } from '@apollo/client/react';
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
export function MyStoreSettingsModule() {
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<MyStoreSettingsResult>(MY_STORE_SETTINGS_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
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
    const legalRequest = query.data.myStoreGovernanceChanges.find(
        item => item.requestType === 'LEGAL_IDENTITY',
    );
    const payoutRequest = query.data.myStoreGovernanceChanges.find(
        item => item.requestType === 'PAYOUT_ACCOUNT',
    );
    const approvedPayout = query.data.myStoreGovernanceChanges.find(
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
                    我的店铺设置
                    <FeatureHelpButton topic="settings.store-profile" title="我的店铺设置" />
                </h1>
                <p className="mt-1 text-xs text-slate-500">
                    此页只操作当前店铺数据，不包含其他店铺、平台角色或原始支付密钥。
                </p>
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
                            ['配送方式', commerce.shippingMethodNameZh || commerce.shippingMethodNameEn],
                            ['基础运费', String(commerce.baseRate)],
                            ['预计送达', `${commerce.estimateMinDays}-${commerce.estimateMaxDays} 天`],
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
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-6 text-blue-900">
                    公开品牌资料、客服邮箱可由店铺管理；主体名称、收款账户、USDT
                    钱包和支付配置需提交平台审核，审核前不影响线上已批准值。
                </div>
                <MyStoreProfileEditor
                    key={profile.updatedAt}
                    profile={profile}
                    legalRequestStatus={legalRequest?.status ?? null}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStoreCommerceEditor
                    key={commerce.updatedAt}
                    commerce={commerce}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStorePaymentOptions
                    options={query.data.myStorePaymentOptions}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStorePayoutAccount
                    latestRequest={payoutRequest}
                    approvedRequest={approvedPayout}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <MyStoreUsdtWallet
                    wallet={query.data.myStoreUsdtWallet}
                    onCompleted={completed}
                    onError={setActionError}
                />
                <DomainsPanel
                    profile={profile}
                    profiles={[profile]}
                    onChanged={completed}
                    onError={setActionError}
                />
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
