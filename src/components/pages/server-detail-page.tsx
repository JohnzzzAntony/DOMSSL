"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, fmtDateTime, timeAgo, type ServerRow, type JobRow } from "@/lib/client-api";
import { StatusBadge } from "@/components/shared/status";
import { PageHeader, StepProgress } from "@/components/shared/widgets";
import {
  ArrowLeft,
  PlugZap,
  RefreshCcw,
  Globe,
  LockKeyhole,
  History,
  Wrench,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

export function ServerDetailPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const queryClient = useQueryClient();
  const [busyOp, setBusyOp] = React.useState("");
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["server", id],
    queryFn: () => api.get<{ server: ServerRow & { deployments?: Array<{ id: string; status: string; certificate?: { commonName: string }; createdAt: string }>; backups?: Array<{ id: string; label: string; path: string; createdAt: string }>; jobs?: JobRow[] } }>(`/api/servers/${id}`),
    refetchInterval: 20000,
  });

  const { data: jobData } = useQuery({
    queryKey: ["job", activeJobId],
    queryFn: () => api.get<{ job: JobRow }>(`/api/logs/${activeJobId}`),
    enabled: !!activeJobId,
    refetchInterval: (q) => {
      const st = q.state.data?.job.status;
      return st === "SUCCESS" || st === "FAILED" || st === "ROLLED_BACK" ? false : 1200;
    },
  });

  const s = data?.server;

  const runOperation = async (operation: string, label: string) => {
    setBusyOp(operation);
    try {
      if (operation === "TEST_SSH") {
        const res = await api.post<{ result: { connected: boolean; error?: string; simulated?: boolean } }>(`/api/servers/${id}/test`);
        if (res.result.connected) {
          toast.success(`SSH connection verified${res.result.simulated ? " (simulated transport)" : ""}`);
        } else {
          toast.error(`SSH test failed: ${res.result.error}`);
        }
        refetch();
      } else {
        const res = await api.post<{ jobId: string }>(`/api/servers/${id}/operations`, { operation });
        setActiveJobId(res.jobId);
        toast.success(`${label} queued`);
      }
      queryClient.invalidateQueries({ queryKey: ["server", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusyOp("");
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (!s) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Server not found</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/servers")}>Back to Servers</Button>
      </div>
    );
  }

  const ops = [
    { op: "TEST_SSH", label: "Test SSH", icon: PlugZap },
    { op: s.webServer === "Apache" ? "CHECK_APACHE" : "CHECK_NGINX", label: `Check ${s.webServer}`, icon: Wrench },
    { op: "RELOAD_WEB_SERVER", label: `Reload ${s.webServer}`, icon: RefreshCcw },
    { op: "VERIFY_SSL", label: "Verify SSL", icon: LockKeyhole },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/servers")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Servers
        </Button>
      </div>

      <PageHeader
        title={s.name}
        description={`${s.username}@${s.host}:${s.port} · ${s.operatingSystem} · ${s.webServer}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {ops.map((o) => (
              <Button key={o.op} variant="outline" size="sm" onClick={() => runOperation(o.op, o.label)} disabled={!!busyOp}>
                {busyOp === o.op ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <o.icon className="mr-1.5 h-4 w-4" />}
                {o.label}
              </Button>
            ))}
          </div>
        }
      />

      {activeJobId && jobData?.job && (
        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              Operation Progress <StatusBadge status={jobData.job.status} size="sm" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepProgress steps={jobData.job.steps || []} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Server Status", value: <StatusBadge status={s.status} size="sm" /> },
          { label: "Operating System", value: <p className="text-sm font-semibold">{s.operatingSystem}</p> },
          { label: "Web Server", value: <p className="text-sm font-semibold">{s.webServer}</p> },
          { label: "SSH", value: <p className="text-sm font-semibold">{s.sshVerified ? "Connected" : "Not tested"}</p> },
          { label: "Domains", value: <p className="text-sm font-semibold">{s.domains?.length ?? 0}</p> },
          { label: "Last Health Check", value: <p className="text-xs font-medium">{timeAgo(s.lastHealthCheck)}</p> },
        ].map((item) => (
          <Card key={item.label} className="border-border/80 shadow-none">
            <CardContent className="p-4">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <div className="mt-1.5">{item.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="domains">
        <TabsList className="bg-white">
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="certificates">Certificates</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="domains" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Domain</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.domains?.length ? (
                    s.domains.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-6 font-medium">{d.hostname}</TableCell>
                        <TableCell><StatusBadge status={d.status} size="sm" /></TableCell>
                        <TableCell className="pr-6 text-right">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/domains/${d.id}`)}>
                            <Globe className="mr-1 h-3 w-3" /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No domains assigned to this server.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="certificates" className="mt-4 space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Deployments</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Certificate</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.deployments?.length ? (
                    s.deployments.map((dep) => (
                      <TableRow key={dep.id}>
                        <TableCell className="pl-6 text-xs">{fmtDateTime(dep.createdAt)}</TableCell>
                        <TableCell className="text-sm font-medium">{dep.certificate?.commonName}</TableCell>
                        <TableCell><StatusBadge status={dep.status} size="sm" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No deployments on this server yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Encrypted Backups</CardTitle>
              <p className="text-xs text-muted-foreground">Created before every certificate installation — retention: last 5.</p>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {s.backups?.length ? (
                s.backups.map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{b.label}</p>
                      <p className="font-mono text-[11px] text-muted-foreground">{b.path}</p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">AES-256-GCM · {fmtDateTime(b.createdAt)}</Badge>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No backups yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Connection Configuration</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Host</span><span className="font-mono text-xs font-medium">{s.host}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Port</span><span className="font-medium">{s.port}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Username</span><span className="font-medium">{s.username}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Auth Type</span><span className="font-medium">{s.authType === "SSH_KEY" ? "SSH Key" : "Password"}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2"><span className="text-muted-foreground">Credentials</span><span className="text-xs font-medium text-emerald-700">Encrypted at rest (AES-256-GCM) — never exposed</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4" /> Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-3">
              {s.jobs?.length ? (
                s.jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => navigate(`/logs?job=${j.id}`)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="font-medium">{j.title}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {timeAgo(j.createdAt)} <StatusBadge status={j.status} size="sm" />
                    </span>
                  </button>
                ))
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">No activity recorded.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
