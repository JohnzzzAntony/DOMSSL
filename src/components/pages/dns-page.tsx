"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { api, timeAgo } from "@/lib/client-api";
import { StatusBadge } from "@/components/shared/status";
import { PageHeader, EmptyState } from "@/components/shared/widgets";
import { Cloud, PlugZap, Plus, Trash2, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

interface DNSProviderRow {
  id: string;
  name: string;
  providerType: string;
  tokenMasked: string | null;
  hasToken: boolean;
  zoneAccess: string;
  zones: string[];
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
}

export function DnsPage() {
  const queryClient = useQueryClient();
  const [connectOpen, setConnectOpen] = React.useState(false);
  const [apiToken, setApiToken] = React.useState("");
  const [zoneAccess, setZoneAccess] = React.useState("ALL_ZONES");
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["dns-providers"],
    queryFn: () => api.get<{ providers: DNSProviderRow[] }>("/api/dns/providers"),
  });

  const connect = async () => {
    if (!apiToken || apiToken.length < 10) {
      toast.error("Enter a valid Cloudflare API token");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ provider: { id: string; status: string; zones: string[]; simulated: boolean; detail: string } }>("/api/dns/providers", {
        providerType: "CLOUDFLARE",
        apiToken,
        zoneAccess,
        zones: [],
      });
      toast.success(res.provider.detail);
      setConnectOpen(false);
      setApiToken("");
      queryClient.invalidateQueries({ queryKey: ["dns-providers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (id: string) => {
    setTestingId(id);
    try {
      const res = await api.post<{ ok: boolean; simulated: boolean; detail: string; zones: string[] }>(`/api/dns/providers/${id}/test`);
      if (res.ok) toast.success(res.detail);
      else toast.error(res.detail);
      queryClient.invalidateQueries({ queryKey: ["dns-providers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTestingId("");
    }
  };

  const removeProvider = async (id: string, name: string) => {
    try {
      await api.delete(`/api/dns/providers/${id}`);
      toast.success(`${name} disconnected`);
      queryClient.invalidateQueries({ queryKey: ["dns-providers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    }
  };

  const p = data?.providers || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="DNS Providers"
        description="Connect DNS APIs to enable DNS-01 certificate automation."
        actions={
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Connect Provider
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      ) : p.length === 0 ? (
        <EmptyState
          icon={Cloud}
          title="No DNS providers connected"
          description="Connect Cloudflare to enable DNS-01 validation for wildcard certificates and automated issuance."
          action={<Button size="sm" onClick={() => setConnectOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Connect Cloudflare</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {p.map((prov) => (
            <Card key={prov.id} className="border-border/80 shadow-none">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                      <Cloud className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{prov.name}</CardTitle>
                      <CardDescription className="text-xs">
                        {prov.hasToken ? `Token ${prov.tokenMasked}` : "No token stored"}
                      </CardDescription>
                    </div>
                  </div>
                  <StatusBadge status={prov.status} size="sm" />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Zones</span>
                  <span className="font-semibold">{prov.zones.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Zone Access</span>
                  <Badge variant="outline" className="text-[11px]">
                    {prov.zoneAccess === "ALL_ZONES" ? "All zones" : "Selected zones"}
                  </Badge>
                </div>
                {prov.zones.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {prov.zones.slice(0, 5).map((z) => (
                      <Badge key={z} variant="secondary" className="font-mono text-[10px]">{z}</Badge>
                    ))}
                    {prov.zones.length > 5 && <Badge variant="secondary" className="text-[10px]">+{prov.zones.length - 5} more</Badge>}
                  </div>
                )}
                {prov.lastError && <p className="text-xs text-red-600">{prov.lastError}</p>}
                <p className="text-[11px] text-muted-foreground">Last tested {timeAgo(prov.lastTestedAt)}</p>
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => testProvider(prov.id)} disabled={testingId === prov.id}>
                    {testingId === prov.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1.5 h-3.5 w-3.5" />}
                    Test Connection
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => removeProvider(prov.id, prov.name)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-dashed border-border/80 shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {["AWS Route 53", "GoDaddy", "Namecheap", "DigitalOcean", "Azure DNS", "Google Cloud DNS"].map((f) => (
            <Badge key={f} variant="outline" className="text-muted-foreground">{f}</Badge>
          ))}
        </CardContent>
      </Card>

      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Cloud className="h-4 w-4" /> Connect Cloudflare</DialogTitle>
            <DialogDescription>
              API tokens are encrypted at rest with AES-256-GCM and never returned to the browser (spec §19).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cfToken">API Token</Label>
              <Input
                id="cfToken"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Cloudflare API token with Zone:DNS:Edit"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Zone Access</Label>
              <Select value={zoneAccess} onValueChange={setZoneAccess}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL_ZONES">All zones</SelectItem>
                  <SelectItem value="SELECTED_ZONES">Selected zones</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Lock className="h-3 w-3" /> Scoped token recommended — Zone.DNS Edit permission only.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectOpen(false)}>Cancel</Button>
            <Button onClick={connect} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test &amp; Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
