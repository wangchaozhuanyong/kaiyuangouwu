import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import {
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontLanguageCode,
    type StorefrontTargetType,
} from '../../graphql/storefront.graphql';
import { AssetPicker } from './storefront-asset-picker';
import { itemTranslation, normalizeSupportAccount, supportLinkFromAccount } from './storefront-content-utils';
import { Field, IconButton } from './storefront-editor-controls';
import { inputClass, localizedItemSettingKey, stringSetting, targetOptions } from './storefront-editor-model';
import { TargetValueInput } from './storefront-target-input';

export function ItemEditor({
    item,
    index,
    count,
    language,
    blockType,
    onChange,
    onMove,
    onRemove,
}: {
    item: StorefrontContentItem;
    index: number;
    count: number;
    language: StorefrontLanguageCode;
    blockType: StorefrontContentBlock['type'];
    onChange: (value: StorefrontContentItem) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
}) {
    const translation = itemTranslation(item, language);
    const updateTranslation = (patch: Partial<typeof translation>) =>
        onChange({
            ...item,
            translations: item.translations.map(value =>
                value.languageCode === language ? { ...value, ...patch } : value,
            ),
        });
    const navigation = blockType === 'NAVIGATION';
    const support = blockType === 'SUPPORT';
    const supportChannel =
        typeof item.settings?.supportChannel === 'string' ? item.settings.supportChannel : '';
    const wechatSupport = support && supportChannel === 'WECHAT';
    const automaticSupportLink = ['QQ', 'WHATSAPP', 'TELEGRAM'].includes(supportChannel);
    const supportAccount = stringSetting(item.settings?.supportAccount, '');
    const generatedSupportLink = supportLinkFromAccount(supportChannel, supportAccount);
    const accountCopy = supportAccountCopy(supportChannel, automaticSupportLink);
    const coreCategories = blockType === 'CORE_CATEGORIES';
    const updateLocalizedSetting = (field: 'badgeLabel' | 'ctaLabel', value: string) =>
        onChange({
            ...item,
            settings: {
                ...(item.settings ?? {}),
                [localizedItemSettingKey(field, language)]: value,
            },
        });
    return (
        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={event => onChange({ ...item, enabled: event.target.checked })}
                    />
                    {support ? '客服渠道' : '子项'} {index + 1}
                </label>
                <div className="flex gap-1">
                    <IconButton
                        label="上移"
                        disabled={index === 0}
                        onClick={() => onMove(-1)}
                        icon={ArrowUp}
                    />
                    <IconButton
                        label="下移"
                        disabled={index === count - 1}
                        onClick={() => onMove(1)}
                        icon={ArrowDown}
                    />
                    <IconButton
                        label="删除"
                        disabled={navigation && count <= 1}
                        onClick={onRemove}
                        icon={Trash2}
                        danger
                    />
                </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}名称 *`}>
                    <input
                        value={translation.label}
                        onChange={event => updateTranslation({ label: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <Field label="说明">
                    <input
                        value={translation.description}
                        onChange={event => updateTranslation({ description: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                {coreCategories && (
                    <>
                        <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}角标文案`}>
                            <input
                                value={stringSetting(
                                    item.settings?.[localizedItemSettingKey('badgeLabel', language)],
                                    '',
                                )}
                                onChange={event => updateLocalizedSetting('badgeLabel', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                        <Field label={`${language === 'zh_Hans' ? '中文' : '英文'}卡片按钮文案`}>
                            <input
                                value={stringSetting(
                                    item.settings?.[localizedItemSettingKey('ctaLabel', language)],
                                    '',
                                )}
                                onChange={event => updateLocalizedSetting('ctaLabel', event.target.value)}
                                className={inputClass}
                            />
                        </Field>
                    </>
                )}
                {support && (
                    <Field label="客服渠道">
                        <select
                            value={supportChannel}
                            onChange={event => {
                                const nextChannel = event.target.value;
                                const nextAccount = nextChannel === supportChannel ? supportAccount : '';
                                const generatedTarget = supportLinkFromAccount(nextChannel, nextAccount);
                                onChange({
                                    ...item,
                                    targetType: nextChannel === 'WECHAT' ? 'NONE' : 'URL',
                                    targetValue:
                                        nextChannel === 'WECHAT'
                                            ? null
                                            : (generatedTarget ?? item.targetValue),
                                    settings: {
                                        ...(item.settings ?? {}),
                                        supportChannel: nextChannel,
                                        supportAccount: nextAccount,
                                    },
                                });
                            }}
                            className={inputClass}
                        >
                            <option value="">请选择</option>
                            <option value="WECHAT">微信客服</option>
                            <option value="QQ">QQ 客服</option>
                            <option value="WHATSAPP">WhatsApp</option>
                            <option value="TELEGRAM">Telegram</option>
                            <option value="QQ_GROUP">QQ 群</option>
                        </select>
                    </Field>
                )}
                {support && supportChannel && (
                    <Field label={accountCopy.label}>
                        <input
                            value={supportAccount}
                            onChange={event => {
                                const nextAccount = normalizeSupportAccount(
                                    supportChannel,
                                    event.target.value,
                                );
                                const generatedTarget = supportLinkFromAccount(supportChannel, nextAccount);
                                onChange({
                                    ...item,
                                    targetType: wechatSupport ? 'NONE' : 'URL',
                                    targetValue: automaticSupportLink ? generatedTarget : item.targetValue,
                                    settings: {
                                        ...(item.settings ?? {}),
                                        supportAccount: nextAccount,
                                    },
                                });
                            }}
                            className={inputClass}
                            placeholder={accountCopy.placeholder}
                        />
                    </Field>
                )}
                {support && automaticSupportLink && (
                    <Field label="系统生成跳转地址">
                        <input
                            value={generatedSupportLink ?? ''}
                            readOnly
                            className={`${inputClass} bg-slate-100 text-slate-500`}
                            placeholder="填写账号后自动生成"
                        />
                    </Field>
                )}
                {!support && (
                    <Field label="跳转类型">
                        <select
                            value={navigation ? 'PAGE' : item.targetType}
                            disabled={navigation}
                            onChange={event =>
                                onChange({
                                    ...item,
                                    targetType: event.target.value as StorefrontTargetType,
                                    targetValue: event.target.value === 'NONE' ? null : item.targetValue,
                                })
                            }
                            className={`${inputClass} disabled:bg-slate-100`}
                        >
                            {targetOptions.map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </Field>
                )}
                {!support && (
                    <Field label="跳转目标">
                        <TargetValueInput
                            type={navigation ? 'PAGE' : item.targetType}
                            value={item.targetValue ?? ''}
                            onChange={value =>
                                onChange({
                                    ...item,
                                    targetType: navigation ? 'PAGE' : item.targetType,
                                    targetValue: value || null,
                                })
                            }
                        />
                    </Field>
                )}
                {support && supportChannel && !wechatSupport && !automaticSupportLink && (
                    <Field label={supportChannel === 'QQ_GROUP' ? 'QQ群邀请链接 *' : '客服链接 *'}>
                        <input
                            value={item.targetValue ?? ''}
                            onChange={event =>
                                onChange({
                                    ...item,
                                    targetType: 'URL',
                                    targetValue: event.target.value || null,
                                })
                            }
                            className={inputClass}
                            placeholder="https://..."
                        />
                    </Field>
                )}
                {wechatSupport && (
                    <div className="sm:col-span-2">
                        <AssetPicker
                            label="微信客服二维码 *"
                            value={item.imageAsset}
                            fallbackUrl={item.imageUrl}
                            onChange={asset =>
                                onChange({
                                    ...item,
                                    imageAsset: asset,
                                    imageAssetId: asset?.id ?? null,
                                    imageUrl: asset?.preview ?? null,
                                    targetType: 'NONE',
                                    targetValue: null,
                                })
                            }
                            compact
                        />
                    </div>
                )}
                {!navigation && !support && (
                    <div className="sm:col-span-2">
                        <AssetPicker
                            label="子项图片"
                            value={item.imageAsset}
                            fallbackUrl={item.imageUrl}
                            onChange={asset =>
                                onChange({
                                    ...item,
                                    imageAsset: asset,
                                    imageAssetId: asset?.id ?? null,
                                    imageUrl: asset?.preview ?? null,
                                })
                            }
                            compact
                        />
                    </div>
                )}
            </div>
        </article>
    );
}

function supportAccountCopy(channel: string, required: boolean): { label: string; placeholder: string } {
    const suffix = required ? ' *' : '（选填）';
    if (channel === 'QQ') return { label: `QQ 号${suffix}`, placeholder: '例如 123456789' };
    if (channel === 'WHATSAPP') {
        return {
            label: `WhatsApp 手机号${suffix}`,
            placeholder: '例如 60123456789（国际格式，不含 +）',
        };
    }
    if (channel === 'TELEGRAM') {
        return {
            label: `Telegram 用户名${suffix}`,
            placeholder: '例如 flashcast_support（不含 @）',
        };
    }
    if (channel === 'QQ_GROUP') return { label: `QQ群号${suffix}`, placeholder: '用于前台显示群号' };
    return { label: `微信号${suffix}`, placeholder: '用于前台显示微信号' };
}
