import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

export default defineConfig({
    sourceLocale: 'en',
    format: formatter({ lineNumbers: false }),
    locales: ['en', 'zh_Hans'],
    orderBy: 'messageId',
    catalogs: [
        {
            path: '<rootDir>/src/dashboard/i18n/{locale}',
            include: ['<rootDir>/src/dashboard'],
            exclude: ['<rootDir>/src/dashboard/**/*.{spec,test}.ts'],
        },
    ],
});
