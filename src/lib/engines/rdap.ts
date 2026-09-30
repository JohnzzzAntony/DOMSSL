import { assertSafeTarget } from "@/lib/validators";
import net from "node:net";

/**
 * Domain Verification Engine (spec §25, §54).
 * Prefers RDAP over legacy WHOIS. Registrar APIs are optional adapters.
 *
 * Runs a REAL RDAP lookup against rdap.org. If the sandbox/network blocks
 * outbound access, falls back to deterministic simulation clearly marked
 * with source = "SIMULATION" (never silently presented as authoritative).
 */

export interface DomainVerificationResult {
  domain: string;
  domainExpiry?: Date;
  registrar?: string;
  registrationStatus?: string;
  registeredAt?: Date;
  source: "RDAP" | "WHOIS" | "REGISTRAR_API" | "SIMULATION";
  verified: boolean;
  error?: string;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, ...unknown[]]>];
  events?: Array<{ eventAction: string; eventDate: string }>;
}

function extractFromVCard(entity: RdapEntity): string | undefined {
  try {
    const vcard = entity.vcardArray?.[1];
    if (!vcard) return undefined;
    const fn = vcard.find((f) => f[0] === "fn");
    return typeof fn?.[3] === "string" ? (fn[3] as string) : undefined;
  } catch {
    return undefined;
  }
}

function findRegistrar(entities?: RdapEntity[]): string | undefined {
  if (!entities) return undefined;
  const registrar = entities.find(
    (e) => e.roles?.includes("registrar")
  );
  return registrar ? extractFromVCard(registrar) : undefined;
}

function findEvent(
  events?: Array<{ eventAction: string; eventDate: string }>,
  action: string = "expiration"
): Date | undefined {
  const ev = events?.find((e) => e.eventAction === action);
  if (!ev) return undefined;
  const d = new Date(ev.eventDate);
  return isNaN(d.getTime()) ? undefined : d;
}

// rdap.org rejects Node's default "node" User-Agent with HTTP 403.
const USER_AGENT = "CertGuard/1.0 (domain expiry monitor)";

function tldOf(domain: string): string {
  return domain.toLowerCase().split(".").pop() || "";
}

/** IANA RDAP bootstrap (TLD → authoritative RDAP base URL), cached for 24h. */
let bootstrap: { at: number; map: Map<string, string> } | null = null;

async function rdapBaseFor(tld: string): Promise<string | undefined> {
  if (!bootstrap || Date.now() - bootstrap.at > 24 * 3600_000) {
    try {
      const res = await fetch("https://data.iana.org/rdap/dns.json", {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json()) as { services: [string[], string[]][] };
      const map = new Map<string, string>();
      for (const [tlds, urls] of json.services) {
        const url = urls.find((u) => u.startsWith("https://")) || urls[0];
        for (const t of tlds) map.set(t.toLowerCase(), url.endsWith("/") ? url : `${url}/`);
      }
      bootstrap = { at: Date.now(), map };
    } catch {
      return undefined; // fall back to rdap.org
    }
  }
  return bootstrap.map.get(tld);
}

/**
 * Real RDAP lookup. Queries the TLD's authoritative RDAP server directly
 * (IANA bootstrap) — avoids rdap.org's aggressive rate limits — and falls
 * back to rdap.org when the TLD has no bootstrap entry.
 */
export async function verifyDomainViaRDAP(
  domain: string
): Promise<DomainVerificationResult> {
  await assertSafeTarget(domain);
  try {
    const base = (await rdapBaseFor(tldOf(domain))) || "https://rdap.org/";
    const res = await fetch(`${base}domain/${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/rdap+json", "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      return {
        domain,
        source: "RDAP",
        verified: false,
        error:
          res.status === 404
            ? "Domain not found in RDAP registry"
            : `RDAP unavailable (HTTP ${res.status})`,
      };
    }
    const data = (await res.json()) as {
      status?: string[];
      entities?: RdapEntity[];
      events?: Array<{ eventAction: string; eventDate: string }>;
    };
    const expiry =
      findEvent(data.events, "expiration") ??
      findEvent(data.events, "expiry");
    const registeredAt = findEvent(data.events, "registration");
    const registrar = findRegistrar(data.entities);
    if (!expiry) {
      return {
        domain,
        source: "RDAP",
        verified: false,
        registrar,
        error: "RDAP response did not include an expiration event",
      };
    }
    return {
      domain,
      domainExpiry: expiry,
      registeredAt,
      registrar,
      registrationStatus: data.status?.join(", "),
      source: "RDAP",
      verified: true,
    };
  } catch (e) {
    return {
      domain,
      source: "RDAP",
      verified: false,
      error:
        e instanceof Error
          ? `RDAP lookup failed: ${e.message}`
          : "RDAP lookup failed",
    };
  }
}

/** Raw WHOIS query over TCP port 43. */
function whoisQuery(server: string, query: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    const sock = net.connect({ host: server, port: 43 }, () => sock.write(`${query}\r\n`));
    sock.setTimeout(8000, () => sock.destroy(new Error(`WHOIS ${server} timed out`)));
    sock.on("data", (d) => (out += d.toString("utf8")));
    sock.on("end", () => resolve(out));
    sock.on("error", reject);
  });
}

const whoisServers = new Map<string, string | null>();

/** WHOIS server for a TLD, discovered via whois.iana.org and cached. */
async function whoisServerFor(tld: string): Promise<string | null> {
  if (!whoisServers.has(tld)) {
    const iana = await whoisQuery("whois.iana.org", tld);
    whoisServers.set(tld, iana.match(/^whois:\s*(\S+)/im)?.[1] ?? null);
  }
  return whoisServers.get(tld) ?? null;
}

function whoisField(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const m = text.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"));
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

/**
 * Legacy WHOIS fallback for TLDs without RDAP (e.g. .co, .ae).
 * Some registries (aeDA for .ae) do not publish an expiry date at all —
 * the registrar is still returned so it can be recorded.
 */
export async function verifyDomainViaWhois(domain: string): Promise<DomainVerificationResult> {
  try {
    const server = await whoisServerFor(tldOf(domain));
    if (!server) return { domain, source: "WHOIS", verified: false, error: "No WHOIS server for this TLD" };
    const text = await whoisQuery(server, domain);
    if (/blacklisted|exceeded the query limit|rate limit/i.test(text)) {
      return { domain, source: "WHOIS", verified: false, error: `WHOIS rate limit reached at ${server} — will retry on the next check` };
    }
    if (/no match|not found|no data found|no object found/i.test(text)) {
      return { domain, source: "WHOIS", verified: false, error: "Domain not found in WHOIS" };
    }
    const registrar = whoisField(text, ["Registrar", "Registrar Name", "Sponsoring Registrar"]);
    const expiryRaw = whoisField(text, ["Registry Expiry Date", "Registrar Registration Expiration Date", "Expiry Date", "Expiration Date", "paid-till"]);
    const createdRaw = whoisField(text, ["Creation Date", "Created On", "Registered On"]);
    const expiry = expiryRaw ? new Date(expiryRaw) : undefined;
    const registeredAt = createdRaw ? new Date(createdRaw) : undefined;
    if (!expiry || isNaN(expiry.getTime())) {
      return {
        domain,
        source: "WHOIS",
        verified: false,
        registrar,
        error: `.${tldOf(domain)} registry does not publish an expiry date — enter it manually from your registrar`,
      };
    }
    return {
      domain,
      domainExpiry: expiry,
      registeredAt: registeredAt && !isNaN(registeredAt.getTime()) ? registeredAt : undefined,
      registrar,
      registrationStatus: whoisField(text, ["Domain Status", "Status"]),
      source: "WHOIS",
      verified: true,
    };
  } catch (e) {
    return { domain, source: "WHOIS", verified: false, error: e instanceof Error ? `WHOIS lookup failed: ${e.message}` : "WHOIS lookup failed" };
  }
}

/**
 * Registrar API adapters (spec §54) — modular, provider-specific.
 * Cloudflare Registrar exposes expiry through their API when a token exists.
 */
export async function verifyDomainViaRegistrar(
  domain: string,
  registrar: string,
  apiToken?: string
): Promise<DomainVerificationResult | null> {
  if (registrar === "Cloudflare" && apiToken) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/domains?name=${encodeURIComponent(domain)}`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      const json = (await res.json()) as {
        result?: Array<{ expires_at?: string; registered_on?: string }>;
      };
      const hit = json.result?.[0];
      if (hit?.expires_at) {
        return {
          domain,
          domainExpiry: new Date(hit.expires_at),
          registrar: "Cloudflare Registrar",
          source: "REGISTRAR_API",
          verified: true,
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Simulation fallback — deterministic pseudo-random expiry derived from the
 * domain name so demos are stable. Anchored to the 15th of the target month
 * so day-to-day drift never creates false mismatches. Clearly marked
 * source = SIMULATION.
 */
export function simulateDomainVerification(
  domain: string,
  options?: { mismatch?: boolean }
): DomainVerificationResult {
  let hash = 0;
  for (const c of domain) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  const monthsAhead = 3 + (Math.abs(hash) % 16); // 3–18 months
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + monthsAhead);
  expiry.setDate(15); // mid-month anchor → stable date string across days
  const registered = new Date(expiry);
  registered.setFullYear(registered.getFullYear() - (1 + (Math.abs(hash) % 3)));
  if (options?.mismatch) expiry.setDate(expiry.getDate() - 31);
  return {
    domain,
    domainExpiry: expiry,
    registeredAt: registered,
    registrar: ["GoDaddy", "Namecheap", "Cloudflare", "Porkbun"][
      Math.abs(hash) % 4
    ],
    registrationStatus: "active",
    source: "SIMULATION",
    verified: true,
  };
}

/**
 * Full domain verification pipeline: try RDAP → registrar API → simulation.
 * The result's `source` always states where the data came from.
 */
export async function verifyDomainExpiry(
  domain: string,
  opts?: { registrar?: string; apiToken?: string; forceSimulation?: boolean }
): Promise<DomainVerificationResult> {
  if (opts?.forceSimulation) return simulateDomainVerification(domain);

  let rdap = await verifyDomainViaRDAP(domain);
  // One retry for transient failures (timeouts, rate limits) — not for "not found".
  if (!rdap.verified && !rdap.error?.includes("not found")) {
    rdap = await verifyDomainViaRDAP(domain);
  }
  if (rdap.verified) return rdap;
  if (opts?.registrar && opts?.apiToken) {
    const reg = await verifyDomainViaRegistrar(domain, opts.registrar, opts.apiToken);
    if (reg?.verified) return reg;
  }
  // TLD without RDAP (e.g. .co, .ae) → legacy WHOIS.
  if (rdap.error?.includes("not found") || !(await rdapBaseFor(tldOf(domain)))) {
    const whois = await verifyDomainViaWhois(domain);
    if (whois.verified || whois.registrar) return whois;
  }
  // Real domains never get fabricated dates — report the failure instead.
  return rdap;
}
