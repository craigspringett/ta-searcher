import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Activity, Bell, Home, Radar, Search, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { UserMenu } from "@/components/UserMenu";

/**
 * The page header every signed-in page shares: the app name, the page title,
 * a line under it, and the navigation with the manager pages shown to
 * managers only. The current page is marked for assistive technology.
 */
export function AppHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { isManager } = useAuth();
  const link = "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground aria-[current=page]:border-primary";
  const items: Array<{ to: string; label: string; icon: typeof Home; managers?: boolean; end?: boolean }> = [
    { to: "/", label: "My patch", icon: Home, end: true },
    { to: "/companies", label: "Companies", icon: Search },
    { to: "/prospects", label: "Prospects", icon: Radar },
    { to: "/alerts", label: "Alerts", icon: Bell, managers: true },
    { to: "/consultants", label: "Consultants", icon: Users, managers: true },
    { to: "/pipeline-monitoring", label: "Monitoring", icon: Activity, managers: true },
  ];
  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 items-center rounded-lg bg-primary px-2.5 text-sm font-bold tracking-tight text-primary-foreground" aria-hidden="true">{APP_NAME}</span>
          <div>
            <h1 className="text-xl font-bold text-foreground">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-1.5" aria-label="Pages">
          {items.filter((i) => !i.managers || isManager).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} className={link}>
              <i.icon className="h-3.5 w-3.5" aria-hidden="true" />
              {i.label}
            </NavLink>
          ))}
          {actions}
          <UserMenu />
        </nav>
      </div>
    </header>
  );
}
