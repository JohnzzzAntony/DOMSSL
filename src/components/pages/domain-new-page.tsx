"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, type JobRow, type ServerRow } from "@/lib/client-api";
import { PageHeader, StepProgress } from "@/components/shared/widgets";
import { StatusBadge } from "@/components/shared/status";
import { ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Globe } from "lucide-react";
import { toast } from "sonner";

/**
 * Add New Domain (spec §9) + verification workflow (spec §10).
 * On submit: create record → queue verification → RDAP → SSL → DNS → result.
 */
export function DomainNewPage({ navigate }: { navigate: (to: string) => void }) {
  const queryClient = useQueryClient();
  const [hostname, setHostname] = React.useState("");
  const [environment, setEnvironment] = React.useState("PRODUCTION");
  const [registrar, setRegistrar] = React.useState("Unknown");
  const [sslProvider, setSslProvider] = React.useState("Let's Encrypt");
  const [storedExpiry, setStoredExpiry] = React.useState("");
  const [autoRenew, setAutoRenew] = React.useState(true);
  const [autoInstall, setAutoInstall] = React.useState(true);
  const [dnsAutomation, setDnsAutomation] = React.useState(false);
  const [notifyEmail, setNotifyEmail] = React.useState(true);
  const [notifyWhatsApp, setNotifyWhatsApp] = React.useState(false);
  const [notifyTelegram, setNotifyTelegram] = React.useState(false);
  const [notifySlack, setNotifySlack] = React.useState(false);
  const [threshold, setThreshold] = React.useState(5);
  const [serverId, setServerId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [createdDomainId, setCreatedDomainId] = React.useState<string | null>(null);
  const [resultPhase, setResultPhase] = React.useState<"VERIFIED" | "MISMATCH" | "FAILED" | null>(null);

  const { data: serverData } = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerRow[] }>("/api/servers"),
  });

  // Poll verification job
  const { data: jobData } = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.get<{ job: JobRow }>(`/api/logs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === "SUCCESS" || status === "FAILED" || status === "ROLLED_BACK" ? false : 1200;
    },
  });

  // When job finishes, refresh domain and decide result phase
  React.useEffect(() => {
    const job = jobData?.job;
    if (!job || (job.status !== "SUCCESS" && job.status !== "FAILED")) return;
    (async () => {
      if (createdDomainId) {
        const res = await api.get<{ domain: { verificationStatus: string } }>(`/api/domains/${createdDomainId}`);
        const vs = res.domain.verificationStatus;
        setResultPhase(vs === "MISMATCH" ? "MISMATCH" : vs === "FAILED" ? "FAILED" : "VERIFIED");
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["domains"] });
      }
    })();
  }, [jobData?.job.status, createdDomainId, queryClient]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hostname.trim()) {
      toast.error("Enter a domain name");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ domain: { id: string; hostname: string }; jobId: string }>("/api/domains", {
        hostname: hostname.trim().toLowerCase(),
        environment,
        registrar,
        sslProvider,
        storedDomainExpiry: storedExpiry || undefined,
        autoRenew,
        autoInstall,
        dnsAutomation,
        notifyEmail,
        notifyWhatsApp,
        notifyTelegram,
        notifySlack,
        alertThresholdDays: threshold,
        serverId: serverId || null,
      });
      setCreatedDomainId(res.domain.id);
      setJobId(res.jobId);
      toast.success(`${res.domain.hostname} created — verification running`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add domain");
    } finally {
      setSubmitting(false);
    }
  };

  const job = jobData?.job;

  // ── Verification workflow screen (spec §10) ─────────────────────────
  if (jobId) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={`Verifying ${hostname.toLowerCase()}`} description="RDAP lookup, live SSL inspection and date comparison." />
        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {job?.status === "RUNNING" && <><Loader2 className="h-4 w-4 animate-spin text-sky-600" /> Running verification…</>}
              {resultPhase === "VERIFIED" && <><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Verification Result</>}
              {resultPhase === "MISMATCH" && <><AlertTriangle className="h-5 w-5 text-amber-600" /> Verification requires attention</>}
              {resultPhase === "FAILED" && <><AlertTriangle className="h-5 w-5 text-red-600" /> Verification failed</>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-2">
              <StepProgress steps={job?.steps || []} />
            </div>
            {resultPhase === "MISMATCH" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <p className="font-semibold">Domain expiry mismatch</p>
                <p className="mt-1 leading-relaxed">
                  The discovered registry date differs from the stored value. Review the domain
                  details page and choose <em>Use Discovered Date</em> to accept the authoritative
                  value — the action will be recorded in the audit log.
                </p>
              </div>
            )}
            {resultPhase === "FAILED" && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-semibold">Some checks failed</p>
                <p className="mt-1 leading-relaxed">
                  External verification sources may be unreachable from this network. The domain is
                  saved and can be re-verified any time from its detail page.
                </p>
              </div>
            )}
            {resultPhase && (
              <div className="flex gap-2">
                <Button onClick={() => navigate(`/domains/${createdDomainId}`)}>Continue</Button>
                <Button variant="outline" onClick={() => navigate("/domains")}>Back to Domains</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/domains")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Domains
        </Button>
      </div>
      <PageHeader title="Add New Domain" description="Configure and verify domain and SSL settings." />

      <form onSubmit={submit} className="space-y-5">
        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Domain Information</CardTitle>
            <CardDescription>The system will verify everything against authoritative sources.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="hostname">Domain Name</Label>
              <Input
                id="hostname"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="example.com"
                autoComplete="off"
                required
              />
            </div>
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
              <Label htmlFor="storedExpiry">Stored Domain Expiry (optional)</Label>
              <Input
                id="storedExpiry"
                type="date"
                value={storedExpiry}
                onChange={(e) => setStoredExpiry(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Never trusted blindly — compared against RDAP (spec §49).</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Automation Settings</CardTitle>
            <CardDescription>Automation is enabled after verification (spec §2.7).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><Label htmlFor="autoRenew">Auto Renewal</Label><p className="text-[11px] text-muted-foreground">ACME renewal ≤30 days</p></div>
              <Switch id="autoRenew" checked={autoRenew} onCheckedChange={setAutoRenew} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><Label htmlFor="autoInstall">Auto Installation</Label><p className="text-[11px] text-muted-foreground">Deploy + reload server</p></div>
              <Switch id="autoInstall" checked={autoInstall} onCheckedChange={setAutoInstall} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><Label htmlFor="dnsAutomation">DNS Automation</Label><p className="text-[11px] text-muted-foreground">DNS-01 via Cloudflare</p></div>
              <Switch id="dnsAutomation" checked={dnsAutomation} onCheckedChange={setDnsAutomation} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Notifications &amp; Alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { id: "nEmail", label: "Email", checked: notifyEmail, set: setNotifyEmail },
                { id: "nWhatsApp", label: "WhatsApp", checked: notifyWhatsApp, set: setNotifyWhatsApp },
                { id: "nTelegram", label: "Telegram", checked: notifyTelegram, set: setNotifyTelegram },
                { id: "nSlack", label: "Slack", checked: notifySlack, set: setNotifySlack },
              ].map((ch) => (
                <label
                  key={ch.id}
                  htmlFor={ch.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors hover:bg-muted/50"
                >
                  <Checkbox id={ch.id} checked={ch.checked} onCheckedChange={(v) => ch.set(!!v)} />
                  {ch.label}
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="threshold">Alert Threshold (days)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={1}
                  max={90}
                  value={threshold}
                  onChange={(e) => setThreshold(parseInt(e.target.value) || 5)}
                />
                <p className="text-[11px] text-muted-foreground">5 days is the mandatory critical alert.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Server Assignment</Label>
                <Select value={serverId || "none"} onValueChange={(v) => setServerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select a server" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No server</SelectItem>
                    {serverData?.servers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/domains")}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Globe className="mr-2 h-4 w-4" /> Add Domain &amp; Verify
          </Button>
        </div>
      </form>
    </div>
  );
}
