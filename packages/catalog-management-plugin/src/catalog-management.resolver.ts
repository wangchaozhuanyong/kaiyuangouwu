import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';

import { CatalogImportService } from './catalog-import.service';
import { CatalogOperationsService } from './catalog-operations.service';
import { CatalogSupplierService } from './catalog-supplier.service';
import {
    manageCatalogExportPermission,
    manageCatalogImportPermission,
    manageCatalogOperationsPermission,
    manageCatalogSupplierPermission,
} from './constants';
import {
    AppendCatalogImportRowsInput,
    BeginCatalogImportInput,
    CatalogImportAction,
    CatalogProductListOptions,
    CatalogProductSummaryFilterInput,
    CatalogSupplierListOptions,
    CreateCatalogProductInput,
    CreateCatalogProductVariantInput,
    CreateCatalogSupplierInput,
    ResolveCatalogImportRowInput,
    ResolveCatalogImportRowsInput,
    SaveCatalogProductInput,
    SaveInventoryLotInput,
    UpdateCatalogSupplierInput,
    UpdateCatalogVariantOperationsInput,
} from './types';

@Resolver()
export class CatalogManagementAdminResolver {
    constructor(
        private readonly imports: CatalogImportService,
        private readonly operations: CatalogOperationsService,
        private readonly suppliers: CatalogSupplierService,
    ) {}

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportJob(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.findJob(ctx, id);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportJobs(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.imports.findJobs(ctx, skip, take);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportRows(
        @Ctx() ctx: RequestContext,
        @Args('jobId') jobId: ID,
        @Args('action') action?: CatalogImportAction,
    ) {
        return this.imports.findRows(ctx, jobId, action);
    }

    @Query()
    @Allow(manageCatalogImportPermission.Read)
    catalogImportRowPage(
        @Ctx() ctx: RequestContext,
        @Args('jobId') jobId: ID,
        @Args('action') action?: CatalogImportAction,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.imports.findRowPage(ctx, jobId, action, skip, take);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogIntegritySummary(@Ctx() ctx: RequestContext) {
        return this.operations.integritySummary(ctx);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductCreationContext(@Ctx() ctx: RequestContext) {
        return this.operations.creationContext(ctx);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductWorkspace(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.operations.workspace(ctx, productId);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductSummaries(
        @Ctx() ctx: RequestContext,
        @Args('filter') filter?: CatalogProductSummaryFilterInput,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.operations.productSummaries(ctx, filter ?? {}, skip, take);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProducts(
        @Ctx() ctx: RequestContext,
        @Args('filter') filter?: CatalogProductSummaryFilterInput,
        @Args('options') options?: CatalogProductListOptions,
    ) {
        return this.operations.filteredProducts(ctx, filter ?? {}, options ?? {});
    }

    @Query()
    @Allow(manageCatalogExportPermission.Read, manageCatalogImportPermission.Read)
    catalogExportRows(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.operations.exportRows(ctx, skip, take);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSuppliers(@Ctx() ctx: RequestContext, @Args('options') options?: CatalogSupplierListOptions) {
        return this.suppliers.findAll(ctx, options ?? {});
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSupplier(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.suppliers.findOneWithLinkedCount(ctx, id);
    }

    @Query()
    @Allow(manageCatalogSupplierPermission.Read, manageCatalogImportPermission.Read)
    catalogSupplierVariants(
        @Ctx() ctx: RequestContext,
        @Args('supplierId') supplierId: ID,
        @Args('skip') skip?: number,
        @Args('take') take?: number,
    ) {
        return this.suppliers.linkedVariants(ctx, supplierId, skip, take);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    beginCatalogImport(@Ctx() ctx: RequestContext, @Args('input') input: BeginCatalogImportInput) {
        return this.imports.beginImport(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    appendCatalogImportRows(@Ctx() ctx: RequestContext, @Args('input') input: AppendCatalogImportRowsInput) {
        return this.imports.appendRows(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Create)
    finalizeCatalogImportPreview(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.finalizePreview(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    resolveCatalogImportRow(@Ctx() ctx: RequestContext, @Args('input') input: ResolveCatalogImportRowInput) {
        return this.imports.resolveRow(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    resolveCatalogImportRows(
        @Ctx() ctx: RequestContext,
        @Args('input') input: ResolveCatalogImportRowsInput,
    ) {
        return this.imports.resolveRows(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Update)
    executeCatalogImport(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.queueExecution(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogImportPermission.Delete)
    rollbackCatalogImport(@Ctx() ctx: RequestContext, @Args('id') id: ID) {
        return this.imports.rollback(ctx, id);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    updateCatalogVariantOperations(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogVariantOperationsInput,
    ) {
        return this.operations.updateVariant(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.CreateProduct,
        Permission.CreateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    createCatalogProductVariant(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateCatalogProductVariantInput,
    ) {
        return this.operations.createVariant(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.CreateProduct,
        Permission.CreateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    createCatalogProduct(@Ctx() ctx: RequestContext, @Args('input') input: CreateCatalogProductInput) {
        return this.operations.createProduct(ctx, input);
    }

    @Mutation()
    @Allow(
        Permission.UpdateProduct,
        Permission.UpdateCatalog,
        manageCatalogOperationsPermission.Update,
        manageCatalogImportPermission.Update,
    )
    saveCatalogProduct(@Ctx() ctx: RequestContext, @Args('input') input: SaveCatalogProductInput) {
        return this.operations.saveProduct(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogOperationsPermission.Update, manageCatalogImportPermission.Update)
    saveCatalogInventoryLot(@Ctx() ctx: RequestContext, @Args('input') input: SaveInventoryLotInput) {
        return this.operations.saveLot(ctx, input);
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Create)
    async createCatalogSupplier(
        @Ctx() ctx: RequestContext,
        @Args('input') input: CreateCatalogSupplierInput,
    ) {
        const supplier = await this.suppliers.create(ctx, input);
        return { ...supplier, linkedVariantCount: 0 };
    }

    @Mutation()
    @Allow(manageCatalogSupplierPermission.Update)
    async updateCatalogSupplier(
        @Ctx() ctx: RequestContext,
        @Args('input') input: UpdateCatalogSupplierInput,
    ) {
        const supplier = await this.suppliers.update(ctx, input);
        return this.suppliers.findOneWithLinkedCount(ctx, supplier.id);
    }
}
