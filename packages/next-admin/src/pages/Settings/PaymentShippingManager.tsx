import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import { Beaker, CreditCard, Pencil, Plus, Trash2, Truck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
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
    TEST_SHIPPING_METHOD_QUERY,
    UPDATE_PAYMENT_METHOD_MUTATION,
    UPDATE_SHIPPING_METHOD_MUTATION,
    type ConfigurableOperationDefinitionRecord,
    type ConfigurableOperationRecord,
    type StoreManagementResult,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';
import { UsdtPaymentSetupPanel } from './UsdtPaymentSetupPanel';
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
                {available ? '受控测试支付' : '受控测试支付尚未开放'}
            </p>
            <p className="mt-1">
                {available
                    ? '仅指定的已登录测试客户可用。订单标记为“测试已付款”，不真实扣款、发货、扣库存或产生收入和返利。测试时请移除优惠券，不要使用余额抵扣。'
                    : '当前服务器未开放受控测试支付，请联系平台管理员配置测试环境。填写“测试支付”作为名称不会开启功能。'}
            </p>
            {available && onConfigure && (
                <button type="button" onClick={onConfigure} className={`${secondaryButton} mt-3`}>
                    配置测试支付
                </button>
            )}
        </aside>
    );
}

export function PaymentShippingManager({
    data,
    paymentMethodCustomFields,
    shippingMethodCustomFields,
    onChanged,
    onError,
}: {
    data: StoreManagementResult;
    paymentMethodCustomFields: CustomFieldDefinition[];
    shippingMethodCustomFields: CustomFieldDefinition[];
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const commerceModeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {
        fetchPolicy: 'cache-first',
    });
    const commerceMode = commerceModeQuery.data?.myStoreCommerceMode.mode ?? 'HYBRID';
    const { hasAnyPermission } = useAdminPermissions();
    const canCreatePayment = hasAnyPermission(['CreateSettings', 'CreatePaymentMethod']);
    const canUpdatePayment = hasAnyPermission(['UpdateSettings', 'UpdatePaymentMethod']);
    const canDeletePayment = hasAnyPermission(['DeleteSettings', 'DeletePaymentMethod']);
    const canCreateShipping = hasAnyPermission(['CreateSettings', 'CreateShippingMethod']);
    const canUpdateShipping = hasAnyPermission(['UpdateSettings', 'UpdateShippingMethod']);
    const canDeleteShipping = hasAnyPermission(['DeleteSettings', 'DeleteShippingMethod']);
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
        const confirmed = await requestConfirmation({
            title: state.kind === 'payment' ? '删除支付方式' : '删除配送方式',
            description: `确定删除“${state.item.name}”？如果已有 Channel 或订单引用，后端会拒绝不安全的删除。`,
            confirmLabel: '确认删除',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            let result: { result: string; message?: string | null } | undefined;
            if (state.kind === 'payment') {
                const response = await deletePayment({
                    variables: { id: state.item.id, force: false },
                });
                result = response.data?.deletePaymentMethod;
            } else {
                const response = await deleteShipping({ variables: { id: state.item.id } });
                result = response.data?.deleteShippingMethod;
            }
            if (result?.result !== 'DELETED') throw new Error(result?.message || '后端未删除该配置');
            await onChanged(state.kind === 'payment' ? '支付方式已删除' : '配送方式已删除');
        } catch (error) {
            onError(toUserFacingError(error, '配置删除失败'));
        }
    };

    const deleting = deletePaymentState.loading || deleteShippingState.loading;
    const testMethod = data.paymentMethods.items.find(item => item.handler.code === testPaymentHandler);
    return (
        <>
            <div className={`grid gap-4 ${commerceMode === 'DIGITAL_ONLY' ? '' : 'xl:grid-cols-2'}`}>
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                <CreditCard className="h-4 w-4 text-blue-600" /> 支付方式
                                <FeatureHelpButton topic="settings.payment-shipping" title="支付方式" />
                            </h2>
                            <p className="mt-1 text-xs text-slate-400">
                                管理名称、处理器、资格检查器与启停状态
                            </p>
                        </div>
                        {canCreatePayment && (
                            <button
                                type="button"
                                onClick={() => setEditor({ kind: 'payment' })}
                                className={primaryButton}
                            >
                                <Plus className="h-3.5 w-3.5" /> 新增
                            </button>
                        )}
                    </div>
                    <div className="px-5 pt-4 empty:hidden">
                        <TestPaymentAvailabilityNotice
                            definitions={data.paymentMethodHandlers}
                            onConfigure={
                                (testMethod ? canUpdatePayment : canCreatePayment)
                                    ? () =>
                                          setEditor({ kind: 'payment', item: testMethod, testPayment: true })
                                    : undefined
                            }
                        />
                    </div>
                    <div className="divide-y divide-slate-100">
                        {data.paymentMethods.items.map(item => {
                            const systemManaged = isSystemManagedUsdtPaymentMethod(item);
                            return (
                                <div key={item.id} className="flex items-center justify-between gap-4 p-5">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <strong className="text-xs text-slate-900">{item.name}</strong>
                                            {systemManaged && (
                                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">
                                                    系统管理
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 font-mono text-[9px] text-slate-400">
                                            {item.code} · {item.handler.code}
                                        </p>
                                        {item.description && (
                                            <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                                                {item.description}
                                            </p>
                                        )}
                                        {systemManaged && (
                                            <p className="mt-1 text-[10px] text-emerald-700">
                                                由下方 USDT 收款地址审核状态自动启停和分配。
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {systemManaged ? (
                                            <span className="text-[10px] font-bold text-slate-500">
                                                {item.enabled ? '已启用' : '等待系统启用'}
                                            </span>
                                        ) : (
                                            <>
                                                {canUpdatePayment && (
                                                    <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                                                        <input
                                                            type="checkbox"
                                                            checked={item.enabled}
                                                            onChange={event =>
                                                                void changePayment(
                                                                    item.id,
                                                                    event.target.checked,
                                                                )
                                                            }
                                                            disabled={toggleState.loading}
                                                        />
                                                        {item.enabled ? '启用' : '停用'}
                                                    </label>
                                                )}
                                                {canUpdatePayment && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditor({ kind: 'payment', item })}
                                                        className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"
                                                        aria-label={`编辑支付方式${item.name}`}
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                                {canDeletePayment && (
                                                    <button
                                                        type="button"
                                                        disabled={deleting}
                                                        onClick={() =>
                                                            void removeMethod({ kind: 'payment', item })
                                                        }
                                                        className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                                        aria-label={`删除支付方式${item.name}`}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {!data.paymentMethods.items.length && (
                            <div className="p-10 text-center text-xs text-slate-400">未配置支付方式</div>
                        )}
                    </div>
                </section>

                {commerceMode !== 'DIGITAL_ONLY' && (
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    <Truck className="h-4 w-4 text-blue-600" /> 配送方式
                                    <FeatureHelpButton topic="settings.payment-shipping" title="配送方式" />
                                </h2>
                                <p className="mt-1 text-xs text-slate-400">
                                    管理资格检查器、运费计算器和履约处理器
                                </p>
                            </div>
                            {canCreateShipping && (
                                <button
                                    type="button"
                                    onClick={() => setEditor({ kind: 'shipping' })}
                                    className={primaryButton}
                                >
                                    <Plus className="h-3.5 w-3.5" /> 新增
                                </button>
                            )}
                        </div>
                        <div className="divide-y divide-slate-100">
                            {data.shippingMethods.items.map(item => (
                                <div key={item.id} className="flex items-center justify-between gap-4 p-5">
                                    <div className="min-w-0">
                                        <strong className="text-xs text-slate-900">{item.name}</strong>
                                        <p className="mt-1 font-mono text-[9px] text-slate-400">
                                            {item.code} · {item.calculator.code} ·{' '}
                                            {item.fulfillmentHandlerCode}
                                        </p>
                                        {item.description && (
                                            <p className="mt-1 line-clamp-2 text-[10px] text-slate-500">
                                                {item.description}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1">
                                        {canUpdateShipping && (
                                            <button
                                                type="button"
                                                onClick={() => setEditor({ kind: 'shipping', item })}
                                                className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"
                                                aria-label={`编辑配送方式${item.name}`}
                                            >
                                                <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        {canDeleteShipping && (
                                            <button
                                                type="button"
                                                disabled={deleting}
                                                onClick={() => void removeMethod({ kind: 'shipping', item })}
                                                className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                                aria-label={`删除配送方式${item.name}`}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {!data.shippingMethods.items.length && (
                                <div className="p-10 text-center text-xs text-slate-400">未配置配送方式</div>
                            )}
                        </div>
                    </section>
                )}
            </div>
            <UsdtPaymentSetupPanel key={data.activeChannel.id} onChanged={onChanged} onError={onError} />
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
    const initialTestPayment = state.kind === 'payment' && state.testPayment;
    const languageCode = item?.translations[0]?.languageCode ?? data.activeChannel.defaultLanguageCode;
    const [code, setCode] = useState(
        item?.code ?? (initialTestPayment ? `controlled-test-payment-${data.activeChannel.id}` : ''),
    );
    const [name, setName] = useState(item?.name ?? (initialTestPayment ? '测试支付' : ''));
    const [description, setDescription] = useState(item?.description ?? '');
    const [enabled, setEnabled] = useState(
        state.kind === 'payment' ? (state.item?.enabled ?? !initialTestPayment) : true,
    );
    const [checkerCode, setCheckerCode] = useState(item?.checker?.code ?? '');
    const [handlerCode, setHandlerCode] = useState(
        state.kind === 'payment'
            ? (state.item?.handler.code ?? (initialTestPayment ? testPaymentHandler : ''))
            : '',
    );
    const [calculatorCode, setCalculatorCode] = useState(
        state.kind === 'shipping' ? (state.item?.calculator.code ?? '') : '',
    );
    const [fulfillmentHandler, setFulfillmentHandler] = useState(
        state.kind === 'shipping' ? (state.item?.fulfillmentHandlerCode ?? '') : '',
    );
    const [checkerArgs, setCheckerArgs] = useState(() => argsToForm(item?.checker));
    const [handlerArgs, setHandlerArgs] = useState(() =>
        initialTestPayment && !item
            ? { channelId: data.activeChannel.id, customerIds: '' }
            : argsToForm(state.kind === 'payment' ? state.item?.handler : undefined),
    );
    const [calculatorArgs, setCalculatorArgs] = useState(() =>
        argsToForm(state.kind === 'shipping' ? state.item?.calculator : undefined),
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

    const checkerDefinitions =
        state.kind === 'payment' ? data.paymentMethodEligibilityCheckers : data.shippingEligibilityCheckers;
    const mainDefinitions =
        state.kind === 'payment'
            ? selectablePaymentHandlers(data.paymentMethodHandlers)
            : data.shippingCalculators;
    const isControlledTest = state.kind === 'payment' && handlerCode === testPaymentHandler;
    const submit = async () => {
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
            const translations = (
                item?.translations.length
                    ? item.translations
                    : [{ id: '', languageCode, name: '', description: '' }]
            ).map(translation => ({
                ...(translation.id ? { id: translation.id } : {}),
                languageCode: translation.languageCode,
                name: translation.languageCode === languageCode ? name.trim() : translation.name,
                description:
                    translation.languageCode === languageCode ? description.trim() : translation.description,
                customFields: localizedCustomFieldInputFromValues(
                    customFieldDefinitions,
                    customFieldValues,
                    translation.languageCode,
                ),
            }));
            if (state.kind === 'payment') {
                if (
                    code.trim().toLowerCase() === USDT_PAYMENT_METHOD_CODE ||
                    handlerCode === USDT_PAYMENT_HANDLER_CODE
                ) {
                    return onError('USDT 支付方式由下方专用收款配置自动管理，不能在这里创建或修改');
                }
                if (!handlerCode) return onError('请选择支付处理器');
                if (isControlledTest && !handlerArgs.customerIds?.trim()) return onError('请填写测试客户 ID');
                const input = {
                    ...(item?.id ? { id: item.id } : {}),
                    code: isControlledTest ? `controlled-test-payment-${data.activeChannel.id}` : code.trim(),
                    enabled,
                    checker,
                    handler: operationInput(
                        handlerCode,
                        isControlledTest ? { ...handlerArgs, channelId: data.activeChannel.id } : handlerArgs,
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
                    calculator: operationInput(calculatorCode, calculatorArgs, data.shippingCalculators),
                    translations,
                    customFields,
                };
                if (item?.id) await updateShipping({ variables: { input } });
                else await createShipping({ variables: { input } });
                await onCompleted(item ? '配送方式已更新' : '配送方式已创建');
            }
        } catch (error) {
            onError(toUserFacingError(error, '配置保存失败，请检查处理器参数'));
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={`${item ? '编辑' : '新增'}${state.kind === 'payment' ? '支付方式' : '配送方式'}`}
                onRequestClose={onClose}
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
            >
                <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">
                            {item ? '编辑' : '新增'}
                            {state.kind === 'payment' ? '支付方式' : '配送方式'}
                        </h2>
                        <p className="mt-1 text-xs text-slate-400">参数值会直接写入 Vendure 配置</p>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500">
                        <X className="h-4 w-4" />
                    </button>
                </header>
                <div className="space-y-5 p-5">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="配置代码 *">
                            <input
                                value={code}
                                disabled={isControlledTest}
                                onChange={event => setCode(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="显示名称 *">
                            <input
                                value={name}
                                onChange={event => setName(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    <Field label="描述">
                        <textarea
                            value={description}
                            onChange={event => setDescription(event.target.value)}
                            rows={3}
                            className={inputClass}
                        />
                    </Field>
                    {state.kind === 'payment' && (
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={event => setEnabled(event.target.checked)}
                            />
                            启用该支付方式
                        </label>
                    )}
                    {isControlledTest ? (
                        <p className="text-xs leading-5 text-slate-700">
                            资格检查：仅本店指定、已注册并验证邮箱的测试客户可用，由服务器强制校验。
                        </p>
                    ) : (
                        <OperationEditor
                            label={state.kind === 'payment' ? '资格检查器（可选）' : '资格检查器 *'}
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
                                        setCode(`controlled-test-payment-${data.activeChannel.id}`);
                                        setEnabled(false);
                                        setHandlerArgs({ channelId: data.activeChannel.id, customerIds: '' });
                                    } else setHandlerArgs(defaultArgs(nextCode, mainDefinitions));
                                }}
                                onValuesChange={setHandlerArgs}
                            />
                        </div>
                    ) : (
                        <>
                            <OperationEditor
                                label="运费计算器 *"
                                code={calculatorCode}
                                values={calculatorArgs}
                                definitions={mainDefinitions}
                                onCodeChange={nextCode => {
                                    setCalculatorCode(nextCode);
                                    setCalculatorArgs(defaultArgs(nextCode, mainDefinitions));
                                }}
                                onValuesChange={setCalculatorArgs}
                            />
                            <Field label="履约处理器 *">
                                <select
                                    value={fulfillmentHandler}
                                    onChange={event => setFulfillmentHandler(event.target.value)}
                                    className={inputClass}
                                >
                                    <option value="">请选择</option>
                                    {data.fulfillmentHandlers.map(definition => (
                                        <option key={definition.code} value={definition.code}>
                                            {definition.code}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <ShippingMethodTester
                                checkerCode={checkerCode}
                                checkerArgs={checkerArgs}
                                calculatorCode={calculatorCode}
                                calculatorArgs={calculatorArgs}
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
                    <button type="button" onClick={onClose} className={secondaryButton}>
                        取消
                    </button>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submit()}
                        className={primaryButton}
                    >
                        {busy ? '保存中…' : '保存配置'}
                    </button>
                </footer>
            </AccessibleDialogSurface>
        </div>
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
                        <FeatureHelpButton topic="settings.payment-shipping" title="配送方式试算" />
                    </h3>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        使用当前未保存的检查器和计算器参数，只执行 Vendure 试算查询，不创建订单。
                    </p>
                </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Field label="商品 SKU ID *">
                    <input
                        value={variantId}
                        onChange={event => setVariantId(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="数量 *">
                    <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={event => setQuantity(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="国家代码 *">
                    <input
                        value={countryCode}
                        maxLength={2}
                        onChange={event => setCountryCode(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="地址第一行 *">
                    <input
                        value={streetLine1}
                        onChange={event => setStreetLine1(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="城市">
                    <input
                        value={city}
                        onChange={event => setCity(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="邮编">
                    <input
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
            <button
                type="button"
                onClick={() => void run()}
                disabled={result.loading || !checkerCode || !calculatorCode}
                className={`${secondaryButton} mt-3`}
            >
                <Beaker className="h-3.5 w-3.5" />
                {result.loading ? '试算中…' : '执行试算'}
            </button>
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
                <select
                    value={code}
                    onChange={event => onCodeChange(event.target.value)}
                    className={inputClass}
                >
                    <option value="">{allowEmpty ? '不使用检查器' : '请选择'}</option>
                    {definitions.map(item => (
                        <option key={item.code} value={item.code}>
                            {item.code}
                        </option>
                    ))}
                </select>
            </Field>
            {definition?.description && (
                <p className="mt-2 text-[10px] leading-4 text-slate-400">{definition.description}</p>
            )}
            {definition && definition.args.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {definition.args.map(arg => (
                        <Field key={arg.name} label={`${arg.label || arg.name}${arg.required ? ' *' : ''}`}>
                            {arg.type.toLowerCase().includes('boolean') ? (
                                <select
                                    value={values[arg.name] ?? 'false'}
                                    onChange={event =>
                                        onValuesChange({ ...values, [arg.name]: event.target.value })
                                    }
                                    className={inputClass}
                                >
                                    <option value="true">是</option>
                                    <option value="false">否</option>
                                </select>
                            ) : (
                                <input
                                    type={arg.type.toLowerCase().includes('password') ? 'password' : 'text'}
                                    value={values[arg.name] ?? ''}
                                    onChange={event =>
                                        onValuesChange({ ...values, [arg.name]: event.target.value })
                                    }
                                    placeholder={arg.description ?? undefined}
                                    className={inputClass}
                                />
                            )}
                        </Field>
                    ))}
                </div>
            )}
        </section>
    );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            {label}
            <span className="mt-1.5 block">{children}</span>
        </label>
    );
}

function argsToForm(operation?: ConfigurableOperationRecord | null) {
    return Object.fromEntries((operation?.args ?? []).map(arg => [arg.name, displayValue(arg.value)]));
}

function defaultArgs(code: string, definitions: ConfigurableOperationDefinitionRecord[]) {
    const definition = definitions.find(candidate => candidate.code === code);
    return Object.fromEntries(
        (definition?.args ?? []).map(arg => [arg.name, displayValue(arg.defaultValue)]),
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
    definitions: ConfigurableOperationDefinitionRecord[],
) {
    const definition = definitions.find(candidate => candidate.code === code);
    if (!definition) throw new Error(`后端未注册处理器 ${code}`);
    const argumentsInput = definition.args.map(arg => {
        const raw = values[arg.name] ?? '';
        if (arg.required && !raw.trim()) throw new Error(`${arg.label || arg.name} 为必填参数`);
        return { name: arg.name, value: serializeValue(raw, arg.type) };
    });
    return { code, arguments: argumentsInput };
}

function serializeValue(raw: string, type: string) {
    const normalizedType = type.toLowerCase();
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
