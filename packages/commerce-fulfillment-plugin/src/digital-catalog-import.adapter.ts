import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import type { NormalizedCatalogRow } from '@vendure/catalog-management-plugin';
import { CatalogOperationsService } from '@vendure/catalog-management-plugin';
import { ID, RequestContext, UserInputError } from '@vendure/core';

import { DigitalProductService } from './digital-product.service';

@Injectable()
export class DigitalCatalogImportAdapter implements OnApplicationBootstrap {
    constructor(
        private readonly catalog: CatalogOperationsService,
        private readonly products: DigitalProductService,
    ) {}
    onApplicationBootstrap() {
        this.catalog.registerDigitalImportAdapter({
            read: async (ctx: RequestContext, id: ID) => {
                const config = await this.products.config(ctx, id);
                return config
                    ? {
                          digitalAvailableQuantity: config.availableQuantity,
                          digitalDeliveryMode: config.deliveryMode,
                          digitalStockPolicy: config.stockPolicy,
                      }
                    : null;
            },
            write: async (ctx: RequestContext, id: ID, row: NormalizedCatalogRow, expected?: number) => {
                const config = await this.products.config(ctx, id);
                if (!config) throw new UserInputError('旧数字商品需要先核对迁移，不能通过导入直接切换库存');
                return this.products.update(ctx, {
                    productVariantId: id,
                    deliveryMode: row.digitalDeliveryMode ?? config.deliveryMode,
                    stockPolicy: row.digitalStockPolicy ?? config.stockPolicy,
                    ...(row.digitalAvailableQuantity != null
                        ? {
                              availableQuantity: row.digitalAvailableQuantity,
                              expectedAvailableQuantity: expected ?? 0,
                          }
                        : {}),
                });
            },
        });
    }
}
