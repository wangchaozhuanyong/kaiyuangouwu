import {
    AssetPickerDialog,
    Badge,
    Button,
    ImageSizeHint,
    Input,
    Label,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Switch,
    Textarea,
    UnsavedChangesConfirmation,
    toast,
} from '@vendure/dashboard';
import {
    Clock3,
    GripVertical,
    ImagePlus,
    MessageCircle,
    PhoneCall,
    QrCode,
    Send,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { ContentBlock, ContentItem } from './storefront-content.graphql';
import {
    SupportChannelKey,
    prepareSupportDraft,
    supportChannelKey,
    supportItems,
    supportLinkIsValid,
    supportServiceTime,
    validateSupportDraft,
} from './support-settings';

const channelIcons: Record<SupportChannelKey, LucideIcon> = {
    WECHAT: MessageCircle,
    QQ: MessageCircle,
    WHATSAPP: PhoneCall,
    TELEGRAM: Send,
    QQ_GROUP: Users,
};

export function SupportSettingsEditor({
    draft,
    isZh,
    saving,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: ContentBlock;
    isZh: boolean;
    saving: boolean;
    onChange: (draft: ContentBlock | null) => void;
    onClose: () => void;
    onSave: (draft: ContentBlock) => void;
}>) {
    const [selectedChannel, setSelectedChannel] = useState<SupportChannelKey>('WECHAT');
    const [draggedChannel, setDraggedChannel] = useState<SupportChannelKey | null>(null);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const initialDraftRef = useRef(JSON.stringify(draft));
    const isDirty = initialDraftRef.current !== JSON.stringify(draft);
    const requestClose = () => {
        if (isDirty && !window.confirm(isZh ? '有未保存的修改，确定放弃吗？' : 'Discard unsaved changes?')) {
            return;
        }
        onClose();
    };
    const rows = useMemo(() => supportItems(draft), [draft]);
    const selected = rows.find(entry => entry.channel.key === selectedChannel) ?? rows[0];
    const serviceTime = supportServiceTime(draft);
    const languageCode = isZh ? 'zh_Hans' : 'en';
    const bodyTranslation =
        draft.translations.find(translation => translation.languageCode === languageCode) ??
        draft.translations[0];

    const updateDraft = (next: ContentBlock) => onChange(next);
    const updateSettings = (patch: Record<string, unknown>) =>
        updateDraft({ ...draft, settings: { ...(draft.settings ?? {}), ...patch } });
    const updateBody = (body: string) =>
        updateDraft({
            ...draft,
            translations: draft.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, body } : translation,
            ),
        });
    const updateItem = (index: number, next: ContentItem) =>
        updateDraft({
            ...draft,
            items: draft.items.map((item, itemIndex) => (itemIndex === index ? next : item)),
        });
    const updateItemTranslation = (
        index: number,
        item: ContentItem,
        patch: { label?: string; description?: string },
    ) =>
        updateItem(index, {
            ...item,
            translations: item.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, ...patch } : translation,
            ),
        });
    const reorderChannels = (source: SupportChannelKey, target: SupportChannelKey) => {
        const ordered = supportItems(draft).map(entry => entry.item);
        const sourceIndex = ordered.findIndex(item => supportChannelKey(item) === source);
        const targetIndex = ordered.findIndex(item => supportChannelKey(item) === target);
        if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
        const [moved] = ordered.splice(sourceIndex, 1);
        ordered.splice(targetIndex, 0, moved);
        const legacy = draft.items.filter(item => !supportChannelKey(item));
        updateDraft({
            ...draft,
            items: [...ordered, ...legacy].map((item, position) => ({ ...item, position })),
        });
    };
    const save = () => {
        const prepared = prepareSupportDraft(draft);
        const error = validateSupportDraft(prepared, isZh);
        if (error) {
            toast.error(error);
            return;
        }
        onSave(prepared);
    };

    if (!selected) return null;
    const selectedTranslation =
        selected.item.translations.find(translation => translation.languageCode === languageCode) ??
        selected.item.translations[0];
    const selectedIcon = channelIcons[selected.channel.key];
    const SelectedIcon = selectedIcon;
    const selectedConfigured =
        selected.channel.key === 'WECHAT'
            ? Boolean(selected.item.imageAsset || selected.item.imageUrl)
            : supportLinkIsValid(selected.item.targetValue);
    const supportAccount =
        typeof selected.item.settings?.supportAccount === 'string'
            ? selected.item.settings.supportAccount
            : '';

    return (
        <>
            <UnsavedChangesConfirmation when={isDirty} />
            <Sheet open onOpenChange={open => !open && requestClose()}>
                <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[88vw] sm:max-w-[1440px]">
                    <SheetHeader className="shrink-0 border-b px-6 py-4 text-left">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <SheetTitle>{isZh ? '客服配置' : 'Customer support'}</SheetTitle>
                                <SheetDescription className="mt-1">
                                    {isZh
                                        ? '设置客服时间、二维码和客户端直达渠道；配置仅作用于当前店铺。'
                                        : 'Configure service hours, QR code and direct contact channels for this store.'}
                                </SheetDescription>
                            </div>
                            <Badge variant="outline">{isZh ? '固定模块' : 'Fixed module'}</Badge>
                        </div>
                    </SheetHeader>

                    <div className="flex-1 overflow-y-auto px-6 py-5">
                        <div className="mx-auto max-w-4xl space-y-8">
                            <section className="space-y-4 rounded-xl border bg-card p-5 shadow-sm">
                                <div className="flex items-center gap-2 border-b pb-4">
                                    <Clock3 className="size-5 text-primary" aria-hidden="true" />
                                    <h3 className="text-base font-semibold">
                                        {isZh ? '客服内容 (全局)' : 'Service details (Global)'}
                                    </h3>
                                </div>
                                <div className="grid gap-6 pt-2 sm:grid-cols-3">
                                    <Field label={isZh ? '展示日期' : 'Days'}>
                                        <Input
                                            value={isZh ? serviceTime.daysZh : serviceTime.daysEn}
                                            onChange={event =>
                                                updateSettings({
                                                    [isZh ? 'serviceDaysZh' : 'serviceDaysEn']:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field label={isZh ? '开始时间' : 'Start time'}>
                                        <Input
                                            type="time"
                                            value={serviceTime.startTime}
                                            onChange={event =>
                                                updateSettings({ serviceStartTime: event.target.value })
                                            }
                                        />
                                    </Field>
                                    <Field label={isZh ? '结束时间' : 'End time'}>
                                        <Input
                                            type="time"
                                            value={serviceTime.endTime}
                                            onChange={event =>
                                                updateSettings({ serviceEndTime: event.target.value })
                                            }
                                        />
                                    </Field>
                                </div>
                                <div className="pt-2">
                                    <Field label={isZh ? '客服说明' : 'Service note'}>
                                        <Input
                                            value={bodyTranslation?.body ?? ''}
                                            placeholder={
                                                isZh
                                                    ? '非工作时间可留言，我们会尽快回复'
                                                    : 'Leave a message and we will reply as soon as possible.'
                                            }
                                            onChange={event => updateBody(event.target.value)}
                                        />
                                    </Field>
                                </div>
                            </section>

                            <section className="space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-base font-semibold">
                                            {isZh ? '联系渠道配置' : 'Contact Channels'}
                                        </h3>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {isZh
                                                ? '拖动卡片调整客户端顺序；关闭的渠道不会展示。'
                                                : 'Drag cards to reorder them. Disabled channels stay hidden.'}
                                        </p>
                                    </div>
                                    <Badge variant="secondary" className="text-sm px-3 py-1">
                                        {rows.filter(entry => entry.item.enabled).length}/5{' '}
                                        {isZh ? '已启用' : 'enabled'}
                                    </Badge>
                                </div>

                                <div className="space-y-4">
                                    {rows.map(({ channel, item, index }) => {
                                        const Icon = channelIcons[channel.key];
                                        const configured =
                                            channel.key === 'WECHAT'
                                                ? Boolean(item.imageAsset || item.imageUrl)
                                                : supportLinkIsValid(item.targetValue);
                                        const itemTranslation =
                                            item.translations.find(t => t.languageCode === languageCode) ??
                                            item.translations[0];
                                        const account =
                                            typeof item.settings?.supportAccount === 'string'
                                                ? item.settings.supportAccount
                                                : '';

                                        return (
                                            <div
                                                key={channel.key}
                                                draggable={!saving}
                                                className={`group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all ${
                                                    draggedChannel === channel.key
                                                        ? 'opacity-50 scale-[0.98]'
                                                        : 'hover:shadow-md'
                                                }`}
                                                onDragStart={() => setDraggedChannel(channel.key)}
                                                onDragEnd={() => setDraggedChannel(null)}
                                                onDragOver={event => event.preventDefault()}
                                                onDrop={() => {
                                                    if (draggedChannel)
                                                        reorderChannels(draggedChannel, channel.key);
                                                    setDraggedChannel(null);
                                                }}
                                            >
                                                {/* Header / Summary Row */}
                                                <div className="flex items-center gap-4 bg-muted/20 p-4">
                                                    <div
                                                        className="cursor-grab p-1 text-muted-foreground hover:text-foreground"
                                                        aria-label={isZh ? '拖动排序' : 'Drag to reorder'}
                                                    >
                                                        <GripVertical className="size-5" />
                                                    </div>

                                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                        <Icon className="size-5" />
                                                    </div>

                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="font-semibold text-foreground">
                                                                {isZh ? channel.labelZh : channel.labelEn}
                                                            </h4>
                                                            {!configured && item.enabled && (
                                                                <Badge
                                                                    variant="destructive"
                                                                    className="text-[10px]"
                                                                >
                                                                    {isZh ? '需配置' : 'Needs Setup'}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="truncate text-xs text-muted-foreground">
                                                            {isZh
                                                                ? channel.targetModeZh
                                                                : channel.targetModeEn}
                                                        </p>
                                                    </div>

                                                    <div className="flex items-center gap-3 pr-2">
                                                        <span className="text-sm font-medium text-muted-foreground">
                                                            {item.enabled
                                                                ? isZh
                                                                    ? '已启用'
                                                                    : 'Enabled'
                                                                : isZh
                                                                  ? '已停用'
                                                                  : 'Disabled'}
                                                        </span>
                                                        <Switch
                                                            checked={item.enabled}
                                                            disabled={saving}
                                                            onCheckedChange={enabled =>
                                                                updateItem(index, { ...item, enabled })
                                                            }
                                                        />
                                                    </div>
                                                </div>

                                                {/* Edit Form Body */}
                                                <div className="border-t bg-card p-5">
                                                    <div className="grid gap-6 md:grid-cols-2">
                                                        <Field label={isZh ? '显示名称' : 'Display name'}>
                                                            <Input
                                                                value={itemTranslation.label ?? ''}
                                                                placeholder={
                                                                    isZh ? channel.labelZh : channel.labelEn
                                                                }
                                                                onChange={event =>
                                                                    updateItemTranslation(index, item, {
                                                                        label: event.target.value,
                                                                    })
                                                                }
                                                            />
                                                        </Field>

                                                        {channel.key === 'WECHAT' ? (
                                                            <Field
                                                                label={
                                                                    isZh
                                                                        ? '微信号或公众号 (可选)'
                                                                        : 'WeChat ID (Optional)'
                                                                }
                                                            >
                                                                <Input
                                                                    value={account}
                                                                    onChange={event =>
                                                                        updateItem(index, {
                                                                            ...item,
                                                                            settings: {
                                                                                ...item.settings,
                                                                                supportAccount:
                                                                                    event.target.value,
                                                                            },
                                                                        })
                                                                    }
                                                                />
                                                            </Field>
                                                        ) : (
                                                            <Field
                                                                label={isZh ? '跳转链接' : 'Direct link'}
                                                                hint={
                                                                    isZh
                                                                        ? '使用平台官方 HTTPS 链接；未安装应用时可回退到网页。'
                                                                        : 'Use an official HTTPS link with a browser fallback.'
                                                                }
                                                            >
                                                                <Input
                                                                    value={item.targetValue ?? ''}
                                                                    placeholder={channel.linkPlaceholder}
                                                                    onChange={event =>
                                                                        updateItem(index, {
                                                                            ...item,
                                                                            targetValue: event.target.value,
                                                                        })
                                                                    }
                                                                />
                                                            </Field>
                                                        )}

                                                        <div className="md:col-span-2">
                                                            <Field label={isZh ? '辅助说明' : 'Helper text'}>
                                                                <Textarea
                                                                    value={itemTranslation.description ?? ''}
                                                                    placeholder={
                                                                        isZh
                                                                            ? channel.descriptionZh
                                                                            : channel.descriptionEn
                                                                    }
                                                                    className="min-h-[60px]"
                                                                    onChange={event =>
                                                                        updateItemTranslation(index, item, {
                                                                            description: event.target.value,
                                                                        })
                                                                    }
                                                                />
                                                            </Field>
                                                        </div>

                                                        {channel.key === 'WECHAT' ? (
                                                            <div className="md:col-span-2">
                                                                <Field
                                                                    label={
                                                                        isZh ? '微信二维码' : 'WeChat QR Code'
                                                                    }
                                                                >
                                                                    <div className="flex items-start gap-4">
                                                                        <div
                                                                            className={[
                                                                                'flex size-24 shrink-0 items-center justify-center',
                                                                                'overflow-hidden rounded-md border-2 border-dashed bg-muted/30',
                                                                            ].join(' ')}
                                                                        >
                                                                            {item.imageAsset ? (
                                                                                <img
                                                                                    src={
                                                                                        item.imageAsset
                                                                                            .preview
                                                                                    }
                                                                                    alt=""
                                                                                    className="size-full object-cover"
                                                                                />
                                                                            ) : item.imageUrl ? (
                                                                                <img
                                                                                    src={item.imageUrl}
                                                                                    alt=""
                                                                                    className="size-full object-cover"
                                                                                />
                                                                            ) : (
                                                                                <QrCode className="size-8 text-muted-foreground/50" />
                                                                            )}
                                                                        </div>
                                                                        <div className="flex-1 space-y-2">
                                                                            <Button
                                                                                type="button"
                                                                                variant="outline"
                                                                                onClick={() => {
                                                                                    setSelectedChannel(
                                                                                        channel.key,
                                                                                    );
                                                                                    setAssetPickerOpen(true);
                                                                                }}
                                                                            >
                                                                                <ImagePlus
                                                                                    className="mr-2 size-4"
                                                                                    aria-hidden="true"
                                                                                />
                                                                                {isZh
                                                                                    ? '选择或上传'
                                                                                    : 'Select or upload'}
                                                                            </Button>
                                                                            <ImageSizeHint guidance="icon" />
                                                                            {(item.imageAsset ||
                                                                                item.imageUrl) && (
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="ghost"
                                                                                    size="sm"
                                                                                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                                                    onClick={() =>
                                                                                        updateItem(index, {
                                                                                            ...item,
                                                                                            imageAsset: null,
                                                                                            imageUrl: '',
                                                                                        })
                                                                                    }
                                                                                >
                                                                                    <X className="mr-1 size-4" />
                                                                                    {isZh ? '移除' : 'Remove'}
                                                                                </Button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </Field>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <AssetPickerDialog
                                    open={assetPickerOpen}
                                    onClose={() => setAssetPickerOpen(false)}
                                    onSelect={assets => {
                                        const asset = assets[0] ?? null;
                                        const editChannel = rows.find(r => r.channel.key === selectedChannel);
                                        if (editChannel) {
                                            updateItem(editChannel.index, {
                                                ...editChannel.item,
                                                imageAsset: asset,
                                                imageAssetId: asset?.id ?? null,
                                                imageUrl: asset?.preview ?? null,
                                            });
                                        }
                                        setAssetPickerOpen(false);
                                    }}
                                    initialSelectedAssets={[]}
                                    title={isZh ? '选择微信二维码' : 'Select WeChat QR code'}
                                    imageGuidance="icon"
                                />
                            </section>
                        </div>
                    </div>

                    <SheetFooter className="shrink-0 border-t px-6 py-4">
                        <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>
                            {isZh ? '取消' : 'Cancel'}
                        </Button>
                        <Button type="button" disabled={saving} onClick={save}>
                            {saving ? (isZh ? '正在保存' : 'Saving') : isZh ? '保存更改' : 'Save changes'}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
        </>
    );
}

function Field({
    label,
    hint,
    children,
}: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) {
    return (
        <div className="min-w-0 space-y-2">
            <Label>{label}</Label>
            {children}
            {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
    );
}
