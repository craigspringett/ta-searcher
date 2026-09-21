import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { ALLOWED_DOMAINS, ALLOWED_DOMAINS_TEXT, isAllowedEmail, useAuth } from "@/lib/auth";
import { APP_NAME, FIRM_NAME } from "@/lib/brand";

const CODE_LENGTH = 6;

/**
 * Sign in with a work email address: we send a code (and a link) by email,
 * the consultant types the code. No passwords. The domain rule is enforced
 * by Auth itself; the client check only saves a round trip.
 */
export default function Login() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A magic link lands here with the session already in the URL hash / code;
  // supabase-js picks it up and the guard sends the user on.
  useEffect(() => {
    if (session) navigate(from, { replace: true });
  }, [session, from, navigate]);

  if (!loading && session) return <Navigate to={from} replace />;

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const addr = email.trim().toLowerCase();
    if (!isAllowedEmail(addr)) {
      setError(`Use your ${ALLOWED_DOMAINS_TEXT} address.`);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/login` },
    });
    setBusy(false);
    if (err) {
      setError(friendlyError(err.message));
      return;
    }
    setNotice(`We have emailed a ${CODE_LENGTH}-digit code to ${addr}. It arrives from ${FIRM_NAME} and lasts an hour.`);
    setStep("code");
  };

  const verify = async (value: string) => {
    if (value.length !== CODE_LENGTH || busy) return;
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: value, type: "email" });
    setBusy(false);
    if (err) {
      setError(friendlyError(err.message));
      setCode("");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 items-center rounded-lg bg-primary px-3 text-base font-bold tracking-tight text-primary-foreground" aria-hidden="true">{APP_NAME}</span>
          <div>
            <h1 className="text-xl font-bold text-foreground">{APP_NAME}</h1>
            <p className="text-xs text-muted-foreground">Start-up hiring intelligence for {FIRM_NAME} consultants</p>
          </div>
        </div>

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder={`you@${ALLOWED_DOMAINS[0]}`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">No password. We email you a code each time you sign in; you stay signed in on this device for 30 days.</p>
            </div>
            {error && <p id="login-error" role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
              Email me a code
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-foreground" role="status">{notice}</p>
            <div className="space-y-2">
              <Label htmlFor="code">Sign-in code</Label>
              <InputOTP
                id="code"
                maxLength={CODE_LENGTH}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  void verify(v);
                }}
                disabled={busy}
                autoFocus
                inputMode="numeric"
              >
                <InputOTPGroup>
                  {Array.from({ length: CODE_LENGTH }, (_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            {busy && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking the code…
              </p>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-primary underline" onClick={() => { setStep("email"); setCode(""); setError(null); }}>
                Use a different address
              </button>
              <button type="button" className="text-primary underline" onClick={(e) => void sendCode(e)} disabled={busy}>
                Send a new code
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("whofoundwho") || m.includes("bigfish")) return message;
  if (m.includes("rate limit") || m.includes("security purposes") || m.includes("after")) return "Too many requests. Wait a minute and try again.";
  if (m.includes("expired") || m.includes("invalid")) return "That code is wrong or has expired. Send a new one.";
  if (m.includes("signups not allowed") || m.includes("not allowed")) return `That address is not allowed. Use your ${ALLOWED_DOMAINS_TEXT} email.`;
  return message;
}
