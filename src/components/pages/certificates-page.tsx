"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { api, fmtDate, type CertificateRow } from "@/lib/client-api";
import { StatusBadge, DaysBadge } from "@/components/shared/status";
import { PageHeader, EmptyState, TableSkeleton } from "@/components/shared/widgets";
import { Search, LockKeyhole, Plus, Eye } from "lucide-react";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "VALID", label: "Valid" },
  { value: "EXPIRING", label: "Expiring" },
  { value: "EXPIRED", label: "Expired" },
  { value: "ERRORS", label: "Errors" },
];

export function CertificatesPage({
  navigate,
  initialFilter,
}: {
  navigate: (to: string) => void;
  initialFilter?: string;
}) {
  const [filter, setFilter] = React.useState(initialFilter || "ALL");
  const [search, setSearch] = React.useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["certificates", filter, search],
    queryFn: () =>
      api.get<{ certificates: CertificateRow[] }>(
        `/api/certificates?filter=${filter}&search=${encodeURIComponent(search)}`
      ),
    refetchInterval: 20000,
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="SSL Certificates"
        description="Live-inspected certificates across all monitored domains."
        actions={
          <Button size="sm" onClick={() => navigate("/certificates/new")}>
            <Plus className="mr-1.5 h-4 w-4" /> Request SSL
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search certificate..." className="h-9 pl-8" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label="Filter certificates">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/80 shadow-none">
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={6} cols={8} />
          ) : !data?.certificates.length ? (
            <EmptyState
              icon={LockKeyhole}
              title="No certificates found"
              description="Request a free Let's Encrypt certificate or add a domain to discover its live certificate."
              action={<Button size="sm" onClick={() => navigate("/certificates/new")}><Plus className="mr-1.5 h-4 w-4" /> Request SSL</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Certificate</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Issuer</TableHead>
                    <TableHead>Valid From</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Remaining</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Install</TableHead>
                    <TableHead className="pr-6 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.certificates.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6">
                        <button className="font-medium text-primary hover:underline outline-none focus-visible:ring-2 focus-visible:ring-ring rounded" onClick={() => navigate(`/certificates/${c.id}`)}>
                          {c.commonName}
                        </button>
                        <p className="font-mono text-[11px] text-muted-foreground">{c.keyType || "—"} · {c.tlsVersion || "—"}</p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.domain?.hostname || c.commonName}
                        {c.domain && <p className="text-[11px] text-muted-foreground">{c.domain.environment}</p>}
                      </TableCell>
                      <TableCell className="text-sm">{c.issuer}</TableCell>
                      <TableCell className="text-xs">{fmtDate(c.validFrom)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(c.validUntil)}</TableCell>
                      <TableCell><DaysBadge days={c.daysRemaining} kind="SSL" /></TableCell>
                      <TableCell><StatusBadge status={c.status} size="sm" /></TableCell>
                      <TableCell><StatusBadge status={c.installationStatus} size="sm" /></TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate(`/certificates/${c.id}`)}>
                          <Eye className="mr-1 h-3 w-3" /> View
                        </Button>
                      </TableCell>
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
