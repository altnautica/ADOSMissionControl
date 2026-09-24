"use client";

/**
 * @module use-convex-available
 * @description Whether a Convex backend is configured for this build. The app
 * provider sets the value once; hooks and components read it to skip every
 * real call in local-only mode. A leaf module, so hooks never import the app
 * provider that mounts them.
 * @license GPL-3.0-only
 */

import { createContext, useContext } from "react";

export const ConvexAvailableContext = createContext(false);

export const useConvexAvailable = (): boolean => useContext(ConvexAvailableContext);
