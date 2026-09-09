import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "CertGuard — Domain & SSL Manager",
  description:
    "Centralized management of domains, SSL/TLS certificates, servers, DNS providers, expiry monitoring, notifications, ACME issuance, automatic renewal and certificate installation.",
  keywords: ["SSL", "TLS", "domain monitoring", "certificate management", "Let's Encrypt", "ACME", "Nginx", "Apache"],
  authors: [{ name: "CertGuard" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
