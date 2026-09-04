import { useMutation, useQuery } from '@apollo/client/react';
import { AlertCircle, CheckCircle2, Copy, Languages, LoaderCircle, Trash2 } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
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
    const [taglineZh, setTaglineZh] = useState(profile.taglineZh ?? '');
    const [taglineEn, setTaglineEn] = useState(profile.taglineEn ?? '');
    const [brandBackgroundColor, setBrandBackgroundColor] = useState(profile.brandBackgroundColor ?? '');
    const [brandPrimaryColor, setBrandPrimaryColor] = useState(profile.brandPrimaryColor ?? '');
    const [brandAccentColor, setBrandAccentColor] = useState(profile.brandAccentColor ?? '');
    const [brandHighlightColor, setBrandHighlightColor] = useState(profile.brandHighlightColor ?? '');
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
                taglineZh: taglineZh.trim(),
                taglineEn: taglineEn.trim(),
                brandBackgroundColor: brandBackgroundColor.trim() || null,
                brandPrimaryColor: brandPrimaryColor.trim() || null,
                brandAccentColor: brandAccentColor.trim() || null,
                brandHighlightColor: brandHighlightColor.trim() || null,
                internalNote: internalNote.trim() || null,
                sortOrder,
                ...(statusChanged ? { status, currentPassword } : {}),
            };
            await save({
                variables: {
                    input,
                },
            });
            await onCompleted('店铺档案已保存');
        } catch (error) {
            onError(errorText(error));
        }
    };
    return (
        <Modal
            title="编辑店铺档案"
            description={`${profile.channel.code} · 使用乐观锁避免覆盖他人修改`}
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="中文店铺名称 *">
                    <input
                        value={nameZh}
                        onChange={event => setNameZh(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="中文简介">
                    <textarea
                        rows={4}
                        value={descriptionZh}
                        onChange={event => setDescriptionZh(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="品牌口号">
                    <input
                        value={taglineZh}
                        maxLength={160}
                        onChange={event => setTaglineZh(event.target.value)}
                        className={inputClass}
                        placeholder="例如：一钥通百模"
                    />
                </Field>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                    type="button"
                    onClick={() => setReviewEnglish(current => !current)}
                    aria-expanded={reviewEnglish}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-700"
                >
                    <Languages className="h-3.5 w-3.5" />
                    {reviewEnglish ? '收起英文校对' : '展开英文校对（可选）'}
                </button>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    中文是源内容；不填写英文时保存会自动生成。手工英文仅作当前覆盖，中文改动后请重新校对。
                </p>
                {reviewEnglish && (
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <Field label="英文店铺名称（人工覆盖）">
                            <input
                                value={nameEn}
                                onChange={event => setNameEn(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="英文简介（人工覆盖）">
                            <textarea
                                rows={4}
                                value={descriptionEn}
                                onChange={event => setDescriptionEn(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label="英文品牌口号（人工覆盖）">
                            <input
                                value={taglineEn}
                                maxLength={160}
                                onChange={event => setTaglineEn(event.target.value)}
                                className={inputClass}
                                placeholder="One Key. Every Model."
                            />
                        </Field>
                    </div>
                )}
            </div>
            <div className="mt-4">
                <p className="mb-2 text-xs font-bold text-slate-700">品牌颜色</p>
                <div className="grid gap-3 sm:grid-cols-4">
                    {[
                        ['背景色', brandBackgroundColor, setBrandBackgroundColor, '#071426'],
                        ['主色', brandPrimaryColor, setBrandPrimaryColor, '#2F6BFF'],
                        ['强调色', brandAccentColor, setBrandAccentColor, '#22D3EE'],
                        ['高亮色', brandHighlightColor, setBrandHighlightColor, '#7C3AED'],
                    ].map(([label, value, setter, placeholder]) => (
                        <Field key={String(label)} label={String(label)}>
                            <input
                                value={String(value)}
                                maxLength={7}
                                onChange={event =>
                                    (setter as Dispatch<SetStateAction<string>>)(
                                        event.target.value.toUpperCase(),
                                    )
                                }
                                className={inputClass}
                                placeholder={String(placeholder)}
                            />
                        </Field>
                    ))}
                </div>
            </div>
            <div className="mt-4">
                <Field label="内部备注（客户不可见）">
                    <textarea
                        rows={3}
                        value={internalNote}
                        onChange={event => setInternalNote(event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="运行状态">
                    <select
                        value={status}
                        onChange={event => setStatus(event.target.value as StoreProfileRecord['status'])}
                        className={inputClass}
                    >
                        <option value="DRAFT">草稿</option>
                        <option value="ACTIVE" disabled={!profile.activationReadiness.ready}>
                            正常营业
                        </option>
                        <option value="SUSPENDED" disabled={profile.status !== 'SUSPENDED'}>
                            暂停营业（请使用安全清退）
                        </option>
                    </select>
                </Field>
                <Field label="显示顺序">
                    <input
                        type="number"
                        value={sortOrder}
                        onChange={event => setSortOrder(Number(event.target.value) || 0)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="保存店铺档案"
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
            setCurrentPassword('');
            setLocalNotice('店铺已暂停营业。若该店铺没有业务数据，可继续输入店铺编码执行彻底清退。');
            await impactQuery.refetch();
        } catch (error) {
            setLocalError(errorText(error));
        }
    };

    const deprovision = async () => {
        if (!impact?.canDeprovision) {
            setLocalError('当前店铺仍有阻止清退的条件，请先按列表处理');
            return;
        }
        if (!currentPassword) {
            setLocalError('请输入当前管理员密码');
            return;
        }
        if (confirmCode.trim() !== impact.channelCode) {
            setLocalError(`请输入完整店铺编码“${impact.channelCode}”`);
            return;
        }
        const confirmation = await requestConfirmation({
            title: '最后确认：彻底清退空店铺？',
            description:
                '系统将删除该空店铺的 Channel、店铺档案、专属管理员与专属角色。该操作不可撤销，但后端仍会再次检查订单、商品、客户及扩展数据。',
            confirmLabel: '确认彻底清退',
            tone: 'danger',
        });
        if (!confirmation) return;
        setLocalError('');
        try {
            const response = await deprovisionStore({
                variables: {
                    input: {
                        profileId: profile.id,
                        expectedUpdatedAt,
                        currentPassword,
                        confirmCode: confirmCode.trim(),
                    },
                },
            });
            const result = response.data?.deprovisionStore;
            if (!result) throw new Error('清退操作未返回结果');
            await onCompleted(
                `空店铺 ${result.channelCode} 已清退；移除 ${result.deletedAdministratorCount} 个专属管理员${result.deletedRole ? '、专属角色' : ''}${result.deletedSeller ? '和独占商家主体' : ''}`,
            );
        } catch (error) {
            const message = errorText(error);
            setLocalError(message);
            onError(message);
            await impactQuery.refetch().catch(() => undefined);
        }
    };

    return (
        <Modal
            title="店铺安全清退"
            description={`${storeName(profile)} · ${profile.channel.code} · 先看影响、再暂停，只有没有业务数据的店铺才允许彻底删除`}
            onClose={onClose}
        >
            {impactQuery.loading && !impact ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-xs text-slate-500">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在检查订单、商品、客户及扩展数据…
                </div>
            ) : impactQuery.error || !impact ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                    <p>{impactQuery.error?.message ?? '清退影响读取失败'}</p>
                    <button
                        type="button"
                        onClick={() => void impactQuery.refetch()}
                        className="mt-3 font-bold underline"
                    >
                        重新检查
                    </button>
                </div>
            ) : (
                <>
                    {localNotice && (
                        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800">
                            {localNotice}
                        </div>
                    )}
                    {localError && (
                        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs leading-5 text-rose-700">
                            {localError}
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <ImpactStat label="订单" value={impact.orderCount} />
                        <ImpactStat label="商品" value={impact.productCount} />
                        <ImpactStat label="客户" value={impact.customerCount} />
                        <ImpactStat label="扩展记录" value={impact.extensionRecordCount} />
                        <ImpactStat label="管理员" value={impact.administratorCount} />
                        <ImpactStat label="独立域名" value={impact.domainCount} />
                        <ImpactStat label="专属角色" value={impact.roleWillBeDeleted ? '会移除' : '不移除'} />
                        <ImpactStat label="商家主体" value={impact.sellerWillBeDeleted ? '会移除' : '保留'} />
                    </div>
                    <div
                        className={`mt-4 rounded-xl border p-4 ${impact.canDeprovision ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}
                    >
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                            {impact.canDeprovision ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                                <AlertCircle className="h-4 w-4 text-amber-600" />
                            )}
                            {impact.canDeprovision
                                ? '该店铺满足彻底清退条件'
                                : '当前只能查看或暂停，不能彻底删除'}
                        </div>
                        {impact.blockers.length > 0 && (
                            <ul className="mt-3 space-y-1 text-[11px] leading-5 text-amber-900">
                                {impact.blockers.map(blocker => (
                                    <li key={blocker}>• {blocker}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Field label="当前管理员密码 *">
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={currentPassword}
                                onChange={event => setCurrentPassword(event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={`彻底清退时输入店铺编码：${impact.channelCode}`}>
                            <input
                                value={confirmCode}
                                onChange={event => setConfirmCode(event.target.value)}
                                placeholder={impact.channelCode}
                                disabled={!impact.canDeprovision}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                    <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                        <button type="button" onClick={onClose} disabled={busy} className={secondaryButton}>
                            关闭
                        </button>
                        {impact.status !== 'SUSPENDED' && (
                            <button
                                type="button"
                                onClick={() => void suspend()}
                                disabled={
                                    busy ||
                                    impact.isDefaultChannel ||
                                    impact.isProvisioningTemplate ||
                                    impact.isActiveChannel
                                }
                                className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {suspendState.loading && (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                )}
                                先暂停营业
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => void deprovision()}
                            disabled={
                                !impact.canDeprovision || busy || confirmCode.trim() !== impact.channelCode
                            }
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {deprovisionState.loading ? (
                                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                            )}
                            彻底清退空店铺
                        </button>
                    </div>
                </>
            )}
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
    const [reviewEnglish, setReviewEnglish] = useState(false);
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
                        storefrontNameEn: draft.storefrontNameEn.trim() || null,
                        templateChannelId: draft.templateChannelId,
                        administrator: {
                            firstName: draft.firstName.trim(),
                            lastName: draft.lastName.trim(),
                            emailAddress: draft.emailAddress.trim(),
                        },
                    },
                },
            });
            const next = response.data?.provisionStore;
            if (!next) throw new Error('后端未返回开店结果');
            setResult(next);
            await onCompleted('网店已创建，请立即保存一次性临时密码');
        } catch (error) {
            onError(errorText(error));
        }
    };
    if (result)
        return (
            <Modal
                title="网店已创建"
                description="临时密码只显示这一次，请通过安全渠道交给店铺管理员"
                onClose={onClose}
            >
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-xs text-emerald-700">Channel</div>
                    <div className="mt-1 font-mono font-bold text-emerald-900">{result.channelCode}</div>
                </div>
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs text-amber-700">一次性临时密码</div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                        <code className="select-all break-all text-sm font-bold text-amber-950">
                            {result.temporaryPassword}
                        </code>
                        <button
                            type="button"
                            onClick={async () => {
                                await navigator.clipboard.writeText(result.temporaryPassword);
                                setCopied(true);
                            }}
                            className={secondaryButton}
                        >
                            <Copy className="h-3.5 w-3.5" />
                            {copied ? '已复制' : '复制'}
                        </button>
                    </div>
                </div>
                <div className="mt-5 flex justify-end">
                    <button type="button" onClick={onClose} className={primaryButton}>
                        我已安全保存
                    </button>
                </div>
            </Modal>
        );
    return (
        <Modal
            title="开通独立网店"
            description="一次创建商家主体、Channel、库存点、权限角色和管理员账号"
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="商家名称 *">
                    <input
                        value={draft.name}
                        onChange={event => set('name', event.target.value)}
                        className={inputClass}
                        placeholder="例如：模钥科技有限公司"
                    />
                </Field>
                <Field label="网店编码 *">
                    <input
                        value={draft.code}
                        onChange={event => set('code', event.target.value)}
                        className={`${inputClass} font-mono`}
                        placeholder="yunqiao-store"
                    />
                </Field>
                <Field label="中文网站名称 *">
                    <input
                        value={draft.storefrontNameZh}
                        onChange={event => set('storefrontNameZh', event.target.value)}
                        className={inputClass}
                    />
                </Field>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <button
                    type="button"
                    onClick={() => setReviewEnglish(current => !current)}
                    aria-expanded={reviewEnglish}
                    className="flex items-center gap-1.5 text-xs font-bold text-blue-700"
                >
                    <Languages className="h-3.5 w-3.5" />
                    {reviewEnglish ? '收起英文校对' : '展开英文校对（可选）'}
                </button>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">
                    默认根据中文网站名称自动生成英文；品牌名称需要固定写法时再手工覆盖。
                </p>
                {reviewEnglish && (
                    <div className="mt-3">
                        <Field label="英文网站名称（人工覆盖）">
                            <input
                                value={draft.storefrontNameEn}
                                onChange={event => set('storefrontNameEn', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </div>
                )}
            </div>
            <div className="mt-4">
                <Field label="开店配置模板 *">
                    <select
                        value={draft.templateChannelId}
                        onChange={event => set('templateChannelId', event.target.value)}
                        className={inputClass}
                    >
                        <option value="">请选择模板</option>
                        {templates.map(template => (
                            <option key={template.id} value={template.id}>
                                {template.code} · {template.defaultLanguageCode} /{' '}
                                {template.defaultCurrencyCode}
                            </option>
                        ))}
                    </select>
                </Field>
                {!templates.length && (
                    <p className="mt-2 text-[10px] text-amber-700">
                        当前没有可用模板，需要先在后端 Channel 配置中启用开店模板。
                    </p>
                )}
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
                <h3 className="mb-3 text-xs font-bold text-slate-800">店铺管理员</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="名 *">
                        <input
                            value={draft.firstName}
                            onChange={event => set('firstName', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="姓 *">
                        <input
                            value={draft.lastName}
                            onChange={event => set('lastName', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="登录邮箱 *">
                        <input
                            type="email"
                            value={draft.emailAddress}
                            onChange={event => set('emailAddress', event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                </div>
            </div>
            <ModalActions
                onClose={onClose}
                onSave={() => void submit()}
                saving={state.loading}
                saveLabel="创建网店"
            />
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
