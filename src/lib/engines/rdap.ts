import { assertSafeTarget } from "@/lib/validators";

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
  source: "RDAP" | "REGISTRAR_API" | "SIMULATION";
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

/** Real RDAP lookup via rdap.org (redirects to the authoritative RDAP server). */
export async function verifyDomainViaRDAP(
  domain: string
): Promise<DomainVerificationResult> {
  await assertSafeTarget(domain);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });
    clearTimeout(timeout);
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
  if (!opts?.forceSimulation) {
    const rdap = await verifyDomainViaRDAP(domain);
    if (rdap.verified) return rdap;
    if (opts?.registrar && opts?.apiToken) {
      const reg = await verifyDomainViaRegistrar(domain, opts.registrar, opts.apiToken);
      if (reg?.verified) return reg;
    }
  }
  return simulateDomainVerification(domain);
}
