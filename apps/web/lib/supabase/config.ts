/** Auth and organisation features switch on only when both public Supabase values are set. The anon key is public by design; row-level security protects the data. */
export function supabaseEnv(): { url: string; anon: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return url && anon ? { url, anon } : null;
}
export const supabaseConfigured = (): boolean => supabaseEnv() !== null;
