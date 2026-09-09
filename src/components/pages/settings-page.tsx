"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { api, fmtDateTime } from "@/lib/client-api";
import { StatusBadge } from "@/components/shared/status";
import { PageHeader } from "@/components/shared/widgets";
import { Loader2, Save, ShieldCheck, Activity } from "lucide-react";
import { toast } from "sonner";

interface SettingsData {
  general: { organizationName: string; timezone: string };
  security: { twoFactorRequired: boolean; sessionTimeoutMinutes: number; ipAllowlist: string; loginProtection: boolean; auditLogging: boolean };
  automation: { renewalThresholdDays: number };
  integrations: Array<{ id: string; key: string; name: string; category: string; status: string; lastTestedAt: string | null }>;
  users: Array<{ id: string; email: string; name: string; role: string; isActive: boolean; lastLoginAt: string | null; createdAt: string }>;
}

export function SettingsPage({ userRole }: { userRole: string }) {
  const queryClient = useQueryClient();
  const [orgName, setOrgName] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [renewalThreshold, setRenewalThreshold] = React.useState(30);
  const [twoFactorRequired, setTwoFactorRequired] = React.useState(false);
  const [loginProtection, setLoginProtection] = React.useState(true);
  const [auditLogging, setAuditLogging] = React.useState(true);
  const [sessionTimeout, setSessionTimeout] = React.useState(10080);
  const [ipAllowlist, setIpAllowlist] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsData>("/api/settings"),
  });

  const { data: healthData } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<{ checks: Array<{ name: string; status: string; detail: string }>; checkedAt: string }>("/api/health"),
    refetchInterval: 30000,
  });

  React.useEffect(() => {
    if (data) {
      setOrgName(data.general.organizationName);
      setTimezone(data.general.timezone);
      setRenewalThreshold(data.automation.renewalThresholdDays);
      setTwoFactorRequired(data.security.twoFactorRequired);
      setLoginProtection(data.security.loginProtection);
      setAuditLogging(data.security.auditLogging);
      setSessionTimeout(data.security.sessionTimeoutMinutes);
      setIpAllowlist(data.security.ipAllowlist);
    }
  }, [data]);

  const { data: auditData } = useQuery({
    queryKey: ["audit"],
    queryFn: () => api.get<{ logs: Array<{ id: string; actor: string; action: string; detail: string | null; result: string; createdAt: string }> }>("/api/audit?limit=80"),
  });

  const canManage = ["OWNER", "ADMIN"].includes(userRole);

  const saveGeneral = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", { organizationName: orgName, timezone });
      toast.success("General settings saved");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveSecurity = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", {
        twoFactorRequired,
        loginProtection,
        auditLogging,
        sessionTimeoutMinutes: sessionTimeout,
        ipAllowlist,
      });
      toast.success("Security settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const saveAutomation = async () => {
    setSaving(true);
    try {
      await api.patch("/api/settings", { renewalThresholdDays: renewalThreshold });
      toast.success("Renewal threshold saved — renewals will start before the 5-day critical window");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Settings" description="General, integrations, security, users and system health." />

      <Tabs defaultValue="general">
        <TabsList className="bg-white">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 max-w-xl">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Organization</CardTitle>
              <CardDescription>Displayed across the control panel and reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org">Organization Name</Label>
                <Input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!canManage} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Input id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} disabled={!canManage} placeholder="UTC" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="renew">Renewal Threshold (days before expiry)</Label>
                <Input
                  id="renew"
                  type="number"
                  min={7}
                  max={60}
                  value={renewalThreshold}
                  onChange={(e) => setRenewalThreshold(parseInt(e.target.value) || 30)}
                  disabled={!canManage}
                />
                <p className="text-[11px] text-muted-foreground">Start ACME renewals early — do not wait for the 5-day critical window (spec §15).</p>
              </div>
              <Button onClick={saveGeneral} disabled={saving || !canManage}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data?.integrations.map((i) => (
            <Card key={i.id} className="border-border/80 shadow-none">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-semibold">{i.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {i.category} {i.lastTestedAt ? `· tested ${fmtDateTime(i.lastTestedAt)}` : ""}
                  </p>
                </div>
                <StatusBadge status={i.status} size="sm" />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="security" className="mt-4 max-w-xl">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-4 w-4" /> Security</CardTitle>
              <CardDescription>Hardening controls for this security-sensitive application (spec §32).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Require 2FA for privileged users</Label>
                  <p className="text-[11px] text-muted-foreground">Owners and admins must enroll a second factor</p>
                </div>
                <Switch checked={twoFactorRequired} onCheckedChange={setTwoFactorRequired} disabled={!canManage} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Login protection</Label>
                  <p className="text-[11px] text-muted-foreground">Rate-limit and lock out repeated failed attempts</p>
                </div>
                <Switch checked={loginProtection} onCheckedChange={setLoginProtection} disabled={!canManage} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label>Audit logging</Label>
                  <p className="text-[11px] text-muted-foreground">Record every sensitive action (spec §34)</p>
                </div>
                <Switch checked={auditLogging} onCheckedChange={setAuditLogging} disabled={!canManage} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timeout">Session Timeout (minutes)</Label>
                <Input id="timeout" type="number" value={sessionTimeout} onChange={(e) => setSessionTimeout(parseInt(e.target.value) || 10080)} disabled={!canManage} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="allowlist">IP Allowlist</Label>
                <Input id="allowlist" value={ipAllowlist} onChange={(e) => setIpAllowlist(e.target.value)} disabled={!canManage} placeholder="203.0.113.0/24, 198.51.100.5" />
                <p className="text-[11px] text-muted-foreground">Comma-separated IPs or CIDRs. Empty = allow all.</p>
              </div>
              <Button onClick={saveSecurity} disabled={saving || !canManage}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Security Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Users &amp; Roles (RBAC)</CardTitle>
              <CardDescription>Owner → Admin → Operator → Viewer, with granular permissions (spec §32).</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6">Last Login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="pl-6">
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={u.role === "OWNER" ? "border-violet-200 bg-violet-50 text-violet-700" : ""}>
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={u.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}>
                          {u.isActive ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-xs text-muted-foreground">{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "never"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="system" className="mt-4 space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Activity className="h-4 w-4" /> System Health
              </CardTitle>
              <CardDescription>Live indicators for database, worker, scheduler and integrations (spec §55).</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {healthData?.checks.map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">{c.detail}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${c.status === "OK" ? "text-emerald-700" : c.status === "WARN" ? "text-amber-700" : "text-red-700"}`}>
                    {c.status === "OK" ? "✓" : c.status === "WARN" ? "⚠" : "✗"} {c.status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Audit Trail</CardTitle>
              <CardDescription>Latest sensitive actions with actor, result and timestamp (spec §34).</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="pr-6">Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditData?.logs.slice(0, 30).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="pl-6 text-xs">{fmtDateTime(l.createdAt)}</TableCell>
                      <TableCell className="text-xs">{l.actor}</TableCell>
                      <TableCell className="text-xs font-medium">{l.action}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={l.result === "SUCCESS" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>
                          {l.result}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-72 truncate pr-6 text-xs text-muted-foreground">{l.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
