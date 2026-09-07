import { Query, Resolver } from '@nestjs/graphql';
import { SortOrder } from '@vendure/common/lib/generated-types';
import { Allow, CountryService, Ctx, Permission, ProvinceService, RequestContext } from '@vendure/core';

@Resolver()
export class StorefrontRegionShopResolver {
    constructor(
        private readonly provinceService: ProvinceService,
        private readonly countryService: CountryService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    async availableStorefrontProvinces(@Ctx() ctx: RequestContext) {
        const countries = new Map(
            (await this.countryService.findAllAvailable(ctx)).map(country => [
                String(country.id),
                country.code,
            ]),
        );
        const options: Array<{ code: string; name: string; countryCode: string }> = [];
        let skip = 0;
        while (true) {
            // Omitting take lets ProvinceService use the configured public API limit.
            const result = await this.provinceService.findAll(ctx, {
                skip,
                sort: { id: SortOrder.ASC },
                filter: { enabled: { eq: true } },
            });

            for (const province of result.items) {
                const countryCode = countries.get(String(province.parentId));
                if (countryCode) {
                    options.push({ code: province.code, name: province.name, countryCode });
                }
            }
            skip += result.items.length;
            if (result.items.length === 0 || skip >= result.totalItems) break;
        }

        return options.sort(
            (left, right) =>
                left.countryCode.localeCompare(right.countryCode) || left.name.localeCompare(right.name),
        );
    }
}
