import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

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
        const res = await fetch(
          `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${token}`,
          { headers: { apikey: anonKey } }
        );
        const data = await res.json();
        if (res.ok && data.valid) {
          setStatus("valid");
        } else if (data.reason === "already_unsubscribed") {
          setStatus("already");
        } else {
          setStatus("invalid");
        }
      } catch {
        setStatus("error");
      }
    };
    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) {
        setStatus("success");
      } else if (data?.reason === "already_unsubscribed") {
        setStatus("already");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full bg-card rounded-xl shadow-lg p-8 text-center">
        {status === "loading" && (
          <p className="text-muted-foreground">Verifying your request...</p>
        )}
        {status === "valid" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Unsubscribe</h1>
            <p className="text-muted-foreground mb-6">
              Are you sure you want to unsubscribe from vacancy alert emails?
            </p>
            <button
              onClick={handleUnsubscribe}
              className="bg-primary text-primary-foreground px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
            >
              Confirm Unsubscribe
            </button>
          </>
        )}
        {status === "success" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Unsubscribed</h1>
            <p className="text-muted-foreground">You've been successfully unsubscribed from vacancy alert emails.</p>
          </>
        )}
        {status === "already" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Already Unsubscribed</h1>
            <p className="text-muted-foreground">You've already unsubscribed from these emails.</p>
          </>
        )}
        {status === "invalid" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Invalid Link</h1>
            <p className="text-muted-foreground">This unsubscribe link is invalid or has expired.</p>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="text-2xl font-bold text-foreground mb-4">Something went wrong</h1>
            <p className="text-muted-foreground">Please try again later or contact support.</p>
          </>
        )}
      </div>
    </div>
  );
};

export default Unsubscribe;
