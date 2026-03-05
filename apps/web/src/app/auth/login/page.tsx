"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useMutation } from "convex/react";
import { api } from "@clawe/backend";
import { Button } from "@clawe/ui/components/button";
import { Spinner } from "@clawe/ui/components/spinner";
import { getAutoLoginEmail } from "@/lib/runtime-config";
import { useAuth } from "@/providers/auth-provider";

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, signIn } = useAuth();
  const getOrCreateUser = useMutation(api.users.getOrCreateFromAuth);
  const autoLoginEmail = getAutoLoginEmail();
  const defaultEmail = useMemo(
    () => autoLoginEmail?.trim() || "dev@clawe.local",
    [autoLoginEmail],
  );
  const [email, setEmail] = useState(defaultEmail);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  useEffect(() => {
    setEmail(defaultEmail);
  }, [defaultEmail]);

  // Auto-login when AUTO_LOGIN_EMAIL is set (local dev convenience)
  useEffect(() => {
    if (!autoLoginEmail) return;
    if (isLoading || isAuthenticated || autoLoginAttempted) return;
    setAutoLoginAttempted(true);
    void signIn(autoLoginEmail);
  }, [isLoading, isAuthenticated, autoLoginAttempted, autoLoginEmail, signIn]);

  // After authentication, create/fetch user and redirect
  useEffect(() => {
    if (!isAuthenticated) return;

    const ensureUser = async () => {
      try {
        await getOrCreateUser();
      } catch {
        // User creation may fail if auth isn't ready yet.
        // The root page handles routing on the next page load.
      }
      router.replace("/");
    };

    ensureUser();
  }, [isAuthenticated, getOrCreateUser, router]);

  return (
    <div className="relative flex h-svh">
      {/* Left side - Login content */}
      <div className="flex w-full flex-col px-6 py-6 sm:px-8 sm:py-8 lg:w-1/2 lg:px-12 xl:px-16">
        {/* Logo */}
        <div className="mb-8 shrink-0 sm:mb-12">
          <span
            className="text-xl font-semibold"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            Clawe
          </span>
        </div>

        {/* Centered content */}
        <div className="flex flex-1 items-start justify-center pt-[20vh]">
          <div className="flex w-full max-w-sm flex-col items-center gap-8">
            {isLoading || isAuthenticated ? (
              <div className="flex flex-col items-center gap-4">
                <Spinner className="h-8 w-8" />
                <p className="text-muted-foreground text-sm">
                  {isAuthenticated ? "Signing you in..." : "Loading..."}
                </p>
              </div>
            ) : (
              <>
                <h1
                  className="text-2xl font-semibold tracking-tight sm:text-3xl"
                  style={{ fontFamily: "var(--font-space-grotesk)" }}
                >
                  Welcome to Clawe
                </h1>

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  autoComplete="email"
                />

                <Button
                  variant="outline"
                  size="lg"
                  className="w-full gap-2"
                  onClick={() => void signIn(email)}
                  disabled={!email.trim()}
                >
                  Continue
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right side - Illustration */}
      <div className="bg-muted relative hidden lg:block lg:w-1/2">
        <div className="absolute inset-0 flex items-end justify-center p-12">
          <Image
            src="/onboarding-hero.png"
            alt="Clawe illustration"
            width={450}
            height={450}
            className="h-auto max-h-full w-auto max-w-full object-contain"
            priority
            unoptimized
          />
        </div>
      </div>
    </div>
  );
}
