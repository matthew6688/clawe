"use client";

import { startTransition, useEffect, useState } from "react";
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
import { Skeleton } from "@clawe/ui/components/skeleton";
import { ScrollArea } from "@clawe/ui/components/scroll-area";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useApiClient } from "@/hooks/use-api-client";

const REFRESH_INTERVAL_MS = 15000;

type SystemLogRecord = {
  ts?: string;
  event?: string;
  route?: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  [key: string]: unknown;
};

type SystemLogsResponse = {
  ok?: boolean;
  filePath?: string | null;
  records?: SystemLogRecord[];
  scannedLines?: number;
  error?: string;
};

function formatTime(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusVariant(
  status: number | undefined,
): "default" | "secondary" | "destructive" | "outline" {
  if (typeof status !== "number") return "outline";
  if (status >= 500) return "destructive";
  if (status >= 400) return "outline";
  if (status >= 300) return "outline";
  if (status >= 200) return "secondary";
  return "default";
}

export const SystemLogsSettings = () => {
  const apiClient = useApiClient();
  const [records, setRecords] = useState<SystemLogRecord[]>([]);
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [scannedLines, setScannedLines] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [requestIdFilter, setRequestIdFilter] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [limit, setLimit] = useState("200");

  const loadLogs = async (source: "initial" | "manual" | "auto") => {
    if (source === "initial") {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", limit);
      if (requestIdFilter.trim()) params.set("requestId", requestIdFilter.trim());
      if (routeFilter.trim()) params.set("route", routeFilter.trim());
      if (eventFilter.trim()) params.set("event", eventFilter.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);

      const { data } = await apiClient.get<SystemLogsResponse>(
        `/api/tenant/logs/system?${params.toString()}`,
      );

      if (data.ok === false) {
        throw new Error(data.error || "Failed to load logs");
      }

      startTransition(() => {
        setRecords(data.records ?? []);
        setLogFilePath(data.filePath ?? null);
        setScannedLines(data.scannedLines ?? 0);
        setLastUpdatedAt(Date.now());
      });
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load system logs";
      setError(message);
      if (source === "manual") {
        toast.error(message);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadLogs("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void loadLogs("auto");
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, limit, eventFilter, statusFilter, requestIdFilter, routeFilter]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="logs-request-id">Request ID</Label>
            <Input
              id="logs-request-id"
              value={requestIdFilter}
              onChange={(event) => setRequestIdFilter(event.target.value)}
              placeholder="search by request id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logs-route">Route</Label>
            <Input
              id="logs-route"
              value={routeFilter}
              onChange={(event) => setRouteFilter(event.target.value)}
              placeholder="tenant/agents/openclaw"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logs-event">Event</Label>
            <Input
              id="logs-event"
              value={eventFilter}
              onChange={(event) => setEventFilter(event.target.value)}
              placeholder="request.failed or chat.provider_success"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">all</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="400">400</SelectItem>
                <SelectItem value="401">401</SelectItem>
                <SelectItem value="500">500</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Limit</Label>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="1000">1000</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadLogs("manual")}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </>
            )}
          </Button>
          <Button
            type="button"
            variant={autoRefresh ? "brand" : "outline"}
            onClick={() => setAutoRefresh((prev) => !prev)}
          >
            Auto refresh: {autoRefresh ? "on (15s)" : "off"}
          </Button>
        </div>

        <div className="text-muted-foreground mt-3 space-y-0.5 text-xs">
          <p>Log file: {logFilePath || "not found yet"}</p>
          <p>Scanned lines: {scannedLines}</p>
          <p>
            Last updated:{" "}
            {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "n/a"}
          </p>
        </div>
      </div>

      <div className="rounded-lg border">
        {isLoading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="p-4">
            <p className="text-destructive text-sm">{error}</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-4">
            <p className="text-muted-foreground text-sm">No logs matched.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[70vh]">
            <div className="space-y-3 p-4">
              {records.map((record, index) => (
                <div key={`${record.requestId || "row"}-${record.ts || "time"}-${index}`} className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{record.event || "event"}</Badge>
                    <Badge variant={statusVariant(record.status)}>
                      {typeof record.status === "number" ? record.status : "n/a"}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatTime(record.ts)}
                    </span>
                  </div>
                  <div className="grid gap-1 text-sm md:grid-cols-2">
                    <p>
                      <span className="text-muted-foreground">route:</span>{" "}
                      {record.route || "n/a"}
                    </p>
                    <p>
                      <span className="text-muted-foreground">requestId:</span>{" "}
                      {record.requestId || "n/a"}
                    </p>
                    <p>
                      <span className="text-muted-foreground">method/path:</span>{" "}
                      {record.method || "n/a"} {record.path || ""}
                    </p>
                    <p>
                      <span className="text-muted-foreground">duration:</span>{" "}
                      {typeof record.durationMs === "number"
                        ? `${record.durationMs}ms`
                        : "n/a"}
                    </p>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Raw record
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[11px]">
                      {JSON.stringify(record, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};
