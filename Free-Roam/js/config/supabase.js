// Public project URL and publishable key mirror main.js. Keeping this adapter inside
// Free-Roam lets the game be removed without changing FantaScuola's auth bootstrap.
export const SUPABASE_URL = 'https://peiztoqldcnughvjksfa.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_hG8-xHmF5Bl-018C2mxoAg_QXV5e4ya';

export function createGameClient() {
  if (!globalThis.supabase?.createClient || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true } });
}

export async function getGameIdentity(client) {
  if (!client) return null;
  const { data: { session }, error } = await client.auth.getSession();
  if (error || !session?.user) return null;
  const user = session.user;
  let profile = null;
  try {
    const result = await client.from('account_profiles').select('display_name,studente_id,is_premium').eq('user_id', user.id).maybeSingle();
    profile = result.data;
  } catch (error) { console.warn('[Free Roam] Profilo non disponibile:', error); }
  return {
    userId: user.id,
    displayName: String(profile?.display_name || user.user_metadata?.display_name || user.user_metadata?.username || user.email?.split('@')[0] || 'Giocatore').slice(0, 32),
    studentId: profile?.studente_id || null,
    isManager: profile?.is_premium === true,
    avatarId: 'default',
  };
}
