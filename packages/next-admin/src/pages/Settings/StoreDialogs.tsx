import { useMutation, useQuery } from '@apollo/client/react';
import { Building2, Copy } from 'lucide-react';
import { useState } from 'react';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import type { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    CREATE_SELLER_MUTATION,
    DEPROVISION_STORE_MUTATION,
    PROVISION_STORE_MUTATION,
    STORE_DEPROVISION_IMPACT_QUERY,
    SUSPEND_STORE_MUTATION,
    UPDATE_SELLER_MUTATION,
    UPDATE_STORE_PROFILE_MUTATION,
    type StoreDeprovisionImpactRecord,
    type StoreManagementResult,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import {
    Field,
    ImpactStat,
    Modal,
    ModalActions,
    errorText,
    inputClass,
    primaryButton,
    secondaryButton,
} from './settings-ui';

export function storeName(profile: StoreProfileRecord) {
    return (
        profile.channel.customFields.storefrontNameZh ||
        profile.channel.customFields.storefrontNameEn ||
        getChannelDisplayName(profile.channel.code)
    );
}

export function storeStatusLabel(status: StoreProfileRecord['status']) {
    if (status === 'ACTIVE') return '正常营业';
    if (status === 'SUSPENDED') return '暂停营业';
    return '草稿';
}

export function StoreEditor({
    profile,
    onClose,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [nameZh, setNameZh] = useState(profile.channel.customFields.storefrontNameZh);
    const [nameEn, setNameEn] = useState(profile.channel.customFields.storefrontNameEn);
    const [descriptionZh, setDescriptionZh] = useState(profile.descriptionZh);
    const [descriptionEn, setDescriptionEn] = useState(profile.descriptionEn);
    const [reviewEnglish, setReviewEnglish] = useState(false);
    const [internalNote, setInternalNote] = useState(profile.internalNote ?? '');
    const [status, setStatus] = useState(profile.status);
    const [sortOrder, setSortOrder] = useState(profile.sortOrder);
    const [save, state] = useMutation(UPDATE_STORE_PROFILE_MUTATION);
    const submit = async () => {
        if (!nameZh.trim()) return onError('请填写中文店铺名称');
        if (status === 'ACTIVE' && !profile.activationReadiness.ready)
            return onError('上线检查未通过，暂时不能启用店铺');
        const statusChanged = status !== profile.status;
        let currentPassword: string | undefined;
        if (statusChanged) {
            const confirmation = await requestConfirmation({
                title: '确认变更店铺运行状态？',
                description: `将“${storeName(profile)}”从${storeStatusLabel(profile.status)}改为${storeStatusLabel(status)}。此操作需要验证当前管理员密码。`,
                confirmLabel: '验证并变更',
                tone: 'warning',
                requireCurrentPassword: true,
            });
            if (!confirmation) return;
            currentPassword = confirmation.currentPassword;
        }
        try {
            const input = {
                id: profile.id,
                expectedUpdatedAt: profile.updatedAt,
                storefrontNameZh: nameZh.trim(),
                storefrontNameEn: nameEn.trim(),
                descriptionZh: descriptionZh.trim(),
                descriptionEn: descriptionEn.trim(),
                internalNote: internalNote.trim() || null,
                status,
                sortOrder: Number(sortOrder) || 0,
                currentPassword,
            };
            await save({ variables: { input } });
            await onCompleted('店铺资料与运行状态已更新');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={`编辑店铺 · ${storeName(profile)}`}
            description={`Channel: ${profile.channel.code} · ${profile.seller ? `所属主体: ${profile.seller.name}` : '未绑定商家主体'}`}
            onClose={onClose}
        >
            <div className="space-y-4 text-xs">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="font-bold text-slate-800">
                                上线就绪检查：
                                {profile.activationReadiness.ready ? (
                                    <span className="text-emerald-600">已就绪</span>
                                ) : (
                                    <span className="text-amber-600">未就绪</span>
                                )}
                            </div>
                            <div className="mt-1 text-slate-500">
                                就绪项: {profile.activationReadiness.passedItems.length} · 阻断项:{' '}
                                {profile.activationReadiness.blockingItems.length}
                            </div>
                        </div>
                        <span className="rounded bg-white px-2 py-1 font-mono text-[10px] text-slate-500 shadow-sm">
                            v{profile.updatedAt.slice(0, 19).replace('T', ' ')}
                        </span>
                    </div>
                    {profile.activationReadiness.blockingItems.length > 0 && (
                        <ul className="mt-2 list-inside list-disc space-y-1 text-amber-700">
                            {profile.activationReadiness.blockingItems.map(item => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="中文店铺名称 *">
                        <input
                            value={nameZh}
                            onChange={event => setNameZh(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="英文店铺名称">
                        <input
                            value={nameEn}
                            onChange={event => setNameEn(event.target.value)}
                            className={inputClass}
                            placeholder="可选"
                        />
                    </Field>
                </div>

                <Field label="中文店铺描述">
                    <textarea
                        value={descriptionZh}
                        onChange={event => setDescriptionZh(event.target.value)}
                        className={`${inputClass} min-h-20`}
                    />
                </Field>

                <div className="flex items-center justify-between">
                    <button
                        type="button"
                        onClick={() => setReviewEnglish(current => !current)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                    >
                        {reviewEnglish ? '收起英文描述' : '填写英文描述（可选）'}
                    </button>
                </div>
                {reviewEnglish && (
                    <Field label="英文店铺描述">
                        <textarea
                            value={descriptionEn}
                            onChange={event => setDescriptionEn(event.target.value)}
                            className={`${inputClass} min-h-20`}
                            placeholder="Store description in English"
                        />
                    </Field>
                )}

                <Field label="运营内部备注">
                    <input
                        value={internalNote}
                        onChange={event => setInternalNote(event.target.value)}
                        className={inputClass}
                        placeholder="仅管理员可见"
                    />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="运行状态">
                        <select
                            value={status}
                            onChange={event => setStatus(event.target.value as StoreProfileRecord['status'])}
                            className={inputClass}
                        >
                            <option value="DRAFT">草稿</option>
                            <option value="ACTIVE">正常营业</option>
                            <option value="SUSPENDED">暂停营业</option>
                        </select>
                    </Field>
                    <Field label="展示权重 (数字越大越靠前)">
                        <input
                            type="number"
                            value={sortOrder}
                            onChange={event => setSortOrder(Number(event.target.value))}
                            className={inputClass}
                        />
                    </Field>
                </div>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="保存店铺资料"
            />
        </Modal>
    );
}

export function StoreDeprovisionDialog({
    profile,
    onClose,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [currentPassword, setCurrentPassword] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(profile.updatedAt);
    const [localNotice, setLocalNotice] = useState('');
    const [localError, setLocalError] = useState('');
    const impactQuery = useQuery<{ storeDeprovisionImpact: StoreDeprovisionImpactRecord }>(
        STORE_DEPROVISION_IMPACT_QUERY,
        {
            variables: { profileId: profile.id },
            fetchPolicy: 'network-only',
        },
    );
    const [suspendStore, suspendState] = useMutation<{
        suspendStore: { id: string; updatedAt: string; status: StoreProfileRecord['status'] };
    }>(SUSPEND_STORE_MUTATION);
    const [deprovisionStore, deprovisionState] = useMutation<{
        deprovisionStore: {
            channelId: string;
            channelCode: string;
            deletedAdministratorCount: number;
            deletedRole: boolean;
            deletedSeller: boolean;
        };
    }>(DEPROVISION_STORE_MUTATION);
    const impact = impactQuery.data?.storeDeprovisionImpact;
    const busy = suspendState.loading || deprovisionState.loading;

    const suspend = async () => {
        if (!currentPassword) {
            setLocalError('请输入当前管理员密码');
            return;
        }
        setLocalError('');
        setLocalNotice('');
        try {
            const response = await suspendStore({
                variables: {
                    profileId: profile.id,
                    expectedUpdatedAt,
                    currentPassword,
                },
            });
            const updatedAt = response.data?.suspendStore.updatedAt;
            if (!updatedAt) throw new Error('暂停营业后未返回最新店铺版本');
            setExpectedUpdatedAt(updatedAt);
            setLocalNotice('店铺已切换为暂停营业状态，前台与新买家入口已阻断');
            await onCompleted('店铺已暂停营业');
        } catch (error) {
            setLocalError(errorText(error));
        }
    };

    const deprovision = async () => {
        if (!impact?.canDeprovision) {
            setLocalError('当前店铺仍存在业务关联数据，不允许物理下线');
            return;
        }
        if (!currentPassword) {
            setLocalError('请输入当前管理员密码');
            return;
        }
        if (confirmCode.trim() !== profile.channel.code) {
            setLocalError(`请完整输入 Channel 标识 “${profile.channel.code}” 确认删除`);
            return;
        }
        const confirmed = await requestConfirmation({
            title: '二次确认彻底下线店铺？',
            description: `此操作将物理删除 Channel “${profile.channel.code}”、解绑域名、清理空店铺配置，且不可逆。`,
            confirmLabel: '确认彻底下线',
            tone: 'danger',
        });
        if (!confirmed) return;
        setLocalError('');
        setLocalNotice('');
        try {
            await deprovisionStore({
                variables: {
                    input: {
                        profileId: profile.id,
                        expectedUpdatedAt,
                        currentPassword,
                        confirmChannelCode: confirmCode.trim(),
                    },
                },
            });
            await onCompleted('店铺与对应 Channel 已安全下线');
            onClose();
        } catch (error) {
            setLocalError(errorText(error));
        }
    };

    return (
        <Modal
            title="店铺下线 / 关停治理"
            description={`${storeName(profile)} · ${profile.channel.code} · 先看影响、再暂停，只有没有业务数据的店铺才允许彻底删除`}
            onClose={onClose}
        >
            <div className="space-y-4 text-xs">
                {localError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
                        {localError}
                    </div>
                )}
                {localNotice && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-700">
                        {localNotice}
                    </div>
                )}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">下线影响评估</span>
                        {impactQuery.loading ? (
                            <span className="text-slate-400">正在统计关联实体...</span>
                        ) : impact?.canDeprovision ? (
                            <span className="font-bold text-emerald-600">允许彻底下线</span>
                        ) : (
                            <span className="font-bold text-amber-600">受限：存在业务数据</span>
                        )}
                    </div>
                    {impact && (
                        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                            <ImpactStat label="订单" value={impact.orderCount} />
                            <ImpactStat label="商品" value={impact.productCount} />
                            <ImpactStat label="客户" value={impact.customerCount} />
                            <ImpactStat label="扩展记录" value={impact.extensionRecordCount} />
                            <ImpactStat label="管理员" value={impact.administratorCount} />
                            <ImpactStat label="独立域名" value={impact.domainCount} />
                            <ImpactStat
                                label="专属角色"
                                value={impact.roleWillBeDeleted ? '会移除' : '不移除'}
                            />
                            <ImpactStat
                                label="商家主体"
                                value={impact.sellerWillBeDeleted ? '会移除' : '保留'}
                            />
                        </div>
                    )}
                    {impact && impact.blockingReasons.length > 0 && (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                            <div className="font-bold">阻断原因：</div>
                            <ul className="mt-1 list-inside list-disc space-y-0.5">
                                {impact.blockingReasons.map(reason => (
                                    <li key={reason}>{reason}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <Field label="当前管理员密码 *（暂停与下线均需验密）">
                    <input
                        type="password"
                        value={currentPassword}
                        onChange={event => setCurrentPassword(event.target.value)}
                        className={inputClass}
                        placeholder="请输入当前登录管理员密码"
                    />
                </Field>

                <div className="rounded-xl border border-dashed border-slate-300 p-3">
                    <div className="font-bold text-slate-800">第一步：安全关停（推荐）</div>
                    <p className="mt-1 text-slate-500">
                        将店铺置为暂停状态，立即阻断独立域名和前台访问，但完整保留所有商品、订单和财务数据。
                    </p>
                    <button
                        type="button"
                        onClick={() => void suspend()}
                        disabled={busy || profile.status === 'SUSPENDED'}
                        className={`mt-3 ${secondaryButton} w-full`}
                    >
                        {suspendState.loading ? '正在暂停...' : '安全暂停营业'}
                    </button>
                </div>

                <div className="rounded-xl border border-red-200 bg-red-50/40 p-3">
                    <div className="font-bold text-red-900">第二步：彻底物理删除（高危不可逆）</div>
                    <p className="mt-1 text-red-700">
                        仅适用于完全没有订单、商品和客户历史的空店铺。必须输入 Channel 标识二次确认。
                    </p>
                    <div className="mt-3">
                        <Field label={`请输入完整 Channel 标识 “${profile.channel.code}” 以确认删除`}>
                            <input
                                value={confirmCode}
                                onChange={event => setConfirmCode(event.target.value)}
                                className={inputClass}
                                placeholder={profile.channel.code}
                                disabled={!impact?.canDeprovision}
                            />
                        </Field>
                    </div>
                    <button
                        type="button"
                        onClick={() => void deprovision()}
                        disabled={
                            busy || !impact?.canDeprovision || confirmCode.trim() !== profile.channel.code
                        }
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deprovisionState.loading ? '正在物理下线...' : '彻底下线并删除 Channel'}
                    </button>
                </div>
            </div>
            <ModalActions onClose={onClose} />
        </Modal>
    );
}

export function ProvisionStoreDialog({
    templates,
    onClose,
    onCompleted,
    onError,
}: {
    templates: StoreManagementResult['storeProvisioningTemplates'];
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [draft, setDraft] = useState({
        code: '',
        name: '',
        storefrontNameZh: '',
        storefrontNameEn: '',
        templateChannelId: templates[0]?.id ?? '',
        firstName: '',
        lastName: '',
        emailAddress: '',
    });
    const [result, setResult] = useState<{ channelCode: string; temporaryPassword: string } | null>(null);
    const [copied, setCopied] = useState(false);
    const [provision, state] = useMutation<{
        provisionStore: { channelCode: string; temporaryPassword: string };
    }>(PROVISION_STORE_MUTATION);
    const set = (key: keyof typeof draft, value: string) =>
        setDraft(current => ({ ...current, [key]: value }));
    const submit = async () => {
        if (
            Object.entries(draft)
                .filter(([key]) => key !== 'storefrontNameEn')
                .some(([, value]) => !value.trim())
        )
            return onError('请完整填写所有必填项');
        try {
            const response = await provision({
                variables: {
                    input: {
                        code: draft.code.trim(),
                        name: draft.name.trim(),
                        storefrontNameZh: draft.storefrontNameZh.trim(),
                        storefrontNameEn: draft.storefrontNameEn.trim(),
                        templateChannelId: draft.templateChannelId,
                        administrator: {
                            firstName: draft.firstName.trim(),
                            lastName: draft.lastName.trim(),
                            emailAddress: draft.emailAddress.trim(),
                        },
                    },
                },
            });
            if (response.data) {
                setResult(response.data.provisionStore);
                await onCompleted('店铺已开设完成');
            }
        } catch (error) {
            onError(errorText(error));
        }
    };
    const copy = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(
            `店铺已开通\nChannel Code: ${result.channelCode}\n管理员临时密码: ${result.temporaryPassword}`,
        );
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <Modal
            title="一键开设新店铺"
            description="自动创建独立 Channel、初始角色、专属管理员并预置店铺基础配置"
            onClose={onClose}
        >
            {result ? (
                <div className="space-y-4 text-xs">
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2 font-bold text-emerald-800">
                            <Building2 className="h-4 w-4" />
                            店铺开设成功！
                        </div>
                        <div className="mt-3 space-y-2 font-mono">
                            <div>
                                <span className="text-slate-500">Channel Code:</span>{' '}
                                <span className="font-bold text-slate-800">{result.channelCode}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">管理员临时密码:</span>{' '}
                                <span className="rounded bg-white px-2 py-0.5 font-bold text-red-600 shadow-sm">
                                    {result.temporaryPassword}
                                </span>
                            </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                            <button type="button" onClick={() => void copy()} className={primaryButton}>
                                <Copy className="h-3.5 w-3.5" />
                                {copied ? '已复制！' : '复制凭据'}
                            </button>
                            <button type="button" onClick={onClose} className={secondaryButton}>
                                完成并关闭
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Channel 标识 Code * (字母数字中划线)">
                            <input
                                value={draft.code}
                                onChange={event => set('code', event.target.value)}
                                className={inputClass}
                                placeholder="如: sg-store"
                            />
                        </Field>
                        <Field label="店铺展示名称 *">
                            <input
                                value={draft.name}
                                onChange={event => set('name', event.target.value)}
                                className={inputClass}
                                placeholder="如: 新加坡旗舰店"
                            />
                        </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="前台中文店铺名 *">
                            <input
                                value={draft.storefrontNameZh}
                                onChange={event => set('storefrontNameZh', event.target.value)}
                                className={inputClass}
                                placeholder="前台买家端显示的中文名称"
                            />
                        </Field>
                        <Field label="前台英文店铺名">
                            <input
                                value={draft.storefrontNameEn}
                                onChange={event => set('storefrontNameEn', event.target.value)}
                                className={inputClass}
                                placeholder="可选"
                            />
                        </Field>
                    </div>
                    <Field label="基础配置模板 Channel *">
                        <select
                            value={draft.templateChannelId}
                            onChange={event => set('templateChannelId', event.target.value)}
                            className={inputClass}
                        >
                            {templates.map(template => (
                                <option key={template.id} value={template.id}>
                                    {template.name} ({template.code}) · {template.defaultLanguageCode}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="font-bold text-slate-700">
                            初始管理员账号（系统将生成随机初始密码）
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <Field label="管理员姓氏 *">
                                <input
                                    value={draft.lastName}
                                    onChange={event => set('lastName', event.target.value)}
                                    className={inputClass}
                                    placeholder="如: 张"
                                />
                            </Field>
                            <Field label="管理员名字 *">
                                <input
                                    value={draft.firstName}
                                    onChange={event => set('firstName', event.target.value)}
                                    className={inputClass}
                                    placeholder="如: 三"
                                />
                            </Field>
                        </div>
                        <div className="mt-2">
                            <Field label="登录邮箱 *">
                                <input
                                    type="email"
                                    value={draft.emailAddress}
                                    onChange={event => set('emailAddress', event.target.value)}
                                    className={inputClass}
                                    placeholder="admin@example.com"
                                />
                            </Field>
                        </div>
                    </div>
                    <ModalActions
                        onClose={onClose}
                        onSave={() => void submit()}
                        saving={state.loading}
                        saveLabel="立即开设店铺"
                    />
                </div>
            )}
        </Modal>
    );
}

export function SellerDialog({
    existing,
    customFieldDefinitions,
    onClose,
    onCompleted,
    onError,
}: {
    existing?: StoreManagementResult['sellers']['items'][number];
    customFieldDefinitions: ReturnType<typeof useCustomFieldDefinitions>;
    onClose: () => void;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [name, setName] = useState(existing?.name ?? '');
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>(() =>
        customFieldValuesFromEntity(customFieldDefinitions, existing?.customFields),
    );
    const [create, state] = useMutation(CREATE_SELLER_MUTATION);
    const [update, updateState] = useMutation(UPDATE_SELLER_MUTATION);
    const submit = async () => {
        if (!name.trim()) return onError('请填写商家主体名称');
        const customFieldErrors = validateCustomFieldValues(customFieldDefinitions, customFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            return onError(Object.values(customFieldErrors)[0] ?? '商家主体扩展字段校验失败');
        }
        try {
            const customFields = customFieldInputFromValues(customFieldDefinitions, customFieldValues);
            if (existing) {
                await update({ variables: { input: { id: existing.id, name: name.trim(), customFields } } });
            } else {
                await create({ variables: { input: { name: name.trim(), customFields } } });
            }
            await onCompleted(existing ? '商家主体已更新' : '商家主体已创建');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title={existing ? '编辑商家主体' : '新增商家主体'}
            description="商家主体用于隔离商品、订单和店铺 Channel"
            onClose={onClose}
        >
            <Field label="商家主体名称 *">
                <input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className={inputClass}
                    autoFocus
                />
            </Field>
            <div className="mt-5">
                <DynamicCustomFieldsForm
                    title="商家主体扩展字段"
                    fields={customFieldDefinitions}
                    values={customFieldValues}
                    onChange={setCustomFieldValues}
                    disabled={state.loading || updateState.loading}
                />
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading || updateState.loading}
                saveLabel={existing ? '保存商家主体' : '创建商家主体'}
            />
        </Modal>
    );
}
