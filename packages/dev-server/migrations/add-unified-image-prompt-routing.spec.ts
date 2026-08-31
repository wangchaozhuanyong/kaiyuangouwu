import { DataSource, Table } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { AddUnifiedImagePromptRouting1787907600000 } from './1787907600000-add-unified-image-prompt-routing';

describe('unified image prompt routing migration', () => {
    it('creates an AUTO singleton and separates the Responses orchestration model', async () => {
        const dataSource = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
        await dataSource.initialize();
        const queryRunner = dataSource.createQueryRunner();
        try {
            await queryRunner.createTable(
                new Table({
                    name: 'image_provider_credential',
                    columns: [
                        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true },
                        { name: 'scope', type: 'varchar', length: '24' },
                        { name: 'textModelId', type: 'varchar', length: '160', default: "''" },
                    ],
                }),
            );
            await queryRunner.query(
                `INSERT INTO image_provider_credential (scope, textModelId)
                 VALUES ('OPENAI', 'gpt-orchestrator'), ('GEMINI', 'gemini-text')`,
            );

            const migration = new AddUnifiedImagePromptRouting1787907600000();
            await migration.up(queryRunner);
            await migration.up(queryRunner);

            await expect(queryRunner.hasTable('image_prompt_routing_config')).resolves.toBe(true);
            const routingRows = (await queryRunner.query(
                'SELECT singletonKey, strategy, fallbackEnabled FROM image_prompt_routing_config',
            )) as Array<{ singletonKey: string; strategy: string; fallbackEnabled: number }>;
            expect(routingRows).toEqual([{ singletonKey: 'GLOBAL', strategy: 'AUTO', fallbackEnabled: 0 }]);
            const credentialRows = (await queryRunner.query(
                'SELECT scope, orchestrationModelId FROM image_provider_credential ORDER BY id',
            )) as Array<{ scope: string; orchestrationModelId: string }>;
            expect(credentialRows).toEqual([
                { scope: 'OPENAI', orchestrationModelId: 'gpt-orchestrator' },
                { scope: 'GEMINI', orchestrationModelId: '' },
            ]);
        } finally {
            await queryRunner.release();
            await dataSource.destroy();
        }
    });
});
