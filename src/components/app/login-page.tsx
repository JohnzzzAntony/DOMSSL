"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Loader2, Globe, LockKeyhole, RefreshCcw, Bell } from "lucide-react";
import { api } from "@/lib/client-api";

export function LoginPage({ onLogin }: { onLogin: (user: unknown) => void }) {
  const [email, setEmail] = React.useState("admin@example.com");
  const [password, setPassword] = React.useState("Admin123!");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post<{ user: unknown }>("/api/auth/login", { email, password });
      onLogin(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Globe, title: "Domain expiry via RDAP", text: "Authoritative registry lookups, never trust stored dates blindly." },
    { icon: LockKeyhole, title: "Live SSL inspection", text: "Connect to every endpoint and inspect the actual certificate." },
    { icon: RefreshCcw, title: "Auto-renewal & install", text: "Let's Encrypt ACME, Nginx/Apache deploy, config-test, rollback." },
    { icon: Bell, title: "5-day critical alerts", text: "Email, WhatsApp, Telegram and Slack — before it's too late." },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Left — brand panel */}
      <div className="hidden flex-1 flex-col justify-between bg-slate-950 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">CertGuard</p>
            <p className="text-xs text-slate-400">Domain &amp; SSL Manager</p>
          </div>
        </div>
        <div className="max-w-lg">
          <h1 className="text-3xl font-bold leading-tight tracking-tight">
            Centralized control for every domain, certificate and server.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Verify against authoritative sources, monitor expiries continuously, automate renewals
            with safe deployment and rollback — and never miss the 5-day critical window again.
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.title} className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
                  <f.icon className="h-4 w-4 text-slate-300" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-slate-500">Enterprise DevOps · Security Monitoring · Certificate Lifecycle</p>
      </div>

      {/* Right — login form */}
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="h-4.5 w-4.5" />
            </div>
            <p className="text-lg font-bold">CertGuard</p>
          </div>
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="text-xl">Sign in</CardTitle>
              <CardDescription>Access your domain &amp; SSL control panel.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                {error && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sign in
                </Button>
              </form>
              <div className="mt-5 rounded-lg border border-dashed bg-slate-50 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="font-semibold text-foreground">Demo accounts</p>
                <p className="mt-1">Owner — admin@example.com / Admin123!</p>
                <p>Operator — operator@example.com / Operator123!</p>
                <p>Viewer — viewer@example.com / Viewer123!</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
