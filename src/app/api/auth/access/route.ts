import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { createSupabaseAdminClient } from "@/src/lib/supabase/admin";
import {
  canAccessFablab,
  canUseMonitor,
  memberFablabId,
  roleFromMember,
  type MonitorMember,
} from "@/src/lib/roles";

async function findMemberByAuthUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  authUserId: string,
) {
  return admin
    .from("membre")
    .select("id, auth_id, prenom, nom, email, role, fablab_ref")
    .or(`auth_id.eq.${authUserId},id.eq.${authUserId}`)
    .limit(1)
    .maybeSingle();
}

export async function POST(request: NextRequest) {
  const { fablabId } = (await request.json()) as { fablabId?: string };
  const requestedFablabId = typeof fablabId === "string" && fablabId.trim() ? fablabId : null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const admin = createSupabaseAdminClient();
  const { data: member, error } = await findMemberByAuthUser(admin, user.id);

  if (error || !member) {
    return NextResponse.json({ error: error?.message ?? "member_not_found" }, { status: 403 });
  }

  const typedMember = member as MonitorMember;
  const role = roleFromMember(typedMember);
  const associatedFablabId = memberFablabId(typedMember);

  if (!canUseMonitor(role)) {
    return NextResponse.json({ error: "forbidden_role", role }, { status: 403 });
  }

  if (!canAccessFablab(role, associatedFablabId, requestedFablabId)) {
    return NextResponse.json({ error: "school_mismatch", role }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    role,
    member: {
      id: typedMember.id,
      prenom: typedMember.prenom,
      nom: typedMember.nom,
      email: typedMember.email,
      fablab_ref: associatedFablabId,
      fablab_id: associatedFablabId,
    },
  });
}
