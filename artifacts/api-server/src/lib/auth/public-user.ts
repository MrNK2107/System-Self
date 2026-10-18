import type { User } from "@workspace/db";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  role: "user" | "admin";
  emailVerified: boolean;
  timezone: string;
  createdAt: string;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    emailVerified: u.emailVerifiedAt !== null,
    timezone: u.timezone,
    createdAt: u.createdAt.toISOString(),
  };
}
