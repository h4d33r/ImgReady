import { lookup } from "dns/promises";
import { BlockList, isIP } from "net";

export interface UrlSecurityPolicy {
  trustedHosts: string[];
  allowNonStandardHttpsPorts: boolean;
}

export interface ResolvedDestination {
  url: URL;
  address: string;
  family: 4 | 6;
}

const blockedV4 = new BlockList();
[
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
].forEach(([address, prefix]) => blockedV4.addSubnet(address as string, prefix as number, "ipv4"));

const blockedV6 = new BlockList();
[
  ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:20::", 28], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]
].forEach(([address, prefix]) => blockedV6.addSubnet(address as string, prefix as number, "ipv6"));

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

const blockedSuffixes = [
  ".localhost", ".local", ".localdomain", ".internal", ".lan", ".home", ".home.arpa",
  ".corp", ".test", ".invalid", ".onion", ".arpa"
];

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function normalizeHostname(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

export function normalizeTrustedHosts(hosts: string[]): string[] {
  return [...new Set(hosts.map(normalizeHostname).filter(Boolean))].sort();
}

export function isBlockedAddress(address: string): boolean {
  const raw = stripIpv6Brackets(address);
  const family = isIP(raw);
  if (family === 4) return blockedV4.check(raw, "ipv4");
  if (family === 6) return blockedV6.check(raw, "ipv6") || !globalV6.check(raw, "ipv6");
  return true;
}

export function validateUrlShape(rawUrl: string, policy: UrlSecurityPolicy): URL {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid URL."); }

  if (url.protocol !== "https:") throw new Error("Only HTTPS image URLs are allowed.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  if (!url.hostname) throw new Error("URL has no hostname.");

  const normalizedHost = normalizeHostname(url.hostname);
  const ipCandidate = stripIpv6Brackets(normalizedHost);
  const family = isIP(ipCandidate);

  if (normalizedHost === "localhost" || blockedSuffixes.some((suffix) => normalizedHost.endsWith(suffix))) {
    throw new Error(`Blocked local/internal hostname: ${normalizedHost}`);
  }
  if (!normalizedHost.includes(".") && family === 0) throw new Error("Single-label/internal hostnames are not allowed.");
  if (!policy.allowNonStandardHttpsPorts && url.port && url.port !== "443") {
    throw new Error("Non-standard HTTPS ports are blocked by the current security policy.");
  }
  if (!normalizeTrustedHosts(policy.trustedHosts).includes(normalizedHost)) {
    throw new Error(`Host is not trusted: ${normalizedHost}`);
  }
  if (family !== 0 && isBlockedAddress(ipCandidate)) {
    throw new Error(`Blocked non-public IP address: ${normalizedHost}`);
  }

  if (url.hostname.endsWith(".") && family === 0) url.hostname = normalizedHost;
  return url;
}

export async function resolveSafeDestination(rawUrl: string, policy: UrlSecurityPolicy): Promise<ResolvedDestination> {
  const url = validateUrlShape(rawUrl, policy);
  const rawHost = normalizeHostname(url.hostname);
  const host = stripIpv6Brackets(rawHost);
  const literalFamily = isIP(host);

  if (literalFamily !== 0) {
    if (isBlockedAddress(host)) throw new Error(`Blocked non-public IP address: ${rawHost}`);
    return { url, address: host, family: literalFamily as 4 | 6 };
  }

  const answers = await lookup(host, { all: true, verbatim: true });
  if (answers.length === 0) throw new Error(`DNS returned no addresses for ${host}.`);

  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) {
      throw new Error(`DNS for ${host} returned a blocked/non-public address (${answer.address}).`);
    }
  }

  const selected = answers[0];
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}
