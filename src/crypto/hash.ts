export async function hashApiKey(secret: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${pepper}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(buf).toString("hex");
}

export function randomApiKey(): { plaintext: string; prefix: string } {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = Buffer.from(bytes).toString("base64url");
  const plaintext = `gw_live_${b64}`;
  const prefix = plaintext.slice(0, 12);
  return { plaintext, prefix };
}

export function randomId(): string {
  return crypto.randomUUID();
}
