import { useState, type FormEvent } from 'react';
import {
    accountRecommendationSettingsEqual,
    accountRecommendationSettingsError,
    resolveAccountRecommendationSettings,
    type AccountRecommendationSettings,
} from '../../../../storefront-content-plugin/src/shared/account-recommendation-settings';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { errorText } from './storefront-content-utils';

export function StorefrontAccountRecommendationsPanel({
    value,
    disabled,
    onSave,
}: {
    value: AccountRecommendationSettings;
    disabled: boolean;
    onSave: (value: AccountRecommendationSettings) => Promise<void>;
}) {
    const [draft, setDraft] = useState(value);
    const [limit, setLimit] = useState(String(value.limit));
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const input = { ...draft, limit: Number(limit) };
    const dirty = !accountRecommendationSettingsEqual(input, value);
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (disabled || saving || !dirty) return;
        const validation = accountRecommendationSettingsError(input);
        if (validation) {
            setError(validation);
            return;
        }
        setError('');
        setSaving(true);
        try {
            const normalized = resolveAccountRecommendationSettings(input);
            await onSave(normalized);
            setDraft(normalized);
            setLimit(String(normalized.limit));
        } catch (failure) {
            setError(errorText(failure));
        } finally {
            setSaving(false);
        }
    };
    const fieldClass =
        'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';
    return (
        <form
            onSubmit={event => void submit(event)}
            aria-label="账户推荐设置"
            className="rounded-xl border border-slate-200 bg-white p-5"
        >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                账户 · 专属推荐
                <FeatureHelpButton topic="storefront.account-recommendations" title="账户 · 专属推荐" />
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
                电脑和手机的账户页共用以下设置，标题居中显示在商品上方。
                按当前店铺今日净销量排序，销量不足时随机补齐；没有销量时随机推荐，同一天保持稳定。 默认展示 8
                件，可推荐商品不足时按实际数量展示。搜索框仍展示 10 件。
            </p>
            <fieldset disabled={disabled || saving} className="mt-4 space-y-4 disabled:opacity-60">
                <label className="flex items-center gap-2 text-sm text-slate-800">
                    <AdminInput
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={event => setDraft({ ...draft, enabled: event.target.checked })}
                    />
                    显示账户推荐
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">
                        中文推荐标题
                        <AdminInput
                            required
                            maxLength={80}
                            className={fieldClass}
                            value={draft.titleZh}
                            onChange={event => setDraft({ ...draft, titleZh: event.target.value })}
                        />
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                        英文推荐标题
                        <AdminInput
                            required
                            maxLength={80}
                            className={fieldClass}
                            value={draft.titleEn}
                            onChange={event => setDraft({ ...draft, titleEn: event.target.value })}
                        />
                    </label>
                </div>
                <label className="block text-xs font-medium text-slate-700">
                    推荐展示数量
                    <AdminInput
                        type="number"
                        required
                        min={1}
                        max={10}
                        step={1}
                        className={fieldClass}
                        value={limit}
                        onChange={event => setLimit(event.target.value)}
                    />
                </label>
                <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">
                        {dirty ? '有未保存的更改' : '已与当前店铺设置同步'}
                    </span>
                    <AdminButton
                        type="submit"
                        disabled={!dirty}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {saving ? '正在保存…' : '保存账户推荐'}
                    </AdminButton>
                </div>
            </fieldset>
            {error && (
                <p role="alert" className="mt-3 text-xs text-rose-600">
                    {error}
                </p>
            )}
        </form>
    );
}
