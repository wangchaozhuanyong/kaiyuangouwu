import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION,
    UPDATE_MY_STORE_PROFILE_MUTATION,
    type StoreProfileRecord,
} from '../../graphql/management.graphql';
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
    const [updateProfile, updateState] = useMutation(UPDATE_MY_STORE_PROFILE_MUTATION);
    const [submitGovernance, submitState] = useMutation(SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION);
    const [draft, setDraft] = useState({
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
    });
    const change = (field: keyof typeof draft, value: string) =>
        setDraft(current => ({ ...current, [field]: value }));
    const save = async () => {
        if (!draft.storefrontNameZh.trim()) return onError('店铺名称不能为空');
        if (
            ![draft.supportEmail, draft.privacyEmail].every(value => !value || /^\S+@\S+\.\S+$/.test(value))
        ) {
            return onError('请填写有效的客服邮箱和隐私邮箱');
        }
        try {
            await updateProfile({
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
            await onCompleted('本店公开资料已保存');
        } catch (error) {
            onError(toUserFacingError(error, '保存本店资料失败'));
        }
    };
    const submitLegal = async () => {
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
            await onCompleted('主体资料已提交平台审核，审核前线上值保持不变');
        } catch (error) {
            onError(toUserFacingError(error, '提交主体审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    本店公开资料
                    <FeatureHelpButton topic="settings.store-profile" title="本店公开资料" />
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                    品牌与联系信息直接保存；法律主体单独提交平台审批。
                </p>
            </div>
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
                    label="品牌口号"
                    value={draft.taglineZh}
                    onChange={value => change('taglineZh', value)}
                />
                <FieldInput
                    label="英文品牌口号"
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
                    label="公开简介"
                    value={draft.descriptionZh}
                    onChange={value => change('descriptionZh', value)}
                />
                <FieldArea
                    label="英文公开简介"
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
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={updateState.loading}
                    className={primaryButton}
                >
                    保存本店资料
                </button>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
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
                    <button
                        type="button"
                        onClick={() => void submitLegal()}
                        disabled={submitState.loading}
                        className={secondaryButton}
                    >
                        提交主体审核
                    </button>
                </div>
            </div>
        </section>
    );
}
