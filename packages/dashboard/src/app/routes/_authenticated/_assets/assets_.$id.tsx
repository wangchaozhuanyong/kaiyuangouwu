import { AssetFocalPointEditor } from '@/vdb/components/shared/asset/asset-focal-point-editor.js';
import { AssetPreviewSelector } from '@/vdb/components/shared/asset/asset-preview-selector.js';
import { PreviewPreset } from '@/vdb/components/shared/asset/asset-preview.js';
import { AssetProperties } from '@/vdb/components/shared/asset/asset-properties.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ExternalLink, FocusIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { assetDetailDocument, assetUpdateDocument } from './assets.graphql.js';
import { AssetTagsEditor } from './components/asset-tags-editor.js';

const pageId = 'asset-detail';

export const Route = createFileRoute('/_authenticated/_assets/assets_/$id')({
    component: AssetDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: assetDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/assets', label: <Trans>Assets</Trans> },
                isNew ? <Trans>New asset</Trans> : (entity?.name ?? ''),
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function AssetDetailPage() {
    const params = Route.useParams();
    return <AssetEditor assetId={params.id} />;
}

export interface AssetEditorProps {
    assetId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: () => void;
}

export function AssetEditor({
    assetId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<AssetEditorProps>) {
    const { t } = useLingui();
    const queryClient = useQueryClient();

    const imageRef = useRef<HTMLImageElement>(null);
    const [size, setSize] = useState<PreviewPreset>('medium');
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const [settingFocalPoint, setSettingFocalPoint] = useState(false);
    const { form, submitHandler, entity, isPending, refreshEntity } = useDetailPage({
        pageId,
        queryDocument: assetDetailDocument,
        updateDocument: assetUpdateDocument,
        setValuesForUpdate: entity => {
            // Handle legacy assets without translations
            const translations =
                entity.translations && entity.translations.length > 0
                    ? entity.translations.map(t => ({
                          id: t.id,
                          languageCode: t.languageCode,
                          name: t.name,
                      }))
                    : [
                          {
                              languageCode: entity.languageCode,
                              name: entity.name,
                          },
                      ];
            return {
                id: entity.id,
                focalPoint: entity.focalPoint,
                translations,
                tags: entity.tags?.map(tag => tag.value) ?? [],
                customFields: entity.customFields,
            };
        },
        params: { id: assetId },
        onSuccess: async () => {
            toast(t`Successfully updated asset`);
            form.reset(form.getValues());
            void queryClient.invalidateQueries({ queryKey: ['AssetGallery'] });
            onSaved?.();
        },
        onError: err => {
            toast(t`Failed to update asset`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    useEffect(() => {
        onDirtyChange?.(form.formState.isDirty);
    }, [form.formState.isDirty, onDirtyChange]);

    const updateDimensions = () => {
        if (!imageRef.current) return;
        const img = imageRef.current;
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        setWidth(imgWidth);
        setHeight(imgHeight);
    };

    if (!entity) {
        return null;
    }
    return (
        <Page
            pageId={pageId}
            form={form}
            submitHandler={submitHandler}
            entity={entity}
            className={presentation === 'sheet' ? 'm-0 min-w-0 p-4' : undefined}
        >
            <PageTitle>
                <Trans>Edit asset</Trans>
            </PageTitle>
            <PageActionBar>
                {presentation === 'sheet' && (
                    <Button
                        type="button"
                        variant="outline"
                        render={<Link to={`/assets/${assetId}`} preload={false} />}
                    >
                        <ExternalLink className="h-4 w-4" />
                        <Trans>Open full page</Trans>
                    </Button>
                )}
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateChannel']}>
                    <Button type="submit" disabled={!form.formState.isDirty || isPending}>
                        {isPending ? <Trans>Saving...</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
                {presentation === 'sheet' && onRequestClose && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRequestClose}
                        aria-label={t`Close`}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="asset-preview">
                    <div className="relative flex items-center justify-center bg-muted/30 rounded-lg min-h-[300px] overflow-auto resize-y">
                        <AssetFocalPointEditor
                            width={width}
                            height={height}
                            settingFocalPoint={settingFocalPoint}
                            focalPoint={entity.focalPoint ?? { x: 0.5, y: 0.5 }}
                            onFocalPointChange={point => {
                                form.setValue('focalPoint.x', point.x, { shouldDirty: true });
                                form.setValue('focalPoint.y', point.y, { shouldDirty: true });
                                setSettingFocalPoint(false);
                            }}
                            onCancel={() => {
                                setSettingFocalPoint(false);
                            }}
                        >
                            <VendureImage
                                ref={imageRef}
                                asset={entity}
                                preset={size || undefined}
                                useFocalPoint={true}
                                onLoad={updateDimensions}
                                className="max-w-full object-contain"
                            />
                        </AssetFocalPointEditor>
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType={'Asset'} control={form.control} />
                <PageBlock column="side" blockId="asset-name">
                    <TranslatableFormFieldWrapper
                        control={form.control}
                        name="name"
                        label={<Trans>Name</Trans>}
                        render={({ field }) => <Input {...field} />}
                    />
                </PageBlock>
                <PageBlock column="side" blockId="asset-properties">
                    <AssetProperties asset={entity} />
                </PageBlock>
                <PageBlock column="side" blockId="asset-size">
                    <div className="flex flex-col gap-2">
                        <AssetPreviewSelector size={size} setSize={setSize} width={width} height={height} />
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setSettingFocalPoint(true)}
                            >
                                <FocusIcon className="h-4 w-4" />
                            </Button>
                            <div className="text-sm text-muted-foreground">
                                <Label>
                                    <Trans>Focal Point</Trans>
                                </Label>
                                <div className="text-sm text-muted-foreground">
                                    {form.getValues().focalPoint?.x && form.getValues().focalPoint?.y ? (
                                        `${form.getValues().focalPoint?.x.toFixed(2)}, ${form.getValues().focalPoint?.y.toFixed(2)}`
                                    ) : (
                                        <Trans>Not set</Trans>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </PageBlock>
                <PageBlock column="side" blockId="asset-tags">
                    <AssetTagsEditor
                        selectedTags={form.watch('tags') || []}
                        onTagsChange={tags => {
                            form.setValue('tags', tags, { shouldDirty: true });
                        }}
                        onTagsUpdated={() => {
                            // Refresh the asset entity to get updated tag values
                            refreshEntity();
                        }}
                        disabled={isPending}
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
