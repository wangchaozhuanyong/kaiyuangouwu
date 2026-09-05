import { Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { BrandAssetPickerDialog } from './BrandAssetPickerDialog';
import { secondaryButton } from './settings-ui';
import {
    BRAND_ASSET_SLOTS,
    type BrandAssetField,
    type BrandAssetsDraft,
    type BrandChannel,
} from './store-brand-assets';

export function StoreBrandAssets({
    assets,
    channel,
    sharedChannel,
    disabled,
    onChange,
}: {
    assets: BrandAssetsDraft;
    channel: BrandChannel;
    sharedChannel?: BrandChannel;
    disabled: boolean;
    onChange: (assets: BrandAssetsDraft) => void;
}) {
    const [editing, setEditing] = useState<BrandAssetField | null>(null);
    return (
        <section className="mt-4" aria-label="店铺品牌图片">
            <h3 className="text-xs font-bold text-slate-800">
                品牌图片
                <FeatureHelpButton topic="settings.store-profile" title="品牌图片" />
            </h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                从素材库选择图片，保存店铺档案后同步到店铺前台。
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {BRAND_ASSET_SLOTS.map(({ field, label, description }) => (
                    <div key={field} className="min-w-0 rounded-xl border border-slate-200 p-3">
                        <div
                            className={`flex h-24 items-center justify-center rounded-lg p-2 ${field === 'logoOnDarkAsset' ? 'bg-slate-900' : 'bg-slate-50'}`}
                        >
                            {assets[field] ? (
                                <img
                                    src={assets[field].preview}
                                    alt={label}
                                    className="max-h-full max-w-full object-contain"
                                />
                            ) : (
                                <ImageIcon aria-hidden="true" className="h-8 w-8 text-slate-400" />
                            )}
                        </div>
                        <p className="mt-2 text-xs font-bold text-slate-800">{label}</p>
                        <p className="mt-1 min-h-8 text-[10px] leading-4 text-slate-500">{description}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={disabled}
                                aria-label={`选择${label}`}
                                onClick={() => setEditing(field)}
                                className={secondaryButton}
                            >
                                选择图片
                            </button>
                            {assets[field] && (
                                <button
                                    type="button"
                                    disabled={disabled}
                                    aria-label={`清除${label}`}
                                    onClick={() => onChange({ ...assets, [field]: null })}
                                    className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-50"
                                >
                                    清除
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
            {editing && (
                <BrandAssetPickerDialog
                    title={`选择${BRAND_ASSET_SLOTS.find(slot => slot.field === editing)?.label}`}
                    selectedAsset={assets[editing]}
                    channel={channel}
                    sharedChannel={sharedChannel}
                    onClose={() => setEditing(null)}
                    onSelect={asset => {
                        onChange({ ...assets, [editing]: asset });
                        setEditing(null);
                    }}
                />
            )}
        </section>
    );
}
