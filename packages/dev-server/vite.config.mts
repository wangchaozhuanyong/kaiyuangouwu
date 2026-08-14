import { LanguageCode } from '@vendure/common/lib/generated-types';
import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import path from 'path';
import { pathToFileURL } from 'url';
import { defineConfig } from 'vite';

import { DASHBOARD_API_PORT_FROM_PAGE } from './scripts/dev-network-config.mjs';

export default defineConfig(({ mode }) => {
    const isProduction = mode === 'production';
    const adminApiHost = process.env.VITE_ADMIN_API_HOST || (isProduction ? 'auto' : 'http://localhost');
    const adminApiPort = process.env.VITE_ADMIN_API_PORT
        ? process.env.VITE_ADMIN_API_PORT === DASHBOARD_API_PORT_FROM_PAGE
            ? DASHBOARD_API_PORT_FROM_PAGE
            : Number(process.env.VITE_ADMIN_API_PORT)
        : process.env.VITE_ADMIN_API_HOST || isProduction
          ? DASHBOARD_API_PORT_FROM_PAGE
          : Number(process.env.API_PORT) || 3000;

    return {
        base: '/dashboard/',
        server: {
            host: process.env.HOST || '127.0.0.1',
            port: Number(process.env.PORT) || 5173,
            strictPort: true,
        },
        build: {
            outDir: './dist/dashboard',
        },
        plugins: [
            vendureDashboardPlugin({
                vendureConfigPath: pathToFileURL('./dev-config.ts'),
                api: {
                    host: adminApiHost,
                    port: adminApiPort,
                },
                i18n: {
                    defaultLanguage: LanguageCode.zh_Hans,
                    defaultLocale: 'CN',
                    availableLanguages: [LanguageCode.zh_Hans, LanguageCode.en],
                    availableLocales: ['CN', 'MY'],
                },
                pluginPackageScanner: {
                    nodeModulesRoot: path.resolve(__dirname, '../../node_modules'),
                },
                pathAdapter: {
                    sourceRoot: path.resolve(__dirname, '../..'),
                    getCompiledConfigPath: ({ outputPath, configFileName }) =>
                        path.join(outputPath, 'packages/dev-server', configFileName),
                    transformTsConfigPathMappings: ({ phase, patterns }) =>
                        phase === 'loading'
                            ? patterns.map(pattern =>
                                  path
                                      .join('packages/dev-server', pattern)
                                      .replace(/\.tsx?$/, '.js')
                                      .replaceAll('\\', '/'),
                              )
                            : patterns,
                },
                gqlOutputPath: path.resolve(__dirname, './graphql/'),
            }),
        ],
    };
});
