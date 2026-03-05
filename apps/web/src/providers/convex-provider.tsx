"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";
import { useConvexAuth } from "@/providers/auth-provider";
import { getConvexUrl } from "@/lib/runtime-config";

export const ConvexClientProvider = ({ children }: { children: ReactNode }) => {
  const client = useMemo(
    () => new ConvexReactClient(getConvexUrl() || "http://127.0.0.1:3210"),
    [],
  );

  return (
    <ConvexProviderWithAuth client={client} useAuth={useConvexAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
};
