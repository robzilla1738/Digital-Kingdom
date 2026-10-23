import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";
import { HttpError } from "./store.ts";

/**
 * OIDC ID-token verification for SSO sign-in (roadmap R10.1). Verifies RS256/ES256 signatures against a pinned
 * JWKS, issuer, audience, expiry and not-before, with clock skew of at most 60 s. A verified subject gets access
 * only through an explicit administrator mapping (issuer + subject -> role and projects); an unmapped subject
 * gets nothing. Live verification against a real identity provider remains an external gate.
 */
export interface OidcConfig { issuer: string; audience: string; jwks: { keys: (JsonWebKey & { kid?: string; alg?: string })[] } }

const b64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function oidcFromEnv(env: NodeJS.ProcessEnv): OidcConfig | null {
  if (!env.DK_OIDC_ISSUER || !env.DK_OIDC_AUDIENCE || !env.DK_OIDC_JWKS) return null;
  const jwks = JSON.parse(env.DK_OIDC_JWKS) as OidcConfig["jwks"];
  if (!Array.isArray(jwks.keys) || !jwks.keys.length) throw new Error("DK_OIDC_JWKS must be a JWKS document with keys");
  return { issuer: env.DK_OIDC_ISSUER, audience: env.DK_OIDC_AUDIENCE, jwks };
}

export function verifyIdToken(token: string, cfg: OidcConfig, now = Date.now()): { sub: string; name?: string; email?: string; exp: number } {
  if (typeof token !== "string" || token.length > 8192) throw new HttpError(400, "id_token is required");
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "malformed id_token");
  let header: { alg?: string; kid?: string; typ?: string }, claims: Record<string, unknown>;
  try { header = JSON.parse(b64(parts[0]!).toString("utf8")); claims = JSON.parse(b64(parts[1]!).toString("utf8")); } catch { throw new HttpError(401, "malformed id_token"); }
  if (header.alg !== "RS256" && header.alg !== "ES256") throw new HttpError(401, `unsupported alg ${String(header.alg)}`); // never "none" or HS*
  const jwk = cfg.jwks.keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.alg || k.alg === header.alg));
  if (!jwk) throw new HttpError(401, "no matching signing key");
  const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
  const v = createVerify("SHA256"); v.update(`${parts[0]}.${parts[1]}`);
  const ok = header.alg === "RS256" ? v.verify(key, b64(parts[2]!)) : v.verify({ key, dsaEncoding: "ieee-p1363" }, b64(parts[2]!));
  if (!ok) throw new HttpError(401, "invalid id_token signature");
  const skew = 60;
  const t = Math.floor(now / 1000);
  if (claims.iss !== cfg.issuer) throw new HttpError(401, "wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.audience)) throw new HttpError(401, "wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + skew < t) throw new HttpError(401, "id_token expired");
  if (typeof claims.nbf === "number" && claims.nbf - skew > t) throw new HttpError(401, "id_token not yet valid");
  if (typeof claims.iat === "number" && claims.iat - skew > t) throw new HttpError(401, "id_token issued in the future");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) throw new HttpError(401, "id_token has no subject");
  return { sub: claims.sub, exp: claims.exp, ...(typeof claims.name === "string" ? { name: claims.name.slice(0, 80) } : {}), ...(typeof claims.email === "string" ? { email: claims.email.slice(0, 120) } : {}) };
}
