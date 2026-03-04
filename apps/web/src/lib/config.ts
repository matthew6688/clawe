import {
  getAuthProvider,
  getClaweEdition,
  getConvexUrl,
} from "@/lib/runtime-config";

export const config = {
  get isCloud() {
    return getClaweEdition() === "cloud";
  },
  get authProvider() {
    return getAuthProvider();
  },
  get convexUrl() {
    return getConvexUrl();
  },
} as const;
