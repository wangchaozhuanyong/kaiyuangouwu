import { describe, expect, it, vi } from 'vitest';

import { RestrictContentLanguages1787662800000 } from './1787662800000-restrict-content-languages';

describe('RestrictContentLanguages1787662800000', () => {
    it('restricts PostgreSQL global and channel languages without deleting translations', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'postgres' } },
            query,
        } as any;

        await new RestrictContentLanguages1787662800000().up(queryRunner);

        expect(query).toHaveBeenNthCalledWith(1, `UPDATE "global_settings" SET "availableLanguages" = $1`, [
            'en,zh_Hans',
        ]);
        expect(query.mock.calls[1][0]).toContain(`"availableLanguageCodes" = $1`);
        expect(query.mock.calls[1][0]).toContain(`"defaultLanguageCode" = 'zh_Hans'`);
        expect(query.mock.calls[1][1]).toEqual(['en,zh_Hans']);
        expect(query.mock.calls[2][0]).toContain(`SET "name" = '默认商家'`);
    });

    it('enables ANSI quotes and uses MySQL placeholders', async () => {
        const query = vi.fn().mockResolvedValue(undefined);
        const queryRunner = {
            connection: { options: { type: 'mysql' } },
            query,
        } as any;

        await new RestrictContentLanguages1787662800000().up(queryRunner);

        expect(query).toHaveBeenNthCalledWith(
            1,
            `SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'ANSI_QUOTES')`,
        );
        expect(query).toHaveBeenNthCalledWith(2, `UPDATE "global_settings" SET "availableLanguages" = ?`, [
            'en,zh_Hans',
        ]);
        expect(query.mock.calls[2][0]).toContain(`"availableLanguageCodes" = ?`);
        expect(query.mock.calls[3][0]).toContain(`WHERE "name" = 'Default Seller'`);
    });
});
