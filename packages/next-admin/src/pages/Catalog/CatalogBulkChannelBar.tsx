import { Loader2, MinusCircle, PlusCircle, Store, X } from 'lucide-react';
import { useState } from 'react';

import { getChannelDisplayName } from '../../utils/channel-display';

export interface ChannelOption {
    id: string;
    code: string;
    isDefault?: boolean;
    displayName?: string | null;
}

export interface CatalogBulkChannelBarProps {
    selectedCount: number;
    channels: ChannelOption[];
    onAssign: (channelId: string, priceFactor: number) => Promise<void>;
    onRemove: (channelId: string) => Promise<void>;
    onClearSelection: () => void;
    busy?: boolean;
}

export function CatalogBulkChannelBar({
    selectedCount,
    channels,
    onAssign,
    onRemove,
    onClearSelection,
    busy = false,
}: CatalogBulkChannelBarProps) {
    const [targetChannelId, setTargetChannelId] = useState<string>(() => channels[0]?.id ?? '');
    const [priceFactor, setPriceFactor] = useState<string>('1.0');
    const [actionType, setActionType] = useState<'assign' | 'remove' | null>(null);

    // Keep channel ID up to date if channels load asynchronously
    const effectiveChannelId = targetChannelId || channels[0]?.id || '';

    const handleAssign = async () => {
        if (!effectiveChannelId || busy) return;
        const factor = parseFloat(priceFactor);
        const validFactor = Number.isFinite(factor) && factor > 0 ? factor : 1.0;
        setActionType('assign');
        try {
            await onAssign(effectiveChannelId, validFactor);
        } finally {
            setActionType(null);
        }
    };

    const handleRemove = async () => {
        if (!effectiveChannelId || busy) return;
        setActionType('remove');
        try {
            await onRemove(effectiveChannelId);
        } finally {
            setActionType(null);
        }
    };

    if (selectedCount <= 0) return null;

    const selectedChannel = channels.find(c => c.id === effectiveChannelId);
    const channelName = selectedChannel ? getChannelDisplayName(selectedChannel) : '';

    return (
        <div
            role="toolbar"
            aria-label="批量店铺操作工具栏"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs shadow-md backdrop-blur-sm animate-fadeIn"
        >
            <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs shadow-xs">
                    {selectedCount}
                </span>
                <span className="font-bold text-slate-800">
                    已勾选 <strong className="text-blue-700 font-extrabold">{selectedCount}</strong> 个商品
                </span>
                <span className="hidden text-slate-400 sm:inline">|</span>
                <span className="hidden text-slate-600 sm:inline">选择目标店铺执行上架或下架操作：</span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
                {/* Store Selector */}
                <div className="flex items-center gap-1.5">
                    <Store className="h-4 w-4 text-blue-600 shrink-0" />
                    <select
                        aria-label="选择目标店铺"
                        value={effectiveChannelId}
                        onChange={e => setTargetChannelId(e.target.value)}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {channels.map(channel => (
                            <option key={channel.id} value={channel.id}>
                                {getChannelDisplayName(channel)}
                                {channel.isDefault ? ' (主店铺)' : ''}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Price Factor (optional for assign) */}
                <div className="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1 shadow-2xs">
                    <label
                        htmlFor="bulk-price-factor"
                        className="text-[11px] text-slate-500 whitespace-nowrap"
                    >
                        价格系数:
                    </label>
                    <input
                        id="bulk-price-factor"
                        type="number"
                        min="0.1"
                        max="100"
                        step="0.05"
                        value={priceFactor}
                        onChange={e => setPriceFactor(e.target.value)}
                        disabled={busy}
                        aria-label="价格系数"
                        className="w-12 bg-transparent text-xs font-mono font-bold text-slate-800 focus:outline-none disabled:opacity-50"
                    />
                </div>

                {/* Bulk Assign Button */}
                <button
                    type="button"
                    onClick={() => void handleAssign()}
                    disabled={busy || !effectiveChannelId}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    title={`将已选商品批量上架至 ${channelName}`}
                >
                    {busy && actionType === 'assign' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <PlusCircle className="h-3.5 w-3.5" />
                    )}
                    <span>批量上架到店铺</span>
                </button>

                {/* Bulk Remove Button */}
                <button
                    type="button"
                    onClick={() => void handleRemove()}
                    disabled={busy || !effectiveChannelId}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 shadow-2xs transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                    title={`从 ${channelName} 下架已选商品`}
                >
                    {busy && actionType === 'remove' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <MinusCircle className="h-3.5 w-3.5 text-rose-600" />
                    )}
                    <span>从店铺下架</span>
                </button>

                {/* Clear Selection */}
                <button
                    type="button"
                    onClick={onClearSelection}
                    disabled={busy}
                    aria-label="取消选择"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 cursor-pointer"
                >
                    <X className="h-3.5 w-3.5" />
                    <span>取消选择</span>
                </button>
            </div>
        </div>
    );
}
