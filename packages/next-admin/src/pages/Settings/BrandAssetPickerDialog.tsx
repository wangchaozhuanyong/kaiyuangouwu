import { useQuery } from '@apollo/client/react';
import { AlertCircle, Image as ImageIcon, X } from 'lucide-react';
import { useState } from 'react';
import { channelRequestContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { LookupPager } from '../Catalog/LookupPager';
import { inputClass, secondaryButton } from './settings-ui';
import type { BrandChannel, StoreBrandAsset } from './store-brand-assets';

const PAGE_SIZE = 30;
interface PickerProps {
    title: string;
    selectedAsset: StoreBrandAsset | null;
    channel: BrandChannel;
    sharedChannel?: BrandChannel;
    onClose: () => void;
    onSelect: (asset: StoreBrandAsset) => void;
}

export function BrandAssetPickerDialog({
    title,
    selectedAsset,
    channel,
    sharedChannel,
    onClose,
    onSelect,
}: PickerProps) {
    const [useShared, setUseShared] = useState(false);
    const sourceChannel = useShared && sharedChannel ? sharedChannel : channel;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="flex max-h-[84vh] w-full max-w-4xl flex-col rounded-2xl bg-white p-5 shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4">
                    <h3 className="text-base font-bold text-slate-900">{title}</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭品牌素材选择"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {sharedChannel && sharedChannel.id !== channel.id && (
                    <label className="mt-3 text-xs text-slate-700">
                        素材来源
                        <select
                            className={`${inputClass} mt-1`}
                            value={useShared ? 'shared' : 'store'}
                            onChange={event => setUseShared(event.target.value === 'shared')}
                        >
                            <option value="store">本店素材</option>
                            <option value="shared">默认店铺素材</option>
                        </select>
                    </label>
                )}
                <p className="mt-2 text-xs leading-5 text-slate-500">
                    {useShared
                        ? '保存店铺档案时，所选图片会同时加入本店素材库。'
                        : '选择图片后，请保存店铺档案以应用到前台。'}
                </p>
                {/* 重建查询并禁用共享缓存，避免切换来源时选中上一家店铺的结果。 */}
                <BrandAssetResults
                    key={sourceChannel.id}
                    channel={sourceChannel}
                    selectedAsset={selectedAsset}
                    onSelect={onSelect}
                />
            </AccessibleDialogSurface>
        </div>
    );
}

function BrandAssetResults({
    channel,
    selectedAsset,
    onSelect,
}: Pick<PickerProps, 'channel' | 'selectedAsset' | 'onSelect'>) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const { data, error, loading, refetch } = useQuery<{
        assets: { items: StoreBrandAsset[]; totalItems: number };
    }>(GET_ASSETS, {
        variables: {
            options: {
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(search.trim() ? { name: { contains: search.trim() } } : {}),
                },
            },
        },
        context: channelRequestContext(channel.token),
        fetchPolicy: 'no-cache',
        notifyOnNetworkStatusChange: true,
    });
    const assets = data?.assets.items ?? [];
    return (
        <>
            <input
                aria-label="搜索品牌图片素材"
                placeholder="按素材名称搜索"
                className={`${inputClass} my-3`}
                value={search}
                onChange={event => {
                    setSearch(event.target.value);
                    setPage(0);
                }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
                {loading ? (
                    <p role="status" className="py-16 text-center text-xs text-slate-500">
                        正在读取素材库…
                    </p>
                ) : error ? (
                    <div
                        role="alert"
                        className="flex flex-col items-center gap-3 py-12 text-center text-xs text-rose-700"
                    >
                        <AlertCircle className="h-8 w-8" />
                        <span>{toUserFacingError(error, '品牌素材读取失败，请重试')}</span>
                        <button
                            type="button"
                            onClick={() => void refetch().catch(() => undefined)}
                            className={secondaryButton}
                        >
                            重试
                        </button>
                    </div>
                ) : assets.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center text-xs text-slate-500">
                        <ImageIcon aria-hidden="true" className="h-8 w-8" />
                        <p>
                            {search.trim()
                                ? '没有匹配的图片，请调整搜索词。'
                                : '本素材库暂无图片，请先到素材中心上传。'}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-3 md:grid-cols-5">
                        {assets.map(asset => (
                            <button
                                type="button"
                                key={asset.id}
                                aria-label={asset.name || '选择品牌图片'}
                                aria-pressed={asset.id === selectedAsset?.id}
                                onClick={() => onSelect({ ...asset, sourceChannelToken: channel.token })}
                                className={`min-w-0 overflow-hidden rounded-xl border-2 text-left ${asset.id === selectedAsset?.id ? 'border-blue-600' : 'border-slate-200 hover:border-blue-300'}`}
                            >
                                <div className="flex aspect-square items-center justify-center bg-slate-100 p-2">
                                    <img
                                        src={asset.preview}
                                        alt=""
                                        className="max-h-full max-w-full object-contain"
                                    />
                                </div>
                                <p className="truncate p-2 text-[10px] text-slate-700" title={asset.name}>
                                    {asset.name || '品牌图片'}
                                </p>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {!loading && !error && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                    <LookupPager
                        page={page}
                        pageSize={PAGE_SIZE}
                        totalItems={data?.assets.totalItems ?? 0}
                        onPageChange={setPage}
                    />
                </div>
            )}
        </>
    );
}
