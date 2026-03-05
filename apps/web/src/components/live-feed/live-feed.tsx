"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@clawe/backend";
import { deriveStatus } from "@clawe/shared/agents";
import { cn } from "@clawe/ui/lib/utils";
import { ScrollArea } from "@clawe/ui/components/scroll-area";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { LiveFeedItem } from "./live-feed-item";
import type { FeedActivity, FeedFilter } from "./types";

/** Title component for use in drawer header */
export const LiveFeedTitle = ({ limit = 50 }: { limit?: number }) => {
  const activities = useQuery(api.activities.feed, { limit });
  const count = activities?.length ?? 0;

  return (
    <>
      <div className="relative">
        <Bell className="text-foreground h-5 w-5" />
        <span className="border-background absolute top-[3px] right-[1px] h-[8px] w-[8px] rounded-full border bg-emerald-500">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-75" />
        </span>
      </div>
      <span>Activity</span>
      <span className="text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5 text-xs tabular-nums">
        {count}
      </span>
    </>
  );
};

const FILTER_CONFIG: {
  id: FeedFilter;
  label: string;
  types: FeedActivity["type"][];
}[] = [
  { id: "all", label: "All", types: [] },
  {
    id: "tasks",
    label: "Tasks",
    types: [
      "task_created",
      "task_assigned",
      "task_status_changed",
      "subtask_completed",
    ],
  },
  {
    id: "status",
    label: "Messages",
    types: ["message_sent", "notification_sent"],
  },
  { id: "heartbeats", label: "Online", types: ["agent_heartbeat"] },
];

export type LiveFeedProps = {
  className?: string;
  limit?: number;
};

export const LiveFeed = ({ className, limit = 50 }: LiveFeedProps) => {
  const [activeFilter, setActiveFilter] = useState<FeedFilter>("all");

  const activities = useQuery(api.activities.feed, { limit });
  const agents = useQuery(api.agents.list, {});
  const onlineAgents = useMemo(
    () =>
      (agents ?? [])
        .filter((agent) => deriveStatus(agent) === "online")
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        ),
    [agents],
  );
  const dedupedActivities = useMemo(() => {
    if (!activities) return [];

    const heartbeatSeen = new Set<string>();
    const notificationSeen = new Set<string>();
    const result: FeedActivity[] = [];

    for (const activity of activities as FeedActivity[]) {
      const shouldRequireAgent =
        activity.type === "agent_heartbeat" ||
        activity.type === "notification_sent" ||
        activity.type === "message_sent";
      if (shouldRequireAgent && !activity.agent) {
        // Hide stale activity rows that reference removed/unknown agents.
        continue;
      }

      if (activity.type === "agent_heartbeat") {
        const agentKey = String(
          activity.agent?._id ?? activity.agentId ?? activity._id,
        );
        if (heartbeatSeen.has(agentKey)) {
          continue;
        }
        heartbeatSeen.add(agentKey);
      }

      if (activity.type === "notification_sent") {
        const agentKey = String(activity.agent?._id ?? activity.agentId ?? "");
        const minuteBucket = Math.floor(activity.createdAt / 60000);
        // A single routing action can fan out to multiple agents; collapse
        // those per-source bursts into one feed row per minute.
        const dedupeKey = `${agentKey}:${minuteBucket}`;
        if (notificationSeen.has(dedupeKey)) {
          continue;
        }
        notificationSeen.add(dedupeKey);
      }

      result.push(activity);
    }

    return result;
  }, [activities]);

  const filteredActivities = useMemo(() => {
    if (!activities) return [];

    const filterConfig = FILTER_CONFIG.find((f) => f.id === activeFilter);
    if (!filterConfig || filterConfig.types.length === 0) {
      return dedupedActivities;
    }

    return dedupedActivities.filter((activity) =>
      filterConfig.types.includes(activity.type),
    );
  }, [activities, dedupedActivities, activeFilter]);

  const filterCounts = useMemo((): Record<FeedFilter, number> => {
    if (!activities) {
      return { all: 0, tasks: 0, status: 0, heartbeats: 0 };
    }

    const counts: Record<FeedFilter, number> = {
      all: dedupedActivities.length,
      tasks: 0,
      status: 0,
      heartbeats: onlineAgents.length,
    };

    for (const activity of dedupedActivities) {
      for (const filter of FILTER_CONFIG) {
        if (filter.types.includes(activity.type)) {
          counts[filter.id]++;
        }
      }
    }

    return counts;
  }, [activities, dedupedActivities, onlineAgents.length]);

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}
    >
      {/* Filter tabs */}
      <div className="border-b px-4 py-3">
        <div className="flex gap-1">
          {FILTER_CONFIG.map((filter) => {
            const count = filterCounts[filter.id] ?? 0;
            const isActive = activeFilter === filter.id;

            return (
              <button
                key={filter.id}
                onClick={() => setActiveFilter(filter.id)}
                className={cn(
                  "relative rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                  isActive
                    ? "bg-brand text-white"
                    : "text-muted-foreground hover:bg-brand/10 hover:text-foreground",
                )}
              >
                {filter.label}
                {count > 0 && (
                  <span
                    className={cn(
                      "ml-1 tabular-nums",
                      isActive ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed list */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 pt-4">
          {!activities ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
              <span className="text-muted-foreground mt-2 text-sm">
                Loading activity...
              </span>
            </div>
          ) : activeFilter === "heartbeats" ? (
            onlineAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <BellOff className="text-muted-foreground/50 h-8 w-8" />
                <span className="text-muted-foreground mt-2 text-sm">
                  No agents currently online
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pb-4">
                {onlineAgents.map((agent) => (
                  <div
                    key={agent._id}
                    className="bg-muted/40 flex items-center gap-2 rounded-md px-3 py-2 text-sm"
                  >
                    <span className="text-base leading-none">
                      {agent.emoji || "🤖"}
                    </span>
                    <span className="font-medium">{agent.name}</span>
                    <span className="ml-auto text-xs text-emerald-600">
                      online
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : filteredActivities.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <BellOff className="text-muted-foreground/50 h-8 w-8" />
              <span className="text-muted-foreground mt-2 text-sm">
                No activity yet
              </span>
            </div>
          ) : (
            filteredActivities.map((activity, index) => (
              <LiveFeedItem
                key={activity._id}
                activity={activity}
                isLast={index === filteredActivities.length - 1}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
