import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    PUBLIC_PRODUCT_SUMMARY_READER,
    type PublicProductSummaryReader,
    type RequestContext,
} from '@vendure/core';
import type { PublicCatalogReader } from '@vendure/store-management-plugin';

import { StorefrontCatalogService } from './storefront-catalog.service';

@Injectable()
export class PublicCatalogReaderService implements PublicCatalogReader {
    constructor(
        private readonly catalog: StorefrontCatalogService,
        private readonly modules: ModuleRef,
    ) {}
    async find(ctx: RequestContext, input: Parameters<PublicCatalogReader['find']>[1]) {
        const page = await this.catalog.find(ctx, input);
        const reader = this.modules.get<PublicProductSummaryReader>(PUBLIC_PRODUCT_SUMMARY_READER, {
            strict: false,
        });
        return { items: await reader.project(ctx, page.items), totalItems: page.totalItems };
    }
}
