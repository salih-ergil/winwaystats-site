// winwaystats.com/kayit: sitede hesap açma (Salih, 2026-10-23). Uygulamadaki kayıtla aynı hesap ve aynı kurallar
// (src/features/auth/validation.ts); hesap açılınca kullanıcı uygulamaya bu hesapla girer. Partner kodu (bağlantıdan ya da
// elle) kayıttaki ek bilgiye yazılır; sunucu hesabı açarken kullanıcıyı partnere bağlar (partner_on_profile_created).
// Ayrıca /p/<kod> yönlendirmesi 404.html'den buraya ?kod=...&k=1 ile gelir (tıklama orada sayılır).
import { loadCities, loadCountries, picker, PICKER_CSS } from '/secim.js?v=db427b3a8e';

const W = window.WWK;
const s = W.s;
const client = globalThis.supabase.createClient(W.url, W.key, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---- Kurallar (uygulamayla aynı) ----
const USERNAME = /^[A-Za-z0-9_.çğıöşüÇĞİÖŞÜ]{3,20}$/;
const usernameKey = (v) => v.trim().replace(/[çÇğĞıIİöÖşŞüÜ]/g, (c) => ({ ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', I: 'i', İ: 'i', ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u' })[c]).toLowerCase();
const reserved = (v) => /pisagol|winway|admin|moderat|destek|support|yonetici|resmi|official/.test(usernameKey(v).replace(/[_.]/g, ''));
const SYMBOL = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/; // sunucudaki kuralla aynı
const normalizePhone = (v) => {
  const d = v.replace(/[^\d+]/g, '');
  if (/^05\d{9}$/.test(d)) return `+9${d}`;
  if (/^5\d{9}$/.test(d)) return `+90${d}`;
  if (/^90\d{10}$/.test(d)) return `+${d}`;
  return d;
};
const pad = (v) => String(v).padStart(2, '0');
const birthValue = (f) => (f.birth_year.value && f.birth_month.value && f.birth_day.value ? `${f.birth_year.value}-${pad(f.birth_month.value)}-${pad(f.birth_day.value)}` : '');
const age = (iso) => {
  const b = new Date(iso);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
};

function validate(f) {
  const e = {};
  const u = f.username.value.trim();
  if (!USERNAME.test(u)) e.username = s.err.username;
  else if (reserved(u)) e.username = s.err.reserved;
  if (f.full_name.value.trim().split(/\s+/).length < 2) e.full_name = s.err.fullName;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) e.email = s.err.email;
  const p = f.password.value;
  if (p.length < 8 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p) || !SYMBOL.test(p)) e.password = s.err.password;
  const phone = normalizePhone(`${dialOf(f.phone_cc.value)}${f.phone.value.replace(/^0/, '')}`);
  if (!/^\+\d{10,15}$/.test(phone)) e.phone = s.err.phone;
  const birth = birthValue(f);
  if (!birth) e.birth_date = s.err.birth;
  else if (age(birth) < 18) e.birth_date = s.err.minor;
  if (!f.adult.checked) e.adult = s.err.adult;
  if (!f.terms.checked) e.terms = s.err.terms;
  return { errors: e, phone };
}

function showErrors(form, errors) {
  form.querySelectorAll('[data-err]').forEach((el) => (el.textContent = errors[el.dataset.err] ?? ''));
}

// ---- Turnstile ----
let captchaToken = null;
function renderCaptcha() {
  const box = $('captcha');
  if (!box || box.dataset.drawn) return;
  if (!window.turnstile) return void setTimeout(renderCaptcha, 300);
  box.dataset.drawn = '1';
  window.turnstile.render(box, {
    sitekey: W.siteKey,
    theme: 'dark',
    callback: (t) => (captchaToken = t),
    'expired-callback': () => (captchaToken = null),
    'error-callback': () => (captchaToken = null),
  });
}

// ---- Partner kodu: adresten (?kod=) ya da daha önce /p/ ile gelinmişse tarayıcıdan ----
const store = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};
const load = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const fromLink = params.get('k') === '1';
const fromPartner = params.get('partner') === '1';
const code = (params.get('kod') || load('ww_partner_code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (params.get('kod')) store('ww_partner_code', code);
if (fromLink) store('ww_partner_source', 'link');

async function checkCode(v) {
  const msg = $('code-msg');
  if (!v) return (msg.textContent = '');
  const { data } = await client.rpc('partner_code_check', { p_code: v });
  msg.textContent = data ? s.codeOk : s.codeBad;
  msg.className = `msg ${data ? 'ok' : 'error'}`;
}

// ---- Adımlar ----
let email = '';
function step(n) {
  for (const id of ['step-form', 'step-otp', 'step-done']) $(id).hidden = id !== n;
  window.scrollTo(0, 0);
}

async function submitForm(e) {
  e.preventDefault();
  const f = e.currentTarget;
  const msg = $('form-msg');
  msg.textContent = '';
  const { errors, phone } = validate(f);
  showErrors(f, errors);
  if (Object.keys(errors).length) return;
  if (window.turnstile && !captchaToken) {
    msg.textContent = s.err.captchaWait;
    msg.className = 'msg error';
    return;
  }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { data: free } = await client.rpc('username_available', { p_username: f.username.value.trim() });
    if (free === false) {
      showErrors(f, { username: s.err.usernameTaken });
      return;
    }
    // Geçici e-posta ve kayıtlı adresin takma adı (Gmail noktası, "+ek") kabul edilmez (2026-10-23)
    const { data: mailIssue } = await client.rpc('email_check', { p_email: f.email.value.trim() });
    if (mailIssue) {
      showErrors(f, { email: mailIssue === 'disposable' ? s.err.disposable : s.err.exists });
      return;
    }
    // Bağlantıyla gelen kod, kullanıcı kutuyu boşaltsa da geçerlidir (Salih, 2026-11-06); başka kod yazarsa yazdığı geçer
    const partnerCode = f.partner_code.value.trim().toUpperCase() || code;
    email = f.email.value.trim();
    const { data, error } = await client.auth.signUp({
      email,
      password: f.password.value,
      options: {
        captchaToken: captchaToken ?? undefined,
        data: {
          username: f.username.value.trim(),
          full_name: f.full_name.value.trim(),
          phone,
          birth_date: birthValue(f),
          country: f.country.value || null,
          city: f.city.value.trim() || null,
          adult_confirmed: true,
          terms_accepted_at: new Date().toISOString(),
          lang: W.lang,
          signup_channel: 'web',
          ...(partnerCode ? { partner_code: partnerCode, partner_source: load('ww_partner_source') === 'link' && partnerCode === code ? 'link' : 'code' } : {}),
        },
      },
    });
    if (error) throw error;
    // E-posta kayıtlıysa Supabase hata vermez, boş kimlikli kullanıcı döner (uygulamadaki kontrolle aynı)
    if (data.user && data.user.identities?.length === 0) {
      msg.textContent = s.err.exists;
      msg.className = 'msg error';
      return;
    }
    $('otp-email').textContent = email;
    step('step-otp');
  } catch (err) {
    const m = String(err?.message ?? err);
    msg.textContent = /captcha/i.test(m) ? s.err.captcha : /email_disposable/.test(m) ? s.err.disposable : /already|registered|email_alias/i.test(m) ? s.err.exists : `${s.err.generic} (${m.slice(0, 80)})`;
    msg.className = 'msg error';
  } finally {
    btn.disabled = false;
    if (window.turnstile) window.turnstile.reset();
    captchaToken = null;
  }
}

async function submitOtp(e) {
  e.preventDefault();
  const v = $('otp').value.trim();
  const msg = $('otp-msg');
  if (!/^\d{6}$/.test(v)) {
    msg.textContent = s.err.otp;
    msg.className = 'msg error';
    return;
  }
  const btn = e.currentTarget.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const { error } = await client.auth.verifyOtp({ email, token: v, type: 'email' });
    if (error) throw error;
    store('ww_partner_code', null);
    store('ww_partner_source', null);
    // Partnere bağlandı mı (bilgi amaçlı); site oturumu kapatılır, kullanıcı uygulamada giriş yapacak
    const { data: st } = await client.rpc('my_partner_status');
    $('done-linked').hidden = !st?.linked;
    $('done-partner').hidden = !fromPartner;
    await client.auth.signOut();
    step('step-done');
  } catch (err) {
    msg.textContent = /expired|invalid/i.test(String(err?.message)) ? s.err.otpBad : s.err.generic;
    msg.className = 'msg error';
  } finally {
    btn.disabled = false;
  }
}

async function resend() {
  const msg = $('otp-msg');
  const { error } = await client.auth.resend({ type: 'signup', email });
  msg.textContent = error ? s.err.generic : s.resent;
  msg.className = `msg ${error ? 'error' : 'ok'}`;
}

// ---- Ülke, şehir ve telefon kodu: listeden aranarak (elle yazılmaz) ----
document.head.insertAdjacentHTML('beforeend', `<style>${PICKER_CSS}</style>`);
const countries = await loadCountries();
// Ülke adları sayfanın dilinde (liste Türkçe gelir)
const regionName = (c) => {
  if (W.lang === 'tr') return c.n;
  try {
    return new Intl.DisplayNames([W.lang], { type: 'region' }).of(c.c) || c.n;
  } catch {
    return c.n;
  }
};
const dialOf = (cc) => countries.find((c) => c.c === cc)?.d ?? '';
let dialTouched = false;
const dialPicker = picker($('pk-dial'), {
  name: 'phone_cc',
  items: countries.filter((c) => c.d).map((c) => ({ v: c.c, l: `${c.f} ${regionName(c)} ${c.d}`, s: `${c.f} ${c.d}` })),
  value: 'TR',
  search: s.l.searchDial,
  empty: s.l.empty,
  onChange: () => (dialTouched = true),
});
const cityPicker = picker($('pk-city'), { name: 'city', items: [], placeholder: s.l.cityFirst, search: s.l.searchCity, empty: s.l.empty });
const onCountry = async (cc) => {
  if (!dialTouched && dialOf(cc)) dialPicker.set(cc);
  $('signup-form').phone.placeholder = cc === 'TR' ? '5xx xxx xx xx' : '';
  const list = await loadCities(cc);
  cityPicker.setItems(list.map((n) => ({ v: n, l: n })), '', list.length ? s.l.choose : s.l.noCities);
};
// Partner başvurusundan gelen ülke önceden seçili (?ulke=XX)
const startCountry = countries.some((c) => c.c === params.get('ulke')) ? params.get('ulke') : '';
picker($('pk-country'), {
  name: 'country',
  items: countries.map((c) => ({ v: c.c, l: `${c.f} ${regionName(c)}` })),
  value: startCountry,
  placeholder: s.l.choose,
  search: s.l.searchCountry,
  empty: s.l.empty,
  onChange: onCountry,
});

// ---- Başlat ----
const form = $('signup-form');
if (startCountry) onCountry(startCountry);
// Doğum tarihi: gün / ay / yıl
const dobOpts = (ph, list) => `<option value="">${ph}</option>${list.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}`;
const lastYear = new Date().getFullYear() - 18;
const monthName = new Intl.DateTimeFormat(W.lang, { month: 'long' });
form.birth_year.innerHTML = dobOpts(s.l.year, Array.from({ length: 83 }, (_, i) => [lastYear - i, lastYear - i]));
form.birth_month.innerHTML = dobOpts(s.l.month, Array.from({ length: 12 }, (_, i) => [i + 1, monthName.format(new Date(2000, i, 1))]));
const paintDays = () => {
  const days = new Date(Number(form.birth_year.value) || 2000, Number(form.birth_month.value) || 1, 0).getDate();
  const keep = Math.min(Number(form.birth_day.value) || 0, days);
  form.birth_day.innerHTML = dobOpts(s.l.day, Array.from({ length: days }, (_, i) => [i + 1, i + 1]));
  form.birth_day.value = keep ? String(keep) : '';
};
paintDays();
form.birth_month.addEventListener('change', paintDays);
form.birth_year.addEventListener('change', paintDays);
form.partner_code.value = code;
if (code) checkCode(code);
form.partner_code.addEventListener('change', (e) => checkCode(e.target.value.trim().toUpperCase()));
form.addEventListener('submit', submitForm);
// Şifreyi göster / gizle (uygulamadaki göz simgesi gibi)
$('pass-toggle').addEventListener('click', (e) => {
  const show = form.password.type === 'password';
  form.password.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? s.l.hide : s.l.show;
});
$('back-partner').hidden = !fromPartner;
$('back-form').addEventListener('click', (e) => {
  e.preventDefault();
  step('step-form');
});
$('otp-form').addEventListener('submit', submitOtp);
$('resend').addEventListener('click', resend);
renderCaptcha();
