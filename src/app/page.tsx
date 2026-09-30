"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { useHashRoute, type ApiUser } from "@/lib/client-api";
import { AppShell } from "@/components/app/app-shell";
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

/** Static public user — no authentication required. */
const PUBLIC_USER: ApiUser = {
  id: "public",
  email: "public@certguard.local",
  name: "CertGuard",
  role: "OWNER",
  twoFactorEnabled: false,
};

/**
 * CertGuard — Domain & SSL Manager (single-route SPA with hash routing).
 * Authentication is disabled — all features are publicly accessible.
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
    page = <SettingsPage userRole={PUBLIC_USER.role} />;
  } else {
    page = <DashboardPage navigate={navigate} />;
    activePath = "/dashboard";
  }

  return (
    <AppShell user={PUBLIC_USER} path={activePath} navigate={navigate}>
      {page}
    </AppShell>
  );
}

