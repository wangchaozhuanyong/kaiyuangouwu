import { createContext } from 'react';

/** Open pages retain their state when another tab becomes active. */
export const TabPageContext = createContext<{
    path: string;
    basename: string;
    active: boolean;
} | null>(null);
