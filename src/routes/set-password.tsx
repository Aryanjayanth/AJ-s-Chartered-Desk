import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Lock,
  Mail,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/app/common";
import { verifyOtpAndSetPassword } from "@/lib/firms.functions";
import { errMsg } from "@/lib/format";

export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [
      { title: "Activate Account & Set Password — AJ's Chartered Desk" },
      {
        name: "description",
        content: "Activate your AJ's Chartered Desk account using your direct link or OTP code.",
      },
      { property: "og:title", content: "Activate Account & Set Password — AJ's Chartered Desk" },
      { property: "og:description", content: "Activate your AJ's Chartered Desk account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetPassword,
});

function SetPassword() {
  const navigate = useNavigate();
  const runVerifyOtp = useServerFn(verifyOtpAndSetPassword);

  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Read prefilled email and OTP from direct activation link URL
    try {
      const params = new URLSearchParams(window.location.search);
      const qEmail = params.get("email");
      const qOtp = params.get("otp");
      if (qEmail) setEmail(qEmail.trim());
      if (qOtp) setOtp(qOtp.trim());
    } catch {
      // ignore
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
        if (data.session.user?.email) {
          setEmail(data.session.user.email);
        }
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) {
        setReady(true);
        if (s.user?.email) setEmail(s.user.email);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Save password when user is already authenticated via direct link / active session
  const saveAuthenticated = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Password set successfully — Welcome to AJ's Chartered Desk!");
      const { data: sa } = await supabase.rpc("is_super_admin");
      navigate({ to: sa ? "/admin" : "/dashboard", replace: true });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  // Verify OTP and set password when user enters OTP code
  const submitWithOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error("Please enter your email address");
    if (!otp.trim()) return toast.error("Please enter the 6-digit OTP code");
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== pw2) return toast.error("Passwords do not match");

    setBusy(true);
    try {
      // 1. Verify OTP and assign firm/password server-side
      await runVerifyOtp({
        data: {
          email: email.trim().toLowerCase(),
          otp: otp.trim(),
          password: pw,
        },
      });

      // 2. Sign in immediately
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pw,
      });

      if (signErr) {
        toast.success("Account activated! Please sign in with your new password.");
        navigate({ to: "/auth", replace: true });
        return;
      }

      toast.success("Account activated & logged in successfully!");
      const { data: sa } = await supabase.rpc("is_super_admin");
      navigate({ to: sa ? "/admin" : "/dashboard", replace: true });
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070c14] p-4 sm:p-6 text-slate-100">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full bg-blue-600/10 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-20 right-10 h-80 w-80 rounded-full bg-indigo-600/10 blur-[100px]" />

      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <img
            src="/logo.png"
            alt="AJ's Chartered Desk"
            className="mx-auto mb-2 h-12 w-auto object-contain"
          />
          <h2 className="text-xl font-bold tracking-tight text-white">AJ's Chartered Desk</h2>
          <p className="text-xs text-slate-400">Account Setup & Security</p>
        </div>

        <Card className="border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur-xl">
          <CardContent className="p-6 sm:p-8">
            {ready ? (
              /* FLOW 1: Direct Link Activated Session */
              <div>
                <div className="mb-5 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-emerald-400">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <div className="text-xs">
                    <span className="font-semibold">Direct Link Verified</span>
                    <div className="text-slate-400">{email}</div>
                  </div>
                </div>

                <h1 className="text-lg font-semibold text-white">Set your account password</h1>
                <p className="mb-5 text-xs text-slate-400">
                  Choose a secure password to complete your account setup.
                </p>

                <form onSubmit={saveAuthenticated} className="space-y-4">
                  <Field label="New Password (min 8 chars)">
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type={showPw ? "text" : "password"}
                        required
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9 pr-9 bg-slate-950/70 border-slate-800 text-white"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPw((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Confirm Password">
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type={showPw ? "text" : "password"}
                        required
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9 bg-slate-950/70 border-slate-800 text-white"
                      />
                    </div>
                  </Field>

                  <Button
                    className="w-full h-10 bg-blue-600 hover:bg-blue-500 font-medium"
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Save Password & Sign In"}
                  </Button>
                </form>
              </div>
            ) : (
              /* FLOW 2: Enter Email + 6-Digit OTP */
              <div>
                <div className="mb-4 flex items-center gap-2 text-blue-400">
                  <ShieldCheck className="h-5 w-5" />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    Account Activation
                  </span>
                </div>

                <h1 className="text-lg font-semibold text-white">Activate with OTP</h1>
                <p className="mb-5 text-xs text-slate-400 leading-relaxed">
                  Enter your email address and the 6-digit OTP code provided by your administrator.
                </p>

                <form onSubmit={submitWithOtp} className="space-y-3.5">
                  <Field label="Email Address">
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="email"
                        required
                        placeholder="rahul@firm.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="pl-9 bg-slate-950/70 border-slate-800 text-white"
                      />
                    </div>
                  </Field>

                  <Field label="6-Digit OTP Code">
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="text"
                        required
                        maxLength={10}
                        placeholder="123456"
                        value={otp}
                        onChange={(e) => setOtp(e.target.value.replace(/\s+/g, ""))}
                        className="pl-9 font-mono text-base tracking-widest bg-slate-950/70 border-slate-800 text-white placeholder:tracking-normal placeholder:text-sm"
                      />
                    </div>
                  </Field>

                  <Field label="Create Password (min 8 chars)">
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type={showPw ? "text" : "password"}
                        required
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9 pr-9 bg-slate-950/70 border-slate-800 text-white"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowPw((p) => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                      >
                        {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Confirm Password">
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type={showPw ? "text" : "password"}
                        required
                        value={pw2}
                        onChange={(e) => setPw2(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9 bg-slate-950/70 border-slate-800 text-white"
                      />
                    </div>
                  </Field>

                  <Button
                    className="w-full mt-2 h-10 bg-blue-600 hover:bg-blue-500 font-medium"
                    disabled={busy}
                  >
                    {busy ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        Activating…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5">
                        Verify OTP & Activate Account <ArrowRight className="h-4 w-4" />
                      </span>
                    )}
                  </Button>
                </form>
              </div>
            )}

            <div className="mt-6 border-t border-slate-800 pt-4 text-center text-xs text-slate-400">
              Already have an active account?{" "}
              <Link to="/auth" className="text-blue-400 hover:underline">
                Sign in here
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
