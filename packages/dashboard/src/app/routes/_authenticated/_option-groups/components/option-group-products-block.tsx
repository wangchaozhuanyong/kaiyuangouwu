import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDebounce } from '@uidotdev/usehooks';
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { productsByOptionGroupDocument } from '../option-groups.graphql.js';

const PAGE_SIZE = 10;

export function OptionGroupProductsBlock({
    optionGroupId,
}: Readonly<{
    optionGroupId: string;
}>) {
    const { t } = useLingui();
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const { data, isPending, isFetching, isError, refetch } = useQuery({
        queryKey: ['optionGroupProducts', optionGroupId, debouncedSearchTerm, page],
        queryFn: () =>
            api.query(productsByOptionGroupDocument, {
                options: {
                    filter: {
                        optionGroupId: { eq: optionGroupId },
                        ...(debouncedSearchTerm ? { name: { contains: debouncedSearchTerm } } : {}),
                    },
                    take: PAGE_SIZE,
                    skip: (page - 1) * PAGE_SIZE,
                },
            }),
        placeholderData: keepPreviousData,
    });

    const items = data?.products?.items ?? [];
    const totalItems = data?.products?.totalItems ?? 0;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const hasMultiplePages = totalPages > 1;

    return (
        <div className="space-y-3">
            <Input
                aria-label={t`Search linked products`}
                placeholder={t`Search linked products...`}
                value={searchTerm}
                onChange={e => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                }}
                className="h-9 max-w-md"
            />
            <div
                className="overflow-hidden rounded-lg border"
                aria-busy={isFetching}
                data-testid="linked-products-list"
            >
                {isPending ? (
                    <div className="space-y-0 divide-y" data-testid="linked-products-loading">
                        {Array.from({ length: 3 }, (_, index) => (
                            <div key={index} className="flex items-center justify-between gap-4 px-4 py-3">
                                <Skeleton className="h-4 w-48 max-w-[60%]" />
                                <Skeleton className="h-8 w-20" />
                            </div>
                        ))}
                    </div>
                ) : isError ? (
                    <div className="p-3">
                        <Alert variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                <Trans>Could not load linked products.</Trans>
                                <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                    <Trans>Retry</Trans>
                                </Button>
                            </AlertDescription>
                        </Alert>
                    </div>
                ) : items.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                        <p className="font-medium">
                            {searchTerm ? (
                                <Trans>No linked products match this search</Trans>
                            ) : (
                                <Trans>No products are linked to this template</Trans>
                            )}
                        </p>
                        {!searchTerm && (
                            <p className="mt-1 text-sm text-muted-foreground">
                                <Trans>Open a product and choose this template to create a link.</Trans>
                            </p>
                        )}
                    </div>
                ) : (
                    <div className={isFetching ? 'divide-y opacity-60' : 'divide-y'}>
                        {items.map(item => (
                            <Link
                                key={item.id}
                                to={`/products/${item.id}`}
                                preload={false}
                                className="group flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                                <span className="min-w-0">
                                    <span className="block truncate font-medium">{item.name}</span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        <Trans>Open product to manage this link</Trans>
                                    </span>
                                </span>
                                <ArrowRight
                                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                                    aria-hidden="true"
                                />
                            </Link>
                        ))}
                    </div>
                )}
            </div>
            {hasMultiplePages && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                        <Trans>
                            Page {page} of {totalPages}
                        </Trans>
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={t`Previous page`}
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={t`Next page`}
                            disabled={page >= totalPages}
                            onClick={() => setPage(p => p + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
