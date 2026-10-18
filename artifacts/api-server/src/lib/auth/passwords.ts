import { hash, verify } from "@node-rs/argon2";

// @node-rs/argon2 defaults to argon2id.
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
