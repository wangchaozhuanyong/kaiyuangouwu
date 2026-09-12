import { LanguageCode, PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions';
import { CatalogChannelAssignmentsService } from './catalog-channel-assignments.service';
import { CatalogFileParserService } from './catalog-file-parser.service';
import { CatalogImportCategoryService } from './catalog-import-category.service';
import { CatalogImportOptionsService } from './catalog-import-options.service';
import { CatalogImportQueueService } from './catalog-import-queue.service';
import { CatalogImportService } from './catalog-import.service';
import { CatalogManagementAdminResolver } from './catalog-management.resolver';
import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogProfitService } from './catalog-profit.service';
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
import { OrderProfitExpense } from './entities/order-profit-expense.entity';
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
        OrderProfitExpense,
        CatalogSupplier,
        CatalogVariantSupplier,
    ],
    providers: [
        CatalogChannelAssignmentsService,
        CatalogFileParserService,
        CatalogOperationsService,
        CatalogProfitService,
        CatalogImportService,
        CatalogImportCategoryService,
        CatalogImportOptionsService,
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '商品包装上的扫描码；没有条码可留空。它不是 SKU 内部编码。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Scannable code printed on the package. Leave blank when unavailable; this is not the internal SKU.',
                    },
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '给员工查看的规格说明，例如 500ml、红色 / XL；不会自动生成 SKU 组合。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Human-readable specification such as 500 ml or Red / XL; it does not generate SKU combinations.',
                    },
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '销售和库存展示使用的单位，例如瓶、盒、件。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Unit used for sales and stock display, for example bottle, box, or piece.',
                    },
                ],
                ui: { component: 'catalog-unit-input' },
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '向供应商进货时使用的单位，例如箱；只用于采购和换算。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Unit used when purchasing from a supplier, for example carton; used for purchasing and conversion.',
                    },
                ],
                ui: { component: 'catalog-unit-input' },
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '1 个采购单位包含多少个销售单位。例如 1 箱 = 12 瓶填 12；单位相同填 1。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Number of sale units in one purchase unit. Enter 12 for 1 carton = 12 bottles, or 1 when the units match.',
                    },
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
                description: [
                    {
                        languageCode: LanguageCode.zh_Hans,
                        value: '仅作为批次到期日的默认天数。新增库存批次并填写生产日期后自动计算到期日期；只填这里不能追踪现有库存何时过期。',
                    },
                    {
                        languageCode: LanguageCode.en,
                        value: 'Default days used to calculate a lot expiry date from its production date. This field alone cannot track when existing stock expires.',
                    },
                ],
            },
        );
        return config;
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [CatalogManagementAdminResolver],
    },
    compatibility: '^3.7.0',
})
export class CatalogManagementPlugin {}
