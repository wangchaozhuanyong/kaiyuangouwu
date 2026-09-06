import { useMutation } from '@apollo/client/react';
import { useNavigate } from 'react-router-dom';
import { client, sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    customFieldInputFromValues,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import {
    ADD_OPTION_GROUP_TO_PRODUCT,
    ASSIGN_PRODUCTS_TO_CHANNEL,
    CREATE_PRODUCT,
    CREATE_PRODUCT_VARIANTS,
    GET_COLLECTION_ASSIGNMENT_DETAIL,
    GET_PRODUCTS,
    REMOVE_OPTION_GROUP_FROM_PRODUCT,
    REMOVE_PRODUCTS_FROM_CHANNEL,
    UPDATE_COLLECTION_ASSIGNMENT,
    UPDATE_PRODUCT,
    UPDATE_PRODUCT_VARIANTS,
} from '../../graphql/catalog.graphql';
import {
    hasDirectProductAssignment,
    setDirectProductAssignment,
    type CollectionFilterValue,
} from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import type { ProductEditorFormErrors, ProductEditorSnapshotInput } from './product-editor-types';
import {
    createSlugFromName,
    SOURCE_LANGUAGE_CODE,
    variantFulfillmentInput,
    type ProductEditorTab,
} from './product-editor-types';
import { useProductEditorData } from './useProductEditorData';
export type ProductEditorSaveDraft = ProductEditorSnapshotInput;
interface ProductEditorSaveInput {
    draft: ProductEditorSaveDraft;
    data: Pick<
        ReturnType<typeof useProductEditorData>,
        'productData' | 'catalogChannelsData' | 'refetchCollections' | 'refetchProduct'
    >;
    productId: string | undefined;
    productExtensionFields: Parameters<typeof validateCustomFieldValues>[0];
    controls: {
        requestConfirmation: ReturnType<typeof useConfirmDialog>;
        navigate: ReturnType<typeof useNavigate>;
        setActiveTab: (tab: ProductEditorTab) => void;
        setErrorMessage: (message: string) => void;
        setFormErrors: (errors: ProductEditorFormErrors) => void;
        setSaving: (saving: boolean) => void;
        showError: (message: string) => void;
        showNotice: (message: string) => void;
    };
}

export function useProductEditorSave({
    draft,
    data,
    productId,
    productExtensionFields,
    controls,
}: ProductEditorSaveInput) {
    const isCreateMode = !productId || productId === 'new';
    const {
        productName,
        slug,
        enabled,
        description,
        fulfillmentType: effectiveFulfillmentType,
        refundPolicy,
        manualDeliverySlaMinutes,
        featuredAssetId,
        selectedAssetIds,
        selectedFacetValueIds,
        selectedCollectionIds,
        selectedChannelIds,
        selectedOptionGroupIds,
        variants,
        dynamicCustomFields: dynamicCustomFieldValues,
    } = draft;
    const { productData, catalogChannelsData, refetchCollections, refetchProduct } = data;
    const {
        requestConfirmation,
        navigate,
        setActiveTab,
        setErrorMessage,
        setFormErrors,
        setSaving,
        showError,
        showNotice,
    } = controls;
    const [createProductMutation] = useMutation<{ createProduct: { id: string } }>(CREATE_PRODUCT);

    const [updateProductMutation] = useMutation<{ updateProduct: { id: string } }>(UPDATE_PRODUCT);

    const [createVariantsMutation] = useMutation(CREATE_PRODUCT_VARIANTS);

    const [updateVariantsMutation] = useMutation(UPDATE_PRODUCT_VARIANTS);

    const [addOptionGroupToProduct] = useMutation(ADD_OPTION_GROUP_TO_PRODUCT);

    const [removeOptionGroupFromProduct] = useMutation<{
        removeOptionGroupFromProduct: {
            __typename: 'Product' | 'ProductOptionInUseError';
            message?: string;
        };
    }>(REMOVE_OPTION_GROUP_FROM_PRODUCT);

    const [updateCollectionAssignment] = useMutation(UPDATE_COLLECTION_ASSIGNMENT);

    const [assignProductsToChannel] = useMutation(ASSIGN_PRODUCTS_TO_CHANNEL);

    const [removeProductsFromChannel] = useMutation(REMOVE_PRODUCTS_FROM_CHANNEL);

    const syncProductOptionGroups = async (targetProductId: string, originalGroupIds: string[]) => {
        const addedGroupIds = selectedOptionGroupIds.filter(id => !originalGroupIds.includes(id));
        const removedGroupIds = originalGroupIds.filter(id => !selectedOptionGroupIds.includes(id));
        for (const optionGroupId of addedGroupIds) {
            await addOptionGroupToProduct({ variables: { productId: targetProductId, optionGroupId } });
        }
        for (const optionGroupId of removedGroupIds) {
            const result = await removeOptionGroupFromProduct({
                variables: { productId: targetProductId, optionGroupId },
            });
            if (result.data?.removeOptionGroupFromProduct.__typename === 'ProductOptionInUseError') {
                throw new Error(
                    result.data.removeOptionGroupFromProduct.message || '规格模板仍被 SKU 使用，无法移除',
                );
            }
        }
    };

    const syncProductCollections = async (targetProductId: string) => {
        const originalIds = (productData?.product?.collections ?? [])
            .filter(collection => hasDirectProductAssignment(collection.filters, targetProductId))
            .map(collection => collection.id);
        const originalIdSet = new Set(originalIds);
        const selectedIdSet = new Set(selectedCollectionIds);
        const changes = [
            ...selectedCollectionIds
                .filter(collectionId => !originalIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: true })),
            ...originalIds
                .filter(collectionId => !selectedIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: false })),
        ];

        await Promise.all(
            changes.map(async change => {
                const detail = await client.query<{
                    collection: { id: string; filters: CollectionFilterValue[] } | null;
                }>({
                    query: GET_COLLECTION_ASSIGNMENT_DETAIL,
                    variables: { id: change.collectionId },
                    fetchPolicy: 'network-only',
                });
                const collection = detail.data?.collection;
                if (!collection) throw new Error('所选商品分类不存在或已被删除');
                await updateCollectionAssignment({
                    variables: {
                        input: {
                            id: change.collectionId,
                            filters: setDirectProductAssignment(
                                collection.filters,
                                targetProductId,
                                change.assigned,
                            ),
                        },
                    },
                });
            }),
        );

        if (changes.length > 0) await refetchCollections();
    };

    const syncProductChannels = async (targetProductId: string, originalChannelIds: string[]) => {
        const activeChannelId = catalogChannelsData?.activeChannel.id;
        const nextChannelIds =
            activeChannelId && !selectedChannelIds.includes(activeChannelId)
                ? [...selectedChannelIds, activeChannelId]
                : selectedChannelIds;
        const originalIdSet = new Set(originalChannelIds);
        const nextIdSet = new Set(nextChannelIds);
        const addedChannelIds = nextChannelIds.filter(channelId => !originalIdSet.has(channelId));
        const removedChannelIds = originalChannelIds.filter(
            channelId => channelId !== activeChannelId && !nextIdSet.has(channelId),
        );

        await Promise.all([
            ...addedChannelIds.map(channelId =>
                assignProductsToChannel({
                    variables: { input: { productIds: [targetProductId], channelId, priceFactor: 1 } },
                }),
            ),
            ...removedChannelIds.map(channelId =>
                removeProductsFromChannel({
                    variables: { input: { productIds: [targetProductId], channelId } },
                }),
            ),
        ]);
    };

    const validateForm = (): boolean => {
        const errors: ProductEditorFormErrors = {};
        if (!productName.trim()) {
            errors.name = '请输入名称';
        }
        if (!description.trim()) {
            errors.description = '请输入中文商品详情';
        }
        if (
            effectiveFulfillmentType === 'digital' &&
            (!Number.isInteger(manualDeliverySlaMinutes) ||
                manualDeliverySlaMinutes < 5 ||
                manualDeliverySlaMinutes > 525600)
        ) {
            setActiveTab('BASIC');
            showError('人工交付预计时长必须是 5 到 525600 分钟之间的整数');
            return false;
        }

        const variantErrors: Record<number, { sku?: string; price?: string; stock?: string }> = {};
        const skuCounts = variants.reduce<Record<string, number>>((counts, variant) => {
            const sku = variant.sku.trim().toLowerCase();
            if (sku) counts[sku] = (counts[sku] ?? 0) + 1;
            return counts;
        }, {});
        variants.forEach((v, index) => {
            const rowErr: { sku?: string; price?: string; stock?: string } = {};
            if (!v.sku.trim()) {
                rowErr.sku = 'SKU 编码为必填项';
            } else if (skuCounts[v.sku.trim().toLowerCase()] > 1) {
                rowErr.sku = '同一商品内的 SKU 编码不能重复';
            }
            if (v.price === '' || isNaN(parseFloat(v.price)) || parseFloat(v.price) < 0) {
                rowErr.price = '请输入有效的非负金额';
            }
            const requiresManualStock =
                effectiveFulfillmentType === 'physical' ||
                (v.digitalDeliveryMode !== 'auto_card' && v.digitalStockPolicy === 'limited');
            if (
                requiresManualStock &&
                v.stockOnHand !== '' &&
                (!Number.isInteger(Number(v.stockOnHand)) || Number(v.stockOnHand) < 0)
            ) {
                rowErr.stock = '库存必须为非负整数';
            }
            if (Object.keys(rowErr).length > 0) {
                variantErrors[index] = rowErr;
            }
        });

        if (Object.keys(variantErrors).length > 0) {
            errors.variants = variantErrors;
        }

        setFormErrors(errors);

        if (errors.name || errors.description) {
            setActiveTab('BASIC');
            showError('商品基础信息填写不完整，请修正标红字段');
            return false;
        }

        if (errors.variants) {
            setActiveTab('VARIANTS');
            showError('SKU 规格变体列表中存在未填写的编码或格式错误金额，请核对');
            return false;
        }

        return true;
    };

    const handleSave = async () => {
        if (!validateForm()) return;

        const customFieldErrors = validateCustomFieldValues(productExtensionFields, dynamicCustomFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            setActiveTab('BASIC');
            showError(Object.values(customFieldErrors)[0] ?? '商品扩展字段校验失败');
            return;
        }

        setSaving(true);
        setErrorMessage('');
        const completedStages: string[] = [];

        const generatedSlug = slug.trim() || createSlugFromName(productName);
        const localizedFieldsFor = (languageCode: string) => {
            const customFields = localizedCustomFieldInputFromValues(
                productExtensionFields,
                dynamicCustomFieldValues,
                languageCode,
            );
            return Object.keys(customFields).length > 0 ? { customFields } : {};
        };
        const englishCustomFields = localizedFieldsFor('en');
        const updateTranslations = productData?.product
            ? [
                  ...(Object.keys(englishCustomFields).length > 0
                      ? [{ languageCode: 'en', ...englishCustomFields }]
                      : []),
                  ...productData.product.translations
                      .filter(translation => translation.languageCode !== 'en')
                      .map(translation => ({
                          id: translation.id,
                          languageCode: translation.languageCode,
                          name:
                              translation.languageCode === SOURCE_LANGUAGE_CODE
                                  ? productName.trim()
                                  : translation.name,
                          slug:
                              translation.languageCode === SOURCE_LANGUAGE_CODE
                                  ? generatedSlug
                                  : translation.slug,
                          description:
                              translation.languageCode === SOURCE_LANGUAGE_CODE
                                  ? description.trim()
                                  : translation.description,
                          ...localizedFieldsFor(translation.languageCode),
                      })),
                  ...(productData.product.translations.some(
                      translation => translation.languageCode === SOURCE_LANGUAGE_CODE,
                  )
                      ? []
                      : [
                            {
                                languageCode: SOURCE_LANGUAGE_CODE,
                                name: productName.trim(),
                                slug: generatedSlug,
                                description: description.trim(),
                                ...localizedFieldsFor(SOURCE_LANGUAGE_CODE),
                            },
                        ]),
              ]
            : [];

        try {
            if (isCreateMode) {
                // 阶段 1: 创建 SPU 商品实体
                let newProductId = '';
                try {
                    const createRes = await createProductMutation({
                        variables: {
                            input: {
                                enabled,
                                featuredAssetId: featuredAssetId || undefined,
                                assetIds: selectedAssetIds,
                                facetValueIds:
                                    selectedFacetValueIds.length > 0 ? selectedFacetValueIds : undefined,
                                customFields: {
                                    fulfillmentType: effectiveFulfillmentType,
                                    refundPolicy,
                                    manualDeliverySlaMinutes,
                                    ...customFieldInputFromValues(
                                        productExtensionFields,
                                        dynamicCustomFieldValues,
                                    ),
                                },
                                translations: [
                                    {
                                        languageCode: SOURCE_LANGUAGE_CODE,
                                        name: productName.trim(),
                                        slug: generatedSlug,
                                        description: description.trim(),
                                        ...localizedFieldsFor(SOURCE_LANGUAGE_CODE),
                                    },
                                ],
                            },
                        },
                        refetchQueries: [{ query: GET_PRODUCTS }],
                    });

                    newProductId = createRes?.data?.createProduct?.id || '';
                    if (!newProductId) throw new Error('后端未返回创建的商品 ID');
                } catch (err: unknown) {
                    throw new Error(`[阶段 1：商品创建失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                // 阶段 2: 将所选真实规格模板分配给新商品
                try {
                    await syncProductOptionGroups(newProductId, []);
                } catch (err: unknown) {
                    navigate(`/catalog/products/${newProductId}?tab=variants`, { replace: true });
                    showError(
                        `[阶段 2：商品已创建，但规格模板分配失败] ${toUserFacingError(err, '请稍后重试')}`,
                    );
                    setSaving(false);
                    return;
                }

                // 阶段 3: 创建 SKU 规格变体 (若有配置变体)
                if (variants.length > 0) {
                    try {
                        const variantsInput = variants.map(v => ({
                            productId: newProductId,
                            sku: v.sku.trim(),
                            enabled: v.enabled,
                            price: Math.round(parseFloat(v.price) * 100),
                            ...variantFulfillmentInput(v, effectiveFulfillmentType),
                            optionIds: v.optionIds,
                            translations: [
                                {
                                    languageCode: SOURCE_LANGUAGE_CODE,
                                    name: v.name.trim() || productName.trim(),
                                },
                            ],
                        }));

                        await createVariantsMutation({
                            variables: { input: variantsInput },
                        });
                    } catch (err: unknown) {
                        // SPU 已创建但规格失败，如实告知用户，不能冒充成功
                        navigate(`/catalog/products/${newProductId}?tab=variants`, { replace: true });
                        showError(
                            `[阶段 3：商品与规格模板已保存，但 SKU 变体创建失败] ${toUserFacingError(err, '请稍后重试')}`,
                        );
                        setSaving(false);
                        return;
                    }
                }

                // 阶段 4: 保存销售店铺范围与人工商品分类
                try {
                    const activeChannelId = catalogChannelsData?.activeChannel.id;
                    await syncProductChannels(newProductId, activeChannelId ? [activeChannelId] : []);
                    await syncProductCollections(newProductId);
                } catch (err: unknown) {
                    navigate(`/catalog/products/${newProductId}?tab=variants`, { replace: true });
                    showError(
                        `[阶段 4：商品与 SKU 已保存，但销售店铺或分类归属保存失败] ${toUserFacingError(err, '请稍后重试')}`,
                    );
                    setSaving(false);
                    return;
                }

                showNotice(`商品《${productName}》及 ${variants.length} 个规格变体已全部发布入库！`);
                navigate(`/catalog/products/${newProductId}?tab=variants`, { replace: true });
            } else {
                const existingVariants = variants.filter(v => v.id && !v.isNew);
                const newVariants = variants.filter(v => v.isNew);
                const changesVariantEnabledState = existingVariants.some(
                    variant =>
                        productData?.product?.variants.find(original => original.id === variant.id)
                            ?.enabled !== variant.enabled,
                );
                const changesProductEnabledState = productData?.product?.enabled !== enabled;
                let enabledMutationContext: ReturnType<typeof sensitiveActionContext> | undefined;
                if (changesProductEnabledState || changesVariantEnabledState) {
                    const confirmation = await requestConfirmation({
                        title: '确认修改商品上下架状态？',
                        description:
                            'SPU 或 SKU 上下架会立即影响买家是否可以购买。请输入当前管理员密码完成安全校验。',
                        confirmLabel: '验证并保存',
                        tone: 'warning',
                        requireCurrentPassword: true,
                    });
                    if (!confirmation) return;
                    enabledMutationContext = sensitiveActionContext(confirmation.currentPassword ?? '');
                }

                // 编辑模式: 更新 SPU 与 Facet
                try {
                    await updateProductMutation({
                        variables: {
                            input: {
                                id: productId,
                                ...(changesProductEnabledState ? { enabled } : {}),
                                featuredAssetId,
                                assetIds: selectedAssetIds,
                                facetValueIds: selectedFacetValueIds,
                                customFields: {
                                    fulfillmentType: effectiveFulfillmentType,
                                    refundPolicy,
                                    manualDeliverySlaMinutes,
                                    ...customFieldInputFromValues(
                                        productExtensionFields,
                                        dynamicCustomFieldValues,
                                    ),
                                },
                                translations: updateTranslations,
                            },
                        },
                        context: changesProductEnabledState ? enabledMutationContext : undefined,
                    });
                    completedStages.push('商品基础信息');
                } catch (err: unknown) {
                    throw new Error(`[商品属性更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                try {
                    const originalGroupIds = Array.isArray(productData?.product?.optionGroups)
                        ? productData.product.optionGroups.map(group => group.id)
                        : [];
                    await syncProductOptionGroups(productId, originalGroupIds);
                    completedStages.push('规格模板关联');
                } catch (err: unknown) {
                    throw new Error(`[规格模板关联更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                // 更新已有变体与创建新加变体
                if (existingVariants.length > 0) {
                    try {
                        await updateVariantsMutation({
                            variables: {
                                input: existingVariants.map(v => {
                                    const original = productData?.product?.variants.find(
                                        item => item.id === v.id,
                                    );
                                    return {
                                        id: v.id,
                                        sku: v.sku.trim(),
                                        ...(original?.enabled !== v.enabled ? { enabled: v.enabled } : {}),
                                        price: Math.round(parseFloat(v.price) * 100),
                                        ...variantFulfillmentInput(v, effectiveFulfillmentType),
                                        optionIds: v.optionIds,
                                        translations: [
                                            {
                                                languageCode: SOURCE_LANGUAGE_CODE,
                                                name: v.name.trim() || productName.trim(),
                                            },
                                        ],
                                    };
                                }),
                            },
                            context: changesVariantEnabledState ? enabledMutationContext : undefined,
                        });
                        completedStages.push('现有 SKU');
                    } catch (err: unknown) {
                        throw new Error(`[现有 SKU 变体更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                    }
                }

                if (newVariants.length > 0) {
                    try {
                        await createVariantsMutation({
                            variables: {
                                input: newVariants.map(v => ({
                                    productId,
                                    sku: v.sku.trim(),
                                    enabled: v.enabled,
                                    price: Math.round(parseFloat(v.price) * 100),
                                    ...variantFulfillmentInput(v, effectiveFulfillmentType),
                                    optionIds: v.optionIds,
                                    translations: [
                                        {
                                            languageCode: SOURCE_LANGUAGE_CODE,
                                            name: v.name.trim() || productName.trim(),
                                        },
                                    ],
                                })),
                            },
                        });
                        completedStages.push('新增 SKU');
                    } catch (err: unknown) {
                        throw new Error(`[新 SKU 变体创建失败] ${toUserFacingError(err, '请稍后重试')}`);
                    }
                }

                try {
                    await syncProductChannels(
                        productId,
                        productData?.product?.channels.map(channel => channel.id) ?? [],
                    );
                    await syncProductCollections(productId);
                    completedStages.push('销售店铺与商品分类');
                } catch (err: unknown) {
                    throw new Error(`[销售店铺或商品分类更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                await refetchProduct();
                showNotice(`商品《${productName}》及规格变体已全部保存至数据库！`);
            }
        } catch (err: unknown) {
            if (!isCreateMode && completedStages.length > 0) {
                const reloaded = await refetchProduct().then(
                    () => true,
                    () => false,
                );
                showError(
                    `部分内容已保存（${completedStages.join('、')}），但后续步骤失败：${toUserFacingError(err, '请稍后重试')}。${reloaded ? '页面已按后端当前数据重新加载。' : '重新加载失败，请刷新页面核对已保存内容后再操作。'}`,
                );
            } else {
                showError(toUserFacingError(err, '商品保存失败，请稍后重试'));
            }
        } finally {
            setSaving(false);
        }
    };
    return { handleSave };
}
