"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { api, type DomainRow, type ServerRow } from "@/lib/client-api";
import { PageHeader } from "@/components/shared/widgets";
import { ArrowLeft, LockKeyhole, Loader2 } from "lucide-react";
import { toast } from "sonner";

/** Request SSL Certificate (spec §14) — ACME issuance with HTTP-01 / DNS-01. */
export function CertificateNewPage({ navigate }: { navigate: (to: string) => void }) {
  const [domainId, setDomainId] = React.useState("");
  const [provider, setProvider] = React.useState("Let's Encrypt");
  const [certType, setCertType] = React.useState("SINGLE");
  const [validation, setValidation] = React.useState("HTTP_01");
  const [includeWww, setIncludeWww] = React.useState(true);
  const [autoCreateDns, setAutoCreateDns] = React.useState(true);
  const [installAutomatically, setInstallAutomatically] = React.useState(true);
  const [serverId, setServerId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const { data: domainData } = useQuery({
    queryKey: ["domains", "all"],
    queryFn: () => api.get<{ domains: DomainRow[] }>("/api/domains?status=ALL&environment=ALL"),
  });
  const { data: serverData } = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerRow[] }>("/api/servers"),
  });

  const selectedDomain = domainData?.domains.find((d) => d.id === domainId);
  const dnsConnected = selectedDomain?.dnsAutomation;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainId) {
      toast.error("Select a domain");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/certificates/request", {
        domainId,
        provider,
        certType,
        validation,
        includeWww,
        autoCreateDnsRecord: autoCreateDns,
        installAutomatically,
        serverId: serverId || null,
      });
      toast.success("Certificate request queued — follow progress in Automation Logs");
      navigate("/logs");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/certificates")}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to Certificates
        </Button>
      </div>
      <PageHeader title="Request SSL Certificate" description="Get a new SSL certificate from an ACME provider or use an existing certificate." />

      <form onSubmit={submit}>
        <Card className="border-border/80 shadow-none">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base"><LockKeyhole className="h-4 w-4" /> Certificate Request</CardTitle>
            <CardDescription>Free, publicly-trusted certificates via Let's Encrypt (ACME).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Domain</Label>
                <Select value={domainId || undefined} onValueChange={setDomainId}>
                  <SelectTrigger><SelectValue placeholder="Select a domain" /></SelectTrigger>
                  <SelectContent>
                    {domainData?.domains.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.hostname}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Certificate Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Let's Encrypt">Let's Encrypt</SelectItem>
                    <SelectItem value="ZeroSSL">ZeroSSL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Certificate Type</Label>
                <Select value={certType} onValueChange={setCertType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SINGLE">Single Domain</SelectItem>
                    <SelectItem value="WILDCARD">Wildcard</SelectItem>
                    <SelectItem value="MULTI_DOMAIN">Multi-Domain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Validation Method</Label>
                <Select value={validation} onValueChange={setValidation}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HTTP_01">HTTP-01</SelectItem>
                    <SelectItem value="DNS_01">DNS-01</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {validation === "DNS_01" && (
              <div className="space-y-3 rounded-lg border bg-slate-50/60 p-4">
                <p className="text-sm font-semibold">DNS-01 Automation</p>
                {dnsConnected ? (
                  <p className="text-xs text-muted-foreground">
                    Cloudflare DNS automation is enabled for {selectedDomain?.hostname} — the challenge
                    TXT record will be created and validated automatically.
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">
                    DNS automation is not enabled on this domain. Connect Cloudflare under DNS Providers
                    and enable DNS automation on the domain, or switch to HTTP-01.
                  </p>
                )}
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                  <Checkbox checked={autoCreateDns} onCheckedChange={(v) => setAutoCreateDns(!!v)} />
                  Automatically create DNS challenge record
                </label>
              </div>
            )}

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="installAuto">Install automatically</Label>
                  <p className="text-[11px] text-muted-foreground">Backup → upload → config test → reload → verify</p>
                </div>
                <Switch id="installAuto" checked={installAutomatically} onCheckedChange={setInstallAutomatically} />
              </div>
              {installAutomatically && (
                <div className="space-y-1.5">
                  <Label>Server</Label>
                  <Select value={serverId || undefined} onValueChange={setServerId}>
                    <SelectTrigger><SelectValue placeholder="Use domain's server or select" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Use domain&apos;s assigned server</SelectItem>
                      {serverData?.servers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name} ({s.webServer})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={includeWww} onCheckedChange={(v) => setIncludeWww(!!v)} />
              Include www.{selectedDomain?.hostname || "domain"} SAN
            </label>
          </CardContent>
        </Card>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/certificates")}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Request Certificate
          </Button>
        </div>
      </form>
    </div>
  );
}
