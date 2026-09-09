"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Loader2, Circle, MinusCircle, AlertTriangle } from "lucide-react";
import type { JobStep, JobLogLine } from "@/lib/client-api";

/** Dashboard metric card (spec §7). */
export function MetricCard({
  label,
  value,
  icon: Icon,
  tone = "slate",
  onClick,
  loading,
  sublabel,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "green" | "amber" | "red" | "blue" | "purple";
  onClick?: () => void;
  loading?: boolean;
  sublabel?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-sky-100 text-sky-700",
    purple: "bg-violet-100 text-violet-700",
  };
  return (
    <Card
      className={cn(
        "border-border/80 shadow-none transition-all",
        onClick && "cursor-pointer hover:border-primary/40 hover:shadow-sm"
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) onClick();
      }}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-muted-foreground truncate">{label}</p>
            {loading ? (
              <Skeleton className="mt-1.5 h-8 w-14" />
            ) : (
              <p className="mt-1 text-[28px] font-bold leading-none tracking-tight">{value}</p>
            )}
            {sublabel && !loading && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
          </div>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tones[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Page header (spec §5/§6 typography). */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Empty state. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

/** Table skeleton (spec §46). */
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3 p-4">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DONE: CheckCircle2,
  FAILED: XCircle,
  RUNNING: Loader2,
  PENDING: Circle,
  SKIPPED: MinusCircle,
  WARNED: AlertTriangle,
};

const STEP_COLOR: Record<string, string> = {
  DONE: "text-emerald-600",
  FAILED: "text-red-600",
  RUNNING: "text-sky-600 animate-spin",
  PENDING: "text-muted-foreground/40",
  SKIPPED: "text-muted-foreground/40",
  WARNED: "text-amber-600",
};

/** Verification / workflow step progress (spec §10, §46). */
export function StepProgress({ steps }: { steps: JobStep[] }) {
  if (!steps?.length) return null;
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => {
        const Icon = STEP_ICON[step.status] || Circle;
        return (
          <li key={i} className="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/50">
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", STEP_COLOR[step.status] || "text-muted-foreground")} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", step.status === "PENDING" && "text-muted-foreground")}>
                {step.name}
              </p>
              {step.detail && (
                <p className={cn(
                  "mt-0.5 text-xs",
                  step.status === "FAILED" ? "text-red-600" : step.status === "WARNED" ? "text-amber-600" : "text-muted-foreground"
                )}>
                  {step.detail}
                </p>
              )}
            </div>
            {step.at && (
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {new Date(step.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

const LOG_COLOR: Record<string, string> = {
  info: "text-sky-700",
  success: "text-emerald-700",
  warn: "text-amber-700",
  error: "text-red-700",
};

/** Terminal-style log viewer (spec §22). */
export function LogViewer({ logs }: { logs: JobLogLine[] }) {
  if (!logs?.length) return <p className="p-4 text-sm text-muted-foreground">No log output.</p>;
  return (
    <div className="max-h-80 overflow-y-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-relaxed">
      {logs.map((line, i) => (
        <div key={i} className="flex gap-3">
          <span className="shrink-0 text-slate-500 tabular-nums">
            {new Date(line.t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className={LOG_COLOR[line.level] || "text-slate-300"}>{line.message}</span>
        </div>
      ))}
    </div>
  );
}
