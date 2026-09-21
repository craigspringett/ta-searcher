import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;

/** Work domains allowed to sign in; enforced server-side too (Auth hook and profiles constraint). */
export const ALLOWED_DOMAINS = ["bigfishrecruitment.co.uk", "whofoundwho.co.uk"] as const;

/** "bigfishrecruitment.co.uk or whofoundwho.co.uk", for the sign-in messages. */
export const ALLOWED_DOMAINS_TEXT = ALLOWED_DOMAINS.join(" or ");

export function isAllowedEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return (ALLOWED_DOMAINS as readonly string[]).includes(domain);
}

interface AuthState {
  /** undefined while the stored session is being read. */
  session: Session | null | undefined;
  user: User | null;
  /** null when the user has no profile (address outside the allowed domains). */
  profile: Profile | null | undefined;
  loading: boolean;
  isManager: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const loadProfile = async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      console.error("profile load failed", error.message);
      setProfile(null);
      return;
    }
    setProfile(data ?? null);
  };

  useEffect(() => {
    if (session === undefined) return;
    setProfile(undefined);
    void loadProfile(session?.user.id);
  }, [session?.user.id, session === undefined]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading: session === undefined || (session !== null && profile === undefined),
      isManager: profile?.role === "manager" || profile?.role === "admin",
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refreshProfile: () => loadProfile(session?.user.id),
    }),
    [session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
