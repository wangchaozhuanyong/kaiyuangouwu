import { useMutation } from '@apollo/client/react';
import { Copy, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AdminButton, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { addCustomFieldsToDocument } from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    CONFIRM_LEGACY_SHIPPING_METHOD_OWNERSHIP_MUTATION,
    COPY_LEGACY_SHIPPING_METHOD_MUTATION,
    COPY_PLATFORM_SHIPPING_TEMPLATE_MUTATION,
    CREATE_PLATFORM_FREE_SHIPPING_VERSION_MUTATION,
    INITIALIZE_PLATFORM_SHIPPING_TEMPLATES_MUTATION,
    SET_MY_SHIPPING_TEMPLATE_ENABLED_MUTATION,
    SHIPPING_TEMPLATE_MANAGEMENT_QUERY,
    type ShippingTemplateManagementData,
    type StoreManagementResult,
} from '../../graphql/management.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { getLocalizedEntityDescription, getLocalizedEntityName } from '../../utils/localized-entity-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatShippingCalculatorSummary, formatShippingCheckerSummary } from './shipping-manager-utils';

type ShippingMethod = StoreManagementResult['shippingMethods']['items'][number];

export function ShippingTemplatesPanel({
    data,
    onCreate,
    onEdit,
    onDelete,
    deleting,
    onChanged,
    onError,
}: {
    data: StoreManagementResult;
    onCreate: () => void;
    onEdit: (method: ShippingMethod) => void;
    onDelete: (method: ShippingMethod) => void;
    deleting: boolean;
    onChanged: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const fields = useCustomFieldDefinitions('ShippingMethod');
    const document = useMemo(
        () => addCustomFieldsToDocument(SHIPPING_TEMPLATE_MANAGEMENT_QUERY, 'ShippingMethod', fields),
        [fields],
    );
    const query = useAdminQuery<ShippingTemplateManagementData>(document);
    const { hasAnyPermission } = useAdminPermissions();
    const isPlatform = data.activeChannel.code === '__default_channel__';
    const canCreate = hasAnyPermission(['CreateSettings', 'CreateShippingMethod']);
    const canUpdate = hasAnyPermission(['UpdateSettings', 'UpdateShippingMethod']);
    const canDelete = hasAnyPermission(['DeleteSettings', 'DeleteShippingMethod']);
    const [initialize, initializing] = useMutation(INITIALIZE_PLATFORM_SHIPPING_TEMPLATES_MUTATION);
    const [toggle, toggling] = useMutation(SET_MY_SHIPPING_TEMPLATE_ENABLED_MUTATION);
    const [copy, copying] = useMutation(COPY_PLATFORM_SHIPPING_TEMPLATE_MUTATION);
    const [confirmLegacy, confirmingLegacy] = useMutation(CONFIRM_LEGACY_SHIPPING_METHOD_OWNERSHIP_MUTATION);
    const [copyLegacy, copyingLegacy] = useMutation(COPY_LEGACY_SHIPPING_METHOD_MUTATION);
    const [newVersion, creatingVersion] = useMutation(CREATE_PLATFORM_FREE_SHIPPING_VERSION_MUTATION);
    const busy =
        initializing.loading ||
        toggling.loading ||
        copying.loading ||
        confirmingLegacy.loading ||
        copyingLegacy.loading ||
        creatingVersion.loading ||
        deleting;
    const management = query.data?.shippingTemplateManagement;
    const items =
        management?.items ??
        data.shippingMethods.items.map(method => ({
            method,
            platformTemplate: false,
            ownedByStore: false,
            enabled: true,
            sourceCurrencyCode: null,
            ownershipConfirmed: false,
            assignedStoreChannels: [],
            templateVersion: null,
            latestPlatformTemplate: false,
        }));
    const write = async (operation: () => Promise<unknown>, message: string) => {
        try {
            await operation();
        } catch (error) {
            onError(toUserFacingError(error, '配送模板更新失败'));
            return;
        }
        try {
            await onChanged(message);
            await query.refetch();
        } catch {
            onError(`${message}，但最新列表读取失败，请刷新配送模板；不要重复提交。`);
        }
    };
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold">
                        <Truck className="h-4 w-4" />
                        配送方式 <FeatureHelpButton topic="settings.payment-shipping" title="配送方式" />
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                        {isPlatform
                            ? '维护通用模板，各经营店铺独立选择使用。'
                            : '选择通用模板，或创建仅由本店管理的配送模板。'}
                    </p>
                </div>
                {canCreate && (
                    <AdminButton type="button" onClick={onCreate} className="bg-blue-600 text-white">
                        <Plus className="h-4 w-4" />
                        {isPlatform ? '新增平台配送方式' : '新增本店模板'}
                    </AdminButton>
                )}
            </header>
            <div className="space-y-2 bg-slate-50 px-5 py-4 text-xs leading-5">
                <p>
                    包邮仍限定本店已配置的配送区域，不会向全球开放。没有配送区域时，客户会看到可执行的配送提示。
                </p>
                <p>
                    新模板的金额使用创建时本店默认币种；保存来源币种后不会因更换店铺币种重新解释。自定义免邮门槛仅累计优惠后含税实物商品小计。
                </p>
                <p>
                    通用包邮各版本保存后不可改写。平台创建新版不会自动更换本店规则，店铺需明确选择采用新版。
                </p>
                {isPlatform &&
                    management &&
                    management.missingPlatformTemplates === 0 &&
                    hasAnyPermission(['SuperAdmin']) && (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            onClick={() =>
                                void write(() => newVersion(), '新版通用包邮已创建，原版和各店当前选择保留')
                            }
                        >
                            创建新版通用包邮
                        </AdminButton>
                    )}
                {isPlatform &&
                    management &&
                    management.missingPlatformTemplates > 0 &&
                    hasAnyPermission(['SuperAdmin']) && (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            onClick={() => void write(() => initialize(), '平台包邮模板已创建')}
                        >
                            创建通用包邮模板
                        </AdminButton>
                    )}
                {query.loading && !management && <p role="status">正在读取模板归属与本店开关…</p>}
                {query.error && (
                    <div role="alert">
                        配送模板更新失败，保留已加载内容。
                        <AdminButton type="button" onClick={() => void query.refetch()}>
                            重试读取
                        </AdminButton>
                    </div>
                )}
            </div>
            <div className="divide-y divide-slate-100">
                {items.map(option => {
                    const method = option.method;
                    const name = getLocalizedEntityName(method);
                    const editable = isPlatform || option.ownedByStore;
                    return (
                        <article
                            key={method.id}
                            className="flex flex-wrap items-start justify-between gap-4 p-5"
                        >
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="text-sm">{name}</strong>
                                    <span className="text-xs text-slate-500">
                                        {option.platformTemplate
                                            ? '平台通用'
                                            : option.ownedByStore
                                              ? '本店模板'
                                              : '历史模板 · 归属待确认'}
                                    </span>
                                    {option.templateVersion && (
                                        <span className="text-xs text-slate-500">
                                            v{option.templateVersion}
                                            {option.latestPlatformTemplate ? ' · 最新版' : ' · 保留版'}
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-600">
                                    {formatShippingCalculatorSummary(
                                        method.calculator,
                                        option.sourceCurrencyCode ?? data.activeChannel.defaultCurrencyCode,
                                    )}
                                </p>
                                <p className="text-xs text-slate-500">
                                    {formatShippingCheckerSummary(method.checker)}
                                    {option.sourceCurrencyCode
                                        ? ` · 金额来源 ${option.sourceCurrencyCode}`
                                        : ''}
                                </p>
                                {getLocalizedEntityDescription(method) && (
                                    <p className="text-xs text-slate-500">
                                        {getLocalizedEntityDescription(method)}
                                    </p>
                                )}
                                {!editable && !option.platformTemplate && (
                                    <p className="text-xs text-slate-500">
                                        继续按原规则结算；修改或启停前请平台确认维护归属。
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {!isPlatform && (option.ownedByStore || option.platformTemplate) && (
                                    <AdminField label={`${name}本店开关`}>
                                        <AdminSelect
                                            aria-label={`${name}本店开关`}
                                            value={option.enabled ? 'on' : 'off'}
                                            disabled={busy || !canUpdate}
                                            onChange={event =>
                                                void write(
                                                    () =>
                                                        toggle({
                                                            variables: {
                                                                id: method.id,
                                                                enabled: event.target.value === 'on',
                                                            },
                                                        }),
                                                    `本店配送模板已${event.target.value === 'on' ? '启用' : '关闭'}`,
                                                )
                                            }
                                        >
                                            <option value="off">关闭</option>
                                            <option value="on">
                                                {option.platformTemplate && !option.enabled
                                                    ? `采用 v${option.templateVersion ?? 1} 并启用`
                                                    : '启用'}
                                            </option>
                                        </AdminSelect>
                                    </AdminField>
                                )}
                                {!isPlatform && option.platformTemplate && canCreate && (
                                    <AdminButton
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                            void write(
                                                () => copy({ variables: { id: method.id } }),
                                                '已复制为本店模板，当前关闭，请编辑后启用',
                                            )
                                        }
                                    >
                                        <Copy className="h-4 w-4" />
                                        复制到本店
                                    </AdminButton>
                                )}
                                {editable && !option.platformTemplate && canUpdate && (
                                    <AdminButton
                                        type="button"
                                        disabled={busy}
                                        onClick={() =>
                                            onEdit(
                                                option.sourceCurrencyCode
                                                    ? {
                                                          ...method,
                                                          calculator: {
                                                              ...method.calculator,
                                                              args: [
                                                                  ...(method.calculator.args ?? []).filter(
                                                                      arg =>
                                                                          arg.name !== 'sourceCurrencyCode',
                                                                  ),
                                                                  {
                                                                      name: 'sourceCurrencyCode',
                                                                      value: option.sourceCurrencyCode,
                                                                  },
                                                              ],
                                                          },
                                                      }
                                                    : method,
                                            )
                                        }
                                        aria-label={`编辑配送方式${name}`}
                                    >
                                        <Pencil className="h-4 w-4" />
                                        编辑
                                    </AdminButton>
                                )}
                                {editable && !option.platformTemplate && canDelete && (
                                    <AdminButton
                                        type="button"
                                        disabled={busy}
                                        onClick={() => onDelete(method)}
                                        aria-label={`删除配送方式${name}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        删除
                                    </AdminButton>
                                )}
                            </div>
                            {management && !option.platformTemplate && !option.ownedByStore && (
                                <LegacyShippingActions
                                    isPlatform={isPlatform}
                                    canConfirm={hasAnyPermission(['SuperAdmin'])}
                                    canCopy={canCreate}
                                    busy={busy}
                                    option={option}
                                    currentCurrency={data.activeChannel.defaultCurrencyCode}
                                    onConfirm={(channelId, sourceCurrencyCode) =>
                                        write(
                                            () =>
                                                confirmLegacy({
                                                    variables: {
                                                        id: method.id,
                                                        channelId,
                                                        sourceCurrencyCode,
                                                    },
                                                }),
                                            '旧模板归属及金额来源已确认，原金额保留',
                                        )
                                    }
                                    onCopy={sourceCurrencyCode =>
                                        write(
                                            () =>
                                                copyLegacy({
                                                    variables: { id: method.id, sourceCurrencyCode },
                                                }),
                                            '旧模板已复制为本店模板，原件不变；请核对后启用',
                                        )
                                    }
                                />
                            )}
                        </article>
                    );
                })}
                {!items.length && !query.loading && (
                    <p className="p-8 text-center text-sm text-slate-500">
                        {isPlatform
                            ? '尚未创建配送模板，可先创建通用包邮模板。'
                            : '尚未配置本店配送模板，可选择平台通用包邮或新增本店模板。'}
                    </p>
                )}
            </div>
        </section>
    );
}

function LegacyShippingActions({
    isPlatform,
    canConfirm,
    canCopy,
    busy,
    option,
    currentCurrency,
    onConfirm,
    onCopy,
}: {
    isPlatform: boolean;
    canConfirm: boolean;
    canCopy: boolean;
    busy: boolean;
    option: ShippingTemplateManagementData['shippingTemplateManagement']['items'][number];
    currentCurrency: string;
    onConfirm: (channelId: string, currency: string) => Promise<void>;
    onCopy: (currency: string) => Promise<void>;
}) {
    const [channelId, setChannelId] = useState('');
    const [currency, setCurrency] = useState('');
    if (isPlatform && option.ownershipConfirmed)
        return <p className="w-full text-xs text-slate-500">已确认维护归属，不可重复认领或改写金额来源。</p>;
    if (isPlatform && option.assignedStoreChannels.length !== 1)
        return (
            <p className="w-full text-xs text-slate-500">
                {option.assignedStoreChannels.length > 1
                    ? '多店共享旧模板不能直接认领。各关联店铺可在本店配送页复制旧模板，核对来源币种与金额后启用，原件保持不变。'
                    : '此旧模板尚未关联经营店铺，不能直接认领。'}
            </p>
        );
    if ((isPlatform && !canConfirm) || (!isPlatform && !canCopy)) return null;
    const currencies = [
        ...new Set(
            ['CNY', 'MYR', currentCurrency, option.sourceCurrencyCode].filter((code): code is string =>
                Boolean(code),
            ),
        ),
    ];
    return (
        <div className="w-full space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-600">
                {isPlatform
                    ? '明确确认此旧模板由哪家店铺维护，以及原金额使用的币种。'
                    : '复制保留原金额，必须明确确认来源币种；新模板默认关闭，原件不变。'}
                {option.sourceCurrencyCode && ` 原模板记录：${option.sourceCurrencyCode}。`}
            </p>
            <div className="flex flex-wrap items-end gap-2">
                {isPlatform && (
                    <AdminField label="确认维护店铺">
                        <AdminSelect
                            value={channelId}
                            disabled={busy}
                            onChange={event => setChannelId(event.target.value)}
                        >
                            <option value="">请选择经营店铺</option>
                            {option.assignedStoreChannels.map(channel => (
                                <option key={channel.id} value={channel.id}>
                                    {channel.code}
                                </option>
                            ))}
                        </AdminSelect>
                    </AdminField>
                )}
                <AdminField label="确认原金额来源币种">
                    <AdminSelect
                        value={currency}
                        disabled={busy}
                        onChange={event => setCurrency(event.target.value)}
                    >
                        <option value="">请选择来源币种</option>
                        {currencies.map(code => (
                            <option key={code} value={code}>
                                {code === 'CNY'
                                    ? '人民币（CNY）'
                                    : code === 'MYR'
                                      ? '马来西亚林吉特（MYR）'
                                      : code}
                            </option>
                        ))}
                    </AdminSelect>
                </AdminField>
                <AdminButton
                    type="button"
                    disabled={busy || !currency || (isPlatform && !channelId)}
                    onClick={() => void (isPlatform ? onConfirm(channelId, currency) : onCopy(currency))}
                >
                    {isPlatform ? '确认此旧模板归属' : '复制旧模板到本店'}
                </AdminButton>
            </div>
        </div>
    );
}
