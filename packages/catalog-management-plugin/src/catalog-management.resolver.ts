import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@vendure/common/lib/generated-types';
import { Allow, Ctx, ID, RequestContext } from '@vendure/core';

import { CatalogImportService } from './catalog-import.service';
import { CatalogOperationsService } from './catalog-operations.service';
import {
    manageCatalogExportPermission,
    manageCatalogImportPermission,
    manageCatalogOperationsPermission,
} from './constants';
import {
    AppendCatalogImportRowsInput,
    BeginCatalogImportInput,
    CatalogImportAction,
    CatalogProductSummaryFilterInput,
    ResolveCatalogImportRowInput,
    ResolveCatalogImportRowsInput,
    SaveCatalogProductInput,
    SaveInventoryLotInput,
    UpdateCatalogVariantOperationsInput,
} from './types';

@Resolver()
export class CatalogManagementAdminResolver {
    constructor(
        private readonly imports: CatalogImportService,
        private readonly operations: CatalogOperationsService,
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
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductWorkspace(@Ctx() ctx: RequestContext, @Args('productId') productId: ID) {
        return this.operations.workspace(ctx, productId);
    }

    @Query()
    @Allow(manageCatalogOperationsPermission.Read, manageCatalogImportPermission.Read)
    catalogProductSummaries(
        @Ctx() ctx: RequestContext,
        @Args('filter') filter?: CatalogProductSummaryFilterInput,
    ) {
        return this.operations.productSummaries(ctx, filter ?? {});
    }

    @Query()
    @Allow(manageCatalogExportPermission.Read, manageCatalogImportPermission.Read)
    catalogExportRows(@Ctx() ctx: RequestContext, @Args('skip') skip?: number, @Args('take') take?: number) {
        return this.operations.exportRows(ctx, skip, take);
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
}
