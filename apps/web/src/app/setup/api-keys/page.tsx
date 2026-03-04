"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@clawe/ui/components/button";
import { Input } from "@clawe/ui/components/input";
import { Label } from "@clawe/ui/components/label";
import { Progress } from "@clawe/ui/components/progress";
import { Spinner } from "@clawe/ui/components/spinner";
import { CheckCircle2 } from "lucide-react";
import { useApiClient } from "@/hooks/use-api-client";

const TOTAL_STEPS = 5;
const CURRENT_STEP = 2;

export default function ApiKeysPage() {
  const router = useRouter();
  const apiClient = useApiClient();

  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [kimiKey, setKimiKey] = useState("");
  const [anthropicValid, setAnthropicValid] = useState(false);
  const [openaiValid, setOpenaiValid] = useState<boolean | null>(null);
  const [kimiValid, setKimiValid] = useState<boolean | null>(null);

  // Validate Anthropic key
  const anthropicValidation = useMutation({
    mutationFn: async (apiKey: string) => {
      const { data } = await apiClient.post<{ valid: boolean; error?: string }>(
        "/api/tenant/validate-key",
        { provider: "anthropic", apiKey },
      );
      if (!data.valid) {
        throw new Error(data.error || "Invalid API key");
      }
      return data;
    },
    onSuccess: () => {
      setAnthropicValid(true);
    },
    onError: () => {
      setAnthropicValid(false);
    },
  });

  // Validate OpenAI key
  const openaiValidation = useMutation({
    mutationFn: async (apiKey: string) => {
      const { data } = await apiClient.post<{ valid: boolean; error?: string }>(
        "/api/tenant/validate-key",
        { provider: "openai", apiKey },
      );
      if (!data.valid) {
        throw new Error(data.error || "Invalid API key");
      }
      return data;
    },
    onSuccess: () => {
      setOpenaiValid(true);
    },
    onError: () => {
      setOpenaiValid(false);
    },
  });

  // Validate Kimi key
  const kimiValidation = useMutation({
    mutationFn: async (apiKey: string) => {
      const { data } = await apiClient.post<{ valid: boolean; error?: string }>(
        "/api/tenant/validate-key",
        { provider: "kimi", apiKey },
      );
      if (!data.valid) {
        throw new Error(data.error || "Invalid API key");
      }
      return data;
    },
    onSuccess: () => {
      setKimiValid(true);
    },
    onError: () => {
      setKimiValid(false);
    },
  });

  // Save keys to Convex and patch into squadhub config
  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.race([
        apiClient
          .post("/api/tenant/api-keys", {
            anthropicApiKey: anthropicKey || undefined,
            openaiApiKey: openaiKey || undefined,
            kimiApiKey: kimiKey || undefined,
          })
          .catch((error) => {
            console.warn("[setup/api-keys] Save failed, continuing", error);
          }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 2500);
        }),
      ]);
    },
    onSuccess: () => {
      router.push("/setup/business");
    },
  });

  const handleValidateAnthropic = () => {
    if (anthropicKey) {
      anthropicValidation.mutate(anthropicKey);
    }
  };

  const handleValidateOpenai = () => {
    if (openaiKey) {
      openaiValidation.mutate(openaiKey);
    }
  };

  const handleValidateKimi = () => {
    if (kimiKey) {
      kimiValidation.mutate(kimiKey);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (anthropicValid || openaiValid === true || kimiValid === true) {
      saveMutation.mutate();
    }
  };

  const isSubmitting = saveMutation.isPending;
  const canContinue =
    anthropicValid || openaiValid === true || kimiValid === true;

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col">
      <div className="max-w-xl flex-1">
        {/* Progress indicator */}
        <div className="mb-6 sm:mb-8">
          <Progress
            value={(CURRENT_STEP / TOTAL_STEPS) * 100}
            className="h-1 w-full max-w-sm"
            indicatorClassName="bg-brand"
          />
        </div>

        <h1 className="mb-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          API Keys
        </h1>
        <p className="text-muted-foreground mb-6">
          Your AI agents need at least one API key to connect to language
          models. Keys are stored securely and never leave your deployment.
        </p>

        <div className="space-y-6">
          {/* Anthropic API Key */}
          <div className="space-y-2">
            <Label htmlFor="anthropic-key">Anthropic API Key</Label>
            <div className="flex gap-2">
              <Input
                id="anthropic-key"
                type="password"
                autoComplete="new-password"
                placeholder="sk-ant-..."
                value={anthropicKey}
                onChange={(e) => {
                  setAnthropicKey(e.target.value);
                  setAnthropicValid(false);
                  anthropicValidation.reset();
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleValidateAnthropic}
                disabled={
                  !anthropicKey ||
                  anthropicValidation.isPending ||
                  anthropicValid
                }
                className="shrink-0"
              >
                {anthropicValidation.isPending ? (
                  <Spinner />
                ) : anthropicValid ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>
            {anthropicValidation.isError && (
              <p className="text-destructive text-sm">
                {anthropicValidation.error.message}
              </p>
            )}
            {anthropicValid && (
              <p className="text-sm text-green-600 dark:text-green-400">
                API key is valid
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Get your key from{" "}
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                console.anthropic.com
              </a>
            </p>
          </div>

          {/* OpenAI API Key (optional) */}
          <div className="space-y-2">
            <Label htmlFor="openai-key">
              OpenAI API Key{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="openai-key"
                type="password"
                autoComplete="new-password"
                placeholder="sk-..."
                value={openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value);
                  setOpenaiValid(null);
                  openaiValidation.reset();
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleValidateOpenai}
                disabled={
                  !openaiKey ||
                  openaiValidation.isPending ||
                  openaiValid === true
                }
                className="shrink-0"
              >
                {openaiValidation.isPending ? (
                  <Spinner />
                ) : openaiValid === true ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>
            {openaiValidation.isError && (
              <p className="text-destructive text-sm">
                {openaiValidation.error.message}
              </p>
            )}
            {openaiValid === true && (
              <p className="text-sm text-green-600 dark:text-green-400">
                API key is valid
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Enables image generation. You can add this later in Settings.
            </p>
          </div>

          {/* Kimi API Key (optional) */}
          <div className="space-y-2">
            <Label htmlFor="kimi-key">
              Kimi API Key{" "}
              <span className="text-muted-foreground text-xs font-normal">
                (optional)
              </span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="kimi-key"
                type="password"
                autoComplete="new-password"
                placeholder="sk-kimi-..."
                value={kimiKey}
                onChange={(e) => {
                  setKimiKey(e.target.value);
                  setKimiValid(null);
                  kimiValidation.reset();
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleValidateKimi}
                disabled={
                  !kimiKey || kimiValidation.isPending || kimiValid === true
                }
                className="shrink-0"
              >
                {kimiValidation.isPending ? (
                  <Spinner />
                ) : kimiValid === true ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>
            {kimiValidation.isError && (
              <p className="text-destructive text-sm">
                {kimiValidation.error.message}
              </p>
            )}
            {kimiValid === true && (
              <p className="text-sm text-green-600 dark:text-green-400">
                API key is valid
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              Used by Kimi Coding models in squadhub heartbeats and agent runs.
            </p>
          </div>
        </div>

        {saveMutation.isError && (
          <p className="text-destructive mt-4 text-sm">
            {saveMutation.error.message}
          </p>
        )}
      </div>

      {/* CTA */}
      <div className="flex justify-center pt-6 sm:justify-end sm:pt-8">
        <Button
          type="submit"
          variant="brand"
          className="w-full sm:w-auto"
          disabled={!canContinue || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Spinner />
              Saving...
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </form>
  );
}
