import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const USERNAME_AUTH_DOMAIN = 'users.fantascuola.invalid'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function normalizeUsername(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40)
}

function usernameEmail(username: string) {
  return `${normalizeUsername(username)}@${USERNAME_AUTH_DOMAIN}`
}

function isTrue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true' || value === 'TRUE'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito.' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const authorization = req.headers.get('Authorization') || ''

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Variabili Supabase mancanti nella Edge Function.' }, 500)
    }
    if (!authorization.startsWith('Bearer ')) {
      return json({ error: 'Sessione mancante.' }, 401)
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: callerData, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !callerData.user) return json({ error: 'Sessione non valida.' }, 401)

    const caller = callerData.user
    const { data: callerProfile, error: profileError } = await admin
      .from('account_profiles')
      .select('user_id, display_name, is_premium')
      .eq('user_id', caller.id)
      .maybeSingle()

    if (profileError) throw profileError
    if (!callerProfile || !isTrue(callerProfile.is_premium)) {
      return json({ error: 'Servizio riservato ai manager Plus.' }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const action = String(body?.action || '')

    async function writeAudit(details: string) {
      try {
        await admin.from('audit_logs').insert({
          actor_email: caller.email || callerProfile.display_name || caller.id,
          action: 'account_admin',
          entity: 'auth.users',
          details,
          points_delta: null,
          studente_id: null,
        })
      } catch (_) {
        // L'audit non deve bloccare il servizio clienti.
      }
    }

    if (action === 'list') {
      const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (usersError) throw usersError

      const { data: profiles, error: profilesError } = await admin
        .from('account_profiles')
        .select('user_id, studente_id, display_name, is_premium')
      if (profilesError) throw profilesError

      const { data: students, error: studentsError } = await admin
        .from('studenti')
        .select('id, nome')
      if (studentsError) throw studentsError

      const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]))
      const studentMap = new Map((students || []).map((s) => [String(s.id), s.nome]))

      const users = (usersData.users || []).map((u) => {
        const profile = profileMap.get(u.id)
        const metadata = u.user_metadata || {}
        const loginType = metadata.login_type === 'username' || String(u.email || '').endsWith(`@${USERNAME_AUTH_DOMAIN}`)
          ? 'username'
          : 'email'
        const username = loginType === 'username'
          ? normalizeUsername(metadata.username || String(u.email || '').split('@')[0])
          : null

        return {
          id: u.id,
          email: loginType === 'email' ? u.email : null,
          username,
          login_type: loginType,
          display_name: profile?.display_name || metadata.display_name || username || u.email || 'Account',
          is_premium: isTrue(profile?.is_premium),
          studente_id: profile?.studente_id || null,
          student_name: profile?.studente_id ? studentMap.get(String(profile.studente_id)) || null : null,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          email_confirmed_at: u.email_confirmed_at,
          confirmed_at: u.confirmed_at,
        }
      })

      users.sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'it'))
      return json({ users })
    }

    if (action === 'create') {
      const loginType = body.login_type === 'username' ? 'username' : 'email'
      const displayName = String(body.display_name || '').trim()
      const password = String(body.password || '')
      const studenteId = body.studente_id ? String(body.studente_id) : null
      const premium = Boolean(body.is_premium)

      if (!displayName) return json({ error: 'Inserisci il nome visualizzato.' }, 400)
      if (password.length < 6) return json({ error: 'La password deve avere almeno 6 caratteri.' }, 400)

      let email = ''
      let username: string | null = null
      if (loginType === 'username') {
        username = normalizeUsername(body.identity)
        if (username.length < 3) return json({ error: 'Il nome utente deve contenere almeno 3 caratteri validi.' }, 400)
        email = usernameEmail(username)
      } else {
        email = String(body.identity || '').trim().toLowerCase()
        if (!email.includes('@')) return json({ error: 'Email non valida.' }, 400)
      }

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: loginType === 'username' ? true : Boolean(body.email_confirm),
        user_metadata: {
          display_name: displayName,
          login_type: loginType,
          ...(username ? { username } : {}),
        },
      })
      if (createError || !created.user) throw createError || new Error('Creazione utente fallita.')

      const { error: upsertError } = await admin.from('account_profiles').upsert({
        user_id: created.user.id,
        display_name: displayName,
        studente_id: studenteId,
        is_premium: premium,
      }, { onConflict: 'user_id' })

      if (upsertError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined)
        throw upsertError
      }

      await writeAudit(`Creato account ${loginType === 'username' ? `@${username}` : email}`)
      return json({ ok: true, user_id: created.user.id })
    }

    if (action === 'update') {
      const userId = String(body.user_id || '')
      if (!userId) return json({ error: 'ID account mancante.' }, 400)

      const { data: existingData, error: existingError } = await admin.auth.admin.getUserById(userId)
      if (existingError || !existingData.user) throw existingError || new Error('Account non trovato.')
      const existing = existingData.user

      const loginType = body.login_type === 'username' ? 'username' : 'email'
      const displayName = String(body.display_name || '').trim()
      const studenteId = body.studente_id ? String(body.studente_id) : null
      const premium = Boolean(body.is_premium)
      const password = body.password ? String(body.password) : ''

      let email = ''
      let username: string | null = null
      if (loginType === 'username') {
        username = normalizeUsername(body.identity)
        if (username.length < 3) return json({ error: 'Il nome utente deve contenere almeno 3 caratteri validi.' }, 400)
        email = usernameEmail(username)
      } else {
        email = String(body.identity || '').trim().toLowerCase()
        if (!email.includes('@')) return json({ error: 'Email non valida.' }, 400)
      }

      const attributes: Record<string, unknown> = {
        email,
        user_metadata: {
          ...(existing.user_metadata || {}),
          display_name: displayName,
          login_type: loginType,
          username: username || null,
        },
      }
      if (password) {
        if (password.length < 6) return json({ error: 'La nuova password deve avere almeno 6 caratteri.' }, 400)
        attributes.password = password
      }
      if (loginType === 'username' || Boolean(body.email_confirm)) attributes.email_confirm = true

      const { error: updateAuthError } = await admin.auth.admin.updateUserById(userId, attributes)
      if (updateAuthError) throw updateAuthError

      const { error: updateProfileError } = await admin.from('account_profiles').upsert({
        user_id: userId,
        display_name: displayName,
        studente_id: studenteId,
        is_premium: premium,
      }, { onConflict: 'user_id' })
      if (updateProfileError) throw updateProfileError

      await writeAudit(`Aggiornato account ${loginType === 'username' ? `@${username}` : email}`)
      return json({ ok: true })
    }

    if (action === 'confirm') {
      const userId = String(body.user_id || '')
      if (!userId) return json({ error: 'ID account mancante.' }, 400)
      const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true })
      if (error) throw error
      await writeAudit(`Confermata manualmente email account ${userId}`)
      return json({ ok: true })
    }

    if (action === 'recovery_link') {
      const userId = String(body.user_id || '')
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
      if (userError || !userData.user) throw userError || new Error('Account non trovato.')
      const user = userData.user
      if (!user.email || user.email.endsWith(`@${USERNAME_AUTH_DOMAIN}`)) {
        return json({ error: 'Questo account usa solo il nome utente. Imposta una nuova password temporanea da “Modifica”.' }, 400)
      }
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email: user.email,
      })
      if (error) throw error
      await writeAudit(`Generato link recupero per ${user.email}`)
      return json({ ok: true, action_link: data?.properties?.action_link || null })
    }

    if (action === 'delete') {
      const userId = String(body.user_id || '')
      if (!userId) return json({ error: 'ID account mancante.' }, 400)
      if (userId === caller.id) return json({ error: 'Per sicurezza non puoi eliminare l’account con cui sei attualmente loggato.' }, 400)

      await admin.from('account_profiles').delete().eq('user_id', userId)
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw error
      await writeAudit(`Eliminato account ${userId}`)
      return json({ ok: true })
    }

    return json({ error: 'Azione non riconosciuta.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, 500)
  }
})
