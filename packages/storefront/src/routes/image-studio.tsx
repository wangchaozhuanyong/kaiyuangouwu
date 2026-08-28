import { createFileRoute } from '@tanstack/react-router';

import { ImageStudioRoutePage } from '../route-pages/content-route-pages';

export const Route = createFileRoute('/image-studio')({ component: ImageStudioRoutePage });
