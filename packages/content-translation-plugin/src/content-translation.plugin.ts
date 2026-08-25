import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api-extensions.js';
import { CONTENT_TRANSLATION_OPTIONS } from './constants.js';
import { ContentTranslationAdminResolver } from './content-translation.resolver.js';
import { ContentTranslationService } from './content-translation.service.js';
import { ContentTranslationState } from './entities/content-translation-state.entity.js';
import { NativeContentTranslationService } from './native-content-translation.service.js';
import { UnavailableTranslationProvider } from './providers/unavailable-translation.provider.js';
import { ContentTranslationPluginOptions } from './types.js';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ContentTranslationState],
    providers: [
        ContentTranslationService,
        NativeContentTranslationService,
        {
            provide: CONTENT_TRANSLATION_OPTIONS,
            useFactory: () => ContentTranslationPlugin.options,
        },
    ],
    exports: [ContentTranslationService],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ContentTranslationAdminResolver],
    },
    compatibility: '^3.7.0',
})
export class ContentTranslationPlugin {
    static options: Required<ContentTranslationPluginOptions> = {
        provider: new UnavailableTranslationProvider(),
        glossary: {},
        sourceLanguageCode: 'zh_Hans',
        targetLanguageCode: 'en',
    };

    static init(options: ContentTranslationPluginOptions = {}): typeof ContentTranslationPlugin {
        this.options = {
            provider: options.provider ?? new UnavailableTranslationProvider(),
            glossary: options.glossary ?? {},
            sourceLanguageCode: options.sourceLanguageCode ?? 'zh_Hans',
            targetLanguageCode: options.targetLanguageCode ?? 'en',
        };
        return ContentTranslationPlugin;
    }
}
