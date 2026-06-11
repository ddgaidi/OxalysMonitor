import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import { dbRoleFromValue, roleFromMember, type MonitorMember } from "@/src/lib/roles";

type AdminAuth =
  | {
      admin: ReturnType<typeof createSupabaseAdminClient>;
      userId: string;
      memberId: string;
      actorRole: string;
    }
  | { error: NextResponse };

function hasAuthError(auth: AdminAuth): auth is { error: NextResponse } {
  return "error" in auth;
}

async function requireAdmin(): Promise<AdminAuth> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "not_authenticated" }, { status: 401 }) };

  const admin = createSupabaseAdminClient();
  const { data: member } = await admin
    .from("membre")
    .select("id, auth_id, prenom, nom, email, role, fablab_ref")
    .or(`auth_id.eq.${user.id},id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();

  const typedMember = member as MonitorMember | null;
  if (!typedMember || roleFromMember(typedMember) !== "admin") {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  return { admin, userId: user.id, memberId: typedMember.id, actorRole: typedMember.role ?? "administrateur" };
}

export async function GET() {
  const auth = await requireAdmin();
  if (hasAuthError(auth)) return auth.error;

  const [logsResult, membersResult] = await Promise.all([
    auth.admin
      .from("fablab_log")
      .select("id, fablab_id, actor_membre_id, actor_personnel_id, actor_role, action, details, created_at")
      .order("created_at", { ascending: false })
      .limit(250),
    auth.admin
      .from("membre")
      .select("id, auth_id, prenom, nom, email, fablab_ref, role")
      .order("nom", { ascending: true })
      .limit(250),
  ]);

  if (logsResult.error) return NextResponse.json({ error: logsResult.error.message }, { status: 500 });
  if (membersResult.error) return NextResponse.json({ error: membersResult.error.message }, { status: 500 });

  return NextResponse.json({ logs: logsResult.data ?? [], members: membersResult.data ?? [] });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (hasAuthError(auth)) return auth.error;

  const body = (await request.json()) as {
    memberId?: string;
    role?: string;
  };

  if (!body.memberId) return NextResponse.json({ error: "missing_member" }, { status: 400 });

  const nextRole = dbRoleFromValue(body.role);
  if (!nextRole) {
    return NextResponse.json({ error: "missing_role_update" }, { status: 400 });
  }

  const { error } = await auth.admin.from("membre").update({ role: nextRole }).eq("id", body.memberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await auth.admin.from("fablab_log").insert({
    actor_membre_id: auth.memberId,
    actor_role: auth.actorRole,
    action: "admin.role.updated",
    details: { member_id: body.memberId, role: nextRole },
  });

  return NextResponse.json({ ok: true });
}
