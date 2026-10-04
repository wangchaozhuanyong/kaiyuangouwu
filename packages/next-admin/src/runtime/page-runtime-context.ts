import { createContext } from 'react';

export const PageRuntimeContext = createContext<{ page: string; active: boolean } | null>(null);
