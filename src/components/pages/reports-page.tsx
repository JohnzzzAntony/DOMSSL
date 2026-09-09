"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/client-api";
import { PageHeader } from "@/components/shared/widgets";
import { BarChart3, Download, FileText } from "lucide-react";
import { toast } from "sonner";

const REPORTS = [
  { key: "ssl-expiry", label: "SSL Expiry Report", desc: "All certificates with issuer, validity and days remaining." },
  { key: "domain-expiry", label: "Domain Expiry Report", desc: "Stored vs verified domain expiry dates across the fleet." },
  { key: "failed-renewals", label: "Failed Renewals", desc: "Renewal, installation and issuance failures with errors." },
  { key: "server-health", label: "Server Health", desc: "Server status, SSH connectivity and deployment counts." },
  { key: "automation-success", label: "Automation Success Rate", desc: "Success/failed/rolled-back ratios per job type." },
  { key: "notification-history", label: "Notification History", desc: "Every alert with delivery status and channels." },
];

export function ReportsPage() {
  const [active, setActive] = React.useState("ssl-expiry");

  const { data, isLoading } = useQuery({
    queryKey: ["report", active],
    queryFn: () => api.get<{ title: string; rows: Array<Record<string, string | number>>; generatedAt: string }>(`/api/reports?report=${active}`),
  });

  const rows = data?.rows || [];
  const headers = rows.length ? Object.keys(rows[0]) : [];

  const exportCsv = () => {
    window.open(`/api/reports?report=${active}&format=csv`, "_blank");
    toast.success("CSV export generated");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Operational insight across domains, certificates, automation and servers." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Card
            key={r.key}
            className={`cursor-pointer border-border/80 shadow-none transition-all hover:shadow-sm ${active === r.key ? "ring-2 ring-primary/40" : ""}`}
            onClick={() => setActive(r.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setActive(r.key)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <FileText className="h-4 w-4 text-muted-foreground" /> {r.label}
              </CardTitle>
              <CardDescription className="text-xs">{r.desc}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card className="border-border/80 shadow-none">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4" /> {data?.title || "Report"}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {rows.length} rows · generated {data ? new Date(data.generatedAt).toLocaleTimeString("en-GB") : "—"}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="h-56 animate-pulse rounded-xl bg-muted" />
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No data available for this report.</p>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-white">
                  <TableRow className="hover:bg-transparent">
                    {headers.map((h) => (
                      <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {headers.map((h) => (
                        <TableCell key={h} className="whitespace-nowrap text-xs">{String(row[h])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
