"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { api, useHashRoute, type ApiUser } from "@/lib/client-api";
import { AppShell } from "@/components/app/app-shell";
import { LoginPage } from "@/components/app/login-page";
import { DashboardPage } from "@/components/pages/dashboard-page";
import { DomainsPage } from "@/components/pages/domains-page";
import { DomainNewPage } from "@/components/pages/domain-new-page";
import { DomainDetailPage } from "@/components/pages/domain-detail-page";
import { CertificatesPage } from "@/components/pages/certificates-page";
import { CertificateNewPage } from "@/components/pages/certificate-new-page";
import { CertificateDetailPage } from "@/components/pages/certificate-detail-page";
import { ServersPage } from "@/components/pages/servers-page";
import { ServerDetailPage } from "@/components/pages/server-detail-page";
import { DnsPage } from "@/components/pages/dns-page";
import { NotificationsPage } from "@/components/pages/notifications-page";
import { LogsPage } from "@/components/pages/logs-page";
import { ReportsPage } from "@/components/pages/reports-page";
import { SettingsPage } from "@/components/pages/settings-page";

/**
 * CertGuard — Domain & SSL Manager (single-route SPA with hash routing).
 * Route format: #/dashboard, #/domains, #/domains/:id, #/domains/new, etc.
 */
export default function Home() {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5000 },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" richColors closeButton />
    </QueryClientProvider>
  );
}

function App() {
  const { path, navigate } = useHashRoute();
  const [user, setUser] = React.useState<ApiUser | null | undefined>(undefined); // undefined = loading

  React.useEffect(() => {
    api
      .get<{ user: ApiUser | null }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
      navigate("/dashboard");
    }
  }, [navigate]);

  // Session check in flight
  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />
          <p className="text-sm text-muted-foreground">Loading CertGuard…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u as ApiUser)} />;
  }

  // ── Route resolution ────────────────────────────────────────────────
  const [routePath, queryString] = path.split("?");
  const params = new URLSearchParams(queryString || "");
  const segments = (routePath || "/dashboard").split("/").filter(Boolean);

  let page: React.ReactNode;
  let activePath = "/" + (segments[0] || "dashboard");

  if (segments.length === 0 || segments[0] === "dashboard") {
    page = <DashboardPage navigate={navigate} />;
  } else if (segments[0] === "domains") {
    if (segments.length === 1) {
      page = (
        <DomainsPage
          navigate={navigate}
          initialSearch={params.get("search") || undefined}
          initialStatus={params.get("status") || undefined}
          openBulk={params.get("action") === "bulk"}
          onBulkConsumed={() => navigate("/domains")}
        />
      );
    } else if (segments[1] === "new") {
      page = <DomainNewPage navigate={navigate} />;
    } else {
      page = <DomainDetailPage id={segments[1]} navigate={navigate} initialTab={params.get("tab") || undefined} />;
    }
  } else if (segments[0] === "certificates") {
    if (segments.length === 1) {
      page = <CertificatesPage navigate={navigate} initialFilter={params.get("filter") || undefined} />;
    } else if (segments[1] === "new") {
      page = <CertificateNewPage navigate={navigate} />;
    } else {
      page = <CertificateDetailPage id={segments[1]} navigate={navigate} />;
    }
  } else if (segments[0] === "servers") {
    if (segments.length === 1) {
      page = <ServersPage navigate={navigate} />;
    } else {
      page = <ServerDetailPage id={segments[1]} navigate={navigate} />;
    }
  } else if (segments[0] === "dns") {
    page = <DnsPage />;
  } else if (segments[0] === "notifications") {
    page = <NotificationsPage />;
  } else if (segments[0] === "logs") {
    page = <LogsPage navigate={navigate} jobId={params.get("job") || undefined} />;
  } else if (segments[0] === "reports") {
    page = <ReportsPage />;
  } else if (segments[0] === "settings") {
    page = <SettingsPage userRole={user.role} />;
  } else {
    page = <DashboardPage navigate={navigate} />;
    activePath = "/dashboard";
  }

  return (
    <AppShell user={user} path={activePath} navigate={navigate} onLogout={logout}>
      {page}
    </AppShell>
  );
}
