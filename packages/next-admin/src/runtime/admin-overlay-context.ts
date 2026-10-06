import { createContext } from 'react';

/** Portal target follows its trigger's page, even when its provider belongs to the app shell. */
export const AdminOverlayContext = createContext<HTMLElement | null>(null);
