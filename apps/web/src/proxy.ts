import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/auth/login",
  "/api/auth",
  "/api/health",
  "/api/squadhub/health",
];

function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function extractNextAuthCookieToken(request: NextRequest): string | null {
  const cookie =
    request.cookies.get("authjs.session-token") ??
    request.cookies.get("__Secure-authjs.session-token");
  if (cookie?.value) return cookie.value;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    /(?:^|;\s*)(?:authjs\.session-token|__Secure-authjs\.session-token)=([^;]+)/,
  );
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }

  return null;
}

function unauthorized(message: string) {
  return new NextResponse(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Page-level auth is handled by the client providers.
  // Middleware only guards API routes.
  const isApiRoute = pathname.startsWith("/api/");
  if (!isApiRoute) {
    return NextResponse.next();
  }

  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return NextResponse.next();
  }

  const cookieToken = extractNextAuthCookieToken(request);
  if (cookieToken) {
    return NextResponse.next();
  }

  return unauthorized("Unauthorized");
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|mp4|webm|woff2?|ttf|eot)$).*)",
  ],
};
