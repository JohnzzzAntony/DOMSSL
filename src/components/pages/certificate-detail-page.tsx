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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, fmtDate, fmtDateTime, timeAgo, type CertificateRow, type ServerRow } from "@/lib/client-api";
import { StatusBadge, DaysBadge } from "@/components/shared/status";
import { PageHeader } from "@/components/shared/widgets";
import {
  ArrowLeft,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Upload,
  Undo2,
  History,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export function CertificateDetailPage({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const queryClient = useQueryClient();
  const [installOpen, setInstallOpen] = React.useState(false);
  const [rollbackOpen, setRollbackOpen] = React.useState(false);
  const [serverChoice, setServerChoice] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["certificate", id],
    queryFn: () => api.get<{ certificate: CertificateRow & { history?: Array<{ id: string; event: string; detail: string | null; actor: string; createdAt: string }>; deployments?: Array<{ id: string; status: string; server?: { id: string; name: string; webServer: string }; configTestPassed: boolean; liveVerified: boolean; error?: string | null; createdAt: string }> } }>(`/api/certificates/${id}`),
    refetchInterval: 20000,
  });

  const { data: serverData } = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerRow[] }>("/api/servers"),
  });

  const c = data?.certificate;

  const renew = async () => {
    setBusy(true);
    try {
      await api.post(`/api/certificates/${id}/renew`);
      toast.success("Renewal queued — follow progress in Automation Logs");
      queryClient.invalidateQueries({ queryKey: ["certificate", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Renewal failed");
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    try {
      await api.post(`/api/certificates/${id}/install`, { serverId: serverChoice || null });
      toast.success("Installation queued — backup, config test and verification run automatically");
      setInstallOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Installation failed");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    setBusy(true);
    try {
      await api.post(`/api/certificates/${id}/rollback`, { serverId: serverChoice || undefined });
      toast.success("Rollback queued");
      setRollbackOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rollback failed");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><div className="h-8 w-72 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (!c) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Certificate not found</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/certificates")}>Back to Certificates</Button>
      </div>
    );
  }

  const checks = [
    { label: "Valid Certificate", ok: c.status !== "EXPIRED" && c.daysRemaining > 0 },
    { label: "Hostname Match", ok: c.hostnameMatch },
    { label: "Chain Valid", ok: c.chainValid },
    { label: "TLS Supported", ok: !!c.tlsVersion },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/certificates")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Certificates
        </Button>
      </div>

      <PageHeader
        title={`SSL Certificate — ${c.commonName}`}
        description={`${c.issuer} · ${c.keyType || "unknown key type"} · issued ${fmtDate(c.validFrom)}`}
        actions={
          <>
            <Button size="sm" onClick={renew} disabled={busy}>
              <RefreshCcw className="mr-1.5 h-4 w-4" /> Renew
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setServerChoice(c.domain ? "" : ""); setInstallOpen(true); }}>
              <Upload className="mr-1.5 h-4 w-4" /> Install
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRollbackOpen(true)}>
              <Undo2 className="mr-1.5 h-4 w-4" /> Rollback
            </Button>
          </>
        }
      />

      {/* Status strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {checks.map((ch) => (
          <div key={ch.label} className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${ch.ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"}`}>
            {ch.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="h-4 w-4 shrink-0 text-red-600" />}
            <span className={ch.ok ? "font-medium text-emerald-800" : "font-medium text-red-700"}>{ch.label}</span>
          </div>
        ))}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-white">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details">Certificate Details</TabsTrigger>
          <TabsTrigger value="chain">Chain &amp; SAN</TabsTrigger>
          <TabsTrigger value="installation">Installation</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-3">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Validity</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Valid From</span><span className="font-medium">{fmtDate(c.validFrom)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span className="font-medium">{fmtDate(c.validUntil)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Days Remaining</span><DaysBadge days={c.daysRemaining} kind="SSL" /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={c.status} size="sm" /></div>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Issuance</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span className="font-medium">{c.provider}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Issuer</span><span className="font-medium">{c.issuer}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="font-medium">{c.keyType || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">TLS</span><span className="font-medium">{c.tlsVersion || "—"}</span></div>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-sm font-semibold">Automation</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Auto Renew</span><span className="font-medium">{c.autoRenew ? "ON" : "OFF"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Installation</span><StatusBadge status={c.installationStatus} size="sm" /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Verification</span><span className="inline-flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {c.verificationStatus}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Last Checked</span><span className="text-xs">{timeAgo(c.lastCheckedAt)}</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Certificate Details</CardTitle></CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Subject</span><span className="font-medium">{c.subject}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Signature Algorithm</span><span className="max-w-56 truncate font-medium" title={c.signatureAlgorithm || ""}>{c.signatureAlgorithm || "—"}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2"><span className="text-muted-foreground">Serial Number</span><span className="max-w-72 truncate font-mono text-xs font-medium">{c.serialNumber || "—"}</span></div>
              <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2"><span className="text-muted-foreground">Fingerprint (SHA-256)</span><span className="max-w-80 truncate font-mono text-xs font-medium" title={c.fingerprint || ""}>{c.fingerprint || "—"}</span></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chain" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">SAN Entries</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {c.sans.map((san) => <Badge key={san} variant="outline" className="font-mono text-xs">{san}</Badge>)}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="installation" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Deployment History</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Config Test</TableHead>
                    <TableHead className="pr-6">Live Verified</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.deployments?.length ? (
                    c.deployments.map((dep) => (
                      <TableRow key={dep.id}>
                        <TableCell className="pl-6 text-xs">{fmtDateTime(dep.createdAt)}</TableCell>
                        <TableCell className="text-sm">{dep.server?.name} <span className="text-xs text-muted-foreground">({dep.server?.webServer})</span></TableCell>
                        <TableCell><StatusBadge status={dep.status} size="sm" /></TableCell>
                        <TableCell>{dep.configTestPassed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</TableCell>
                        <TableCell className="pr-6">{dep.liveVerified ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Never deployed — use Install to push to a server.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold"><History className="h-4 w-4" /> Certificate History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {c.history?.length ? (
                c.history.map((h) => (
                  <div key={h.id} className="flex gap-3 border-l-2 border-muted pl-3">
                    <div>
                      <p className="text-sm font-medium">
                        {h.event.replace(/_/g, " ")}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">{fmtDateTime(h.createdAt)} · {h.actor}</span>
                      </p>
                      {h.detail && <p className="text-xs text-muted-foreground">{h.detail}</p>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No history entries.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Install dialog (spec §47) */}
      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Install Certificate</DialogTitle>
            <DialogDescription>
              The existing certificate will be backed up before installation, the configuration
              tested, and the server reloaded only if the test passes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Server</p>
            <Select value={serverChoice || undefined} onValueChange={setServerChoice}>
              <SelectTrigger><SelectValue placeholder="Select a server" /></SelectTrigger>
              <SelectContent>
                {serverData?.servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallOpen(false)}>Cancel</Button>
            <Button onClick={install} disabled={!serverChoice || busy}>{busy ? "Queueing…" : "Install Certificate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback dialog */}
      <Dialog open={rollbackOpen} onOpenChange={setRollbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rollback Certificate</DialogTitle>
            <DialogDescription>
              This will restore the previous certificate and configuration from the latest encrypted backup.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Server</p>
            <Select value={serverChoice || undefined} onValueChange={setServerChoice}>
              <SelectTrigger><SelectValue placeholder="Select a server" /></SelectTrigger>
              <SelectContent>
                {serverData?.servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollbackOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={rollback} disabled={!serverChoice || busy}>{busy ? "Queueing…" : "Rollback"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
