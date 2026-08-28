import {
    AssetPickerDialog,
    Badge,
    Button,
    Input,
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
    CheckCircle2,
    Clock3,
    ExternalLink,
    GripVertical,
    MessageCircle,
    PhoneCall,
    Send,
    Users,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { CompactAssetControl, EditorField as Field } from './compact-editor';
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
    const selectedImagePreview = selected.item.imageAsset?.preview ?? selected.item.imageUrl;

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

                    <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
                        <div className="min-w-0 space-y-4 px-5 py-4 lg:overflow-y-auto">
                            <section className="space-y-3 rounded-lg border bg-muted/15 p-3">
                                <div className="flex items-center gap-2">
                                    <Clock3 className="size-4 text-primary" aria-hidden="true" />
                                    <h3 className="text-sm font-semibold">
                                        {isZh ? '客服内容' : 'Service details'}
                                    </h3>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-[minmax(120px,0.7fr)_1fr_1fr]">
                                    <Field compact label={isZh ? '展示日期' : 'Days'}>
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
                                    <Field compact label={isZh ? '开始时间' : 'Start time'}>
                                        <Input
                                            type="time"
                                            value={serviceTime.startTime}
                                            onChange={event =>
                                                updateSettings({ serviceStartTime: event.target.value })
                                            }
                                        />
                                    </Field>
                                    <Field compact label={isZh ? '结束时间' : 'End time'}>
                                        <Input
                                            type="time"
                                            value={serviceTime.endTime}
                                            onChange={event =>
                                                updateSettings({ serviceEndTime: event.target.value })
                                            }
                                        />
                                    </Field>
                                </div>
                                <Field compact label={isZh ? '客服说明' : 'Service note'}>
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
                            </section>

                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-semibold">
                                            {isZh ? '联系方式' : 'Contact channels'}
                                        </h3>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {isZh
                                                ? '拖动行调整客户端顺序；关闭的渠道不会展示。'
                                                : 'Drag rows to reorder them. Disabled channels stay hidden.'}
                                        </p>
                                    </div>
                                    <Badge variant="secondary">
                                        {rows.filter(entry => entry.item.enabled).length}/5{' '}
                                        {isZh ? '已启用' : 'enabled'}
                                    </Badge>
                                </div>
                                <div className="overflow-hidden rounded-lg border">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/45 text-xs text-muted-foreground">
                                            <tr>
                                                <th className="w-12 px-3 py-2 text-left">
                                                    {isZh ? '排序' : 'Order'}
                                                </th>
                                                <th className="px-3 py-2 text-left">
                                                    {isZh ? '渠道' : 'Channel'}
                                                </th>
                                                <th className="hidden px-3 py-2 text-left sm:table-cell">
                                                    {isZh ? '跳转方式' : 'Mode'}
                                                </th>
                                                <th className="w-24 px-3 py-2 text-left">
                                                    {isZh ? '状态' : 'Status'}
                                                </th>
                                                <th className="w-20 px-3 py-2 text-right">
                                                    {isZh ? '操作' : 'Action'}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map(({ channel, item, index }) => {
                                                const Icon = channelIcons[channel.key];
                                                const configured =
                                                    channel.key === 'WECHAT'
                                                        ? Boolean(item.imageAsset || item.imageUrl)
                                                        : supportLinkIsValid(item.targetValue);
                                                return (
                                                    <tr
                                                        key={channel.key}
                                                        draggable={!saving}
                                                        className={`border-t transition-colors ${
                                                            selectedChannel === channel.key
                                                                ? 'bg-primary/[0.04]'
                                                                : 'hover:bg-muted/30'
                                                        } ${draggedChannel === channel.key ? 'opacity-50' : ''}`}
                                                        onDragStart={() => setDraggedChannel(channel.key)}
                                                        onDragEnd={() => setDraggedChannel(null)}
                                                        onDragOver={event => event.preventDefault()}
                                                        onDrop={() => {
                                                            if (draggedChannel)
                                                                reorderChannels(draggedChannel, channel.key);
                                                            setDraggedChannel(null);
                                                        }}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <GripVertical
                                                                className="size-4 cursor-grab text-muted-foreground"
                                                                aria-label={
                                                                    isZh ? '拖动排序' : 'Drag to reorder'
                                                                }
                                                            />
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <button
                                                                type="button"
                                                                className="flex items-center gap-2 text-left"
                                                                onClick={() =>
                                                                    setSelectedChannel(channel.key)
                                                                }
                                                            >
                                                                <span
                                                                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted"
                                                                    aria-hidden="true"
                                                                >
                                                                    <Icon className="size-4" />
                                                                </span>
                                                                <span className="font-medium">
                                                                    {isZh ? channel.labelZh : channel.labelEn}
                                                                </span>
                                                            </button>
                                                        </td>
                                                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">
                                                            {isZh
                                                                ? channel.targetModeZh
                                                                : channel.targetModeEn}
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center gap-2">
                                                                <Switch
                                                                    checked={item.enabled}
                                                                    disabled={saving}
                                                                    aria-label={`${isZh ? channel.labelZh : channel.labelEn} ${
                                                                        item.enabled ? 'enabled' : 'disabled'
                                                                    }`}
                                                                    onCheckedChange={enabled =>
                                                                        updateItem(index, {
                                                                            ...item,
                                                                            enabled,
                                                                        })
                                                                    }
                                                                />
                                                                <span className="hidden text-xs text-muted-foreground xl:inline">
                                                                    {configured
                                                                        ? isZh
                                                                            ? '已配置'
                                                                            : 'Ready'
                                                                        : isZh
                                                                          ? '待配置'
                                                                          : 'Setup'}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() =>
                                                                    setSelectedChannel(channel.key)
                                                                }
                                                            >
                                                                {isZh ? '编辑' : 'Edit'}
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {draft.items.length > rows.length ? (
                                    <p className="text-xs text-muted-foreground">
                                        {isZh
                                            ? `已保留 ${draft.items.length - rows.length} 个旧版条目，新版客服页不会展示。`
                                            : `${draft.items.length - rows.length} legacy items are preserved and hidden from the new page.`}
                                    </p>
                                ) : null}
                            </section>
                        </div>

                        <aside className="min-w-0 border-t bg-muted/25 px-5 py-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="flex size-9 items-center justify-center rounded-full bg-background shadow-sm">
                                        <SelectedIcon className="size-4" aria-hidden="true" />
                                    </span>
                                    <div>
                                        <h3 className="text-sm font-semibold">
                                            {isZh ? selected.channel.labelZh : selected.channel.labelEn}
                                        </h3>
                                        <p className="text-xs text-muted-foreground">
                                            {selectedConfigured
                                                ? isZh
                                                    ? '配置有效'
                                                    : 'Ready'
                                                : isZh
                                                  ? '需要补充配置'
                                                  : 'Needs setup'}
                                        </p>
                                    </div>
                                </div>
                                {selectedConfigured ? (
                                    <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
                                ) : null}
                            </div>

                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
                                <Field compact label={isZh ? '显示名称' : 'Display name'}>
                                    <Input
                                        value={selectedTranslation?.label ?? ''}
                                        onChange={event =>
                                            updateItemTranslation(selected.index, selected.item, {
                                                label: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                                <Field
                                    compact
                                    label={isZh ? '账号或群号（可选）' : 'Account or group ID (optional)'}
                                >
                                    <Input
                                        value={supportAccount}
                                        onChange={event =>
                                            updateItem(selected.index, {
                                                ...selected.item,
                                                settings: {
                                                    ...(selected.item.settings ?? {}),
                                                    supportAccount: event.target.value,
                                                },
                                            })
                                        }
                                    />
                                </Field>
                                <Field
                                    compact
                                    className="sm:col-span-2 lg:col-span-2"
                                    label={isZh ? '辅助说明' : 'Helper text'}
                                >
                                    <Textarea
                                        className="min-h-9 resize-y py-2"
                                        rows={1}
                                        value={selectedTranslation?.description ?? ''}
                                        onChange={event =>
                                            updateItemTranslation(selected.index, selected.item, {
                                                description: event.target.value,
                                            })
                                        }
                                    />
                                </Field>

                                {selected.channel.key === 'WECHAT' ? (
                                    <Field
                                        compact
                                        className="sm:col-span-2 lg:col-span-2"
                                        label={isZh ? '微信二维码' : 'WeChat QR code'}
                                    >
                                        <CompactAssetControl
                                            preview={selectedImagePreview}
                                            alt={isZh ? '微信客服二维码预览' : 'WeChat QR preview'}
                                            fileName={selected.item.imageAsset?.name}
                                            selectLabel={
                                                selectedImagePreview
                                                    ? isZh
                                                        ? '更换二维码'
                                                        : 'Replace QR'
                                                    : isZh
                                                      ? '选择或上传'
                                                      : 'Select or upload'
                                            }
                                            removeLabel={isZh ? '移除二维码' : 'Remove QR code'}
                                            previewClassName="size-10 bg-white p-0.5"
                                            imageFit="contain"
                                            onSelect={() => setAssetPickerOpen(true)}
                                            onRemove={() =>
                                                updateItem(selected.index, {
                                                    ...selected.item,
                                                    imageAsset: null,
                                                    imageAssetId: null,
                                                    imageUrl: null,
                                                })
                                            }
                                        />
                                        <AssetPickerDialog
                                            open={assetPickerOpen}
                                            onClose={() => setAssetPickerOpen(false)}
                                            onSelect={assets => {
                                                const asset = assets[0] ?? null;
                                                updateItem(selected.index, {
                                                    ...selected.item,
                                                    imageAsset: asset,
                                                    imageAssetId: asset?.id ?? null,
                                                    imageUrl: asset?.preview ?? null,
                                                });
                                                setAssetPickerOpen(false);
                                            }}
                                            initialSelectedAssets={
                                                selected.item.imageAsset ? [selected.item.imageAsset] : []
                                            }
                                            title={isZh ? '选择微信二维码' : 'Select WeChat QR code'}
                                            imageGuidance="icon"
                                        />
                                    </Field>
                                ) : (
                                    <Field
                                        compact
                                        className="sm:col-span-2 lg:col-span-2"
                                        label={isZh ? '跳转链接' : 'Direct link'}
                                        hint={
                                            isZh
                                                ? '使用平台官方 HTTPS 链接；未安装应用时可回退到网页。'
                                                : 'Use an official HTTPS link with a browser fallback.'
                                        }
                                    >
                                        <div className="flex min-w-0 gap-2">
                                            <Input
                                                inputMode="url"
                                                autoCapitalize="none"
                                                spellCheck={false}
                                                placeholder={selected.channel.linkPlaceholder}
                                                value={selected.item.targetValue ?? ''}
                                                onChange={event => {
                                                    const targetValue = event.target.value || null;
                                                    updateItem(selected.index, {
                                                        ...selected.item,
                                                        targetType: targetValue ? 'URL' : 'NONE',
                                                        targetValue,
                                                    });
                                                }}
                                            />
                                            <Button
                                                className="shrink-0"
                                                type="button"
                                                size="icon-sm"
                                                variant="outline"
                                                aria-label={isZh ? '测试跳转' : 'Test link'}
                                                title={isZh ? '测试跳转' : 'Test link'}
                                                disabled={!supportLinkIsValid(selected.item.targetValue)}
                                                onClick={() =>
                                                    selected.item.targetValue &&
                                                    window.open(
                                                        selected.item.targetValue,
                                                        '_blank',
                                                        'noopener,noreferrer',
                                                    )
                                                }
                                            >
                                                <ExternalLink className="size-4" aria-hidden="true" />
                                            </Button>
                                        </div>
                                        {selected.item.targetValue ? (
                                            <p
                                                className={`mt-2 flex items-center gap-1 text-xs ${
                                                    supportLinkIsValid(selected.item.targetValue)
                                                        ? 'text-emerald-600'
                                                        : 'text-destructive'
                                                }`}
                                            >
                                                {supportLinkIsValid(selected.item.targetValue) ? (
                                                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                                                ) : (
                                                    <X className="size-3.5" aria-hidden="true" />
                                                )}
                                                {supportLinkIsValid(selected.item.targetValue)
                                                    ? isZh
                                                        ? '链接格式有效'
                                                        : 'Valid link'
                                                    : isZh
                                                      ? '请输入完整的 HTTP(S) 链接'
                                                      : 'Enter a complete HTTP(S) URL'}
                                            </p>
                                        ) : null}
                                    </Field>
                                )}
                            </div>
                        </aside>
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
