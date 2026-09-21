import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { APP_NAME } from "@/lib/brand";

/** The unsubscribe landing page from an alert email: checks the token, changes nothing until the button is pressed. */
const Unsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "valid" | "already" | "invalid" | "success" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    const validate = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(`${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`, { headers: { apikey: anonKey } });
        const data = await res.json();
        if (res.ok && data.valid) setStatus("valid");
        else if (data.reason === "already_unsubscribed") setStatus("already");
        else setStatus("invalid");
      } catch {
        setStatus("error");
      }
    };
    void validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", { body: { token } });
      if (error) throw error;
      if (data?.success) setStatus("success");
      else if (data?.reason === "already_unsubscribed") setStatus("already");
      else setStatus("error");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-xl shadow-lg p-8 text-center">
        {status === "loading" && <p className="text-muted-foreground">Checking your link…</p>}
        {status === "valid" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Unsubscribe</h1>
            <p className="text-muted-foreground mb-6">Stop the {APP_NAME} alert emails to this address? You can be added again from the Alerts page.</p>
            <button onClick={() => void handleUnsubscribe()} className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition">
              Confirm unsubscribe
            </button>
          </>
        )}
        {status === "success" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Unsubscribed</h1>
            <p className="text-muted-foreground">This address will not receive {APP_NAME} alert emails again.</p>
          </>
        )}
        {status === "already" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Already unsubscribed</h1>
            <p className="text-muted-foreground">This address is already off the list.</p>
          </>
        )}
        {status === "invalid" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Link not recognised</h1>
            <p className="text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Something went wrong</h1>
            <p className="text-muted-foreground">Try again later, or tell Craig.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
