"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiUser, type NotificationRow } from "@/lib/client-api";
import {
  LayoutDashboard,
  Globe,
  LockKeyhole,
  Server,
  Cloud,
  Bell,
  ScrollText,
  BarChart3,
  Settings as SettingsIcon,
  ShieldCheck,
  Search,
  Menu,
  LogOut,
} from "lucide-react";

export const NAV_ITEMS = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/domains", label: "Domains", icon: Globe },
  { path: "/certificates", label: "Certificates", icon: LockKeyhole },
  { path: "/servers", label: "Servers", icon: Server },
  { path: "/dns", label: "DNS Providers", icon: Cloud },
  { path: "/notifications", label: "Notifications", icon: Bell },
  { path: "/logs", label: "Automation Logs", icon: ScrollText },
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

function NavLinks({
  path,
  navigate,
  onNavigate,
}: {
  path: string;
  navigate: (to: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 px-3">
      {NAV_ITEMS.map((item) => {
        const active = path === item.path || path.startsWith(item.path + "/");
        return (
          <button
            key={item.path}
            onClick={() => {
              navigate(item.path);
              onNavigate?.();
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5 px-6 py-5", collapsed && "justify-center px-0")}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ShieldCheck className="h-4.5 w-4.5" />
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-tight">CertGuard</p>
          <p className="text-[11px] text-muted-foreground">Domain &amp; SSL Manager</p>
        </div>
      )}
    </div>
  );
}

export function AppShell({
  user,
  path,
  navigate,
  onLogout,
  children,
}: {
  user: ApiUser;
  path: string;
  navigate: (to: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const queryClient = useQueryClient();

  const { data: notifData } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<{ notifications: NotificationRow[]; unread: number }>("/api/notifications"),
    refetchInterval: 30000,
  });
  const unread = notifData?.unread || 0;

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      navigate(`/domains?search=${encodeURIComponent(search.trim())}`);
      setSearch("");
    }
  };

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen bg-slate-50/60">
      {/* Desktop sidebar — 240px (spec §43) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-white lg:flex">
        <Brand />
        <ScrollArea className="flex-1 pb-4">
          <NavLinks path={path} navigate={navigate} />
        </ScrollArea>
        <div className="border-t p-4">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Automation engine active
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="mr-1" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Brand />
            <NavLinks path={path} navigate={navigate} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        {/* Header */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-white/95 px-4 backdrop-blur sm:px-6">
          <form onSubmit={submitSearch} className="relative hidden max-w-sm flex-1 sm:block">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search domains, servers..."
              className="h-9 border-border/70 bg-slate-50 pl-8"
              aria-label="Search"
            />
          </form>
          <div className="flex-1 sm:hidden" />

          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
            onClick={() => navigate("/notifications")}
          >
            <Bell className="h-4.5 w-4.5" />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials}</AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium md:block">{user.name}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <p className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {user.role}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                <SettingsIcon className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} variant="destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        <footer className="mt-auto border-t bg-white px-6 py-3 text-center text-xs text-muted-foreground">
          CertGuard — Domain &amp; SSL Manager · Monitoring {""}
          <span className="font-medium">expiry, verification &amp; automation</span>
        </footer>
      </div>
    </div>
  );
}
