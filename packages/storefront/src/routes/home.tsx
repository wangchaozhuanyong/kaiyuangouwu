import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/home')({
    beforeLoad: () => redirect({ to: '/', replace: true }),
});
