import "server-only";

import { sql } from "@/lib/db";
import { currentUserId } from "@/lib/supabase/server";

export type Role = "user" | "moderator" | "admin";

/**
 * The caller's role, resolved server-side from the database.
 *
 * Never trust a role claim from the client, and never gate admin UI on a
 * client-side check alone — the check has to happen where the data is served.
 */
export async function currentRole(): Promise<{ userId: string | null; role: Role | null }> {
  const userId = await currentUserId();
  if (!userId) return { userId: null, role: null };

  const [row] = await sql<{ role: Role }[]>`
    select role from profiles where id = ${userId}::uuid`;
  return { userId, role: row?.role ?? "user" };
}

export async function isModerator(): Promise<boolean> {
  const { role } = await currentRole();
  return role === "moderator" || role === "admin";
}
