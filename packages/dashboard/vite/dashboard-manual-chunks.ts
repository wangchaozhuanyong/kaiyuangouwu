const dashboardDateLocales = new Set([
    'ar',
    'bg',
    'cs',
    'de',
    'es',
    'fa-IR',
    'fr',
    'he',
    'hr',
    'hu',
    'it',
    'ja',
    'ko',
    'nb',
    'nl',
    'pl',
    'pt',
    'pt-BR',
    'ro',
    'ru',
    'sv',
    'tr',
    'uk',
    'uz',
    'zh-CN',
    'zh-TW',
]);

export function dashboardManualChunks(id: string): string | undefined {
    const normalizedId = id.replace(/\\/g, '/');
    if (
        normalizedId.includes('/packages/dashboard/src/lib/components/data-table/') ||
        normalizedId.includes('/packages/dashboard/src/lib/framework/form-engine/') ||
        normalizedId.includes('/packages/dashboard/src/lib/components/shared/rich-text-editor/')
    ) {
        // These subsystems import one another, so keep their application code
        // together while their heavy third-party dependencies are split below.
        return 'dashboard-framework';
    }
    if (normalizedId.includes('/node_modules/@vendure-io/ui/src/components/ui/chart.')) {
        return 'vendor-charts';
    }
    if (
        normalizedId.includes('/node_modules/@tiptap/') ||
        normalizedId.includes('/node_modules/prosemirror-')
    ) {
        return 'vendor-rich-text';
    }
    if (normalizedId.includes('/node_modules/recharts/') || normalizedId.includes('/node_modules/d3-')) {
        return 'vendor-charts';
    }
    const calendarLocale = normalizedId.match(
        /\/node_modules\/react-day-picker\/dist\/(?:esm|cjs)\/locale\/([^/]+)\.(?:js|mjs|cjs)$/,
    )?.[1];
    if (calendarLocale) {
        return 'vendor-calendar-locale-' + calendarLocale.toLowerCase();
    }
    if (normalizedId.includes('/node_modules/react-day-picker/')) {
        return 'vendor-calendar';
    }
    const dateFnsLocale = normalizedId
        .match(/\/node_modules\/date-fns\/locale\/([^/]+)/)?.[1]
        ?.replace(/\.js$/, '');
    if (dateFnsLocale === '_lib' || dateFnsLocale === 'en-US') {
        return 'vendor-date-fns';
    }
    if (dateFnsLocale && dashboardDateLocales.has(dateFnsLocale)) {
        return 'vendor-calendar-locale-' + dateFnsLocale.toLowerCase();
    }
    if (dateFnsLocale) {
        // Do not name locales the Dashboard does not support. Rollup can then
        // tree-shake re-exports from the date-fns locale barrel without
        // emitting empty chunks.
        return undefined;
    }
    if (
        normalizedId.includes('/node_modules/date-fns/') ||
        normalizedId.includes('/node_modules/@date-fns/')
    ) {
        return 'vendor-date-fns';
    }
    if (
        normalizedId.includes('/node_modules/zod/') ||
        normalizedId.includes('/node_modules/react-hook-form/') ||
        normalizedId.includes('/node_modules/@hookform/resolvers/') ||
        normalizedId.includes('/node_modules/@dnd-kit/') ||
        normalizedId.includes('/node_modules/react-dropzone/') ||
        normalizedId.includes('/node_modules/file-selector/') ||
        normalizedId.includes('/node_modules/attr-accept/') ||
        normalizedId.includes('/node_modules/json-edit-react/') ||
        normalizedId.includes('/node_modules/@uidotdev/usehooks/')
    ) {
        return 'vendor-dashboard-support';
    }
    if (normalizedId.includes('/node_modules/lucide-react/')) {
        return 'vendor-icons';
    }
    if (normalizedId.includes('/node_modules/react-resizable-panels/')) {
        return 'vendor-panels';
    }
    if (normalizedId.includes('/node_modules/embla-carousel')) {
        return 'vendor-carousel';
    }
    if (
        normalizedId.includes('/node_modules/cmdk/') ||
        normalizedId.includes('/node_modules/input-otp/') ||
        normalizedId.includes('/node_modules/vaul/')
    ) {
        return 'vendor-ui';
    }
    if (
        normalizedId.includes('/node_modules/graphql/') ||
        normalizedId.includes('/node_modules/gql.tada/') ||
        normalizedId.includes('/node_modules/awesome-graphql-client/')
    ) {
        return 'vendor-graphql';
    }
    if (normalizedId.includes('/node_modules/@base-ui/')) {
        return 'vendor-ui';
    }
    if (normalizedId.includes('/node_modules/@vendure-io/ui/')) {
        return 'vendor-ui';
    }
    if (normalizedId.includes('/node_modules/@tanstack/')) {
        return 'vendor-tanstack';
    }
    if (
        normalizedId.includes('/node_modules/motion/') ||
        normalizedId.includes('/node_modules/framer-motion/')
    ) {
        return 'vendor-motion';
    }
}
