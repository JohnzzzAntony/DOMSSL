import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { encryptJSON } from "@/lib/crypto";
import { simulateDomainVerification } from "@/lib/engines/rdap";

/**
 * Idempotent seed (spec §63). Runs once on first API hit / via `bun run db:seed`.
 * All demo rows are flagged `isDemo` and clearly marked in the UI.
 */

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
function minsAgo(mins: number): Date {
  return new Date(Date.now() - mins * 60000);
}

const DEMO_SSH_KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB" + " (simulated demo key)",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");

let seedPromise: Promise<void> | null = null;

export function ensureSeeded(): Promise<void> {
  if (!seedPromise) seedPromise = seedInternal();
  return seedPromise;
}

async function seedInternal(): Promise<void> {
  const existing = await db.user.count();
  if (existing > 0) return; // already seeded
  console.log("[seed] first run — seeding demo data…");

  // ── Users ────────────────────────────────────────────────────────────
  await db.user.createMany({
    data: [
      { email: "admin@example.com", name: "Alex Admin", role: "OWNER", passwordHash: hashPassword("Admin123!") },
      { email: "operator@example.com", name: "Olivia Operator", role: "OPERATOR", passwordHash: hashPassword("Operator123!") },
      { email: "viewer@example.com", name: "Vince Viewer", role: "VIEWER", passwordHash: hashPassword("Viewer123!") },
    ],
  });

  // ── Servers ──────────────────────────────────────────────────────────
  const prodServer = await db.server.create({
    data: {
      name: "Production Server 01",
      host: "203.0.113.10",
      port: 22,
      username: "deploy",
      authType: "SSH_KEY",
      operatingSystem: "Ubuntu",
      webServer: "Nginx",
      status: "ONLINE",
      sshVerified: true,
      encryptedCredential: encryptJSON({ privateKey: DEMO_SSH_KEY }),
      isDemo: true,
      lastHealthCheck: minsAgo(2),
    },
  });
  const stagingServer = await db.server.create({
    data: {
      name: "Staging Server",
      host: "198.51.100.24",
      port: 22,
      username: "deploy",
      authType: "PASSWORD",
      operatingSystem: "Debian",
      webServer: "Apache",
      status: "ONLINE",
      sshVerified: true,
      encryptedCredential: encryptJSON({ password: "demo-staging-password" }),
      isDemo: true,
      lastHealthCheck: minsAgo(4),
    },
  });
  const backupServer = await db.server.create({
    data: {
      name: "Backup Server",
      host: "192.0.2.77",
      port: 2222,
      username: "backup",
      authType: "SSH_KEY",
      operatingSystem: "CentOS/RHEL",
      webServer: "Nginx",
      status: "OFFLINE",
      encryptedCredential: encryptJSON({ privateKey: DEMO_SSH_KEY }),
      isDemo: true,
      lastHealthCheck: minsAgo(9),
    },
  });

  // ── Domains + certificates (demo states: Healthy / Expiring / Expired / Error) ──
  const mkDomain = async (args: {
    hostname: string;
    environment?: string;
    registrar?: string;
    sslProvider?: string;
    domainDays: number;
    sslDays: number | null;
    verificationStatus: string;
    status: string;
    autoRenew?: boolean;
    autoInstall?: boolean;
    dnsAutomation?: boolean;
    serverId?: string | null;
    sslError?: "HOSTNAME_MISMATCH" | "INVALID_CHAIN" | null;
    installed?: boolean;
    lastCheckedMinsAgo?: number;
  }) => {
    // Derive stored expiry from the same deterministic simulation the daily
    // checks use, so demo rows stay VERIFIED and stable (spec §63 + §49).
    const sim = simulateDomainVerification(args.hostname);
    const verified = args.verificationStatus === "VERIFIED";
    const domainExpiry = verified ? sim.domainExpiry! : daysFromNow(args.domainDays);
    const domain = await db.domain.create({
      data: {
        hostname: args.hostname,
        environment: args.environment || "PRODUCTION",
        registrar: verified ? sim.registrar || args.registrar || "GoDaddy" : args.registrar || "GoDaddy",
        sslProvider: args.sslProvider || "Let's Encrypt",
        registeredAt: sim.registeredAt || daysFromNow(-(365 * 2 + 40)),
        expiresAt: domainExpiry,
        verifiedExpiresAt: verified ? domainExpiry : null,
        registrarExpiresAt: args.verificationStatus !== "FAILED" ? domainExpiry : null,
        verificationStatus: args.verificationStatus,
        status: args.status,
        autoRenew: args.autoRenew ?? true,
        autoInstall: args.autoInstall ?? true,
        dnsAutomation: args.dnsAutomation ?? false,
        serverId: args.serverId ?? null,
        isDemo: true,
        lastCheckedAt: minsAgo(args.lastCheckedMinsAgo ?? 10),
        lastDomainCheckAt: minsAgo(args.lastCheckedMinsAgo ?? 10),
        lastSslCheckAt: minsAgo(args.lastCheckedMinsAgo ?? 10),
      },
    });
    if (args.sslDays !== null) {
      const validUntil = daysFromNow(args.sslDays);
      await db.certificate.create({
        data: {
          domainId: domain.id,
          commonName: args.hostname,
          issuer: "Let's Encrypt",
          subject: `CN=${args.hostname}`,
          serialNumber: Math.random().toString(16).slice(2, 18).toUpperCase(),
          fingerprint: Array.from({ length: 20 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(":").toUpperCase(),
          signatureAlgorithm: "sha256WithRSAEncryption",
          keyType: "ECDSA (P-256)",
          tlsVersion: "TLSv1.3",
          validFrom: daysFromNow(args.sslDays - 90),
          validUntil,
          liveValidUntil: validUntil,
          sans: JSON.stringify([args.hostname, `www.${args.hostname}`]),
          status: args.sslError || (args.sslDays <= 0 ? "EXPIRED" : args.sslDays <= 7 ? "CRITICAL" : args.sslDays <= 30 ? "EXPIRING" : "VALID"),
          hostnameMatch: args.sslError !== "HOSTNAME_MISMATCH",
          chainValid: args.sslError !== "INVALID_CHAIN",
          provider: "Let's Encrypt",
          installationStatus: args.installed ? "INSTALLED" : "NOT_INSTALLED",
          autoRenew: args.autoRenew ?? true,
          verificationStatus: "VERIFIED",
          isDemo: true,
          lastCheckedAt: minsAgo(args.lastCheckedMinsAgo ?? 10),
        },
      });
    }
    return domain;
  };

  const exampleCom = await mkDomain({
    hostname: "example.com",
    domainDays: 160,
    sslDays: 72,
    verificationStatus: "VERIFIED",
    status: "HEALTHY",
    registrar: "GoDaddy",
    dnsAutomation: true,
    serverId: prodServer.id,
    installed: true,
    lastCheckedMinsAgo: 2,
  });
  const exampleAe = await mkDomain({
    hostname: "example.ae",
    domainDays: 21,
    sslDays: 4,
    verificationStatus: "VERIFIED",
    status: "CRITICAL",
    registrar: "Other",
    autoRenew: false,
    serverId: prodServer.id,
    installed: true,
    lastCheckedMinsAgo: 10,
  });
  const exampleOrg = await mkDomain({
    hostname: "example.org",
    domainDays: 12,
    sslDays: 93,
    verificationStatus: "VERIFIED",
    status: "DOMAIN_EXPIRING",
    registrar: "Namecheap",
    serverId: stagingServer.id,
    lastCheckedMinsAgo: 12,
  });
  const testsite = await mkDomain({
    hostname: "testsite.com",
    domainDays: 364,
    sslDays: 28,
    verificationStatus: "UNVERIFIED",
    status: "EXPIRING_SOON",
    registrar: "Unknown",
    autoRenew: false,
    autoInstall: false,
    serverId: null,
    lastCheckedMinsAgo: 45,
  });
  const mailExample = await mkDomain({
    hostname: "mail-example.net",
    domainDays: 240,
    sslDays: -3,
    verificationStatus: "VERIFIED",
    status: "EXPIRED",
    registrar: "Cloudflare",
    dnsAutomation: true,
    serverId: prodServer.id,
    lastCheckedMinsAgo: 30,
  });
  const oldExample = await mkDomain({
    hostname: "old-example.xyz",
    domainDays: 45,
    sslDays: -12,
    verificationStatus: "VERIFIED",
    status: "EXPIRED",
    registrar: "Other",
    autoRenew: false,
    autoInstall: false,
    serverId: backupServer.id,
    lastCheckedMinsAgo: 75,
  });
  const shopExample = await mkDomain({
    hostname: "shop-example.io",
    domainDays: 420,
    sslDays: 55,
    verificationStatus: "VERIFIED",
    status: "SSL_ERROR",
    registrar: "Porkbun",
    sslError: "HOSTNAME_MISMATCH",
    serverId: stagingServer.id,
    lastCheckedMinsAgo: 60,
  });
  await mkDomain({
    hostname: "demo-domain.dev",
    domainDays: 300,
    sslDays: 140,
    verificationStatus: "MISMATCH",
    status: "WARNING",
    registrar: "GoDaddy",
    serverId: null,
    lastCheckedMinsAgo: 90,
  });
  const stagingExample = await mkDomain({
    hostname: "staging-example.net",
    environment: "STAGING",
    domainDays: 85,
    sslDays: 19,
    verificationStatus: "VERIFIED",
    status: "EXPIRING_SOON",
    registrar: "Namecheap",
    autoRenew: false,
    serverId: stagingServer.id,
    lastCheckedMinsAgo: 15,
  });
  const apiExample = await mkDomain({
    hostname: "api-example.dev",
    environment: "DEVELOPMENT",
    domainDays: 510,
    sslDays: 64,
    verificationStatus: "VERIFIED",
    status: "HEALTHY",
    registrar: "Cloudflare",
    dnsAutomation: true,
    serverId: prodServer.id,
    installed: true,
    lastCheckedMinsAgo: 8,
  });

  // ── Verification results (audit trail for discovered dates) ─────────
  await db.verificationResult.createMany({
    data: [
      { domainId: exampleCom.id, checkType: "RDAP", source: "SIMULATION", verified: true, discoveredValue: daysFromNow(160).toISOString().slice(0, 10), storedValue: daysFromNow(160).toISOString().slice(0, 10), matched: true },
      { domainId: exampleCom.id, checkType: "SSL_LIVE", source: "SIMULATION", verified: true, discoveredValue: daysFromNow(72).toISOString().slice(0, 10), storedValue: daysFromNow(72).toISOString().slice(0, 10), matched: true },
      { domainId: exampleAe.id, checkType: "SSL_LIVE", source: "SIMULATION", verified: true, discoveredValue: daysFromNow(4).toISOString().slice(0, 10), storedValue: daysFromNow(4).toISOString().slice(0, 10), matched: true },
      { domainId: testsite.id, checkType: "RDAP", source: "SIMULATION", verified: false, error: "RDAP lookup failed: network unreachable", storedValue: daysFromNow(364).toISOString().slice(0, 10) },
    ],
  });

  // ── Recent automation jobs for the dashboard (spec §7) ───────────────
  await db.automationJob.createMany({
    data: [
      {
        type: "SSL_RENEWAL",
        title: "SSL Renewal — example.com",
        domainId: exampleCom.id,
        status: "SUCCESS",
        progress: 100,
        durationMs: 42300,
        startedAt: minsAgo(2),
        completedAt: minsAgo(1),
        steps: JSON.stringify([
          { name: "Certificate eligibility check", status: "DONE", detail: "29 days remaining — renewal eligible (threshold 30)", at: minsAgo(2).toISOString() },
          { name: "ACME order & validation", status: "DONE", detail: "DNS-01 validation via Cloudflare", at: minsAgo(2).toISOString() },
          { name: "Certificate issued", status: "DONE", detail: "Let's Encrypt certificate issued — valid until " + daysFromNow(90).toISOString().slice(0, 10), at: minsAgo(2).toISOString() },
          { name: "Backup current certificate", status: "DONE", detail: "Encrypted backup stored (retention 5)", at: minsAgo(2).toISOString() },
          { name: "Install new certificate", status: "DONE", detail: "Uploaded to Production Server 01 with secure permissions", at: minsAgo(1).toISOString() },
          { name: "Web server config test & reload", status: "DONE", detail: "nginx -t passed — Nginx reloaded", at: minsAgo(1).toISOString() },
          { name: "Live HTTPS verification", status: "DONE", detail: "https://example.com verified serving new certificate", at: minsAgo(1).toISOString() },
        ]),
        logs: JSON.stringify([
          { t: minsAgo(2).toISOString(), level: "info", message: "Starting renewal for example.com" },
          { t: minsAgo(2).toISOString(), level: "success", message: "ACME account verified" },
          { t: minsAgo(2).toISOString(), level: "info", message: "DNS challenge created via Cloudflare" },
          { t: minsAgo(2).toISOString(), level: "success", message: "DNS validation completed" },
          { t: minsAgo(2).toISOString(), level: "success", message: "Certificate issued" },
          { t: minsAgo(1).toISOString(), level: "info", message: "Existing certificate backed up" },
          { t: minsAgo(1).toISOString(), level: "info", message: "New certificate installed" },
          { t: minsAgo(1).toISOString(), level: "info", message: "nginx -t — configuration valid" },
          { t: minsAgo(1).toISOString(), level: "success", message: "Nginx reloaded" },
          { t: minsAgo(1).toISOString(), level: "success", message: "HTTPS verification successful" },
        ]),
      },
      {
        type: "DOMAIN_CHECK",
        title: "Domain Check — example.ae",
        domainId: exampleAe.id,
        status: "SUCCESS",
        progress: 100,
        durationMs: 1240,
        startedAt: minsAgo(10),
        completedAt: minsAgo(10),
        steps: JSON.stringify([{ name: "RDAP domain expiry check", status: "DONE", detail: "SIMULATION: expiry in 21 days — CRITICAL threshold active", at: minsAgo(10).toISOString() }]),
        logs: JSON.stringify([{ t: minsAgo(10).toISOString(), level: "warn", message: "Domain example.ae enters critical window (21 days)" }]),
      },
      {
        type: "SSL_INSTALLATION",
        title: "SSL Installation — example.org",
        domainId: exampleOrg.id,
        status: "ROLLED_BACK",
        progress: 62,
        durationMs: 8600,
        startedAt: minsAgo(18),
        completedAt: minsAgo(18),
        error: "NGINX_CONFIG_INVALID",
        steps: JSON.stringify([
          { name: "Verify SSH", status: "DONE", detail: "Connected to deploy@staging (simulated handshake)", at: minsAgo(18).toISOString() },
          { name: "Verify domain mapping", status: "DONE", detail: "server_name example.org found in nginx configuration", at: minsAgo(18).toISOString() },
          { name: "Backup current certificate", status: "DONE", detail: "Backup stored at /var/backups/dsm/staging/example.org", at: minsAgo(18).toISOString() },
          { name: "Upload certificate & key", status: "DONE", detail: "fullchain.pem + privkey.pem uploaded (0o600)", at: minsAgo(18).toISOString() },
          { name: "Set secure permissions", status: "DONE", detail: "privkey.pem → root:root 0600", at: minsAgo(18).toISOString() },
          { name: "Configuration test", status: "FAILED", detail: "nginx: [emerg] ssl_stapling ignored — config test FAILED — reload NOT attempted", at: minsAgo(18).toISOString() },
          { name: "Rollback", status: "DONE", detail: "Previous certificate and configuration restored", at: minsAgo(18).toISOString() },
          { name: "Live HTTPS verification", status: "SKIPPED", detail: "Skipped after rollback", at: minsAgo(18).toISOString() },
        ]),
        logs: JSON.stringify([
          { t: minsAgo(18).toISOString(), level: "info", message: "Starting installation on Staging Server" },
          { t: minsAgo(18).toISOString(), level: "success", message: "SSH connected" },
          { t: minsAgo(18).toISOString(), level: "error", message: "nginx -t failed — OCSP staple path invalid" },
          { t: minsAgo(18).toISOString(), level: "warn", message: "ROLLBACK executed — previous config restored" },
        ]),
      },
    ],
  });

  // ── Notifications (pending metrics, spec §7/§21) ─────────────────────
  await db.notification.createMany({
    data: [
      {
        type: "SSL_EXPIRY",
        severity: "CRITICAL",
        title: "CRITICAL: SSL certificate expires in 4 days — example.ae",
        message: "Domain: example.ae\nCertificate: Let's Encrypt\nExpires: " + daysFromNow(4).toISOString().slice(0, 10) + "\nRemaining: 4 days\n\nAutomatic renewal: Enabled\nServer: Production Server 01\n\nImmediate action required.",
        domainId: exampleAe.id,
        deliveryStatus: "SIMULATED",
        channels: JSON.stringify(["EMAIL"]),
        createdAt: minsAgo(11),
      },
      {
        type: "DOMAIN_EXPIRY",
        severity: "WARNING",
        title: "Domain expiring — example.org (12 days)",
        message: "Domain: example.org\nRegistrar: Namecheap\nExpires: " + daysFromNow(12).toISOString().slice(0, 10) + "\nRemaining: 12 days",
        domainId: exampleOrg.id,
        deliveryStatus: "SIMULATED",
        channels: JSON.stringify(["EMAIL"]),
        createdAt: minsAgo(13),
      },
      {
        type: "RENEWAL_FAILED",
        severity: "CRITICAL",
        title: "Automatic renewal FAILED — mail-example.net",
        message: "Automatic renewal:\nFAILED\n\nReason:\nACME validation failed — domain unreachable during HTTP-01 challenge.\n\nImmediate action required.",
        domainId: mailExample.id,
        deliveryStatus: "SIMULATED",
        channels: JSON.stringify(["EMAIL"]),
        createdAt: minsAgo(31),
      },
      {
        type: "SYSTEM",
        severity: "INFO",
        title: "Bulk scan completed — 4 domains scanned",
        message: "4 domains scanned\n3 verified\n2 warnings\n1 critical",
        deliveryStatus: "SIMULATED",
        channels: JSON.stringify(["EMAIL"]),
        createdAt: minsAgo(55),
      },
      {
        type: "SSL_EXPIRY",
        severity: "WARNING",
        title: "SSL certificate expiring — staging-example.net (19 days)",
        message: "Domain: staging-example.net\nCertificate: Let's Encrypt\nExpires: " + daysFromNow(19).toISOString().slice(0, 10) + "\nRemaining: 19 days\n\nAutomatic renewal: Enabled",
        domainId: stagingExample.id,
        deliveryStatus: "SENT",
        channels: JSON.stringify(["EMAIL"]),
        createdAt: minsAgo(120),
      },
    ],
  });

  // ── Notification channels ────────────────────────────────────────────
  await db.notificationChannel.createMany({
    data: [
      { type: "EMAIL", enabled: true, status: "CONNECTED", encryptedConf: "", lastTestedAt: minsAgo(30) },
      { type: "WHATSAPP", enabled: false, status: "NOT_CONNECTED", encryptedConf: "" },
      { type: "TELEGRAM", enabled: false, status: "NOT_CONNECTED", encryptedConf: "" },
      { type: "SLACK", enabled: false, status: "NOT_CONNECTED", encryptedConf: "" },
    ],
  });

  // ── Integrations (spec §23) ──────────────────────────────────────────
  await db.integration.createMany({
    data: [
      { key: "LETS_ENCRYPT", name: "Let's Encrypt", category: "CA", status: "CONNECTED", lastTestedAt: minsAgo(5) },
      { key: "CLOUDFLARE", name: "Cloudflare", category: "DNS", status: "CONNECTED", lastTestedAt: minsAgo(15) },
      { key: "GODADDY", name: "GoDaddy", category: "REGISTRAR", status: "NOT_CONNECTED" },
      { key: "NAMECHEAP", name: "Namecheap", category: "REGISTRAR", status: "NOT_CONNECTED" },
      { key: "TELEGRAM", name: "Telegram", category: "NOTIFICATION", status: "NOT_CONNECTED" },
      { key: "SLACK", name: "Slack", category: "NOTIFICATION", status: "NOT_CONNECTED" },
      { key: "SMTP", name: "Email (SMTP)", category: "NOTIFICATION", status: "CONNECTED", lastTestedAt: minsAgo(30) },
    ],
  });

  // ── DNS provider (Cloudflare demo) ───────────────────────────────────
  await db.dNSProvider.create({
    data: {
      name: "Cloudflare",
      providerType: "CLOUDFLARE",
      encryptedToken: "",
      zoneAccess: "ALL_ZONES",
      zones: JSON.stringify(["example.com", "example.ae", "api-example.dev", "mail-example.net"]),
      status: "CONNECTED",
      lastTestedAt: minsAgo(15),
    },
  });

  // ── Settings ─────────────────────────────────────────────────────────
  await db.setting.createMany({
    data: [
      { key: "general", value: JSON.stringify({ organizationName: "Acme Infrastructure", timezone: "UTC" }) },
      { key: "notifications", value: JSON.stringify({ sslThresholds: [30, 15, 7, 5], domainThresholds: [60, 30, 15, 7, 5], mandatoryAlertDays: 5 }) },
      { key: "automation", value: JSON.stringify({ renewalThresholdDays: 30 }) },
      { key: "security", value: JSON.stringify({ twoFactorRequired: false, sessionTimeoutMinutes: 10080, ipAllowlist: "", loginProtection: true, auditLogging: true }) },
    ],
  });

  // ── Audit history ────────────────────────────────────────────────────
  await db.auditLog.createMany({
    data: [
      { actor: "system", action: "DOMAIN_CREATED", resourceType: "DOMAIN", resourceId: exampleCom.id, detail: "Seed data: example.com added (demo)", createdAt: minsAgo(600) },
      { actor: "system", action: "DOMAIN_VERIFIED", resourceType: "DOMAIN", resourceId: exampleCom.id, detail: "Verified via RDAP (SIMULATION source)", createdAt: minsAgo(595) },
      { actor: "system", action: "SSL_RENEWED", resourceType: "CERTIFICATE", resourceId: exampleCom.id, detail: "Automated renewal — Let's Encrypt", createdAt: minsAgo(2) },
      { actor: "system", action: "SSL_ROLLBACK", resourceType: "CERTIFICATE", resourceId: exampleOrg.id, detail: "Config test failed — rolled back on Staging Server", result: "FAILED", createdAt: minsAgo(18) },
      { actor: "admin@example.com", action: "SETTINGS_UPDATED", resourceType: "SETTING", detail: "Renewal threshold set to 30 days", createdAt: minsAgo(240) },
    ],
  });

  // ── Certificate history ──────────────────────────────────────────────
  const certs = await db.certificate.findMany({ include: { domain: true } });
  for (const cert of certs) {
    await db.certificateHistory.create({
      data: {
        certificateId: cert.id,
        event: "DETECTED_CHANGE",
        detail: `Certificate discovered via live inspection (${cert.isDemo ? "SIMULATION" : "LIVE"}) at seed time`,
        actor: "system",
        createdAt: minsAgo(600),
      },
    });
    if (cert.installationStatus === "INSTALLED") {
      await db.certificateHistory.create({
        data: {
          certificateId: cert.id,
          event: "INSTALLED",
          detail: "Installed on assigned server (demo seed)",
          createdAt: minsAgo(590),
        },
      });
    }
  }

  console.log("[seed] demo data seeded (isDemo=true on all rows)");
}
