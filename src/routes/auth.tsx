import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Briefcase,
  FileCheck,
  Landmark as BankIcon,
  Mail,
  Lock,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LuminousMesh } from "@/components/app/LuminousMesh";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Practice management and billing for Chartered Accountants — AJ's Chartered Desk.",
      },
      { property: "og:title", content: "Sign in — AJ's Chartered Desk" },
      {
        property: "og:description",
        content: "Practice management and billing for Chartered Accountants.",
      },
    ],
  }),
  component: AuthPage,
});

const pillars = [
  {
    icon: Briefcase,
    title: "Client Retainers",
    desc: "Recurring compliance jobs generated automatically per cycle with zero duplicates.",
  },
  {
    icon: FileCheck,
    title: "Payment Clearing",
    desc: "Unallocated advance receipts pooled and settled FIFO against outstanding invoices.",
  },
  {
    icon: BankIcon,
    title: "Bank Reconciliation",
    desc: "Seamless statement import with automated reference and tolerance matching.",
  },
];

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const { data: sa } = await supabase.rpc("is_super_admin");
      navigate({ to: sa ? "/admin" : "/dashboard" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#080d16] text-slate-100 lg:grid lg:grid-cols-[1.4fr_1fr]">
      {/* ─── LEFT 60% HERO SECTION ─── */}
      <div className="relative flex flex-col justify-between overflow-hidden border-b border-slate-800/80 px-8 py-10 lg:border-b-0 lg:border-r lg:px-14 lg:py-12">
        {/* Organic 3D Luminous Wave Mesh */}
        <div className="absolute inset-0 z-0 opacity-75">
          <LuminousMesh />
        </div>

        {/* Ambient atmospheric gradients */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-blue-600/15 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-24 right-12 h-96 w-96 rounded-full bg-indigo-600/15 blur-[140px]" />

        {/* Brand Header with Uploaded Logo */}
        <div className="relative z-10 flex items-center gap-3.5">
          <img src="/logo.png" alt="AJ's Chartered Desk" className="h-11 w-auto object-contain" />
          <div>
            <div className="text-xl font-bold tracking-tight text-white">AJ's Chartered Desk</div>
            <div className="text-xs font-medium tracking-wide text-slate-400">by Aryan Jayanth</div>
          </div>
        </div>

        {/* Hero Headline & Value Proposition */}
        <div className="relative z-10 my-auto py-12">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
            Every client. Every invoice.
            <br />
            <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-sky-300 bg-clip-text text-transparent">
              One unified practice.
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300/85">
            A comprehensive practice management and billing solution designed specifically for
            Chartered Accountants — managing retainers, compliance schedules, and receivables with
            total audit clarity.
          </p>

          {/* Elegant 3-Pillar Grid */}
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {pillars.map((item) => (
              <div
                key={item.title}
                className="group rounded-xl border border-slate-800/80 bg-slate-900/50 p-4.5 backdrop-blur-md transition-all duration-200 hover:border-slate-700 hover:bg-slate-900/70"
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 transition-colors group-hover:bg-blue-500/20">
                  <item.icon className="h-4 w-4" />
                </div>
                <div className="text-sm font-semibold text-white">{item.title}</div>
                <div className="mt-1.5 text-xs leading-relaxed text-slate-400">{item.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Minimal Footer */}
        <div className="relative z-10 pt-4 text-xs text-slate-400">
          © {new Date().getFullYear()} Aryan Jayanth. All rights reserved.
        </div>
      </div>

      {/* ─── RIGHT 40% LOGIN SECTION ─── */}
      <div className="relative flex flex-col items-center justify-center bg-[#060a12] px-6 py-12 lg:px-12">
        {/* Subtle background glow */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/10 blur-[100px]" />

        <div className="relative z-10 w-full max-w-[400px]">
          {/* Glowing Border Wrapper */}
          <div className="rounded-2xl bg-gradient-to-b from-blue-500/30 via-slate-800/80 to-slate-900/60 p-[1px] shadow-[0_12px_45px_rgba(0,0,0,0.65)]">
            <div className="rounded-[15px] bg-[#0b121e]/90 p-8 backdrop-blur-xl">
              {/* Header with Centered Logo & Title */}
              <div className="mb-7 flex flex-col items-center text-center">
                <img
                  src="/logo.png"
                  alt="AJ's Chartered Desk Logo"
                  className="mb-3.5 h-16 w-auto object-contain"
                />
                <h2 className="text-2xl font-bold tracking-tight text-white">Welcome back</h2>
                <p className="mt-1.5 text-xs text-slate-400">
                  Enter your credentials to access your firm workspace.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-4">
                {/* Email Address with Left Mail Icon */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="email"
                      required
                      placeholder="name@firm.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="h-10 border-slate-800 bg-slate-950/70 pl-10 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Password with Left Lock Icon and Right Eye Toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type={showPw ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-10 border-slate-800 bg-slate-950/70 pl-10 pr-10 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPw((p) => !p)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-200"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Middle Utility Row: Remember Me & Forgot Password */}
                <div className="flex items-center justify-between pt-1 text-xs">
                  <label className="flex cursor-pointer select-none items-center gap-2 text-slate-400 hover:text-slate-300">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-blue-600 focus:ring-0 focus:ring-offset-0"
                    />
                    <span>Remember session</span>
                  </label>
                  <a
                    href="/set-password"
                    className="text-blue-400 transition-colors hover:text-blue-300 hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>

                {/* Submit Button */}
                <Button
                  className="mt-2 h-11 w-full bg-blue-600 font-medium text-white shadow-lg shadow-blue-600/30 transition-all hover:bg-blue-500"
                  disabled={busy}
                >
                  {busy ? (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Signing in…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2 text-sm font-semibold">
                      Sign in <ArrowRight className="h-4 w-4" />
                    </span>
                  )}
                </Button>
              </form>

              <div className="mt-5 border-t border-slate-800/80 pt-4 text-center text-xs text-slate-400">
                Received an invite OTP or link?{" "}
                <a
                  href="/set-password"
                  className="font-medium text-blue-400 transition-colors hover:text-blue-300 hover:underline"
                >
                  Activate account
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
