import { useQuery } from '@apollo/client/react';
import type { DocumentNode } from 'graphql';
import { useEffect, useRef } from 'react';
import {
    GET_ACTIVE_CHANNEL,
    GET_ASSETS,
    GET_CATALOG_CHANNELS,
    GET_COLLECTIONS,
    GET_FACETS,
    GET_OPTION_GROUPS,
} from '../../graphql/catalog.graphql';
import { STORE_COMMERCE_MODE_QUERY, type StoreCommerceModeData } from '../../graphql/commerce.graphql';
import { fulfillmentTypeForMode } from '../../utils/commerce-mode';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    type AssetItem,
    type CatalogChannel,
    type CollectionItem,
    type FacetItem,
    type OptionGroupItem,
    type ProductDetailRecord,
} from './product-editor-types';
export function useProductEditorData({
    productId,
    isCreateMode,
    productDetailDocument,
    facetPage,
    facetPageSize,
    deferredFacetSearch,
    assetPage,
    assetPageSize,
    deferredAssetSearch,
    optionGroupPage,
    optionGroupPageSize,
    deferredOptionGroupSearch,
    isAssetPickerOpen,
    setErrorMessage,
}: {
    productId: string | undefined;
    isCreateMode: boolean;
    productDetailDocument: DocumentNode;
    facetPage: number;
    facetPageSize: number;
    deferredFacetSearch: string;
    assetPage: number;
    assetPageSize: number;
    deferredAssetSearch: string;
    optionGroupPage: number;
    optionGroupPageSize: number;
    deferredOptionGroupSearch: string;
    isAssetPickerOpen: boolean;
    setErrorMessage: (message: string) => void;
}) {
    const loadingAllCatalogChannelsRef = useRef(false);

    const loadingAllCollectionsRef = useRef(false);

    const {
        data: channelData,
        loading: channelLoading,
        error: channelError,
        refetch: refetchChannel,
    } = useQuery<{
        activeChannel: {
            id: string;
            code: string;
            defaultLanguageCode: string;
            currencyCode: string;
            defaultCurrencyCode: string;
        };
    }>(GET_ACTIVE_CHANNEL, { fetchPolicy: 'cache-first' });

    const activeCurrencyCode =
        channelData?.activeChannel.currencyCode ?? channelData?.activeChannel.defaultCurrencyCode ?? 'CNY';

    const commerceModeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {
        fetchPolicy: 'cache-first',
    });

    const commerceMode = commerceModeQuery.data?.myStoreCommerceMode.mode ?? 'HYBRID';

    const fixedFulfillmentType = fulfillmentTypeForMode(commerceMode);

    const {
        data: productData,
        loading: productLoading,
        error: productError,
        refetch: refetchProduct,
    } = useQuery<{
        product: ProductDetailRecord | null;
    }>(productDetailDocument, {
        variables: { id: productId },
        skip: isCreateMode,
        fetchPolicy: 'network-only',
    });

    const {
        data: facetsData,
        loading: facetsLoading,
        error: facetsError,
        refetch: refetchFacets,
    } = useQuery<{ facets: { items: FacetItem[]; totalItems: number } }>(GET_FACETS, {
        variables: {
            options: {
                skip: facetPage * facetPageSize,
                take: facetPageSize,
                sort: { name: 'ASC' },
                filter: deferredFacetSearch ? { name: { contains: deferredFacetSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });

    const {
        data: collectionsData,
        loading: collectionsLoading,
        error: collectionsError,
        refetch: refetchCollections,
        fetchMore: fetchMoreCollections,
    } = useQuery<{ collections: { items: CollectionItem[]; totalItems: number } }>(GET_COLLECTIONS, {
        variables: {
            options: {
                topLevelOnly: true,
                skip: 0,
                take: 100,
                sort: { position: 'ASC' },
            },
        },
        fetchPolicy: 'cache-first',
    });

    useEffect(() => {
        const collections = collectionsData?.collections;
        if (
            !collections ||
            collectionsLoading ||
            collectionsError ||
            loadingAllCollectionsRef.current ||
            collections.items.length >= collections.totalItems
        )
            return;
        const loadedCount = collections.items.length;
        loadingAllCollectionsRef.current = true;
        void fetchMoreCollections({
            variables: {
                options: {
                    topLevelOnly: true,
                    skip: loadedCount,
                    take: 100,
                    sort: { position: 'ASC' },
                },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                collections: {
                    ...fetchMoreResult.collections,
                    items: [
                        ...new Map(
                            [...previous.collections.items, ...fetchMoreResult.collections.items].map(
                                collection => [collection.id, collection],
                            ),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setErrorMessage(toUserFacingError(fetchError, '商品分类未能全部加载'));
            })
            .finally(() => {
                loadingAllCollectionsRef.current = false;
            });
    }, [collectionsData, collectionsError, collectionsLoading, fetchMoreCollections, setErrorMessage]);

    const {
        data: catalogChannelsData,
        loading: catalogChannelsLoading,
        error: catalogChannelsError,
        fetchMore: fetchMoreCatalogChannels,
        refetch: refetchCatalogChannels,
    } = useQuery<{
        activeChannel: CatalogChannel;
        channels: { items: CatalogChannel[]; totalItems: number };
    }>(GET_CATALOG_CHANNELS, {
        variables: { options: { skip: 0, take: 100, sort: { code: 'ASC' } } },
        fetchPolicy: 'cache-and-network',
    });

    useEffect(() => {
        const channels = catalogChannelsData?.channels;
        if (
            !channels ||
            catalogChannelsLoading ||
            catalogChannelsError ||
            loadingAllCatalogChannelsRef.current
        )
            return;
        const loadedCount = channels.items.length;
        if (loadedCount >= channels.totalItems) return;
        loadingAllCatalogChannelsRef.current = true;
        void fetchMoreCatalogChannels({
            variables: { options: { skip: loadedCount, take: 100, sort: { code: 'ASC' } } },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                channels: {
                    ...fetchMoreResult.channels,
                    items: [
                        ...new Map(
                            [...previous.channels.items, ...fetchMoreResult.channels.items].map(channel => [
                                channel.id,
                                channel,
                            ]),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setErrorMessage(toUserFacingError(fetchError, '销售渠道未能全部加载'));
            })
            .finally(() => {
                loadingAllCatalogChannelsRef.current = false;
            });
    }, [
        catalogChannelsData,
        catalogChannelsError,
        catalogChannelsLoading,
        fetchMoreCatalogChannels,
        setErrorMessage,
    ]);

    const {
        data: assetsData,
        loading: assetsLoading,
        error: assetsError,
        refetch: refetchAssets,
    } = useQuery<{ assets: { items: AssetItem[]; totalItems: number } }>(GET_ASSETS, {
        variables: {
            options: {
                skip: assetPage * assetPageSize,
                take: assetPageSize,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredAssetSearch ? { name: { contains: deferredAssetSearch } } : {}),
                },
            },
        },
        skip: !isAssetPickerOpen,
        fetchPolicy: 'cache-first',
    });

    const {
        data: optionGroupsData,
        loading: optionGroupsLoading,
        error: optionGroupsError,
        refetch: refetchOptionGroups,
    } = useQuery<{
        productOptionGroups: { items: OptionGroupItem[]; totalItems: number };
    }>(GET_OPTION_GROUPS, {
        variables: {
            options: {
                skip: optionGroupPage * optionGroupPageSize,
                take: optionGroupPageSize,
                sort: { name: 'ASC' },
                filter: deferredOptionGroupSearch ? { name: { contains: deferredOptionGroupSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });
    return {
        channelData,
        channelLoading,
        channelError,
        refetchChannel,
        activeCurrencyCode,
        commerceMode,
        fixedFulfillmentType,
        productData,
        productLoading,
        productError,
        refetchProduct,
        facetsData,
        facetsLoading,
        facetsError,
        refetchFacets,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        catalogChannelsData,
        catalogChannelsLoading,
        catalogChannelsError,
        refetchCatalogChannels,
        assetsData,
        assetsLoading,
        assetsError,
        refetchAssets,
        optionGroupsData,
        optionGroupsLoading,
        optionGroupsError,
        refetchOptionGroups,
    };
}
