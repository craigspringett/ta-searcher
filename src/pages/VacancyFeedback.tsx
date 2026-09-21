import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Landing page for the "Wrong company" / "Closed" links in alert emails.
// Shows what the link will do and only changes anything when the button is
// pressed: the email links must be safe for mail scanners to pre-fetch.

type Summary = { vacancy: string; company: string | null; actionLabel: string; describe: string };
type Status = "loading" | "confirm" | "saving" | "done" | "already" | "undone" | "invalid" | "gone" | "error";

const functionUrl = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/handle-vacancy-feedback`;
const headers = () => ({ Accept: "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string });

const VacancyFeedback = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<Status>("loading");
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    const load = async () => {
      try {
        const res = await fetch(`${functionUrl()}?token=${encodeURIComponent(token)}`, { headers: headers() });
        const data = await res.json();
        if (res.ok && data.ok) {
          setSummary(data);
          setStatus(data.state === "already" ? "already" : "confirm");
        } else if (data.reason === "not_found") {
          setStatus("gone");
        } else if (data.reason === "invalid_token") {
          setStatus("invalid");
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    };
    load();
  }, [token]);

  const post = async (undo: boolean) => {
    setStatus("saving");
    try {
      const res = await fetch(functionUrl(), {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ token, undo }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSummary(data);
        setStatus(undo ? "undone" : "done");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };
  const confirm = () => post(false);
  const undo = () => post(true);
  const undoButton = (
    <button onClick={undo} className="mt-6 text-sm text-muted-foreground underline hover:text-foreground">
      Undo: put it back
    </button>
  );

  const where = summary?.company ? ` at ${summary.company}` : "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-xl shadow-lg p-8 text-center">
        {status === "loading" && <p className="text-muted-foreground">Checking your link...</p>}
        {status === "confirm" && summary && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">{summary.actionLabel}</h1>
            <p className="text-foreground mb-2">
              &ldquo;{summary.vacancy}&rdquo;{where}
            </p>
            <p className="text-muted-foreground mb-6">
              This will mark the vacancy {summary.describe} and remove it from your alerts. Press the button to confirm.
            </p>
            <button
              onClick={confirm}
              className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
            >
              Confirm: {summary.actionLabel}
            </button>
            <p className="text-muted-foreground text-sm mt-6">If you opened this by mistake, just close the page. Nothing has been changed.</p>
          </>
        )}
        {status === "saving" && <p className="text-muted-foreground">Saving...</p>}
        {status === "done" && summary && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Thank you</h1>
            <p className="text-muted-foreground">
              &ldquo;{summary.vacancy}&rdquo;{where} has been marked {summary.describe}. It will not appear in your alerts again.
            </p>
            {undoButton}
          </>
        )}
        {status === "already" && summary && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Already recorded</h1>
            <p className="text-muted-foreground">
              &ldquo;{summary.vacancy}&rdquo;{where} has already been marked {summary.describe}. It will not appear in your alerts again.
            </p>
            {undoButton}
          </>
        )}
        {status === "undone" && summary && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Put back</h1>
            <p className="text-muted-foreground">
              &ldquo;{summary.vacancy}&rdquo;{where} is open again and will appear in your alerts as before.
            </p>
          </>
        )}
        {status === "gone" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Vacancy not found</h1>
            <p className="text-muted-foreground">This vacancy is no longer in the system, so there is nothing to change.</p>
          </>
        )}
        {status === "invalid" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Link not recognised</h1>
            <p className="text-muted-foreground">This feedback link is invalid or has been altered. Please use the link from your alert email.</p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Something went wrong</h1>
            <p className="text-muted-foreground">Please try again later or tell Craig.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default VacancyFeedback;
