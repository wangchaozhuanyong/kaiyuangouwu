import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, PluginCommonModule, RequestContext, VendurePlugin } from '@vendure/core';

import { ShopAbuseStore } from '../abuse-protection/store';

import { adminSchema } from './api-extensions';
import { ADDRESS_TOOL_ORIGIN, TaxFreeAddressController } from './controller';
import { TaxFreeAddressEntity, TaxFreeAddressFingerprint, TaxFreeAddressPool } from './entities';
import { adminAddressOperation, TaxFreeAddressService } from './service';

@Resolver()
export class TaxFreeAddressAdminResolver {
    constructor(private readonly service: TaxFreeAddressService) {}
    @Query()
    @Allow(Permission.SuperAdmin)
    taxFreeAddresses(
        @Args('input') input?: { status?: string; keyword?: string; skip?: number; take?: number },
    ) {
        return adminAddressOperation(this.service.list(input ?? {}));
    }
    @Mutation()
    @Allow(Permission.SuperAdmin)
    generateTaxFreeAddresses(@Args('count') count: number) {
        return adminAddressOperation(this.service.generateAdmin(count));
    }
    @Mutation()
    @Allow(Permission.SuperAdmin)
    takeTaxFreeAddress(
        @Ctx() ctx: RequestContext,
        @Args('id') id: string,
        @Args('requestId') requestId: string,
    ) {
        return adminAddressOperation(this.service.claimAdmin(ctx, requestId, id));
    }
    @Mutation()
    @Allow(Permission.SuperAdmin)
    clearUsedTaxFreeAddresses(@Args('expectedRevision') expectedRevision: number) {
        return adminAddressOperation(this.service.clearUsed(expectedRevision));
    }
}
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [TaxFreeAddressEntity, TaxFreeAddressFingerprint, TaxFreeAddressPool],
    providers: [
        TaxFreeAddressService,
        ShopAbuseStore,
        { provide: ADDRESS_TOOL_ORIGIN, useFactory: () => TaxFreeAddressPlugin.origin },
    ],
    controllers: [TaxFreeAddressController],
    adminApiExtensions: { schema: adminSchema, resolvers: [TaxFreeAddressAdminResolver] },
    compatibility: '^3.7.0',
})
export class TaxFreeAddressPlugin {
    static origin: URL | null = null;

    static init(origin: string): typeof TaxFreeAddressPlugin {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
            throw new Error('Address tool must use a separate HTTPS origin');
        }
        this.origin = parsed;
        return this;
    }
}
