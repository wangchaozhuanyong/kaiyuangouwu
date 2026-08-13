import { defineDashboardExtension } from '@vendure/dashboard';

import { FormInputsTestPage } from './form-inputs-test-page';
import { OverlayLayeringTestPage } from './overlay-layering-test-page';

defineDashboardExtension({
    routes: [
        {
            path: '/form-inputs-test',
            component: () => <FormInputsTestPage />,
        },
        {
            path: '/overlay-layering-test',
            component: () => <OverlayLayeringTestPage />,
        },
    ],
});
