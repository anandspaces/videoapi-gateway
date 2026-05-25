/** Bun bcrypt wrapper for consumer passwords (API keys still use peppered SHA-256). */

export async function hashPassword(plain: string, cost = 10): Promise<string> {
  return Bun.password.hash(plain, { algorithm: "bcrypt", cost });
}

export async function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return Bun.password.verify(plain, passwordHash);
}
