import React, { createContext, useContext } from 'react';
import { useMyPlayerSelector } from '../../../spacetime/hooks';
import { viewCellOf } from './chunks';

/**
 * The local player's view cell for the chunked world layers. Null outside a
 * game connection (the dev map review), which mounts every chunk.
 */
const ViewCellContext = createContext<string | null>(null);
export const useViewCell = () => useContext(ViewCellContext);

/** Provides your view cell; re-renders its children only when you cross a cell edge. */
export function PlayerViewCell({ children }: { children: React.ReactNode }) {
  const cell = useMyPlayerSelector(viewCellOf);
  return <ViewCellContext.Provider value={cell}>{children}</ViewCellContext.Provider>;
}
