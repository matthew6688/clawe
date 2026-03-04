"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

const AgentSettingsCard = ({ agent }: { agent: SquadAgent }) => {
  const updateAgent = useMutation(api.agents.update);
  const setActivity = useMutation(api.agents.setActivity);
  const updateStatus = useMutation(api.agents.updateStatus);
  const removeAgent = useMutation(api.agents.remove);

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

  useEffect(() => {
    const next = buildSnapshot(agent);
    setSnapshot(next);
    setName(next.name);
    setRole(next.role);
    setEmoji(next.emoji);
    setStatus(next.status);
    setActivityText(next.activity);
    setConfigText(next.configText);
    setConfigError(null);
  }, [agent._id, agent.updatedAt]);

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
  const createAgent = useMutation(api.agents.create);
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

export const AgentsSettings = () => {
  const agents = useQuery(api.agents.squad, {}) as SquadAgent[] | undefined;

  if (agents === undefined) {
    return <AgentsSettingsSkeleton />;
  }

  const existingSessionKeys = new Set(agents.map((agent) => agent.sessionKey));
  const sortedAgents = [...agents].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Agents</h3>
        <p className="text-muted-foreground text-sm">
          View and edit all agent profile settings and raw config JSON.
        </p>
      </div>

      <NewAgentForm existingSessionKeys={existingSessionKeys} />

      <Separator />

      <div className="space-y-3">
        {sortedAgents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No agents found.</p>
        ) : (
          sortedAgents.map((agent) => (
            <AgentSettingsCard key={agent._id} agent={agent} />
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
