import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Check, Link, Plus, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { optionGroupPickerListDocument } from '../../_option-groups/option-groups.graphql.js';
import {
    addOptionGroupToProductDocument,
    createProductOptionGroupForProductDocument,
} from '../products.graphql.js';

import { createOptionGroupSchema, OptionGroup, SingleOptionGroupEditor } from './option-groups-editor.js';

export function AddOptionGroupDialog({
    productId,
    productUpdatedAt,
    existingGroupIds,
    onSuccess,
    trigger,
}: Readonly<{
    productId: string;
    productUpdatedAt: string;
    existingGroupIds?: string[];
    onSuccess?: () => void;
    trigger?: React.ReactElement;
}>) {
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<string>('existing');
    const { t } = useLingui();
    const optionGroupSchema = useMemo(() => createOptionGroupSchema(t), [t]);

    const form = useForm<OptionGroup>({
        resolver: zodResolver(optionGroupSchema),
        defaultValues: {
            nameZh: '',
            values: [],
        },
        mode: 'onChange',
    });

    const createOptionGroupMutation = useMutation({
        mutationFn: api.mutate(createProductOptionGroupForProductDocument),
    });

    const addOptionGroupToProductMutation = useMutation({
        mutationFn: api.mutate(addOptionGroupToProductDocument),
    });

    const handleAssignExisting = async (optionGroupId: string) => {
        if (addOptionGroupToProductMutation.isPending) return;
        try {
            await addOptionGroupToProductMutation.mutateAsync({
                productId,
                optionGroupId,
                expectedUpdatedAt: productUpdatedAt,
            });
            toast.success(t`Successfully assigned option group`);
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to assign option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    };

    const handleCreateNew = form.handleSubmit(async formValue => {
        try {
            await createOptionGroupMutation.mutateAsync({
                productId,
                expectedUpdatedAt: productUpdatedAt,
                input: {
                    code: `option-group-${Date.now().toString(36)}`,
                    translations: [
                        {
                            languageCode: 'zh_Hans',
                            name: formValue.nameZh,
                        },
                    ],
                    options: formValue.values.map((value, index) => ({
                        code: `option-${Date.now().toString(36)}-${index + 1}`,
                        translations: [
                            {
                                languageCode: 'zh_Hans',
                                name: value.valueZh,
                            },
                        ],
                    })),
                },
            });

            toast.success(t`Successfully created option group`);
            setOpen(false);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to create option group`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    return (
        <Dialog
            open={open}
            onOpenChange={isOpen => {
                setOpen(isOpen);
                if (!isOpen) {
                    form.reset();
                    setActiveTab('existing');
                }
            }}
        >
            {trigger ? (
                <DialogTrigger render={trigger} />
            ) : (
                <DialogTrigger
                    render={<Button variant="outline" size="sm" type="button" className="w-full gap-2" />}
                >
                    <Plus className="h-4 w-4" />
                    <Trans>Set specification templates</Trans>
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Set product specifications</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>
                            Choose a reusable template from the library, or create a template for this
                            product.
                        </Trans>
                    </DialogDescription>
                </DialogHeader>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="existing">
                            <Link className="mr-2 h-4 w-4" />
                            <Trans>Choose from library</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="new">
                            <Plus className="mr-2 h-4 w-4" />
                            <Trans>Create new</Trans>
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="existing">
                        <OptionGroupSearch
                            existingGroupIds={existingGroupIds}
                            onSelect={optionGroupId => {
                                void handleAssignExisting(optionGroupId);
                            }}
                            isPending={addOptionGroupToProductMutation.isPending}
                        />
                    </TabsContent>
                    <TabsContent value="new">
                        <div className="space-y-4">
                            <Form {...form}>
                                <SingleOptionGroupEditor control={form.control} fieldArrayPath={''} />
                            </Form>
                        </div>
                        <DialogFooter className="mt-4">
                            <Button
                                onClick={() => {
                                    void handleCreateNew();
                                }}
                                disabled={
                                    !form.formState.isValid ||
                                    createOptionGroupMutation.isPending ||
                                    addOptionGroupToProductMutation.isPending
                                }
                            >
                                <Save className="mr-2 h-4 w-4" />
                                <Trans>Save option group</Trans>
                            </Button>
                        </DialogFooter>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

function OptionGroupSearch({
    existingGroupIds = [],
    onSelect,
    isPending,
}: Readonly<{
    existingGroupIds?: string[];
    onSelect: (optionGroupId: string) => void;
    isPending: boolean;
}>) {
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const { t } = useLingui();

    const { data, isLoading } = useQuery({
        queryKey: ['option-groups-search', debouncedSearchTerm],
        queryFn: () =>
            api.query(optionGroupPickerListDocument, {
                options: {
                    take: 20,
                    sort: { name: 'ASC' },
                    filter: debouncedSearchTerm ? { name: { contains: debouncedSearchTerm } } : undefined,
                },
            }),
        staleTime: 1000 * 60,
    });

    const items = data?.productOptionGroups?.items ?? [];
    const sortedItems = [...items].sort((a, b) => {
        const aAssigned = existingGroupIds.includes(a.id);
        const bAssigned = existingGroupIds.includes(b.id);
        if (aAssigned !== bAssigned) return aAssigned ? -1 : 1;
        return 0;
    });

    return (
        <Command shouldFilter={false} className="border rounded-md">
            <CommandInput
                placeholder={t`Search specification templates...`}
                onValueChange={setSearchTerm}
                className="h-10"
            />
            <CommandList className="max-h-[300px]">
                <CommandEmpty>
                    {isLoading ? <Trans>Loading...</Trans> : <Trans>No specification templates found</Trans>}
                </CommandEmpty>
                {sortedItems.map(group => {
                    const isAlreadyAssigned = existingGroupIds.includes(group.id);
                    return (
                        <CommandItem
                            key={group.id}
                            disabled={isAlreadyAssigned || isPending}
                            onSelect={() => {
                                if (!isAlreadyAssigned) {
                                    onSelect(group.id);
                                }
                            }}
                            className="flex items-center justify-between"
                        >
                            <div>
                                <div className="font-medium">{group.name}</div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                    {group.productCount > 0 ? (
                                        <Trans>Linked to {group.productCount} products</Trans>
                                    ) : (
                                        <Trans>Not linked to any product</Trans>
                                    )}
                                </div>
                                {group.options.length > 0 ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {group.options.slice(0, 4).map(option => (
                                            <Badge key={option.id} variant="outline" className="font-normal">
                                                {option.name}
                                            </Badge>
                                        ))}
                                        {group.options.length > 4 && (
                                            <Badge variant="outline" className="font-normal">
                                                +{group.options.length - 4}
                                            </Badge>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mt-1 text-sm text-muted-foreground">—</div>
                                )}
                            </div>
                            {isAlreadyAssigned && (
                                <Badge variant="secondary" className="ml-2">
                                    <Check className="mr-1 h-3 w-3" />
                                    <Trans>Linked to this product</Trans>
                                </Badge>
                            )}
                        </CommandItem>
                    );
                })}
            </CommandList>
        </Command>
    );
}
