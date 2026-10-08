import { useMutation } from '@apollo/client/react';
import { AdminButton } from '../../components/AdminControls';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION,
    UPDATE_MY_STORE_PROFILE_MUTATION,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { useStorePublicPreview } from '../../hooks/use-store-public-preview';
import { toUserFacingError } from '../../utils/user-facing-error';

import { FieldArea, FieldInput } from './MyStoreFields';
import { primaryButton, secondaryButton } from './settings-ui';
export function MyStoreProfileEditor({
    profile,
    legalRequestStatus,
    onCompleted,
    onError,
}: {
    profile: StoreProfileRecord;
    legalRequestStatus: string | null;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const publicPreview = useStorePublicPreview(onCompleted, onError);
    const [updateProfile, updateState] = useMutation<{ updateMyStoreProfile: StoreProfileRecord }>(
        UPDATE_MY_STORE_PROFILE_MUTATION,
    );
    const [submitGovernance, submitState] = useMutation(SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION);
    const view = useStandaloneAdminPage()?.key;
    const source = {
        storefrontNameZh: profile.channel.customFields.storefrontNameZh ?? '',
        storefrontNameEn: profile.channel.customFields.storefrontNameEn ?? '',
        descriptionZh: profile.descriptionZh ?? '',
        descriptionEn: profile.descriptionEn ?? '',
        taglineZh: profile.taglineZh ?? '',
        taglineEn: profile.taglineEn ?? '',
        brandBackgroundColor: profile.brandBackgroundColor ?? '',
        brandPrimaryColor: profile.brandPrimaryColor ?? '',
        brandAccentColor: profile.brandAccentColor ?? '',
        brandHighlightColor: profile.brandHighlightColor ?? '',
        supportEmail: profile.supportEmail ?? '',
        privacyEmail: profile.privacyEmail ?? '',
        legalEntityName: profile.legalEntityName ?? '',
        legalRegistrationCountry: profile.legalRegistrationCountry ?? '',
    };
    const owner = useServerDraft(profile.channel.id, profile.updatedAt, source);
    const draft = owner.draft ?? source;
    const setDraft = owner.setDraft;
    const change = (field: keyof typeof draft, value: string) =>
        setDraft(current => ({ ...(current ?? draft), [field]: value }));
    const togglePublicPreview = async () => {
        if (owner.dirty || owner.sourceChanged) return;
        await publicPreview.togglePublicPreview(profile);
    };
    const save = async () => {
        if (owner.sourceChanged) return;
        if (!draft.storefrontNameZh.trim()) return onError('店铺名称不能为空');
        if (
            ![draft.supportEmail, draft.privacyEmail].every(value => !value || /^\S+@\S+\.\S+$/.test(value))
        ) {
            return onError('请填写有效的客服邮箱和隐私邮箱');
        }
        try {
            const saved = await updateProfile({
                variables: {
                    input: {
                        expectedUpdatedAt: profile.updatedAt,
                        storefrontNameZh: draft.storefrontNameZh.trim(),
                        storefrontNameEn: draft.storefrontNameEn.trim(),
                        descriptionZh: draft.descriptionZh.trim(),
                        descriptionEn: draft.descriptionEn.trim(),
                        taglineZh: draft.taglineZh.trim(),
                        taglineEn: draft.taglineEn.trim(),
                        brandBackgroundColor: draft.brandBackgroundColor || null,
                        brandPrimaryColor: draft.brandPrimaryColor || null,
                        brandAccentColor: draft.brandAccentColor || null,
                        brandHighlightColor: draft.brandHighlightColor || null,
                        supportEmail: draft.supportEmail.trim() || null,
                        privacyEmail: draft.privacyEmail.trim() || null,
                    },
                },
            });
            owner.accept(draft, saved.data?.updateMyStoreProfile.updatedAt ?? profile.updatedAt);
            await onCompleted('本店公开资料已保存');
        } catch (error) {
            onError(toUserFacingError(error, '保存本店资料失败'));
        }
    };
    const submitLegal = async () => {
        if (owner.sourceChanged) return;
        if (!draft.legalEntityName.trim() || !draft.legalRegistrationCountry.trim()) {
            return onError('请填写主体名称和注册国家或地区');
        }
        try {
            await submitGovernance({
                variables: {
                    input: {
                        requestType: 'LEGAL_IDENTITY',
                        payload: {
                            legalEntityName: draft.legalEntityName.trim(),
                            legalRegistrationCountry: draft.legalRegistrationCountry.trim(),
                        },
                    },
                },
            });
            owner.accept(draft);
            await onCompleted('主体资料已提交平台审核，审核前线上值保持不变');
        } catch (error) {
            onError(toUserFacingError(error, '提交主体审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            {owner.sourceChanged && <DraftUpdateNotice onReload={owner.reload} />}
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {view === 'sellers' ? '商家主体' : '本店公开资料'}
                    <FeatureHelpButton
                        topic="settings.store-profile"
                        title="本店公开资料"
                        description={'品牌与联系信息直接保存；法律主体单独提交平台审批。'}
                    />
                </h2>
            </div>
            {view !== 'sellers' && profile.status === 'DRAFT' && (
                <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                公开预览
                                <FeatureHelpButton
                                    topic="settings.store-profile"
                                    title="公开预览"
                                    description={
                                        '开放后所有访客均可浏览；模拟下单需单独启用测试支付。正式营业上线检查保持独立。'
                                    }
                                />
                            </h3>

                            {!profile.primaryDomain && (
                                <p className="mt-1 text-xs text-rose-700">请先验证并设置主域名。</p>
                            )}
                            {!publicPreview.canUpdatePublicPreview && (
                                <p className="mt-1 text-xs text-slate-500">当前账号仅可查看公开预览状态。</p>
                            )}
                        </div>
                        <AdminButton
                            type="button"
                            role="switch"
                            aria-checked={profile.isPublished}
                            aria-label="公开预览"
                            onClick={() => void togglePublicPreview()}
                            disabled={
                                updateState.loading ||
                                publicPreview.publicPreviewBusy ||
                                !publicPreview.canUpdatePublicPreview ||
                                owner.dirty ||
                                owner.sourceChanged ||
                                (!profile.primaryDomain && !profile.isPublished)
                            }
                            className={profile.isPublished ? secondaryButton : primaryButton}
                        >
                            {profile.isPublished ? '关闭预览' : '开放预览'}
                        </AdminButton>
                    </div>
                </div>
            )}
            {view !== 'sellers' && (
                <>
                    <div className="grid gap-4 md:grid-cols-2">
                        <FieldInput
                            label="店铺名称"
                            value={draft.storefrontNameZh}
                            onChange={value => change('storefrontNameZh', value)}
                        />
                        <FieldInput
                            label="英文店铺名称"
                            value={draft.storefrontNameEn}
                            onChange={value => change('storefrontNameEn', value)}
                        />
                        <FieldInput
                            label="品牌口号（选填）"
                            value={draft.taglineZh}
                            onChange={value => change('taglineZh', value)}
                        />
                        <FieldInput
                            label="英文品牌口号（选填）"
                            value={draft.taglineEn}
                            onChange={value => change('taglineEn', value)}
                        />
                        <FieldInput
                            label="客服邮箱"
                            type="email"
                            value={draft.supportEmail}
                            onChange={value => change('supportEmail', value)}
                        />
                        <FieldInput
                            label="隐私邮箱"
                            type="email"
                            value={draft.privacyEmail}
                            onChange={value => change('privacyEmail', value)}
                        />
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <FieldArea
                            label="公开简介（选填）"
                            value={draft.descriptionZh}
                            onChange={value => change('descriptionZh', value)}
                        />
                        <FieldArea
                            label="英文公开简介（选填）"
                            value={draft.descriptionEn}
                            onChange={value => change('descriptionEn', value)}
                        />
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {(
                            [
                                ['brandBackgroundColor', '背景色'],
                                ['brandPrimaryColor', '主色'],
                                ['brandAccentColor', '强调色'],
                                ['brandHighlightColor', '高亮色'],
                            ] as const
                        ).map(([field, label]) => (
                            <FieldInput
                                key={field}
                                label={label}
                                type="color"
                                value={draft[field] || '#ffffff'}
                                onChange={value => change(field, value)}
                            />
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                        同一种皮肤统一按钮、选中态等控件配色；品牌颜色作为店铺资料保留，图片、Logo和品牌文案保持各店设置。
                    </p>
                    <div className="mt-4 flex justify-end">
                        <AdminButton
                            type="button"
                            onClick={() => void save()}
                            disabled={updateState.loading || owner.sourceChanged}
                            className={primaryButton}
                        >
                            保存本店资料
                        </AdminButton>
                    </div>
                </>
            )}
            {(!view || view === 'sellers') && (
                <div className="mt-5 border-t border-slate-100 pt-5">
                    <p className="mb-3 text-xs text-slate-500">
                        已生效主体：{profile.legalEntityName || '尚未批准'} ·{' '}
                        {profile.legalRegistrationCountry || '尚未批准'}
                    </p>
                    <div className="grid gap-4 md:grid-cols-2">
                        <FieldInput
                            label="法定经营主体"
                            value={draft.legalEntityName}
                            onChange={value => change('legalEntityName', value)}
                        />
                        <FieldInput
                            label="注册国家或地区"
                            value={draft.legalRegistrationCountry}
                            onChange={value => change('legalRegistrationCountry', value)}
                        />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">
                            当前申请：
                            {legalRequestStatus === 'PENDING'
                                ? '待审核'
                                : legalRequestStatus === 'REJECTED'
                                  ? '已驳回，可重新提交'
                                  : legalRequestStatus === 'APPROVED'
                                    ? '已通过'
                                    : '未提交'}
                        </span>
                        <AdminButton
                            type="button"
                            onClick={() => void submitLegal()}
                            disabled={
                                submitState.loading || owner.sourceChanged || legalRequestStatus === 'PENDING'
                            }
                            className={secondaryButton}
                        >
                            提交主体审核
                        </AdminButton>
                    </div>
                </div>
            )}
        </section>
    );
}
