import { z } from "zod";
import dns from "dns";
import { promisify } from "util";

/**
 * Input validation with Zod (spec §32) + SSRF protection (spec §59).
 */

const resolve4 = promisify(dns.resolve4) as (h: string) => Promise<string[]>;

export const HOSTNAME_REGEX =
  /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,63}$/;

export function isValidHostname(h: string): boolean {
  return HOSTNAME_REGEX.test(h);
}

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^f[cd][0-9a-f]{2}:/i,
  /^169\.254\.169\.254$/,
];

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "instance-data",
];

/** Validate that a host is a public internet target (SSRF guard, spec §59). */
export async function assertSafeTarget(hostname: string): Promise<void> {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    throw new Error(`Blocked target: ${hostname} (internal host)`);
  }
  if (BLOCKED_IP_PATTERNS.some((re) => re.test(lower))) {
    throw new Error(`Blocked target: ${hostname} (private IP range)`);
  }
  // If it's an IP literal, validate directly
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(lower)) {
    if (BLOCKED_IP_PATTERNS.some((re) => re.test(lower))) {
      throw new Error(`Blocked target: ${hostname} (private IP range)`);
    }
    return;
  }
  if (!isValidHostname(lower)) {
    throw new Error(`Invalid hostname: ${hostname}`);
  }
  try {
    const ips = await resolve4(lower);
    for (const ip of ips) {
      if (BLOCKED_IP_PATTERNS.some((re) => re.test(ip))) {
        throw new Error(
          `Blocked target: ${hostname} resolves to private address ${ip}`
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Blocked target")) throw e;
    // DNS resolution failure is not an SSRF risk — allow (check itself will fail gracefully)
  }
}

// ─── Domain schemas ──────────────────────────────────────────────────

export const environmentEnum = z.enum(["PRODUCTION", "STAGING", "DEVELOPMENT"]);
export const registrarEnum = z.enum([
  "GoDaddy",
  "Namecheap",
  "Cloudflare",
  "Porkbun",
  "Other",
  "Unknown",
]);
export const sslProviderEnum = z.enum([
  "Let's Encrypt",
  "ZeroSSL",
  "Existing Certificate",
  "Other",
]);

export const domainCreateSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidHostname, "Enter a valid domain name (e.g. example.com)"),
  environment: environmentEnum.default("PRODUCTION"),
  registrar: registrarEnum.default("Unknown"),
  sslProvider: sslProviderEnum.default("Let's Encrypt"),
  storedDomainExpiry: z.string().optional(), // ISO date, manual entry
  autoRenew: z.boolean().default(true),
  autoInstall: z.boolean().default(true),
  dnsAutomation: z.boolean().default(false),
  notifyEmail: z.boolean().default(true),
  notifyWhatsApp: z.boolean().default(false),
  notifyTelegram: z.boolean().default(false),
  notifySlack: z.boolean().default(false),
  alertThresholdDays: z.number().int().min(1).max(90).default(5),
  serverId: z.string().optional().nullable(),
});

export const domainUpdateSchema = domainCreateSchema.partial().extend({
  expiresAt: z.string().optional().nullable(),
});

export const bulkScanSchema = z.object({
  domains: z
    .array(z.string().trim().toLowerCase().refine(isValidHostname, "Invalid domain name"))
    .min(1, "Provide at least one domain")
    .max(50, "Scan up to 50 domains at a time"),
});

// ─── Server schemas ──────────────────────────────────────────────────

export const serverCreateSchema = z.object({
  name: z.string().trim().min(2, "Server name is required").max(80),
  host: z.string().trim().min(1, "Host is required").max(253),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1, "Username is required").max(64),
  authType: z.enum(["SSH_KEY", "PASSWORD"]).default("SSH_KEY"),
  password: z.string().max(256).optional(),
  privateKey: z.string().max(16384).optional(),
  passphrase: z.string().max(256).optional(),
  operatingSystem: z.enum(["Ubuntu", "Debian", "CentOS/RHEL", "Other"]).default("Ubuntu"),
  webServer: z.enum(["Nginx", "Apache"]).default("Nginx"),
});

export const serverUpdateSchema = serverCreateSchema.partial();

// ─── DNS provider schemas ────────────────────────────────────────────

export const dnsProviderCreateSchema = z.object({
  providerType: z.enum(["CLOUDFLARE"]).default("CLOUDFLARE"),
  apiToken: z.string().trim().min(10, "API token is required").max(256),
  zoneAccess: z.enum(["SELECTED_ZONES", "ALL_ZONES"]).default("ALL_ZONES"),
  zones: z.array(z.string()).default([]),
});

// ─── Certificate schemas ─────────────────────────────────────────────

export const certRequestSchema = z.object({
  domainId: z.string().min(1, "Select a domain"),
  provider: z.enum(["Let's Encrypt", "ZeroSSL"]).default("Let's Encrypt"),
  certType: z.enum(["SINGLE", "WILDCARD", "MULTI_DOMAIN"]).default("SINGLE"),
  validation: z.enum(["HTTP_01", "DNS_01"]).default("HTTP_01"),
  dnsProviderId: z.string().optional().nullable(),
  autoCreateDnsRecord: z.boolean().default(true),
  includeWww: z.boolean().default(true),
  installAutomatically: z.boolean().default(true),
  serverId: z.string().optional().nullable(),
});

// ─── Notification / settings schemas ─────────────────────────────────

export const notificationSettingsSchema = z.object({
  sslThresholds: z.array(z.number().int().min(1).max(365)).default([30, 15, 7, 5]),
  domainThresholds: z.array(z.number().int().min(1).max(365)).default([60, 30, 15, 7, 5]),
  mandatoryAlertDays: z.number().int().min(1).max(30).default(5),
});

export const channelConfigSchema = z.object({
  type: z.enum(["EMAIL", "WHATSAPP", "TELEGRAM", "SLACK"]),
  enabled: z.boolean().default(false),
  config: z.record(z.string(), z.string()).default({}),
});

export const settingsSchema = z.object({
  organizationName: z.string().max(120).optional(),
  timezone: z.string().max(64).optional(),
  twoFactorRequired: z.boolean().optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
  ipAllowlist: z.string().max(2000).optional(),
  loginProtection: z.boolean().optional(),
  auditLogging: z.boolean().optional(),
  renewalThresholdDays: z.number().int().min(7).max(60).optional(),
});

/** Format a Zod error into a friendly message. */
export function zodMessage(e: z.ZodError): string {
  const first = e.issues[0];
  return first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input";
}
