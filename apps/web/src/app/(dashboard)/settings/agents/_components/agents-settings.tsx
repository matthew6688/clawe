"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation as useConvexMutation, useQuery } from "convex/react";
import { api } from "@clawe/backend";
import type { Doc, Id } from "@clawe/backend/dataModel";
import { deriveStatus } from "@clawe/shared/agents";
import { Badge } from "@clawe/ui/components/badge";
import { Button } from "@clawe/ui/components/button";
import { Input } from "@clawe/ui/components/input";
import { Label } from "@clawe/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clawe/ui/components/select";
import { Separator } from "@clawe/ui/components/separator";
import { Skeleton } from "@clawe/ui/components/skeleton";
import { Spinner } from "@clawe/ui/components/spinner";
import { Textarea } from "@clawe/ui/components/textarea";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useApiClient } from "@/hooks/use-api-client";

type SquadAgent = Doc<"agents"> & {
  currentTask: { _id: Id<"tasks">; title: string; status: string } | null;
};

type AgentSnapshot = {
  name: string;
  role: string;
  emoji: string;
  status: "online" | "offline";
  activity: string;
  configText: string;
};

type OpenclawAgentPayload = {
  agentId: string;
  sessionKey: string;
  workspacePath: string;
  workspaceResolvedPath: string;
  workspaceExists: boolean;
  openclawAgent: {
    id?: string;
    name?: string;
    model?: string;
    workspace?: string;
    identity?: {
      name?: string;
      emoji?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  files: Record<string, string>;
  skillsSnapshot?: {
    prompt?: string;
    skills?: Array<{ name?: string; primaryEnv?: string }>;
    resolvedSkills?: Array<{
      name?: string;
      description?: string;
      filePath?: string;
      source?: string;
    }>;
    version?: number;
  } | null;
};

type OpenclawGetResponse = {
  ok: boolean;
  error?: string;
  rootPath?: string;
  configPath?: string;
  config?: Record<string, unknown>;
  agents?: OpenclawAgentPayload[];
};

type OpenclawPatchResponse = {
  ok: boolean;
  error?: string;
  agent?: OpenclawAgentPayload | null;
};

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "N/A";
  return new Date(timestamp).toLocaleString();
}

function configToEditorText(config: unknown): string {
  return JSON.stringify(config ?? {}, null, 2);
}

function parseConfigFromEditor(
  configText: string,
): { value?: unknown; error?: string } {
  const raw = configText.trim();
  if (!raw) return { value: {} };
  try {
    return { value: JSON.parse(raw) };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Invalid JSON in agent config",
    };
  }
}

function parseObjectFromEditorText(
  value: string,
  label: string,
): { value?: Record<string, unknown>; error?: string } {
  const raw = value.trim();
  if (!raw) {
    return { value: {} };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: `${label} must be a JSON object` };
    }
    return { value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : `Invalid JSON in ${label}`,
    };
  }
}

function toSessionKeyFromName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const agentId = slug || "agent";
  return `agent:${agentId}:main`;
}

function isValidSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:[^:]+$/i.test(sessionKey.trim());
}

function buildSnapshot(agent: SquadAgent): AgentSnapshot {
  return {
    name: agent.name,
    role: agent.role,
    emoji: agent.emoji ?? "",
    status: agent.status,
    activity: agent.currentActivity ?? "",
    configText: configToEditorText(agent.config),
  };
}

function sortFilesMap(files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  return Object.fromEntries(entries);
}

const OpenclawSettingsEditor = ({
  sessionKey,
  openclaw,
  onUpdated,
}: {
  sessionKey: string;
  openclaw?: OpenclawAgentPayload;
  onUpdated: (next: OpenclawAgentPayload) => void;
}) => {
  const apiClient = useApiClient();
  const [agentJsonText, setAgentJsonText] = useState("{}");
  const [agentJsonError, setAgentJsonError] = useState<string | null>(null);
  const [filesDraft, setFilesDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [lastAppliedHash, setLastAppliedHash] = useState("");

  useEffect(() => {
    if (!openclaw) {
      setAgentJsonText("{}");
      setAgentJsonError(null);
      setFilesDraft({});
      setLastAppliedHash("");
      return;
    }

    const nextFiles = sortFilesMap(openclaw.files ?? {});
    const rawAgent = JSON.stringify(openclaw.openclawAgent ?? {}, null, 2);
    setAgentJsonText(rawAgent);
    setAgentJsonError(null);
    setFilesDraft(nextFiles);
    setLastAppliedHash(
      JSON.stringify({
        openclawAgent: rawAgent,
        files: nextFiles,
      }),
    );
  }, [openclaw]);

  const currentHash = useMemo(
    () =>
      JSON.stringify({
        openclawAgent: agentJsonText,
        files: filesDraft,
      }),
    [agentJsonText, filesDraft],
  );
  const isDirty = !!openclaw && currentHash !== lastAppliedHash;

  const handleSave = async () => {
    if (!openclaw) return;
    const parsedAgent = parseObjectFromEditorText(
      agentJsonText,
      "OpenClaw agent JSON",
    );
    if (parsedAgent.error || !parsedAgent.value) {
      setAgentJsonError(parsedAgent.error ?? "Invalid OpenClaw agent JSON");
      toast.error(parsedAgent.error ?? "Invalid OpenClaw agent JSON");
      return;
    }

    setIsSaving(true);
    setAgentJsonError(null);
    try {
      const { data } = await apiClient.patch<OpenclawPatchResponse>(
        "/api/tenant/agents/openclaw",
        {
          sessionKey,
          openclawPatch: parsedAgent.value,
          files: filesDraft,
        },
      );

      if (!data.ok || !data.agent) {
        throw new Error(data.error || "Failed to save OpenClaw settings");
      }

      onUpdated(data.agent);
      toast.success(`OpenClaw settings updated for ${sessionKey}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update OpenClaw settings",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!openclaw) {
    return (
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          OpenClaw Files & Skills
        </summary>
        <p className="text-muted-foreground mt-2 text-sm">
          OpenClaw workspace/settings not found for this agent.
        </p>
      </details>
    );
  }

  return (
    <details className="space-y-4 rounded-md border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        OpenClaw Files & Skills
      </summary>

      <div className="mt-3 space-y-4">
        <div className="space-y-2">
          <Label>Raw OpenClaw agent JSON</Label>
          <Textarea
            value={agentJsonText}
            onChange={(e) => setAgentJsonText(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder='{"id":"main","name":"Clawe","model":"kimi-coding/k2p5"}'
          />
          {agentJsonError ? (
            <p className="text-destructive text-sm">{agentJsonError}</p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Edit full OpenClaw agent fields here. Saved into `openclaw.json`
              for this agent entry.
            </p>
          )}
        </div>

        <div className="text-muted-foreground space-y-1 text-xs">
          <p>Workspace: {openclaw.workspacePath}</p>
          <p>Resolved path: {openclaw.workspaceResolvedPath}</p>
          <p>Workspace exists: {openclaw.workspaceExists ? "yes" : "no"}</p>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Prompt/Workspace files</p>
          <p className="text-muted-foreground text-xs">
            Editable paths: core `*.md` files and `skills/*`.
          </p>
        </div>

        <div className="space-y-2">
          {Object.entries(filesDraft).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No workspace files detected.
            </p>
          ) : (
            Object.entries(filesDraft).map(([filePath, content]) => (
              <details key={filePath} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {filePath}
                </summary>
                <Textarea
                  value={content}
                  onChange={(event) =>
                    setFilesDraft((prev) => ({
                      ...prev,
                      [filePath]: event.target.value,
                    }))
                  }
                  className="mt-3 min-h-[180px] font-mono text-xs"
                />
              </details>
            ))
          )}
        </div>

        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Skills Snapshot
          </summary>
          {openclaw.skillsSnapshot ? (
            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-medium">Loaded skills</p>
                <ul className="text-muted-foreground space-y-1 text-xs">
                  {(openclaw.skillsSnapshot.resolvedSkills ?? []).length === 0 ? (
                    <li>No resolved skills in snapshot.</li>
                  ) : (
                    openclaw.skillsSnapshot.resolvedSkills?.map((skill, index) => (
                      <li key={`${skill.name ?? "skill"}-${index}`}>
                        {skill.name ?? "Unnamed"} - {skill.filePath ?? "n/a"}
                      </li>
                    ))
                  )}
                </ul>
              </div>
              <pre className="overflow-x-auto rounded bg-muted/50 p-3 font-mono text-xs">
                {JSON.stringify(openclaw.skillsSnapshot, null, 2)}
              </pre>
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              No skills snapshot found for this agent.
            </p>
          )}
        </details>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="brand"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? (
              <>
                <Spinner />
                Saving...
              </>
            ) : (
              "Save OpenClaw settings"
            )}
          </Button>
        </div>
      </div>
    </details>
  );
};

const AgentSettingsCard = ({
  agent,
  openclaw,
  onOpenclawUpdated,
}: {
  agent: SquadAgent;
  openclaw?: OpenclawAgentPayload;
  onOpenclawUpdated: (next: OpenclawAgentPayload) => void;
}) => {
  const updateAgent = useConvexMutation(api.agents.update);
  const setActivity = useConvexMutation(api.agents.setActivity);
  const updateStatus = useConvexMutation(api.agents.updateStatus);
  const removeAgent = useConvexMutation(api.agents.remove);

  const [snapshot, setSnapshot] = useState<AgentSnapshot>(() =>
    buildSnapshot(agent),
  );
  const [name, setName] = useState(snapshot.name);
  const [role, setRole] = useState(snapshot.role);
  const [emoji, setEmoji] = useState(snapshot.emoji);
  const [status, setStatus] = useState<"online" | "offline">(snapshot.status);
  const [activity, setActivityText] = useState(snapshot.activity);
  const [configText, setConfigText] = useState(snapshot.configText);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const agentNameValue = agent.name;
  const agentRoleValue = agent.role;
  const agentEmojiValue = agent.emoji ?? "";
  const agentStatusValue = agent.status;
  const agentActivityValue = agent.currentActivity ?? "";
  const agentConfigValue = agent.config;

  useEffect(() => {
    const next: AgentSnapshot = {
      name: agentNameValue,
      role: agentRoleValue,
      emoji: agentEmojiValue,
      status: agentStatusValue,
      activity: agentActivityValue,
      configText: configToEditorText(agentConfigValue),
    };
    setSnapshot(next);
    setName(next.name);
    setRole(next.role);
    setEmoji(next.emoji);
    setStatus(next.status);
    setActivityText(next.activity);
    setConfigText(next.configText);
    setConfigError(null);
  }, [
    agent._id,
    agent.updatedAt,
    agentNameValue,
    agentRoleValue,
    agentEmojiValue,
    agentStatusValue,
    agentActivityValue,
    agentConfigValue,
  ]);

  const heartbeatStatus = deriveStatus(agent);
  const statusLabel =
    heartbeatStatus === "online" ? "Online (heartbeat)" : "Offline (heartbeat)";
  const isDirty =
    name !== snapshot.name ||
    role !== snapshot.role ||
    emoji !== snapshot.emoji ||
    status !== snapshot.status ||
    activity !== snapshot.activity ||
    configText !== snapshot.configText;

  const handleCopySessionKey = async () => {
    try {
      await navigator.clipboard.writeText(agent.sessionKey);
      toast.success(`Copied ${agent.sessionKey}`);
    } catch {
      toast.error("Failed to copy session key");
    }
  };

  const handleReset = () => {
    setName(snapshot.name);
    setRole(snapshot.role);
    setEmoji(snapshot.emoji);
    setStatus(snapshot.status);
    setActivityText(snapshot.activity);
    setConfigText(snapshot.configText);
    setConfigError(null);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedRole = role.trim();
    if (!trimmedName) {
      toast.error("Agent name is required");
      return;
    }
    if (!trimmedRole) {
      toast.error("Agent role is required");
      return;
    }

    const parsedConfig = parseConfigFromEditor(configText);
    if (parsedConfig.error) {
      setConfigError(parsedConfig.error);
      toast.error("Invalid config JSON");
      return;
    }

    setIsSaving(true);
    setConfigError(null);
    try {
      await updateAgent({
        id: agent._id,
        name: trimmedName,
        role: trimmedRole,
        emoji: emoji.trim(),
        config: parsedConfig.value,
      });

      const nextActivity = activity.trim();
      const currentActivity = (agent.currentActivity ?? "").trim();
      if (nextActivity !== currentActivity) {
        await setActivity({
          sessionKey: agent.sessionKey,
          activity: nextActivity || undefined,
        });
      }

      if (status !== agent.status) {
        await updateStatus({
          id: agent._id,
          status,
        });
      }

      toast.success(`${trimmedName} settings saved`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save agent settings",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    if (
      !window.confirm(
        `Remove agent "${agent.name}" (${agent.sessionKey})? This cannot be undone.`,
      )
    ) {
      return;
    }

    setIsRemoving(true);
    try {
      await removeAgent({ id: agent._id });
      toast.success(`Removed ${agent.name}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove agent",
      );
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{agent.emoji || "🤖"}</span>
          <div>
            <p className="font-medium">{agent.name}</p>
            <p className="text-muted-foreground text-xs">{agent.sessionKey}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={heartbeatStatus === "online" ? "secondary" : "outline"}
          >
            {statusLabel}
          </Badge>
          {agent.currentTask ? (
            <Badge variant="outline">{agent.currentTask.status}</Badge>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCopySessionKey}
          >
            <Copy className="h-3.5 w-3.5" />
            Session key
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={handleRemove}
            disabled={isRemoving}
          >
            {isRemoving ? (
              <>
                <Spinner />
                Removing...
              </>
            ) : (
              <>
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`name-${agent._id}`}>Name</Label>
          <Input
            id={`name-${agent._id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`role-${agent._id}`}>Role</Label>
          <Input
            id={`role-${agent._id}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Agent role"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`emoji-${agent._id}`}>Emoji</Label>
          <Input
            id={`emoji-${agent._id}`}
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🦞"
          />
        </div>

        <div className="space-y-2">
          <Label>Status (stored)</Label>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as "online" | "offline")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="online">online</SelectItem>
              <SelectItem value="offline">offline</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Heartbeat can still mark an agent offline if heartbeat is stale.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`activity-${agent._id}`}>Current activity</Label>
        <Input
          id={`activity-${agent._id}`}
          value={activity}
          onChange={(e) => setActivityText(e.target.value)}
          placeholder="What the agent is currently doing"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`config-${agent._id}`}>Config JSON</Label>
        <Textarea
          id={`config-${agent._id}`}
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
          placeholder='{"model":"gpt-4o-mini"}'
        />
        {configError ? (
          <p className="text-destructive text-sm">{configError}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Stored in `agents.config` and used for agent-specific runtime
            options.
          </p>
        )}
      </div>

      <div className="text-muted-foreground grid gap-1 text-xs md:grid-cols-2">
        <p>Created: {formatTimestamp(agent.createdAt)}</p>
        <p>Updated: {formatTimestamp(agent.updatedAt)}</p>
        <p>Last heartbeat: {formatTimestamp(agent.lastHeartbeat)}</p>
        <p>Last seen: {formatTimestamp(agent.lastSeen)}</p>
      </div>

      <OpenclawSettingsEditor
        sessionKey={agent.sessionKey}
        openclaw={openclaw}
        onUpdated={onOpenclawUpdated}
      />

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Raw agent record
        </summary>
        <pre className="mt-3 overflow-x-auto rounded bg-muted/50 p-3 font-mono text-xs">
          {JSON.stringify(agent, null, 2)}
        </pre>
      </details>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="brand"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
        >
          {isSaving ? (
            <>
              <Spinner />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
        >
          Reset
        </Button>
      </div>
    </div>
  );
};

const NewAgentForm = ({
  existingSessionKeys,
}: {
  existingSessionKeys: Set<string>;
}) => {
  const createAgent = useConvexMutation(api.agents.create);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [emoji, setEmoji] = useState("");
  const [sessionKey, setSessionKey] = useState("");
  const [configText, setConfigText] = useState("{}");
  const [configError, setConfigError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleGenerateSessionKey = () => {
    setSessionKey(toSessionKeyFromName(name));
  };

  const resetForm = () => {
    setName("");
    setRole("");
    setEmoji("");
    setSessionKey("");
    setConfigText("{}");
    setConfigError(null);
  };

  const handleCreate = async () => {
    const trimmedName = name.trim();
    const trimmedRole = role.trim();
    const trimmedSessionKey = sessionKey.trim();

    if (!trimmedName || !trimmedRole || !trimmedSessionKey) {
      toast.error("Name, role, and session key are required");
      return;
    }
    if (!isValidSessionKey(trimmedSessionKey)) {
      toast.error("Session key must match: agent:<id>:<name>");
      return;
    }
    if (existingSessionKeys.has(trimmedSessionKey)) {
      toast.error("Session key already exists");
      return;
    }

    const parsedConfig = parseConfigFromEditor(configText);
    if (parsedConfig.error) {
      setConfigError(parsedConfig.error);
      toast.error("Invalid config JSON");
      return;
    }

    setIsSubmitting(true);
    setConfigError(null);
    try {
      await createAgent({
        name: trimmedName,
        role: trimmedRole,
        sessionKey: trimmedSessionKey,
        emoji: emoji.trim() || undefined,
        config: parsedConfig.value,
      });
      toast.success(`Created ${trimmedName}`);
      resetForm();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create agent",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="font-medium">Create agent</h3>
        <p className="text-muted-foreground text-sm">
          Add a new agent profile and initial config.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new-agent-name">Name</Label>
          <Input
            id="new-agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nova"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-agent-role">Role</Label>
          <Input
            id="new-agent-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Researcher"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="new-agent-emoji">Emoji</Label>
          <Input
            id="new-agent-emoji"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🤖"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-agent-session-key">Session key</Label>
          <div className="flex gap-2">
            <Input
              id="new-agent-session-key"
              value={sessionKey}
              onChange={(e) => setSessionKey(e.target.value)}
              placeholder="agent:nova:main"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleGenerateSessionKey}
            >
              Generate
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="new-agent-config">Config JSON</Label>
        <Textarea
          id="new-agent-config"
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={6}
          className="font-mono text-xs"
          placeholder='{"model":"gpt-4o-mini"}'
        />
        {configError ? (
          <p className="text-destructive text-sm">{configError}</p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Use valid JSON. Empty content defaults to `{}`.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="brand" onClick={handleCreate}>
          {isSubmitting ? (
            <>
              <Spinner />
              Creating...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Create agent
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={resetForm}
          disabled={isSubmitting}
        >
          Reset
        </Button>
      </div>
    </div>
  );
};

const OpenclawOnlyAgentCard = ({
  openclaw,
  onOpenclawUpdated,
}: {
  openclaw: OpenclawAgentPayload;
  onOpenclawUpdated: (next: OpenclawAgentPayload) => void;
}) => {
  const createAgent = useConvexMutation(api.agents.create);
  const [isCreating, setIsCreating] = useState(false);

  const derivedName =
    openclaw.openclawAgent.identity?.name ||
    openclaw.openclawAgent.name ||
    openclaw.agentId;
  const derivedEmoji = openclaw.openclawAgent.identity?.emoji || "🤖";

  const handleCreateConvexAgent = async () => {
    setIsCreating(true);
    try {
      await createAgent({
        name: derivedName,
        role: "Agent",
        sessionKey: openclaw.sessionKey,
        emoji: derivedEmoji,
        config: {
          model:
            typeof openclaw.openclawAgent.model === "string"
              ? openclaw.openclawAgent.model
              : undefined,
        },
      });
      toast.success(`Created Convex agent for ${openclaw.sessionKey}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create Convex agent record",
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{derivedEmoji}</span>
          <div>
            <p className="font-medium">{derivedName}</p>
            <p className="text-muted-foreground text-xs">{openclaw.sessionKey}</p>
          </div>
        </div>
        <Badge variant="outline">OpenClaw only</Badge>
      </div>

      <p className="text-muted-foreground text-sm">
        This agent exists in OpenClaw config/workspace, but has no Convex record
        yet.
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleCreateConvexAgent}
          disabled={isCreating}
        >
          {isCreating ? (
            <>
              <Spinner />
              Creating...
            </>
          ) : (
            "Create Convex record"
          )}
        </Button>
      </div>

      <OpenclawSettingsEditor
        sessionKey={openclaw.sessionKey}
        openclaw={openclaw}
        onUpdated={onOpenclawUpdated}
      />
    </div>
  );
};

export const AgentsSettings = () => {
  const apiClient = useApiClient();
  const agents = useQuery(api.agents.squad, {}) as SquadAgent[] | undefined;
  const [openclawBySession, setOpenclawBySession] = useState<
    Record<string, OpenclawAgentPayload>
  >({});
  const [openclawRootPath, setOpenclawRootPath] = useState("");
  const [openclawConfigPath, setOpenclawConfigPath] = useState("");
  const [openclawConfigText, setOpenclawConfigText] = useState("{}");
  const [openclawLoading, setOpenclawLoading] = useState(false);
  const [openclawError, setOpenclawError] = useState<string | null>(null);

  const loadOpenclaw = useCallback(async () => {
    setOpenclawLoading(true);
    setOpenclawError(null);
    try {
      const { data } = await apiClient.get<OpenclawGetResponse>(
        "/api/tenant/agents/openclaw",
      );
      if (!data.ok) {
        throw new Error(data.error || "Failed to load OpenClaw settings");
      }
      const map = Object.fromEntries(
        (data.agents ?? []).map((entry) => [entry.sessionKey, entry]),
      );
      setOpenclawBySession(map);
      setOpenclawRootPath(data.rootPath ?? "");
      setOpenclawConfigPath(data.configPath ?? "");
      setOpenclawConfigText(JSON.stringify(data.config ?? {}, null, 2));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to load OpenClaw settings";
      setOpenclawError(message);
    } finally {
      setOpenclawLoading(false);
    }
  }, [apiClient]);

  const agentSessionSignature = useMemo(() => {
    if (!agents) return "";
    return [...agents.map((agent) => agent.sessionKey)]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .join("|");
  }, [agents]);

  useEffect(() => {
    if (!agentSessionSignature) return;
    void loadOpenclaw();
  }, [agentSessionSignature, loadOpenclaw]);

  if (agents === undefined) {
    return <AgentsSettingsSkeleton />;
  }

  const existingSessionKeys = new Set(agents.map((agent) => agent.sessionKey));
  const sortedAgents = [...agents].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
  const openclawOnlyAgents = Object.values(openclawBySession)
    .filter((entry) => !existingSessionKeys.has(entry.sessionKey))
    .sort((a, b) =>
      a.sessionKey.localeCompare(b.sessionKey, undefined, {
        sensitivity: "base",
      }),
    );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Agents</h3>
        <p className="text-muted-foreground text-sm">
          View and edit Convex agent profile settings, plus OpenClaw agent
          prompt files and skill snapshots.
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium">OpenClaw source</p>
            <p className="text-muted-foreground text-xs">
              Root: {openclawRootPath || "N/A"}
            </p>
            <p className="text-muted-foreground text-xs">
              Config: {openclawConfigPath || "N/A"}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadOpenclaw()}>
            {openclawLoading ? (
              <>
                <Spinner />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Refresh OpenClaw
              </>
            )}
          </Button>
        </div>
        {openclawError ? (
          <p className="text-destructive mt-2 text-sm">{openclawError}</p>
        ) : null}
        <details className="mt-3 rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Raw `openclaw.json` (sanitized)
          </summary>
          <pre className="mt-3 overflow-x-auto rounded bg-muted/50 p-3 font-mono text-xs">
            {openclawConfigText}
          </pre>
        </details>
      </div>

      <NewAgentForm existingSessionKeys={existingSessionKeys} />

      <Separator />

      <div className="space-y-3">
        {openclawOnlyAgents.length > 0 ? (
          <>
            <div className="rounded-md border border-dashed p-3 text-sm">
              <p className="font-medium">OpenClaw-only agents</p>
              <p className="text-muted-foreground">
                These agents are available in OpenClaw files but missing from
                Convex.
              </p>
            </div>
            {openclawOnlyAgents.map((entry) => (
              <OpenclawOnlyAgentCard
                key={`openclaw-only-${entry.sessionKey}`}
                openclaw={entry}
                onOpenclawUpdated={(next) =>
                  setOpenclawBySession((prev) => ({
                    ...prev,
                    [next.sessionKey]: next,
                  }))
                }
              />
            ))}
          </>
        ) : null}
        {sortedAgents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents found.</p>
        ) : (
          sortedAgents.map((agent) => (
            <AgentSettingsCard
              key={agent._id}
              agent={agent}
              openclaw={openclawBySession[agent.sessionKey]}
              onOpenclawUpdated={(next) =>
                setOpenclawBySession((prev) => ({
                  ...prev,
                  [next.sessionKey]: next,
                }))
              }
            />
          ))
        )}
      </div>
    </div>
  );
};

const AgentsSettingsSkeleton = () => {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-80" />
      </div>

      <div className="space-y-2 rounded-lg border p-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>

      {[1, 2].map((index) => (
        <div key={index} className="space-y-2 rounded-lg border p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ))}
    </div>
  );
};
