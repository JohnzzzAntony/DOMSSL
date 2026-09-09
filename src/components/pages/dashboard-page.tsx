"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip as ReTooltip,
} from "recharts";
import { api, daysLabel, timeAgo, type JobRow, type NotificationRow } from "@/lib/client-api";
import { StatusBadge, DaysBadge, AutomationChip, VerificationChip } from "@/components/shared/status";
import { MetricCard, PageHeader, TableSkeleton } from "@/components/shared/widgets";
import {
  Globe,
  LockKeyhole,
  Server,
  Bell,
  Clock,
  XCircle,
  ShieldAlert,
  Plus,
  RefreshCcw,
} from "lucide-react";

interface DashboardData {
  metrics: {
    totalDomains: number;
    certificates: number;
    servers: number;
    serversTotal: number;
    pendingNotifications: number;
    expiringSoon: number;
    expired: number;
    sslErrors: number;
    verified: number;
    unverified: number;
  };
  donut: { healthy: number; expiring: number; expired: number; sslError: number; unverified: number };
  overview: Array<{
    id: string;
    hostname: string;
    environment: string;
    sslExpiry: string | null;
    sslDays: number | null;
    domainExpiry: string | null;
    domainDays: number | null;
    status: string;
    verificationStatus: string;
    autoRenew: boolean;
    autoInstall: boolean;
    server: { id: string; name: string; status: string; webServer: string } | null;
  }>;
  recentJobs: JobRow[];
  unreadNotifications: NotificationRow[];
}

const DONUT_COLORS: Record<string, string> = {
  healthy: "#10b981",
  expiring: "#f59e0b",
  expired: "#ef4444",
  sslError: "#8b5cf6",
  unverified: "#94a3b8",
};

const JOB_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  SSL_RENEWAL: RefreshCcw,
  SSL_REQUEST: RefreshCcw,
  DOMAIN_CHECK: Globe,
  SSL_CHECK: LockKeyhole,
  SSL_INSTALLATION: Server,
  SERVER_HEALTH: Server,
  VERIFICATION: ShieldAlert,
  BULK_SCAN: Globe,
  NOTIFICATION: Bell,
  DNS_VALIDATION: Globe,
  ROLLBACK: RefreshCcw,
};

export function DashboardPage({ navigate }: { navigate: (to: string) => void }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/api/dashboard"),
    refetchInterval: 30000,
  });

  const m = data?.metrics;
  const donutData = React.useMemo(
    () =>
      data
        ? [
            { name: "Healthy", key: "healthy", value: data.donut.healthy },
            { name: "Expiring", key: "expiring", value: data.donut.expiring },
            { name: "Expired", key: "expired", value: data.donut.expired },
            { name: "SSL Error", key: "sslError", value: data.donut.sslError },
            { name: "Unverified", key: "unverified", value: data.donut.unverified },
          ].filter((d) => d.value > 0)
        : [],
    [data]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Monitor your domains, SSL certificates and servers."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate("/domains?action=bulk")}>
              Scan Multiple Domains
            </Button>
            <Button size="sm" onClick={() => navigate("/domains/new")}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Domain
            </Button>
          </>
        }
      />

      {/* Primary metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Domains" value={m?.totalDomains ?? 0} icon={Globe} tone="blue" loading={isLoading} onClick={() => navigate("/domains")} />
        <MetricCard label="SSL Certificates" value={m?.certificates ?? 0} icon={LockKeyhole} tone="purple" loading={isLoading} onClick={() => navigate("/certificates")} />
        <MetricCard label="Servers Online" value={m ? `${m.servers}/${m.serversTotal}` : 0} icon={Server} tone="slate" loading={isLoading} onClick={() => navigate("/servers")} sublabel="SSH-connected hosts" />
        <MetricCard label="Pending Notifications" value={m?.pendingNotifications ?? 0} icon={Bell} tone="amber" loading={isLoading} onClick={() => navigate("/notifications")} />
      </div>

      {/* Secondary status cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Expiring Soon" value={m?.expiringSoon ?? 0} icon={Clock} tone="amber" loading={isLoading} onClick={() => navigate("/domains?status=EXPIRING_SOON")} />
        <MetricCard label="Expired" value={m?.expired ?? 0} icon={XCircle} tone="red" loading={isLoading} onClick={() => navigate("/domains?status=CRITICAL")} />
        <MetricCard label="SSL Errors" value={m?.sslErrors ?? 0} icon={ShieldAlert} tone="red" loading={isLoading} onClick={() => navigate("/certificates?filter=ERRORS")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Domain overview table */}
        <Card className="border-border/80 shadow-none lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base font-semibold">Domain Overview</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/domains")}>
              View all
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <TableSkeleton rows={5} cols={6} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Domain</TableHead>
                      <TableHead>SSL Expiry</TableHead>
                      <TableHead>Domain Expiry</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Auto</TableHead>
                      <TableHead className="pr-6 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.overview.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-6">
                          <button
                            className="font-medium text-primary hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            onClick={() => navigate(`/domains/${d.id}`)}
                          >
                            {d.hostname}
                          </button>
                          {d.server && (
                            <p className="text-[11px] text-muted-foreground">{d.server.name}</p>
                          )}
                        </TableCell>
                        <TableCell><DaysBadge days={d.sslDays} kind="SSL" /></TableCell>
                        <TableCell><DaysBadge days={d.domainDays} kind="DOMAIN" /></TableCell>
                        <TableCell><StatusBadge status={d.status} size="sm" /></TableCell>
                        <TableCell><VerificationChip status={d.verificationStatus} /></TableCell>
                        <TableCell><AutomationChip autoRenew={d.autoRenew} autoInstall={d.autoInstall} /></TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/domains/${d.id}`)}>
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status donut + recent activity */}
        <div className="space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Fleet Status</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-52 w-full rounded-lg" />
              ) : donutData.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No domains yet — add your first domain to see fleet health.</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                        {donutData.map((entry) => (
                          <Cell key={entry.key} fill={DONUT_COLORS[entry.key]} />
                        ))}
                      </Pie>
                      <ReTooltip wrapperClassName="text-xs" />
                      <Legend iconSize={8} wrapperClassName="text-xs" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Recent Automation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-3">
              {isLoading ? (
                <Skeleton className="h-28 w-full rounded-lg" />
              ) : data?.recentJobs.length ? (
                data.recentJobs.map((j) => {
                  const Icon = JOB_ICON[j.type] || RefreshCcw;
                  return (
                    <button
                      key={j.id}
                      onClick={() => navigate(`/logs?job=${j.id}`)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{j.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {j.type.replace(/_/g, " ")} · {timeAgo(j.createdAt)}
                        </p>
                      </div>
                      <StatusBadge status={j.status} size="sm" />
                    </button>
                  );
                })
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No automation activity yet.</p>
              )}
              <Button variant="ghost" size="sm" className="w-full" onClick={() => navigate("/logs")}>
                View all logs
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
