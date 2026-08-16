import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

function truncateIpv4(ip: string): string {
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts.slice(0, 3).join(".")}.0` : ip;
}

function expandIpv6(ip: string): string[] {
  const [leftRaw, rightRaw = ""] = ip.split("::", 2);
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (!ip.includes("::")) return left;
  return [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
}

/** Truncate IPv4 to /24 and IPv6 to /64 before storing login environment data. */
export function truncateIp(ip: string): string {
  const mappedIpv4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) return truncateIpv4(mappedIpv4);
  if (isIP(ip) === 4) return truncateIpv4(ip);
  if (isIP(ip) === 6) return `${expandIpv6(ip).slice(0, 4).join(":")}::`;
  return ip;
}

function majorVersion(userAgent: string, pattern: RegExp): string | null {
  const match = userAgent.match(pattern);
  return match?.[1] ?? null;
}

/** Keep only a browser family/major version and OS family, never the raw User-Agent. */
export function summarizeUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;

  let browser = "Browser";
  const edge = majorVersion(userAgent, /Edg\/(\d+)/);
  const firefox = majorVersion(userAgent, /Firefox\/(\d+)/);
  const chrome = majorVersion(userAgent, /(?:Chrome|CriOS)\/(\d+)/);
  const safari = majorVersion(userAgent, /Version\/(\d+).+Safari\//);
  if (edge) browser = `Edge ${edge}`;
  else if (firefox) browser = `Firefox ${firefox}`;
  else if (chrome) browser = `Chrome ${chrome}`;
  else if (safari) browser = `Safari ${safari}`;

  let os = "Unknown OS";
  if (/Windows NT/.test(userAgent)) os = "Windows";
  else if (/Android/.test(userAgent)) os = "Android";
  else if (/(?:iPhone|iPad|iPod)/.test(userAgent)) os = "iOS";
  else if (/Mac OS X/.test(userAgent)) os = "macOS";
  else if (/Linux/.test(userAgent)) os = "Linux";

  return `${browser} · ${os}`;
}

export function requestEnvironment(req: FastifyRequest): {
  ipPrefix: string;
  userAgentSummary: string | null;
} {
  const header = req.headers["user-agent"];
  return {
    ipPrefix: truncateIp(req.ip),
    userAgentSummary: summarizeUserAgent(typeof header === "string" ? header : undefined),
  };
}
