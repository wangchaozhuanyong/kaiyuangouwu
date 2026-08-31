export interface CollectionFilterValue {
  code: string;
  args: Array<{
    name: string;
    value: string;
  }>;
}

export interface CollectionFilterInput {
  code: string;
  arguments: Array<{
    name: string;
    value: string;
  }>;
}

const PRODUCT_ID_FILTER_CODE = 'product-id-filter';
const PRODUCT_IDS_ARGUMENT = 'productIds';
const COMBINATION_ARGUMENT = 'combineWithAnd';

function parseProductIds(filter: CollectionFilterValue): string[] | undefined {
  const value = filter.args.find(argument => argument.name === PRODUCT_IDS_ARGUMENT)?.value;
  if (value == null) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(id => typeof id === 'string')) return undefined;
    return [...new Set(parsed)];
  } catch {
    return undefined;
  }
}

function toInput(filter: CollectionFilterValue): CollectionFilterInput {
  return {
    code: filter.code,
    arguments: filter.args.map(argument => ({ ...argument })),
  };
}

function replaceProductIds(filter: CollectionFilterValue, productIds: string[]): CollectionFilterInput {
  return {
    code: filter.code,
    arguments: filter.args.map(argument => argument.name === PRODUCT_IDS_ARGUMENT
      ? { ...argument, value: JSON.stringify(productIds) }
      : { ...argument }),
  };
}

function isOrFilter(filter: CollectionFilterValue) {
  return filter.args.find(argument => argument.name === COMBINATION_ARGUMENT)?.value === 'false';
}

export function hasDirectProductAssignment(filters: CollectionFilterValue[], productId: string) {
  return filters.some(filter => (
    filter.code === PRODUCT_ID_FILTER_CODE && parseProductIds(filter)?.includes(productId) === true
  ));
}

/**
 * 只修改 Vendure 内置的手动商品规则，已有 Facet 等自动分类规则保持不变。
 * 当分类已有自动规则时，手动商品规则以 OR 方式追加，确保人工选择一定生效。
 */
export function setDirectProductAssignment(
  filters: CollectionFilterValue[],
  productId: string,
  assigned: boolean,
): CollectionFilterInput[] {
  if (!assigned) {
    return filters.flatMap(filter => {
      if (filter.code !== PRODUCT_ID_FILTER_CODE) return [toInput(filter)];

      const productIds = parseProductIds(filter);
      if (!productIds?.includes(productId)) return [toInput(filter)];

      const nextProductIds = productIds.filter(id => id !== productId);
      return nextProductIds.length > 0 ? [replaceProductIds(filter, nextProductIds)] : [];
    });
  }

  if (hasDirectProductAssignment(filters, productId)) return filters.map(toInput);

  const reusableFilterIndex = filters.findIndex(filter => (
    filter.code === PRODUCT_ID_FILTER_CODE && isOrFilter(filter) && parseProductIds(filter)
  ));
  const soleManualFilterIndex = filters.length === 1
    && filters[0]?.code === PRODUCT_ID_FILTER_CODE
    && parseProductIds(filters[0])
    ? 0
    : -1;
  const targetFilterIndex = reusableFilterIndex >= 0 ? reusableFilterIndex : soleManualFilterIndex;

  if (targetFilterIndex >= 0) {
    return filters.map((filter, index) => index === targetFilterIndex
      ? replaceProductIds(filter, [...(parseProductIds(filter) ?? []), productId])
      : toInput(filter));
  }

  return [
    ...filters.map(toInput),
    {
      code: PRODUCT_ID_FILTER_CODE,
      arguments: [
        { name: PRODUCT_IDS_ARGUMENT, value: JSON.stringify([productId]) },
        { name: COMBINATION_ARGUMENT, value: filters.length > 0 ? 'false' : 'true' },
      ],
    },
  ];
}
