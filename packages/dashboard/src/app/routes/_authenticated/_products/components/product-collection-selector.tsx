import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Command, CommandInput, CommandItem, CommandList } from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { CornerDownRight, Folder, Loader2, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { productCollectionHierarchyDocument } from '../products.graphql.js';

const PAGE_SIZE = 100;

export interface ProductCollectionOption {
    id: string;
    name: string;
    slug: string;
    position: number;
}

export interface ProductCollectionParent extends ProductCollectionOption {
    children?: readonly ProductCollectionOption[] | null;
}

export interface ProductCollectionGroup {
    parent: ProductCollectionOption;
    children: ProductCollectionOption[];
}

interface ProductCollectionSelectorProps {
    value: string[];
    selectedCollections: ReadonlyArray<{ id: string; name: string }>;
    onChange: (value: string[]) => void;
    disabled?: boolean;
}

function compareCollectionOptions(a: ProductCollectionOption, b: ProductCollectionOption) {
    return a.position - b.position || a.name.localeCompare(b.name);
}

export function buildProductCollectionGroups(
    parents: readonly ProductCollectionParent[],
): ProductCollectionGroup[] {
    return [...parents].sort(compareCollectionOptions).map(({ children, ...parent }) => ({
        parent,
        children: [...(children ?? [])].sort(compareCollectionOptions),
    }));
}

export function filterProductCollectionGroups(
    groups: readonly ProductCollectionGroup[],
    searchTerm: string,
): ProductCollectionGroup[] {
    const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();
    if (!normalizedSearchTerm) {
        return [...groups];
    }

    return groups.flatMap(group => {
        if (group.parent.name.toLocaleLowerCase().includes(normalizedSearchTerm)) {
            return [group];
        }

        const matchingChildren = group.children.filter(child =>
            child.name.toLocaleLowerCase().includes(normalizedSearchTerm),
        );
        return matchingChildren.length > 0 ? [{ ...group, children: matchingChildren }] : [];
    });
}

async function fetchProductCollectionHierarchy() {
    const firstPage = await api.query(productCollectionHierarchyDocument, {
        options: {
            skip: 0,
            take: PAGE_SIZE,
            topLevelOnly: true,
            sort: { position: 'ASC' },
        },
    });
    const remainingPageStarts = Array.from(
        { length: Math.max(0, Math.ceil(firstPage.collections.totalItems / PAGE_SIZE) - 1) },
        (_, index) => (index + 1) * PAGE_SIZE,
    );
    const remainingPages = await Promise.all(
        remainingPageStarts.map(skip =>
            api.query(productCollectionHierarchyDocument, {
                options: {
                    skip,
                    take: PAGE_SIZE,
                    topLevelOnly: true,
                    sort: { position: 'ASC' },
                },
            }),
        ),
    );

    return [firstPage, ...remainingPages].flatMap(page => page.collections.items);
}

export function ProductCollectionSelector({
    value,
    selectedCollections,
    onChange,
    disabled,
}: Readonly<ProductCollectionSelectorProps>) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const hierarchyQuery = useQuery({
        queryKey: ['product-collection-hierarchy'],
        queryFn: fetchProductCollectionHierarchy,
        staleTime: 1000 * 60 * 5,
    });
    const groups = useMemo(
        () => buildProductCollectionGroups((hierarchyQuery.data ?? []) as ProductCollectionParent[]),
        [hierarchyQuery.data],
    );
    const filteredGroups = useMemo(
        () => filterProductCollectionGroups(groups, searchTerm),
        [groups, searchTerm],
    );
    const collectionPathById = useMemo(() => {
        const paths = new Map<string, string>();
        groups.forEach(group => {
            paths.set(group.parent.id, group.parent.name);
            group.children.forEach(child => {
                paths.set(child.id, `${group.parent.name} / ${child.name}`);
            });
        });
        selectedCollections.forEach(collection => {
            if (!paths.has(collection.id)) {
                paths.set(collection.id, collection.name);
            }
        });
        return paths;
    }, [groups, selectedCollections]);

    const toggleCollection = (collectionId: string) => {
        onChange(
            value.includes(collectionId)
                ? value.filter(selectedId => selectedId !== collectionId)
                : [...value, collectionId],
        );
    };

    return (
        <div className="overflow-auto">
            {value.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                    {value.map(collectionId => (
                        <div
                            key={collectionId}
                            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-sm text-secondary-foreground"
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {collectionPathById.get(collectionId) ?? collectionId}
                            </span>
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => toggleCollection(collectionId)}
                                    className="text-secondary-foreground/70 hover:text-secondary-foreground"
                                    aria-label={`${t`Remove`} ${collectionPathById.get(collectionId) ?? collectionId}`}
                                >
                                    <X className="h-3 w-3" aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            disabled={disabled}
                            className="gap-2"
                        />
                    }
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {value.length > 0 ? (
                        <Trans>Add more ({value.length} selected)</Trans>
                    ) : (
                        <Trans>Add product group</Trans>
                    )}
                </PopoverTrigger>
                <PopoverContent className="w-[420px] max-w-[calc(100vw-2rem)] p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={t`Search collections...`}
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            disabled={disabled}
                        />
                        <CommandList className="h-[360px] overflow-y-auto">
                            {hierarchyQuery.isLoading ? (
                                <div
                                    className="flex items-center justify-center py-8 text-sm text-muted-foreground"
                                    role="status"
                                >
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                    <Trans>Loading product groups...</Trans>
                                </div>
                            ) : hierarchyQuery.isError ? (
                                <div className="space-y-2 px-4 py-8 text-center">
                                    <p className="text-sm text-destructive">
                                        <Trans>Failed to load product groups</Trans>
                                    </p>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void hierarchyQuery.refetch()}
                                    >
                                        <Trans>Retry</Trans>
                                    </Button>
                                </div>
                            ) : filteredGroups.length === 0 ? (
                                <div className="py-8 text-center text-sm text-muted-foreground">
                                    {groups.length === 0 ? (
                                        <Trans>No product groups found</Trans>
                                    ) : (
                                        <Trans>No results found</Trans>
                                    )}
                                </div>
                            ) : (
                                <div className="py-1">
                                    {filteredGroups.map(group => (
                                        <div
                                            key={group.parent.id}
                                            className="border-b border-border/60 py-1 last:border-b-0"
                                        >
                                            <CollectionOptionRow
                                                option={group.parent}
                                                level="top"
                                                selected={value.includes(group.parent.id)}
                                                onSelect={() => toggleCollection(group.parent.id)}
                                            />
                                            {group.children.map(child => (
                                                <CollectionOptionRow
                                                    key={child.id}
                                                    option={child}
                                                    level="second"
                                                    selected={value.includes(child.id)}
                                                    onSelect={() => toggleCollection(child.id)}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}

function CollectionOptionRow({
    option,
    level,
    selected,
    onSelect,
}: Readonly<{
    option: ProductCollectionOption;
    level: 'top' | 'second';
    selected: boolean;
    onSelect: () => void;
}>) {
    const { t } = useLingui();
    const levelLabel = level === 'top' ? t`Top-level collection` : t`Second-level collection`;

    return (
        <CommandItem
            value={option.id}
            onSelect={onSelect}
            className={cn(
                'flex items-center gap-2 rounded-none px-3 py-2',
                level === 'top' ? 'bg-muted/35 font-medium' : 'pl-9',
            )}
        >
            <Checkbox
                checked={selected}
                onCheckedChange={onSelect}
                onClick={event => event.stopPropagation()}
                aria-label={t`Select ${option.name}`}
            />
            {level === 'top' ? (
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
                <CornerDownRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {levelLabel}
            </span>
        </CommandItem>
    );
}
