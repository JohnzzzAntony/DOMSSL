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
import { api, fmtDateTime, timeAgo, type NotificationRow } from "@/lib/client-api";
import { PageHeader, EmptyState } from "@/components/shared/widgets";
import { Bell, CheckCheck, Send, Loader2, Mail, MessageSquare, Send as TelegramIcon, Hash } from "lucide-react";
import { toast } from "sonner";

const CHANNEL_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; fields: Array<{ key: string; label: string; type?: string }> }> = {
  EMAIL: {
    label: "Email (SMTP)",
    icon: Mail,
    fields: [
      { key: "smtpHost", label: "SMTP Host" },
      { key: "smtpPort", label: "SMTP Port" },
      { key: "from", label: "From Address" },
      { key: "recipients", label: "Recipients (comma separated)" },
    ],
  },
  WHATSAPP: {
    label: "WhatsApp",
    icon: MessageSquare,
    fields: [
      { key: "apiUrl", label: "Gateway API URL" },
      { key: "apiKey", label: "API Key", type: "password" },
      { key: "phone", label: "Recipient Phone" },
    ],
  },
  TELEGRAM: {
    label: "Telegram",
    icon: TelegramIcon,
    fields: [
      { key: "botToken", label: "Bot Token", type: "password" },
      { key: "chatId", label: "Chat ID" },
    ],
  },
  SLACK: {
    label: "Slack",
    icon: Hash,
    fields: [{ key: "webhookUrl", label: "Webhook URL", type: "password" }],
  },
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const [marking, setMarking] = React.useState(false);
  const [testing, setTesting] = React.useState("");
  const [sslThresholds, setSslThresholds] = React.useState("30, 15, 7, 5");
  const [domainThresholds, setDomainThresholds] = React.useState("60, 30, 15, 7, 5");
  const [savingThresholds, setSavingThresholds] = React.useState(false);
  const [channelDrafts, setChannelDrafts] = React.useState<Record<string, Record<string, string>>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: NotificationRow[]; unread: number }>("/api/notifications"),
    refetchInterval: 20000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => api.get<{ settings: { sslThresholds: number[]; domainThresholds: number[]; mandatoryAlertDays: number } }>("/api/notifications/settings"),
  });

  React.useEffect(() => {
    if (settingsData?.settings) {
      setSslThresholds(settingsData.settings.sslThresholds.join(", "));
      setDomainThresholds(settingsData.settings.domainThresholds.join(", "));
    }
  }, [settingsData]);

  const markAllRead = async () => {
    setMarking(true);
    try {
      await api.patch("/api/notifications", { markAllRead: true });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("All notifications marked as read");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setMarking(false);
    }
  };

  const saveThresholds = async () => {
    setSavingThresholds(true);
    try {
      const parse = (s: string) => s.split(",").map((x) => parseInt(x.trim())).filter((n) => !isNaN(n) && n > 0);
      await api.patch("/api/notifications/settings", {
        sslThresholds: parse(sslThresholds),
        domainThresholds: parse(domainThresholds),
        mandatoryAlertDays: 5,
      });
      toast.success("Thresholds saved — the mandatory 5-day critical alert is always enforced");
      queryClient.invalidateQueries({ queryKey: ["notification-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingThresholds(false);
    }
  };

  const testNotification = async (channel?: string) => {
    setTesting(channel || "all");
    try {
      if (channel) {
        const res = await api.post<{ ok: boolean; simulated: boolean; detail: string }>("/api/notifications/channels", { type: channel });
        if (res.ok) toast.success(res.detail);
        else toast.error(res.detail);
      } else {
        await api.post("/api/notifications");
        toast.success("Test notification issued across enabled channels");
      }
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting("");
    }
  };

  const saveChannel = async (type: string, enabled: boolean) => {
    try {
      await api.patch("/api/notifications/channels", {
        type,
        enabled,
        config: channelDrafts[type] || {},
      });
      toast.success(`${CHANNEL_META[type].label} ${enabled ? "enabled" : "disabled"} — config encrypted at rest`);
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const toggleChannelEnabled = async (type: string, enabled: boolean) => {
    try {
      await api.patch("/api/notifications/channels", { type, enabled, config: {} });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    } catch {
      toast.error("Failed to update channel");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Expiry alerts across Email, WhatsApp, Telegram and Slack."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => testNotification()} disabled={!!testing}>
              {testing === "all" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              Send Test
            </Button>
            <Button variant="outline" size="sm" onClick={markAllRead} disabled={marking || !data?.unread}>
              <CheckCheck className="mr-1.5 h-4 w-4" /> Mark All Read
            </Button>
          </>
        }
      />

      <Tabs defaultValue="inbox">
        <TabsList className="bg-white">
          <TabsTrigger value="inbox">Inbox {data?.unread ? `(${data.unread})` : ""}</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="thresholds">Alert Thresholds</TabsTrigger>
        </TabsList>

        {/* Inbox */}
        <TabsContent value="inbox" className="mt-4 space-y-3">
          {isLoading ? (
            <div className="h-40 animate-pulse rounded-xl bg-muted" />
          ) : !data?.notifications.length ? (
            <EmptyState icon={Bell} title="No notifications" description="Alerts will appear here when certificates or domains approach expiry." />
          ) : (
            data.notifications.map((n) => (
              <Card key={n.id} className={`border-border/80 shadow-none ${!n.read ? "border-l-4 border-l-sky-500" : ""}`}>
                <CardContent className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={n.severity === "CRITICAL" ? "border-red-200 bg-red-50 text-red-700" : n.severity === "WARNING" ? "border-amber-200 bg-amber-50 text-amber-700" : ""}>
                        {n.severity}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{n.type.replace(/_/g, " ")}</Badge>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-sky-500" aria-label="unread" />}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold">{n.title}</p>
                    <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{n.message}</p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {fmtDateTime(n.createdAt)} · delivery: {n.deliveryStatus} · via {n.channels.join(", ") || "no channels"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {/* Channels */}
        <TabsContent value="channels" className="mt-4 grid gap-4 md:grid-cols-2">
          {Object.entries(CHANNEL_META).map(([type, meta]) => (
            <ChannelCard
              key={type}
              type={type}
              meta={meta}
              drafts={channelDrafts[type] || {}}
              onDraft={(k, v) => setChannelDrafts((prev) => ({ ...prev, [type]: { ...(prev[type] || {}), [k]: v } }))}
              onSave={(enabled) => saveChannel(type, enabled)}
              onToggle={(enabled) => toggleChannelEnabled(type, enabled)}
              onTest={() => testNotification(type)}
              testing={testing === type}
            />
          ))}
        </TabsContent>

        {/* Thresholds */}
        <TabsContent value="thresholds" className="mt-4 max-w-xl space-y-4">
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Alert Thresholds</CardTitle>
              <CardDescription>
                Notifications fire when remaining days crosses each threshold. The <strong>5-day critical alert</strong> is mandatory and cannot be disabled (spec §64.12).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="sslT">SSL Expiry Alerts (days)</Label>
                <Input id="sslT" value={sslThresholds} onChange={(e) => setSslThresholds(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Defaults: 30, 15, 7, 5 days before expiry</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="domT">Domain Expiry Alerts (days)</Label>
                <Input id="domT" value={domainThresholds} onChange={(e) => setDomainThresholds(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Defaults: 60, 30, 15, 7, 5 days before expiry</p>
              </div>
              <Button onClick={saveThresholds} disabled={savingThresholds}>
                {savingThresholds && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Thresholds
              </Button>
            </CardContent>
          </Card>
          <Card className="border-border/80 shadow-none">
            <CardHeader className="pb-3"><CardTitle className="text-base font-semibold">Example Templates (spec §21)</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="rounded-lg bg-muted/60 p-3 font-mono leading-relaxed">
                SSL Certificate Expiring<br /><br />
                Domain: example.com<br />
                Certificate: Let&apos;s Encrypt<br />
                Expires: 14 Sep 2026<br />
                Remaining: 5 days<br /><br />
                Automatic renewal: Enabled<br />
                Server: Production Server 01
              </div>
              <div className="rounded-lg bg-red-50 p-3 font-mono leading-relaxed text-red-800">
                CRITICAL: SSL Certificate Expires Tomorrow<br /><br />
                Domain: example.com<br />
                Automatic renewal: FAILED<br />
                Reason: DNS validation failed.<br /><br />
                Immediate action required.
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChannelCard({
  type,
  meta,
  drafts,
  onDraft,
  onSave,
  onToggle,
  onTest,
  testing,
}: {
  type: string;
  meta: { label: string; icon: React.ComponentType<{ className?: string }>; fields: Array<{ key: string; label: string; type?: string }> };
  drafts: Record<string, string>;
  onDraft: (key: string, value: string) => void;
  onSave: (enabled: boolean) => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  testing: boolean;
}) {
  const { data } = useQuery({
    queryKey: ["channels"],
    queryFn: () => api.get<{ channels: Array<{ id: string; type: string; enabled: boolean; status: string; lastTestedAt: string | null }> }>("/api/notifications/channels"),
  });
  const channel = data?.channels.find((c) => c.type === type);
  const [enabled, setEnabled] = React.useState(false);

  React.useEffect(() => {
    if (channel) setEnabled(channel.enabled);
  }, [channel]);

  return (
    <Card className="border-border/80 shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
              <meta.icon className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">{meta.label}</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                {channel?.status === "CONNECTED" ? `Enabled · tested ${timeAgo(channel.lastTestedAt)}` : "Not configured"}
              </p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => { setEnabled(v); onToggle(v); }} aria-label={`Toggle ${meta.label}`} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {meta.fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs">{f.label}</Label>
            <Input
              type={f.type || "text"}
              value={drafts[f.key] || ""}
              onChange={(e) => onDraft(f.key, e.target.value)}
              className="h-8 text-xs"
              placeholder={f.type === "password" ? "••••••••" : ""}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onSave(enabled)} className="h-8 text-xs">
            Save Configuration
          </Button>
          <Button size="sm" variant="ghost" onClick={onTest} disabled={testing} className="h-8 text-xs">
            {testing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Send className="mr-1.5 h-3 w-3" />}
            Test
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
