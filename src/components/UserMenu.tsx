import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

/** Who is signed in, and a sign-out button. Shown in the page header. */
export function UserMenu() {
  const { profile, user, signOut } = useAuth();
  const { toast } = useToast();
  const { resolvedTheme, setTheme } = useTheme();
  if (!user) return null;
  const name = profile?.display_name || user.email;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-muted-foreground sm:inline" title={user.email ?? undefined}>
        {name}
        {profile?.role && profile.role !== "consultant" ? ` (${profile.role})` : ""}
      </span>
      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        {resolvedTheme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-2"
        onClick={async () => {
          await signOut();
          toast({ title: "Signed out" });
        }}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );
}
