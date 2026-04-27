"use client";

import React, { type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { createClient } from "@/src/lib/supabase/client";

interface Fablab {
  id: string;
  nom: string;
  adresse: string;
  description: string;
  equipements: string[];
  lien: string;
  image: string;
  created_at: string;
}

const GRADIENT_PAIRS = [
  { from: "#3b82f6", to: "#06b6d4" },
  { from: "#8b5cf6", to: "#6366f1" },
  { from: "#ec4899", to: "#f43f5e" },
  { from: "#06b6d4", to: "#0891b2" },
  { from: "#f59e0b", to: "#f97316" },
  { from: "#10b981", to: "#059669" },
  { from: "#a78bfa", to: "#7c3aed" },
  { from: "#fb7185", to: "#e11d48" },
];

const THEME = {
  dark: {
    bg:           "#020408",
    cardBg:       "rgba(255,255,255,0.03)",
    cardBorder:   "rgba(255,255,255,0.07)",
    cardShadow:   "0 60px 120px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset",
    topLine:      "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
    text:         "#f8fafc",
    textMuted:    "rgba(255,255,255,0.4)",
    textSubtle:   "rgba(255,255,255,0.18)",
    inputBg:      "rgba(255,255,255,0.05)",
    inputBorder:  "rgba(255,255,255,0.1)",
    inputFocus:   "rgba(59,130,246,0.5)",
    dotInactive:  "rgba(255,255,255,0.15)",
    skeletonBg:   "rgba(255,255,255,0.05)",
    cardItemBg:   "rgba(255,255,255,0.03)",
    cardItemBorder:"rgba(255,255,255,0.07)",
    imgOverlay:   "linear-gradient(to bottom, transparent 25%, rgba(4,6,12,0.85) 100%)",
    footerBorder: "rgba(255,255,255,0.07)",
    toggleBg:     "rgba(255,255,255,0.08)",
    toggleBorder: "rgba(255,255,255,0.12)",
    toggleThumb:  "rgba(255,255,255,0.55)",
    badgeText:    "rgba(255,255,255,0.75)",
  },
  light: {
    bg:           "#edf2f7",
    cardBg:       "rgba(255,255,255,0.85)",
    cardBorder:   "rgba(0,0,0,0.07)",
    cardShadow:   "0 40px 100px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.9) inset",
    topLine:      "linear-gradient(90deg, transparent, rgba(59,130,246,0.2), transparent)",
    text:         "#0f172a",
    textMuted:    "rgba(15,23,42,0.5)",
    textSubtle:   "rgba(15,23,42,0.3)",
    inputBg:      "rgba(0,0,0,0.04)",
    inputBorder:  "rgba(0,0,0,0.12)",
    inputFocus:   "rgba(59,130,246,0.5)",
    dotInactive:  "rgba(0,0,0,0.15)",
    skeletonBg:   "rgba(0,0,0,0.06)",
    cardItemBg:   "rgba(0,0,0,0.025)",
    cardItemBorder:"rgba(0,0,0,0.07)",
    imgOverlay:   "linear-gradient(to bottom, transparent 25%, rgba(240,244,250,0.75) 100%)",
    footerBorder: "rgba(0,0,0,0.08)",
    toggleBg:     "rgba(0,0,0,0.07)",
    toggleBorder: "rgba(0,0,0,0.1)",
    toggleThumb:  "#fff",
    badgeText:    "rgba(15,23,42,0.7)",
  },
};

function parseCity(adresse: string): string {
  return adresse.split("·")[0]?.trim() ?? adresse;
}

function getGradient(index: number) {
  return GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
}

export default function LoginPage() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(true);
  const [step, setStep] = useState<"fablab" | "credentials">("fablab");
  const [fablabs, setFablabs] = useState<Fablab[]>([]);
  const [loadingFablabs, setLoadingFablabs] = useState(true);
  const [selectedFablab, setSelectedFablab] = useState<Fablab | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  /** Découverte e-mail / mot de passe (état, pas seulement CSS : hover sur group est fragile avec motion/TW v4) */
  const [demoCredsRevealed, setDemoCredsRevealed] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const loadFablabs = async () => {
      try {
        const { data, error } = await supabase
          .from("fablab")
          .select("*")
          .order("nom");

        if (!active) return;
        if (error) {
          console.error(error);
        } else if (data) {
          setFablabs(data as Fablab[]);
        }
      } catch (err) {
        if (active) console.error(err);
      } finally {
        if (active) setLoadingFablabs(false);
      }
    };

    void loadFablabs();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const err = p.get("error");
    if (err === "handoff") {
      setError("La connexion depuis Oxalys Teach a échoué. Reconnectez-vous ici.");
    } else if (err === "fablab") {
      setError("Établissement introuvable. Choisissez de nouveau le vôtre puis connectez-vous.");
    } else if (err === "sso_config") {
      setError("Configuration serveur incomplète (SSO). Vérifiez OXALYS_SSO_SHARED_SECRET et MONITOR_SSO_DEMO sur Vercel.");
    }
  }, []);

  const filteredFablabs = useMemo(() => fablabs.filter(
    (f) =>
      f.nom.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.adresse.toLowerCase().includes(searchQuery.toLowerCase())
  ), [fablabs, searchQuery]);

  const handleSelectFablab = (fablab: Fablab) => {
    setSelectedFablab(fablab);
    setDemoCredsRevealed(false);
    setTimeout(() => setStep("credentials"), 200);
  };

  const handleLogin = async (e: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setLoading(false);
      setError(authError.message);
      return;
    }

    if (selectedFablab) {
      localStorage.setItem("oxalys_fablab", JSON.stringify(selectedFablab));
    }

    router.push("/dashboard");
    router.refresh();
  };

  const t = isDark ? THEME.dark : THEME.light;

  const glassPanelStyle = useMemo(() => ({
    background: t.cardBg,
    border: `1px solid ${t.cardBorder}`,
    boxShadow: t.cardShadow,
    backdropFilter: "blur(40px)",
    WebkitBackdropFilter: "blur(40px)",
    transition: "background 0.5s, border-color 0.5s, box-shadow 0.5s",
  }), [t.cardBg, t.cardBorder, t.cardShadow]);

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center relative overflow-hidden"
      style={{ background: t.bg, transition: "background 0.6s ease" }}
    >
      {/* ── BACKGROUNDS ── */}
      {/* Dark: animated orbs */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ opacity: isDark ? 1 : 0, transition: "opacity 0.6s ease" }}
      >
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
        <div className="scan-line" />
      </div>
      {/* Dots pattern — white in dark, slate in light */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle, ${isDark ? "rgba(255,255,255,0.06)" : "rgba(100,116,139,0.12)"} 1px, transparent 1px)`,
          backgroundSize: "32px 32px",
          transition: "background-image 0.6s ease",
        }}
      />
      {/* Light: soft gradient blobs */}
      <div
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ opacity: isDark ? 0 : 1, transition: "opacity 0.6s ease" }}
      >
        <div
          className="absolute"
          style={{
            width: 500, height: 500,
            top: -120, left: -120,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(147,197,253,0.35) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: 600, height: 600,
            bottom: -200, right: -150,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(196,181,253,0.3) 0%, transparent 70%)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute"
          style={{
            width: 350, height: 350,
            top: "35%", right: "8%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(134,239,172,0.2) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
      </div>

      {/* ── THEME TOGGLE ── */}
      <div className="absolute top-5 right-5 z-50">
        <motion.button
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={() => setIsDark(!isDark)}
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{
            background: t.toggleBg,
            border: `1px solid ${t.toggleBorder}`,
            backdropFilter: "blur(20px)",
            transition: "background 0.4s, border-color 0.4s",
          }}
          title={isDark ? "Mode clair" : "Mode sombre"}
        >
          {/* Sun */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: isDark ? "rgba(255,255,255,0.3)" : "#f59e0b", transition: "color 0.3s", flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="4" />
            <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
          {/* Pill */}
          <div style={{
            position: "relative", width: 30, height: 17, borderRadius: 9, flexShrink: 0,
            background: isDark ? "rgba(255,255,255,0.1)" : "#3b82f6",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.15)" : "rgba(59,130,246,0.4)"}`,
            transition: "background 0.3s, border-color 0.3s",
          }}>
            <div style={{
              position: "absolute", top: 2,
              left: isDark ? 2 : 13,
              width: 11, height: 11, borderRadius: "50%",
              background: t.toggleThumb,
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              transition: "left 0.25s cubic-bezier(0.34,1.56,0.64,1), background 0.3s",
            }} />
          </div>
          {/* Moon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: isDark ? "#818cf8" : "rgba(0,0,0,0.2)", transition: "color 0.3s", flexShrink: 0 }}
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </motion.button>
      </div>

      {/* ── CARD ── */}
      <motion.div
        initial={{ opacity: 0, scale: 0.88, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full mx-4"
        style={{ maxWidth: step === "fablab" ? "680px" : "460px", transition: "max-width 0.4s ease" }}
      >
        <div
          className="relative overflow-hidden rounded-[36px] p-10"
          style={glassPanelStyle}
        >
          {/* Top accent line */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px"
            style={{ background: t.topLine, transition: "background 0.5s" }}
          />

          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex justify-center mb-8"
          >
            <Image
              src={isDark ? "/oxalys-monitor-light.png" : "/oxalys-monitor.png"}
              alt="Oxalys Monitor"
              width={160}
              height={52}
              className="h-12 w-auto object-contain"
              priority
            />
          </motion.div>

          {/* Step dots */}
          <div className="flex items-center justify-center gap-2.5 mb-7">
            {(["fablab", "credentials"] as const).map((s) => {
              const active = step === s || (s === "fablab" && step === "credentials");
              return (
                <div
                  key={s}
                  className="rounded-full"
                  style={{
                    width: active ? "20px" : "6px",
                    height: "6px",
                    background: active ? "#3b82f6" : t.dotInactive,
                    boxShadow: step === s ? "0 0 8px rgba(59,130,246,0.7)" : "none",
                    transition: "width 0.4s cubic-bezier(0.34,1.56,0.64,1), background 0.4s",
                  }}
                />
              );
            })}
          </div>

          {/* Content */}
          <AnimatePresence mode="wait">
            {/* ── STEP 1: FABLAB ── */}
            {step === "fablab" && (
              <motion.div
                key="fablab"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.35em]"
                    style={{ color: t.textMuted }}>
                    Sélectionnez votre FabLab
                  </p>
                  {fablabs.length > 0 && (
                    <span className="text-[9px] font-mono" style={{ color: t.textSubtle }}>
                      {fablabs.length} FabLabs
                    </span>
                  )}
                </div>

                {/* Search */}
                {fablabs.length > 6 && (
                  <div className="relative mb-4">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Rechercher un FabLab..."
                      className="w-full rounded-xl px-4 py-2.5 text-[12px] outline-none transition-all"
                      style={{
                        background: t.inputBg,
                        border: `1px solid ${t.inputBorder}`,
                        color: t.text,
                      }}
                    />
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2"
                      width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2"
                      style={{ color: t.textSubtle }}
                    >
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                  </div>
                )}

                {loadingFablabs ? (
                  <div className="grid grid-cols-3 gap-2.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-28 rounded-2xl animate-pulse"
                        style={{ background: t.skeletonBg }} />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5 overflow-y-auto pr-1"
                    style={{ maxHeight: "340px" }}>
                    {filteredFablabs.map((fablab, i) => {
                      const grad = getGradient(i);
                      const isHov = hoveredId === fablab.id;
                      return (
                        <motion.button
                          key={fablab.id}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.04, 0.28), duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                          onClick={() => handleSelectFablab(fablab)}
                          onMouseEnter={() => setHoveredId(fablab.id)}
                          onMouseLeave={() => setHoveredId(null)}
                          className="relative overflow-hidden rounded-2xl text-left cursor-pointer flex flex-col"
                          style={{
                            background: isHov
                              ? `linear-gradient(135deg, ${grad.from}20, ${grad.to}10)`
                              : t.cardItemBg,
                            border: `1px solid ${isHov ? grad.from + "50" : t.cardItemBorder}`,
                            boxShadow: isHov ? `0 8px 28px ${grad.from}22` : "none",
                            transform: isHov ? "translateY(-2px)" : "none",
                            transition: "background 0.25s, border-color 0.25s, box-shadow 0.25s, transform 0.25s",
                          }}
                        >
                          {/* Image */}
                          <div className="relative w-full h-20 overflow-hidden rounded-t-2xl shrink-0">
                            <Image
                              src={fablab.image} alt={fablab.nom} fill
                              className="object-cover"
                              style={{
                                filter: isHov
                                  ? isDark ? "brightness(0.85)" : "brightness(0.95)"
                                  : isDark ? "brightness(0.6) saturate(0.75)" : "brightness(0.85) saturate(0.85)",
                                transition: "filter 0.3s",
                              }}
                              unoptimized
                            />
                            <div
                              className="absolute inset-0"
                              style={{ background: t.imgOverlay }}
                            />
                          </div>

                          {/* Text */}
                          <div className="p-3">
                            <span className="text-[11px] font-bold block leading-tight truncate"
                              style={{ color: t.text }}>
                              {fablab.nom}
                            </span>
                            <span className="text-[9px] block mt-0.5 truncate"
                              style={{ color: t.textMuted }}>
                              {parseCity(fablab.adresse)}
                            </span>
                          </div>

                          {/* Corner glow */}
                          <div
                            className="absolute -top-6 -right-6 w-20 h-20 rounded-full pointer-events-none"
                            style={{
                              background: `radial-gradient(circle, ${grad.from}, transparent)`,
                              opacity: isHov ? 0.28 : 0,
                              transition: "opacity 0.3s",
                            }}
                          />
                        </motion.button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}

            {/* ── STEP 2: CREDENTIALS ── */}
            {step === "credentials" && (
              <motion.div
                key="credentials"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Back + badge */}
                <div className="flex items-center gap-3 mb-7">
                  <button
                    onClick={() => { setStep("fablab"); setError(""); setDemoCredsRevealed(false); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all"
                    style={{
                      color: t.textMuted,
                      border: `1px solid ${t.inputBorder}`,
                      background: t.inputBg,
                    }}
                  >
                    ←
                  </button>
                  {selectedFablab && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2.5 rounded-full px-3 py-1.5 overflow-hidden"
                      style={{
                        background: "rgba(59,130,246,0.1)",
                        border: "1px solid rgba(59,130,246,0.25)",
                      }}
                    >
                      <div className="w-5 h-5 rounded-full overflow-hidden shrink-0">
                        <Image src={selectedFablab.image} alt={selectedFablab.nom}
                          width={20} height={20} className="object-cover w-full h-full" unoptimized />
                      </div>
                      <span className="text-[11px] font-bold truncate max-w-50"
                        style={{ color: t.badgeText }}>
                        {selectedFablab.nom}
                      </span>
                    </motion.div>
                  )}
                </div>

                <p className="text-[10px] font-bold uppercase tracking-[0.35em] mb-4"
                  style={{ color: t.textMuted }}>
                  Connexion
                </p>

                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.02, duration: 0.35 }}
                  tabIndex={0}
                  className="relative mb-6 cursor-default overflow-hidden rounded-xl border outline-none transition-[box-shadow,border-color] duration-200 focus-visible:ring-2 focus-visible:ring-blue-500/50"
                  style={{
                    background: t.cardItemBg,
                    borderColor: t.cardItemBorder,
                    boxShadow: demoCredsRevealed
                      ? isDark
                        ? "0 0 0 1px rgba(59,130,246,0.25) inset"
                        : "0 0 0 1px rgba(59,130,246,0.2) inset"
                      : "none",
                  }}
                  onPointerEnter={() => setDemoCredsRevealed(true)}
                  onPointerLeave={() => setDemoCredsRevealed(false)}
                  onFocus={() => setDemoCredsRevealed(true)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDemoCredsRevealed(false);
                    }
                  }}
                >
                  <div className="flex items-center gap-4 px-4 py-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
                      style={{
                        background: t.inputBg,
                        borderColor: demoCredsRevealed
                          ? "rgba(59,130,246,0.28)"
                          : t.inputBorder,
                        boxShadow: demoCredsRevealed
                          ? "0 0 0 1px rgba(59,130,246,0.12)"
                          : "none",
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: t.textSubtle }}>
                        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                      </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-wider mb-1.5" style={{ color: t.textSubtle }}>
                        Accès Démo (Hors ITIS)
                      </p>
                      <div className="relative min-h-[1.5rem]">
                        <p
                          className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 truncate text-left text-[13px] font-medium cursor-default select-none"
                          style={{
                            color: t.text,
                            zIndex: demoCredsRevealed ? 0 : 2,
                            opacity: demoCredsRevealed ? 0 : 1,
                            transition: "opacity 0.2s ease",
                          }}
                          aria-hidden={demoCredsRevealed}
                        >
                          admin@oxalys.fr
                        </p>
                        <p
                          className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2 text-left text-[13px] font-medium cursor-default select-none"
                          style={{
                            color: t.text,
                            zIndex: demoCredsRevealed ? 2 : 0,
                            opacity: demoCredsRevealed ? 1 : 0,
                            transition: "opacity 0.2s ease",
                          }}
                          aria-hidden={!demoCredsRevealed}
                        >
                          Mot de passe&nbsp;:&nbsp;
                          <span className="font-mono" style={{ color: isDark ? "#60a5fa" : "#2563eb" }}>1234</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    className="absolute bottom-0 left-0 h-[2px] bg-blue-500/40 transition-all duration-300"
                    style={{ width: demoCredsRevealed ? "100%" : "0%" }}
                  />
                </motion.div>

                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                  {/* Email */}
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }} className="group">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.3em] mb-2 transition-colors group-focus-within:text-blue-500"
                      style={{ color: t.textSubtle }}>
                      Adresse e-mail
                    </label>
                    <input
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      required autoComplete="email" placeholder="vous@fablab.fr"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200"
                      style={{
                        background: t.inputBg,
                        border: `1px solid ${t.inputBorder}`,
                        color: t.text,
                        caretColor: "#3b82f6",
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = t.inputFocus}
                      onBlur={(e) => e.currentTarget.style.borderColor = t.inputBorder}
                    />
                  </motion.div>

                  {/* Password */}
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }} className="group">
                    <label className="block text-[9px] font-bold uppercase tracking-[0.3em] mb-2 transition-colors group-focus-within:text-blue-500"
                      style={{ color: t.textSubtle }}>
                      Mot de passe
                    </label>
                    <input
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      required autoComplete="current-password" placeholder="••••••••"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200"
                      style={{
                        background: t.inputBg,
                        border: `1px solid ${t.inputBorder}`,
                        color: t.text,
                        caretColor: "#3b82f6",
                      }}
                      onFocus={(e) => e.currentTarget.style.borderColor = t.inputFocus}
                      onBlur={(e) => e.currentTarget.style.borderColor = t.inputBorder}
                    />
                  </motion.div>

                  {/* Error */}
                  <AnimatePresence>
                    {error && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, height: 0 }}
                        animate={{ opacity: 1, y: 0, height: "auto" }}
                        exit={{ opacity: 0, y: -4, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="rounded-xl p-3 text-[10px] font-mono leading-relaxed"
                          style={{
                            background: "rgba(239,68,68,0.07)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            color: "#ef4444",
                          }}>
                          ⚠ {error}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Submit */}
                  <motion.button
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    type="submit" disabled={loading}
                    className="relative mt-2 py-3.5 rounded-xl text-[11px] font-black uppercase tracking-[0.25em] text-white overflow-hidden disabled:opacity-60 group"
                    style={{
                      background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                      boxShadow: isDark
                        ? "0 8px 32px rgba(59,130,246,0.35)"
                        : "0 4px 20px rgba(59,130,246,0.25)",
                    }}
                  >
                    <span className="relative z-10 flex items-center justify-center gap-2">
                      {loading ? (
                        <><span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" /></>
                      ) : (
                        "Accéder au Dashboard →"
                      )}
                    </span>
                    <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                  </motion.button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Footer */}
          <div
            className="mt-8 pt-5 flex items-center justify-between"
            style={{ borderTop: `1px solid ${t.footerBorder}` }}
          >
            <span className="text-[8px] font-mono uppercase tracking-widest"
              style={{ color: t.textSubtle }}>
              Sécurité · Élevée
            </span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[8px] font-mono uppercase tracking-widest"
                style={{ color: t.textSubtle }}>
                Système opérationnel
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
