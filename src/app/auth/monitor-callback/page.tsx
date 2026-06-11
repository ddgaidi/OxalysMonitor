"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/src/lib/supabase/client";

function MonitorCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("Connexion au moniteur…");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const tokenHash = searchParams.get("token_hash");
      const schoolId = searchParams.get("school_id");
      const fromSso = searchParams.get("from_sso") === "1";

      if (!schoolId) {
        if (!cancelled) {
          setMessage("Lien invalide ou expiré.");
          router.replace("/connexion?error=handoff");
        }
        return;
      }

      const supabase = createClient();

      if (fromSso) {
        const { data: sData, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr || !sData.session) {
          if (!cancelled) {
            setMessage("Session introuvable. Réessayez depuis Oxalys Teach.");
            router.replace("/connexion?error=handoff");
          }
          return;
        }
      } else if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "magiclink",
        });

        if (error || !data.session) {
          if (!cancelled) {
            setMessage("Impossible de finaliser la connexion.");
            router.replace("/connexion?error=handoff");
          }
          return;
        }
      } else {
        if (!cancelled) {
          setMessage("Lien invalide ou expiré.");
          router.replace("/connexion?error=handoff");
        }
        return;
      }

      const { data: fabRow, error: fabError } = await supabase
        .from("fablab")
        .select("*")
        .eq("id", schoolId)
        .maybeSingle();

      if (fabError || !fabRow) {
        if (!cancelled) {
          setMessage("Établissement introuvable.");
          router.replace("/connexion?error=fablab");
        }
        return;
      }

      try {
        localStorage.setItem("oxalys_fablab", JSON.stringify(fabRow));
      } catch {
        // continue even if storage fails
      }

      const accessResponse = await fetch("/api/auth/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fablabId: schoolId }),
      });
      const accessPayload = await accessResponse.json().catch(() => ({}));
      if (!accessResponse.ok) {
        if (!cancelled) {
          setMessage("Accès au moniteur refusé.");
          router.replace("/connexion?error=handoff");
        }
        return;
      }
      try {
        localStorage.setItem("oxalys_monitor_role", accessPayload.role);
      } catch {
        // ignore
      }

      if (!cancelled) {
        router.replace("/dashboard");
        router.refresh();
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#020408] text-slate-200">
      <p className="text-sm text-slate-400">{message}</p>
    </div>
  );
}

export default function MonitorCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#020408] text-slate-200">
          <p className="text-sm text-slate-400">Chargement…</p>
        </div>
      }
    >
      <MonitorCallbackInner />
    </Suspense>
  );
}
