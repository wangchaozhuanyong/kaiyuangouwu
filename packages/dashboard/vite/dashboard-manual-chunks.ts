export function dashboardManualChunks(id: string): string | undefined {
    const normalizedId = id.replace(/\\/g, '/');
    if (
        normalizedId.includes('/packages/dashboard/src/lib/components/data-table/') ||
        normalizedId.includes('/packages/dashboard/src/lib/framework/form-engine/') ||
        normalizedId.includes('/packages/dashboard/src/lib/components/shared/rich-text-editor/')
    ) {
        // These subsystems import one another, so keep them in one coherent
        // application chunk while separating them from the lazy route shell.
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
    if (normalizedId.includes('/node_modules/react-day-picker/')) {
        return 'vendor-calendar';
    }
    if (
        normalizedId.includes('/node_modules/date-fns/') ||
        normalizedId.includes('/node_modules/@date-fns/')
    ) {
        return 'vendor-date-fns';
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
