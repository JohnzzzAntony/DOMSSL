"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { api, fmtDateTime, timeAgo, type JobRow } from "@/lib/client-api";
import { StatusBadge } from "@/components/shared/status";
import { PageHeader, StepProgress, LogViewer, EmptyState } from "@/components/shared/widgets";
import { ScrollText, RefreshCcw } from "lucide-react";

const ACTIONS = ["ALL", "VERIFICATION", "DOMAIN_CHECK", "SSL_CHECK", "SSL_REQUEST", "SSL_RENEWAL", "SSL_INSTALLATION", "DNS_VALIDATION", "SERVER_HEALTH", "BULK_SCAN", "ROLLBACK"];
const STATUSES = ["ALL", "SUCCESS", "RUNNING", "FAILED", "ROLLED_BACK", "QUEUED"];

export function LogsPage({ navigate, jobId }: { navigate: (to: string) => void; jobId?: string }) {
  const [action, setAction] = React.useState("ALL");
  const [status, setStatus] = React.useState("ALL");
  const [selected, setSelected] = React.useState<string | null>(jobId || null);

  React.useEffect(() => {
    if (jobId) setSelected(jobId);
  }, [jobId]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["logs", action, status],
    queryFn: () => api.get<{ jobs: JobRow[] }>(`/api/logs?action=${action}&status=${status}&limit=150`),
    refetchInterval: 8000,
  });

  const { data: detailData } = useQuery({
    queryKey: ["job", selected],
    queryFn: () => api.get<{ job: JobRow }>(`/api/logs/${selected}`),
    enabled: !!selected,
    refetchInterval: (q) => {
      const st = q.state.data?.job.status;
      return st === "SUCCESS" || st === "FAILED" || st === "ROLLED_BACK" ? false : 1500;
    },
  });

  const job = detailData?.job;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automation Logs"
        description="Every automated and manual operation with step-by-step results."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCcw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-9 w-full sm:w-52" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>{a === "ALL" ? "All Actions" : a.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s === "ALL" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-64 animate-pulse rounded-xl bg-muted" />
          ) : !data?.jobs.length ? (
            <EmptyState icon={ScrollText} title="No automation logs" description="Jobs will appear here as verification, renewal and deployment operations run." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Date</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="pr-6">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((j) => (
                    <TableRow key={j.id} className="cursor-pointer" onClick={() => setSelected(j.id)}>
                      <TableCell className="pl-6 text-xs">{fmtDateTime(j.createdAt)}</TableCell>
                      <TableCell className="text-sm">{j.domain || "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{j.type.replace(/_/g, " ")}</TableCell>
                      <TableCell><StatusBadge status={j.status} size="sm" /></TableCell>
                      <TableCell className="text-xs">{j.durationMs ? `${(j.durationMs / 1000).toFixed(1)}s` : j.status === "RUNNING" ? "running…" : "—"}</TableCell>
                      <TableCell className="max-w-72 truncate pr-6 text-xs text-muted-foreground">{j.error || j.title}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job detail sheet (spec §22) */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="border-b p-5">
            <SheetTitle className="text-left text-base">{job?.title || "Job Detail"}</SheetTitle>
            <SheetDescription className="text-left">
              {job && (
                <>
                  {fmtDateTime(job.createdAt)} · {timeAgo(job.createdAt)}
                  {job.durationMs ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : ""}
                </>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 p-5">
            {job && (
              <>
                <div className="flex items-center gap-2">
                  <StatusBadge status={job.status} />
                  <span className="text-xs text-muted-foreground">{job.type.replace(/_/g, " ")}</span>
                  {job.error && <span className="text-xs font-medium text-red-600">{job.error}</span>}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workflow Steps</p>
                  <div className="rounded-lg border p-2">
                    <StepProgress steps={job.steps || []} />
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Execution Log</p>
                  <LogViewer logs={job.logs || []} />
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
