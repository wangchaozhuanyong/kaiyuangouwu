import { createFileRoute, redirect } from '@tanstack/react-router';

// Preserve old links without showing the retired standalone announcements page.
export const Route = createFileRoute('/announcements')({
    beforeLoad: () => redirect({ to: '/', replace: true }),
});
