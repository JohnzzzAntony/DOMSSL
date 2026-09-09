"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, fmtDate, fmtDateTime, timeAgo, type DomainRow, type JobRow, type ServerRow, type CertificateHistoryEntry } from "@/lib/client-api";
import { StatusBadge, VerificationChip, DaysBadge } from "@/components/shared/status";
import { PageHeader, StepProgress } from "@/components/shared/widgets";
import {
  ArrowLeft,
  RefreshCcw,
  Pencil,
  MoreHorizontal,
  CheckCircle2,
  AlertTriangle,
  CalendarClock,
  Server as ServerIcon,
  LockKeyhole,
  History as HistoryIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface DomainDetail {
  id: string;
  hostname: string;
  environment: string;
  registrar: string;
  sslProvider: string;
  registeredAt: string | null;
  expiresAt: string | null;
  verifiedExpiresAt: string | null;
  registrarExpiresAt: string | null;
  verificationStatus: string;
  status: string;
  autoRenew: boolean;
  autoInstall: boolean;
  dnsAutomation: boolean;
  alertThresholdDays: number;
  server: ServerRow | null;
  serverId: string | null;
  lastCheckedAt: string | null;
  lastSslCheckAt: string | null;
  lastDomainCheckAt: string | null;
  isDemo: boolean;
  certificates: Array<{
    id: string;
    commonName: string;
    issuer: string;
    subject: string;
    serialNumber: string | null;
    fingerprint: string | null;
    signatureAlgorithm: string | null;
    keyType: string | null;
    tlsVersion: string | null;
    validFrom: string;
    validUntil: string;
    sans: string;
    status: string;
    installationStatus: string;
    autoRenew: boolean;
    verificationStatus: string;
    history: CertificateHistoryEntry[];
  }>;
  verificationResults: Array<{
    id: string;
    checkType: string;
    source: string;
    verified: boolean;
    discoveredValue: string | null;
    storedValue: string | null;
    matched: boolean | null;
    error: string | null;
    createdAt: string;
  }>;
  jobs: JobRow[];
}

export function DomainDetailPage({
  id,
  navigate,
  initialTab,
}: {
  id: string;
  navigate: (to: string) => void;
  initialTab?: string;
}) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [verifyJobId, setVerifyJobId] = React.useState<string | null>(null);
  const [acceptOpen, setAcceptOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["domain", id],
    queryFn: () => api.get<{ domain: DomainDetail }>(`/api/domains/${id}`),
    refetchInterval: 20000,
  });

  const { data: serverData } = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerRow[] }>("/api/servers"),
  });

  const { data: verifyJobData } = useQuery({
    queryKey: ["job", verifyJobId],
    queryFn: () => api.get<{ job: JobRow }>(`/api/logs/${verifyJobId}`),
    enabled: !!verifyJobId,
    refetchInterval: (q) => {
      const st = q.state.data?.job.status;
      return st === "SUCCESS" || st === "FAILED" || st === "ROLLED_BACK" ? false : 1200;
    },
  });

  React.useEffect(() => {
    const st = verifyJobData?.job?.status;
    if (st === "SUCCESS" || st === "FAILED" || st === "ROLLED_BACK") {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }, [verifyJobData?.job?.status, refetch, queryClient]);

  const d = data?.domain;
  const cert = d?.certificates?.[0];
  const latestRdap = d?.verificationResults?.find((v) => v.checkType === "RDAP" && v.verified);

  const triggerVerify = async () => {
    try {
      const res = await api.post<{ jobId: string }>(`/api/domains/${id}/verify`, {});
      setVerifyJobId(res.jobId);
      toast.success("Verification running");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const acceptDiscoveredDate = async () => {
    if (!latestRdap?.discoveredValue) return;
    try {
      await api.patch(`/api/domains/${id}`, { expiresAt: new Date(latestRdap.discoveredValue).toISOString() });
      await api.post(`/api/domains/${id}/verify`, { waitForResult: true });
      toast.success("Stored date updated from discovered RDAP value — recorded in audit log");
      setAcceptOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const toggleField = async (field: string, value: boolean) => {
    try {
      await api.patch(`/api/domains/${id}`, { [field]: value });
      refetch();
      toast.success("Domain updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const deleteDomain = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/domains/${id}`);
      toast.success("Domain deleted");
      navigate("/domains");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return <div className="space-y-4"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (!d) {
    return (
      <div className="py-16 text-center">
        <p className="font-semibold">Domain not found</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/domains")}>Back to Domains</Button>
      </div>
    );
  }

  const mismatch = d.verificationStatus === "MISMATCH";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/domains")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Domains
        </Button>
      </div>

      <PageHeader
        title={d.hostname}
        description={`${d.environment} · ${d.registrar}${d.isDemo ? " · Demo data" : ""}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1.5 h-4 w-4" /> Edit
            </Button>
            <Button size="sm" onClick={triggerVerify}>
              <RefreshCcw className="mr-1.5 h-4 w-4" /> Verify Now
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-4 w-4 text-red-600" />
            </Button>
          </>
        }
      />

      {/* Top verification panel (spec §11) */}
      <Card className={`border shadow-none ${mismatch ? "border-amber-200 bg-amber-50/60" : d.verificationStatus === "VERIFIED" ? "border-emerald-200 bg-emerald-50/60" : "border-border"}`}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {d.verificationStatus === "VERIFIED" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div>
              <p className="text-sm font-semibold">
                {d.verificationStatus === "VERIFIED"
                  ? "Dates Verified"
                  : d.verificationStatus === "MISMATCH"
                    ? "Date Mismatch Detected"
                    : d.verificationStatus === "FAILED"
                      ? "Verification Failed"
                      : "Not Yet Verified"}
              </p>
              <p className="text-xs text-muted-foreground">
                {d.verificationStatus === "VERIFIED"
                  ? "Domain and SSL expiry dates match authoritative sources."
                  : d.verificationStatus === "MISMATCH"
                    ? "The discovered registry date differs from the stored value — review below."
                    : "Run a verification to compare stored values against RDAP and the live certificate."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            Last checked: {timeAgo(d.lastCheckedAt)}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={triggerVerify}>
              Recheck
            </Button>
          </div>
        </CardContent>
      </Card>

      {verifyJobId && verifyJobData?.job && (
        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              Verification Pipeline
              <StatusBadge status={verifyJobData.job.status} size="sm" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StepProgress steps={verifyJobData.job.steps || []} />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={initialTab || "overview"}>
        <TabsList className="bg-white">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="domain">Domain</TabsTrigger>
          <TabsTrigger value="ssl">SSL Certificate</TabsTrigger>
          <TabsTrigger value="server">Server</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4 grid gap-4 md:grid-cols-3">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-muted-foreground" /> Domain Expiry
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Stored</span><span className="font-medium">{fmtDate(d.expiresAt)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">RDAP / Registry</span><span className="font-medium">{d.registrarExpiresAt ? fmtDate(d.registrarExpiresAt) : "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Days Remaining</span><DaysBadge days={d.expiresAt ? Math.ceil((new Date(d.expiresAt).getTime() - Date.now()) / 86400000) : null} kind="DOMAIN" /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Verification</span><VerificationChip status={d.verificationStatus} /></div>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <LockKeyhole className="h-4 w-4 text-muted-foreground" /> SSL Certificate
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {cert ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Issuer</span><span className="font-medium">{cert.issuer}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Valid Until</span><span className="font-medium">{fmtDate(cert.validUntil)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Days Remaining</span><DaysBadge days={Math.ceil((new Date(cert.validUntil).getTime() - Date.now()) / 86400000)} kind="SSL" /></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Status</span><StatusBadge status={cert.status} size="sm" /></div>
                </>
              ) : (
                <p className="text-muted-foreground">No certificate discovered yet — run Verify Now.</p>
              )}
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ServerIcon className="h-4 w-4 text-muted-foreground" /> Automation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <Label htmlFor="swRenew" className="cursor-pointer">Auto Renewal</Label>
                <Switch id="swRenew" checked={d.autoRenew} onCheckedChange={(v) => toggleField("autoRenew", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="swInstall" className="cursor-pointer">Auto Installation</Label>
                <Switch id="swInstall" checked={d.autoInstall} onCheckedChange={(v) => toggleField("autoInstall", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="swDns" className="cursor-pointer">DNS Automation</Label>
                <Switch id="swDns" checked={d.dnsAutomation} onCheckedChange={(v) => toggleField("dnsAutomation", v)} />
              </div>
              <p className="text-[11px] text-muted-foreground">Critical alert threshold: {d.alertThresholdDays} days (5-day minimum enforced)</p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Domain tab — stored vs discovered (spec §49) */}
        <TabsContent value="domain" className="mt-4 space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Domain Date Verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Stored Date</p>
                  <p className="mt-1 font-semibold">{fmtDate(d.expiresAt)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Discovered (RDAP)</p>
                  <p className="mt-1 font-semibold">{latestRdap?.discoveredValue ? fmtDate(new Date(latestRdap.discoveredValue).toISOString()) : "—"}</p>
                  {latestRdap && <Badge variant="outline" className="mt-1.5 text-[10px]">{latestRdap.source}</Badge>}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Verified Date</p>
                  <p className="mt-1 font-semibold">{fmtDate(d.verifiedExpiresAt)}</p>
                </div>
              </div>
              {mismatch && latestRdap?.discoveredValue && (
                <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-amber-800">
                    <strong>Date mismatch.</strong> RDAP says {fmtDate(new Date(latestRdap.discoveredValue).toISOString())} but the stored value is {fmtDate(d.expiresAt)}.
                  </p>
                  <Button size="sm" onClick={() => setAcceptOpen(true)}>Use Discovered Date</Button>
                </div>
              )}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registration Details</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Registrar</span><span className="font-medium">{d.registrar}</span></div>
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Registered</span><span className="font-medium">{fmtDate(d.registeredAt)}</span></div>
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">SSL Provider</span><span className="font-medium">{d.sslProvider}</span></div>
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Status</span><StatusBadge status={d.status} size="sm" /></div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SSL tab */}
        <TabsContent value="ssl" className="mt-4 space-y-4">
          {cert ? (
            <Card className="border-border/80 shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base font-semibold">
                  Certificate Record
                  <StatusBadge status={cert.status} size="sm" />
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Issuer</span><span className="font-medium">{cert.issuer}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Key Type</span><span className="font-medium">{cert.keyType || "—"}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Valid From</span><span className="font-medium">{fmtDate(cert.validFrom)}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Valid Until</span><span className="font-medium">{fmtDate(cert.validUntil)}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">TLS Version</span><span className="font-medium">{cert.tlsVersion || "—"}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Signature</span><span className="max-w-48 truncate font-medium" title={cert.signatureAlgorithm || ""}>{cert.signatureAlgorithm || "—"}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2"><span className="text-muted-foreground">Serial Number</span><span className="max-w-64 truncate font-mono text-xs font-medium" title={cert.serialNumber || ""}>{cert.serialNumber || "—"}</span></div>
                <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2 sm:col-span-2"><span className="text-muted-foreground">Fingerprint (SHA-256)</span><span className="max-w-72 truncate font-mono text-xs font-medium" title={cert.fingerprint || ""}>{cert.fingerprint || "—"}</span></div>
                <div className="sm:col-span-2">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">SAN Entries</p>
                  <div className="flex flex-wrap gap-1.5">
                    {JSON.parse(cert.sans || "[]").map((san: string) => (
                      <Badge key={san} variant="outline" className="font-mono text-[11px]">{san}</Badge>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await api.post(`/api/certificates/${cert.id}/renew`);
                        toast.success("Renewal queued");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Renewal failed");
                      }
                    }}
                  >
                    <RefreshCcw className="mr-1.5 h-3.5 w-3.5" /> Renew SSL
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/certificates/${cert.id}`)}>
                    View Certificate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border/80 shadow-none"><CardContent className="py-10 text-center text-sm text-muted-foreground">No certificate record — run Verify Now to inspect the live endpoint.</CardContent></Card>
          )}
        </TabsContent>

        {/* Server tab */}
        <TabsContent value="server" className="mt-4 space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Assigned Server</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {d.server ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{d.server.name}</p>
                      <p className="text-xs text-muted-foreground">{d.server.operatingSystem} · {d.server.webServer}</p>
                    </div>
                    <StatusBadge status={d.server.status} size="sm" />
                  </div>
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Certificate Installed</span><span className="font-medium">{cert?.installationStatus === "INSTALLED" ? "Yes" : "Not yet"}</span></div>
                  <div className="flex justify-between rounded-md bg-muted/60 px-3 py-2"><span className="text-muted-foreground">Last SSL Check</span><span className="font-medium">{timeAgo(d.lastSslCheckAt)}</span></div>
                  <Button variant="outline" size="sm" onClick={() => navigate(`/servers/${d.server!.id}`)}>View Server</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-muted-foreground">No server assigned. Assign one to enable automatic certificate installation.</p>
                  <Select
                    value={d.serverId || "none"}
                    onValueChange={async (v) => {
                      try {
                        await api.patch(`/api/domains/${id}`, { serverId: v === "none" ? null : v });
                        refetch();
                        toast.success("Server assignment updated");
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Update failed");
                      }
                    }}
                  >
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No server</SelectItem>
                      {serverData?.servers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <HistoryIcon className="h-4 w-4" /> Verification Results
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Check</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Discovered</TableHead>
                    <TableHead>Stored</TableHead>
                    <TableHead className="pr-6">Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.verificationResults.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No verification runs recorded yet.</TableCell></TableRow>
                  )}
                  {d.verificationResults.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="pl-6 text-xs">{fmtDateTime(v.createdAt)}</TableCell>
                      <TableCell className="text-xs font-medium">{v.checkType}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{v.source}</Badge></TableCell>
                      <TableCell className="text-xs">{v.discoveredValue || "—"}</TableCell>
                      <TableCell className="text-xs">{v.storedValue || "—"}</TableCell>
                      <TableCell className="pr-6">
                        {v.error ? (
                          <span className="text-xs text-red-600">{v.error}</span>
                        ) : v.matched === true ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Match</span>
                        ) : v.matched === false ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /> Mismatch</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Recent Automation Jobs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 p-3">
              {d.jobs.map((j) => (
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
              ))}
              {d.jobs.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No jobs for this domain yet.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit dialog */}
      <EditDomainDialog
        domain={d}
        servers={serverData?.servers || []}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={() => {
          setEditOpen(false);
          refetch();
        }}
      />

      {/* Accept discovered date confirmation */}
      <Dialog open={acceptOpen} onOpenChange={setAcceptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Use Discovered Date</DialogTitle>
            <DialogDescription>
              Replace the stored expiry with the RDAP-discovered value ({latestRdap?.discoveredValue ? fmtDate(new Date(latestRdap.discoveredValue).toISOString()) : "—"}).
              This action is recorded in the audit log (spec §49).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcceptOpen(false)}>Cancel</Button>
            <Button onClick={acceptDiscoveredDate}>Update Stored Date</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Domain</DialogTitle>
            <DialogDescription>
              This will remove monitoring and automation for <strong>{d.hostname}</strong>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteDomain} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDomainDialog({
  domain,
  servers,
  open,
  onOpenChange,
  onSaved,
}: {
  domain: DomainDetail;
  servers: ServerRow[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [environment, setEnvironment] = React.useState(domain.environment);
  const [registrar, setRegistrar] = React.useState(domain.registrar);
  const [sslProvider, setSslProvider] = React.useState(domain.sslProvider);
  const [expiresAt, setExpiresAt] = React.useState(domain.expiresAt ? domain.expiresAt.slice(0, 10) : "");
  const [serverId, setServerId] = React.useState(domain.serverId || "none");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEnvironment(domain.environment);
      setRegistrar(domain.registrar);
      setSslProvider(domain.sslProvider);
      setExpiresAt(domain.expiresAt ? domain.expiresAt.slice(0, 10) : "");
      setServerId(domain.serverId || "none");
    }
  }, [open, domain]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/domains/${domain.id}`, {
        environment,
        registrar,
        sslProvider,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        serverId: serverId === "none" ? null : serverId,
      });
      toast.success("Domain updated — audit entry recorded");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {domain.hostname}</DialogTitle>
          <DialogDescription>Changes are recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Environment</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PRODUCTION">Production</SelectItem>
                <SelectItem value="STAGING">Staging</SelectItem>
                <SelectItem value="DEVELOPMENT">Development</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Registrar</Label>
            <Select value={registrar} onValueChange={setRegistrar}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["GoDaddy", "Namecheap", "Cloudflare", "Porkbun", "Other", "Unknown"].map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>SSL Provider</Label>
            <Select value={sslProvider} onValueChange={setSslProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Let's Encrypt", "ZeroSSL", "Existing Certificate", "Other"].map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Stored Domain Expiry</Label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Assigned Server</Label>
            <Select value={serverId} onValueChange={setServerId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No server</SelectItem>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
