type AuthProvider = "nextauth" | "cognito";
type ClaweEdition = "oss" | "cloud";

export interface ClaweConfig {
  convexUrl: string;
  authProvider: AuthProvider;
  autoLoginEmail: string | null;
  claweEdition: ClaweEdition;
}

declare global {
  interface Window {
    __CLAWE_CONFIG__?: ClaweConfig;
  }
}

function getClientRuntimeConfig(): ClaweConfig | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.__CLAWE_CONFIG__;
}

export function getServerEnvValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const rawValue = process.env[key];
    if (typeof rawValue !== "string") continue;

    const value = rawValue.trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

function parseAuthProvider(value: string | undefined): AuthProvider {
  if (value === "cognito") {
    return "cognito";
  }
  return "nextauth";
}

function parseClaweEdition(value: string | undefined): ClaweEdition {
  if (value === "cloud") {
    return "cloud";
  }
  return "oss";
}

function mapHostDockerInternal(url: string): string {
  if (!url || !url.includes("host.docker.internal")) {
    return url;
  }

  const hostname =
    typeof window !== "undefined" && window.location.hostname
      ? window.location.hostname
      : "localhost";

  return url.replace("host.docker.internal", hostname);
}

export function getServerRuntimeConfig(): ClaweConfig {
  return {
    convexUrl: getServerEnvValue("CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL") || "",
    authProvider: parseAuthProvider(
      getServerEnvValue("AUTH_PROVIDER", "NEXT_PUBLIC_AUTH_PROVIDER"),
    ),
    autoLoginEmail:
      getServerEnvValue("AUTO_LOGIN_EMAIL", "NEXT_PUBLIC_AUTO_LOGIN_EMAIL") ||
      null,
    claweEdition: parseClaweEdition(
      getServerEnvValue("CLAWE_EDITION", "NEXT_PUBLIC_CLAWE_EDITION"),
    ),
  };
}

export function getPublicRuntimeConfig(): ClaweConfig {
  return {
    convexUrl: mapHostDockerInternal(
      getServerEnvValue("NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL") || "",
    ),
    authProvider: parseAuthProvider(
      getServerEnvValue("NEXT_PUBLIC_AUTH_PROVIDER", "AUTH_PROVIDER"),
    ),
    autoLoginEmail:
      getServerEnvValue("NEXT_PUBLIC_AUTO_LOGIN_EMAIL", "AUTO_LOGIN_EMAIL") ||
      null,
    claweEdition: parseClaweEdition(
      getServerEnvValue("NEXT_PUBLIC_CLAWE_EDITION", "CLAWE_EDITION"),
    ),
  };
}

export function getConvexUrl(): string {
  // Server-side: read env directly
  if (typeof window === "undefined") {
    return getServerRuntimeConfig().convexUrl;
  }

  // Client-side: read from injected script tag, fall back to build-time env
  return mapHostDockerInternal(
    getClientRuntimeConfig()?.convexUrl ||
      process.env.NEXT_PUBLIC_CONVEX_URL ||
      "",
  );
}

export function getAuthProvider(): AuthProvider {
  if (typeof window === "undefined") {
    return getServerRuntimeConfig().authProvider;
  }

  return (
    getClientRuntimeConfig()?.authProvider ||
    (process.env.NEXT_PUBLIC_AUTH_PROVIDER as AuthProvider) ||
    "nextauth"
  );
}

export function getAutoLoginEmail(): string | null {
  if (typeof window === "undefined") {
    return getServerRuntimeConfig().autoLoginEmail;
  }

  return (
    getClientRuntimeConfig()?.autoLoginEmail ||
    process.env.NEXT_PUBLIC_AUTO_LOGIN_EMAIL ||
    null
  );
}

export function getClaweEdition(): ClaweEdition {
  if (typeof window === "undefined") {
    return getServerRuntimeConfig().claweEdition;
  }

  return (
    getClientRuntimeConfig()?.claweEdition ||
    (process.env.NEXT_PUBLIC_CLAWE_EDITION as ClaweEdition) ||
    "oss"
  );
}
