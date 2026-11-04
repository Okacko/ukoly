// Synchronizace přes Supabase s koncovým (E2E) šifrováním.
// - Přihlášení přes odkaz v e-mailu (magic link): heslo nikam nezadáváš,
//   session drží knihovna supabase-js v tomto prohlížeči.
// - Data se PŘED odesláním zašifrují v prohlížeči (AES-GCM, klíč odvozený
//   z tvojí passfráze přes PBKDF2). Supabase vidí jen šifrovaný balík –
//   ne obsah úkolů. Passfráze se nikam neposílá, zůstává jen na zařízení.
'use strict';

// Veřejné údaje projektu Supabase. Publishable (anon) klíč JE určen do prohlížeče
// a Supabase ho označuje jako "safe to share publicly" – není to tajemství.
// Řádky chrání Row Level Security, takže každý vidí jen svoje data.
const SYNC_CONFIG = {
  url: 'https://wvlgxdvsagdtcdkolguu.supabase.co',
  key: 'sb_publishable_lQntoJdsEuXVL0Jd5U8pUg_FYgWVGYI', // publishable (anon) klíč – veřejný
};

window.Sync = (function () {
  const PASS_KEY = 'ukoly.sync.pass'; // passfráze zůstává jen v tomto prohlížeči
  const TABLE = 'app_state';
  const encTxt = new TextEncoder(), decTxt = new TextDecoder();

  let sb = null, hooks = null;
  let session = null, uid = null, email = null;
  let passphrase = '', key = null, salt = null, saltB64 = '';
  let ready = false, configured = false, pushTimer = 0, channel = null;

  function emit(extra) {
    if (hooks && hooks.onStatus) {
      hooks.onStatus({ ready, configured, signedIn: !!session, user: email, hasPass: !!passphrase, ...extra });
    }
  }

  // ---------- šifrování ----------
  function b64(bytes) { const a = new Uint8Array(bytes); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(str) { const s = atob(str); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

  async function deriveKey(pass, saltBytes) {
    const base = await crypto.subtle.importKey('raw', encTxt.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 200000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptState(obj, k) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, encTxt.encode(JSON.stringify(obj)));
    return { iv: b64(iv), ciphertext: b64(ct) };
  }
  async function decryptState(ivB64, ctB64, k) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, k, unb64(ctB64));
    return JSON.parse(decTxt.decode(pt));
  }
  async function ensureKey(saltSource) {
    if (saltSource) { saltB64 = saltSource; salt = unb64(saltSource); }
    if (!salt) { salt = crypto.getRandomValues(new Uint8Array(16)); saltB64 = b64(salt); }
    key = await deriveKey(passphrase, salt);
  }

  // ---------- init ----------
  async function init(h) {
    hooks = h;
    if (!window.supabase || !window.supabase.createClient) { ready = true; emit({ error: 'Supabase se nenačetl' }); return; }
    if (!SYNC_CONFIG.url || !SYNC_CONFIG.key || SYNC_CONFIG.key.indexOf('VLOZ') === 0) { ready = true; configured = false; emit(); return; }
    configured = true;
    sb = window.supabase.createClient(SYNC_CONFIG.url, SYNC_CONFIG.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    try { passphrase = localStorage.getItem(PASS_KEY) || ''; } catch (e) { passphrase = ''; }
    try {
      const { data } = await sb.auth.getSession();
      session = data.session; uid = session && session.user.id; email = session && session.user.email;
    } catch (e) { /* bez session */ }
    ready = true;
    sb.auth.onAuthStateChange((_ev, s) => {
      const was = uid;
      session = s; uid = s && s.user.id; email = s && s.user.email;
      if (uid !== was) { key = null; salt = null; saltB64 = ''; }
      emit();
      if (session) { subscribe(); syncNow(); }
    });
    emit();
    if (session) { subscribe(); await syncNow(); }
  }

  // ---------- auth ----------
  // Přihlášení e-mailem a heslem (session zůstává, token se obnovuje sám).
  async function signInPassword(mail, password) {
    if (!sb) return;
    const { error } = await sb.auth.signInWithPassword({ email: mail, password });
    if (error) { emit({ error: error.message }); throw error; }
  }

  // Založení účtu e-mailem a heslem.
  async function signUp(mail, password) {
    if (!sb) return;
    const { data, error } = await sb.auth.signUp({
      email: mail, password,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { emit({ error: error.message }); throw error; }
    emit({ signupInfo: data.session ? 'ok' : 'confirm' }); // 'confirm' = čeká na potvrzení e-mailu
  }

  // Nastavení/změna hesla pro už přihlášený účet (např. po přihlášení odkazem).
  async function setLoginPassword(password) {
    if (!sb || !session) return;
    const { error } = await sb.auth.updateUser({ password });
    if (error) { emit({ error: error.message }); throw error; }
    emit({ passwordSet: true });
  }

  // Záložní přihlášení přes odkaz v e-mailu (když zapomeneš heslo).
  async function signInMagic(mail) {
    if (!sb) return;
    const { error } = await sb.auth.signInWithOtp({
      email: mail,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { emit({ error: error.message }); throw error; }
    emit({ linkSent: true });
  }

  async function signOut() {
    if (!sb) return;
    try { if (channel) { sb.removeChannel(channel); channel = null; } } catch (e) {}
    try { await sb.auth.signOut(); } catch (e) {}
    session = null; uid = null; email = null; key = null; salt = null; saltB64 = '';
    emit();
  }

  function setPassphrase(p) {
    passphrase = p || '';
    key = null; salt = null; saltB64 = '';
    try { if (passphrase) localStorage.setItem(PASS_KEY, passphrase); else localStorage.removeItem(PASS_KEY); } catch (e) {}
    emit();
    if (session && passphrase) syncNow();
  }

  // ---------- data ----------
  async function fetchRow() {
    const { data, error } = await sb.from(TABLE).select('salt, iv, ciphertext, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return data; // null = zatím nic v cloudu
  }

  async function push() {
    if (!session || !passphrase) return;
    if (!key) await ensureKey(saltB64 || null);
    const st = hooks.getState();
    const { iv, ciphertext } = await encryptState(st, key);
    const { error } = await sb.from(TABLE).upsert({ user_id: uid, salt: saltB64, iv, ciphertext, updated_at: st.updatedAt || 0 });
    if (error) throw error;
  }

  // Jedno kolo: porovnej časy, převezmi novější (poslední zápis vyhrává).
  async function syncNow() {
    if (!session) return;
    if (!passphrase) { emit({ needsPass: true }); return; }
    try {
      const row = await fetchRow();
      const localAt = (hooks.getState().updatedAt) || 0;
      if (!row) {
        await ensureKey(null); // nový salt
        await push();
      } else {
        await ensureKey(row.salt);
        const remoteAt = row.updated_at || 0;
        if (remoteAt > localAt) {
          let plain;
          try { plain = await decryptState(row.iv, row.ciphertext, key); }
          catch (e) { emit({ error: 'Špatná passfráze – data nejdou dešifrovat' }); return; }
          hooks.onRemote(plain);
        } else if (remoteAt < localAt) {
          await push();
        }
      }
      emit({ lastSync: Date.now() });
    } catch (e) {
      console.warn('[sync] syncNow', e);
      emit({ error: String(e && e.message || e) });
    }
  }

  function schedulePush() {
    if (!session || !passphrase) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      push().then(() => emit({ lastSync: Date.now() })).catch((e) => { console.warn('[sync] push', e); emit({ error: String(e && e.message || e) }); });
    }, 1200);
  }

  // Živá synchronizace: když přijde změna z jiného zařízení, hned natáhni.
  function subscribe() {
    if (!sb || !uid || channel) return;
    try {
      channel = sb.channel('app_state_' + uid)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + uid }, () => { syncNow(); })
        .subscribe();
    } catch (e) { /* realtime je nepovinný */ }
  }

  return { init, signInPassword, signUp, setLoginPassword, signInMagic, signOut, setPassphrase, syncNow, schedulePush, isOn: () => !!session && !!passphrase };
})();
