import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

type SsoPayload = {
  m: "admin";
  school_id: string;
  exp: number;
};

function timingSafeB64urlEqual(a: string, b: string) {
  try {
    const ba = Buffer.from(a, "base64url");
    const bb = Buffer.from(b, "base64url");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function signD(d: string, secret: string) {
  return createHmac("sha256", secret).update(d).digest("base64url");
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const d = url.searchParams.get("d");
  const s = url.searchParams.get("s");

  const base = new URL(request.nextUrl.origin);
  const fail = (q: string) => NextResponse.redirect(new URL(`/login?error=${q}`, base));

  if (!d || !s) return fail("handoff");

  const secret = process.env.OXALYS_SSO_SHARED_SECRET;
  if (!secret) {
    console.error("[teach-sso] OXALYS_SSO_SHARED_SECRET is not set");
    return fail("sso_config");
  }

  if (!timingSafeB64urlEqual(s, signD(d, secret))) {
    return fail("handoff");
  }

  let payload: SsoPayload;
  try {
    const json = Buffer.from(d, "base64url").toString("utf8");
    payload = JSON.parse(json) as SsoPayload;
  } catch {
    return fail("handoff");
  }

  if (payload.m !== "admin" || !payload.school_id || typeof payload.exp !== "number") {
    return fail("handoff");
  }

  if (Date.now() / 1000 > payload.exp) {
    return fail("handoff");
  }

  const email = process.env.MONITOR_SSO_DEMO_USER_EMAIL;
  const password = process.env.MONITOR_SSO_DEMO_USER_PASSWORD;
  if (!email || !password) {
    console.error("[teach-sso] MONITOR_SSO_DEMO_USER_EMAIL or MONITOR_SSO_DEMO_USER_PASSWORD is missing");
    return fail("sso_config");
  }

  const cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (all) => {
          for (const c of all) {
            cookiesToSet.push({ name: c.name, value: c.value, options: c.options ?? {} });
          }
        },
      },
    },
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error("[teach-sso] signInWithPassword:", signInError.message);
    return fail("sso_config");
  }

  const out = new URL("/auth/monitor-callback", base);
  out.searchParams.set("school_id", payload.school_id);
  out.searchParams.set("from_sso", "1");
  const res = NextResponse.redirect(out);

  for (const c of cookiesToSet) {
    res.cookies.set(c.name, c.value, c.options);
  }
  return res;
}
