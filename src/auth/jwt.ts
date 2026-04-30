type JwtPayload = {
  sub: string;
  scope: string[];
  iat: number;
  exp: number;
  jti: string;
};

const encoder = new TextEncoder();

function toBase64Url(input: Uint8Array | string): string {
  const s = typeof input === "string" ? input : String.fromCharCode(...input);
  return Buffer.from(s, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf-8");
}

async function signHmacSha256(message: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return new Uint8Array(sig);
}

export async function signAccessJwt(input: {
  consumerId: string;
  scopes: string[];
  secret: string;
  expiresInHours: number;
}): Promise<{ token: string; expiresAt: string; jti: string }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + input.expiresInHours * 3600;
  const jti = crypto.randomUUID();
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: input.consumerId,
    scope: input.scopes,
    iat: nowSec,
    exp,
    jti,
  };
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await signHmacSha256(signingInput, input.secret);
  const token = `${signingInput}.${toBase64Url(signature)}`;
  return { token, expiresAt: new Date(exp * 1000).toISOString(), jti };
}

export async function verifyAccessJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSig) return null;

  let header: { alg?: string; typ?: string };
  let payload: JwtPayload;
  try {
    header = JSON.parse(fromBase64Url(encodedHeader));
    payload = JSON.parse(fromBase64Url(encodedPayload)) as JwtPayload;
  } catch {
    return null;
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  if (
    typeof payload.sub !== "string" ||
    !Array.isArray(payload.scope) ||
    !payload.scope.every((x) => typeof x === "string") ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    typeof payload.jti !== "string"
  ) {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = await signHmacSha256(signingInput, secret);
  const expectedSigEncoded = toBase64Url(expectedSig);
  if (expectedSigEncoded !== encodedSig) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return null;
  return payload;
}
