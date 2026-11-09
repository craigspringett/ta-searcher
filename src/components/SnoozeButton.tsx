import { useState } from "react";
import { BellOff, Loader2 } from "lucide-react";
import { londonToday, snoozeChoices } from "@/lib/followUps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Snooze (9 November 2026): move one follow-up step to a later day. Every
 * step after it moves by the same gaps, so the run keeps its shape. `onSnooze`
 * gets the London date (YYYY-MM-DD) and resolves true when it worked.
 */
export function SnoozeButton({ busy, working, onSnooze, label = "Snooze" }: { busy: boolean; working: boolean; onSnooze: (until: string) => Promise<boolean>; label?: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const today = londonToday();
  const go = async (until: string) => {
    if (await onSnooze(until)) { setOpen(false); setDate(""); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={busy} title="Move this step to a later day, and the steps after it by the same amount">
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <BellOff className="h-3.5 w-3.5" aria-hidden="true" />}{label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3" align="end">
        <p className="text-xs text-muted-foreground">Move this step to another day. The steps after it move by the same amount.</p>
        <div className="flex flex-wrap gap-1.5">
          {snoozeChoices(today).map((c) => (
            <Button key={c.label} type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void go(c.date)}>{c.label}</Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="h-8 text-xs" aria-label="Move to this day" />
          <Button type="button" size="sm" className="h-8 text-xs" disabled={busy || !date} onClick={() => void go(date)}>Move</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
