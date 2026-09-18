import { createHmac, timingSafeEqual } from "node:crypto";

// ── Stateless session (HMAC, auto-contido) ───────────────────────────────────
// O token carrega {sub, un, iat, exp} e é autenticado com
// TELEZAP_SESSION_SECRET. Nenhum Map em memória — qualquer Function pode
// validar sem consultar outra instância. Expiração é TTL fixo (sem sliding).

export interface SessionRecord {
  userId: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

/** 7 dias, TTL fixo (iat + TTL = exp). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Identificador determinístico do código/build da função — sem segredo, sem token. */
export const DIAG_BUILD_ID = "e6e3c8d-stateless-m1";

export type VerificationReason =
  | "valid"
  | "missing_token"
  | "missing_secret"
  | "invalid_format"
  | "invalid_signature"
  | "invalid_payload"
  | "invalid_sub_un"
  | "invalid_iat"
  | "expired";

export function isSecretPresent(): boolean {
  return (process.env.TELEZAP_SESSION_SECRET ?? "").trim().length > 0;
}

function getSecret(): string {
  const secret = (process.env.TELEZAP_SESSION_SECRET ?? "").trim();
  if (!secret) {
    throw new Error(
      "Missing TELEZAP_SESSION_SECRET. Generate one with: openssl rand -hex 32",
    );
  }
  return secret;
}

function b64urlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function b64urlDecodeToString(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/**
 * Cria um token auto-contido. O payload contém somente os dados necessários
 * para reconstruir a identidade (sub, un, iat, exp) — nunca senha, hash,
 * ou segredo de plataforma.
 */
export function createSession(userId: string, username: string, now = Date.now()): string {
  const secret = getSecret();
  const iat = now;
  const exp = now + SESSION_TTL_MS;
  const payload = JSON.stringify({ sub: userId, un: username, iat, exp });
  const payloadB64 = b64urlEncode(payload);
  const sig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

/**
 * Implementação interna única — toda validação HMAC/payload/iat/exp passa
 * por aqui. Tanto verifySession quanto verifySessionWithReason a utilizam,
 * garantindo que diagnóstico e autenticação real sejam idênticos.
 */
function verifySessionInternal(
  token: string,
  now: number,
): { record: SessionRecord | null; reason: VerificationReason } {
  if (!token || typeof token !== "string") return { record: null, reason: "missing_token" };

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return { record: null, reason: "missing_secret" };
  }

  const dot = token.indexOf(".");
  if (dot === -1) return { record: null, reason: "invalid_format" };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!payloadB64 || !sigB64) return { record: null, reason: "invalid_format" };

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const a = Buffer.from(sigB64, "utf8");
  const b = Buffer.from(expectedSig, "utf8");
  if (a.length !== b.length) return { record: null, reason: "invalid_signature" };
  try {
    if (!timingSafeEqual(a, b)) return { record: null, reason: "invalid_signature" };
  } catch {
    return { record: null, reason: "invalid_signature" };
  }

  let payload: { sub?: unknown; un?: unknown; iat?: unknown; exp?: unknown };
  try {
    const json = b64urlDecodeToString(payloadB64);
    payload = JSON.parse(json);
  } catch {
    return { record: null, reason: "invalid_payload" };
  }
  const { sub, un, iat, exp } = payload;
  if (typeof sub !== "string" || typeof un !== "string") return { record: null, reason: "invalid_sub_un" };
  if (typeof iat !== "number" || typeof exp !== "number") return { record: null, reason: "invalid_iat" };
  if (!Number.isFinite(iat) || !Number.isFinite(exp)) return { record: null, reason: "invalid_iat" };
  if (exp <= now) return { record: null, reason: "expired" };
  if (iat > now + 60_000) return { record: null, reason: "invalid_iat" };

  return { record: { userId: sub, username: un, createdAt: iat, expiresAt: exp }, reason: "valid" };
}

/**
 * Verifica um token stateless. Retorna o SessionRecord se válido e não
 * expirado, ou null caso contrário. Não consulta nenhum Map.
 */
export function verifySession(token: string, now = Date.now()): SessionRecord | null {
  return verifySessionInternal(token, now).record;
}

/**
 * Variante diagnóstica — expõe apenas o motivo seguro (enum), sem token,
 * sem secret, sem payload. Usa exatamente a mesma validação interna.
 */
export function verifySessionWithReason(
  token: string,
  now = Date.now(),
): { record: SessionRecord | null; reason: VerificationReason } {
  return verifySessionInternal(token, now);
}

// ── Compatibilidade: o modelo anterior usava Map + sliding TTL ─────────────
// As funções abaixo eram test-only ou stateful. Mantidas como no-op apenas
// para não quebrar imports existentes que ainda chamam __resetSessionsForTests
// em beforeEach — o novo modelo não tem estado para resetar.

/** @deprecated stateless: não há Map para resetar — mantido como no-op para compatibilidade de testes. */
export function __resetSessionsForTests(): void {
  // stateless: nada para limpar
}

/** @deprecated removido: não há Map para contar — use verifySession em vez de contagem. */
export function __sessionCountForTests(): number {
  return 0;
}

// Alias de compatibilidade: getSession agora é verifySession com TTL fixo
// (sem sliding). Mantido temporariamente para migração mínima; prefira verifySession.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getSession(token: string, now = Date.now()): SessionRecord | null {
  return verifySession(token, now);
}

// Removido: destroySession — logout stateless é só limpar o cookie.
// Se importado, falhará em tempo de compilação, forçando a remoção da dependência.
