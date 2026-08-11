import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Null when the app is built without Supabase credentials.
 *
 * createClient throws on a missing URL, and because this module is imported at
 * the top of the component tree that throw happened before anything rendered —
 * one absent environment variable produced a blank white page across the whole
 * site, including the pages that never touch Supabase.
 *
 * Failing here instead lets everything else render, and leaves the failure where
 * it belongs: at the call site that actually needs data.
 */
export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

if (!supabase) {
  console.warn(
    '[firewatch] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set — reports and incident data will be unavailable.',
  );
}
