"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { api, timeAgo, type DomainRow, type JobRow } from "@/lib/client-api";
import { StatusBadge, DaysBadge, AutomationChip, VerificationChip } from "@/components/shared/status";
import { PageHeader, EmptyState, TableSkeleton, StepProgress } from "@/components/shared/widgets";
import { MoreHorizontal, Plus, RefreshCcw, Search, Globe, ScanLine, Trash2, Eye, Pencil, LockKeyhole, Download } from "lucide-react";
import { toast } from "sonner";

const STATUS_FILTERS = [
  { value: "ALL", label: "All Status" },
  { value: "HEALTHY", label: "Healthy" },
  { value: "EXPIRING_SOON", label: "Expiring Soon" },
  { value: "CRITICAL", label: "Critical / Expired" },
  { value: "SSL_ERROR", label: "SSL Errors" },
  { value: "NO_SSL", label: "No HTTPS" },
  { value: "UNVERIFIED", label: "Unverified" },
  { value: "MISMATCH", label: "Date Mismatch" },
  { value: "AUTOMATION_ON", label: "Automation ON" },
  { value: "AUTOMATION_OFF", label: "Automation OFF" },
];

const ENV_FILTERS = [
  { value: "ALL", label: "All Environments" },
  { value: "PRODUCTION", label: "Production" },
  { value: "STAGING", label: "Staging" },
  { value: "DEVELOPMENT", label: "Development" },
];

export function DomainsPage({
  navigate,
  initialSearch,
  initialStatus,
  openBulk,
  onBulkConsumed,
}: {
  navigate: (to: string) => void;
  initialSearch?: string;
  initialStatus?: string;
  openBulk?: boolean;
  onBulkConsumed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState(initialSearch || "");
  const [status, setStatus] = React.useState(initialStatus || "ALL");
  const [environment, setEnvironment] = React.useState("ALL");
  const [bulkOpen, setBulkOpen] = React.useState(!!openBulk);
  const [bulkInput, setBulkInput] = React.useState("");
  const [bulkJob, setBulkJob] = React.useState<JobRow | null>(null);
  const [bulkRunning, setBulkRunning] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<DomainRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["domains", search, status, environment],
    queryFn: () =>
      api.get<{ domains: DomainRow[] }>(
        `/api/domains?search=${encodeURIComponent(search)}&status=${status}&environment=${environment}`
      ),
    refetchInterval: 15000,
  });

  React.useEffect(() => {
    if (openBulk) setBulkOpen(true);
  }, [openBulk]);

  const parseBulkInput = () =>
    bulkInput
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
      .filter((s) => s.includes("."));

  const runBulkImport = async () => {
    const domains = parseBulkInput();
    if (!domains.length) {
      toast.error("Enter at least one domain");
      return;
    }
    setBulkRunning(true);
    try {
      const res = await api.post<{ added: string[]; skipped: string[] }>("/api/domains/bulk-scan", { domains, addToMonitoring: true });
      toast.success(
        `${res.added.length} domain${res.added.length === 1 ? "" : "s"} added — verification running` +
          (res.skipped.length ? ` (${res.skipped.length} already monitored)` : "")
      );
      queryClient.invalidateQueries({ queryKey: ["domains"] });
      setBulkOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk import failed");
    } finally {
      setBulkRunning(false);
    }
  };

  const runBulkScan = async () => {
    const domains = parseBulkInput();
    if (!domains.length) {
      toast.error("Enter at least one domain");
      return;
    }
    setBulkRunning(true);
    setBulkJob(null);
    try {
      const res = await api.post<{ jobId: string; job: JobRow }>("/api/domains/bulk-scan", { domains });
      setBulkJob(res.job);
      toast.success(`Scan complete — ${res.job.steps?.length ?? domains.length} domains processed`);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk scan failed");
    } finally {
      setBulkRunning(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/domains/${deleteTarget.id}`);
      toast.success(`${deleteTarget.hostname} deleted`);
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const triggerVerify = async (d: DomainRow) => {
    try {
      await api.post(`/api/domains/${d.id}/verify`, {});
      toast.success(`Verification queued for ${d.hostname}`);
      queryClient.invalidateQueries({ queryKey: ["domains"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verify failed");
    }
  };

  const triggerRenew = async (d: DomainRow) => {
    if (!d.certificateId) {
      toast.error("No certificate found for this domain — request one first");
      return;
    }
    try {
      await api.post(`/api/certificates/${d.certificateId}/renew`);
      toast.success(`Renewal queued for ${d.hostname}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Renewal failed");
    }
  };

  const bulkSummary = React.useMemo(() => {
    if (!bulkJob?.steps) return null;
    const total = bulkJob.steps.length;
    const ok = bulkJob.steps.filter((s) => s.status === "DONE").length;
    const warned = bulkJob.steps.filter((s) => s.status === "WARNED").length;
    const failed = bulkJob.steps.filter((s) => s.status === "FAILED").length;
    return { total, ok, warned, failed };
  }, [bulkJob]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Domains"
        description="Manage and monitor all domains."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
              <ScanLine className="mr-1.5 h-4 w-4" /> Scan Multiple
            </Button>
            <Button size="sm" onClick={() => navigate("/domains/new")}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Domain
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search domain..."
            className="h-9 pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Filter by environment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENV_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : !data?.domains.length ? (
            <EmptyState
              icon={Globe}
              title="No domains found"
              description="Add your first domain to start monitoring expiry dates, SSL certificates and automation."
              action={
                <Button size="sm" onClick={() => navigate("/domains/new")}>
                  <Plus className="mr-1.5 h-4 w-4" /> Add Domain
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Domain</TableHead>
                    <TableHead>Registrar</TableHead>
                    <TableHead>SSL Provider</TableHead>
                    <TableHead>SSL Expiry</TableHead>
                    <TableHead>Domain Expiry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Automation</TableHead>
                    <TableHead>Last Checked</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.domains.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-2">
                          <button
                            className="font-medium text-primary hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            onClick={() => navigate(`/domains/${d.id}`)}
                          >
                            {d.hostname}
                          </button>
                          {d.isDemo && (
                            <span className="rounded bg-violet-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-violet-600 border border-violet-200">
                              Demo
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">{d.environment}</p>
                      </TableCell>
                      <TableCell className="text-sm">{d.registrar}</TableCell>
                      <TableCell className="text-sm">{d.sslProvider}</TableCell>
                      <TableCell><DaysBadge days={d.sslDays} kind="SSL" /></TableCell>
                      <TableCell><DaysBadge days={d.domainDays} kind="DOMAIN" /></TableCell>
                      <TableCell className="space-y-1">
                        <StatusBadge status={d.status} size="sm" />
                        <div><VerificationChip status={d.verificationStatus} /></div>
                      </TableCell>
                      <TableCell><AutomationChip autoRenew={d.autoRenew} autoInstall={d.autoInstall} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(d.lastCheckedAt)}</TableCell>
                      <TableCell className="pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/domains/${d.id}`)}>
                            <Eye className="mr-1 h-3 w-3" /> View
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="More actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => triggerVerify(d)}>
                                <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Verify Now
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => triggerRenew(d)}>
                                <LockKeyhole className="mr-2 h-3.5 w-3.5" /> Renew SSL
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/domains/${d.id}?tab=ssl`)}>
                                <Download className="mr-2 h-3.5 w-3.5" /> Install SSL
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/domains/${d.id}?tab=history`)}>
                                <Eye className="mr-2 h-3.5 w-3.5" /> View Logs
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => navigate(`/domains/${d.id}?edit=1`)}>
                                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(d)}>
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bulk scanner dialog (spec §48) */}
      <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) onBulkConsumed?.(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" /> Scan Multiple Domains
            </DialogTitle>
            <DialogDescription>
              Paste domains, one per line. Scan Only runs RDAP + live SSL checks; Add to Monitoring imports them and verifies each one.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={bulkInput}
            onChange={(e) => setBulkInput(e.target.value)}
            rows={8}
            placeholder={"example.com\nexample.org\nexample.net"}
            className="font-mono text-sm"
            aria-label="Domains to scan, one per line"
          />
          {bulkRunning && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Scanning {bulkInput.split("\n").filter((s) => s.trim()).length} domains…</p>
              <Progress value={60} className="h-1.5" />
            </div>
          )}
          {bulkJob?.steps && (
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              <StepProgress steps={bulkJob.steps} />
            </div>
          )}
          {bulkSummary && (
            <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted p-3 text-center text-sm">
              <div><p className="font-bold">{bulkSummary.total}</p><p className="text-xs text-muted-foreground">scanned</p></div>
              <div><p className="font-bold text-emerald-600">{bulkSummary.ok}</p><p className="text-xs text-muted-foreground">verified</p></div>
              <div><p className="font-bold text-amber-600">{bulkSummary.warned}</p><p className="text-xs text-muted-foreground">warnings</p></div>
              <div><p className="font-bold text-red-600">{bulkSummary.failed}</p><p className="text-xs text-muted-foreground">critical</p></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
            <Button variant="secondary" onClick={runBulkScan} disabled={bulkRunning}>
              {bulkRunning ? "Working…" : "Scan Only"}
            </Button>
            <Button onClick={runBulkImport} disabled={bulkRunning}>
              <Plus className="mr-1 h-4 w-4" /> Add to Monitoring
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (spec §47) */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Domain</DialogTitle>
            <DialogDescription>
              This will remove monitoring and automation for <strong>{deleteTarget?.hostname}</strong>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete Domain"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
