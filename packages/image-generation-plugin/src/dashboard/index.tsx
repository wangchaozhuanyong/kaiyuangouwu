import { defineDashboardExtension } from '@vendure/dashboard';

import { imageGenerationAccessRoute, imageGenerationSettingsRoute } from './image-generation-pages';

defineDashboardExtension({
    routes: [imageGenerationSettingsRoute, imageGenerationAccessRoute],
});
