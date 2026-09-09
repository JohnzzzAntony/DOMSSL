"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { api, timeAgo, type ServerRow } from "@/lib/client-api";
import { StatusBadge } from "@/components/shared/status";
import { PageHeader, EmptyState, TableSkeleton } from "@/components/shared/widgets";
import { Plus, Server, Eye, Loader2, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";

export function ServersPage({ navigate }: { navigate: (to: string) => void }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<ServerRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["servers"],
    queryFn: () => api.get<{ servers: ServerRow[] }>("/api/servers"),
    refetchInterval: 20000,
  });

  const deleteServer = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/api/servers/${deleteTarget.id}`);
      toast.success("Server deleted");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["servers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Servers"
        description="Manage servers and SSH connections."
        actions={
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Server
          </Button>
        }
      />

      <Card className="border-border/80 shadow-none">
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={4} cols={7} />
          ) : !data?.servers.length ? (
            <EmptyState
              icon={Server}
              title="No servers configured"
              description="Add a server with SSH credentials to enable automated certificate installation."
              action={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add Server</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Name</TableHead>
                    <TableHead>IP / Host</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Web Server</TableHead>
                    <TableHead>Domains</TableHead>
                    <TableHead>Last Check</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.servers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="pl-6">
                        <button className="font-medium text-primary hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" onClick={() => navigate(`/servers/${s.id}`)}>
                          {s.name}
                        </button>
                        <p className="text-[11px] text-muted-foreground">{s.operatingSystem}</p>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.host}:{s.port}</TableCell>
                      <TableCell><StatusBadge status={s.status} size="sm" /></TableCell>
                      <TableCell className="text-sm">{s.webServer}</TableCell>
                      <TableCell className="text-sm font-medium">{s.domainCount ?? 0}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(s.lastHealthCheck)}</TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/servers/${s.id}`)}>
                            <Eye className="mr-1 h-3 w-3" /> View
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label="Delete server"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
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

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(id) => {
          setAddOpen(false);
          queryClient.invalidateQueries({ queryKey: ["servers"] });
          navigate(`/servers/${id}`);
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Server</DialogTitle>
            <DialogDescription>
              Remove <strong>{deleteTarget?.name}</strong> and its stored encrypted credentials? Domains assigned to it will be unassigned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteServer} disabled={deleting}>{deleting ? "Deleting…" : "Delete Server"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddServerDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [host, setHost] = React.useState("");
  const [port, setPort] = React.useState(22);
  const [username, setUsername] = React.useState("deploy");
  const [authType, setAuthType] = React.useState("SSH_KEY");
  const [privateKey, setPrivateKey] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [operatingSystem, setOperatingSystem] = React.useState("Ubuntu");
  const [webServer, setWebServer] = React.useState("Nginx");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const payload = () => ({
    name,
    host,
    port,
    username,
    authType,
    ...(authType === "SSH_KEY" ? { privateKey } : { password }),
    operatingSystem,
    webServer,
  });

  const save = async (thenNavigate: boolean) => {
    if (!name || !host || !username) {
      toast.error("Name, host and username are required");
      return;
    }
    if (authType === "SSH_KEY" && !privateKey.includes("PRIVATE KEY")) {
      toast.error("Paste a valid SSH private key (PEM format)");
      return;
    }
    if (authType === "PASSWORD" && !password) {
      toast.error("Enter the SSH password");
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ server: { id: string } }>("/api/servers", payload());
      if (thenNavigate) {
        onSaved(res.server.id);
      } else {
        toast.success("Server saved — credentials encrypted at rest (AES-256-GCM)");
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!name || !host || !username) {
      toast.error("Fill name, host and username first");
      return;
    }
    setTesting(true);
    try {
      const created = await api.post<{ server: { id: string } }>("/api/servers", payload());
      const result = await api.post<{ result: { connected: boolean; detail?: string; simulated?: boolean; error?: string; osVersion?: string } }>(`/api/servers/${created.server.id}/test`);
      const r = result.result;
      if (r.connected) {
        toast.success(`SSH connection OK${r.osVersion ? ` — ${r.osVersion}` : ""}${r.simulated ? " (simulated transport)" : ""}`);
      } else {
        toast.error(`SSH test failed: ${r.error || "unknown error"}`);
      }
      onOpenChange(false);
      onSaved(created.server.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Server</DialogTitle>
          <DialogDescription>
            Credentials are encrypted at rest (AES-256-GCM) and never returned to the browser (spec §33).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sName">Server Name</Label>
            <Input id="sName" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production Server 01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sHost">Host</Label>
            <Input id="sHost" value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sPort">Port</Label>
            <Input id="sPort" type="number" value={port} onChange={(e) => setPort(parseInt(e.target.value) || 22)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sUser">Username</Label>
            <Input id="sUser" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="deploy" />
          </div>
          <div className="space-y-1.5">
            <Label>Authentication</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SSH_KEY">SSH Key</SelectItem>
                <SelectItem value="PASSWORD">Password</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Operating System</Label>
            <Select value={operatingSystem} onValueChange={setOperatingSystem}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Ubuntu", "Debian", "CentOS/RHEL", "Other"].map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Web Server</Label>
            <Select value={webServer} onValueChange={setWebServer}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Nginx">Nginx</SelectItem>
                <SelectItem value="Apache">Apache</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType === "SSH_KEY" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sKey">SSH Private Key</Label>
              <Textarea
                id="sKey"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                rows={4}
                placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----"}
                className="font-mono text-xs"
              />
            </div>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sPass">SSH Password</Label>
              <Input id="sPass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex w-full justify-between">
            <Button variant="outline" onClick={testConnection} disabled={testing || saving}>
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Test Connection
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => save(false)} disabled={saving}>Save Server</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
