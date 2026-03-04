import { headers } from "next/headers";
import { getPublicRuntimeConfig } from "@/lib/runtime-config";

export const RuntimeConfig = async () => {
  // Make config injection request-time, not build-time static HTML.
  await headers();
  const config = getPublicRuntimeConfig();

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__CLAWE_CONFIG__=${JSON.stringify(config)}`,
      }}
    />
  );
};
