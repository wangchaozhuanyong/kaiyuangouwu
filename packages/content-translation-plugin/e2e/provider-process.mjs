// Invoked only by the isolated PostgreSQL acceptance test. Never reads application credentials.
import 'reflect-metadata';
import { DataSource } from 'typeorm';

import { TranslationProviderState } from '../dist/entities/translation-provider-state.entity.js';
import { TranslationExecutionService } from '../dist/translation-execution.service.js';

if (process.env.TRANSLATION_TEST_POSTGRES !== '1') throw new Error('Local PostgreSQL fixture required');
const db = await new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: 15492,
    username: 'postgres',
    database: 'translation_outbox_e2e',
    schema: 'outbox_process_test',
    entities: [TranslationProviderState],
}).initialize();
try {
    const service = new TranslationExecutionService(
        { rawConnection: db },
        {
            provider: {
                name: 'process-test',
                isConfigured: () => true,
                translate: async () => {
                    await db.query('INSERT INTO outbox_process_test.provider_request DEFAULT VALUES');
                    process.send?.('provider-started');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return { provider: 'process-test', translations: [] };
                },
            },
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
            glossary: {},
        },
    );
    try {
        await service.translate({
            sourceLanguageCode: 'zh_Hans',
            targetLanguageCode: 'en',
            segments: [{ key: 'name', text: '服务' }],
        });
        process.send?.('completed');
    } catch (error) {
        process.send?.(error.code ?? 'error');
    }
} finally {
    await db.destroy();
}
