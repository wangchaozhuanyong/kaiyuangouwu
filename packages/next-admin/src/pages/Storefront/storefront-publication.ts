import { isUsableEnglishTranslation } from '../../../../common/src/translation-validation';
import { createContentPublicationChecker } from '../../../../storefront-content-plugin/src/content-publication';
export { contentPublicationLabels } from '../../../../storefront-content-plugin/src/content-publication';
export const contentPublicationStatus = createContentPublicationChecker(isUsableEnglishTranslation);
