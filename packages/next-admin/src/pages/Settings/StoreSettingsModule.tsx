import { useQuery } from '@apollo/client/react';
import {
    Building2,
    CircleDollarSign,
    CreditCard,
    Globe2,
    ReceiptText,
    Store,
    WalletCards,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { addCustomFieldsToDocument } from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    STORE_MANAGEMENT_QUERY,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import { BusinessBasicsPanel } from './BusinessSettingsPanels';
import { PaymentShippingManager } from './PaymentShippingManager';
import { ErrorState, LoadingState, Message, TabButton, primaryButton } from './settings-ui';
import {
    ProvisionStoreDialog,
    SellerDialog,
    StoreDeprovisionDialog,
    StoreEditor,
    storeName,
} from './StoreDialogs';
import { CurrencyAndRatesPanel, StoreUsdtPanel } from './StoreFinancePanel';
import { CommerceModePanel, DomainsPanel, SellersPanel, StoresPanel } from './StorePanels';

type Tab = 'STORES' | 'DOMAINS' | 'SELLERS' | 'PAYMENT_SHIPPING' | 'BUSINESS' | 'CURRENCY' | 'USDT';
const STORE_SETTINGS_TABS = {
    stores: 'STORES',
    domains: 'DOMAINS',
    sellers: 'SELLERS',
    'payment-shipping': 'PAYMENT_SHIPPING',
    business: 'BUSINESS',
    currency: 'CURRENCY',
    usdt: 'USDT',
} as const;

export function StoreSettingsModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const sellerCustomFields = useCustomFieldDefinitions('Seller');
    const paymentMethodCustomFields = useCustomFieldDefinitions('PaymentMethod');
    const shippingMethodCustomFields = useCustomFieldDefinitions('ShippingMethod');
    const storeManagementDocument = useMemo(() => {
        const withSellers = addCustomFieldsToDocument(STORE_MANAGEMENT_QUERY, 'Seller', sellerCustomFields);
        const withPaymentMethods = addCustomFieldsToDocument(
            withSellers,
            'PaymentMethod',
            paymentMethodCustomFields,
        );
        return addCustomFieldsToDocument(withPaymentMethods, 'ShippingMethod', shippingMethodCustomFields);
    }, [paymentMethodCustomFields, sellerCustomFields, shippingMethodCustomFields]);
    const [tab, setTab] = useUrlTab<Tab>(STORE_SETTINGS_TABS, 'stores');
    const [selectedStoreId, setSelectedStoreId] = useState('');
    const [storeEditor, setStoreEditor] = useState<StoreProfileRecord | null>(null);
    const [deprovisionProfile, setDeprovisionProfile] = useState<StoreProfileRecord | null>(null);
    const [provisionOpen, setProvisionOpen] = useState(false);
    const [sellerOpen, setSellerOpen] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const loadingAllStoreSettingsRef = useRef(false);
    const query = useQuery<StoreManagementResult>(storeManagementDocument, {
        variables: {
            sellerOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
            paymentMethodOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
            shippingMethodOptions: { skip: 0, take: 100, sort: { createdAt: 'DESC' } },
        },
        fetchPolicy: 'cache-and-network',
    });
    const {
        data: storeSettingsData,
        error: storeSettingsError,
        fetchMore: fetchMoreStoreSettings,
        loading: storeSettingsLoading,
    } = query;

    useEffect(() => {
        const data = storeSettingsData;
        if (!data || storeSettingsLoading || storeSettingsError || loadingAllStoreSettingsRef.current) return;
        const sellerCount = data.sellers.items.length;
        const paymentCount = data.paymentMethods.items.length;
        const shippingCount = data.shippingMethods.items.length;
        if (
            sellerCount >= data.sellers.totalItems &&
            paymentCount >= data.paymentMethods.totalItems &&
            shippingCount >= data.shippingMethods.totalItems
        )
            return;
        loadingAllStoreSettingsRef.current = true;
        void fetchMoreStoreSettings({
            variables: {
                sellerOptions: { skip: sellerCount, take: 100, sort: { createdAt: 'DESC' } },
                paymentMethodOptions: { skip: paymentCount, take: 100, sort: { createdAt: 'DESC' } },
                shippingMethodOptions: { skip: shippingCount, take: 100, sort: { createdAt: 'DESC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                sellers: {
                    ...fetchMoreResult.sellers,
                    items: mergeById(previous.sellers.items, fetchMoreResult.sellers.items),
                },
                paymentMethods: {
                    ...fetchMoreResult.paymentMethods,
                    items: mergeById(previous.paymentMethods.items, fetchMoreResult.paymentMethods.items),
                },
                shippingMethods: {
                    ...fetchMoreResult.shippingMethods,
                    items: mergeById(previous.shippingMethods.items, fetchMoreResult.shippingMethods.items),
                },
            }),
        })
            .catch(fetchError => {
                setActionError(toUserFacingError(fetchError, '店铺基础数据未能全部加载'));
            })
            .finally(() => {
                loadingAllStoreSettingsRef.current = false;
            });
    }, [fetchMoreStoreSettings, storeSettingsData, storeSettingsError, storeSettingsLoading]);
    const profiles = useMemo(
        () => [...(query.data?.storeProfiles ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
        [query.data?.storeProfiles],
    );
    const selectedProfile = profiles.find(profile => profile.id === selectedStoreId) ?? profiles[0] ?? null;
    const canReadBusinessSettings = hasAnyPermission([
        'ReadSettings',
        'ReadChannel',
        'ReadCountry',
        'ReadZone',
        'ReadTaxCategory',
        'ReadTaxRate',
    ]);
    const canReadFinance = hasAnyPermission(['ReadStoreProfile']);

    const completed = async (message: string) => {
        setNotice(message);
        setActionError('');
        setStoreEditor(null);
        setSellerOpen(false);
        await query.refetch();
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Store className="h-5 w-5 text-blue-600" />
                            店铺综合设置
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            店铺、域名、商家、支付交付及平台业务基础配置集中管理
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className={secondaryButton}
                            aria-label="刷新"
                        >
                            <RefreshCw className={`h-4 w-4 ${query.loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setProvisionOpen(true)}
                            className={primaryButton}
                        >
                            <Plus className="h-4 w-4" />
                            开通网店
                        </button>
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="scrollbar-hidden flex w-max max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
                        <TabButton
                            active={tab === 'STORES'}
                            onClick={() => setTab('STORES')}
                            icon={<Store className="h-3.5 w-3.5" />}
                        >
                            店铺实例
                        </TabButton>
                        <TabButton
                            active={tab === 'DOMAINS'}
                            onClick={() => setTab('DOMAINS')}
                            icon={<Globe2 className="h-3.5 w-3.5" />}
                        >
                            独立域名
                        </TabButton>
                        <TabButton
                            active={tab === 'SELLERS'}
                            onClick={() => setTab('SELLERS')}
                            icon={<Building2 className="h-3.5 w-3.5" />}
                        >
                            商家主体
                        </TabButton>
                        <TabButton
                            active={tab === 'PAYMENT_SHIPPING'}
                            onClick={() => setTab('PAYMENT_SHIPPING')}
                            icon={<CreditCard className="h-3.5 w-3.5" />}
                        >
                            支付与交付
                        </TabButton>
                        {canReadFinance && (
                            <TabButton
                                active={tab === 'CURRENCY'}
                                onClick={() => setTab('CURRENCY')}
                                icon={<CircleDollarSign className="h-3.5 w-3.5" />}
                            >
                                币种与汇率
                            </TabButton>
                        )}
                        {canReadFinance && (
                            <TabButton
                                active={tab === 'USDT'}
                                onClick={() => setTab('USDT')}
                                icon={<WalletCards className="h-3.5 w-3.5" />}
                            >
                                USDT 收款
                            </TabButton>
                        )}
                        {canReadBusinessSettings && (
                            <TabButton
                                active={tab === 'BUSINESS'}
                                onClick={() => setTab('BUSINESS')}
                                icon={<ReceiptText className="h-3.5 w-3.5" />}
                            >
                                业务基础
                            </TabButton>
                        )}
                    </div>
                    {tab === 'DOMAINS' && profiles.length > 0 && (
                        <select
                            value={selectedProfile?.id ?? ''}
                            onChange={event => setSelectedStoreId(event.target.value)}
                            className={`${inputClass} w-full xl:w-72`}
                        >
                            {profiles.map(profile => (
                                <option key={profile.id} value={profile.id}>
                                    {storeName(profile)} · {getChannelDisplayName(profile.channel.code)}
                                </option>
                            ))}
                        </select>
                    )}
                    {tab === 'SELLERS' && (
                        <button type="button" onClick={() => setSellerOpen(true)} className={primaryButton}>
                            <Plus className="h-3.5 w-3.5" />
                            新增商家主体
                        </button>
                    )}
                </div>
                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error ? (
                    <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                ) : (
                    <>
                        {tab === 'STORES' && (
                            <div className="space-y-4">
                                <CommerceModePanel onChanged={completed} onError={setActionError} />
                                <StoresPanel
                                    profiles={profiles}
                                    onEdit={setStoreEditor}
                                    onDeprovision={setDeprovisionProfile}
                                />
                            </div>
                        )}
                        {tab === 'DOMAINS' && (
                            <DomainsPanel
                                profile={selectedProfile}
                                onChanged={message => completed(message)}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'SELLERS' && (
                            <SellersPanel
                                sellers={query.data?.sellers.items ?? []}
                                customFieldDefinitions={sellerCustomFields}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'PAYMENT_SHIPPING' && (
                            <PaymentShippingManager
                                data={query.data!}
                                paymentMethodCustomFields={paymentMethodCustomFields}
                                shippingMethodCustomFields={shippingMethodCustomFields}
                                onChanged={completed}
                                onError={setActionError}
                            />
                        )}
                        {tab === 'BUSINESS' && canReadBusinessSettings && (
                            <BusinessBasicsPanel onChanged={completed} onError={setActionError} />
                        )}
                        {tab === 'CURRENCY' && canReadFinance && <CurrencyAndRatesPanel />}
                        {tab === 'USDT' && canReadFinance && <StoreUsdtPanel />}
                    </>
                )}
            </main>
            {storeEditor && (
                <StoreEditor
                    profile={storeEditor}
                    onClose={() => setStoreEditor(null)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
            {deprovisionProfile && (
                <StoreDeprovisionDialog
                    profile={deprovisionProfile}
                    onClose={() => {
                        setDeprovisionProfile(null);
                        void query.refetch();
                    }}
                    onCompleted={async message => {
                        setDeprovisionProfile(null);
                        await completed(message);
                    }}
                    onError={setActionError}
                />
            )}
            {provisionOpen && (
                <ProvisionStoreDialog
                    templates={query.data?.storeProvisioningTemplates ?? []}
                    onClose={() => setProvisionOpen(false)}
                    onCompleted={async message => {
                        setNotice(message);
                        setActionError('');
                        await query.refetch();
                    }}
                    onError={setActionError}
                />
            )}
            {sellerOpen && (
                <SellerDialog
                    customFieldDefinitions={sellerCustomFields}
                    onClose={() => setSellerOpen(false)}
                    onCompleted={completed}
                    onError={setActionError}
                />
            )}
        </div>
    );
}
