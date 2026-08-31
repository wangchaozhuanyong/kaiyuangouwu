import { describe, expect, it } from 'vitest';
import {
  hasDirectProductAssignment,
  setDirectProductAssignment,
  type CollectionFilterValue,
} from './product-collection-assignment';

const productFilter = (productIds: string[], combineWithAnd = true): CollectionFilterValue => ({
  code: 'product-id-filter',
  args: [
    { name: 'productIds', value: JSON.stringify(productIds) },
    { name: 'combineWithAnd', value: String(combineWithAnd) },
  ],
});

const automaticFilter: CollectionFilterValue = {
  code: 'facet-value-filter',
  args: [
    { name: 'facetValueIds', value: '["facet-1"]' },
    { name: 'containsAny', value: 'false' },
    { name: 'combineWithAnd', value: 'true' },
  ],
};

describe('product collection assignment filters', () => {
  it('detects direct assignments', () => {
    expect(hasDirectProductAssignment([productFilter(['product-1'])], 'product-1')).toBe(true);
    expect(hasDirectProductAssignment([productFilter(['product-2'])], 'product-1')).toBe(false);
  });

  it('adds a manual OR rule without changing automatic rules', () => {
    expect(setDirectProductAssignment([automaticFilter], 'product-1', true)).toEqual([
      { code: automaticFilter.code, arguments: automaticFilter.args },
      {
        code: 'product-id-filter',
        arguments: [
          { name: 'productIds', value: '["product-1"]' },
          { name: 'combineWithAnd', value: 'false' },
        ],
      },
    ]);
  });

  it('reuses a manual rule and removes only the requested product', () => {
    const added = setDirectProductAssignment(
      [automaticFilter, productFilter(['product-1'], false)],
      'product-2',
      true,
    );
    expect(added[1]?.arguments[0]?.value).toBe('["product-1","product-2"]');

    expect(setDirectProductAssignment(
      [automaticFilter, productFilter(['product-1'], false)],
      'product-1',
      false,
    )).toEqual([{ code: automaticFilter.code, arguments: automaticFilter.args }]);
  });

  it('preserves invalid manual rules instead of corrupting them', () => {
    const invalidFilter: CollectionFilterValue = {
      code: 'product-id-filter',
      args: [
        { name: 'productIds', value: 'invalid-json' },
        { name: 'combineWithAnd', value: 'true' },
      ],
    };
    const result = setDirectProductAssignment([invalidFilter], 'product-1', true);
    expect(result[0]).toEqual({ code: invalidFilter.code, arguments: invalidFilter.args });
    expect(result[1]?.arguments[1]?.value).toBe('false');
  });
});
