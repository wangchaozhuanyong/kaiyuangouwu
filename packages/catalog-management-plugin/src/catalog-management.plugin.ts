import { LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { CatalogFileParserService } from './catalog-file-parser.service';
import { CatalogImportQueueService } from './catalog-import-queue.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogManagementAdminResolver } from './catalog-management.resolver';
import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogSupplierService } from './catalog-supplier.service';
import {
    manageCatalogExportPermission,
    manageCatalogImportPermission,
    manageCatalogOperationsPermission,
    manageCatalogSupplierPermission,
} from './constants';
import { CatalogImportJob } from './entities/catalog-import-job.entity';
import { CatalogImportRow } from './entities/catalog-import-row.entity';
import { CatalogSourceBinding } from './entities/catalog-source-binding.entity';
import { CatalogSupplier } from './entities/catalog-supplier.entity';
import { CatalogVariantSupplier } from './entities/catalog-variant-supplier.entity';
import { InventoryLotMovement } from './entities/inventory-lot-movement.entity';
import { InventoryLot } from './entities/inventory-lot.entity';
import { InventoryPolicy } from './entities/inventory-policy.entity';
import { VariantCostRecord } from './entities/variant-cost-record.entity';
import { InventoryLotLifecycleService } from './inventory-lot-lifecycle.service';
import './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [
        CatalogImportJob,
        CatalogImportRow,
        CatalogSourceBinding,
        VariantCostRecord,
        InventoryPolicy,
        InventoryLot,
        InventoryLotMovement,
        CatalogSupplier,
        CatalogVariantSupplier,
    ],
    providers: [
        CatalogFileParserService,
        CatalogOperationsService,
        CatalogImportService,
        CatalogImportQueueService,
        InventoryLotLifecycleService,
        CatalogSupplierService,
    ],
    configuration: config => {
        config.authOptions.customPermissions.push(
            manageCatalogImportPermission,
            manageCatalogOperationsPermission,
            manageCatalogExportPermission,
            manageCatalogSupplierPermission,
        );
        config.customFields.Product.push({
            name: 'sourceCreatedAt',
            type: 'datetime',
            nullable: true,
            public: false,
            ui: { component: 'date-form-input' },
            label: [
                { languageCode: LanguageCode.zh_Hans, value: '来源创建日期' },
                { languageCode: LanguageCode.en, value: 'Source created at' },
            ],
            description: [
                { languageCode: LanguageCode.zh_Hans, value: '来源报表中的创建日期，不覆盖系统创建时间' },
                {
                    languageCode: LanguageCode.en,
                    value: 'Source document date; system createdAt remains unchanged',
                },
            ],
        });
        config.customFields.ProductVariant.push(
            {
                name: 'barcode',
                type: 'string',
                nullable: true,
                public: true,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '商品条码' },
                    { languageCode: LanguageCode.en, value: 'Barcode' },
                ],
            },
            {
                name: 'specification',
                type: 'string',
                nullable: true,
                public: true,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '规格' },
                    { languageCode: LanguageCode.en, value: 'Specification' },
                ],
            },
            {
                name: 'saleUnit',
                type: 'string',
                nullable: true,
                public: true,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '销售单位' },
                    { languageCode: LanguageCode.en, value: 'Sale unit' },
                ],
            },
            {
                name: 'purchaseUnit',
                type: 'string',
                nullable: true,
                public: false,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '采购单位' },
                    { languageCode: LanguageCode.en, value: 'Purchase unit' },
                ],
            },
            {
                name: 'packageQuantity',
                type: 'float',
                nullable: true,
                defaultValue: 1,
                min: 0.001,
                public: true,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '包装换算数量' },
                    { languageCode: LanguageCode.en, value: 'Package conversion quantity' },
                ],
            },
            {
                name: 'shelfLifeDays',
                type: 'int',
                nullable: true,
                min: 0,
                public: true,
                label: [
                    { languageCode: LanguageCode.zh_Hans, value: '默认保质期（天）' },
                    { languageCode: LanguageCode.en, value: 'Default shelf life (days)' },
                ],
            },
        );
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [CatalogManagementAdminResolver],
    },
    dashboard: '../src/dashboard/index.tsx',
    compatibility: '^3.7.0',
})
export class CatalogManagementPlugin {}
