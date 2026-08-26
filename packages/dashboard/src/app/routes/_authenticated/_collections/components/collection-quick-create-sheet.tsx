import { EntityAssets, type EntityAssetValue } from '@/vdb/components/shared/entity-assets.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '@/vdb/components/ui/sheet.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { api } from '@/vdb/graphql/api.js';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createCollectionDocument } from '../collections.graphql.js';
import { buildCollectionQuickCreateInput } from './collection-quick-create-input.js';

export interface CollectionQuickCreateParent {
    id: string;
    name: string;
}

interface CollectionQuickCreateSheetProps {
    open: boolean;
    parent?: CollectionQuickCreateParent;
    onOpenChange: (open: boolean) => void;
    onCreated: (parentId?: string) => void;
}

const MAX_NAME_LENGTH = 30;

export function CollectionQuickCreateSheet({
    open,
    parent,
    onOpenChange,
    onCreated,
}: Readonly<CollectionQuickCreateSheetProps>) {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [isVisible, setIsVisible] = useState(true);
    const [assets, setAssets] = useState<EntityAssetValue>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formSession, setFormSession] = useState(0);

    useEffect(() => {
        if (!open) {
            setName('');
            setIsVisible(true);
            setAssets({});
            setFormSession(current => current + 1);
        }
    }, [open]);

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            toast.error('请输入分类名称');
            return;
        }

        setIsSubmitting(true);
        try {
            await api.mutate(createCollectionDocument, {
                input: buildCollectionQuickCreateInput({
                    name: trimmedName,
                    parentId: parent?.id,
                    isVisible,
                    assetIds: assets.assetIds ?? [],
                    featuredAssetId: assets.featuredAssetId,
                }),
            });

            queryClient.removeQueries({ queryKey: ['childCollections'] });
            queryClient.removeQueries({ queryKey: ['collection-tree'] });
            queryClient.removeQueries({ queryKey: ['collection-tree-children'] });
            await queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
            toast.success(parent ? '二级分类已创建' : '一级分类已创建');
            onCreated(parent?.id);
            onOpenChange(false);
        } catch (error) {
            console.error('Failed to create collection:', error);
            toast.error('创建分类失败，请检查分类名称是否重复后重试');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
            <SheetContent
                side="right"
                data-collection-quick-create
                className="flex flex-col gap-0 p-0 data-[side=right]:w-[min(380px,100vw)] data-[side=right]:sm:max-w-[380px]"
            >
                <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
                    <SheetHeader className="border-b px-6 py-5 text-left">
                        <SheetTitle className="text-lg font-semibold">
                            {parent ? '添加二级分类' : '新增一级分类'}
                        </SheetTitle>
                        <SheetDescription className="sr-only">
                            {parent ? '添加二级商品分类' : '添加一级商品分类'}
                        </SheetDescription>
                    </SheetHeader>

                    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                        <div className="space-y-3 rounded-md border bg-muted/25 p-4 text-sm">
                            <div className="grid grid-cols-[72px_1fr] gap-3">
                                <span className="text-muted-foreground">当前层级</span>
                                <span className="font-medium">{parent ? '二级分类' : '一级分类'}</span>
                            </div>
                            <div className="grid grid-cols-[72px_1fr] gap-3">
                                <span className="text-muted-foreground">上级分类</span>
                                <span className="font-medium">{parent?.name ?? '无'}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="quick-collection-name" className="text-base">
                                    分类名称 <span className="text-destructive">*</span>
                                </Label>
                                <span className="text-xs text-muted-foreground">
                                    {name.length}/{MAX_NAME_LENGTH}
                                </span>
                            </div>
                            <Input
                                id="quick-collection-name"
                                value={name}
                                maxLength={MAX_NAME_LENGTH}
                                autoFocus
                                placeholder="请输入分类名称"
                                className="h-10"
                                onChange={event => setName(event.target.value)}
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="quick-collection-parent" className="text-base">
                                上级分类
                            </Label>
                            <Input
                                id="quick-collection-parent"
                                value={parent?.name ?? '无上级分类（一级分类）'}
                                readOnly
                                aria-readonly="true"
                                className="h-10 bg-muted/35"
                            />
                        </div>

                        <div className="space-y-3">
                            <Label htmlFor="quick-collection-visible" className="text-base">
                                前台显示
                            </Label>
                            <div className="flex items-center gap-2">
                                <Switch
                                    id="quick-collection-visible"
                                    checked={isVisible}
                                    onCheckedChange={setIsVisible}
                                    aria-label="前台显示"
                                />
                                <span className="text-sm text-muted-foreground">
                                    {isVisible ? '显示' : '隐藏'}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="text-base">分类图片</Label>
                            <div className="[&_[data-testid=entity-assets-featured]]:h-32">
                                <EntityAssets
                                    key={formSession}
                                    compact
                                    multiSelect={false}
                                    imageGuidance="productGroup"
                                    onChange={setAssets}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                建议上传 1:1 方图，用于店铺分类入口展示。
                            </p>
                        </div>
                    </div>

                    <SheetFooter className="grid grid-cols-2 border-t px-6 py-4">
                        <Button
                            type="button"
                            variant="outline"
                            className="h-11 text-base"
                            disabled={isSubmitting}
                            onClick={() => onOpenChange(false)}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            className="h-11 text-base"
                            disabled={isSubmitting || !name.trim()}
                        >
                            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {isSubmitting ? '创建中…' : '创建分类'}
                        </Button>
                    </SheetFooter>
                </form>
            </SheetContent>
        </Sheet>
    );
}
