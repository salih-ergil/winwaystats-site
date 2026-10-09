// winwaystats.com hesap sayfaları: Verilerim ve Hesap Silme.
// Giriş uygulamadaki hesapla (Supabase); robot doğrulaması Cloudflare Turnstile. Yalnızca kullanıcının kendi verisi okunur (RLS).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const W = window.WW;
const s = W.s;
const DELETION_GRACE_DAYS = 30;
const supabase = createClient(W.url, W.key, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const fmt = (str, vars) => str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
const locale = { tr: 'tr-TR', en: 'en-GB', de: 'de-DE', ru: 'ru-RU', es: 'es-ES' }[W.lang] || 'tr-TR';
const num = (v, d = 0) => Number(v).toLocaleString(locale, { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (iso) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = (iso) => new Date(iso).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const deletionDate = (requestedAt) => day(new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * 86400000).toISOString());

function setMsg(el, text, kind) {
  el.textContent = text || '';
  el.className = `msg${kind ? ` ${kind}` : ''}`;
}

// ---- Turnstile ----
let captchaToken = null;
let widgetId = null;
function renderCaptcha() {
  const box = $('captcha');
  if (!box || !window.turnstile) return;
  widgetId = window.turnstile.render(box, {
    sitekey: W.siteKey,
    theme: 'dark',
    language: W.lang,
    callback: (t) => { captchaToken = t; },
    'expired-callback': () => { captchaToken = null; },
    'error-callback': () => { captchaToken = null; },
  });
}
function resetCaptcha() {
  captchaToken = null;
  if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
}
window.onTurnstileLoad = renderCaptcha;
if (window.turnstile) renderCaptcha();

// ---- Giriş ----
async function signIn(e) {
  e.preventDefault();
  const msg = $('login-msg');
  const btn = $('login-btn');
  setMsg(msg, '');
  btn.disabled = true;
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: $('email').value.trim(),
      password: $('password').value,
      options: { captchaToken: captchaToken ?? undefined },
    });
    if (error) {
      const code = error.code || '';
      setMsg(msg, code === 'invalid_credentials' ? s.login.invalid : code === 'email_not_confirmed' ? s.login.notConfirmed : code.startsWith('captcha') ? s.login.captcha : s.login.generic, 'error');
      return;
    }
    await show();
  } catch {
    setMsg(msg, s.login.generic, 'error');
  } finally {
    btn.disabled = false;
    resetCaptcha();
  }
}

async function signOut() {
  await supabase.auth.signOut();
  location.reload();
}

// ---- Veriler ----
async function loadProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data;
}

/** Türkiye saatine göre bu ayın 1'i 00:00 (puan ayları Türkiye takvimine göre) */
function monthStartTr() {
  const off = 3 * 3600000;
  const d = new Date(Date.now() + off);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - off;
}

async function showMyData(user, profile) {
  const [{ data: coupons = [] }, { data: last }] = await Promise.all([
    supabase.from('coupons').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1000),
    supabase.from('coin_ledger').select('balance_after').eq('user_id', user.id).order('id', { ascending: false }).limit(1),
  ]);
  const list = coupons || [];
  const count = (st) => list.filter((c) => c.status === st).length;
  const start = monthStartTr();
  const monthPoints = list
    .filter((c) => c.status !== 'pending' && c.points != null && c.settled_at && new Date(c.settled_at).getTime() >= start)
    .reduce((a, c) => a + Number(c.points), 0);

  $('d-username').textContent = `@${profile?.username ?? ''}`;
  $('d-balance').textContent = `₵${num(last?.[0]?.balance_after ?? 0)}`;
  $('d-points').textContent = num(monthPoints, 2);
  $('d-coupons').textContent = num(list.length);
  $('d-won').textContent = num(count('won'));
  $('d-lost').textContent = num(count('lost'));
  $('d-void').textContent = num(count('void'));
  $('d-pending').textContent = num(count('pending'));

  const body = $('d-rows');
  body.innerHTML = '';
  for (const c of list.slice(0, 30)) {
    const tr = document.createElement('tr');
    const cells = [
      dateTime(c.created_at),
      String(Array.isArray(c.selections) ? c.selections.length : 0),
      num(c.total_odds, 2),
      `₵${num(c.stake)}`,
      s.status[c.status] ?? c.status,
      c.status === 'pending' ? '–' : `₵${num(c.payout, 2)}`,
      c.points == null || c.status === 'pending' ? '–' : num(c.points, 2),
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 4) td.className = `st-${c.status}`;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
  $('d-empty').hidden = list.length > 0;
  $('d-table').hidden = list.length === 0;

  $('d-download').onclick = async () => {
    const { data: ledger } = await supabase.from('coin_ledger').select('*').eq('user_id', user.id).order('id', { ascending: true });
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), email: user.email, profile, coupons: list, coinLedger: ledger ?? [] }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `winwaystats-${profile?.username ?? 'veriler'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const banner = $('d-deletion');
  if (profile?.deletion_requested_at) {
    banner.hidden = false;
    $('d-deletion-text').textContent = fmt(s.myData.pendingDeletion, { date: deletionDate(profile.deletion_requested_at) });
    $('d-cancel').onclick = async () => {
      const { error } = await supabase.rpc('cancel_account_deletion');
      if (!error) {
        $('d-deletion-text').textContent = s.myData.cancelled;
        $('d-cancel').hidden = true;
      }
    };
  }
}

function showDelete(profile) {
  const msg = $('del-msg');
  if (profile?.deletion_requested_at) {
    $('del-form').hidden = true;
    setMsg(msg, fmt(s.del.already, { date: deletionDate(profile.deletion_requested_at) }), 'ok');
    return;
  }
  $('del-confirm').onchange = (e) => { $('del-btn').disabled = !e.target.checked; };
  $('del-form').onsubmit = async (e) => {
    e.preventDefault();
    $('del-btn').disabled = true;
    const { error } = await supabase.rpc('request_account_deletion');
    if (error) {
      setMsg(msg, s.login.generic, 'error');
      $('del-btn').disabled = false;
      return;
    }
    $('del-form').hidden = true;
    setMsg(msg, fmt(s.del.done, { date: deletionDate(new Date().toISOString()) }), 'ok');
    // Oturum kapatılır; tekrar giriş talebi iptal etmez (iptal yalnızca uygulamadan ya da Verilerim'deki düğmeyle)
    await supabase.auth.signOut();
    $('signout').hidden = true;
  };
}

async function show() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  $('login').hidden = !!user;
  $('account').hidden = !user;
  if (!user) return;
  const profile = await loadProfile(user.id);
  $('who').textContent = `@${profile?.username ?? user.email}`;
  if (W.page === 'verilerim') await showMyData(user, profile);
  if (W.page === 'hesap-silme') showDelete(profile);
}

$('login-form').addEventListener('submit', signIn);
$('signout').addEventListener('click', signOut);
show();
