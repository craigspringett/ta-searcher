import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ALLOWED_DOMAINS_TEXT, useAuth } from "@/lib/auth";
import { APP_NAME, FIRM_NAME } from "@/lib/brand";
import { Button } from "@/components/ui/button";

/** Route guard: a signed-in user with a profile sees the page; anyone else goes to /login. */
export function RequireAuth() {
  const { session, profile, loading, signOut, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Checking your sign-in…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-xl font-semibold text-foreground">This address is not set up for {APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            You are signed in as {user?.email}, but {APP_NAME} is for {FIRM_NAME} staff using a {ALLOWED_DOMAINS_TEXT} address.
            Sign out and try again with your work email, or ask Craig.
          </p>
          <Button variant="outline" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
