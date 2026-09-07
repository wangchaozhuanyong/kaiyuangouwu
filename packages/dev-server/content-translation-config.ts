import {
    AzureTranslationProvider,
    ContentTranslationPluginOptions,
    GoogleCloudTranslationProvider,
    MyMemoryTranslationProvider,
} from '@vendure/content-translation-plugin';

export function contentTranslationOptions(
    apiKey: string,
    env: NodeJS.ProcessEnv,
): ContentTranslationPluginOptions {
    return {
        provider: new GoogleCloudTranslationProvider({ apiKey }),
        fallbackProviders: [
            ...(env.VENDURE_TRANSLATION_FALLBACK_AZURE === 'true'
                ? [
                      new AzureTranslationProvider({
                          apiKey: env.VENDURE_AZURE_TRANSLATION_API_KEY ?? '',
                          region: env.VENDURE_AZURE_TRANSLATION_REGION,
                      }),
                  ]
                : []),
            ...(env.VENDURE_TRANSLATION_FALLBACK_MYMEMORY === 'true'
                ? [
                      new MyMemoryTranslationProvider({
                          contactEmail: env.VENDURE_MYMEMORY_CONTACT_EMAIL,
                      }),
                  ]
                : []),
        ],
        glossary: {
            模钥: 'MOYAO AI',
            'ChatGPT- plus': 'ChatGPT Plus',
            ChatGPT: 'ChatGPT',
            Codex: 'Codex',
        },
    };
}
