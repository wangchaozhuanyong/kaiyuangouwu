import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { Beaker, CreditCard, Pencil, Plus, Sparkles, Trash2, Truck, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import {
    ConfigurableOperationField,
    ConfigurableOperationTechnicalDetails,
} from '../../components/ConfigurableOperationFields';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldDefinition, CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { STORE_COMMERCE_MODE_QUERY, type StoreCommerceModeData } from '../../graphql/commerce.graphql';
import {
    CREATE_PAYMENT_METHOD_MUTATION,
    CREATE_SHIPPING_METHOD_MUTATION,
    DELETE_PAYMENT_METHOD_MUTATION,
    DELETE_SHIPPING_METHOD_MUTATION,
    SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION,
    TEST_SHIPPING_METHOD_QUERY,
    UPDATE_PAYMENT_METHOD_MUTATION,
    UPDATE_SHIPPING_METHOD_MUTATION,
    type ConfigurableOperationDefinitionRecord,
    type ConfigurableOperationRecord,
    type StoreManagementResult,
} from '../../graphql/management.graphql';
import { useAdminCapabilities } from '../../hooks/use-admin-capabilities';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminLazyQuery as useLazyQuery, useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { getAdminDisplayLanguage } from '../../utils/admin-language';
import {
    configurableArgumentLabel,
    configurableArgumentRequiresValue,
    configurableOperationLabel,
    serializeConfigurableListValue,
} from '../../utils/configurable-operation-localization';
import {
    getLocalizedEntityDescription,
    getLocalizedEntityName,
    getLocalizedEntityTranslation,
} from '../../utils/localized-entity-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { ShippingTemplatesPanel } from './ShippingTemplatesPanel';
import { UsdtPaymentSetupPanel } from './UsdtPaymentSetupPanel';
import { SHIPPING_PRESETS } from './shipping-manager-utils';
import {
    USDT_PAYMENT_HANDLER_CODE,
    USDT_PAYMENT_METHOD_CODE,
    isSystemManagedUsdtPaymentMethod,
    selectablePaymentHandlers,
} from './store-usdt-utils';

type PaymentMethodItem = StoreManagementResult['paymentMethods']['items'][number];
type ShippingMethodItem = StoreManagementResult['shippingMethods']['items'][number];
type EditorState =
    | { kind: 'payment'; item?: PaymentMethodItem; testPayment?: boolean }
    | { kind: 'shipping'; item?: ShippingMethodItem };

const testPaymentHandler = 'controlled-test-payment-handler';
const testPaymentChecker = 'controlled-test-payment-checker';

const primaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50';
const secondaryButton =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';

function TestPaymentAvailabilityNotice({
    definitions,
    onConfigure,
}: {
    definitions: ConfigurableOperationDefinitionRecord[];
    onConfigure?: () => void;
}) {
    const available = definitions.some(definition => definition.code === testPaymentHandler);

    return (
        <aside className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
            <p className="flex items-center gap-2 font-bold text-slate-900">
                <Beaker className="h-4 w-4 shrink-0" aria-hidden="true" />
                {available ? '测试支付' : '测试支付尚未开放'}
            </p>
            <p className="mt-1">
                {available
                    ? '平台可设置测试订单范围，各店铺再独立开启。模拟付款不会真实扣款，但订单会进入正常已付款、库存与交付流程。'
                    : '当前服务器未开放测试支付，请联系平台管理员开启测试支付开关。'}
            </p>
            {available && onConfigure && (
                <AdminButton type="button" onClick={onConfigure} className={`${secondaryButton} mt-3`}>
                    配置测试支付
                </AdminButton>
            )}
        </aside>
    );
}

export function PaymentShippingManager({
    section,
    data,
    paymentMethodCustomFields,
    shippingMethodCustomFields,
    onChanged,
    onError,
}: {
    section: 'payment' | 'shipping';
    data: StoreManagementResult;
    paymentMethodCustomFields: CustomFieldDefinition[];
    shippingMethodCustomFields: CustomFieldDefinition[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const standalonePage = useStandaloneAdminPage();
    const requestConfirmation = useConfirmDialog();
    const isPlatform = data.activeChannel.code === '__default_channel__';
    const { snapshot } = useAdminCapabilities();
    const capabilityMode =
        snapshot?.channelId === data.activeChannel.id && snapshot.scope === 'STORE'
            ? snapshot.commerceMode
            : null;
    const commerceModeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {
        skip: section !== 'shipping' || isPlatform || capabilityMode != null,
    });
    const readMode = capabilityMode ?? commerceModeQuery.data?.myStoreCommerceMode?.mode;
    const commerceMode =
        readMode && ['DIGITAL_ONLY', 'PHYSICAL_ONLY', 'HYBRID'].includes(readMode) ? readMode : null;
    const { hasAnyPermission } = useAdminPermissions();
    const canConfigurePayment = isPlatform && hasAnyPermission(['SuperAdmin']);
    const canCreatePayment = canConfigurePayment;
    const canUpdatePayment = canConfigurePayment;
    const canDeletePayment = canConfigurePayment;
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [togglePayment, toggleState] = useMutation(UPDATE_PAYMENT_METHOD_MUTATION);
    const [deletePayment, deletePaymentState] = useMutation<{
        deletePaymentMethod: { result: string; message?: string | null };
    }>(DELETE_PAYMENT_METHOD_MUTATION);
    const [deleteShipping, deleteShippingState] = useMutation<{
        deleteShippingMethod: { result: string; message?: string | null };
    }>(DELETE_SHIPPING_METHOD_MUTATION);

    const changePayment = async (id: string, enabled: boolean) => {
        try {
            await togglePayment({ variables: { input: { id, enabled } } });
            await onChanged(`支付方式已${enabled ? '启用' : '停用'}`);
        } catch (error) {
            onError(toUserFacingError(error, '支付方式状态更新失败'));
        }
    };

    const removeMethod = async (state: EditorState) => {
        if (!state.item) return;
        const displayName = getLocalizedEntityName(state.item);
        const confirmation = await requestConfirmation({
            title: state.kind === 'payment' ? '删除支付方式' : '删除配送方式',
            description: `确定删除“${displayName}”？如果已有店铺或订单引用，后端会拒绝不安全的删除。`,
            confirmLabel: '验证并删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        const kindLabel = state.kind === 'payment' ? '支付方式' : '配送方式';
        const context = {
            ...sensitiveActionContext(confirmation.currentPassword ?? ''),
            adminFeedback: {
                target: `${kindLabel}“${displayName}”`,
                resolution: [
                    `检查该${kindLabel}是否仍分配给店铺或被订单引用`,
                    `先解除关联，再重新删除${kindLabel}`,
                ],
            },
        };
        try {
            let result: { result: string; message?: string | null } | undefined;
            if (state.kind === 'payment') {
                const response = await deletePayment({
                    variables: { id: state.item.id, force: false },
                    context,
                });
                result = response.data?.deletePaymentMethod;
            } else {
                const response = await deleteShipping({
                    variables: { id: state.item.id },
                    context,
                });
                result = response.data?.deleteShippingMethod;
            }
            if (result?.result !== 'DELETED') return;
            await onChanged(state.kind === 'payment' ? '支付方式已删除' : '配送方式已删除');
        } catch {
            // Apollo 全局反馈已显示失败原因，避免页面再出现第二条重复错误。
        }
    };

    const deleting = deletePaymentState.loading || deleteShippingState.loading;
    const testMethod = data.paymentMethods?.items.find(item => item.handler.code === testPaymentHandler);
    return (
        <>
            <div className="space-y-4">
                {section === 'payment' && !isPlatform && (
                    <StorePaymentSwitches onChanged={onChanged} onError={onError} />
                )}
                {section === 'payment' && isPlatform && (
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    <CreditCard className="h-4 w-4 text-blue-600" /> 支付方式
                                    <FeatureHelpButton
                                        topic="settings.payment-shipping"
                                        title="支付方式"
                                        description={'平台统一配置支付系统；经营店铺独立选择开启或关闭'}
                                    />
                                </h2>
                            </div>
                            {canCreatePayment && (
                                <AdminButton
                                    type="button"
                                    onClick={() => setEditor({ kind: 'payment' })}
                                    className={primaryButton}
                                >
                                    <Plus className="h-3.5 w-3.5" /> 新增
                                </AdminButton>
                            )}
                        </div>
                        <div className="px-5 pt-4 empty:hidden">
                            <TestPaymentAvailabilityNotice
                                definitions={data.paymentMethodHandlers}
                                onConfigure={
                                    (testMethod ? canUpdatePayment : canCreatePayment)
                                        ? () =>
                                              setEditor({
                                                  kind: 'payment',
                                                  item: testMethod,
                                                  testPayment: true,
                                              })
                                        : undefined
                                }
                            />
                        </div>
                        <div
                            className="admin-comparison-scroll overflow-x-auto"
                            role="region"
                            aria-label="平台支付方式"
                            tabIndex={0}
                        >
                            <p className="admin-mobile-table-hint">左右滑动查看完整支付方式</p>
                            <table className="admin-compact-table w-full min-w-[880px] text-left text-xs">
                                <thead>
                                    <tr>
                                        {['支付方式', '描述', '管理方式', '平台状态', '操作'].map(label => (
                                            <th key={label}>{label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.paymentMethods.items.map(item => {
                                        const systemManaged = isSystemManagedUsdtPaymentMethod(item);
                                        const displayName = getLocalizedEntityName(item);
                                        const displayDescription = getLocalizedEntityDescription(item);
                                        return (
                                            <tr key={item.id}>
                                                <td className="font-semibold text-slate-900">
                                                    {displayName}
                                                </td>
                                                <td
                                                    className="max-w-96 truncate text-slate-500"
                                                    title={displayDescription}
                                                >
                                                    {displayDescription || '—'}
                                                </td>
                                                <td>
                                                    {systemManaged ? (
                                                        <span
                                                            title="使用平台统一收款地址；各店铺独立启停。"
                                                            className="text-emerald-700"
                                                        >
                                                            系统管理
                                                        </span>
                                                    ) : (
                                                        '平台配置'
                                                    )}
                                                </td>
                                                <td>
                                                    <label className="inline-flex items-center gap-2 text-slate-500">
                                                        {canUpdatePayment && (
                                                            <AdminInput
                                                                type="checkbox"
                                                                aria-label={
                                                                    systemManaged
                                                                        ? '平台 USDT 全局开关'
                                                                        : `${displayName}平台启用状态`
                                                                }
                                                                checked={item.enabled}
                                                                disabled={toggleState.loading}
                                                                onChange={event =>
                                                                    void changePayment(
                                                                        item.id,
                                                                        event.target.checked,
                                                                    )
                                                                }
                                                            />
                                                        )}
                                                        {item.enabled ? '平台启用' : '平台停用'}
                                                    </label>
                                                </td>
                                                <td>
                                                    <div className="flex items-center gap-1">
                                                        {!systemManaged && canUpdatePayment && (
                                                            <AdminButton
                                                                type="button"
                                                                onClick={() =>
                                                                    setEditor({ kind: 'payment', item })
                                                                }
                                                                className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"
                                                                aria-label={`编辑支付方式${displayName}`}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </AdminButton>
                                                        )}
                                                        {!systemManaged && canDeletePayment && (
                                                            <AdminButton
                                                                type="button"
                                                                disabled={deleting}
                                                                onClick={() =>
                                                                    void removeMethod({
                                                                        kind: 'payment',
                                                                        item,
                                                                    })
                                                                }
                                                                className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                                                aria-label={`删除支付方式${displayName}`}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </AdminButton>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {!data.paymentMethods.items.length && (
                            <div className="p-8 text-center text-xs text-slate-400">未配置支付方式</div>
                        )}
                    </section>
                )}

                {section === 'shipping' &&
                    (isPlatform || commerceMode === 'PHYSICAL_ONLY' || commerceMode === 'HYBRID') && (
                        <ShippingTemplatesPanel
                            data={data}
                            onCreate={() => setEditor({ kind: 'shipping' })}
                            onEdit={item => setEditor({ kind: 'shipping', item })}
                            onDelete={item => void removeMethod({ kind: 'shipping', item })}
                            deleting={deleting}
                            onChanged={onChanged}
                            onError={onError}
                        />
                    )}
                {section === 'shipping' && !isPlatform && commerceMode == null && (
                    <section
                        className="rounded-xl border border-slate-200 bg-white p-5"
                        role={commerceModeQuery.error ? 'alert' : 'status'}
                    >
                        <p>
                            {commerceModeQuery.error
                                ? '读取本店经营模式失败，暂时无法操作配送设置。'
                                : '正在确认本店经营模式…'}
                        </p>
                        {commerceModeQuery.error && (
                            <AdminButton type="button" onClick={() => void commerceModeQuery.refetch()}>
                                重试读取
                            </AdminButton>
                        )}
                    </section>
                )}
                {section === 'shipping' && !isPlatform && commerceMode === 'DIGITAL_ONLY' && (
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="border-b border-slate-100 p-5">
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                <Truck className="h-4 w-4 text-blue-600" /> 配送方式
                                <FeatureHelpButton
                                    topic="settings.payment-shipping"
                                    title="配送方式"
                                    description={'管理资格检查器、运费计算器和履约处理器'}
                                />
                            </h2>
                        </div>
                        <div className="p-10 text-center text-xs text-slate-400">
                            当前为纯数字商品模式，无需配置配送方式
                        </div>
                    </section>
                )}
            </div>
            {section === 'payment' && isPlatform && !standalonePage && (
                <details className="rounded-xl border border-slate-200 bg-white p-4">
                    <summary className="cursor-pointer text-sm font-bold">
                        USDT 收款配置 · 展开查看状态、汇率与收款地址
                    </summary>
                    <div className="mt-4">
                        <UsdtPaymentSetupPanel
                            key={data.activeChannel.id}
                            onChanged={onChanged}
                            onError={onError}
                        />
                    </div>
                </details>
            )}
            {editor && (
                <MethodEditorDialog
                    state={editor}
                    data={data}
                    customFieldDefinitions={
                        editor.kind === 'payment' ? paymentMethodCustomFields : shippingMethodCustomFields
                    }
                    onClose={() => setEditor(null)}
                    onCompleted={async message => {
                        setEditor(null);
                        await onChanged(message);
                    }}
                    onError={onError}
                />
            )}
        </>
    );
}

type StorePaymentOption = {
    id: string;
    name: string;
    description: string;
    code: string;
    handlerCode: string;
    enabled: boolean;
    platformEnabled: boolean;
    effectiveEnabled: boolean;
};
const STORE_PAYMENT_SWITCHES = gql`
    query StorePaymentSwitches {
        myStorePaymentOptions {
            id
            name
            description
            code
            handlerCode
            enabled
            platformEnabled
            effectiveEnabled
        }
    }
`;
function StorePaymentSwitches({
    onChanged,
    onError,
}: {
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateStoreProfile']);
    const query = useQuery<{ myStorePaymentOptions: StorePaymentOption[] }>(STORE_PAYMENT_SWITCHES, {});
    const [save, saving] = useMutation(SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION);
    const toggle = async (item: StorePaymentOption, enabled: boolean) => {
        try {
            await save({ variables: { id: item.id, enabled } });
            await query.refetch();
            await onChanged(`本店${item.name}已${enabled ? '开启' : '关闭'}`);
        } catch (error) {
            onError(toUserFacingError(error, '本店支付开关更新失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold">
                本店支付方式
                <FeatureHelpButton
                    topic="settings.payment-shipping"
                    title="本店支付方式"
                    description={
                        '支付系统由平台管理中心统一配置。本店开关只影响本店新订单，交易、退款和余额仍归本店。'
                    }
                />
            </h2>

            {query.loading && !query.data && <p className="mt-4 text-xs">正在读取平台支付方式…</p>}
            {query.error && (
                <p role="alert" className="mt-4 text-xs text-rose-600">
                    支付方式未获取，请刷新重试
                </p>
            )}
            <div
                className="admin-comparison-scroll mt-4 overflow-x-auto"
                role="region"
                aria-label="本店支付方式"
                tabIndex={0}
            >
                <p className="admin-mobile-table-hint">左右滑动查看完整支付方式</p>
                <table className="admin-compact-table w-full min-w-[980px] text-left text-xs">
                    <thead>
                        <tr>
                            {['支付方式', '描述', '平台状态', '本店状态', '有效状态', '本店开关'].map(
                                label => (
                                    <th key={label}>{label}</th>
                                ),
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {query.data?.myStorePaymentOptions?.map(item => (
                            <tr key={item.id}>
                                <td className="font-semibold">{item.name}</td>
                                <td className="max-w-96 truncate text-slate-500" title={item.description}>
                                    {item.description || '—'}
                                </td>
                                <td>{item.platformEnabled ? '平台启用' : '平台已停用'}</td>
                                <td>{item.enabled ? '本店已开启' : '本店未开启'}</td>
                                <td>{item.effectiveEnabled ? '已启用' : '未启用'}</td>
                                <td>
                                    {canUpdate && (
                                        <AdminInput
                                            type="checkbox"
                                            aria-label={`本店${item.name}开关`}
                                            checked={item.enabled}
                                            disabled={
                                                saving.loading || (!item.platformEnabled && !item.enabled)
                                            }
                                            onChange={event => void toggle(item, event.target.checked)}
                                        />
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {query.data?.myStorePaymentOptions?.length === 0 && (
                <p className="mt-4 text-xs text-slate-500">平台尚未配置支付方式</p>
            )}
        </section>
    );
}

function MethodEditorDialog({
    data,
    customFieldDefinitions,
    onClose,
    onCompleted,
    onError,
    state,
}: {
    data: StoreManagementResult;
    customFieldDefinitions: CustomFieldDefinition[];
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
    state: EditorState;
}) {
    const item = state.item;
    const storeShipping = state.kind === 'shipping' && data.activeChannel.code !== '__default_channel__';
    const initialTestPayment = state.kind === 'payment' && state.testPayment;
    const languageCode = getAdminDisplayLanguage();
    const selectedTranslation = getLocalizedEntityTranslation(item?.translations, languageCode);
    const checkerDefinitions =
        state.kind === 'payment'
            ? data.paymentMethodEligibilityCheckers
            : data.shippingEligibilityCheckers.filter(
                  definition =>
                      data.activeChannel.code === '__default_channel__' ||
                      definition.code === 'store-shipping-zone-eligibility-checker',
              );
    const mainDefinitions =
        state.kind === 'payment'
            ? selectablePaymentHandlers(data.paymentMethodHandlers)
            : data.shippingCalculators
                  .filter(
                      definition =>
                          data.activeChannel.code === '__default_channel__' ||
                          definition.code === 'physical-subtotal-shipping-calculator',
                  )
                  .map(definition => ({
                      ...definition,
                      args: definition.args.filter(
                          arg =>
                              !storeShipping ||
                              !['sourceCurrencyCode', 'currencyCode', 'baseRate', 'freeAbove'].includes(
                                  arg.name,
                              ),
                      ),
                  }));
    const [code, setCode] = useState(
        item?.code ??
            (initialTestPayment
                ? 'controlled-test-payment-platform'
                : storeShipping
                  ? `store-shipping-${data.activeChannel.id}-${globalThis.crypto.randomUUID()}`
                  : ''),
    );
    const [name, setName] = useState(
        selectedTranslation?.name ?? (item ? '' : initialTestPayment ? '测试支付' : ''),
    );
    const [description, setDescription] = useState(selectedTranslation?.description ?? '');
    const [enabled, setEnabled] = useState(
        state.kind === 'payment' ? (state.item?.enabled ?? !initialTestPayment) : true,
    );
    const [checkerCode, setCheckerCode] = useState(
        storeShipping ? 'store-shipping-zone-eligibility-checker' : (item?.checker?.code ?? ''),
    );
    const [handlerCode, setHandlerCode] = useState(
        state.kind === 'payment'
            ? (state.item?.handler.code ?? (initialTestPayment ? testPaymentHandler : ''))
            : '',
    );
    const [calculatorCode, setCalculatorCode] = useState(
        state.kind === 'shipping'
            ? storeShipping
                ? 'physical-subtotal-shipping-calculator'
                : (state.item?.calculator.code ?? '')
            : '',
    );
    const [fulfillmentHandler, setFulfillmentHandler] = useState(
        state.kind === 'shipping'
            ? (state.item?.fulfillmentHandlerCode ?? (storeShipping ? 'manual-fulfillment' : ''))
            : '',
    );
    const [checkerArgs, setCheckerArgs] = useState(() => argsToForm(item?.checker, checkerDefinitions));
    const [handlerArgs, setHandlerArgs] = useState(() =>
        initialTestPayment && !item
            ? { channelId: data.activeChannel.id, qaSku: '', qaMarker: '', orderCode: '' }
            : argsToForm(
                  state.kind === 'payment' ? state.item?.handler : undefined,
                  data.paymentMethodHandlers,
              ),
    );
    const [calculatorArgs, setCalculatorArgs] = useState<Record<string, string>>(() =>
        storeShipping &&
        state.kind === 'shipping' &&
        state.item?.calculator.code === 'default-shipping-calculator'
            ? (() => {
                  const original = argsToForm(state.item.calculator, data.shippingCalculators);
                  return {
                      ...defaultArgs('physical-subtotal-shipping-calculator', data.shippingCalculators),
                      baseRate: original.rate ?? '0',
                      freeAbove: '0',
                      sourceCurrencyCode:
                          original.sourceCurrencyCode ||
                          original.currencyCode ||
                          data.activeChannel.defaultCurrencyCode,
                      taxRate: original.taxRate ?? '0',
                      priceIncludesTax: String(original.includesTax === 'include'),
                  };
              })()
            : state.kind === 'shipping' && !item && storeShipping
              ? {
                    ...defaultArgs('physical-subtotal-shipping-calculator', data.shippingCalculators),
                    sourceCurrencyCode: data.activeChannel.defaultCurrencyCode,
                }
              : argsToForm(
                    state.kind === 'shipping' ? state.item?.calculator : undefined,
                    data.shippingCalculators,
                ),
    );
    const [amountCurrency] = useState(
        () =>
            calculatorArgs.sourceCurrencyCode ||
            calculatorArgs.currencyCode ||
            data.activeChannel.defaultCurrencyCode,
    );
    const calculatorInputValues = storeShipping
        ? { ...calculatorArgs, sourceCurrencyCode: amountCurrency }
        : calculatorArgs;
    const currentShippingItem =
        state.kind === 'shipping' && item
            ? data.shippingMethods.items.find(method => method.id === item.id)
            : undefined;
    const shippingVersionChanged = Boolean(
        state.kind === 'shipping' &&
        item &&
        currentShippingItem &&
        currentShippingItem.updatedAt !== item.updatedAt,
    );
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, item?.customFields, item?.translations),
    );
    const [createPayment, createPaymentState] = useMutation(CREATE_PAYMENT_METHOD_MUTATION);
    const [updatePayment, updatePaymentState] = useMutation(UPDATE_PAYMENT_METHOD_MUTATION);
    const [createShipping, createShippingState] = useMutation(CREATE_SHIPPING_METHOD_MUTATION);
    const [updateShipping, updateShippingState] = useMutation(UPDATE_SHIPPING_METHOD_MUTATION);
    const busy =
        createPaymentState.loading ||
        updatePaymentState.loading ||
        createShippingState.loading ||
        updateShippingState.loading;

    const serializedDraft = JSON.stringify({
        code,
        name,
        description,
        checkerCode,
        checkerArgs,
        calculatorCode,
        calculatorArgs,
        fulfillmentHandler,
        customFieldValues,
    });
    const [initialDraft] = useState(() => serializedDraft);
    const shippingDirty = state.kind === 'shipping' && serializedDraft !== initialDraft;
    useUnsavedChangesWarning(shippingDirty, '配送模板还有未保存的修改，确定放弃吗？');
    const requestConfirmation = useConfirmDialog();
    const requestClose = async () => {
        if (busy) return;
        if (
            shippingDirty &&
            !(await requestConfirmation({
                title: '放弃配送模板修改？',
                description: '尚未保存的内容将被放弃。',
                confirmLabel: '放弃修改',
            }))
        )
            return;
        onClose();
    };
    const isControlledTest = state.kind === 'payment' && handlerCode === testPaymentHandler;
    const fulfillmentDefinition = data.fulfillmentHandlers?.find(
        definition => definition.code === fulfillmentHandler,
    );

    const applyShippingPreset = (presetKey: 'standard-threshold' | 'pickup-in-store' | 'free-shipping') => {
        const defaultCurrency = amountCurrency;
        const defaultFulfillment = data.fulfillmentHandlers.some(d => d.code === 'manual-fulfillment')
            ? 'manual-fulfillment'
            : (data.fulfillmentHandlers[0]?.code ?? 'manual-fulfillment');

        if (presetKey === 'standard-threshold') {
            if (!storeShipping) setCode('standard-shipping');
            setName('本店配送');
            setDescription('普通快递配送，实物商品满额即享免运费');
            setFulfillmentHandler(defaultFulfillment);

            const hasDestChecker = data.shippingEligibilityCheckers.some(
                d => d.code === 'store-shipping-zone-eligibility-checker',
            );
            if (hasDestChecker) {
                setCheckerCode('store-shipping-zone-eligibility-checker');
                setCheckerArgs({ allowedCountryCodes: '', blockedPostalPrefixes: '' });
            } else {
                const fallbackChecker =
                    data.shippingEligibilityCheckers[0]?.code ?? 'default-shipping-eligibility-checker';
                setCheckerCode(fallbackChecker);
                setCheckerArgs(defaultArgs(fallbackChecker, data.shippingEligibilityCheckers));
            }

            const hasPhysicalCalc = data.shippingCalculators.some(
                d => d.code === 'physical-subtotal-shipping-calculator',
            );
            if (hasPhysicalCalc) {
                setCalculatorCode('physical-subtotal-shipping-calculator');
                setCalculatorArgs({
                    baseRate: '0',
                    freeAbove: '0',
                    sourceCurrencyCode: defaultCurrency,
                    taxRate: '0',
                    priceIncludesTax: 'false',
                    estimateMinDays: '1',
                    estimateMaxDays: '3',
                });
            } else {
                setCalculatorCode('default-shipping-calculator');
                setCalculatorArgs({
                    rate: '0',
                    taxRate: '0',
                    includesTax: 'include',
                });
            }
        } else if (presetKey === 'pickup-in-store') {
            if (!storeShipping) setCode('pickup-in-store');
            setName('上门自提');
            setDescription('买家自行前往门店或自提点取货，免运费');
            setFulfillmentHandler(defaultFulfillment);

            const defaultChecker =
                checkerDefinitions.find(d => d.code === 'default-shipping-eligibility-checker') ??
                checkerDefinitions[0];
            if (defaultChecker) {
                setCheckerCode(defaultChecker.code);
                setCheckerArgs(defaultArgs(defaultChecker.code, data.shippingEligibilityCheckers));
            }

            const defaultCalc =
                mainDefinitions.find(d => d.code === 'default-shipping-calculator') ?? mainDefinitions[0];
            if (defaultCalc?.code === 'default-shipping-calculator') {
                setCalculatorCode('default-shipping-calculator');
                setCalculatorArgs({ rate: '0', taxRate: '0', includesTax: 'include' });
            } else if (defaultCalc?.code === 'physical-subtotal-shipping-calculator') {
                setCalculatorCode('physical-subtotal-shipping-calculator');
                setCalculatorArgs({
                    baseRate: '0',
                    freeAbove: '0',
                    sourceCurrencyCode: defaultCurrency,
                    taxRate: '0',
                    priceIncludesTax: 'false',
                    estimateMinDays: '0',
                    estimateMaxDays: '0',
                });
            } else if (defaultCalc) {
                setCalculatorCode(defaultCalc.code);
                setCalculatorArgs(defaultArgs(defaultCalc.code, data.shippingCalculators));
            }
        } else if (presetKey === 'free-shipping') {
            if (!storeShipping) setCode('free-shipping');
            setName('全场包邮');
            setDescription('全场实物商品免运费配送');
            setFulfillmentHandler(defaultFulfillment);

            const defaultChecker =
                checkerDefinitions.find(d => d.code === 'default-shipping-eligibility-checker') ??
                checkerDefinitions[0];
            if (defaultChecker) {
                setCheckerCode(defaultChecker.code);
                setCheckerArgs(defaultArgs(defaultChecker.code, data.shippingEligibilityCheckers));
            }

            const defaultCalc =
                mainDefinitions.find(d => d.code === 'default-shipping-calculator') ?? mainDefinitions[0];
            if (defaultCalc?.code === 'default-shipping-calculator') {
                setCalculatorCode('default-shipping-calculator');
                setCalculatorArgs({ rate: '0', taxRate: '0', includesTax: 'include' });
            } else if (defaultCalc?.code === 'physical-subtotal-shipping-calculator') {
                setCalculatorCode('physical-subtotal-shipping-calculator');
                setCalculatorArgs({
                    baseRate: '0',
                    freeAbove: '0',
                    sourceCurrencyCode: defaultCurrency,
                    taxRate: '0',
                    priceIncludesTax: 'false',
                    estimateMinDays: '1',
                    estimateMaxDays: '3',
                });
            } else if (defaultCalc) {
                setCalculatorCode(defaultCalc.code);
                setCalculatorArgs(defaultArgs(defaultCalc.code, data.shippingCalculators));
            }
        }
    };

    const submit = async () => {
        if (shippingVersionChanged)
            return onError('此配送模板已被更新，请关闭并重新打开后编辑，避免覆盖最新内容。');
        if (
            storeShipping &&
            ['baseRate', 'freeAbove'].some(
                key =>
                    calculatorArgs[key] === '' ||
                    !Number.isSafeInteger(Number(calculatorArgs[key])) ||
                    Number(calculatorArgs[key]) < 0,
            )
        )
            return onError('请填写有效的基础运费与免邮门槛，金额不能小于零。');
        if (!code.trim() || !name.trim()) return onError('请填写配置代码和显示名称');
        const customFieldErrors = validateCustomFieldValues(
            customFieldDefinitions,
            customFieldValues,
            languageCode,
        );
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? '扩展字段校验失败');
        }
        try {
            const checker = isControlledTest
                ? operationInput(testPaymentChecker, {}, checkerDefinitions)
                : checkerCode
                  ? operationInput(checkerCode, checkerArgs, checkerDefinitions)
                  : null;
            const customFields = customFieldInputFromValues(customFieldDefinitions, customFieldValues);
            const existingTranslations = item?.translations ?? [];
            const translations = existingTranslations.map(translation => ({
                ...(translation.id ? { id: translation.id } : {}),
                languageCode: translation.languageCode,
                name: translation === selectedTranslation ? name.trim() : translation.name,
                description:
                    translation === selectedTranslation ? description.trim() : translation.description,
                customFields: localizedCustomFieldInputFromValues(
                    customFieldDefinitions,
                    customFieldValues,
                    translation.languageCode,
                ),
            }));
            if (!getLocalizedEntityTranslation(existingTranslations, languageCode)) {
                translations.push({
                    languageCode,
                    name: name.trim(),
                    description: description.trim(),
                    customFields: localizedCustomFieldInputFromValues(
                        customFieldDefinitions,
                        customFieldValues,
                        languageCode,
                    ),
                });
            }
            if (state.kind === 'payment') {
                if (
                    code.trim().toLowerCase() === USDT_PAYMENT_METHOD_CODE ||
                    handlerCode === USDT_PAYMENT_HANDLER_CODE
                ) {
                    return onError('USDT 支付方式由专用收款设置自动管理，请到“支付管理 → USDT 收款设置”操作');
                }
                if (!handlerCode) return onError('请选择支付处理器');
                const allowAllOrders = isControlledTest && handlerArgs.allowAllOrders === 'true';
                if (
                    isControlledTest &&
                    !allowAllOrders &&
                    (!handlerArgs.qaSku?.trim() || !handlerArgs.qaMarker?.trim())
                ) {
                    return onError('请选择全店开放，或填写测试商品 SKU 和完整订单备注');
                }
                const input = {
                    ...(item?.id ? { id: item.id } : {}),
                    code: isControlledTest ? 'controlled-test-payment-platform' : code.trim(),
                    enabled,
                    checker,
                    handler: operationInput(
                        handlerCode,
                        isControlledTest
                            ? {
                                  channelId: data.activeChannel.id,
                                  allowAllOrders: allowAllOrders ? 'true' : 'false',
                                  qaSku: allowAllOrders ? '' : (handlerArgs.qaSku?.trim() ?? ''),
                                  qaMarker: allowAllOrders ? '' : (handlerArgs.qaMarker?.trim() ?? ''),
                                  orderCode: allowAllOrders ? '' : (handlerArgs.orderCode?.trim() ?? ''),
                              }
                            : handlerArgs,
                        mainDefinitions,
                    ),
                    translations,
                    customFields,
                };
                if (item?.id) await updatePayment({ variables: { input } });
                else await createPayment({ variables: { input } });
                await onCompleted(item ? '支付方式已更新' : '支付方式已创建');
            } else {
                if (!checkerCode || !calculatorCode || !fulfillmentHandler)
                    return onError('请选择资格检查器、运费计算器和履约处理器');
                const input = {
                    ...(item?.id ? { id: item.id } : {}),
                    code: code.trim(),
                    fulfillmentHandler,
                    checker: operationInput(checkerCode, checkerArgs, data.shippingEligibilityCheckers),
                    calculator: operationInput(
                        calculatorCode,
                        calculatorInputValues,
                        data.shippingCalculators,
                    ),
                    translations,
                    customFields,
                };
                if (item?.id) await updateShipping({ variables: { input } });
                else await createShipping({ variables: { input } });
                try {
                    await onCompleted(item ? '配送方式已更新' : '配送方式已创建');
                } catch {
                    onError('配送方式已保存，但读取最新列表失败，请刷新；不要重复保存。');
                }
            }
        } catch (error) {
            onError(toUserFacingError(error, '配置保存失败，请检查处理器参数'));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={`${item ? '编辑' : '新增'}${state.kind === 'payment' ? '支付方式' : '配送方式'}`}
                onRequestClose={() => void requestClose()}
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            >
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">
                            {item ? '编辑' : '新增'}
                            {state.kind === 'payment' ? '支付方式' : '配送方式'}
                        </h2>
                        <p className="mt-1 text-xs text-slate-400">
                            {state.kind === 'shipping'
                                ? '保存后可在配送列表中为本店启用或停用'
                                : '参数值会直接写入 Vendure 配置'}
                        </p>
                    </div>
                    <AdminButton
                        type="button"
                        onClick={() => void requestClose()}
                        disabled={busy}
                        className="rounded-lg p-2 text-slate-500"
                    >
                        <X className="h-4 w-4" />
                    </AdminButton>
                </header>
                <div className="space-y-5 p-5">
                    {state.kind === 'shipping' && (
                        <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3.5">
                            <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
                                    <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                                    快捷套用常用模板
                                </span>
                                <span className="text-[10px] text-blue-700">
                                    点击自动填充推荐参数，无需猜测计算器设置
                                </span>
                            </div>
                            <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
                                {SHIPPING_PRESETS.map(preset => (
                                    <AdminButton
                                        key={preset.key}
                                        type="button"
                                        onClick={() => applyShippingPreset(preset.key)}
                                        className="flex flex-col items-start rounded-lg border border-blue-200 bg-white p-2.5 text-left transition hover:border-blue-400 hover:bg-blue-50/50 hover:shadow-sm active:scale-[0.99]"
                                    >
                                        <div className="flex w-full items-center justify-between gap-1">
                                            <span className="text-xs font-bold text-slate-800">
                                                {preset.title}
                                            </span>
                                            <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
                                                {preset.badge}
                                            </span>
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500">
                                            {preset.description}
                                        </p>
                                    </AdminButton>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                        {!storeShipping && (
                            <Field label="配置代码 *">
                                <AdminInput
                                    value={code}
                                    disabled={isControlledTest}
                                    onChange={event => setCode(event.target.value)}
                                    className={inputClass}
                                />
                            </Field>
                        )}
                        <Field label="显示名称 *">
                            <AdminInput
                                value={name}
                                onChange={event => setName(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    <Field label="描述">
                        <AdminTextArea
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                            rows={3}
                            className={inputClass}
                        />
                    </Field>
                    {state.kind === 'shipping' && (
                        <Field label="金额来源币种">
                            <AdminInput value={amountCurrency} readOnly className={inputClass} />
                            <p className="mt-1 text-xs text-slate-500">
                                新模板使用本店默认币种；已保存的金额按来源币种计算，不随店铺币种改动重新解释。
                            </p>
                        </Field>
                    )}
                    {state.kind === 'payment' && (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <AdminInput
                                type="checkbox"
                                checked={enabled}
                                onChange={event => setEnabled(event.target.checked)}
                            />
                            启用该支付方式
                        </label>
                    )}
                    {isControlledTest ? (
                        <p className="text-xs leading-5 text-slate-700">
                            选择全店开放后，所有访客都可对本店商品使用模拟支付。不会真实扣款，但会生成正常已付款订单并影响库存与履约。
                        </p>
                    ) : (
                        <OperationEditor
                            label={state.kind === 'payment' ? '资格检查器（可选）' : '配送范围'}
                            allowEmpty={state.kind === 'payment'}
                            code={checkerCode}
                            values={checkerArgs}
                            definitions={checkerDefinitions}
                            onCodeChange={nextCode => {
                                setCheckerCode(nextCode);
                                setCheckerArgs(defaultArgs(nextCode, checkerDefinitions));
                            }}
                            onValuesChange={setCheckerArgs}
                        />
                    )}
                    {state.kind === 'payment' ? (
                        <div className="space-y-3">
                            <TestPaymentAvailabilityNotice definitions={data.paymentMethodHandlers} />
                            <OperationEditor
                                label="支付处理器 *"
                                code={handlerCode}
                                values={handlerArgs}
                                definitions={mainDefinitions}
                                onCodeChange={nextCode => {
                                    setHandlerCode(nextCode);
                                    if (nextCode === testPaymentHandler) {
                                        setCode('controlled-test-payment-platform');
                                        setEnabled(false);
                                        setHandlerArgs({
                                            channelId: data.activeChannel.id,
                                            qaSku: '',
                                            qaMarker: '',
                                            orderCode: '',
                                        });
                                    } else setHandlerArgs(defaultArgs(nextCode, mainDefinitions));
                                }}
                                onValuesChange={setHandlerArgs}
                            />
                        </div>
                    ) : (
                        <>
                            {storeShipping && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <ShippingAmountField
                                        label="基础运费"
                                        currency={amountCurrency}
                                        value={calculatorArgs.baseRate ?? '0'}
                                        onChange={value =>
                                            setCalculatorArgs(args => ({ ...args, baseRate: value }))
                                        }
                                    />
                                    <ShippingAmountField
                                        label="实物免邮门槛（0 表示不启用）"
                                        currency={amountCurrency}
                                        value={calculatorArgs.freeAbove ?? '0'}
                                        onChange={value =>
                                            setCalculatorArgs(args => ({ ...args, freeAbove: value }))
                                        }
                                    />
                                    <p className="text-xs text-slate-500 sm:col-span-2">
                                        直接填写金额，例如
                                        5.50；免邮门槛由本店自行决定，仅计算优惠后含税实物商品小计。
                                    </p>
                                </div>
                            )}
                            <OperationEditor
                                label="运费与免邮规则"
                                code={calculatorCode}
                                values={calculatorArgs}
                                definitions={mainDefinitions}
                                onCodeChange={nextCode => {
                                    setCalculatorCode(nextCode);
                                    setCalculatorArgs({
                                        ...defaultArgs(nextCode, data.shippingCalculators),
                                        ...(storeShipping ? { sourceCurrencyCode: amountCurrency } : {}),
                                    });
                                }}
                                onValuesChange={setCalculatorArgs}
                            />
                            <Field label="发货方式">
                                <AdminSelect
                                    value={fulfillmentHandler}
                                    onChange={event => setFulfillmentHandler(event.target.value)}
                                    className={inputClass}
                                >
                                    <option value="">请选择</option>
                                    {data.fulfillmentHandlers.map(definition => (
                                        <option key={definition.code} value={definition.code}>
                                            {configurableOperationLabel(definition, '履约处理方式')}
                                        </option>
                                    ))}
                                </AdminSelect>
                            </Field>
                            {fulfillmentDefinition && (
                                <ConfigurableOperationTechnicalDetails definition={fulfillmentDefinition} />
                            )}
                            <ShippingMethodTester
                                checkerCode={checkerCode}
                                checkerArgs={checkerArgs}
                                calculatorCode={calculatorCode}
                                calculatorArgs={calculatorInputValues}
                                checkerDefinitions={data.shippingEligibilityCheckers}
                                calculatorDefinitions={data.shippingCalculators}
                                currencyCode={data.activeChannel.defaultCurrencyCode}
                            />
                        </>
                    )}
                    <DynamicCustomFieldsForm
                        helpTopic="settings.payment-shipping"
                        title={`${state.kind === 'payment' ? '支付方式' : '配送方式'}扩展字段`}
                        fields={customFieldDefinitions}
                        values={customFieldValues}
                        onChange={setCustomFieldValues}
                        disabled={busy}
                    />
                </div>
                <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
                    <AdminButton
                        type="button"
                        onClick={() => void requestClose()}
                        disabled={busy}
                        className={secondaryButton}
                    >
                        取消
                    </AdminButton>
                    <AdminButton
                        type="button"
                        disabled={busy}
                        onClick={() => void submit()}
                        className={primaryButton}
                    >
                        {busy ? '保存中…' : '保存配置'}
                    </AdminButton>
                </footer>
            </AccessibleDialogSurface>
        </div>
    );
}

/** Business amounts are entered in currency units; Vendure stores integer minor units. */
function ShippingAmountField({
    label,
    currency,
    value,
    onChange,
}: {
    label: string;
    currency: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const [text, setText] = useState(() => (value === '' ? '' : String(Number(value) / 100)));
    const lastWritten = useRef(value);
    useEffect(() => {
        if (value !== lastWritten.current) {
            setText(value === '' ? '' : String(Number(value) / 100));
            lastWritten.current = value;
        }
    }, [value]);
    return (
        <Field label={`${label} · ${currency}`}>
            <AdminInput
                type="number"
                min="0"
                step="0.01"
                value={text}
                className={inputClass}
                onChange={event => {
                    const next = event.target.value;
                    setText(next);
                    const minor = next === '' ? '' : String(Math.round(Number(next) * 100));
                    lastWritten.current = minor;
                    onChange(minor);
                }}
            />
        </Field>
    );
}

function ShippingMethodTester({
    checkerCode,
    checkerArgs,
    calculatorCode,
    calculatorArgs,
    checkerDefinitions,
    calculatorDefinitions,
    currencyCode,
}: {
    checkerCode: string;
    checkerArgs: Record<string, string>;
    calculatorCode: string;
    calculatorArgs: Record<string, string>;
    checkerDefinitions: ConfigurableOperationDefinitionRecord[];
    calculatorDefinitions: ConfigurableOperationDefinitionRecord[];
    currencyCode: string;
}) {
    const [variantId, setVariantId] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [countryCode, setCountryCode] = useState('CN');
    const [streetLine1, setStreetLine1] = useState('测试地址');
    const [city, setCity] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [error, setError] = useState('');
    const [testMethod, result] = useLazyQuery<{
        testShippingMethod: {
            eligible: boolean;
            quote: { price: number; priceWithTax: number; metadata: unknown } | null;
        };
    }>(TEST_SHIPPING_METHOD_QUERY, { fetchPolicy: 'no-cache' });
    const run = async () => {
        setError('');
        const parsedQuantity = Number(quantity);
        if (!variantId.trim()) return setError('请输入用于试算的商品 SKU ID');
        if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) return setError('数量必须是正整数');
        if (!/^[A-Za-z]{2}$/.test(countryCode.trim())) return setError('国家代码必须是两位 ISO 代码');
        if (!streetLine1.trim()) return setError('地址第一行不能为空');
        try {
            await testMethod({
                variables: {
                    input: {
                        checker: operationInput(checkerCode, checkerArgs, checkerDefinitions),
                        calculator: operationInput(calculatorCode, calculatorArgs, calculatorDefinitions),
                        shippingAddress: {
                            streetLine1: streetLine1.trim(),
                            city: city.trim() || undefined,
                            postalCode: postalCode.trim() || undefined,
                            countryCode: countryCode.trim().toUpperCase(),
                        },
                        lines: [{ productVariantId: variantId.trim(), quantity: parsedQuantity }],
                    },
                },
            });
        } catch (cause) {
            setError(toUserFacingError(cause, '配送方式试算失败'));
        }
    };
    const value = result.data?.testShippingMethod;
    return (
        <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
            <div className="flex items-start gap-2">
                <Beaker className="mt-0.5 h-4 w-4 text-blue-600" />
                <div>
                    <h3 className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        配送方式试算
                        <FeatureHelpButton
                            topic="settings.payment-shipping"
                            title="配送方式试算"
                            description={
                                '使用当前未保存的检查器和计算器参数，只执行 Vendure 试算查询，不创建订单。'
                            }
                        />
                    </h3>
                </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="商品 SKU ID *">
                    <AdminInput
                        value={variantId}
                        onChange={event => setVariantId(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="数量 *">
                    <AdminInput
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={event => setQuantity(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="国家代码 *">
                    <AdminInput
                        value={countryCode}
                        maxLength={2}
                        onChange={event => setCountryCode(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="地址第一行 *">
                    <AdminInput
                        value={streetLine1}
                        onChange={event => setStreetLine1(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="城市">
                    <AdminInput
                        value={city}
                        onChange={event => setCity(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="邮编">
                    <AdminInput
                        value={postalCode}
                        onChange={event => setPostalCode(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            {error && (
                <p className="mt-3 text-xs text-rose-700" role="alert">
                    {error}
                </p>
            )}
            {value && (
                <div
                    className={`mt-3 rounded-lg border p-3 text-xs ${value.eligible ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}
                >
                    {value.eligible && value.quote
                        ? `符合条件 · 未税 ${(value.quote.price / 100).toFixed(2)} ${currencyCode} · 含税 ${(value.quote.priceWithTax / 100).toFixed(2)} ${currencyCode}`
                        : '当前地址与商品不符合此配送方式条件'}
                </div>
            )}
            <AdminButton
                type="button"
                onClick={() => void run()}
                disabled={result.loading || !checkerCode || !calculatorCode}
                className={`${secondaryButton} mt-3`}
            >
                <Beaker className="h-3.5 w-3.5" />
                {result.loading ? '试算中…' : '执行试算'}
            </AdminButton>
        </section>
    );
}

function OperationEditor({
    allowEmpty = false,
    code,
    definitions,
    label,
    onCodeChange,
    onValuesChange,
    values,
}: {
    allowEmpty?: boolean;
    code: string;
    definitions: ConfigurableOperationDefinitionRecord[];
    label: string;
    onCodeChange: (code: string) => void;
    onValuesChange: (values: Record<string, string>) => void;
    values: Record<string, string>;
}) {
    const definition = useMemo(
        () => definitions.find(candidate => candidate.code === code),
        [code, definitions],
    );
    return (
        <section className="rounded-xl border border-slate-200 p-4">
            <Field label={label}>
                <AdminSelect
                    value={code}
                    onChange={event => onCodeChange(event.target.value)}
                    className={inputClass}
                >
                    <option value="">{allowEmpty ? '不使用检查器' : '请选择'}</option>
                    {definitions.map(item => (
                        <option key={item.code} value={item.code}>
                            {configurableOperationLabel(item, `${label}选项`)}
                        </option>
                    ))}
                </AdminSelect>
            </Field>
            {definition && (
                <div className="mt-2">
                    <p className="text-[10px] leading-4 text-slate-500">
                        {configurableOperationLabel(definition, `${label}选项`)}
                    </p>
                    <ConfigurableOperationTechnicalDetails definition={definition} />
                </div>
            )}
            {definition && definition.args.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {definition.args.map(arg => (
                        <ConfigurableOperationField
                            key={arg.name}
                            definition={arg}
                            operationCode={definition.code}
                            value={values[arg.name] ?? ''}
                            onChange={value => onValuesChange({ ...values, [arg.name]: value })}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <AdminField className="block text-xs font-bold text-slate-700" label={label}>
            <span className="mt-1.5 block">{children}</span>
        </AdminField>
    );
}

function argsToForm(
    operation: ConfigurableOperationRecord | null | undefined,
    definitions: ConfigurableOperationDefinitionRecord[] = [],
) {
    const definition = definitions.find(candidate => candidate.code === operation?.code);
    return Object.fromEntries(
        (operation?.args ?? []).map(arg => [
            arg.name,
            definition?.args.find(candidate => candidate.name === arg.name)?.list
                ? arg.value
                : displayValue(arg.value),
        ]),
    );
}

function defaultArgs(code: string, definitions: ConfigurableOperationDefinitionRecord[]) {
    const definition = definitions.find(candidate => candidate.code === code);
    return Object.fromEntries(
        (definition?.args ?? []).map(arg => [
            arg.name,
            arg.list
                ? typeof arg.defaultValue === 'string'
                    ? arg.defaultValue
                    : JSON.stringify(arg.defaultValue ?? [])
                : displayValue(arg.defaultValue),
        ]),
    );
}

function displayValue(value: unknown) {
    if (value == null) return '';
    if (typeof value !== 'string') return String(value);
    try {
        const parsed = JSON.parse(value) as unknown;
        return typeof parsed === 'string' ? parsed : String(parsed);
    } catch {
        return value;
    }
}

function operationInput(
    code: string,
    values: Record<string, string>,
    definitions: ConfigurableOperationDefinitionRecord[] = [],
) {
    const definition = definitions.find(candidate => candidate.code === code);
    if (!definition) throw new Error(`后端未注册处理器 ${code}`);
    const argumentsInput = definition.args.map(arg => {
        const raw = values[arg.name] ?? '';
        const label = configurableArgumentLabel(arg, definition.code);
        if (configurableArgumentRequiresValue(arg, code) && !raw.trim())
            throw new Error(`${label}为必填参数`);
        if (arg.list) {
            try {
                return { name: arg.name, value: serializeConfigurableListValue(raw, arg.type) };
            } catch (cause) {
                throw new Error(`${label}：${cause instanceof Error ? cause.message : '列表内容无效'}`);
            }
        }
        return { name: arg.name, value: serializeValue(raw, arg.type) };
    });
    return { code, arguments: argumentsInput };
}

function serializeValue(raw: string, type: string) {
    const normalizedType = type.toLowerCase();
    // Vendure's scalar text coercion preserves the input verbatim; only list values use JSON arrays.
    if (['string', 'id', 'datetime'].includes(normalizedType)) return raw;
    if (normalizedType.includes('boolean')) return raw === 'true' ? 'true' : 'false';
    if (
        normalizedType.includes('int') ||
        normalizedType.includes('float') ||
        normalizedType.includes('number')
    ) {
        const numeric = Number(raw);
        if (!Number.isFinite(numeric)) throw new Error(`“${raw}”不是有效数字`);
        return JSON.stringify(numeric);
    }
    try {
        JSON.parse(raw);
        return raw;
    } catch {
        return JSON.stringify(raw);
    }
}
