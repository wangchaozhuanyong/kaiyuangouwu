import { ID } from '@vendure/common/lib/shared-types';
import {
    FacetService,
    FacetValue,
    FacetValueService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { normalizeIdentity } from './catalog-file-parser.service';
import { catalogCategoryPath } from './catalog-import-classification';
import { shortCode } from './catalog-import-helpers';
import { NormalizedCatalogRow } from './types';

interface CatalogFacetServices {
    connection: TransactionalConnection;
    facetService: FacetService;
    facetValueService: FacetValueService;
}

export async function resolveCatalogFacetValues(
    services: CatalogFacetServices,
    ctx: RequestContext,
    row: NormalizedCatalogRow,
): Promise<ID[]> {
    const values: ID[] = [];
    if (row.category) {
        values.push(
            await ensureFacetValue(
                services,
                ctx,
                'catalog-import-category',
                '导入分类标记',
                catalogCategoryPath(row),
                true,
            ),
        );
    }
    if (row.category) {
        values.push(
            await ensureFacetValue(
                services,
                ctx,
                'catalog-import-primary-category',
                '导入一级分类标记',
                row.category,
                true,
            ),
        );
    }
    if (row.brand) values.push(await ensureFacetValue(services, ctx, 'catalog-brand', '品牌', row.brand));
    for (const tag of row.tags)
        values.push(await ensureFacetValue(services, ctx, 'catalog-tag', '标签', tag));
    return values;
}

async function ensureFacetValue(
    services: CatalogFacetServices,
    ctx: RequestContext,
    facetCode: string,
    facetName: string,
    value: string,
    isPrivate = false,
): Promise<ID> {
    let facet = await services.facetService.findByCode(ctx, facetCode, ctx.languageCode);
    if (!facet) {
        facet = await services.facetService.create(ctx, {
            code: facetCode,
            isPrivate,
            translations: [{ languageCode: ctx.languageCode, name: facetName }],
        });
    }
    const existing = await services.connection.getRepository(ctx, FacetValue).find({
        where: { facet: { id: facet.id } },
        relations: ['translations'],
    });
    const match = existing.find(item =>
        item.translations.some(
            translation => normalizeIdentity(translation.name) === normalizeIdentity(value),
        ),
    );
    if (match) return match.id;
    const created = await services.facetValueService.create(ctx, facet, {
        facetId: facet.id,
        code: `${facetCode}-${shortCode(value)}`,
        translations: [{ languageCode: ctx.languageCode, name: value }],
    });
    return created.id;
}
