import { OrderLine, RequestContext } from '@vendure/core';
import { translateEntity } from '@vendure/core/dist/service/helpers/utils/translate-entity';

/** Order lifecycle events contain raw entities; GraphQL has not translated their names. */
export function orderLineProductName(ctx: RequestContext, line: OrderLine): string {
    const variant = line.productVariant;
    return variant.translations?.length
        ? translateEntity(variant, [ctx.languageCode, ctx.channel.defaultLanguageCode]).name
        : variant.name;
}
