import { Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, ProvinceService, RequestContext } from '@vendure/core';

@Resolver()
export class StorefrontRegionShopResolver {
    constructor(private readonly provinceService: ProvinceService) {}

    @Query()
    @Allow(Permission.Public)
    async availableStorefrontProvinces(@Ctx() ctx: RequestContext) {
        const result = await this.provinceService.findAll(
            ctx,
            {
                take: 500,
                filter: { enabled: { eq: true } },
            },
            ['parent'],
        );

        return result.items
            .flatMap(province => {
                const country = province.parent;
                if (country?.type !== 'country' || !country.enabled) return [];
                return [{ code: province.code, name: province.name, countryCode: country.code }];
            })
            .sort(
                (left, right) =>
                    left.countryCode.localeCompare(right.countryCode) || left.name.localeCompare(right.name),
            );
    }
}
