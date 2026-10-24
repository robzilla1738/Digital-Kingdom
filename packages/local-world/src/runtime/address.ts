import { isIP } from "node:net";

/**
 * LP05: destination classification. A loopback address does not prove ownership, so classification only decides
 * what is refused outright; the supervisor additionally requires an exact registered endpoint + handshake.
 */
export type AddressClass = "loopback" | "unspecified" | "metadata" | "link_local" | "private" | "cgnat" | "multicast" | "reserved" | "public" | "hostname" | "ambiguous_numeric" | "invalid";

function v4(host: string): AddressClass {
  const o = host.split(".").map(Number);
  const [a, b] = o as [number, number, number, number];
  if (a === 127) return "loopback";
  if (a === 0) return "unspecified";
  if (host === "169.254.169.254" || host === "169.254.170.2") return "metadata";
  if (a === 169 && b === 254) return "link_local";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))) return "reserved";
  return "public";
}

export function classifyHost(raw: string): AddressClass {
  if (typeof raw !== "string" || !raw.length || raw.length > 255) return "invalid";
  const host = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  const fam = isIP(host);
  if (fam === 4) return v4(host);
  if (fam === 6) {
    const h = host.toLowerCase();
    const mapped = /^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h) ?? /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
    if (mapped) return v4(mapped[1]!);
    if (h === "::1" || /^0*:0*:0*:0*:0*:0*:0*:0*1$/.test(h)) return "loopback";
    if (h === "::") return "unspecified";
    if (h === "fd00:ec2::254") return "metadata";
    if (/^f[cd]/.test(h)) return "private";
    if (/^fe[89ab]/.test(h)) return "link_local";
    if (h.startsWith("ff")) return "multicast";
    return "public";
  }
  // Integer, hex or octal IPv4 spellings (2130706433, 0x7f000001, 0177.0.0.1, 127.1) are what URL parsers normalise
  // into addresses; the supervisor never normalises them and refuses them as ambiguous.
  if (/^[0-9a-fx.]+$/i.test(host) && /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host)) return "ambiguous_numeric";
  if (/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.?$/.test(host)) return "hostname";
  return "invalid";
}

export interface RegisteredEndpoint { resource_id: string; host: "127.0.0.1"; port: number }

/**
 * Refuse every destination that is not exactly a registered endpoint of this run. Returns the refusal reason, or
 * null when the destination is a registered loopback endpoint (which still needs a verified handshake).
 */
export function refuseDestination(dest: { host: string; port: number }, registered: RegisteredEndpoint[]): string | null {
  const cls = classifyHost(dest.host);
  if (cls === "hostname") return `host names are never resolved (DNS can be rebound): ${dest.host.slice(0, 80)}`;
  if (cls !== "loopback") return `${cls.replace(/_/g, " ")} destination refused: ${dest.host.slice(0, 80)}`;
  if (!registered.some((e) => e.host === dest.host && e.port === dest.port)) return `loopback ${dest.host}:${dest.port} is not an endpoint registered to this run`;
  return null;
}
