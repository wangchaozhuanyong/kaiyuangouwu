import type { StorefrontContentBlock, StorefrontLanguageCode } from '../../graphql/storefront.graphql';
import { StorefrontDecorationPreview } from './StorefrontDecorationPreview';

export function BlockPreview(props: { block: StorefrontContentBlock; language: StorefrontLanguageCode }) {
    return <StorefrontDecorationPreview {...props} />;
}
