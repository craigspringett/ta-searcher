import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

// The three VITE_ variables come from .env locally and the Netlify site in
// production (.env.example lists them). The anon key has no table
// privileges: every read goes through row security for a signed-in user.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
